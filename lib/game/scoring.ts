function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

/** Maps raw hybrid semantic closeness (0..1) to player-facing heat. */
export function computeHybridDisplayScore(rawHybrid: number, isAnswer = false) {
  if (isAnswer) {
    return 100;
  }

  const u = clamp(rawHybrid, 0, 1);
  return Math.round(Math.min(99.99, 99.99 * u ** 0.45) * 100) / 100;
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
