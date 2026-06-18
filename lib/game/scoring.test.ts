import { describe, expect, it } from "vitest";
import {
  buildTargetDisplayCalibration,
  computeDynamicTopDisplay,
  floorNeighborIndex,
  mapCalibratedDisplayScore,
} from "./scoring";

function makeNeighbors(rawScores: number[], targetWord = "目标") {
  return rawScores.map((rawHybrid, index) => ({
    word: index === 0 ? targetWord : `词${index}`,
    rawHybrid,
  }));
}

describe("target display calibration", () => {
  it("returns 100 for the answer", () => {
    const scored = makeNeighbors([1, 0.9, 0.8, 0.7, 0.6]);
    const calibration = buildTargetDisplayCalibration(scored, "目标");

    expect(mapCalibratedDisplayScore(1, calibration, true)).toBe(100);
  });

  it("maps display score strictly increasing with rawHybrid above the floor", () => {
    const rawScores = Array.from({ length: 2000 }, (_, index) => 1 - index * 0.0004);
    const scored = makeNeighbors(rawScores);
    const calibration = buildTargetDisplayCalibration(scored, "目标");
    const floorRaw = rawScores[floorNeighborIndex(rawScores.length - 1) + 1];

    const displays = scored
      .filter((entry) => entry.word !== "目标" && entry.rawHybrid > floorRaw)
      .map((entry) => ({ raw: entry.rawHybrid, display: mapCalibratedDisplayScore(entry.rawHybrid, calibration) }));

    for (let index = 1; index < displays.length; index += 1) {
      expect(displays[index - 1].display).toBeGreaterThanOrEqual(displays[index].display);
      if (displays[index - 1].raw > displays[index].raw + 1e-9) {
        expect(displays[index - 1].display).toBeGreaterThan(displays[index].display);
      }
    }
  });

  it("pins rank ~100 and rank ~1000 near intended UX bands", () => {
    const rawScores = Array.from({ length: 1500 }, (_, index) => 1 - index * 0.0005);
    const scored = makeNeighbors(rawScores);
    const calibration = buildTargetDisplayCalibration(scored, "目标");

    const rank100 = mapCalibratedDisplayScore(rawScores[100], calibration);
    const rank1000 = mapCalibratedDisplayScore(rawScores[1000], calibration);

    expect(rank100).toBeGreaterThanOrEqual(80);
    expect(rank100).toBeLessThanOrEqual(86);
    expect(rank1000).toBeGreaterThanOrEqual(52);
    expect(rank1000).toBeLessThanOrEqual(58);
  });

  it("varies top-neighbor display across different target distributions", () => {
    const steepHead = makeNeighbors(
      [1, 0.95, 0.94, 0.93, ...Array.from({ length: 200 }, (_, index) => 0.5 - index * 0.001)],
      "陡",
    );
    const flatHead = makeNeighbors(
      [1, 0.72, 0.71, 0.7, ...Array.from({ length: 200 }, (_, index) => 0.4 - index * 0.001)],
      "平",
    );

    const steepCalibration = buildTargetDisplayCalibration(steepHead, "陡");
    const flatCalibration = buildTargetDisplayCalibration(flatHead, "平");

    const steepTop = mapCalibratedDisplayScore(steepHead[1].rawHybrid, steepCalibration);
    const flatTop = mapCalibratedDisplayScore(flatHead[1].rawHybrid, flatCalibration);

    expect(steepTop).toBeGreaterThan(flatTop);
    expect(steepTop).toBeGreaterThanOrEqual(88);
    expect(flatTop).toBeGreaterThanOrEqual(87);
    expect(flatTop).toBeLessThanOrEqual(99);
  });

  it("uses a robust floor index instead of the absolute worst neighbor", () => {
    const neighborCount = 10_000;
    const floorIndex = floorNeighborIndex(neighborCount);

    expect(floorIndex).toBeLessThan(neighborCount - 1);
    expect(floorIndex).toBeGreaterThanOrEqual(8800);
  });

  it("computes a dynamic top ceiling from head spread", () => {
    expect(computeDynamicTopDisplay(0.95, 0.94, 0.5)).toBeGreaterThan(computeDynamicTopDisplay(0.72, 0.71, 0.5));
    expect(computeDynamicTopDisplay(0.95, 0.94, 0.5)).toBeGreaterThanOrEqual(87);
    expect(computeDynamicTopDisplay(0.95, 0.94, 0.5)).toBeLessThanOrEqual(99);
  });
});
