import { randomUUID } from "crypto";
import type { CreateGameResult, GuessResult, GuessTemperature, PublicGameState } from "./types";
import { normalizeWord, vectorStore, type RankedWord, type VectorStore } from "./vector-store";

type GameSession = {
  gameId: string;
  targetWord: string;
  guesses: GuessResult[];
  solved: boolean;
};

function percentileToTemperature(percentile: number, isCorrect: boolean): GuessTemperature {
  if (isCorrect) {
    return "solved";
  }

  if (percentile >= 99.9) {
    return "burning";
  }

  if (percentile >= 99) {
    return "hot";
  }

  if (percentile >= 95) {
    return "warm";
  }

  if (percentile >= 75) {
    return "cold";
  }

  return "ice";
}

export function formatSimilarity(rawSimilarity: number) {
  return Math.round(Math.max(0, rawSimilarity) * 10000) / 100;
}

export function bestGuess(guesses: GuessResult[]) {
  return guesses
    .filter((guess) => !guess.isCorrect)
    .toSorted((first, second) => first.rank - second.rank)[0];
}

export function toPublicGameState(session: GameSession): PublicGameState {
  return {
    gameId: session.gameId,
    guesses: session.guesses,
    bestGuess: bestGuess(session.guesses),
    solved: session.solved,
    attempts: session.guesses.length,
  };
}

function toGuessResult(session: GameSession, ranked: RankedWord, playerName?: string): GuessResult {
  const isCorrect = ranked.word === session.targetWord;
  const similarity = formatSimilarity(ranked.similarity);

  return {
    word: ranked.word,
    playerName,
    attempt: session.guesses.length + 1,
    similarity,
    percentile: ranked.percentile,
    rank: ranked.rank,
    temperature: percentileToTemperature(ranked.percentile, isCorrect),
    isCorrect,
    createdAt: Date.now(),
  };
}

export class GameEngine {
  private readonly sessions = new Map<string, GameSession>();

  constructor(private readonly store: VectorStore = vectorStore) {}

  createGame(): CreateGameResult {
    const target = this.store.randomTarget();
    const session: GameSession = {
      gameId: randomUUID(),
      targetWord: target.word,
      guesses: [],
      solved: false,
    };

    this.sessions.set(session.gameId, session);

    return {
      ...toPublicGameState(session),
      targetLength: target.word.length,
    };
  }

  createSharedSession(targetWord = this.store.randomTarget().word) {
    return {
      gameId: randomUUID(),
      targetWord,
      guesses: [],
      solved: false,
    } satisfies GameSession;
  }

  getGame(gameId: string) {
    const session = this.sessions.get(gameId);
    return session ? toPublicGameState(session) : undefined;
  }

  submitGuess(gameId: string, rawWord: string, playerName?: string) {
    const session = this.sessions.get(gameId);
    if (!session) {
      throw new Error("找不到这一局游戏。");
    }

    return this.submitGuessToSession(session, rawWord, playerName);
  }

  revealHint(gameId: string) {
    const session = this.sessions.get(gameId);
    if (!session) {
      throw new Error("找不到这一局游戏。");
    }

    return this.revealHintInSession(session);
  }

  submitGuessToSession(session: GameSession, rawWord: string, playerName?: string) {
    if (session.solved) {
      throw new Error("这一局已经结束。");
    }

    const word = normalizeWord(rawWord);
    if (!this.store.has(word)) {
      throw new Error("请输入词库中的两个汉字常用词。");
    }

    if (session.guesses.some((guess) => guess.word === word)) {
      throw new Error("这个词已经猜过了。");
    }

    const ranked = this.store.rankAgainstTarget(session.targetWord, word);
    if (!ranked) {
      throw new Error("无法计算这个词的语义距离。");
    }

    const guess = toGuessResult(session, ranked, playerName);

    session.guesses.push(guess);
    session.solved = session.solved || guess.isCorrect;

    return {
      guess,
      state: toPublicGameState(session),
    };
  }

  revealHintInSession(session: GameSession) {
    if (session.solved) {
      throw new Error("这一局已经结束。");
    }

    const ranked = this.store.rankedWordsAgainstTarget(session.targetWord);
    if (!ranked) {
      throw new Error("无法生成提示。");
    }

    const guessedWords = new Set(session.guesses.map((guess) => guess.word));
    const bestRank = bestGuess(session.guesses)?.rank ?? ranked.length;
    const targetRank = Math.max(2, Math.floor(bestRank * 0.6));
    const hint =
      ranked.find((entry) => entry.rank >= targetRank && entry.word !== session.targetWord && !guessedWords.has(entry.word)) ??
      ranked.find((entry) => entry.rank > 1 && entry.word !== session.targetWord && !guessedWords.has(entry.word));

    if (!hint) {
      throw new Error("没有可用提示了。");
    }

    const guess = toGuessResult(session, hint, "提示");
    session.guesses.push(guess);

    return {
      guess,
      state: toPublicGameState(session),
    };
  }
}

export const gameEngine = new GameEngine();
