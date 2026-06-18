import { createReadStream } from "fs";
import readline from "readline";
import { createGunzip } from "zlib";

type PreparedEntry = {
  word: string;
  commonness: number;
  vector: number[];
};

export function normalizeVector(vector: number[]) {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }

  return vector.map((value) => Number((value / length).toFixed(8)));
}

function createInputStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

export function toFloat32Buffer(entries: PreparedEntry[]) {
  const vectorLength = entries[0]?.vector.length ?? 0;
  const vectors = new Float32Array(entries.length * vectorLength);

  entries.forEach((entry, entryIndex) => {
    entry.vector.forEach((value, vectorIndex) => {
      vectors[entryIndex * vectorLength + vectorIndex] = value;
    });
  });

  return Buffer.from(vectors.buffer);
}

export async function loadFastTextVocabulary(filePath: string) {
  const vocabulary = new Set<string>();
  let linesRead = 0;
  const reader = readline.createInterface({
    input: createInputStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    linesRead += 1;
    if (linesRead === 1) {
      continue;
    }

    const spaceIndex = line.indexOf(" ");
    if (spaceIndex <= 0) {
      continue;
    }

    vocabulary.add(line.slice(0, spaceIndex));
  }

  return vocabulary;
}

export async function loadFastTextVectors(filePath: string, whitelist: Map<string, number>) {
  const vectors = new Map<string, number[]>();
  let linesRead = 0;
  let vectorLength = 0;
  const reader = readline.createInterface({
    input: createInputStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    linesRead += 1;

    if (linesRead === 1) {
      const [, dimensionRaw] = line.trim().split(/\s+/);
      vectorLength = Number(dimensionRaw);
      if (!Number.isFinite(vectorLength) || vectorLength <= 0) {
        throw new Error("Invalid fastText vector header.");
      }
      continue;
    }

    if (vectors.size >= whitelist.size) {
      break;
    }

    const spaceIndex = line.indexOf(" ");
    if (spaceIndex <= 0) {
      continue;
    }

    const word = line.slice(0, spaceIndex);
    if (!whitelist.has(word)) {
      continue;
    }

    const vector = line
      .slice(spaceIndex + 1)
      .trim()
      .split(/\s+/)
      .map(Number);

    if (vector.length !== vectorLength || vector.some((value) => Number.isNaN(value))) {
      continue;
    }

    vectors.set(word, normalizeVector(vector));

    if (vectors.size % 5_000 === 0) {
      console.log(`Loaded ${vectors.size.toLocaleString()} / ${whitelist.size.toLocaleString()} whitelist vectors`);
    }
  }

  return vectors;
}
