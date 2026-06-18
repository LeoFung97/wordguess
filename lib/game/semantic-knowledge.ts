import { existsSync, readFileSync } from "fs";
import path from "path";
import { targetCacheLimit } from "./cache-config";
import { LruCache } from "./lru-cache";
import { normalizeKnowledge } from "./semantic-binary-constants";
import {
  parseWordCacheJson,
  SemanticGraphBinary,
  SemanticWordCacheBinary,
} from "./semantic-binary";

export type SemanticDomain =
  | "weather/climate"
  | "geography/nature"
  | "politics/society"
  | "economy/business"
  | "psychology/cognition"
  | "body/health"
  | "emotion"
  | "action/motion"
  | "abstract/general";

export type UsageBias = "literal" | "figurative" | "mixed" | "unknown";

export type WordKnowledge = {
  sememes: string[];
  synonyms: string[];
  concepts: string[];
  core_sememes?: string[];
  expanded_sememes?: string[];
  domain?: SemanticDomain;
  usage_bias?: UsageBias;
  sense_count?: number;
};

export type KnowledgeFeatureScores = {
  sememeScore: number;
  synonymScore: number;
  conceptScore: number;
  graphScore: number;
  fieldScore: number;
  domainScore: number;
  usageBiasMultiplier: number;
};

export type TargetScoringContext = {
  targetWord: string;
  targetKnowledge: WordKnowledge;
  targetSememes: Set<string>;
  targetCoreSememes: Set<string>;
  targetExpandedSememes: Set<string>;
  targetSynonyms: Set<string>;
  targetConcepts: Set<string>;
  targetDomain: SemanticDomain;
  targetUsageBias: UsageBias;
  distanceTo: (word: string) => number | undefined;
};

type GraphEdge = {
  a: string;
  b: string;
  w: number;
};

type AdjacencyEntry = {
  node: string;
  weight: number;
};

const cacheJsonPath = path.join(process.cwd(), "data", "semantic-word-cache.json");
const graphJsonPath = path.join(process.cwd(), "data", "semantic-graph.json");
const cacheBinaryPath = path.join(process.cwd(), "data", "semantic-word-cache.bin");
const graphBinaryPath = path.join(process.cwd(), "data", "semantic-graph.bin");

const EMPTY_KNOWLEDGE: WordKnowledge = {
  sememes: [],
  synonyms: [],
  concepts: [],
  core_sememes: [],
  expanded_sememes: [],
  domain: "abstract/general",
  usage_bias: "unknown",
  sense_count: 0,
};

export const CORE_SEMEME_WEIGHT = 0.78;
export const EXPANDED_SEMEME_WEIGHT = 0.22;
export const DOMAIN_MATCH_BOOST = 1.12;
export const DOMAIN_CROSS_PENALTY = 0.72;
export const DOMAIN_ABSTRACT_NEUTRAL = 0.88;
export const FIGURATIVE_ONLY_PENALTY = 0.78;
export const EXPANDED_ONLY_GRAPH_DAMPING = 0.65;

class MinHeap {
  private readonly nodes: string[] = [];
  private readonly priorities: number[] = [];

  get size() {
    return this.nodes.length;
  }

  push(node: string, priority: number) {
    this.nodes.push(node);
    this.priorities.push(priority);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): { node: string; priority: number } | undefined {
    if (this.nodes.length === 0) {
      return undefined;
    }

    const node = this.nodes[0];
    const priority = this.priorities[0];
    const lastIndex = this.nodes.length - 1;
    const lastNode = this.nodes[lastIndex];
    const lastPriority = this.priorities[lastIndex];

    this.nodes[0] = lastNode;
    this.priorities[0] = lastPriority;
    this.nodes.pop();
    this.priorities.pop();

    if (this.nodes.length > 0) {
      this.bubbleDown(0);
    }

    return { node, priority };
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.priorities[parent] <= this.priorities[index]) {
        break;
      }

