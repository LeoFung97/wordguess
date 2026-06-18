import type { SemanticKnowledgeStore } from "./semantic-knowledge";
import { computeHybridFeaturesWithContext } from "./hybrid-scorer";
import {
  buildTargetDisplayCalibration,
  calibrationFromScoredNeighbors,
  type TargetDisplayCalibration,
} from "./scoring";
import type { SimilarityCalibration } from "./types";
import type { WordVectorEntry } from "./types";
import { cosineSimilarity } from "./vector-math";

export const TARGET_RANKINGS_MAGIC = "WRTR";
export const TARGET_RANKINGS_VERSION = 1;
export const TARGET_HINT_TOP_N = 500;
export const TARGET_META_SIZE = 1 + 4 * 8 + 3 * 4 + 2 + TARGET_HINT_TOP_N * 4;

export type ScoredEntry = {
  word: string;
  similarity: number;
  rawHybrid: number;
};

export type BuiltTargetRanking = {
  targetWord: string;
  orderedWords: string[];
  rankByWord: Map<string, number>;
  displayCalibration: TargetDisplayCalibration;
  calibration: SimilarityCalibration;
  hintWordIndices: number[];
};

export function buildTargetRanking(
  targetWord: string,
  targetVector: ArrayLike<number>,
  entries: WordVectorEntry[],
  wordToIndex: Map<string, number>,
  knowledge: SemanticKnowledgeStore,
): BuiltTargetRanking {
  const targetContext = knowledge.createTargetContext(targetWord);
  const scored = entries.map((entry) => {
    const similarity = cosineSimilarity(targetVector, entry.vector);
    const features = computeHybridFeaturesWithContext(entry.word, similarity, targetContext, knowledge);

    return {
      word: entry.word,
      similarity,
      rawHybrid: features.rawHybrid,
    };
  });

  scored.sort((first, second) => second.rawHybrid - first.rawHybrid || second.similarity - first.similarity);

  const rankByWord = new Map<string, number>();
  scored.forEach((entry, index) => {
    rankByWord.set(entry.word, index + 1);
  });

  const displayCalibration = buildTargetDisplayCalibration(scored, targetWord);
  const hintWordIndices: number[] = [];

  for (const entry of scored) {
    if (entry.word === targetWord) {
      continue;
    }

    const wordIndex = wordToIndex.get(entry.word);
    if (wordIndex === undefined) {
      continue;
    }

    hintWordIndices.push(wordIndex);
    if (hintWordIndices.length >= TARGET_HINT_TOP_N) {
      break;
    }
  }

  return {
    targetWord,
    orderedWords: scored.map((entry) => entry.word),
    rankByWord,
    displayCalibration,
    calibration: calibrationFromScoredNeighbors(scored, targetWord, displayCalibration),
    hintWordIndices,
  };
}
