#!/usr/bin/env tsx
/**
 * Build a ranked list of playable two-character Chinese target words.
 *
 * Usage:
 *   tsx scripts/prepare-target-words.ts
 *   tsx scripts/prepare-target-words.ts --output-limit=1500 --min-playability=0.45
 */

import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Converter } from "opencc-js/t2cn";
import { mergeTargetSelectionConfig } from "../lib/game/target-selection/config";
import { loadEmbeddingIndex } from "../lib/game/target-selection/embedding-index";
import { loadSemanticKnowledge, runTargetSelectionPipeline } from "../lib/game/target-selection/pipeline";
import type { TargetSelectionConfig } from "../lib/game/target-selection/types";
import { loadFrequencyEntries } from "./frequency-list";

const toSimplified = Converter({ from: "tw", to: "cn" });

const DEFAULT_PATHS = {
  frequency: "data/raw/multi_domain_total_word_freq.txt",
  words: "data/words.json",
  vectors: "data/vectors.f32",
  semanticCache: "data/semantic-word-cache.json",
  rankedOutput: "data/generated/target-words-ranked.json",
  filteredOutput: "data/generated/target-words-filtered.json",
  debugOutput: "data/generated/target-words-debug.tsv",
  targetWordsOutput: "data/target-words.json",
};

function getArg(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const matches = process.argv.filter((arg) => arg.startsWith(prefix));
  const value = matches.at(-1);
  return value ? value.slice(prefix.length) : fallback;
}

