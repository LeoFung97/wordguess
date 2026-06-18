import { describe, expect, it } from "vitest";
import { computeHybridRawScore, HYBRID_WEIGHTS } from "./hybrid-scorer";
import {
  domainAlignmentScore,
  explainHybridScore,
  jaccardOverlap,
  SemanticKnowledgeStore,
  type WordKnowledge,
} from "./semantic-knowledge";
import { cosineSimilarity, VectorStore } from "./vector-store";

function createFishBirdKnowledge() {
  const wordCache = new Map<string, WordKnowledge>([
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
    ["鲤鱼", [{ node: "sememe:fish|鱼", weight: 1.2 }]],
    ["金鱼", [{ node: "sememe:fish|鱼", weight: 1.2 }]],
    ["鸟", [{ node: "sememe:bird|禽", weight: 1.2 }]],
    ["麻雀", [{ node: "sememe:bird|禽", weight: 1.2 }]],
    [
      "sememe:fish|鱼",
      [
        { node: "鲤鱼", weight: 1.2 },
        { node: "金鱼", weight: 1.2 },
        { node: "sememe:animal|兽", weight: 3.0 },
      ],
    ],
    [
      "sememe:bird|禽",
      [
        { node: "鸟", weight: 1.2 },
        { node: "麻雀", weight: 1.2 },
        { node: "sememe:animal|兽", weight: 3.0 },
      ],
    ],
    [
      "sememe:animal|兽",
      [
        { node: "sememe:fish|鱼", weight: 3.0 },
        { node: "sememe:bird|禽", weight: 3.0 },
      ],
    ],
  ]);

  adjacency.get("鲤鱼")!.push({ node: "金鱼", weight: 1.0 });
  adjacency.get("金鱼")!.push({ node: "鲤鱼", weight: 1.0 });

  return new SemanticKnowledgeStore(wordCache, adjacency);
}

function createClimatePolysemyKnowledge() {
  const wordCache = new Map<string, WordKnowledge>([
    [
      "气候",
      {
        sememes: ["weather|天象", "Circumstances|境况", "event|事件", "thing|万物"],
        core_sememes: ["weather|天象"],
        expanded_sememes: ["Circumstances|境况", "event|事件", "thing|万物"],
        domain: "weather/climate",
        usage_bias: "mixed",
        sense_count: 2,
        synonyms: ["天气", "季风", "形势", "局面"],
        concepts: ["000000174845", "000000174846"],
      },
    ],
    [
      "天气",
      {
        sememes: ["weather|天象"],
        core_sememes: ["weather|天象"],
        expanded_sememes: [],
        domain: "weather/climate",
        usage_bias: "literal",
        sense_count: 1,
        synonyms: ["气候", "气温"],
        concepts: ["000000095028"],
      },
    ],
    [
      "季风",
      {
        sememes: ["wind|风"],
        core_sememes: ["wind|风"],
        expanded_sememes: [],
        domain: "weather/climate",
        usage_bias: "literal",
        sense_count: 1,
        synonyms: ["气候"],
        concepts: ["000000101078"],
      },
    ],
    [
      "形势",
      {
        sememes: ["Circumstances|境况", "Form|形状", "event|事件", "thing|万物"],
        core_sememes: ["Circumstances|境况", "event|事件"],
        expanded_sememes: ["Form|形状", "thing|万物"],
        domain: "abstract/general",
        usage_bias: "figurative",
        sense_count: 1,
        synonyms: ["局面", "气候"],
        concepts: ["000000125112"],
      },
    ],
    [
      "局面",
      {
        sememes: ["Circumstances|境况", "affairs|事务", "event|事件"],
        core_sememes: ["Circumstances|境况", "affairs|事务"],
        expanded_sememes: ["event|事件"],
        domain: "abstract/general",
        usage_bias: "figurative",
        sense_count: 1,
        synonyms: ["形势"],
        concepts: ["000000109667"],
      },
    ],
  ]);

  const adjacency = new Map<string, Array<{ node: string; weight: number }>>([
    ["气候", [
      { node: "sememe:weather|天象", weight: 1.2 },
      { node: "sememe:Circumstances|境况", weight: 2.8 },
      { node: "天气", weight: 0.65 },
      { node: "形势", weight: 1.35 },
    ]],
    ["天气", [
      { node: "sememe:weather|天象", weight: 1.2 },
      { node: "气候", weight: 0.65 },
    ]],
    ["季风", [{ node: "sememe:wind|风", weight: 1.2 }]],
    ["形势", [
      { node: "sememe:Circumstances|境况", weight: 1.6 },
      { node: "气候", weight: 1.35 },
    ]],
    ["局面", [{ node: "sememe:Circumstances|境况", weight: 1.6 }]],
    ["sememe:weather|天象", [
      { node: "气候", weight: 1.2 },
      { node: "天气", weight: 1.2 },
    ]],
    ["sememe:wind|风", [{ node: "季风", weight: 1.2 }]],
    ["sememe:Circumstances|境况", [
      { node: "气候", weight: 2.8 },
      { node: "形势", weight: 1.6 },
      { node: "局面", weight: 1.6 },
    ]],
  ]);

  return new SemanticKnowledgeStore(wordCache, adjacency);
}

