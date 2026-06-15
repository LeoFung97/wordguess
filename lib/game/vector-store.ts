import { readFileSync } from "fs";
import path from "path";
import targetWords from "../../data/target-words.json";
import { computeHybridRawScore } from "./hybrid-scorer";
import { computeHybridDisplayScore, rankToPercentile } from "./scoring";
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

  private scoreEntryAgainstTarget(targetWord: string, targetVector: ArrayLike<number>, entry: WordVectorEntry) {
    const cosine = cosineSimilarity(targetVector, entry.vector);
    const rawHybrid = computeHybridRawScore(targetWord, entry.word, cosine, this.knowledge);

    return {
      word: entry.word,
      similarity: cosine,
      rawHybrid,
    };
  }

  rankedWordsAgainstTarget(targetWord: string): RankedWord[] | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    const ranked = this.entries
      .map((entry) => this.scoreEntryAgainstTarget(target.word, target.vector, entry))
      .sort((first, second) => second.rawHybrid - first.rawHybrid || second.similarity - first.similarity);

    return ranked.map((entry, index) => {
      const rank = index + 1;

      return {
        word: entry.word,
        similarity: entry.similarity,
        rank,
        percentile: rankToPercentile(rank, ranked.length),
        proximity: computeHybridDisplayScore(entry.rawHybrid, entry.word === targetWord),
      };
    });
  }

  rankAgainstTarget(targetWord: string, guessWord: string) {
    const target = this.get(targetWord);
    const guess = this.get(guessWord);
    if (!target || !guess) {
      return undefined;
    }

    const scored = this.entries.map((entry) => this.scoreEntryAgainstTarget(target.word, target.vector, entry));
    const guessScore = this.scoreEntryAgainstTarget(target.word, target.vector, guess);
    let rank = 1;

    for (const entry of scored) {
      if (entry.rawHybrid > guessScore.rawHybrid) {
        rank += 1;
      }
    }

    const totalWords = this.entries.length;

    return {
      word: guess.word,
      similarity: guessScore.similarity,
      rank,
      percentile: rankToPercentile(rank, totalWords),
      proximity: computeHybridDisplayScore(guessScore.rawHybrid, guess.word === targetWord),
    };
  }
}

export const vectorStore = new VectorStore(loadStoredEntries(), targetWords, { vectorsAreNormalized: true });
