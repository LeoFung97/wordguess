import { existsSync, readFileSync } from "fs";
import path from "path";

export type WordKnowledge = {
  sememes: string[];
  synonyms: string[];
  concepts: string[];
};

export type TargetScoringContext = {
  targetWord: string;
  targetKnowledge: WordKnowledge;
  targetSememes: Set<string>;
  targetSynonyms: Set<string>;
  targetConcepts: Set<string>;
  distances: Map<string, number>;
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

const cachePath = path.join(process.cwd(), "data", "semantic-word-cache.json");
const graphPath = path.join(process.cwd(), "data", "semantic-graph.json");

const EMPTY_KNOWLEDGE: WordKnowledge = { sememes: [], synonyms: [], concepts: [] };

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

function loadWordCache(): Map<string, WordKnowledge> {
  const cache = new Map<string, WordKnowledge>();

  if (!existsSync(cachePath)) {
    return cache;
  }

  const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, WordKnowledge>;
  for (const [word, knowledge] of Object.entries(raw)) {
    cache.set(word, {
      sememes: knowledge.sememes ?? [],
      synonyms: knowledge.synonyms ?? [],
      concepts: knowledge.concepts ?? [],
    });
  }

  return cache;
}

function loadAdjacency(): Map<string, AdjacencyEntry[]> {
  const adjacency = new Map<string, AdjacencyEntry[]>();

  if (!existsSync(graphPath)) {
    return adjacency;
  }

  const raw = JSON.parse(readFileSync(graphPath, "utf8")) as { edges: GraphEdge[] };
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

export class SemanticKnowledgeStore {
  private readonly wordCache: Map<string, WordKnowledge>;
  private readonly adjacency: Map<string, AdjacencyEntry[]>;
  private readonly lookupCache = new Map<string, WordKnowledge>();
  private readonly distanceCache = new Map<string, Map<string, number>>();
  private readonly targetContextCache = new Map<string, TargetScoringContext>();

  readonly available: boolean;

  constructor(wordCache?: Map<string, WordKnowledge>, adjacency?: Map<string, AdjacencyEntry[]>) {
    this.wordCache = wordCache ?? loadWordCache();
    this.adjacency = adjacency ?? loadAdjacency();
    this.available = this.wordCache.size > 0 || this.adjacency.size > 0;
  }

  getWordKnowledge(word: string): WordKnowledge {
    const cached = this.lookupCache.get(word);
    if (cached) {
      return cached;
    }

    const knowledge = this.wordCache.get(word) ?? EMPTY_KNOWLEDGE;
    this.lookupCache.set(word, knowledge);
    return knowledge;
  }

  createTargetContext(targetWord: string): TargetScoringContext {
    const cached = this.targetContextCache.get(targetWord);
    if (cached) {
      return cached;
    }

    const targetKnowledge = this.getWordKnowledge(targetWord);
    const context: TargetScoringContext = {
      targetWord,
      targetKnowledge,
      targetSememes: toSet(targetKnowledge.sememes),
      targetSynonyms: toSet(targetKnowledge.synonyms),
      targetConcepts: toSet(targetKnowledge.concepts),
      distances: this.dijkstra(targetWord),
    };

    this.targetContextCache.set(targetWord, context);
    return context;
  }

  knowledgeScores(targetContext: TargetScoringContext, guessWord: string) {
    const guessKnowledge = this.getWordKnowledge(guessWord);
    const guessSememes = toSet(guessKnowledge.sememes);
    const pathDistance = targetContext.distances.get(guessWord);
    const graphScore = pathDistance === undefined ? 0 : 1 / (1 + pathDistance);

    return {
      sememeScore: jaccardFromSets(targetContext.targetSememes, guessSememes),
      synonymScore: synonymRelationScore(
        targetContext.targetSynonyms,
        toSet(guessKnowledge.synonyms),
        guessWord,
        targetContext.targetWord,
      ),
      conceptScore: jaccardFromSets(targetContext.targetConcepts, toSet(guessKnowledge.concepts)),
      graphScore,
      fieldScore: fieldCoverageScore(targetContext.targetSememes, guessSememes),
    };
  }

  sememeScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return jaccardFromSets(toSet(target.sememes), toSet(guess.sememes));
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

  private dijkstra(source: string) {
    const cached = this.distanceCache.get(source);
    if (cached) {
      return cached;
    }

    const distances = new Map<string, number>();
    const settled = new Set<string>();
    const heap = new MinHeap();

    if (!this.adjacency.has(source)) {
      this.distanceCache.set(source, distances);
      return distances;
    }

    heap.push(source, 0);

    while (heap.size > 0) {
      const current = heap.pop();
      if (!current || settled.has(current.node)) {
        continue;
      }

      settled.add(current.node);
      distances.set(current.node, current.priority);

      for (const neighbor of this.adjacency.get(current.node) ?? []) {
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

    this.distanceCache.set(source, distances);
    return distances;
  }

  graphScore(targetWord: string, guessWord: string) {
    const context = this.createTargetContext(targetWord);
    const pathDistance = context.distances.get(guessWord);
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
