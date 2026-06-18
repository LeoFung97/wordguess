import { describe, expect, it } from "vitest";
import {
  computeCosineOnlyDisplayScore,
  computeHybridFeatures,
  computeHybridRawScore,
  normalizeEmbedScore,
} from "./hybrid-scorer";
import { buildTargetDisplayCalibration, mapCalibratedDisplayScore } from "./scoring";
import { SemanticKnowledgeStore } from "./semantic-knowledge";
import { cosineSimilarity, VectorStore } from "./vector-store";

function createFishBirdKnowledge() {
  const wordCache = new Map([
    [
      "鲤鱼",
      {
        sememes: ["fish|鱼"],
        core_sememes: ["fish|鱼"],
        expanded_sememes: [],
        domain: "geography/nature",
        usage_bias: "literal",
        sense_count: 1,
        synonyms: ["金鱼", "三文鱼"],
        concepts: ["sense|carp|鲤鱼"],
      },
    ],
    [
      "金鱼",
      {
        sememes: ["fish|鱼", "recreation|娱乐"],
        core_sememes: ["fish|鱼", "recreation|娱乐"],
        expanded_sememes: [],
        domain: "geography/nature",
        usage_bias: "literal",
        sense_count: 1,
        synonyms: ["鲤鱼"],
        concepts: ["sense|goldfish|金鱼"],
      },
    ],
    [
      "鸟",
      {
        sememes: ["bird|禽"],
        core_sememes: ["bird|禽"],
        expanded_sememes: [],
        domain: "geography/nature",
        usage_bias: "literal",
        sense_count: 1,
        synonyms: ["麻雀"],
        concepts: ["sense|bird|鸟"],
      },
    ],
    [
      "麻雀",
      {
        sememes: ["bird|禽"],
        core_sememes: ["bird|禽"],
        expanded_sememes: [],
        domain: "geography/nature",
        usage_bias: "literal",
        sense_count: 1,
        synonyms: ["鸟"],
        concepts: ["sense|sparrow|麻雀"],
      },
    ],
  ]);

  const adjacency = new Map<string, Array<{ node: string; weight: number }>>([
    ["鲤鱼", [{ node: "sememe:fish|鱼", weight: 1.5 }]],
    ["金鱼", [{ node: "sememe:fish|鱼", weight: 1.5 }]],
    ["鸟", [{ node: "sememe:bird|禽", weight: 1.5 }]],
    ["麻雀", [{ node: "sememe:bird|禽", weight: 1.5 }]],
    ["sememe:fish|鱼", [
      { node: "鲤鱼", weight: 1.5 },
      { node: "金鱼", weight: 1.5 },
      { node: "sememe:animal|兽", weight: 2.5 },
    ]],
    ["sememe:bird|禽", [
      { node: "鸟", weight: 1.5 },
      { node: "麻雀", weight: 1.5 },
      { node: "sememe:animal|兽", weight: 2.5 },
    ]],
    ["sememe:animal|兽", [
      { node: "sememe:fish|鱼", weight: 2.5 },
      { node: "sememe:bird|禽", weight: 2.5 },
    ]],
  ]);

  adjacency.get("鲤鱼")!.push({ node: "金鱼", weight: 1.0 });
  adjacency.get("金鱼")!.push({ node: "鲤鱼", weight: 1.0 });

  return new SemanticKnowledgeStore(wordCache, adjacency);
}

describe("hybrid semantic scoring", () => {
  const knowledge = createFishBirdKnowledge();

  const fishStore = new VectorStore(
    [
      { word: "鲤鱼", commonness: 10, vector: [1, 0, 0] },
      { word: "金鱼", commonness: 9, vector: [0.95, 0.05, 0] },
      { word: "鸟", commonness: 8, vector: [0.9, 0.1, 0] },
      { word: "麻雀", commonness: 7, vector: [0.88, 0.12, 0] },
    ],
    ["鲤鱼"],
    { vectorsAreNormalized: true, knowledge },
  );

  it("normalizes embedding cosine to 0..1", () => {
    expect(normalizeEmbedScore(0.82)).toBeCloseTo(0.82);
    expect(normalizeEmbedScore(-0.2)).toBe(0);
  });

  it("boosts near-synonym fish over bird when embeddings are equally broad", () => {
    const target = fishStore.get("鲤鱼")!;
    const goldfishCos = cosineSimilarity(target.vector, fishStore.get("金鱼")!.vector);
    const birdCos = cosineSimilarity(target.vector, fishStore.get("鸟")!.vector);

    expect(birdCos).toBeGreaterThan(0.85);
    expect(goldfishCos).toBeGreaterThan(birdCos);

    const goldfishHybrid = computeHybridRawScore("鲤鱼", "金鱼", goldfishCos, knowledge);
    const birdHybrid = computeHybridRawScore("鲤鱼", "鸟", birdCos, knowledge);

    expect(goldfishHybrid).toBeGreaterThan(birdHybrid);

    const goldfish = fishStore.rankAgainstTarget("鲤鱼", "金鱼");
    const bird = fishStore.rankAgainstTarget("鲤鱼", "鸟");

    expect(goldfish).toBeDefined();
    expect(bird).toBeDefined();
    expect(goldfish!.rank).toBeLessThan(bird!.rank);
    expect(goldfish!.proximity).toBeGreaterThan(bird!.proximity);

    const goldfishCosineOnly = computeCosineOnlyDisplayScore(goldfishCos);
    const birdCosineOnly = computeCosineOnlyDisplayScore(birdCos);
    expect(goldfish!.proximity - bird!.proximity).toBeGreaterThan(goldfishCosineOnly - birdCosineOnly);
  });

  it("exposes individual knowledge features with safe zero fallbacks", () => {
    const features = computeHybridFeatures("鲤鱼", "金鱼", 0.9, knowledge);

    expect(features.embedScore).toBeCloseTo(0.9);
    expect(features.sememeScore).toBeGreaterThan(0);
    expect(features.synonymScore).toBe(1);
    expect(features.graphScore).toBeGreaterThan(0);

    const missing = computeHybridFeatures("鲤鱼", "不存在", 0.5, knowledge);
    expect(missing.sememeScore).toBe(0);
    expect(missing.synonymScore).toBe(0);
    expect(missing.graphScore).toBe(0);
    expect(missing.rawHybrid).toBeCloseTo(0.75 * 0.5);
  });

  it("ranks guesses by hybrid score in VectorStore", () => {
    const goldfish = fishStore.rankAgainstTarget("鲤鱼", "金鱼");
    const bird = fishStore.rankAgainstTarget("鲤鱼", "鸟");

    expect(goldfish).toBeDefined();
    expect(bird).toBeDefined();
    expect(goldfish!.rank).toBeLessThan(bird!.rank);
    expect(goldfish!.proximity).toBeGreaterThan(bird!.proximity);
  });

  it("maps calibrated display score to player-facing heat", () => {
    const scored = [
      { word: "目标", rawHybrid: 1 },
      { word: "近", rawHybrid: 0.9 },
      { word: "远", rawHybrid: 0.1 },
    ];
    const calibration = buildTargetDisplayCalibration(scored, "目标");

    expect(mapCalibratedDisplayScore(1, calibration, true)).toBe(100);
    expect(mapCalibratedDisplayScore(0.9, calibration)).toBeGreaterThan(0);
    expect(mapCalibratedDisplayScore(0.1, calibration)).toBe(0);
  });
});
