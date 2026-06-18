import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  loadFrequencyEntries,
  parseCount,
  selectWordsByFrequency,
  type FrequencyEntry,
} from "./frequency-list";
import { loadFastTextVectors, loadFastTextVocabulary, normalizeVector, toFloat32Buffer } from "./prepare-vectors-lib";

type PreparedEntry = {
  word: string;
  commonness: number;
  vector: number[];
};

const DEFAULT_FREQUENCY_PATH = "data/raw/multi_domain_total_word_freq.txt";
const DEFAULT_TOP_K = 50_000;

function getArg(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const matches = process.argv.filter((arg) => arg.startsWith(prefix));
  const value = matches.at(-1);
  return value ? value.slice(prefix.length) : fallback;
}

function buildWhitelist(
  frequencyEntries: FrequencyEntry[],
  fastTextVocabulary: Set<string>,
  topK: number,
) {
  const frequencyByWord = new Map(frequencyEntries.map((entry) => [entry.word, entry.frequency]));

  return selectWordsByFrequency(frequencyEntries, fastTextVocabulary, topK).map((word) => ({
    word,
    commonness: frequencyByWord.get(word) ?? 1,
  }));
}

async function writePreparedOutputs(
  entries: PreparedEntry[],
  wordsOutput: string,
  vectorsOutput: string,
) {
  const wordsPath = path.resolve(wordsOutput);
  const vectorsPath = path.resolve(vectorsOutput);

  await mkdir(path.dirname(wordsPath), { recursive: true });
  await mkdir(path.dirname(vectorsPath), { recursive: true });
  await writeFile(wordsPath, `${JSON.stringify(entries.map(({ word, commonness }) => ({ word, commonness })))}\n`, "utf8");
  await writeFile(vectorsPath, toFloat32Buffer(entries));
  console.log(`Prepared ${entries.length} words at ${wordsPath}`);
  console.log(`Prepared vectors at ${vectorsPath}`);
}

async function main() {
  const frequencyPath = getArg("frequency") ?? getArg("subtlex") ?? DEFAULT_FREQUENCY_PATH;
  const input = getArg("input");
  const wordsOutput = getArg("words-output", "data/words.json");
  const vectorsOutput = getArg("vectors-output", "data/vectors.f32");
  const topK = parseCount(getArg("top-k", String(DEFAULT_TOP_K)), "top-k");

  const resolvedFrequencyPath = path.resolve(frequencyPath);
  if (!existsSync(resolvedFrequencyPath)) {
    throw new Error(
      `Frequency list not found: ${resolvedFrequencyPath}\n` +
        "Place your ranked word list at data/raw/multi_domain_total_word_freq.txt, or pass --frequency=path/to/list.txt",
    );
  }

  if (!input) {
    throw new Error(
      "Missing --input. Example: npm run prepare:fasttext -- --input=data/raw/cc.zh.300.vec.gz --top-k=80k",
    );
  }

  console.log(`Loading frequency list from ${resolvedFrequencyPath}`);
  const frequencyEntries = await loadFrequencyEntries(resolvedFrequencyPath);
  console.log(`Loaded ${frequencyEntries.length.toLocaleString()} frequency entries`);

  console.log(`Scanning fastText vocabulary from ${input}`);
  const fastTextVocabulary = await loadFastTextVocabulary(path.resolve(input));
  console.log(`Found ${fastTextVocabulary.size.toLocaleString()} fastText vocabulary entries`);

  const whitelist = buildWhitelist(frequencyEntries, fastTextVocabulary, topK);
  if (whitelist.length < topK) {
    throw new Error(
      `Only found ${whitelist.length.toLocaleString()} words in fastText vocabulary; need ${topK.toLocaleString()}. ` +
        "Add more frequency entries or lower --top-k.",
    );
  }

  console.log(
    `Selected ${whitelist.length.toLocaleString()} words from frequency list ∩ fastText (top ${topK.toLocaleString()} by frequency, skipping missing vectors)`,
  );

  const whitelistIndex = new Map(whitelist.map((entry, index) => [entry.word, index]));
  const vectorsByWord = await loadFastTextVectors(path.resolve(input), whitelistIndex);

  const missingWords = whitelist.filter((entry) => !vectorsByWord.has(entry.word));
  if (missingWords.length > 0) {
    throw new Error(`Missing fastText vectors for ${missingWords.length} whitelist words.`);
  }

  const entries: PreparedEntry[] = whitelist.map((entry) => ({
    word: entry.word,
    commonness: entry.commonness,
    vector: vectorsByWord.get(entry.word)!,
  }));

  await writePreparedOutputs(entries, wordsOutput, vectorsOutput);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
