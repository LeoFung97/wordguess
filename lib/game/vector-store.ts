import { readFileSync } from "fs";
import path from "path";
import targetWords from "../../data/target-words.json";
import { computeHybridFeaturesWithContext } from "./hybrid-scorer";
import {
  buildTargetDisplayCalibration,
  calibrationFromScoredNeighbors,
  mapCalibratedDisplayScore,
  rankToPercentile,
  type TargetDisplayCalibration,
} from "./scoring";
import type { SimilarityCalibration } from "./types";
import { semanticKnowledgeStore, type SemanticKnowledgeStore } from "./semantic-knowledge";
import type { WordVectorEntry } from "./types";

const vectorDataPath = path.join(process.cwd(), "data", "vectors.f32");
const wordDataPath = path.join(process.cwd(), "data", "words.json");
const MAX_WORD_LENGTH = 4;

type StoredWordEntry = {
  word: string;
  commonness: number;
};

export type RankedWord = {
  word: string;
  similarity: number;
  percentile: number;
  proximity: number;
  rank: number;
};

type ScoredEntry = {
  word: string;
  similarity: number;
  rawHybrid: number;
};

type TargetRankingCache = {
  targetWord: string;
  scored: ScoredEntry[];
  rankByWord: Map<string, number>;
  displayCalibration: TargetDisplayCalibration;
  calibration: SimilarityCalibration;
};

function magnitude(vector: ArrayLike<number>) {
  let sum = 0;

  for (let index = 0; index < vector.length; index += 1) {
    sum += vector[index] * vector[index];
  }

  return Math.sqrt(sum);
}

export function normalizeVector(vector: ArrayLike<number>) {
  const length = magnitude(vector);
  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }

  return Array.from({ length: vector.length }, (_, index) => vector[index] / length);
}

export function normalizeWord(word: string) {
  return word.trim().replace(/\s+/g, "");
}

export function isAllowedGuessWord(word: string) {
  const normalized = normalizeWord(word);
  return normalized.length >= 1 && normalized.length <= MAX_WORD_LENGTH;
}

export function cosineSimilarity(first: ArrayLike<number>, second: ArrayLike<number>) {
  if (first.length !== second.length) {
    throw new Error("Vectors must have the same dimensions.");
  }

  let sum = 0;

  for (let index = 0; index < first.length; index += 1) {
    sum += first[index] * second[index];
  }

  return sum;
}

function toFloat32Array(buffer: Buffer) {
  if (buffer.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  }

  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Float32Array(bytes.buffer);
}

function loadStoredEntries(): WordVectorEntry[] {
  const words = JSON.parse(readFileSync(wordDataPath, "utf8")) as StoredWordEntry[];
  const vectors = toFloat32Array(readFileSync(vectorDataPath));

  if (words.length === 0) {
    return [];
  }

  if (vectors.length % words.length !== 0) {
    throw new Error("Vector data does not align with word metadata.");
  }

  const vectorLength = vectors.length / words.length;
  return words.map((entry, index) => ({
    ...entry,
    vector: vectors.subarray(index * vectorLength, (index + 1) * vectorLength),
  }));
}

export class VectorStore {
  private readonly entries: WordVectorEntry[];
  private readonly byWord: Map<string, WordVectorEntry>;
  private readonly targetEntries: WordVectorEntry[];
  private readonly knowledge: SemanticKnowledgeStore;
  private readonly targetRankingCache = new Map<string, TargetRankingCache>();

  constructor(
    entries: WordVectorEntry[],
    targetWordList?: string[],
    options: { vectorsAreNormalized?: boolean; knowledge?: SemanticKnowledgeStore } = {},
  ) {
    this.entries = entries
      .filter((entry) => isAllowedGuessWord(entry.word))
      .map((entry) => ({
        ...entry,
        word: normalizeWord(entry.word),
        vector: options.vectorsAreNormalized ? entry.vector : normalizeVector(entry.vector),
      }))
      .sort((first, second) => second.commonness - first.commonness);
    this.byWord = new Map(this.entries.map((entry) => [entry.word, entry]));
    this.knowledge = options.knowledge ?? semanticKnowledgeStore;

    this.targetEntries =
      targetWordList
        ?.map((word) => this.byWord.get(normalizeWord(word)))
        .filter((entry): entry is WordVectorEntry => Boolean(entry)) ?? [];
  }

