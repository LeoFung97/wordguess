import { readFileSync } from "fs";
import path from "path";
import targetWords from "../../data/target-words.json";
import { targetCacheLimit } from "./cache-config";
import { computeHybridFeaturesWithContext } from "./hybrid-scorer";
import { LruCache } from "./lru-cache";
import { buildTargetRanking, type BuiltTargetRanking } from "./ranking-builder";
import {
  mapCalibratedDisplayScore,
  rankToPercentile,
  type TargetDisplayCalibration,
} from "./scoring";
import type { SimilarityCalibration } from "./types";
import { semanticKnowledgeStore, type SemanticKnowledgeStore } from "./semantic-knowledge";
import { TargetRankingsStore } from "./target-rankings";
import type { WordVectorEntry } from "./types";
import { cosineSimilarity, normalizeVector } from "./vector-math";

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

type TargetRankingView = {
  targetWord: string;
  vocabularySize: number;
  displayCalibration: TargetDisplayCalibration;
  calibration: SimilarityCalibration;
  rankForIndex: (guessIndex: number) => number | undefined;
  wordIndexByRank: Uint32Array;
  hintWordIndices: number[];
};

function buildWordIndexByRank(rankForIndex: (guessIndex: number) => number | undefined, vocabularySize: number) {
  const wordIndexByRank = new Uint32Array(vocabularySize + 1);
  for (let index = 0; index < vocabularySize; index += 1) {
    const rank = rankForIndex(index);
    if (rank !== undefined) {
      wordIndexByRank[rank] = index;
    }
  }

  return wordIndexByRank;
}

export { cosineSimilarity, normalizeVector } from "./vector-math";

export function normalizeWord(word: string) {
  return word.trim().replace(/\s+/g, "");
}

