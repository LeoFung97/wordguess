import { readFileSync } from "fs";

export type EmbeddingIndex = {
  words: string[];
  vectors: Float32Array;
  wordToIndex: Map<string, number>;
  vectorLength: number;
};

export function loadEmbeddingIndex(wordsPath: string, vectorsPath: string): EmbeddingIndex {
  const entries = JSON.parse(readFileSync(wordsPath, "utf8")) as Array<{ word: string }>;
  const words = entries.map((entry) => entry.word);
  const raw = readFileSync(vectorsPath);
  const vectors = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / Float32Array.BYTES_PER_ELEMENT);

  if (vectors.length % words.length !== 0) {
    throw new Error("Vector data does not align with word metadata.");
  }

  const vectorLength = vectors.length / words.length;
  const wordToIndex = new Map(words.map((word, index) => [word, index]));

  return { words, vectors, wordToIndex, vectorLength };
}

export function getVector(index: EmbeddingIndex, word: string): Float32Array | undefined {
  const wordIndex = index.wordToIndex.get(word);
  if (wordIndex === undefined) {
    return undefined;
  }

  const start = wordIndex * index.vectorLength;
  return index.vectors.subarray(start, start + index.vectorLength);
}

export function topNeighborsByCosine(
  index: EmbeddingIndex,
  word: string,
  limit: number,
  minScore: number,
): Array<{ word: string; score: number }> {
  const sourceIndex = index.wordToIndex.get(word);
  if (sourceIndex === undefined) {
    return [];
  }

  const sourceStart = sourceIndex * index.vectorLength;
  const scores: Array<{ word: string; score: number }> = [];

  for (let candidateIndex = 0; candidateIndex < index.words.length; candidateIndex += 1) {
    if (candidateIndex === sourceIndex) {
      continue;
    }

    const candidateStart = candidateIndex * index.vectorLength;
    let dot = 0;
    for (let dimension = 0; dimension < index.vectorLength; dimension += 1) {
      dot += index.vectors[sourceStart + dimension] * index.vectors[candidateStart + dimension];
    }

    if (dot >= minScore) {
      scores.push({ word: index.words[candidateIndex], score: dot });
    }
  }

  scores.sort((first, second) => second.score - first.score || first.word.localeCompare(second.word, "zh"));
  return scores.slice(0, limit);
}