      this.swap(parent, index);
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.nodes.length;

    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < length && this.priorities[left] < this.priorities[smallest]) {
        smallest = left;
      }

      if (right < length && this.priorities[right] < this.priorities[smallest]) {
        smallest = right;
      }

      if (smallest === index) {
        break;
      }

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(first: number, second: number) {
    const node = this.nodes[first];
    this.nodes[first] = this.nodes[second];
    this.nodes[second] = node;

    const priority = this.priorities[first];
    this.priorities[first] = this.priorities[second];
    this.priorities[second] = priority;
  }
}

function toSet(values: readonly string[]) {
  return new Set(values);
}

function loadWordCacheMap(): Map<string, WordKnowledge> {
  if (!existsSync(cacheJsonPath)) {
    return new Map();
  }

  return parseWordCacheJson(JSON.parse(readFileSync(cacheJsonPath, "utf8")));
}

function loadAdjacency(): Map<string, AdjacencyEntry[]> {
  const adjacency = new Map<string, AdjacencyEntry[]>();

  if (!existsSync(graphJsonPath)) {
    return adjacency;
  }

  const raw = JSON.parse(readFileSync(graphJsonPath, "utf8")) as { edges?: GraphEdge[] };
  for (const edge of raw.edges ?? []) {
    const left = adjacency.get(edge.a) ?? [];
    left.push({ node: edge.b, weight: edge.w });
    adjacency.set(edge.a, left);

    const right = adjacency.get(edge.b) ?? [];
    right.push({ node: edge.a, weight: edge.w });
    adjacency.set(edge.b, right);
  }

  return adjacency;
}

function loadSemanticBackends() {
  const wordBinary = existsSync(cacheBinaryPath) ? SemanticWordCacheBinary.tryLoad(cacheBinaryPath) : undefined;
  const graphBinary = existsSync(graphBinaryPath) ? SemanticGraphBinary.tryLoad(graphBinaryPath) : undefined;

  if (wordBinary && graphBinary) {
    return {
      wordBinary,
      graphBinary,
      wordCache: undefined as Map<string, WordKnowledge> | undefined,
      adjacency: undefined as Map<string, AdjacencyEntry[]> | undefined,
    };
  }

  return {
    wordBinary: undefined,
    graphBinary: undefined,
    wordCache: loadWordCacheMap(),
    adjacency: loadAdjacency(),
  };
}

function jaccardFromSets(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function fieldCoverageScore(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }

  if (intersection === 0) {
    return 0;
  }

  return intersection / Math.min(left.size, right.size);
}

function weightedSememeScore(
  targetCore: Set<string>,
  targetExpanded: Set<string>,
  guessCore: Set<string>,
  guessExpanded: Set<string>,
) {
  const coreScore = jaccardFromSets(targetCore, guessCore);
  const expandedScore = jaccardFromSets(targetExpanded, guessExpanded);

  if (targetExpanded.size === 0 && guessExpanded.size === 0) {
    return coreScore;
  }

  return CORE_SEMEME_WEIGHT * coreScore + EXPANDED_SEMEME_WEIGHT * expandedScore;
}

function hasRichMetadata(knowledge: WordKnowledge) {
  return Boolean(
    (knowledge.sense_count ?? 0) > 0 ||
      (knowledge.expanded_sememes?.length ?? 0) > 0 ||
      (knowledge.core_sememes?.length &&
        knowledge.core_sememes.length !== knowledge.sememes.length) ||
      (knowledge.domain && knowledge.domain !== "abstract/general") ||
      (knowledge.usage_bias && knowledge.usage_bias !== "unknown"),
  );
}