  has(word: string) {
    return this.byWord.has(normalizeWord(word));
  }

  get(word: string) {
    return this.byWord.get(normalizeWord(word));
  }

  all() {
    return this.entries;
  }

  randomTarget() {
    const targetPool =
      this.targetEntries.length > 0
        ? this.targetEntries
        : this.entries.slice(0, Math.max(12, Math.floor(this.entries.length * 0.65)));
    return targetPool[Math.floor(Math.random() * targetPool.length)];
  }

  private buildTargetRanking(targetWord: string, targetVector: ArrayLike<number>): TargetRankingCache {
    const cached = this.targetRankingCache.get(targetWord);
    if (cached) {
      return cached;
    }

    const targetContext = this.knowledge.createTargetContext(targetWord);
    const scored = this.entries.map((entry) => {
      const similarity = cosineSimilarity(targetVector, entry.vector);
      const features = computeHybridFeaturesWithContext(entry.word, similarity, targetContext, this.knowledge);

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
    const ranking = {
      targetWord,
      scored,
      rankByWord,
      displayCalibration,
      calibration: calibrationFromScoredNeighbors(scored, targetWord, displayCalibration),
    };

    this.targetRankingCache.set(targetWord, ranking);
    return ranking;
  }

  private toRankedWord(ranking: TargetRankingCache, entry: ScoredEntry, rank: number): RankedWord {
    return {
      word: entry.word,
      similarity: entry.similarity,
      rank,
      percentile: rankToPercentile(rank, ranking.scored.length),
      proximity: mapCalibratedDisplayScore(
        entry.rawHybrid,
        ranking.displayCalibration,
        entry.word === ranking.targetWord,
      ),
    };
  }

  warmTarget(targetWord: string) {
    const target = this.get(targetWord);
    if (!target) {
      return;
    }

    this.buildTargetRanking(target.word, target.vector);
  }

  rankedWordsAgainstTarget(targetWord: string): RankedWord[] | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    const ranking = this.buildTargetRanking(target.word, target.vector);

    return ranking.scored.map((entry, index) => this.toRankedWord(ranking, entry, index + 1));
  }

  calibrationForTarget(targetWord: string): SimilarityCalibration | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    return this.buildTargetRanking(target.word, target.vector).calibration;
  }

  pickHintAgainstTarget(
    targetWord: string,
    options: { guessedWords: Set<string>; minRank: number },
  ): RankedWord | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    const ranking = this.buildTargetRanking(target.word, target.vector);
    const startIndex = Math.max(0, options.minRank - 1);

    for (let index = startIndex; index < ranking.scored.length; index += 1) {
      const entry = ranking.scored[index];
      if (entry.word === targetWord || options.guessedWords.has(entry.word)) {
        continue;
      }

      return this.toRankedWord(ranking, entry, index + 1);
    }

    for (let index = 1; index < ranking.scored.length; index += 1) {
      const entry = ranking.scored[index];
      if (entry.word === targetWord || options.guessedWords.has(entry.word)) {
        continue;
      }

      return this.toRankedWord(ranking, entry, index + 1);
    }

    return undefined;
  }

  rankAgainstTarget(targetWord: string, guessWord: string) {
    const target = this.get(targetWord);
    const guess = this.get(guessWord);
    if (!target || !guess) {
      return undefined;
    }

    const ranking = this.buildTargetRanking(target.word, target.vector);
    const rank = ranking.rankByWord.get(guess.word);

    if (rank === undefined) {
      return undefined;
    }

    const guessScore = ranking.scored[rank - 1];
    if (!guessScore || guessScore.word !== guess.word) {
      return undefined;
    }

    return this.toRankedWord(ranking, guessScore, rank);
  }
}

export const vectorStore = new VectorStore(loadStoredEntries(), targetWords, { vectorsAreNormalized: true });