export function isAllowedGuessWord(word: string) {
  const normalized = normalizeWord(word);
  return normalized.length >= 1 && normalized.length <= MAX_WORD_LENGTH;
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

function builtRankingToView(ranking: BuiltTargetRanking, vocabularySize: number, wordToIndex: Map<string, number>) {
  const targetIndex = wordToIndex.get(ranking.targetWord);
  const rankByIndex = new Map<number, number>();

  for (const [word, rank] of ranking.rankByWord) {
    const wordIndex = wordToIndex.get(word);
    if (wordIndex !== undefined) {
      rankByIndex.set(wordIndex, rank);
    }
  }

  return {
    targetWord: ranking.targetWord,
    vocabularySize,
    displayCalibration: ranking.displayCalibration,
    calibration: ranking.calibration,
    rankForIndex: (guessIndex: number) => rankByIndex.get(guessIndex),
    wordIndexByRank: buildWordIndexByRank((guessIndex) => rankByIndex.get(guessIndex), vocabularySize),
    hintWordIndices: ranking.hintWordIndices,
  } satisfies TargetRankingView;
}

export class VectorStore {
  private readonly entries: WordVectorEntry[];
  private readonly byWord: Map<string, WordVectorEntry>;
  private readonly wordToIndex: Map<string, number>;
  private readonly targetEntries: WordVectorEntry[];
  private readonly knowledge: SemanticKnowledgeStore;
  private readonly rankingsStore?: TargetRankingsStore;
  private readonly targetRankingCache = new LruCache<string, TargetRankingView>(targetCacheLimit());

  constructor(
    entries: WordVectorEntry[],
    targetWordList?: string[],
    options: {
      vectorsAreNormalized?: boolean;
      knowledge?: SemanticKnowledgeStore;
      rankingsStore?: TargetRankingsStore;
    } = {},
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
    this.wordToIndex = new Map(this.entries.map((entry, index) => [entry.word, index]));
    this.knowledge = options.knowledge ?? semanticKnowledgeStore;

    const loadedRankings = options.rankingsStore ?? TargetRankingsStore.tryLoad();
    if (loadedRankings && loadedRankings.vocabularySize === this.entries.length) {
      this.rankingsStore = loadedRankings;
    }

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

  private resolveTargetRanking(targetWord: string, targetVector: ArrayLike<number>): TargetRankingView {
    const cached = this.targetRankingCache.get(targetWord);
    if (cached) {
      return cached;
    }

    const targetIndex = this.wordToIndex.get(targetWord);
    if (this.rankingsStore && targetIndex !== undefined && this.rankingsStore.hasTarget(targetIndex)) {
      const displayCalibration = this.rankingsStore.getDisplayCalibration(targetIndex);
      const calibration = this.rankingsStore.getCalibration(targetIndex);
      if (displayCalibration && calibration) {
        const rankForIndex = (guessIndex: number) => this.rankingsStore!.getRank(targetIndex, guessIndex);
        const ranking: TargetRankingView = {
          targetWord,
          vocabularySize: this.entries.length,
          displayCalibration,
          calibration,
          rankForIndex,
          wordIndexByRank: buildWordIndexByRank(rankForIndex, this.entries.length),
          hintWordIndices: this.rankingsStore.getHintWordIndices(targetIndex),
        };
        this.targetRankingCache.set(targetWord, ranking, (evictedTarget) => {
          this.knowledge.evictTarget(evictedTarget);
        });
        return ranking;
      }
    }

    const built = buildTargetRanking(targetWord, targetVector, this.entries, this.wordToIndex, this.knowledge);
    const ranking = builtRankingToView(built, this.entries.length, this.wordToIndex);
    this.targetRankingCache.set(targetWord, ranking, (evictedTarget) => {
      this.knowledge.evictTarget(evictedTarget);
    });
    return ranking;
  }

  private scoreEntry(
    targetWord: string,
    targetVector: ArrayLike<number>,
    guess: WordVectorEntry,
  ): ScoredEntry {
    const similarity = cosineSimilarity(targetVector, guess.vector);
    const targetContext = this.knowledge.createTargetContext(targetWord);
    const features = computeHybridFeaturesWithContext(guess.word, similarity, targetContext, this.knowledge);

    return {
      word: guess.word,
      similarity,
      rawHybrid: features.rawHybrid,
    };
  }

  private toRankedWord(
    ranking: TargetRankingView,
    entry: ScoredEntry,
    rank: number,
  ): RankedWord {
    return {
      word: entry.word,
      similarity: entry.similarity,
      rank,
      percentile: rankToPercentile(rank, ranking.vocabularySize),
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

    this.resolveTargetRanking(target.word, target.vector);
  }

  rankedWordsAgainstTarget(targetWord: string): RankedWord[] | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    const ranking = this.resolveTargetRanking(target.word, target.vector);
    const results: RankedWord[] = [];

    for (let rank = 1; rank <= ranking.vocabularySize; rank += 1) {
      const wordIndex = ranking.wordIndexByRank[rank];
      if (wordIndex === undefined) {
        continue;
      }

      const entry = this.entries[wordIndex];
      if (!entry) {
        continue;
      }

      results.push(
        this.toRankedWord(ranking, this.scoreEntry(target.word, target.vector, entry), rank),
      );
    }

    return results;
  }

  calibrationForTarget(targetWord: string): SimilarityCalibration | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    return this.resolveTargetRanking(target.word, target.vector).calibration;
  }

  pickHintAgainstTarget(
    targetWord: string,
    options: { guessedWords: Set<string>; minRank: number },
  ): RankedWord | undefined {
    const target = this.get(targetWord);
    if (!target) {
      return undefined;
    }

    const ranking = this.resolveTargetRanking(target.word, target.vector);
    const startRank = Math.max(1, options.minRank);

    for (const wordIndex of ranking.hintWordIndices) {
      const entry = this.entries[wordIndex];
      if (!entry) {
        continue;
      }

      const rank = ranking.rankForIndex(wordIndex);
      if (rank === undefined || rank < startRank) {
        continue;
      }

      if (entry.word === targetWord || options.guessedWords.has(entry.word)) {
        continue;
      }

      return this.toRankedWord(ranking, this.scoreEntry(target.word, target.vector, entry), rank);
    }

    for (const wordIndex of ranking.hintWordIndices) {
      const entry = this.entries[wordIndex];
      if (!entry) {
        continue;
      }

      const rank = ranking.rankForIndex(wordIndex);
      if (rank === undefined || entry.word === targetWord || options.guessedWords.has(entry.word)) {
        continue;
      }

      return this.toRankedWord(ranking, this.scoreEntry(target.word, target.vector, entry), rank);
    }

    return undefined;
  }

  rankAgainstTarget(targetWord: string, guessWord: string) {
    const target = this.get(targetWord);
    const guess = this.get(guessWord);
    if (!target || !guess) {
      return undefined;
    }

    const ranking = this.resolveTargetRanking(target.word, target.vector);
    const guessIndex = this.wordToIndex.get(guess.word);
    if (guessIndex === undefined) {
      return undefined;
    }

    const rank = ranking.rankForIndex(guessIndex);
    if (rank === undefined) {
      return undefined;
    }

    return this.toRankedWord(ranking, this.scoreEntry(target.word, target.vector, guess), rank);
  }
}

export const vectorStore = new VectorStore(loadStoredEntries(), targetWords, { vectorsAreNormalized: true });
