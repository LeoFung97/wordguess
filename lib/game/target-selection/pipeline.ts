import { readFileSync } from "fs";
import type { FrequencyEntry } from "../../scripts/frequency-list";
import { mergeTargetSelectionConfig } from "./config";
import type { EmbeddingIndex } from "./embedding-index";
import { applyHardFilters, guessPosHeuristic, scorePlayability } from "./heuristics";
import { scoreSemanticQuality } from "./semantic-quality";
import type {
  SemanticKnowledgeLite,
  TargetCandidateDiagnostics,
  TargetSelectionConfig,
  TargetSelectionResult,
} from "./types";

export type TargetSelectionInputs = {
  frequencyEntries: FrequencyEntry[];
  vocabulary: Map<string, { commonness: number }>;
  embeddingIndex: EmbeddingIndex;
  semanticKnowledge?: Map<string, SemanticKnowledgeLite>;
  toSimplified: (word: string) => string;
  /** Optional per-word freshness boost in [0, 1]; defaults to 0. */
  freshnessScores?: Map<string, number>;
  config?: Partial<TargetSelectionConfig>;
};

function normalizeFrequencyScore(frequency: number, maxFrequency: number) {
  if (maxFrequency <= 0) {
    return 0;
  }

  const logFreq = Math.log10(Math.max(frequency, 1));
  const logMax = Math.log10(Math.max(maxFrequency, 1));
  return clamp((logFreq - Math.log10(10)) / Math.max(logMax - Math.log10(10), 1), 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadSemanticKnowledge(path: string): Map<string, SemanticKnowledgeLite> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, SemanticKnowledgeLite | { schema_version?: number }>;
  const map = new Map<string, SemanticKnowledgeLite>();

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("__")) {
      continue;
    }
    map.set(key, value as SemanticKnowledgeLite);
  }

  return map;
}

