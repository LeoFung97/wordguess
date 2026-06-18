import path from "path";
import targetWords from "../data/target-words.json";
import { buildTargetRanking } from "../lib/game/ranking-builder";
import { semanticKnowledgeStore } from "../lib/game/semantic-knowledge";
import { writeTargetRankingsBinary } from "../lib/game/target-rankings";
import { normalizeWord, vectorStore } from "../lib/game/vector-store";

function getArg(flag: string, fallback: string) {
  const match = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  return match ? match.slice(flag.length + 1) : fallback;
}

function getArgNumber(flag: string) {
  const value = getArg(flag, "");
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function main() {
  const outputPath = getArg("--output", path.join("data", "target-rankings.bin"));
  const limit = getArgNumber("--limit");
  const entries = vectorStore.all();
  const wordToIndex = new Map(entries.map((entry, index) => [entry.word, index]));
  const targets = targetWords
    .map((word) => normalizeWord(word))
    .filter((word) => vectorStore.has(word))
    .slice(0, limit);

  console.log(
    `Preparing rankings for ${targets.length.toLocaleString()} targets across ${entries.length.toLocaleString()} words...`,
  );

  const builtTargets = [];

  for (const [index, targetWord] of targets.entries()) {
    const target = vectorStore.get(targetWord);
    if (!target) {
      continue;
    }

    const ranking = buildTargetRanking(target.word, target.vector, entries, wordToIndex, semanticKnowledgeStore);
    const ranks = new Uint32Array(entries.length);
    ranking.orderedWords.forEach((word, rankIndex) => {
      const wordIndex = wordToIndex.get(word);
      if (wordIndex !== undefined) {
        ranks[wordIndex] = rankIndex + 1;
      }
    });

    const targetIndex = wordToIndex.get(target.word);
    if (targetIndex === undefined) {
      continue;
    }

    builtTargets.push({
      targetIndex,
      ranks,
      displayCalibration: ranking.displayCalibration,
      calibration: ranking.calibration,
      hintWordIndices: ranking.hintWordIndices,
    });

    if ((index + 1) % 25 === 0 || index + 1 === targets.length) {
      console.log(`  ${index + 1}/${targets.length} (${targetWord})`);
    }
  }

  writeTargetRankingsBinary({
    outputPath,
    wordCount: entries.length,
    targets: builtTargets,
  });

  console.log(`Wrote ${builtTargets.length.toLocaleString()} target rankings to ${outputPath}.`);
}

main();
