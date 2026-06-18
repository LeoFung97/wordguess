const DEFAULT_TARGET_CACHE_SIZE = 6;

export function targetCacheLimit() {
  const raw = process.env.WORDRANK_TARGET_CACHE_SIZE;
  if (!raw) {
    return DEFAULT_TARGET_CACHE_SIZE;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_TARGET_CACHE_SIZE;
  }

  return parsed;
}