function knowledgeAlignmentMultiplier(
  targetKnowledge: WordKnowledge,
  guessKnowledge: WordKnowledge,
  targetCore: Set<string>,
  guessCore: Set<string>,
) {
  if (!hasRichMetadata(targetKnowledge) && !hasRichMetadata(guessKnowledge)) {
    return { domainScore: 1, usageBiasMultiplier: 1 };
  }

  const targetDomain = targetKnowledge.domain ?? "abstract/general";
  const guessDomain = guessKnowledge.domain ?? "abstract/general";
  const targetBias = targetKnowledge.usage_bias ?? "unknown";
  const guessBias = guessKnowledge.usage_bias ?? "unknown";

  return {
    domainScore: domainAlignmentScore(targetDomain, guessDomain),
    usageBiasMultiplier: usageBiasMultiplier(
      targetBias,
      guessBias,
      targetCore,
      guessCore,
      targetDomain,
      guessDomain,
    ),
  };
}

export function domainAlignmentScore(
  targetDomain: SemanticDomain,
  guessDomain: SemanticDomain,
) {
  if (targetDomain === guessDomain && targetDomain !== "abstract/general") {
    return DOMAIN_MATCH_BOOST;
  }

  if (targetDomain === "abstract/general" || guessDomain === "abstract/general") {
    return DOMAIN_ABSTRACT_NEUTRAL;
  }

  return DOMAIN_CROSS_PENALTY;
}

export function usageBiasMultiplier(
  targetBias: UsageBias,
  guessBias: UsageBias,
  targetCore: Set<string>,
  guessCore: Set<string>,
  targetDomain: SemanticDomain,
  guessDomain: SemanticDomain,
) {
  const coreOverlap = jaccardFromSets(targetCore, guessCore);

  if (
    (targetBias === "literal" || targetBias === "mixed") &&
    guessBias === "figurative" &&
    coreOverlap < 0.2 &&
    targetDomain !== guessDomain
  ) {
    return FIGURATIVE_ONLY_PENALTY;
  }

  if (targetBias === "literal" && guessBias === "figurative" && coreOverlap < 0.15) {
    return FIGURATIVE_ONLY_PENALTY;
  }

  if (targetBias === "mixed" && guessBias === "figurative" && coreOverlap < 0.05) {
    return FIGURATIVE_ONLY_PENALTY;
  }

  return 1;
}

function synonymRelationScore(
  targetSynonyms: Set<string>,
  guessSynonyms: Set<string>,
  guessWord: string,
  targetWord: string,
) {
  if (guessWord === targetWord) {
    return 1;
  }

  if (targetSynonyms.has(guessWord) || guessSynonyms.has(targetWord)) {
    return 1;
  }

  return jaccardFromSets(targetSynonyms, guessSynonyms);
}

export class SemanticKnowledgeStore {
  private readonly wordBinary?: SemanticWordCacheBinary;
  private readonly graphBinary?: SemanticGraphBinary;
  private readonly wordCache?: Map<string, WordKnowledge>;
  private readonly adjacency?: Map<string, AdjacencyEntry[]>;
  private readonly lookupCache = new Map<string, WordKnowledge>();
  private readonly targetContextCache = new LruCache<string, TargetScoringContext>(targetCacheLimit());

  readonly available: boolean;

  constructor(
    wordCache?: Map<string, WordKnowledge>,
    adjacency?: Map<string, AdjacencyEntry[]>,
    options: { wordBinary?: SemanticWordCacheBinary; graphBinary?: SemanticGraphBinary } = {},
  ) {
    if (wordCache || adjacency) {
      this.wordCache = wordCache ?? new Map();
      this.adjacency = adjacency ?? new Map();
      this.available = this.wordCache.size > 0 || this.adjacency.size > 0;
      return;
    }

    const backends = loadSemanticBackends();
    this.wordBinary = options.wordBinary ?? backends.wordBinary;
    this.graphBinary = options.graphBinary ?? backends.graphBinary;
    this.wordCache = backends.wordCache;
    this.adjacency = backends.adjacency;
    this.available =
      Boolean(this.wordBinary?.size) ||
      Boolean(this.graphBinary) ||
      (this.wordCache?.size ?? 0) > 0 ||
      (this.adjacency?.size ?? 0) > 0;
  }

