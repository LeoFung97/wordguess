import type { SemanticKnowledgeStore } from "./semantic-knowledge";
import { semanticKnowledgeStore } from "./semantic-knowledge";

export type HybridFeatureScores = {
  embedScore: number;
  sememeScore: number;
  synonymScore: number;
  conceptScore: number;
  graphScore: number;
  rawHybrid: number;
};

export const HYBRID_WEIGHTS = {
  embed: 0.65,
  sememe: 0.1,
  synonym: 0.1,
  concept: 0.05,
  graph: 0.1,
} as const;

export function normalizeEmbedScore(cosineSimilarity: number) {
  return Math.min(1, Math.max(0, cosineSimilarity));
}

export function computeHybridFeatures(
  targetWord: string,
  guessWord: string,
  cosineSimilarity: number,
  knowledge: SemanticKnowledgeStore = semanticKnowledgeStore,
): HybridFeatureScores {
  const embedScore = normalizeEmbedScore(cosineSimilarity);
  const sememeScore = knowledge.sememeScore(targetWord, guessWord);
  const synonymScore = knowledge.synonymScore(targetWord, guessWord);
  const conceptScore = knowledge.conceptScore(targetWord, guessWord);
  const graphScore = knowledge.graphScore(targetWord, guessWord);

  const rawHybrid =
    HYBRID_WEIGHTS.embed * embedScore +
    HYBRID_WEIGHTS.sememe * sememeScore +
    HYBRID_WEIGHTS.synonym * synonymScore +
    HYBRID_WEIGHTS.concept * conceptScore +
    HYBRID_WEIGHTS.graph * graphScore;

  return {
    embedScore,
    sememeScore,
    synonymScore,
    conceptScore,
    graphScore,
    rawHybrid,
  };
}

export function computeHybridRawScore(
  targetWord: string,
  guessWord: string,
  cosineSimilarity: number,
  knowledge: SemanticKnowledgeStore = semanticKnowledgeStore,
) {
  return computeHybridFeatures(targetWord, guessWord, cosineSimilarity, knowledge).rawHybrid;
}

/** Pure cosine display mapping for before/after comparisons in tests. */
export function computeCosineOnlyDisplayScore(cosineSimilarity: number, isAnswer = false) {
  if (isAnswer) {
    return 100;
  }

  const u = normalizeEmbedScore(cosineSimilarity);
  return Math.round(Math.min(99.99, 99.99 * u ** 0.45) * 100) / 100;
}
