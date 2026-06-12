import { readFileSync } from "fs";
import path from "path";
import targetWords from "../../data/target-words.json";
import type { WordVectorEntry } from "./types";

const TWO_CHARACTER_CHINESE = /^[\u4e00-\u9fff]{2}$/u;
const vectorDataPath = path.join(process.cwd(), "data", "vectors.f32");
const wordDataPath = path.join(process.cwd(), "data", "words.json");

type StoredWordEntry = {
  word: string;
  commonness: number;
};

export type RankedWord = {
  word: string;
  similarity: number;
  percentile: number;
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

export function isTwoCharacterChineseWord(word: string) {
  return TWO_CHARACTER_CHINESE.test(word.trim());
}

export function normalizeWord(word: string) {
  return word.trim().replace(/\s+/g, "");
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

  constructor(entries: WordVectorEntry[], targetWordList?: string[], options: { vectorsAreNormalized?: boolean } = {}) {
    this.entries = entries
      .filter((entry) => isTwoCharacterChineseWord(entry.word))
      .map((entry) => ({
        ...entry,
        word: normalizeWord(entry.word),
        vector: options.vectorsAreNormalized ? entry.vector : normalizeVector(entry.vector),
      }))
      .sort((first, second) => second.commonness - first.commonness);
    this.byWord = new Map(this.entries.map((entry) => [entry.word, entry]));

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

  rankedWordsAgainstTarget(targetWord: string): RankedWord[] | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    const ranked = this.entries
      .map((entry) => ({
        word: entry.word,
        similarity: cosineSimilarity(target.vector, entry.vector),
      }))
      .sort((first, second) => second.similarity - first.similarity);

    return ranked.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      percentile: Math.max(0, Math.round((1 - index / (ranked.length - 1)) * 10000) / 100),
    }));
  }

  rankAgainstTarget(targetWord: string, guessWord: string) {
    const guess = this.get(guessWord);
    const ranked = this.rankedWordsAgainstTarget(targetWord);
    if (!guess || !ranked) {
      return undefined;
    }

    return ranked.find((entry) => entry.word === guess.word);
  }
}

export const vectorStore = new VectorStore(loadStoredEntries(), targetWords, { vectorsAreNormalized: true });