  evictTarget(targetWord: string) {
    this.targetContextCache.delete(targetWord);
  }

  getWordKnowledge(word: string): WordKnowledge {
    const cached = this.lookupCache.get(word);
    if (cached) {
      return cached;
    }

    const knowledge = this.wordBinary
      ? normalizeKnowledge(this.wordBinary.getWordKnowledge(word) ?? EMPTY_KNOWLEDGE)
      : normalizeKnowledge(this.wordCache?.get(word) ?? EMPTY_KNOWLEDGE);
    this.lookupCache.set(word, knowledge);
    return knowledge;
  }

  private shortestDistance(source: string, target: string) {
    if (source === target) {
      return 0;
    }

    if (this.graphBinary) {
      return this.graphBinary.shortestDistance(source, target);
    }

    const adjacency = this.adjacency;
    if (!adjacency?.has(source)) {
      return undefined;
    }

    const distances = new Map<string, number>();
    const settled = new Set<string>();
    const heap = new MinHeap();
    heap.push(source, 0);

    while (heap.size > 0) {
      const current = heap.pop();
      if (!current || settled.has(current.node)) {
        continue;
      }

      settled.add(current.node);
      distances.set(current.node, current.priority);

      if (current.node === target) {
        return current.priority;
      }

      for (const neighbor of adjacency.get(current.node) ?? []) {
        if (settled.has(neighbor.node)) {
          continue;
        }

        const nextDistance = current.priority + neighbor.weight;
        const known = distances.get(neighbor.node);
        if (known === undefined || nextDistance < known) {
          distances.set(neighbor.node, nextDistance);
          heap.push(neighbor.node, nextDistance);
        }
      }
    }

    return undefined;
  }

  createTargetContext(targetWord: string): TargetScoringContext {
    const cached = this.targetContextCache.get(targetWord);
    if (cached) {
      return cached;
    }

    const targetKnowledge = this.getWordKnowledge(targetWord);
    const core = targetKnowledge.core_sememes ?? targetKnowledge.sememes;
    const expanded = targetKnowledge.expanded_sememes ?? [];

    const context: TargetScoringContext = {
      targetWord,
      targetKnowledge,
      targetSememes: toSet(targetKnowledge.sememes),
      targetCoreSememes: toSet(core),
      targetExpandedSememes: toSet(expanded),
      targetSynonyms: toSet(targetKnowledge.synonyms),
      targetConcepts: toSet(targetKnowledge.concepts),
      targetDomain: targetKnowledge.domain ?? "abstract/general",
      targetUsageBias: targetKnowledge.usage_bias ?? "unknown",
      distanceTo: (word: string) => this.shortestDistance(targetWord, word),
    };

    this.targetContextCache.set(targetWord, context);
    return context;
  }

