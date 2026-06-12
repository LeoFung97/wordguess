import { randomUUID } from "crypto";
import type { CreateGameResult, GuessResult, GuessTemperature, PublicGameState } from "./types";
import { normalizeWord, vectorStore, type VectorStore } from "./vector-store";

type GameSession = {
  gameId: string;
  targetWord: string;
  guesses: GuessResult[];
  solved: boolean;
};

function scoreToTemperature(score: number, isCorrect: boolean): GuessTemperature {
  if (isCorrect) {
    return "solved";
  }

  if (score >= 85) {
    return "burning";
  }

  if (score >= 70) {
    return "hot";
  }

  if (score >= 52) {
    return "warm";
  }

  if (score >= 34) {
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
    .toSorted((first, second) => second.similarity - first.similarity)[0];
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

    const isCorrect = word === session.targetWord;
    const similarity = formatSimilarity(ranked.similarity);
    const guess: GuessResult = {
      word,
      playerName,
      attempt: session.guesses.length + 1,
      similarity,
      percentile: ranked.percentile,
      rank: ranked.rank,
      temperature: scoreToTemperature(similarity, isCorrect),
      isCorrect,
      createdAt: Date.now(),
    };

    session.guesses.push(guess);
    session.solved = session.solved || isCorrect;

    return {
      guess,
      state: toPublicGameState(session),
    };
  }
}

export const gameEngine = new GameEngine();
