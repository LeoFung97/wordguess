#!/usr/bin/env python3
"""Lightweight tests for sense-aware semantic preparation helpers (no OpenHowNet required)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from semantic_sense_heuristics import (  # noqa: E402
    SCHEMA_VERSION,
    SenseProfile,
    WEIGHT_SYNONYM_SENSE,
    adjust_synonym_weight,
    classify_sense_domain,
    classify_usage_bias,
    export_cache,
    pick_dominant_sense,
)


def test_domain_classification() -> None:
    assert classify_sense_domain(["weather|天象"]) == "weather/climate"
    assert classify_sense_domain(["Circumstances|境况", "event|事件"]) == "abstract/general"
    assert classify_usage_bias(["weather|天象"], "weather/climate") == "literal"
    assert classify_usage_bias(["Circumstances|境况"], "abstract/general") == "figurative"


def test_dominant_sense_prefers_concrete_domain() -> None:
    profiles = [
        SenseProfile(
            sense_id="1",
            core_sememes=["weather|天象"],
            expanded_sememes=[],
            domain="weather/climate",
            usage_bias="literal",
        ),
        SenseProfile(
            sense_id="2",
            core_sememes=["Circumstances|境况", "event|事件"],
            expanded_sememes=["thing|万物"],
            domain="abstract/general",
            usage_bias="figurative",
        ),
    ]
    dominant = pick_dominant_sense(profiles)
    assert dominant is not None
    assert dominant.domain == "weather/climate"


def test_synonym_weight_penalizes_cross_domain_figurative() -> None:
    source = {
        "domain": "weather/climate",
        "usage_bias": "mixed",
        "core_sememes": ["weather|天象"],
        "sememes": ["weather|天象"],
        "sense_count": 2,
    }
    figurative = {
        "domain": "abstract/general",
        "usage_bias": "figurative",
        "core_sememes": ["Circumstances|境况"],
        "sememes": ["Circumstances|境况"],
        "sense_count": 1,
    }
    literal = {
        "domain": "weather/climate",
        "usage_bias": "literal",
        "core_sememes": ["weather|天象"],
        "sememes": ["weather|天象"],
        "sense_count": 1,
    }

    cross = adjust_synonym_weight(WEIGHT_SYNONYM_SENSE, source, figurative)
    same = adjust_synonym_weight(WEIGHT_SYNONYM_SENSE, source, literal)
    assert cross > same


def test_cache_schema_meta_and_backward_compat() -> None:
    cache = export_cache(
        {
            "气候": {
                "sememes": ["weather|天象"],
                "core_sememes": ["weather|天象"],
                "expanded_sememes": [],
                "domain": "weather/climate",
                "usage_bias": "mixed",
                "sense_count": 2,
                "synonyms": [],
                "concepts": [],
            }
        }
    )
    assert "__meta__" in cache
    assert cache["__meta__"]["schema_version"] == SCHEMA_VERSION
    assert cache["气候"]["domain"] == "weather/climate"


def test_existing_cache_still_parses() -> None:
    cache_path = ROOT / "data" / "semantic-word-cache.json"
    if not cache_path.exists():
        return

    raw = json.loads(cache_path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "words" in raw:
        entries = raw["words"]
    else:
        entries = {key: value for key, value in raw.items() if key != "__meta__"}

    sample = entries.get("气候") or next(iter(entries.values()))
    assert "sememes" in sample
    assert isinstance(sample["sememes"], list)


def main() -> None:
    test_domain_classification()
    test_dominant_sense_prefers_concrete_domain()
    test_synonym_weight_penalizes_cross_domain_figurative()
    test_cache_schema_meta_and_backward_compat()
    test_existing_cache_still_parses()
    print("prepare-semantic-knowledge helper tests passed")


if __name__ == "__main__":
    main()
