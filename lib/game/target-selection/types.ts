export type PosHeuristic =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "function"
  | "pronoun"
  | "numeral"
  | "measure"
  | "place"
  | "person"
  | "organization"
  | "time"
  | "particle"
  | "unknown";

export type DropReason =
  | "not_two_char"
  | "not_simplified"
  | "not_in_vocab"
  | "not_in_embedding"
  | "blocklist"
  | "function_word"
  | "pronoun"
  | "numeral"
  | "measure_word"
  | "conjunction"
  | "particle"
  | "place_name"
  | "person_name"
  | "organization"
  | "hot_topic"
  | "too_obscure"
  | "too_easy"
  | "weak_semantics"
  | "noisy_neighbors"
  | "below_playability"
  | "below_semantic_quality"
  | "below_final_score";

export type TargetSelectionConfig = {
  /** Max frequency rank (1 = most frequent). Words above this rank are too obscure. */
  maxFrequencyRank: number;
  /** Min frequency rank. Words more common than this are often too easy / functional. */
  minFrequencyRank: number;
  /** Weight for normalized log-frequency in final score (dominant signal). */
  weightFrequency: number;
  /** Weight for playability heuristics. */
  weightPlayability: number;
  /** Weight for semantic neighborhood quality. */
  weightSemanticQuality: number;
  /** Optional future freshness boost (0 = disabled). */
  weightFreshness: number;
  /** Minimum playability to remain in the pool (0–1). */
  minPlayability: number;
  /** Minimum semantic quality to remain in the pool (0–1). */
  minSemanticQuality: number;
  /** Minimum composite final score to keep (0–1). */
  minFinalScore: number;
  /** Max candidates to evaluate with embedding neighbor search. */
  maxSemanticEvaluations: number;
  /** Neighbors to inspect for semantic quality. */
  neighborCount: number;
  /** Minimum cosine similarity for a neighbor to count as meaningful. */
  minNeighborSimilarity: number;
  /** Max ranked targets in output. */
  outputLimit: number;
};

export type SemanticKnowledgeLite = {
  domain?: string;
  usage_bias?: string;
  sense_count?: number;
  core_sememes?: string[];
  synonyms?: string[];
};

export type TargetCandidateDiagnostics = {
  word: string;
  frequency: number;
  frequencyRank: number;
  inVocab: boolean;
  inEmbedding: boolean;
  passesTwoChar: boolean;
  isSimplified: boolean;
  posHeuristic: PosHeuristic;
  playabilityScore: number;
  semanticQualityScore: number;
  freshnessScore: number;
  frequencyScore: number;
  finalScore: number;
  keep: boolean;
  reason: string;
  topNeighbors?: string[];
};

export type TargetSelectionResult = {
  config: TargetSelectionConfig;
  generatedAt: string;
  stats: {
    frequencyEntries: number;
    evaluated: number;
    kept: number;
    dropped: number;
  };
  ranked: TargetCandidateDiagnostics[];
  filtered: TargetCandidateDiagnostics[];
};
