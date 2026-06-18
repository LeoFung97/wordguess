import { randomUUID } from "crypto";
import type { CreateGameResult, GuessResult, GuessTemperature, PublicGameState } from "./types";
import { normalizeWord, vectorStore, type RankedWord, type VectorStore } from "./vector-store";

type GameSession = {
  gameId: string;
  targetWord: string;
  guesses: GuessResult[];
  solved: boolean;
};

const DEFAULT_FIRST_HINT_RANK = 1000;

function proximityToTemperature(proximity: number, isCorrect: boolean): GuessTemperature {
  if (isCorrect) {
    return "solved";
  }

  if (proximity >= 95) {
    return "burning";
  }

  if (proximity >= 80) {
    return "hot";
  }

  if (proximity >= 55) {
    return "warm";
  }

  if (proximity >= 25) {
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
    .toSorted((first, second) => second.proximity - first.proximity || first.rank - second.rank)[0];
}

export function toPublicGameState(session: GameSession, store: VectorStore = vectorStore): PublicGameState {
  const calibration = store.calibrationForTarget(session.targetWord);
  if (!calibration) {
    throw new Error("无法计算本局的参考刻度。");
  }

  return {
    gameId: session.gameId,
    guesses: session.guesses,
    bestGuess: bestGuess(session.guesses),
    solved: session.solved,
    attempts: session.guesses.length,
    calibration,
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
    proximity: ranked.proximity,
    rank: ranked.rank,
    temperature: proximityToTemperature(ranked.proximity, isCorrect),
    isCorrect,
    createdAt: Date.now(),
  };
}

export class GameEngine {
  private readonly sessions = new Map<string, GameSession>();

  constructor(private readonly store: VectorStore = vectorStore) {}

  getCalibration(targetWord: string) {
    const calibration = this.store.calibrationForTarget(targetWord);
    if (!calibration) {
      throw new Error("无法计算本局的参考刻度。");
    }

    return calibration;
  }

  createGame(): CreateGameResult {
    const target = this.store.randomTarget();
    this.store.warmTarget(target.word);
    const session: GameSession = {
      gameId: randomUUID(),
      targetWord: target.word,
      guesses: [],
      solved: false,
    };

    this.sessions.set(session.gameId, session);

    return {
      ...toPublicGameState(session, this.store),
      targetLength: target.word.length,
    };
  }

  validateGuessWord(rawWord: string) {
    const word = normalizeWord(rawWord);
    if (!this.store.has(word)) {
      throw new Error("请输入词库中的词。");
    }

    return word;
  }

  createSharedSession(targetWord = this.store.randomTarget().word) {
    this.store.warmTarget(targetWord);
    return {
      gameId: randomUUID(),
      targetWord,
      guesses: [],
      solved: false,
    } satisfies GameSession;
  }

  resetSharedSession(session: GameSession) {
    const fresh = this.createSharedSession();
    session.gameId = fresh.gameId;
    session.targetWord = fresh.targetWord;
    session.guesses = [];
    session.solved = false;
    return session;
  }

  getGame(gameId: string) {
    const session = this.sessions.get(gameId);
    return session ? toPublicGameState(session, this.store) : undefined;
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
      throw new Error("请输入词库中的词。");
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
      state: toPublicGameState(session, this.store),
    };
  }

  revealHintInSession(session: GameSession) {
    if (session.solved) {
      throw new Error("这一局已经结束。");
    }

    const guessedWords = new Set(session.guesses.map((guess) => guess.word));
    const bestRank = bestGuess(session.guesses)?.rank;
    const targetRank =
      bestRank === undefined
        ? DEFAULT_FIRST_HINT_RANK
        : Math.max(2, Math.floor(bestRank * 0.6));
    const hint = this.store.pickHintAgainstTarget(session.targetWord, {
      guessedWords,
      minRank: targetRank,
    });

    if (!hint) {
      throw new Error("没有可用提示了。");
    }

    const guess = toGuessResult(session, hint, "提示");
    session.guesses.push(guess);

    return {
      guess,
      state: toPublicGameState(session, this.store),
    };
  }
}

export const gameEngine = new GameEngine();
