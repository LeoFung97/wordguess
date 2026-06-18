import type { SimilarityCalibration } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calibrationAt(proximities: number[], index: number) {
  if (proximities.length === 0) {
    return 0;
  }

  return proximities[Math.min(index, proximities.length - 1)] ?? 0;
}

/** Semantle-style reference anchors for the current target (excludes the answer). */
export function computeSimilarityCalibration(
  ranked: { word: string; proximity: number }[],
  targetWord: string,
): SimilarityCalibration {
  const proximities = ranked.filter((entry) => entry.word !== targetWord).map((entry) => entry.proximity);

  return {
    nearest: calibrationAt(proximities, 0),
    tenth: calibrationAt(proximities, 9),
    thousandth: calibrationAt(proximities, 999),
  };
}

export function rankToPercentile(rank: number, totalWords: number) {
  if (totalWords <= 0) {
    return 0;
  }

  return (rank / totalWords) * 100;
}

export function formatTopPercentLabel(topPercent: number) {
  if (topPercent < 0.01) {
    return `前 ${topPercent.toFixed(3)}%`;
  }

  if (topPercent < 1) {
    return `前 ${topPercent.toFixed(2)}%`;
  }

  return `前 ${topPercent.toFixed(1)}%`;
}

export type DisplayKnot = {
  raw: number;
  display: number;
};

export type TargetDisplayCalibration = {
  knots: DisplayKnot[];
};

const DISPLAY_WARM = 55;
const DISPLAY_HOT = 83;
const FLOOR_PERCENTILE = 0.88;
const FLOOR_TAIL_EXCLUDE = 0.02;

function neighborRawAt(neighbors: Array<{ rawHybrid: number }>, oneBasedRank: number) {
  if (neighbors.length === 0) {
    return 0;
  }

  const index = Math.min(oneBasedRank - 1, neighbors.length - 1);
  return neighbors[index].rawHybrid;
}

/** Robust low raw anchor: high rank percentile, excluding the worst tail. */
export function floorNeighborIndex(neighborCount: number) {
  if (neighborCount <= 1) {
    return 0;
  }

  const tailExclude = Math.max(1, Math.ceil(neighborCount * FLOOR_TAIL_EXCLUDE));
  const maxIndex = neighborCount - tailExclude - 1;
  const percentileIndex = Math.floor(neighborCount * FLOOR_PERCENTILE);
  const rank1000Index = Math.min(999, maxIndex);

  return Math.min(maxIndex, Math.max(percentileIndex, rank1000Index));
}

/** Dynamic top ceiling from head shape — varies by target, usually high 80s to high 90s. */
export function computeDynamicTopDisplay(s1: number, s10: number, s100: number) {
  const innerSpread = clamp((s1 - s10) / Math.max(s1 - s100, 1e-9), 0, 1);
  const headLift = clamp((s1 - s100) / Math.max(s100, 1e-9), 0, 1);
  const blend = 0.45 * innerSpread + 0.55 * headLift;

  return 87 + 12 * clamp(blend, 0, 1);
}

function normalizeKnots(knots: DisplayKnot[]): DisplayKnot[] {
  const sorted = [...knots].sort((first, second) => first.raw - second.raw || first.display - second.display);
  const result: DisplayKnot[] = [];

  for (const knot of sorted) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push({ ...knot });
      continue;
    }

    if (knot.raw <= previous.raw + 1e-12) {
      previous.display = Math.max(previous.display, knot.display);
      continue;
    }

    const display = knot.display <= previous.display ? previous.display + 1e-6 : knot.display;
    result.push({ raw: knot.raw, display });
  }

  return result;
}

/** Builds a per-target monotonic raw→display knot table from sorted neighbors (answer excluded). */
export function buildTargetDisplayCalibration(
  scored: Array<{ word: string; rawHybrid: number }>,
  targetWord: string,
): TargetDisplayCalibration {
  const neighbors = scored.filter((entry) => entry.word !== targetWord);

  if (neighbors.length === 0) {
    return { knots: [{ raw: 0, display: 0 }] };
  }

  const s1 = neighborRawAt(neighbors, 1);
  const s10 = neighborRawAt(neighbors, 10);
  const s100 = neighborRawAt(neighbors, 100);
  const s1000 = neighborRawAt(neighbors, 1000);
  const sFloor = neighbors[floorNeighborIndex(neighbors.length)].rawHybrid;
  const topDisplay = computeDynamicTopDisplay(s1, s10, s100);

  return {
    knots: normalizeKnots([
      { raw: sFloor, display: 0 },
      { raw: s1000, display: DISPLAY_WARM },
      { raw: s100, display: DISPLAY_HOT },
      { raw: s1, display: topDisplay },
    ]),
  };
}

/** Maps raw hybrid to player-facing heat using per-target calibration knots. */
export function mapCalibratedDisplayScore(
  rawHybrid: number,
  calibration: TargetDisplayCalibration,
  isAnswer = false,
) {
  if (isAnswer) {
    return 100;
  }

  const { knots } = calibration;
  if (knots.length === 0) {
    return 0;
  }

  if (rawHybrid <= knots[0].raw) {
    return 0;
  }

  const topKnot = knots[knots.length - 1];
  if (rawHybrid >= topKnot.raw) {
    return clamp(Math.round(topKnot.display * 100) / 100, 0, 99.99);
  }

  for (let index = 0; index < knots.length - 1; index += 1) {
    const left = knots[index];
    const right = knots[index + 1];

    if (rawHybrid < left.raw || rawHybrid > right.raw) {
      continue;
    }

    const span = right.raw - left.raw;
    const t = span <= 1e-12 ? 1 : (rawHybrid - left.raw) / span;
    const display = left.display + t * (right.display - left.display);

    return clamp(Math.round(display * 100) / 100, 0, 99.99);
  }

  return 0;
}

export function computeHeatScore(
  cos: number,
  minCos: number,
  maxCos: number,
  isAnswer = false,
) {
  if (isAnswer) {
    return 100;
  }

  if (maxCos <= minCos) {
    return clamp(Math.round(cos * 100 * 100) / 100, 0, 99.9);
  }

  let u = (cos - minCos) / (maxCos - minCos);
  u = clamp(u, 0, 1);

  const base = u ** 0.45;
  let score: number;

  if (base < 0.9) {
    score = 99 * (base / 0.9);
  } else {
    const topU = (base - 0.9) / 0.1;
    score = 99 + 0.9 * topU ** 0.7;
  }

  return clamp(Math.round(score * 100) / 100, 0, 99.9);
}
