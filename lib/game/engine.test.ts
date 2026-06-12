import { describe, expect, it } from "vitest";
import { GameEngine, formatSimilarity } from "./engine";
import { cosineSimilarity, isTwoCharacterChineseWord, normalizeVector, VectorStore } from "./vector-store";

const testStore = new VectorStore([
  { word: "朋友", commonness: 10, vector: [1, 0, 0] },
  { word: "同学", commonness: 9, vector: [0.9, 0.1, 0] },
  { word: "城市", commonness: 8, vector: [0, 1, 0] },
  { word: "电影", commonness: 7, vector: [0, 0, 1] },
]);

describe("vector helpers", () => {
  it("normalizes vectors for cosine scoring", () => {
    const vector = normalizeVector([3, 4]);

    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
    expect(cosineSimilarity(vector, vector)).toBeCloseTo(1);
  });

  it("accepts only two-character Chinese words", () => {
    expect(isTwoCharacterChineseWord("朋友")).toBe(true);
    expect(isTwoCharacterChineseWord("朋友们")).toBe(false);
    expect(isTwoCharacterChineseWord("AI")).toBe(false);
  });
});

describe("game engine", () => {
  it("scores guesses against a target word", () => {
    const engine = new GameEngine(testStore);
    const session = engine.createSharedSession("朋友");
    const result = engine.submitGuessToSession(session, "同学");

    expect(result.guess.word).toBe("同学");
    expect(result.guess.similarity).toBeGreaterThan(90);
    expect(result.state.solved).toBe(false);
  });

  it("marks the target word as solved", () => {
    const engine = new GameEngine(testStore);
    const session = engine.createSharedSession("朋友");
    const result = engine.submitGuessToSession(session, "朋友");

    expect(result.guess.isCorrect).toBe(true);
    expect(result.guess.temperature).toBe("solved");
    expect(result.state.solved).toBe(true);
  });

  it("rejects words outside the vocabulary", () => {
    const engine = new GameEngine(testStore);
    const session = engine.createSharedSession("朋友");

    expect(() => engine.submitGuessToSession(session, "不存在")).toThrow("词库");
  });

  it("chooses targets from a curated answer list while accepting all guess words", () => {
    const store = new VectorStore(
      [
        { word: "朋友", commonness: 10, vector: [1, 0, 0] },
        { word: "同学", commonness: 9, vector: [0.9, 0.1, 0] },
        { word: "城市", commonness: 8, vector: [0, 1, 0] },
      ],
      ["城市"],
    );
    const engine = new GameEngine(store);
    const game = engine.createGame();

    expect(store.has("朋友")).toBe(true);
    expect(game.targetLength).toBe(2);
    expect(engine.submitGuess(game.gameId, "朋友").guess.word).toBe("朋友");
    expect(engine.submitGuess(game.gameId, "城市").guess.isCorrect).toBe(true);
  });

  it("formats negative similarities as zero", () => {
    expect(formatSimilarity(-0.5)).toBe(0);
  });
});