function parseNumberArg(name: string, fallback: number) {
  const raw = getArg(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --${name}=${raw}`);
  }
  return parsed;
}

function buildConfigOverrides(): Partial<TargetSelectionConfig> {
  const base = mergeTargetSelectionConfig();
  return {
    maxFrequencyRank: parseNumberArg("max-frequency-rank", base.maxFrequencyRank),
    minFrequencyRank: parseNumberArg("min-frequency-rank", base.minFrequencyRank),
    minPlayability: parseNumberArg("min-playability", base.minPlayability),
    minSemanticQuality: parseNumberArg("min-semantic-quality", base.minSemanticQuality),
    minFinalScore: parseNumberArg("min-final-score", base.minFinalScore),
    outputLimit: parseNumberArg("output-limit", base.outputLimit),
    weightFrequency: parseNumberArg("weight-frequency", base.weightFrequency),
    weightPlayability: parseNumberArg("weight-playability", base.weightPlayability),
    weightSemanticQuality: parseNumberArg("weight-semantic-quality", base.weightSemanticQuality),
    weightFreshness: parseNumberArg("weight-freshness", base.weightFreshness),
  };
}

function formatTsvValue(value: string | number | boolean | undefined) {
  const raw = value === undefined ? "" : String(value);
  if (raw.includes("\t") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function toDebugTsv(rows: Array<Record<string, string | number | boolean | undefined>>) {
  if (rows.length === 0) {
    return "word\tfrequency\tfrequency_rank\tin_vocab\tin_embedding\tpasses_two_char\tis_simplified\tpos_heuristic\tplayability_score\tsemantic_quality_score\tfreshness_score\tfrequency_score\tfinal_score\tkeep\treason\ttop_neighbors\n";
  }

  const columns = Object.keys(rows[0]!);
  const header = columns.join("\t");
  const body = rows
    .map((row) => columns.map((column) => formatTsvValue(row[column])).join("\t"))
    .join("\n");
  return `${header}\n${body}\n`;
}

async function main() {
  const frequencyPath = path.resolve(getArg("frequency", DEFAULT_PATHS.frequency)!);
  const wordsPath = path.resolve(getArg("words", DEFAULT_PATHS.words)!);
  const vectorsPath = path.resolve(getArg("vectors", DEFAULT_PATHS.vectors)!);
  const semanticCachePath = path.resolve(getArg("semantic-cache", DEFAULT_PATHS.semanticCache)!);
  const rankedOutput = path.resolve(getArg("ranked-output", DEFAULT_PATHS.rankedOutput)!);
  const filteredOutput = path.resolve(getArg("filtered-output", DEFAULT_PATHS.filteredOutput)!);
  const debugOutput = path.resolve(getArg("debug-output", DEFAULT_PATHS.debugOutput)!);
  const targetWordsOutput = path.resolve(getArg("target-words-output", DEFAULT_PATHS.targetWordsOutput)!);
  const writeTargetWords = process.argv.includes("--write-target-words");

  for (const [label, filePath] of [
    ["Frequency list", frequencyPath],
    ["Vocabulary", wordsPath],
    ["Vectors", vectorsPath],
  ] as const) {
    if (!existsSync(filePath)) {
      throw new Error(`${label} not found: ${filePath}`);
    }
  }

  console.log(`Loading frequency list from ${frequencyPath}`);
  const frequencyEntries = await loadFrequencyEntries(frequencyPath);
  console.log(`Loaded ${frequencyEntries.length.toLocaleString()} frequency entries`);

  console.log(`Loading vocabulary from ${wordsPath}`);
  const vocabularyEntries = JSON.parse(await import("fs/promises").then((fs) => fs.readFile(wordsPath, "utf8"))) as Array<{
    word: string;
    commonness: number;
  }>;
  const vocabulary = new Map(vocabularyEntries.map((entry) => [entry.word, { commonness: entry.commonness }]));
  console.log(`Loaded ${vocabulary.size.toLocaleString()} vocabulary entries`);

  console.log(`Loading embedding index from ${vectorsPath}`);
  const embeddingIndex = loadEmbeddingIndex(wordsPath, vectorsPath);

  let semanticKnowledge;
  if (existsSync(semanticCachePath)) {
    console.log(`Loading semantic cache from ${semanticCachePath}`);
    semanticKnowledge = loadSemanticKnowledge(semanticCachePath);
    console.log(`Loaded ${semanticKnowledge.size.toLocaleString()} semantic knowledge entries`);
  } else {
    console.warn(`Semantic cache not found at ${semanticCachePath}; continuing without it.`);
  }

  const config = buildConfigOverrides();
  console.log("Running target selection pipeline...");
  const result = runTargetSelectionPipeline({
    frequencyEntries,
    vocabulary,
    embeddingIndex,
    semanticKnowledge,
    toSimplified,
    config,
  });

  console.log(
    `Evaluated ${result.stats.evaluated.toLocaleString()} entries; kept ${result.stats.kept.toLocaleString()}, dropped ${result.stats.dropped.toLocaleString()}`,
  );

  const debugRows = [...result.ranked, ...result.filtered]
    .sort((first, second) => first.frequencyRank - second.frequencyRank)
    .map((entry) => ({
      word: entry.word,
      frequency: entry.frequency,
      frequency_rank: entry.frequencyRank,
      in_vocab: entry.inVocab,
      in_embedding: entry.inEmbedding,
      passes_two_char: entry.passesTwoChar,
      is_simplified: entry.isSimplified,
      pos_heuristic: entry.posHeuristic,
      playability_score: Number(entry.playabilityScore.toFixed(4)),
      semantic_quality_score: Number(entry.semanticQualityScore.toFixed(4)),
      freshness_score: Number(entry.freshnessScore.toFixed(4)),
      frequency_score: Number(entry.frequencyScore.toFixed(4)),
      final_score: Number(entry.finalScore.toFixed(4)),
      keep: entry.keep,
      reason: entry.reason,
      top_neighbors: (entry.topNeighbors ?? []).slice(0, 8).join("|"),
    }));

  await mkdir(path.dirname(rankedOutput), { recursive: true });
  await writeFile(
    rankedOutput,
    `${JSON.stringify(
      {
        generatedAt: result.generatedAt,
        config: result.config,
        stats: result.stats,
        words: result.ranked.map((entry) => entry.word),
        entries: result.ranked,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(
    filteredOutput,
    `${JSON.stringify(
      {
        generatedAt: result.generatedAt,
        stats: { dropped: result.filtered.length },
        entries: result.filtered,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await writeFile(debugOutput, toDebugTsv(debugRows), "utf8");

  if (writeTargetWords) {
    await writeFile(targetWordsOutput, `${JSON.stringify(result.ranked.map((entry) => entry.word), null, 2)}\n`, "utf8");
    console.log(`Wrote ${result.ranked.length} target words to ${targetWordsOutput}`);
  }

  console.log(`Ranked targets: ${rankedOutput}`);
  console.log(`Filtered diagnostics: ${filteredOutput}`);
  console.log(`Debug table: ${debugOutput}`);
  console.log("\nTop 20 candidates:");
  result.ranked.slice(0, 20).forEach((entry, index) => {
    console.log(
      `${String(index + 1).padStart(2, " ")}. ${entry.word}  score=${entry.finalScore.toFixed(3)}  freqRank=${entry.frequencyRank}  play=${entry.playabilityScore.toFixed(2)}  sem=${entry.semanticQualityScore.toFixed(2)}`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