  knowledgeScores(targetContext: TargetScoringContext, guessWord: string): KnowledgeFeatureScores {
    const guessKnowledge = this.getWordKnowledge(guessWord);
    const guessCore = toSet(guessKnowledge.core_sememes ?? guessKnowledge.sememes);
    const guessExpanded = toSet(guessKnowledge.expanded_sememes ?? []);

    const sememeScore = weightedSememeScore(
      targetContext.targetCoreSememes,
      targetContext.targetExpandedSememes,
      guessCore,
      guessExpanded,
    );

    const { domainScore, usageBiasMultiplier: biasMultiplier } = knowledgeAlignmentMultiplier(
      targetContext.targetKnowledge,
      guessKnowledge,
      targetContext.targetCoreSememes,
      guessCore,
    );

    const pathDistance = targetContext.distanceTo(guessWord);
    let graphScore = pathDistance === undefined ? 0 : 1 / (1 + pathDistance);

    const coreOverlap = jaccardFromSets(targetContext.targetCoreSememes, guessCore);
    if (
      graphScore > 0 &&
      coreOverlap < 0.05 &&
      (hasRichMetadata(targetContext.targetKnowledge) || hasRichMetadata(guessKnowledge))
    ) {
      const expandedOverlap = jaccardFromSets(targetContext.targetExpandedSememes, guessExpanded);
      if (expandedOverlap > 0 && coreOverlap === 0) {
        graphScore *= EXPANDED_ONLY_GRAPH_DAMPING;
      }
    }

    const adjustedSememe = sememeScore * domainScore * biasMultiplier;
    const baseSynonym = synonymRelationScore(
      targetContext.targetSynonyms,
      toSet(guessKnowledge.synonyms),
      guessWord,
      targetContext.targetWord,
    );
    const adjustedSynonym = Math.min(1, baseSynonym * domainScore * biasMultiplier);
    const adjustedConcept =
      jaccardFromSets(targetContext.targetConcepts, toSet(guessKnowledge.concepts)) *
      domainScore *
      biasMultiplier;
    const adjustedGraph = graphScore * domainScore * biasMultiplier;

    return {
      sememeScore: adjustedSememe,
      synonymScore: adjustedSynonym,
      conceptScore: adjustedConcept,
      graphScore: adjustedGraph,
      fieldScore: fieldCoverageScore(targetContext.targetCoreSememes, guessCore),
      domainScore,
      usageBiasMultiplier: biasMultiplier,
    };
  }

  sememeScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return weightedSememeScore(
      toSet(target.core_sememes ?? target.sememes),
      toSet(target.expanded_sememes ?? []),
      toSet(guess.core_sememes ?? guess.sememes),
      toSet(guess.expanded_sememes ?? []),
    );
  }

  synonymScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return synonymRelationScore(
      toSet(target.synonyms),
      toSet(guess.synonyms),
      guessWord,
      targetWord,
    );
  }

  conceptScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return jaccardFromSets(toSet(target.concepts), toSet(guess.concepts));
  }

  graphScore(targetWord: string, guessWord: string) {
    const pathDistance = this.shortestDistance(targetWord, guessWord);
    if (pathDistance === undefined) {
      return 0;
    }

    return 1 / (1 + pathDistance);
  }
}

export const semanticKnowledgeStore = new SemanticKnowledgeStore();

export function jaccardOverlap(left: readonly string[], right: readonly string[]) {
  return jaccardFromSets(toSet(left), toSet(right));
}

export type HybridScoreExplanation = {
  targetWord: string;
  guessWord: string;
  embedScore: number;
  rawKnowledge: KnowledgeFeatureScores;
  weightedContributions: {
    embed: number;
    sememe: number;
    synonym: number;
    concept: number;
    graph: number;
  };
  rawHybrid: number;
};

export function explainHybridScore(
  targetWord: string,
  guessWord: string,
  cosineSimilarity: number,
  knowledge: SemanticKnowledgeStore = semanticKnowledgeStore,
  weights = {
    embed: 0.75,
    sememe: 0.1,
    graph: 0.07,
    concept: 0.03,
    synonym: 0.05,
  },
): HybridScoreExplanation {
  const embedScore = Math.min(1, Math.max(0, cosineSimilarity));
  const targetContext = knowledge.createTargetContext(targetWord);
  const rawKnowledge = knowledge.knowledgeScores(targetContext, guessWord);

  const weightedContributions = {
    embed: weights.embed * embedScore,
    sememe: weights.sememe * rawKnowledge.sememeScore,
    synonym: weights.synonym * rawKnowledge.synonymScore,
    concept: weights.concept * rawKnowledge.conceptScore,
    graph: weights.graph * rawKnowledge.graphScore,
  };

  const rawHybrid =
    weightedContributions.embed +
    weightedContributions.sememe +
    weightedContributions.synonym +
    weightedContributions.concept +
    weightedContributions.graph;

  return {
    targetWord,
    guessWord,
    embedScore,
    rawKnowledge,
    weightedContributions,
    rawHybrid,
  };
}
