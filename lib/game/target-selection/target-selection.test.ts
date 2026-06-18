import { describe, expect, it } from "vitest";
import { mergeTargetSelectionConfig } from "./config";
import { loadEmbeddingIndex } from "./embedding-index";
import {
  applyHardFilters,
  guessPosHeuristic,
  isSimplifiedChinese,
  isTwoCharChinese,
  scorePlayability,
} from "./heuristics";
import { runTargetSelectionPipeline } from "./pipeline";
import { scoreSemanticQuality } from "./semantic-quality";

const toSimplified = (word: string) => word;

describe("target-selection heuristics", () => {
  it("detects two-character Chinese words", () => {
    expect(isTwoCharChinese("天气")).toBe(true);
    expect(isTwoCharChinese("的")).toBe(false);
    expect(isTwoCharChinese("三个")).toBe(true);
    expect(isTwoCharChinese("为什么")).toBe(false);
  });

  it("filters function words and pronouns", () => {
    const config = mergeTargetSelectionConfig();
    const base = {
      inVocab: true,
      inEmbedding: true,
      isSimplified: true,
      toSimplified,
    };

    expect(applyHardFilters("什么", 100, config, base).pass).toBe(false);
    expect(applyHardFilters("因为", 100, config, base).pass).toBe(false);
    expect(applyHardFilters("我们", 100, config, base).pass).toBe(false);
    expect(applyHardFilters("北京", 100, config, base).pass).toBe(false);
  });

  it("prefers content words over function words in playability", () => {
    const weather = scorePlayability("天气", 1200, guessPosHeuristic("天气"), {
      domain: "weather/climate",
      usage_bias: "literal",
      sense_count: 1,
    });
    const pronoun = scorePlayability("我们", 1200, "pronoun");

    expect(weather).toBeGreaterThan(pronoun);
  });
});

describe("target-selection pipeline", () => {
  it("ranks common playable words above blocked terms", () => {
    const frequencyEntries = [
      { word: "什么", frequency: 1_000_000 },
      { word: "天气", frequency: 45_000 },
      { word: "感觉", frequency: 200_000 },
      { word: "电脑", frequency: 28_000 },
      { word: "公司", frequency: 120_000 },
    ];

    const vocabulary = new Map(
      frequencyEntries.map((entry) => [entry.word, { commonness: entry.frequency }]),
    );

    const embeddingIndex = {
      words: frequencyEntries.map((entry) => entry.word),
      vectors: new Float32Array(frequencyEntries.length * 4),
      wordToIndex: new Map(frequencyEntries.map((entry, index) => [entry.word, index])),
      vectorLength: 4,
    };

    frequencyEntries.forEach((entry, index) => {
      const start = index * 4;
      embeddingIndex.vectors[start] = 1;
      embeddingIndex.vectors[start + 1] = index * 0.1;
      embeddingIndex.vectors[start + 2] = 0;
      embeddingIndex.vectors[start + 3] = 0;
    });

    const result = runTargetSelectionPipeline({
      frequencyEntries,
      vocabulary,
      embeddingIndex,
      semanticKnowledge: new Map([
        [
          "天气",
          {
            domain: "weather/climate",
            usage_bias: "literal",
            sense_count: 1,
            synonyms: ["气候", "气温", "阴晴", "风力"],
          },
        ],
        [
          "感觉",
          {
            domain: "psychology/cognition",
            usage_bias: "literal",
            sense_count: 2,
            synonyms: ["感受", "觉得", "体会", "感知"],
          },
        ],
      ]),
      toSimplified,
      config: {
        minFrequencyRank: 1,
        maxFrequencyRank: 100_000,
        minPlayability: 0.35,
        minSemanticQuality: 0.3,
        minFinalScore: 0.35,
        outputLimit: 10,
      },
    });

    const keptWords = result.ranked.map((entry) => entry.word);
    expect(keptWords).toContain("天气");
    expect(keptWords).toContain("感觉");
    expect(keptWords).not.toContain("什么");
    expect(keptWords).not.toContain("公司");
    expect(result.ranked[0]?.word).toBe("感觉");
  });
});

describe("semantic quality", () => {
  it("uses synonym cache when available", () => {
    const embeddingIndex = loadEmbeddingIndex(
      process.cwd() + "/data/words.json",
      process.cwd() + "/data/vectors.f32",
    );

    const cached = scoreSemanticQuality("天气", embeddingIndex, {
      domain: "weather/climate",
      usage_bias: "literal",
      sense_count: 1,
      synonyms: ["气候", "气温", "风力", "阴晴", "降水"],
    }, {
      neighborCount: 12,
      minNeighborSimilarity: 0.45,
      pos: "noun",
      preferCache: true,
    });

    expect(cached.score).toBeGreaterThan(0.5);
    expect(cached.topNeighbors.length).toBeGreaterThan(0);
  });
});

describe("simplified check", () => {
  it("treats identical conversion as simplified", () => {
    expect(isSimplifiedChinese("网络", toSimplified)).toBe(true);
  });
});
