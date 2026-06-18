import type { SemanticKnowledgeStore, TargetScoringContext } from "./semantic-knowledge";
import { semanticKnowledgeStore } from "./semantic-knowledge";

export type HybridFeatureScores = {
  embedScore: number;
  sememeScore: number;
  synonymScore: number;
  conceptScore: number;
  graphScore: number;
  fieldScore: number;
  rawHybrid: number;
};

export const HYBRID_WEIGHTS = {
  embed: 0.75,
  sememe: 0.1,
  graph: 0.07,
  concept: 0.03,
  synonym: 0.05,
} as const;

export function normalizeEmbedScore(cosineSimilarity: number) {
  return Math.min(1, Math.max(0, cosineSimilarity));
}

export function combineHybridScores(
  embedScore: number,
  knowledge: {
    sememeScore: number;
    synonymScore: number;
    conceptScore: number;
    graphScore: number;
    fieldScore: number;
  },
) {
  const rawHybrid =
    HYBRID_WEIGHTS.embed * embedScore +
    HYBRID_WEIGHTS.sememe * knowledge.sememeScore +
    HYBRID_WEIGHTS.synonym * knowledge.synonymScore +
    HYBRID_WEIGHTS.concept * knowledge.conceptScore +
    HYBRID_WEIGHTS.graph * knowledge.graphScore;

  return {
    embedScore,
    sememeScore: knowledge.sememeScore,
    synonymScore: knowledge.synonymScore,
    conceptScore: knowledge.conceptScore,
    graphScore: knowledge.graphScore,
    fieldScore: knowledge.fieldScore,
    rawHybrid,
  };
}

export function computeHybridFeaturesWithContext(
  guessWord: string,
  cosineSimilarity: number,
  targetContext: TargetScoringContext,
  knowledge: SemanticKnowledgeStore = semanticKnowledgeStore,
): HybridFeatureScores {
  const embedScore = normalizeEmbedScore(cosineSimilarity);
  return combineHybridScores(embedScore, knowledge.knowledgeScores(targetContext, guessWord));
}

export function computeHybridFeatures(
  targetWord: string,
  guessWord: string,
  cosineSimilarity: number,
  knowledge: SemanticKnowledgeStore = semanticKnowledgeStore,
): HybridFeatureScores {
  return computeHybridFeaturesWithContext(
    guessWord,
    cosineSimilarity,
    knowledge.createTargetContext(targetWord),
    knowledge,
  );
}

export function computeHybridRawScoreWithContext(
  guessWord: string,
  cosineSimilarity: number,
  targetContext: TargetScoringContext,
  knowledge: SemanticKnowledgeStore = semanticKnowledgeStore,
) {
  return computeHybridFeaturesWithContext(guessWord, cosineSimilarity, targetContext, knowledge).rawHybrid;
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
