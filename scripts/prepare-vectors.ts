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

const MAX_WORD_LENGTH = 4;

function isAllowedWord(word: string) {
  return word.length >= 1 && word.length <= MAX_WORD_LENGTH;
}

type LoadOptions = {
  commonWords?: Set<string>;
  limit?: number;
  maxFourCharWords?: number;
};

function shouldKeepWord(word: string, fourCharKept: number, options: LoadOptions) {
  if (!isAllowedWord(word)) {
    return false;
  }

  if (options.commonWords && !options.commonWords.has(word)) {
    return false;
  }

  if (word.length < 4) {
    return true;
  }

  if (options.maxFourCharWords === undefined) {
    return true;
  }

  if (options.maxFourCharWords <= 0) {
    return false;
  }

  return fourCharKept < options.maxFourCharWords;
}

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

function readWord2VecHeader(buffer: Buffer) {
  let end = 0;
  while (end < buffer.length && buffer[end] !== 0x0a) {
    end += 1;
  }

  const [vocabSizeRaw, vectorSizeRaw] = buffer.subarray(0, end).toString("utf8").trim().split(/\s+/);
  const vocabSize = Number(vocabSizeRaw);
  const vectorSize = Number(vectorSizeRaw);

  if (!Number.isFinite(vocabSize) || !Number.isFinite(vectorSize)) {
    throw new Error("Invalid word2vec binary header.");
  }

  return {
    offset: end + 1,
    vocabSize,
    vectorSize,
  };
}

function readWord2VecBinaryWord(buffer: Buffer, offset: number) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0x20) {
    end += 1;
  }

  if (end >= buffer.length) {
    return undefined;
  }

  return {
    word: buffer.subarray(offset, end).toString("utf8"),
    offset: end + 1,
  };
}

async function loadWord2VecBinaryEntries(filePath: string, options: LoadOptions) {
  const buffer = await readFile(filePath);
  const { offset, vocabSize, vectorSize } = readWord2VecHeader(buffer);
  const entries: PreparedEntry[] = [];
  let fourCharKept = 0;
  let cursor = offset;

  for (let index = 0; index < vocabSize; index += 1) {
    if (options.limit !== undefined && options.limit > 0 && entries.length >= options.limit) {
      break;
    }

    const wordResult = readWord2VecBinaryWord(buffer, cursor);
    if (!wordResult) {
      break;
    }

    cursor = wordResult.offset;
    const vectorEnd = cursor + vectorSize * Float32Array.BYTES_PER_ELEMENT;
    if (vectorEnd > buffer.length) {
      throw new Error("Unexpected end of word2vec binary file.");
    }

    const vectorBytes = buffer.subarray(cursor, vectorEnd);
    const vector = Array.from({ length: vectorSize }, (_, index) => vectorBytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT));
    cursor = vectorEnd;

    const word = wordResult.word;
    if (!shouldKeepWord(word, fourCharKept, options)) {
      continue;
    }

    if (word.length === 4) {
      fourCharKept += 1;
    }

    entries.push({
      word,
      commonness: Math.max(1, 1_000_000 - entries.length),
      vector: normalizeVector(vector),
    });

    if ((index + 1) % 50_000 === 0) {
      console.log(`Scanned ${(index + 1).toLocaleString()} / ${vocabSize.toLocaleString()} words, kept ${entries.length.toLocaleString()} words (${fourCharKept.toLocaleString()} four-character)`);
    }
  }

  return entries;
}

async function loadTextEntries(filePath: string, options: LoadOptions) {
  const entries: PreparedEntry[] = [];
  let fourCharKept = 0;
  let linesRead = 0;
  const reader = readline.createInterface({
    input: createInputStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    linesRead += 1;
    if (linesRead % 500_000 === 0) {
      console.log(`Scanned ${linesRead.toLocaleString()} lines, kept ${entries.length.toLocaleString()} words (${fourCharKept.toLocaleString()} four-character)`);
    }

    if (options.limit !== undefined && options.limit > 0 && entries.length >= options.limit) {
      break;
    }

    const parts = line.trim().split(/\s+/);
    const word = parts[0];

    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      continue;
    }

    if (!shouldKeepWord(word, fourCharKept, options)) {
      continue;
    }

    const vector = parts.slice(1).map(Number);
    if (vector.length === 0 || vector.some((value) => Number.isNaN(value))) {
      continue;
    }

    if (word.length === 4) {
      fourCharKept += 1;
    }

    entries.push({
      word,
      commonness: Math.max(1, 1_000_000 - entries.length),
      vector: normalizeVector(vector),
    });
  }

  return entries;
}

async function writePreparedOutputs(
  entries: PreparedEntry[],
  output: string,
  wordsOutput?: string,
  vectorsOutput?: string,
) {
  if (wordsOutput && vectorsOutput) {
    const wordsPath = path.resolve(wordsOutput);
    const vectorsPath = path.resolve(vectorsOutput);
    const words: PreparedWord[] = entries.map(({ word, commonness }) => ({ word, commonness }));

    await mkdir(path.dirname(wordsPath), { recursive: true });
    await mkdir(path.dirname(vectorsPath), { recursive: true });
    await writeFile(wordsPath, `${JSON.stringify(words)}\n`, "utf8");
    await writeFile(vectorsPath, toFloat32Buffer(entries));
    console.log(`Prepared ${entries.length} words at ${wordsPath}`);
    console.log(`Prepared vectors at ${vectorsPath}`);
    return;
  }

  const outputPath = path.resolve(output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(`Prepared ${entries.length} words at ${outputPath}`);
}

async function main() {
  const input = getArg("input");
  const output = getArg("output", "data/prepared-words.json");
  const wordsOutput = getArg("words-output");
  const vectorsOutput = getArg("vectors-output");
  const commonWordsPath = getArg("common");
  const limitArg = getArg("limit");
  const maxFourCharWordsArg = getArg("max-four-char-words");
  const limit = limitArg === undefined ? undefined : Number(limitArg);
  const maxFourCharWords =
    maxFourCharWordsArg === undefined ? undefined : Number(maxFourCharWordsArg);

  if (!input) {
    throw new Error(
      "Missing --input. Example: npm run prepare:tencent -- --input=data/raw/light_Tencent_AILab_ChineseEmbedding.bin",
    );
  }

  if (maxFourCharWords !== undefined && !Number.isFinite(maxFourCharWords)) {
    throw new Error("Invalid --max-four-char-words value.");
  }

  const loadOptions: LoadOptions = {
    commonWords: await loadCommonWords(commonWordsPath),
    limit,
    maxFourCharWords,
  };
  const entries = input.endsWith(".bin")
    ? await loadWord2VecBinaryEntries(path.resolve(input), loadOptions)
    : await loadTextEntries(path.resolve(input), loadOptions);

  await writePreparedOutputs(entries, output, wordsOutput, vectorsOutput);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
