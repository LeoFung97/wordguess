import { existsSync, readFileSync } from "fs";
import path from "path";

export type WordKnowledge = {
  sememes: string[];
  synonyms: string[];
  concepts: string[];
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

function jaccardSimilarity(left: readonly string[], right: readonly string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  let intersection = 0;

  for (const item of left) {
    if (rightSet.has(item)) {
      intersection += 1;
    }
  }

  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function synonymRelationScore(target: WordKnowledge, guess: WordKnowledge, guessWord: string, targetWord: string) {
  if (guessWord === targetWord) {
    return 1;
  }

  if (target.synonyms.includes(guessWord) || guess.synonyms.includes(targetWord)) {
    return 1;
  }

  return jaccardSimilarity(target.synonyms, guess.synonyms);
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

  sememeScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return jaccardSimilarity(target.sememes, guess.sememes);
  }

  synonymScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return synonymRelationScore(target, guess, guessWord, targetWord);
  }

  conceptScore(targetWord: string, guessWord: string) {
    const target = this.getWordKnowledge(targetWord);
    const guess = this.getWordKnowledge(guessWord);
    return jaccardSimilarity(target.concepts, guess.concepts);
  }

  private dijkstra(source: string) {
    const cached = this.distanceCache.get(source);
    if (cached) {
      return cached;
    }

    const distances = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<{ node: string; distance: number }> = [{ node: source, distance: 0 }];

    while (queue.length > 0) {
      queue.sort((first, second) => first.distance - second.distance);
      const current = queue.shift();
      if (!current || visited.has(current.node)) {
        continue;
      }

      visited.add(current.node);
      distances.set(current.node, current.distance);

      for (const neighbor of this.adjacency.get(current.node) ?? []) {
        if (visited.has(neighbor.node)) {
          continue;
        }

        queue.push({
          node: neighbor.node,
          distance: current.distance + neighbor.weight,
        });
      }
    }

    this.distanceCache.set(source, distances);
    return distances;
  }

  graphScore(targetWord: string, guessWord: string) {
    if (!this.adjacency.has(targetWord) || !this.adjacency.has(guessWord)) {
      return 0;
    }

    const distances = this.dijkstra(targetWord);
    const pathDistance = distances.get(guessWord);
    if (pathDistance === undefined) {
      return 0;
    }

    return 1 / (1 + pathDistance);
  }
}

export const semanticKnowledgeStore = new SemanticKnowledgeStore();

export function jaccardOverlap(left: readonly string[], right: readonly string[]) {
  return jaccardSimilarity(left, right);
}