describe("semantic knowledge store", () => {
  it("loads legacy flat cache entries without metadata fields", () => {
    const store = new SemanticKnowledgeStore(
      new Map([
        [
          "词",
          {
            sememes: ["a|甲", "b|乙"],
            synonyms: [],
            concepts: [],
          },
        ],
      ]),
      new Map(),
    );

    const knowledge = store.getWordKnowledge("词");
    expect(knowledge.core_sememes).toEqual(["a|甲", "b|乙"]);
    expect(knowledge.domain).toBe("abstract/general");
    expect(knowledge.usage_bias).toBe("unknown");
  });

  it("boosts same-domain alignment and penalizes cross-domain pairs", () => {
    expect(domainAlignmentScore("weather/climate", "weather/climate")).toBeGreaterThan(1);
    expect(domainAlignmentScore("weather/climate", "abstract/general")).toBeLessThan(1);
    expect(domainAlignmentScore("weather/climate", "politics/society")).toBeLessThan(1);
  });

  it("keeps graph and knowledge features bounded relative to embedding weight", () => {
    const knowledge = createFishBirdKnowledge();
    const features = knowledge.knowledgeScores(knowledge.createTargetContext("鲤鱼"), "鸟");

    const maxKnowledgeContribution =
      HYBRID_WEIGHTS.sememe * features.sememeScore +
      HYBRID_WEIGHTS.synonym * features.synonymScore +
      HYBRID_WEIGHTS.concept * features.conceptScore +
      HYBRID_WEIGHTS.graph * features.graphScore;

    expect(maxKnowledgeContribution).toBeLessThan(HYBRID_WEIGHTS.embed);
  });

  it("explains hybrid score components for debugging", () => {
    const knowledge = createClimatePolysemyKnowledge();
    const explanation = explainHybridScore("气候", "天气", 0.82, knowledge);

    expect(explanation.rawKnowledge.sememeScore).toBeGreaterThan(0);
    expect(explanation.weightedContributions.embed).toBeCloseTo(0.75 * 0.82);
    expect(explanation.rawHybrid).toBeGreaterThan(0);
  });
});

describe("polysemy-sensitive ranking", () => {
  const knowledge = createClimatePolysemyKnowledge();

  const climateStore = new VectorStore(
    [
      { word: "气候", commonness: 10, vector: [1, 0, 0] },
      { word: "天气", commonness: 9, vector: [0.96, 0.04, 0] },
      { word: "季风", commonness: 8, vector: [0.94, 0.06, 0] },
      { word: "形势", commonness: 7, vector: [0.88, 0.12, 0] },
      { word: "局面", commonness: 6, vector: [0.93, 0.07, 0] },
    ],
    ["气候"],
    { vectorsAreNormalized: true, knowledge },
  );

  it("ranks literal weather neighbors above figurative situation neighbors for 气候", () => {
    const weatherCos = cosineSimilarity(climateStore.get("气候")!.vector, climateStore.get("天气")!.vector);
    const monsoonCos = cosineSimilarity(climateStore.get("气候")!.vector, climateStore.get("季风")!.vector);
    const situationCos = cosineSimilarity(climateStore.get("气候")!.vector, climateStore.get("形势")!.vector);

    const weatherHybrid = computeHybridRawScore("气候", "天气", weatherCos, knowledge);
    const monsoonHybrid = computeHybridRawScore("气候", "季风", monsoonCos, knowledge);
    const situationHybrid = computeHybridRawScore("气候", "形势", situationCos, knowledge);

    expect(weatherHybrid).toBeGreaterThan(situationHybrid);
    expect(monsoonHybrid).toBeGreaterThan(situationHybrid);

    const weatherRank = climateStore.rankAgainstTarget("气候", "天气");
    const situationRank = climateStore.rankAgainstTarget("气候", "形势");

    expect(weatherRank).toBeDefined();
    expect(situationRank).toBeDefined();
    expect(weatherRank!.rank).toBeLessThan(situationRank!.rank);
  });

  it("uses core sememe overlap more than expanded abstract overlap", () => {
    expect(jaccardOverlap(["weather|天象"], ["weather|天象"])).toBe(1);
    expect(
      jaccardOverlap(["Circumstances|境况", "event|事件"], ["weather|天象"]),
    ).toBe(0);
  });
});

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

    expect(goldfish!.rank).toBeLessThan(bird!.rank);
    expect(goldfish!.proximity).toBeGreaterThan(bird!.proximity);
  });

  it("exposes individual knowledge features with safe zero fallbacks", () => {
    const features = computeHybridRawScore("鲤鱼", "金鱼", 0.9, knowledge);
    expect(features).toBeGreaterThan(0);

    const missing = computeHybridRawScore("鲤鱼", "不存在", 0.5, knowledge);
    expect(missing).toBeCloseTo(0.75 * 0.5);
  });
});
