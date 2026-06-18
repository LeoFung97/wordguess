"""Pure sense/domain heuristics shared by the build script and offline tests."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Literal, TypedDict

SCHEMA_VERSION = 2

WEIGHT_SYNONYM_SENSE = 0.65
WEIGHT_SYNONYM_SENSE_FIGURATIVE = 1.35
WEIGHT_SYNONYM_WEAK = 1.75

UsageBias = Literal["literal", "figurative", "mixed", "unknown"]
SemanticDomain = Literal[
    "weather/climate",
    "geography/nature",
    "politics/society",
    "economy/business",
    "psychology/cognition",
    "body/health",
    "emotion",
    "action/motion",
    "abstract/general",
]

DOMAIN_PATTERNS: list[tuple[SemanticDomain, tuple[str, ...]]] = [
    (
        "weather/climate",
        (
            "weather|天象",
            "Temperature|温度",
            "wind|风",
            "rain|雨",
            "snow|雪",
            "cloud|云",
            "cold|冷",
            "hot|热",
            "WarmUp|加热",
        ),
    ),
    (
        "geography/nature",
        (
            "earth|大地",
            "mountain|山",
            "water|水",
            "place|地方",
            "natural|天然",
            "Environment|情况",
            "LandVehicle|车",
            "plant|植物",
            "animal|兽",
        ),
    ),
    (
        "politics/society",
        (
            "politics|政治",
            "country|国家",
            "society|社会",
            "government|政府",
            "law|法律",
            "army|军队",
        ),
    ),
    (
        "economy/business",
        (
            "economy|经济",
            "money|钱",
            "business|商业",
            "trade|贸易",
            "market|市场",
        ),
    ),
    (
        "psychology/cognition",
        (
            "knowledge|知识",
            "think|思考",
            "psychology|心理",
            "experience|感受",
            "perception|感知",
            "conscious|意识",
        ),
    ),
    (
        "body/health",
        (
            "body|身体",
            "health|健康",
            "disease|疾病",
            "human|人",
            "organ|器官",
        ),
    ),
    (
        "emotion",
        (
            "emotion|情感",
            "mood|心情",
            "feel|感觉",
            "desire|欲望",
        ),
    ),
    (
        "action/motion",
        (
            "act|动",
            "move|移动",
            "action|行为",
            "cook|烹调",
            "press|按压",
        ),
    ),
]

ABSTRACT_SEMEMES: frozenset[str] = frozenset(
    {
        "thing|万物",
        "event|事件",
        "entity|实体",
        "Circumstances|境况",
        "Form|形状",
        "phenomena|现象",
        "fact|事情",
        "process|过程",
        "part|部件",
        "Occasion|场面",
        "affairs|事务",
        "group|群体",
        "tool|用具",
        "FuncWord|功能词",
        "DeChinese|构助",
        "AimAt|定向",
    }
)

FIGURATIVE_MARKER_SEMEMES: frozenset[str] = frozenset(
    {
        "Circumstances|境况",
        "Occasion|场面",
        "Form|形状",
        "phenomena|现象",
        "affairs|事务",
    }
)


class WordKnowledge(TypedDict, total=False):
    sememes: list[str]
    core_sememes: list[str]
    expanded_sememes: list[str]
    domain: str
    usage_bias: str
    sense_count: int
    synonyms: list[str]
    concepts: list[str]
    synonym_weights: dict[str, float]


@dataclass
class SenseProfile:
    sense_id: str
    core_sememes: list[str] = field(default_factory=list)
    expanded_sememes: list[str] = field(default_factory=list)
    domain: SemanticDomain = "abstract/general"
    usage_bias: UsageBias = "unknown"


def sememe_domains(sememe: str) -> list[SemanticDomain]:
    matched: list[SemanticDomain] = []
    for domain, patterns in DOMAIN_PATTERNS:
        if sememe in patterns or any(pattern.split("|")[0] in sememe for pattern in patterns):
            matched.append(domain)
    if not matched and sememe in ABSTRACT_SEMEMES:
        matched.append("abstract/general")
    return matched


def classify_sense_domain(core_sememes: list[str]) -> SemanticDomain:
    if not core_sememes:
        return "abstract/general"

    domain_counts: Counter[SemanticDomain] = Counter()
    for sememe in core_sememes:
        for domain in sememe_domains(sememe):
            domain_counts[domain] += 1

    if not domain_counts:
        return "abstract/general"

    non_abstract = [(domain, count) for domain, count in domain_counts.items() if domain != "abstract/general"]
    if non_abstract:
        return max(non_abstract, key=lambda item: item[1])[0]
    return "abstract/general"


def classify_usage_bias(core_sememes: list[str], domain: SemanticDomain) -> UsageBias:
    if not core_sememes:
        return "unknown"

    concrete = [sememe for sememe in core_sememes if sememe not in ABSTRACT_SEMEMES]
    figurative_markers = [sememe for sememe in core_sememes if sememe in FIGURATIVE_MARKER_SEMEMES]

    if concrete and not figurative_markers:
        return "literal"
    if figurative_markers and not concrete:
        return "figurative"
    if concrete and figurative_markers:
        return "mixed"
    if domain != "abstract/general":
        return "literal"
    return "unknown"


def is_abstract_sememe(sememe: str) -> bool:
    return sememe in ABSTRACT_SEMEMES


def score_sense_profile(profile: SenseProfile) -> float:
    score = len(profile.core_sememes) * 2.0
    if profile.domain != "abstract/general":
        score += 6.0
    if profile.usage_bias == "literal":
        score += 2.0
    elif profile.usage_bias == "figurative":
        score -= 1.0

    if profile.core_sememes:
        abstract_ratio = sum(1 for sememe in profile.core_sememes if is_abstract_sememe(sememe)) / len(
            profile.core_sememes
        )
        score -= abstract_ratio * 4.0

    return score


def pick_dominant_sense(profiles: list[SenseProfile]) -> SenseProfile | None:
    if not profiles:
        return None
    return max(profiles, key=lambda profile: (score_sense_profile(profile), -profiles.index(profile)))


def aggregate_usage_bias(profiles: list[SenseProfile]) -> UsageBias:
    if not profiles:
        return "unknown"

    biases = {profile.usage_bias for profile in profiles if profile.usage_bias != "unknown"}
    if not biases:
        return "unknown"
    if len(biases) == 1:
        return next(iter(biases))
    return "mixed"


def word_metadata(entry: WordKnowledge) -> tuple[str, UsageBias, list[str], int]:
    domain = entry.get("domain", "abstract/general")
    usage_bias = entry.get("usage_bias", "unknown")
    core = entry.get("core_sememes") or entry.get("sememes") or []
    sense_count = int(entry.get("sense_count") or 1)
    return domain, usage_bias, core, sense_count


def adjust_synonym_weight(
    base_weight: float,
    source_entry: WordKnowledge,
    candidate_entry: WordKnowledge | None,
    source_profile: SenseProfile | None = None,
) -> float:
    weight = base_weight
    source_domain, source_bias, source_core, _ = word_metadata(source_entry)
    candidate_domain, candidate_bias, candidate_core, candidate_senses = word_metadata(candidate_entry or {})

    if source_profile is not None:
        source_domain = source_profile.domain
        source_bias = source_profile.usage_bias

    if source_domain == candidate_domain and source_domain != "abstract/general":
        weight *= 0.88
    elif (
        source_domain != candidate_domain
        and source_domain != "abstract/general"
        and candidate_domain != "abstract/general"
    ):
        weight *= 1.28

    if source_bias in ("literal", "mixed") and candidate_bias == "figurative":
        if source_domain != candidate_domain:
            weight *= 1.22
        elif source_bias == "literal":
            weight *= 1.12

    if source_profile is not None and source_profile.usage_bias == "figurative":
        weight = max(weight, WEIGHT_SYNONYM_SENSE_FIGURATIVE)

    if candidate_senses >= 3:
        overlap = len(set(source_core) & set(candidate_core))
        if overlap <= 1:
            weight *= 1.15

    return min(weight, WEIGHT_SYNONYM_WEAK)


def export_cache(cache: dict[str, WordKnowledge]) -> dict[str, WordKnowledge | dict[str, int]]:
    payload: dict[str, WordKnowledge | dict[str, int]] = dict(cache)
    payload["__meta__"] = {"schema_version": SCHEMA_VERSION}
    return payload
