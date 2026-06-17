#!/usr/bin/env python3
"""
Build OpenHowNet word cache + NetworkX semantic graph for hybrid scoring.

Run once after prepare:vectors (needs data/words.json):

  python3 -m venv .venv-semantic
  source .venv-semantic/bin/activate
  pip install -r requirements-semantic.txt
  python scripts/prepare-semantic-knowledge.py

Outputs:
  data/semantic-word-cache.json  — per-word sememes, concepts, synonyms
  data/semantic-graph.json       — weighted adjacency list for runtime Dijkstra
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import TypedDict

try:
    import OpenHowNet
except ImportError as exc:
    raise SystemExit(
        "OpenHowNet is required. Install with: pip install -r requirements-semantic.txt"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORDS_PATH = ROOT / "data" / "words.json"
DEFAULT_CACHE_PATH = ROOT / "data" / "semantic-word-cache.json"
DEFAULT_GRAPH_PATH = ROOT / "data" / "semantic-graph.json"

# Edge weights — lower = closer semantic relation (path cost).
WEIGHT_SYNONYM_SENSE = 0.75
WEIGHT_SYNONYM_STRONG = 1.0
WEIGHT_SYNONYM = 1.25
WEIGHT_SYNONYM_WEAK = 1.75
WEIGHT_SEMEME = 1.5
WEIGHT_HYPERNYM = 2.5
WEIGHT_WEAK = 4.0

SYNONYM_K = 20
NEAREST_MIN_SCORE = 0.6
CHINESE_RE = re.compile(r"^[\u4e00-\u9fff]+$")

CPU_COUNT = os.cpu_count() or 8


class WordKnowledge(TypedDict, total=False):
    sememes: list[str]
    synonyms: list[str]
    concepts: list[str]
    synonym_weights: dict[str, float]


class GraphEdge(TypedDict):
    a: str
    b: str
    w: float


_worker_hownet = None
_worker_use_nearest = False


def load_vocabulary(path: Path, limit: int | None, content_only: bool) -> list[str]:
    entries = json.loads(path.read_text(encoding="utf-8"))
    words = [entry["word"] for entry in entries]
    if content_only:
        words = [word for word in words if CHINESE_RE.fullmatch(word)]
    if limit is not None:
        words = words[:limit]
    return words


def collect_tree_sememes(node: dict, collected: set[str], max_depth: int, depth: int = 0) -> None:
    if depth > max_depth:
        return

    name = str(node.get("name", ""))
    role = node.get("role")
    if role not in ("sense",) and "|" in name:
        collected.add(name)

    for child in node.get("children") or []:
        collect_tree_sememes(child, collected, max_depth, depth + 1)


def extract_sememes(hownet, word: str, expanded_layer: int = 1) -> list[str]:
    sememes: set[str] = set()

    try:
        senses = hownet.get_sense(word, language="zh") or []
    except Exception:
        return []

    for sense in senses:
        try:
            for sememe in sense.get_sememe_list() or []:
                sememes.add(str(sememe))
        except Exception:
            pass

        if expanded_layer > 0:
            try:
                tree = sense.get_sememe_tree()
                if tree:
                    collect_tree_sememes(tree, sememes, expanded_layer)
            except Exception:
                pass

        for sememe in list(sememes):
            try:
                for related in hownet.get_related_sememes(sememe) or []:
                    relation = hownet.get_sememe_relation(sememe, related) or []
                    if "hypernym" in relation:
                        sememes.add(str(related))
            except Exception:
                pass

    return sorted(sememes)


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


def word_sememes_from_index(sememe_to_words: dict[str, list[str]], word: str) -> list[str]:
    return sememe_to_words.get(f"__sememes__:{word}", [])


def sememe_overlap_rank(
    word: str,
    candidates: list[str],
    sememe_to_words: dict[str, list[str]],
) -> list[tuple[str, int, float]]:
    source = set(word_sememes_from_index(sememe_to_words, word))
    if not source:
        return []

    ranked: list[tuple[str, int, float]] = []
    for candidate in candidates:
        if candidate == word:
            continue

        target = set(word_sememes_from_index(sememe_to_words, candidate))
        if not target:
            continue

        overlap = len(source & target)
        union = source | target
        ranked.append((candidate, overlap, overlap / len(union)))

    ranked.sort(key=lambda item: (-item[1], -item[2], item[0]))
    return ranked


def extract_sense_synonym_words(hownet, word: str, vocabulary: set[str]) -> list[str]:
    synonyms: list[str] = []
    seen: set[str] = set()

    try:
        senses = hownet.get_sense(word, language="zh") or []
    except Exception:
        return synonyms

    for sense in senses:
        try:
            related = hownet.get_sense_synonyms(sense) or []
        except Exception:
            continue

        for related_sense in related:
            candidate = sense_zh_word(related_sense)
            if not candidate or candidate == word or candidate not in vocabulary or candidate in seen:
                continue
            seen.add(candidate)
            synonyms.append(candidate)

    return synonyms


def build_ranked_sememe_synonyms(
    word: str,
    sememes: list[str],
    sememe_to_words: dict[str, list[str]],
    vocabulary: set[str],
) -> list[tuple[str, int, float]]:
    scores: Counter[str] = Counter()
    sememe_set = set(sememes)

    for sememe in sememes:
        for candidate in sememe_to_words.get(sememe, ()):
            if candidate != word and candidate in vocabulary:
                scores[candidate] += 1

    ranked: list[tuple[str, int, float]] = []
    for candidate, overlap in scores.items():
        candidate_sememes = set(word_sememes_from_index(sememe_to_words, candidate))
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
    sememes: list[str],
    sememe_to_words: dict[str, list[str]],
    use_nearest: bool,
) -> list[tuple[str, float]]:
    links: dict[str, float] = {}

    for candidate in extract_sense_synonym_words(hownet, word, vocabulary):
        links[candidate] = min(links.get(candidate, 99.0), WEIGHT_SYNONYM_SENSE)

    if use_nearest:
        try:
            nearest = (
                hownet.get_nearest_words(
                    word,
                    language="zh",
                    merge=True,
                    K=SYNONYM_K,
                    score=True,
                )
                or []
            )
            for item in nearest:
                if isinstance(item, tuple):
                    candidate, score = item
                else:
                    candidate, score = item, 1.0
                if candidate == word or candidate not in vocabulary:
                    continue
                weight = nearest_link_weight(float(score))
                links[candidate] = min(links.get(candidate, 99.0), weight)
        except Exception:
            pass

    for candidate, overlap, jaccard in build_ranked_sememe_synonyms(
        word,
        sememes,
        sememe_to_words,
        vocabulary,
    ):
        weight = sememe_link_weight(overlap, jaccard)
        links[candidate] = min(links.get(candidate, 99.0), weight)

    if not links:
        return []

    ranked = sememe_overlap_rank(word, list(links.keys()), sememe_to_words)
    return [(candidate, links[candidate]) for candidate, _, _ in ranked[:SYNONYM_K]]


def apply_synonym_links(cache_entry: WordKnowledge, links: list[tuple[str, float]]) -> None:
    cache_entry["synonyms"] = [word for word, _ in links]
    cache_entry["synonym_weights"] = {word: weight for word, weight in links}


def lookup_word_knowledge(hownet, word: str) -> WordKnowledge:
    sememes = extract_sememes(hownet, word)
    try:
        senses = hownet.get_sense(word, language="zh") or []
    except Exception:
        senses = []
    return {
        "sememes": sememes,
        "synonyms": [],
        "concepts": sense_concepts(senses),
    }


def _init_worker(use_nearest: bool) -> None:
    global _worker_hownet, _worker_use_nearest
    _worker_use_nearest = use_nearest
    # Sense synonyms require the similarity tables even when --with-nearest is off.
    _worker_hownet = OpenHowNet.HowNetDict(init_sim=True)


def _lookup_words_chunk(words: list[str]) -> list[tuple[str, WordKnowledge]]:
    assert _worker_hownet is not None
    return [(word, lookup_word_knowledge(_worker_hownet, word)) for word in words]


def _synonyms_for_chunk(
    payload: tuple[list[str], dict[str, list[str]], list[str], bool],
) -> list[tuple[str, list[tuple[str, float]]]]:
    words, sememe_to_words, vocabulary_list, use_nearest = payload
    vocabulary = set(vocabulary_list)
    assert _worker_hownet is not None
    results: list[tuple[str, list[tuple[str, float]]]] = []
    for word in words:
        sememes = sememe_to_words.get(f"__sememes__:{word}")
        if sememes is None:
            continue
        results.append(
            (
                word,
                extract_synonym_links(
                    _worker_hownet,
                    word,
                    vocabulary,
                    sememes,
                    sememe_to_words,
                    use_nearest,
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
        edges.append({"a": source, "b": target_node, "w": weight})
    return edges


def chunk_words(words: list[str], chunk_size: int) -> list[list[str]]:
    return [words[index : index + chunk_size] for index in range(0, len(words), chunk_size)]


def default_workers(use_nearest: bool, requested: int | None) -> int:
    if requested is not None:
        return max(1, requested)
    if use_nearest:
        return max(1, min(8, CPU_COUNT))
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


def build_word_cache_parallel(
    words: list[str],
    vocabulary: set[str],
    use_nearest: bool,
    workers: int,
    chunk_size: int,
) -> dict[str, WordKnowledge]:
    chunks = chunk_words(words, chunk_size)
    cache: dict[str, WordKnowledge] = {}

    print(f"  Lookup pass: {len(words)} words, {len(chunks)} chunks, {workers} workers", file=sys.stderr)
    with ProcessPoolExecutor(
        max_workers=workers,
        initializer=_init_worker,
        initargs=(use_nearest,),
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

        sememe_to_words: dict[str, list[str]] = {}
        for word, knowledge in cache.items():
            sememe_to_words[f"__sememes__:{word}"] = knowledge["sememes"]
            for sememe in knowledge["sememes"]:
                sememe_to_words.setdefault(sememe, []).append(word)

        synonym_chunks = [
            (chunk, sememe_to_words, list(vocabulary), use_nearest) for chunk in chunks
        ]
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
    use_nearest: bool,
) -> dict[str, WordKnowledge]:
    cache: dict[str, WordKnowledge] = {}
    sememe_to_words: dict[str, list[str]] = {}
    total = len(words)

    for index, word in enumerate(words, start=1):
        if index % 500 == 0 or index == total:
            print(f"  OpenHowNet lookup {index}/{total} ({word})", file=sys.stderr)

        knowledge = lookup_word_knowledge(hownet, word)
        cache[word] = knowledge
        for sememe in knowledge["sememes"]:
            sememe_to_words.setdefault(sememe, []).append(word)

    for word in words:
        apply_synonym_links(
            cache[word],
            extract_synonym_links(
                hownet,
                word,
                vocabulary,
                cache[word]["sememes"],
                sememe_to_words,
                use_nearest,
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
        all_sememes.update(knowledge["sememes"])
        for sememe in knowledge["sememes"]:
            node = sememe_node(sememe)
            edges.append({"a": word, "b": node, "w": WEIGHT_SEMEME})
        for concept in knowledge["concepts"]:
            node = concept_node(concept)
            edges.append({"a": word, "b": node, "w": WEIGHT_SEMEME})
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
        initializer=_init_worker,
        initargs=(False,),
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
    return {"edges": edges}


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare OpenHowNet cache and semantic graph.")
    parser.add_argument("--words", type=Path, default=DEFAULT_WORDS_PATH)
    parser.add_argument("--cache-output", type=Path, default=DEFAULT_CACHE_PATH)
    parser.add_argument("--graph-output", type=Path, default=DEFAULT_GRAPH_PATH)
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N vocabulary words.")
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
        "--with-nearest",
        action="store_true",
        help=(
            "Also merge OpenHowNet nearest-word neighbors into synonym edges "
            "(slower; sense synonyms are always included)."
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help=f"Parallel worker processes (default: {CPU_COUNT}, or 8 with --with-nearest).",
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

    workers = default_workers(args.with_nearest, args.workers)
    started = time.perf_counter()

    print("Downloading OpenHowNet resources if needed...")
    OpenHowNet.download()

    words = load_vocabulary(args.words, args.limit, args.content_only and not args.all_tokens)
    vocabulary = set(words)
    print(
        f"Building word cache for {len(words)} words "
        f"({'serial' if args.serial else f'{workers} workers, chunk={args.chunk_size}'})..."
    )

    if args.serial:
        print("Initializing OpenHowNet (with similarity tables for sense synonyms)...")
        hownet = OpenHowNet.HowNetDict(init_sim=True)
        word_cache = build_word_cache_serial(hownet, words, vocabulary, args.with_nearest)
        print("Building semantic graph...")
        edges = collect_graph_edges(words, word_cache, vocabulary, workers=1)
    else:
        word_cache = build_word_cache_parallel(
            words,
            vocabulary,
            args.with_nearest,
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

    args.cache_output.write_text(json.dumps(word_cache, ensure_ascii=False), encoding="utf-8")
    args.graph_output.write_text(json.dumps(export_graph(edges), ensure_ascii=False), encoding="utf-8")

    elapsed = time.perf_counter() - started
    print(
        f"Wrote {len(word_cache)} word entries to {args.cache_output} "
        f"and {len(edges)} edges ({len(nodes)} nodes) to {args.graph_output} "
        f"in {elapsed:.1f}s."
    )


if __name__ == "__main__":
    main()
