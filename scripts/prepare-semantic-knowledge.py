#!/usr/bin/env python3
"""
Build OpenHowNet word cache + semantic graph for hybrid scoring.

Run once after prepare:fasttext (needs data/words.json and data/vectors.f32):

  python3 -m venv .venv-semantic
  source .venv-semantic/bin/activate
  pip install -r requirements-semantic.txt
  python scripts/prepare-semantic-knowledge.py

Outputs:
  data/semantic-word-cache.json  — per-word sememes, concepts, synonyms, domain metadata
  data/semantic-graph.json       — weighted adjacency list for runtime Dijkstra
"""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import TypedDict

import numpy as np

try:
    import OpenHowNet
except ImportError as exc:
    raise SystemExit(
        "OpenHowNet is required. Install with: pip install -r requirements-semantic.txt"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from semantic_sense_heuristics import (  # noqa: E402
    SCHEMA_VERSION,
    SenseProfile,
    WordKnowledge,
    adjust_synonym_weight,
    aggregate_usage_bias,
    classify_sense_domain,
    classify_usage_bias,
    export_cache,
    is_abstract_sememe,
    pick_dominant_sense,
    score_sense_profile,
    word_metadata,
    WEIGHT_SYNONYM_SENSE,
    WEIGHT_SYNONYM_WEAK,
)

DEFAULT_WORDS_PATH = ROOT / "data" / "words.json"
DEFAULT_VECTORS_PATH = ROOT / "data" / "vectors.f32"
DEFAULT_CACHE_PATH = ROOT / "data" / "semantic-word-cache.json"
DEFAULT_GRAPH_PATH = ROOT / "data" / "semantic-graph.json"

# Edge weights — lower = closer semantic relation (path cost).
WEIGHT_SYNONYM_STRONG = 1.0
WEIGHT_SYNONYM = 1.25
WEIGHT_SEMEME_DIRECT = 1.2
WEIGHT_SEMEME_EXPANDED = 2.8
WEIGHT_CONCEPT = 1.3
WEIGHT_HYPERNYM = 3.0
WEIGHT_WEAK = 4.5

SYNONYM_K = 20
NEAREST_MIN_SCORE = 0.6
CHINESE_RE = re.compile(r"^[\u4e00-\u9fff]+$")

CPU_COUNT = os.cpu_count() or 8


class GraphEdge(TypedDict):
    a: str
    b: str
    w: float


class EmbeddingIndex(TypedDict):
    words: list[str]
    vectors: np.ndarray
    word_to_index: dict[str, int]


_worker_hownet = None
_worker_embedding_index: EmbeddingIndex | None = None


def load_vocabulary(path: Path, content_only: bool) -> list[str]:
    entries = json.loads(path.read_text(encoding="utf-8"))
    words = [entry["word"] for entry in entries]
    if content_only:
        words = [word for word in words if CHINESE_RE.fullmatch(word)]
    return words


def load_embedding_index(words_path: Path, vectors_path: Path) -> EmbeddingIndex:
    entries = json.loads(words_path.read_text(encoding="utf-8"))
    words = [entry["word"] for entry in entries]
    raw = vectors_path.read_bytes()
    vector_count = len(raw) // struct.calcsize("<f")
    if vector_count % len(words) != 0:
        raise SystemExit("Vector data does not align with word metadata.")

    vector_length = vector_count // len(words)
    vectors = np.frombuffer(raw, dtype=np.float32).reshape(len(words), vector_length)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vectors = vectors / norms

    return {
        "words": words,
        "vectors": vectors,
        "word_to_index": {word: index for index, word in enumerate(words)},
    }


def embedding_nearest_neighbors(
    word: str,
    embedding_index: EmbeddingIndex,
    vocabulary: set[str],
    k: int = SYNONYM_K,
) -> list[tuple[str, float]]:
    word_to_index = embedding_index["word_to_index"]
    source_index = word_to_index.get(word)
    if source_index is None:
        return []

    vectors = embedding_index["vectors"]
    scores = vectors @ vectors[source_index]
    scores[source_index] = -1.0

    ranked_indices = np.argpartition(scores, -k)[-k:]
    ranked_indices = ranked_indices[np.argsort(scores[ranked_indices])[::-1]]

    neighbors: list[tuple[str, float]] = []
    for index in ranked_indices:
        candidate = embedding_index["words"][int(index)]
        score = float(scores[index])
        if candidate == word or candidate not in vocabulary or score < NEAREST_MIN_SCORE:
            continue
        neighbors.append((candidate, score))

    return neighbors


def collect_tree_sememes(
    node: dict,
    core: set[str],
    expanded: set[str],
    max_depth: int,
    depth: int = 0,
) -> None:
    if depth > max_depth:
        return

    name = str(node.get("name", ""))
    role = node.get("role")
    if role not in ("sense",) and "|" in name:
        if depth == 0:
            core.add(name)
        else:
            expanded.add(name)

    for child in node.get("children") or []:
        collect_tree_sememes(child, core, expanded, max_depth, depth + 1)


def extract_sense_profiles(hownet, word: str, tree_depth: int = 1) -> list[SenseProfile]:
    profiles: list[SenseProfile] = []

    try:
        senses = hownet.get_sense(word, language="zh") or []
    except Exception:
        return profiles

    for sense in senses:
        sense_id = str(getattr(sense, "No", "") or "")
        core: set[str] = set()
        expanded: set[str] = set()

        try:
            for sememe in sense.get_sememe_list() or []:
                core.add(str(sememe))
        except Exception:
            pass

        if tree_depth > 0:
            try:
                tree = sense.get_sememe_tree()
                if tree:
                    collect_tree_sememes(tree, core, expanded, tree_depth)
            except Exception:
                pass

        for sememe in list(core):
            try:
                for related in hownet.get_related_sememes(sememe) or []:
                    relation = hownet.get_sememe_relation(sememe, related) or []
                    related_text = str(related)
                    if "hypernym" in relation:
                        expanded.add(related_text)
                    elif related_text not in core:
                        expanded.add(related_text)
            except Exception:
                pass

        expanded -= core
        core_list = sorted(core)
        expanded_list = sorted(expanded)
        domain = classify_sense_domain(core_list)
        usage_bias = classify_usage_bias(core_list, domain)

        profiles.append(
            SenseProfile(
                sense_id=sense_id,
                core_sememes=core_list,
                expanded_sememes=expanded_list,
                domain=domain,
                usage_bias=usage_bias,
            )
        )

    return profiles


def merge_word_sememes(profiles: list[SenseProfile], dominant: SenseProfile | None) -> tuple[list[str], list[str], list[str]]:
    core_union: list[str] = []
    expanded_union: list[str] = []
    seen_core: set[str] = set()
    seen_expanded: set[str] = set()

    ordered_profiles = []
    if dominant is not None:
        ordered_profiles.append(dominant)
    ordered_profiles.extend(profile for profile in profiles if profile is not dominant)

    for profile in ordered_profiles:
        for sememe in profile.core_sememes:
            if sememe not in seen_core:
                seen_core.add(sememe)
                core_union.append(sememe)
        for sememe in profile.expanded_sememes:
            if sememe not in seen_core and sememe not in seen_expanded:
                seen_expanded.add(sememe)
                expanded_union.append(sememe)

    sememes = core_union + expanded_union
    return sememes, core_union, expanded_union


def sense_concepts(senses) -> list[str]:
    concepts: list[str] = []
    for sense in senses or []:
        no = getattr(sense, "No", None)
        zh = getattr(sense, "Zh_word", None) or ""
        en = getattr(sense, "En_word", None) or ""
        if no is not None:
            concepts.append(f"{no}|{zh}|{en}".strip("|"))
    return concepts


def concept_node(concept: str) -> str:
    return f"concept:{concept}"


def sememe_node(sememe: str) -> str:
    return f"sememe:{sememe}"


def sense_zh_word(sense) -> str | None:
    parts = str(sense).split("|")
    if len(parts) >= 3 and parts[2]:
        return parts[2]
    return None


def word_core_sememes_from_index(sememe_to_words: dict[str, list[str]], word: str) -> list[str]:
    return sememe_to_words.get(f"__core__:{word}", sememe_to_words.get(f"__sememes__:{word}", []))


def core_sememe_overlap_rank(
    word: str,
    candidates: list[str],
    sememe_to_words: dict[str, list[str]],
) -> list[tuple[str, int, float]]:
    source = set(word_core_sememes_from_index(sememe_to_words, word))
    if not source:
        return []

    ranked: list[tuple[str, int, float]] = []
    for candidate in candidates:
        if candidate == word:
            continue

        target = set(word_core_sememes_from_index(sememe_to_words, candidate))
        if not target:
            continue

        overlap = len(source & target)
        union = source | target
        ranked.append((candidate, overlap, overlap / len(union)))

    ranked.sort(key=lambda item: (-item[1], -item[2], item[0]))
    return ranked


def extract_sense_synonym_words(
    hownet,
    word: str,
    vocabulary: set[str],
    profiles: list[SenseProfile],
) -> list[tuple[str, float, SenseProfile | None]]:
    links: list[tuple[str, float, SenseProfile | None]] = []
    seen: set[str] = set()

    try:
        senses = hownet.get_sense(word, language="zh") or []
    except Exception:
        return links

    profile_by_id = {profile.sense_id: profile for profile in profiles if profile.sense_id}

    for sense in senses:
        sense_id = str(getattr(sense, "No", "") or "")
        profile = profile_by_id.get(sense_id)
        try:
            related = hownet.get_sense_synonyms(sense) or []
        except Exception:
            continue

        for related_sense in related:
            candidate = sense_zh_word(related_sense)
            if not candidate or candidate == word or candidate not in vocabulary or candidate in seen:
                continue
            seen.add(candidate)
            links.append((candidate, WEIGHT_SYNONYM_SENSE, profile))

    return links


def build_ranked_sememe_synonyms(
    word: str,
    core_sememes: list[str],
    sememe_to_words: dict[str, list[str]],
    vocabulary: set[str],
) -> list[tuple[str, int, float]]:
    scores: Counter[str] = Counter()
    sememe_set = set(core_sememes)

    for sememe in core_sememes:
        if is_abstract_sememe(sememe):
            continue
        for candidate in sememe_to_words.get(sememe, ()):
            if candidate != word and candidate in vocabulary:
                scores[candidate] += 1

    ranked: list[tuple[str, int, float]] = []
    for candidate, overlap in scores.items():
        candidate_sememes = set(word_core_sememes_from_index(sememe_to_words, candidate))
        if not candidate_sememes:
            continue
        ranked.append((candidate, overlap, overlap / len(sememe_set | candidate_sememes)))

    ranked.sort(key=lambda item: (-item[1], -item[2], item[0]))
    return ranked


def sememe_link_weight(overlap: int, jaccard: float) -> float:
    if overlap >= 2 or jaccard >= 0.5:
        return WEIGHT_SYNONYM_STRONG
    return WEIGHT_SYNONYM_WEAK


def nearest_link_weight(score: float) -> float:
    if score >= 0.8:
        return WEIGHT_SYNONYM_STRONG
    if score >= NEAREST_MIN_SCORE:
        return WEIGHT_SYNONYM
    return WEIGHT_SYNONYM_WEAK


def extract_synonym_links(
    hownet,
    word: str,
    vocabulary: set[str],
    entry: WordKnowledge,
    sememe_to_words: dict[str, list[str]],
    embedding_index: EmbeddingIndex,
    word_cache: dict[str, WordKnowledge],
    profiles: list[SenseProfile],
) -> list[tuple[str, float]]:
    links: dict[str, float] = {}
    core_sememes = entry.get("core_sememes") or entry.get("sememes") or []

    for candidate, base_weight, profile in extract_sense_synonym_words(hownet, word, vocabulary, profiles):
        candidate_entry = word_cache.get(candidate)
        weight = adjust_synonym_weight(base_weight, entry, candidate_entry, profile)
        links[candidate] = min(links.get(candidate, 99.0), weight)

    for candidate, score in embedding_nearest_neighbors(word, embedding_index, vocabulary):
        weight = nearest_link_weight(score)
        weight = adjust_synonym_weight(weight, entry, word_cache.get(candidate))
        links[candidate] = min(links.get(candidate, 99.0), weight)

    for candidate, overlap, jaccard in build_ranked_sememe_synonyms(
        word,
        core_sememes,
        sememe_to_words,
        vocabulary,
    ):
        weight = sememe_link_weight(overlap, jaccard)
        weight = adjust_synonym_weight(weight, entry, word_cache.get(candidate))
        links[candidate] = min(links.get(candidate, 99.0), weight)

    if not links:
        return []

    ranked = core_sememe_overlap_rank(word, list(links.keys()), sememe_to_words)
    return [(candidate, links[candidate]) for candidate, _, _ in ranked[:SYNONYM_K]]


def apply_synonym_links(cache_entry: WordKnowledge, links: list[tuple[str, float]]) -> None:
    cache_entry["synonyms"] = [word for word, _ in links]
    cache_entry["synonym_weights"] = {word: weight for word, weight in links}


def lookup_word_knowledge(hownet, word: str) -> WordKnowledge:
    profiles = extract_sense_profiles(hownet, word)
    dominant = pick_dominant_sense(profiles)
    sememes, core_sememes, expanded_sememes = merge_word_sememes(profiles, dominant)

    try:
        senses = hownet.get_sense(word, language="zh") or []
    except Exception:
        senses = []

    domain = dominant.domain if dominant else "abstract/general"
    usage_bias = aggregate_usage_bias(profiles)

    return {
        "sememes": sememes,
        "core_sememes": core_sememes,
        "expanded_sememes": expanded_sememes,
        "domain": domain,
        "usage_bias": usage_bias,
        "sense_count": len(profiles),
        "synonyms": [],
        "concepts": sense_concepts(senses),
    }


def _init_worker(embedding_index: EmbeddingIndex) -> None:
    global _worker_hownet, _worker_embedding_index
    _worker_embedding_index = embedding_index
    _worker_hownet = OpenHowNet.HowNetDict(init_sim=True)


def _init_hownet_worker() -> None:
    global _worker_hownet
    _worker_hownet = OpenHowNet.HowNetDict(init_sim=True)


def _lookup_words_chunk(words: list[str]) -> list[tuple[str, WordKnowledge]]:
    assert _worker_hownet is not None
    return [(word, lookup_word_knowledge(_worker_hownet, word)) for word in words]


def _synonyms_for_chunk(
    payload: tuple[list[str], dict[str, list[str]], list[str], dict[str, WordKnowledge]],
) -> list[tuple[str, list[tuple[str, float]]]]:
    words, sememe_to_words, vocabulary_list, cache_subset = payload
    vocabulary = set(vocabulary_list)
    assert _worker_hownet is not None
    assert _worker_embedding_index is not None
    results: list[tuple[str, list[tuple[str, float]]]] = []
    for word in words:
        entry = cache_subset.get(word)
        if entry is None:
            continue
        profiles = extract_sense_profiles(_worker_hownet, word)
        results.append(
            (
                word,
                extract_synonym_links(
                    _worker_hownet,
                    word,
                    vocabulary,
                    entry,
                    sememe_to_words,
                    _worker_embedding_index,
                    cache_subset,
                    profiles,
                ),
            )
        )
    return results


def _hypernym_edges_for_sememe(sememe: str) -> list[GraphEdge]:
    assert _worker_hownet is not None
    edges: list[GraphEdge] = []
    source = sememe_node(sememe)
    try:
        related = _worker_hownet.get_related_sememes(sememe) or []
    except Exception:
        related = []
    for target in related:
        try:
            relation = _worker_hownet.get_sememe_relation(sememe, target) or []
        except Exception:
            relation = []
        target_node = sememe_node(str(target))
        weight = WEIGHT_HYPERNYM if "hypernym" in relation else WEIGHT_WEAK
        if is_abstract_sememe(sememe) or is_abstract_sememe(str(target)):
            weight += 0.8
        edges.append({"a": source, "b": target_node, "w": weight})
    return edges


def chunk_words(words: list[str], chunk_size: int) -> list[list[str]]:
    return [words[index : index + chunk_size] for index in range(0, len(words), chunk_size)]


def default_workers(requested: int | None) -> int:
    if requested is not None:
        return max(1, requested)
    return max(1, CPU_COUNT)


def parallel_map(
    executor: ProcessPoolExecutor,
    function,
    items: list,
    label: str,
    total_units: int | None = None,
    units_per_item: int = 1,
) -> list:
    if not items:
        return []

    results = []
    total = total_units if total_units is not None else len(items) * units_per_item
    work_done = 0
    reported = 0
    report_every = max(1, total // 20)
    started = time.perf_counter()

    futures = [executor.submit(function, item) for item in items]
    for future in as_completed(futures):
        results.append(future.result())
        work_done = min(total, work_done + units_per_item)
        if work_done - reported >= report_every or work_done >= total:
            elapsed = time.perf_counter() - started
            rate = work_done / elapsed if elapsed > 0 else 0
            print(
                f"  {label}: {work_done}/{total} ({rate:.1f}/s)",
                file=sys.stderr,
            )
            reported = work_done

    return results


def build_sememe_index(cache: dict[str, WordKnowledge]) -> dict[str, list[str]]:
    sememe_to_words: dict[str, list[str]] = {}
    for word, knowledge in cache.items():
        core = knowledge.get("core_sememes") or knowledge.get("sememes") or []
        sememe_to_words[f"__core__:{word}"] = core
        sememe_to_words[f"__sememes__:{word}"] = knowledge.get("sememes") or core
        for sememe in core:
            sememe_to_words.setdefault(sememe, []).append(word)
    return sememe_to_words


def build_word_cache_parallel(
    words: list[str],
    vocabulary: set[str],
    embedding_index: EmbeddingIndex,
    workers: int,
    chunk_size: int,
) -> dict[str, WordKnowledge]:
    chunks = chunk_words(words, chunk_size)
    cache: dict[str, WordKnowledge] = {}

    print(f"  Lookup pass: {len(words)} words, {len(chunks)} chunks, {workers} workers", file=sys.stderr)
    with ProcessPoolExecutor(
        max_workers=workers,
        initializer=_init_worker,
        initargs=(embedding_index,),
    ) as executor:
        for chunk_result in parallel_map(
            executor,
            _lookup_words_chunk,
            chunks,
            "Lookups",
            len(words),
            units_per_item=chunk_size,
        ):
            for word, knowledge in chunk_result:
                cache[word] = knowledge

        sememe_to_words = build_sememe_index(cache)
        synonym_chunks = [(chunk, sememe_to_words, list(vocabulary), cache) for chunk in chunks]
        print(
            f"  Synonym pass: {len(words)} words, {len(chunks)} chunks, {workers} workers",
            file=sys.stderr,
        )
        for chunk_result in parallel_map(
            executor,
            _synonyms_for_chunk,
            synonym_chunks,
            "Synonyms",
            len(words),
            units_per_item=chunk_size,
        ):
            for word, synonym_links in chunk_result:
                apply_synonym_links(cache[word], synonym_links)

    return cache


def build_word_cache_serial(
    hownet,
    words: list[str],
    vocabulary: set[str],
    embedding_index: EmbeddingIndex,
) -> dict[str, WordKnowledge]:
    cache: dict[str, WordKnowledge] = {}
    total = len(words)

    for index, word in enumerate(words, start=1):
        if index % 500 == 0 or index == total:
            print(f"  OpenHowNet lookup {index}/{total} ({word})", file=sys.stderr)
        cache[word] = lookup_word_knowledge(hownet, word)

    sememe_to_words = build_sememe_index(cache)

    for word in words:
        profiles = extract_sense_profiles(hownet, word)
        apply_synonym_links(
            cache[word],
            extract_synonym_links(
                hownet,
                word,
                vocabulary,
                cache[word],
                sememe_to_words,
                embedding_index,
                cache,
                profiles,
            ),
        )

    return cache


def collect_graph_edges(
    words: list[str],
    word_cache: dict[str, WordKnowledge],
    vocabulary: set[str],
    workers: int,
) -> list[GraphEdge]:
    edges: list[GraphEdge] = []
    all_sememes: set[str] = set()

    for word in words:
        knowledge = word_cache[word]
        core_sememes = knowledge.get("core_sememes") or knowledge.get("sememes") or []
        expanded_sememes = knowledge.get("expanded_sememes") or []

        for sememe in core_sememes:
            all_sememes.add(sememe)
            weight = WEIGHT_SEMEME_DIRECT
            if is_abstract_sememe(sememe):
                weight += 0.4
            edges.append({"a": word, "b": sememe_node(sememe), "w": weight})

        for sememe in expanded_sememes:
            all_sememes.add(sememe)
            weight = WEIGHT_SEMEME_EXPANDED
            if is_abstract_sememe(sememe):
                weight += 0.6
            edges.append({"a": word, "b": sememe_node(sememe), "w": weight})

        for concept in knowledge["concepts"]:
            edges.append({"a": word, "b": concept_node(concept), "w": WEIGHT_CONCEPT})

        synonym_weights = knowledge.get("synonym_weights") or {}
        for synonym in knowledge.get("synonyms") or []:
            if synonym in vocabulary:
                edges.append(
                    {
                        "a": word,
                        "b": synonym,
                        "w": float(synonym_weights.get(synonym, WEIGHT_SYNONYM_STRONG)),
                    }
                )

    sememe_list = sorted(all_sememes)
    print(
        f"  Hypernym pass: {len(sememe_list)} sememes, {workers} workers",
        file=sys.stderr,
    )

    with ProcessPoolExecutor(
        max_workers=workers,
        initializer=_init_hownet_worker,
    ) as executor:
        for chunk_edges in parallel_map(
            executor,
            _hypernym_edges_for_sememe,
            sememe_list,
            "Hypernyms",
            len(sememe_list),
        ):
            edges.extend(chunk_edges)

    return edges


def dedupe_edges(edges: list[GraphEdge]) -> list[GraphEdge]:
    best: dict[tuple[str, str], float] = {}
    for edge in edges:
        left, right = sorted((edge["a"], edge["b"]))
        key = (left, right)
        weight = float(edge["w"])
        if key not in best or weight < best[key]:
            best[key] = weight
    return [{"a": left, "b": right, "w": weight} for (left, right), weight in best.items()]


def export_graph(edges: list[GraphEdge]) -> dict:
    return {"schema_version": SCHEMA_VERSION, "edges": edges}


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare OpenHowNet cache and semantic graph.")
    parser.add_argument("--words", type=Path, default=DEFAULT_WORDS_PATH)
    parser.add_argument("--vectors", type=Path, default=DEFAULT_VECTORS_PATH)
    parser.add_argument("--cache-output", type=Path, default=DEFAULT_CACHE_PATH)
    parser.add_argument("--graph-output", type=Path, default=DEFAULT_GRAPH_PATH)
    parser.add_argument(
        "--content-only",
        action="store_true",
        default=True,
        help="Skip punctuation and non-Chinese tokens (default: on).",
    )
    parser.add_argument(
        "--all-tokens",
        action="store_true",
        help="Include punctuation and non-Chinese tokens from words.json.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help=f"Parallel worker processes (default: {CPU_COUNT}).",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=256,
        help="Words per worker chunk (default: 256).",
    )
    parser.add_argument(
        "--serial",
        action="store_true",
        help="Disable multiprocessing (debug / low-memory machines).",
    )
    args = parser.parse_args()

    if not args.words.exists():
        raise SystemExit(f"Missing vocabulary file: {args.words}")
    if not args.vectors.exists():
        raise SystemExit(f"Missing vector file: {args.vectors}")

    workers = default_workers(args.workers)
    started = time.perf_counter()

    print("Downloading OpenHowNet resources if needed...")
    OpenHowNet.download()

    embedding_index = load_embedding_index(args.words, args.vectors)
    words = load_vocabulary(args.words, args.content_only and not args.all_tokens)
    vocabulary = set(words)
    print(
        f"Building word cache for {len(words)} words "
        f"({'serial' if args.serial else f'{workers} workers, chunk={args.chunk_size}'}) "
        f"using fastText nearest neighbors..."
    )

    if args.serial:
        print("Initializing OpenHowNet (with similarity tables for sense synonyms)...")
        hownet = OpenHowNet.HowNetDict(init_sim=True)
        word_cache = build_word_cache_serial(hownet, words, vocabulary, embedding_index)
        print("Building semantic graph...")
        edges = collect_graph_edges(words, word_cache, vocabulary, workers=1)
    else:
        word_cache = build_word_cache_parallel(
            words,
            vocabulary,
            embedding_index,
            workers,
            args.chunk_size,
        )
        print("Building semantic graph...")
        edges = collect_graph_edges(words, word_cache, vocabulary, workers)

    edges = dedupe_edges(edges)
    nodes = set()
    for edge in edges:
        nodes.add(edge["a"])
        nodes.add(edge["b"])
    for word in words:
        nodes.add(word)

    args.cache_output.parent.mkdir(parents=True, exist_ok=True)
    args.graph_output.parent.mkdir(parents=True, exist_ok=True)

    args.cache_output.write_text(json.dumps(export_cache(word_cache), ensure_ascii=False), encoding="utf-8")
    args.graph_output.write_text(json.dumps(export_graph(edges), ensure_ascii=False), encoding="utf-8")

    elapsed = time.perf_counter() - started
    print(
        f"Wrote {len(word_cache)} word entries to {args.cache_output} "
        f"and {len(edges)} edges ({len(nodes)} nodes) to {args.graph_output} "
        f"in {elapsed:.1f}s."
    )


if __name__ == "__main__":
    main()
