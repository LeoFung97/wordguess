import sampleWords from "../../data/sample-words.json";
import targetWords from "../../data/target-words.json";
import type { WordVectorEntry } from "./types";

const TWO_CHARACTER_CHINESE = /^[\u4e00-\u9fff]{2}$/u;

function magnitude(vector: number[]) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

export function normalizeVector(vector: number[]) {
  const length = magnitude(vector);
  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }

  return vector.map((value) => value / length);
}

export function isTwoCharacterChineseWord(word: string) {
  return TWO_CHARACTER_CHINESE.test(word.trim());
}

export function normalizeWord(word: string) {
  return word.trim().replace(/\s+/g, "");
}

export function cosineSimilarity(first: number[], second: number[]) {
  if (first.length !== second.length) {
    throw new Error("Vectors must have the same dimensions.");
  }

  return first.reduce((sum, value, index) => sum + value * second[index], 0);
}

export class VectorStore {
  private readonly entries: WordVectorEntry[];
  private readonly byWord: Map<string, WordVectorEntry>;
  private readonly targetEntries: WordVectorEntry[];

  constructor(entries: WordVectorEntry[], targetWordList?: string[]) {
    this.entries = entries
      .filter((entry) => isTwoCharacterChineseWord(entry.word))
      .map((entry) => ({
        ...entry,
        word: normalizeWord(entry.word),
        vector: normalizeVector(entry.vector),
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

  rankAgainstTarget(targetWord: string, guessWord: string) {
    const target = this.get(targetWord);
    const guess = this.get(guessWord);

    if (!target || !guess) {
      return undefined;
    }

    const ranked = this.entries
      .map((entry) => ({
        word: entry.word,
        similarity: cosineSimilarity(target.vector, entry.vector),
      }))
      .sort((first, second) => second.similarity - first.similarity);

    const rank = ranked.findIndex((entry) => entry.word === guess.word) + 1;
    const percentile = Math.max(0, Math.round((1 - (rank - 1) / (ranked.length - 1)) * 100));

    return {
      rank,
      percentile,
      similarity: ranked[rank - 1]?.similarity ?? 0,
    };
  }
}

export const vectorStore = new VectorStore(sampleWords, targetWords);
