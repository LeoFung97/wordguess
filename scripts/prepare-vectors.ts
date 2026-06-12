import { createReadStream } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import readline from "readline";
import { createGunzip } from "zlib";

type PreparedEntry = {
  word: string;
  commonness: number;
  vector: number[];
};

type PreparedWord = {
  word: string;
  commonness: number;
};

const twoCharacterChinese = /^[\u4e00-\u9fff]{2}$/u;

function getArg(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function normalizeVector(vector: number[]) {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => Number((value / length).toFixed(8)));
}

async function loadCommonWords(filePath?: string) {
  if (!filePath) {
    return undefined;
  }

  const content = await readFile(filePath, "utf8");
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function createInputStream(filePath: string) {
  const stream = createReadStream(filePath);
  return filePath.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
}

function toFloat32Buffer(entries: PreparedEntry[]) {
  const vectorLength = entries[0]?.vector.length ?? 0;
  const vectors = new Float32Array(entries.length * vectorLength);

  entries.forEach((entry, entryIndex) => {
    entry.vector.forEach((value, vectorIndex) => {
      vectors[entryIndex * vectorLength + vectorIndex] = value;
    });
  });

  return Buffer.from(vectors.buffer);
}

async function main() {
  const input = getArg("input");
  const output = getArg("output", "data/prepared-words.json");
  const wordsOutput = getArg("words-output");
  const vectorsOutput = getArg("vectors-output");
  const commonWordsPath = getArg("common");
  const limit = Number(getArg("limit", "5000"));

  if (!input) {
    throw new Error(
      "Missing --input. Example: npm run prepare:vectors -- --input=data/raw/tencent.txt --common=data/common-words.txt",
    );
  }

  const commonWords = await loadCommonWords(commonWordsPath);
  const entries: PreparedEntry[] = [];
  const reader = readline.createInterface({
    input: createInputStream(input),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    if (entries.length >= limit) {
      break;
    }

    const parts = line.trim().split(/\s+/);
    const word = parts[0];

    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      continue;
    }

    if (!twoCharacterChinese.test(word) || (commonWords && !commonWords.has(word))) {
      continue;
    }

    const vector = parts.slice(1).map(Number);
    if (vector.length === 0 || vector.some((value) => Number.isNaN(value))) {
      continue;
    }

    entries.push({
      word,
      commonness: Math.max(1, limit - entries.length),
      vector: normalizeVector(vector),
    });
  }

  const outputPath = path.resolve(output);
  if (wordsOutput && vectorsOutput) {
    const wordsPath = path.resolve(wordsOutput);
    const vectorsPath = path.resolve(vectorsOutput);
    const words: PreparedWord[] = entries.map(({ word, commonness }) => ({ word, commonness }));

    await mkdir(path.dirname(wordsPath), { recursive: true });
    await mkdir(path.dirname(vectorsPath), { recursive: true });
    await writeFile(wordsPath, `${JSON.stringify(words, null, 2)}\n`, "utf8");
    await writeFile(vectorsPath, toFloat32Buffer(entries));
    console.log(`Prepared ${entries.length} two-character words at ${wordsPath}`);
    console.log(`Prepared vectors at ${vectorsPath}`);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(`Prepared ${entries.length} two-character words at ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
