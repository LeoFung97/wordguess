import { describe, expect, it } from "vitest";
import { GameEngine, formatSimilarity } from "./engine";
import {
  computeProximity,
  cosineSimilarity,
  formatTopPercentLabel,
  normalizeVector,
  rankToPercentile,
  VectorStore,
} from "./vector-store";

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

  it("keeps words up to four characters", () => {
    const store = new VectorStore([
      { word: "朋友", commonness: 10, vector: [1, 0, 0] },
      { word: "人工智能", commonness: 9, vector: [0.9, 0.1, 0] },
      { word: "幸福快乐每一天", commonness: 8, vector: [0, 1, 0] },
    ]);

    expect(store.has("朋友")).toBe(true);
    expect(store.has("人工智能")).toBe(true);
    expect(store.has("幸福快乐每一天")).toBe(false);
    expect(store.all()).toHaveLength(2);
  });

  it("maps rank to a top-percentile position", () => {
    expect(rankToPercentile(1, 10_000)).toBeCloseTo(0.01);
    expect(rankToPercentile(100, 10_000)).toBeCloseTo(1);
    expect(rankToPercentile(10_000, 10_000)).toBeCloseTo(100);
  });

  it("formats top percent with adaptive precision", () => {
    expect(formatTopPercentLabel(0.0014)).toBe("前 0.001%");
    expect(formatTopPercentLabel(0.12)).toBe("前 0.12%");
    expect(formatTopPercentLabel(12.3)).toBe("前 12.3%");
  });

  it("maps cosine to a monotonic power-curve proximity score", () => {
    const minCos = 0.1;
    const maxCos = 0.9;

    expect(computeProximity(1, minCos, maxCos, true)).toBe(100);
    expect(computeProximity(0.9, minCos, maxCos)).toBeGreaterThan(computeProximity(0.5, minCos, maxCos));
    expect(computeProximity(0.5, minCos, maxCos)).toBeGreaterThan(computeProximity(0.1, minCos, maxCos));
    expect(computeProximity(0.1, minCos, maxCos)).toBe(0);
    expect(computeProximity(0.9, minCos, maxCos)).toBeLessThan(100);
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

  it("reveals a non-answer hint as a system guess", () => {
    const engine = new GameEngine(testStore);
    const session = engine.createSharedSession("朋友");
    const result = engine.revealHintInSession(session);

    expect(result.guess.word).not.toBe("朋友");
    expect(result.guess.playerName).toBe("提示");
    expect(result.state.guesses).toHaveLength(1);
  });

  it("formats negative similarities as zero", () => {
    expect(formatSimilarity(-0.5)).toBe(0);
  });
});
