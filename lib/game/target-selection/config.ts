import type { TargetSelectionConfig } from "./types";

export const DEFAULT_TARGET_SELECTION_CONFIG: TargetSelectionConfig = {
  maxFrequencyRank: 25_000,
  minFrequencyRank: 80,
  weightFrequency: 0.62,
  weightPlayability: 0.23,
  weightSemanticQuality: 0.15,
  weightFreshness: 0,
  minPlayability: 0.42,
  minSemanticQuality: 0.35,
  minFinalScore: 0.48,
  maxSemanticEvaluations: 8_000,
  neighborCount: 24,
  minNeighborSimilarity: 0.45,
  outputLimit: 2_000,
};

export function mergeTargetSelectionConfig(
  overrides: Partial<TargetSelectionConfig> = {},
): TargetSelectionConfig {
  return { ...DEFAULT_TARGET_SELECTION_CONFIG, ...overrides };
}