export function runTargetSelectionPipeline(inputs: TargetSelectionInputs): TargetSelectionResult {
  const config = mergeTargetSelectionConfig(inputs.config);
  const embeddingWords = new Set(inputs.embeddingIndex.wordToIndex.keys());
  const maxFrequency = inputs.frequencyEntries[0]?.frequency ?? 1;

  const frequencyRankByWord = new Map<string, number>();
  inputs.frequencyEntries.forEach((entry, index) => {
    if (!frequencyRankByWord.has(entry.word)) {
      frequencyRankByWord.set(entry.word, index + 1);
    }
  });

  const evaluated: TargetCandidateDiagnostics[] = [];
  const survivors: Array<{
    entry: FrequencyEntry;
    frequencyRank: number;
    knowledge?: SemanticKnowledgeLite;
    posHeuristic: ReturnType<typeof guessPosHeuristic>;
    playabilityScore: number;
  }> = [];

  for (const entry of inputs.frequencyEntries) {
    const word = entry.word;
    const frequencyRank = frequencyRankByWord.get(word) ?? Number.MAX_SAFE_INTEGER;
    const inVocab = inputs.vocabulary.has(word);
    const inEmbedding = embeddingWords.has(word);
    const passesTwoChar = /^[\u4e00-\u9fff]{2}$/.test(word);
    const isSimplified = inputs.toSimplified(word) === word;

    const hardFilter = applyHardFilters(word, frequencyRank, config, {
      inVocab,
      inEmbedding,
      isSimplified,
      toSimplified: inputs.toSimplified,
    });

    const knowledge = inputs.semanticKnowledge?.get(word);
    const posHeuristic = guessPosHeuristic(word, knowledge);

    if (!hardFilter.pass) {
      evaluated.push({
        word,
        frequency: entry.frequency,
        frequencyRank,
        inVocab,
        inEmbedding,
        passesTwoChar,
        isSimplified,
        posHeuristic,
        playabilityScore: 0,
        semanticQualityScore: 0,
        freshnessScore: inputs.freshnessScores?.get(word) ?? 0,
        frequencyScore: normalizeFrequencyScore(entry.frequency, maxFrequency),
        finalScore: 0,
        keep: false,
        reason: hardFilter.detail,
        topNeighbors: [],
      });
      continue;
    }

    const playabilityScore = scorePlayability(word, frequencyRank, posHeuristic, knowledge);
    survivors.push({ entry, frequencyRank, knowledge, posHeuristic, playabilityScore });
  }

  survivors.sort(
    (first, second) =>
      second.entry.frequency - first.entry.frequency ||
      second.playabilityScore - first.playabilityScore,
  );

  const semanticEvaluationBudget = config.maxSemanticEvaluations;
  const embeddingEvaluationWords = new Set(
    survivors.slice(0, semanticEvaluationBudget).map((item) => item.entry.word),
  );

  for (const survivor of survivors) {
    const { entry, frequencyRank, knowledge, posHeuristic, playabilityScore } = survivor;
    const word = entry.word;
    const inVocab = inputs.vocabulary.has(word);
    const inEmbedding = embeddingWords.has(word);
    const passesTwoChar = /^[\u4e00-\u9fff]{2}$/.test(word);
    const isSimplified = inputs.toSimplified(word) === word;

    let semanticQualityScore = 0.5;
    let topNeighbors: string[] = [];

    if (embeddingEvaluationWords.has(word)) {
      const semantic = scoreSemanticQuality(word, inputs.embeddingIndex, knowledge, {
        neighborCount: config.neighborCount,
        minNeighborSimilarity: config.minNeighborSimilarity,
        pos: posHeuristic,
        preferCache: true,
      });
      semanticQualityScore = semantic.score;
      topNeighbors = semantic.topNeighbors;
    } else if (knowledge?.synonyms?.length) {
      semanticQualityScore = clamp(0.4 + Math.min(knowledge.synonyms.length, 12) * 0.03, 0, 1);
      topNeighbors = knowledge.synonyms.slice(0, 8);
    }

    const frequencyScore = normalizeFrequencyScore(entry.frequency, maxFrequency);
    const freshnessScore = inputs.freshnessScores?.get(word) ?? 0;

    const finalScore =
      config.weightFrequency * frequencyScore +
      config.weightPlayability * playabilityScore +
      config.weightSemanticQuality * semanticQualityScore +
      config.weightFreshness * freshnessScore;

    let keep = true;
    let reason = "kept";

    if (playabilityScore < config.minPlayability) {
      keep = false;
      reason = `Playability ${playabilityScore.toFixed(3)} below min ${config.minPlayability}`;
    } else if (semanticQualityScore < config.minSemanticQuality) {
      keep = false;
      reason = `Semantic quality ${semanticQualityScore.toFixed(3)} below min ${config.minSemanticQuality}`;
    } else if (semanticQualityScore < 0.3 && meaningfulNeighborCount(topNeighbors, word) < 3) {
      keep = false;
      reason = "Weak or noisy semantic neighborhood";
    } else if (finalScore < config.minFinalScore) {
      keep = false;
      reason = `Final score ${finalScore.toFixed(3)} below min ${config.minFinalScore}`;
    }

    evaluated.push({
      word,
      frequency: entry.frequency,
      frequencyRank,
      inVocab,
      inEmbedding,
      passesTwoChar,
      isSimplified,
      posHeuristic,
      playabilityScore,
      semanticQualityScore,
      freshnessScore,
      frequencyScore,
      finalScore,
      keep,
      reason,
      topNeighbors,
    });
  }

  const kept = evaluated
    .filter((entry) => entry.keep)
    .sort((first, second) => second.finalScore - first.finalScore || first.frequencyRank - second.frequencyRank)
    .slice(0, config.outputLimit);

  const filtered = evaluated
    .filter((entry) => !entry.keep)
    .sort((first, second) => first.frequencyRank - second.frequencyRank);

  return {
    config,
    generatedAt: new Date().toISOString(),
    stats: {
      frequencyEntries: inputs.frequencyEntries.length,
      evaluated: evaluated.length,
      kept: kept.length,
      dropped: filtered.length,
    },
    ranked: kept,
    filtered,
  };
}

function meaningfulNeighborCount(neighbors: string[], word: string) {
  return neighbors.filter((neighbor) => neighbor !== word && neighbor.length >= 2).length;
}

export { loadSemanticKnowledge };
