import { describe, expect, it } from "vitest";
import { formatSimilarity } from "./engine";
import { DOLPHIN_REFERENCE } from "./reference/dolphin-external";
import { STARRY_SKY_REFERENCE } from "./reference/starry-sky-external";
import type { ExternalTargetSuite } from "./reference/types";
import { vectorStore } from "./vector-store";

function heatFor(target: string, word: string) {
  return vectorStore.rankAgainstTarget(target, word)?.proximity ?? 0;
}

function rankFor(target: string, word: string) {
  return vectorStore.rankAgainstTarget(target, word)?.rank ?? Number.MAX_SAFE_INTEGER;
}

function describeExternalReference(reference: ExternalTargetSuite) {
  describe(`external reference: ${reference.target}`, () => {
    it("has the target in vocabulary", () => {
      expect(vectorStore.has(reference.target)).toBe(true);
    });

    it("scores the answer at 100 heat", () => {
      const answer = vectorStore.rankAgainstTarget(reference.target, reference.target);
      expect(answer?.proximity).toBe(100);
      expect(formatSimilarity(answer?.similarity ?? 0)).toBe(100);
    });

    it("scores cluster guesses hotter than unrelated words", () => {
      const unrelated = reference.unrelated?.[0];
      if (!unrelated) {
        return;
      }

      const unrelatedHeat = heatFor(reference.target, unrelated);
      for (const { word } of reference.guesses) {
        expect(heatFor(reference.target, word)).toBeGreaterThan(unrelatedHeat);
      }
    });

    it("keeps cluster guesses in a reasonable top rank band", () => {
      for (const { word } of reference.guesses) {
        expect(rankFor(reference.target, word)).toBeLessThan(5000);
      }
    });
  });
}

describe("display calibration on real targets", () => {
  it("lands rank ~100 and rank ~1000 near intended UX bands", () => {
    for (const target of [DOLPHIN_REFERENCE.target, STARRY_SKY_REFERENCE.target]) {
      const ranked = vectorStore.rankedWordsAgainstTarget(target);
      expect(ranked).toBeDefined();

      const neighbors = ranked!.filter((entry) => entry.word !== target);
      const rank100 = neighbors[99];
      const rank1000 = neighbors[999];

      expect(rank100).toBeDefined();
      expect(rank1000).toBeDefined();
      expect(rank100.proximity).toBeGreaterThanOrEqual(80);
      expect(rank100.proximity).toBeLessThanOrEqual(86);
      expect(rank1000.proximity).toBeGreaterThanOrEqual(52);
      expect(rank1000.proximity).toBeLessThanOrEqual(58);
    }
  });

  it("produces different top-neighbor display scores across targets", () => {
    const dolphinNearest = vectorStore.calibrationForTarget(DOLPHIN_REFERENCE.target)?.nearest;
    const starryNearest = vectorStore.calibrationForTarget(STARRY_SKY_REFERENCE.target)?.nearest;

    expect(dolphinNearest).toBeDefined();
    expect(starryNearest).toBeDefined();
    expect(dolphinNearest).not.toBeCloseTo(starryNearest!, 0);
  });

  it("preserves ranking order after display calibration", () => {
    for (const target of [DOLPHIN_REFERENCE.target, STARRY_SKY_REFERENCE.target]) {
      const ranked = vectorStore.rankedWordsAgainstTarget(target);
      expect(ranked).toBeDefined();

      for (let index = 1; index < ranked!.length; index += 1) {
        expect(ranked![index - 1].proximity).toBeGreaterThanOrEqual(ranked![index].proximity);
      }
    }
  });
});

describeExternalReference(DOLPHIN_REFERENCE);
describeExternalReference(STARRY_SKY_REFERENCE);

describe("external reference: 海豚 order", () => {
  it("ranks 鲸鱼 above 鹦鹉 and 金鱼", () => {
    const whale = vectorStore.rankAgainstTarget(DOLPHIN_REFERENCE.target, "鲸鱼");
    const parrot = vectorStore.rankAgainstTarget(DOLPHIN_REFERENCE.target, "鹦鹉");
    const goldfish = vectorStore.rankAgainstTarget(DOLPHIN_REFERENCE.target, "金鱼");

    expect(whale?.rank).toBeLessThan(parrot?.rank ?? Number.MAX_SAFE_INTEGER);
    expect(whale?.rank).toBeLessThan(goldfish?.rank ?? Number.MAX_SAFE_INTEGER);
    expect(heatFor(DOLPHIN_REFERENCE.target, "鲸鱼")).toBeGreaterThan(
      heatFor(DOLPHIN_REFERENCE.target, "鹦鹉"),
    );
  });
});

describe("external reference: 星空 order", () => {
  it("ranks sky-cluster words above 航空", () => {
    const aviation = rankFor(STARRY_SKY_REFERENCE.target, "航空");
    for (const word of ["星星", "天空", "星河", "航天"]) {
      expect(rankFor(STARRY_SKY_REFERENCE.target, word)).toBeLessThan(aviation);
    }
  });

  it("places 星河, 天空, and 星星 in the top 50", () => {
    for (const word of ["星河", "天空", "星星"]) {
      expect(rankFor(STARRY_SKY_REFERENCE.target, word)).toBeLessThanOrEqual(50);
    }
  });
});
