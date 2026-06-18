import type { EmbeddingIndex } from "./embedding-index";
import { topNeighborsByCosine } from "./embedding-index";
import { COMMON_SURNAMES, HOT_TOPIC_TERMS } from "./heuristics";
import type { PosHeuristic, SemanticKnowledgeLite } from "./types";

const NOISY_NEIGHBOR_PATTERNS = [
  /^[\u4e00-\u9fff]$/,
  /^(的|了|是|在|和|与|或|把|被|给|对|从|到|为|以|于|而|则|若|但|且|又|也|还|就|都|很|太|更|最|再|才|只|不|没|无|非|未|啊|呢|吧|吗|呀|嘛|哦)$/,
];

const VARIANT_SUFFIXES = ["们", "化", "性", "式", "感", "度", "者", "家", "员", "师"];

function isNoisyNeighbor(neighbor: string, sourceWord: string) {
  if (neighbor === sourceWord) {
    return true;
  }

  if (NOISY_NEIGHBOR_PATTERNS.some((pattern) => pattern.test(neighbor))) {
    return true;
  }

  if (neighbor.length === 1) {
    return true;
  }

  if (sourceWord.length === 2 && neighbor.length === 2) {
    if (neighbor[0] === sourceWord[0] || neighbor[1] === sourceWord[1]) {
      if (neighbor !== sourceWord) {
        return true;
      }
    }
  }

  if (HOT_TOPIC_TERMS.some((term) => neighbor.includes(term))) {
    return true;
  }

  return false;
}

function isProperNounLike(neighbor: string) {
  if (COMMON_SURNAMES.has(neighbor[0]!) && neighbor.length === 2) {
    return true;
  }

  if (/[省市县区镇村国]$/.test(neighbor)) {
    return true;
  }

  if (/(公司|集团|银行|大学|学院|委员会|政府)$/.test(neighbor)) {
    return true;
  }

  return false;
}

function isVariantOrDuplicate(source: string, neighbor: string) {
  if (neighbor === source) {
    return true;
  }

  if (neighbor.includes(source) || source.includes(neighbor)) {
    return true;
  }

  if (source.length === 2 && neighbor.length === 2) {
    const sharedChars = [...source].filter((char) => neighbor.includes(char)).length;
    if (sharedChars === 2) {
      return true;
    }
  }

  if (VARIANT_SUFFIXES.some((suffix) => neighbor.endsWith(suffix) && neighbor.slice(0, -suffix.length) === source)) {
    return true;
  }

  return false;
}

function scoreFromSynonyms(word: string, knowledge: SemanticKnowledgeLite | undefined) {
  const synonyms = knowledge?.synonyms ?? [];
  if (synonyms.length === 0) {
    return null;
  }

  let score = 0.42 + Math.min(synonyms.length, 16) * 0.025;
  if (knowledge?.domain && knowledge.domain !== "abstract/general") {
    score += 0.05;
  }
  if ((knowledge?.sense_count ?? 0) >= 3) {
    score -= 0.05;
  }

  return {
    score: clamp(score, 0, 1),
    topNeighbors: synonyms.slice(0, 12),
  };
}

export function scoreSemanticQuality(
  word: string,
  embeddingIndex: EmbeddingIndex,
  knowledge: SemanticKnowledgeLite | undefined,
  options: {
    neighborCount: number;
    minNeighborSimilarity: number;
    pos: PosHeuristic;
    preferCache?: boolean;
  },
): { score: number; topNeighbors: string[] } {
  if (options.preferCache !== false) {
    const cached = scoreFromSynonyms(word, knowledge);
    if (cached && (knowledge?.synonyms?.length ?? 0) >= 4) {
      return cached;
    }
  }

  const neighbors = topNeighborsByCosine(
    embeddingIndex,
    word,
    options.neighborCount * 2,
    options.minNeighborSimilarity,
  );

  const topNeighbors = neighbors.slice(0, options.neighborCount).map((entry) => entry.word);

  if (neighbors.length === 0 && !knowledge?.synonyms?.length) {
    return { score: 0.2, topNeighbors };
  }

  let score = 0.45;

  const meaningfulNeighbors = neighbors.filter(
    (entry) =>
      !isNoisyNeighbor(entry.word, word) &&
      !isProperNounLike(entry.word) &&
      !isVariantOrDuplicate(word, entry.word),
  );

  const meaningfulRatio = neighbors.length > 0 ? meaningfulNeighbors.length / neighbors.length : 0;
  score += meaningfulRatio * 0.25;

  const avgSimilarity =
    meaningfulNeighbors.length > 0
      ? meaningfulNeighbors.reduce((sum, entry) => sum + entry.score, 0) / meaningfulNeighbors.length
      : 0;
  score += clamp((avgSimilarity - 0.45) / 0.35, 0, 0.15);

  const properNounRatio =
    neighbors.length > 0 ? neighbors.filter((entry) => isProperNounLike(entry.word)).length / neighbors.length : 0;
  score -= properNounRatio * 0.2;

  const variantRatio =
    neighbors.length > 0
      ? neighbors.filter((entry) => isVariantOrDuplicate(word, entry.word)).length / neighbors.length
      : 0;
  score -= variantRatio * 0.25;

  const synonyms = knowledge?.synonyms ?? [];
  if (synonyms.length >= 3) {
    score += 0.06;
  }
  if (synonyms.length >= 8) {
    score += 0.04;
  }

  if (knowledge?.domain && knowledge.domain !== "abstract/general") {
    score += 0.05;
  }

  const senseCount = knowledge?.sense_count ?? 0;
  if (senseCount >= 3) {
    score -= 0.06;
  }

  if (options.pos === "unknown") {
    score -= 0.04;
  }

  if (meaningfulNeighbors.length < 4) {
    score -= 0.12;
  }

  return { score: clamp(score, 0, 1), topNeighbors };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export { isNoisyNeighbor, isProperNounLike, isVariantOrDuplicate };
