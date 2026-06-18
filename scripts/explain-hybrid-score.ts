#!/usr/bin/env tsx
/**
 * Developer tool: explain hybrid score breakdown for a (target, guess) pair.
 *
 * Usage:
 *   tsx scripts/explain-hybrid-score.ts 气候 天气
 *   tsx scripts/explain-hybrid-score.ts 气候 形势
 */

import { HYBRID_WEIGHTS } from "../lib/game/hybrid-scorer";
import { explainHybridScore } from "../lib/game/semantic-knowledge";
import { cosineSimilarity, vectorStore } from "../lib/game/vector-store";

function main() {
  const [targetWord, guessWord] = process.argv.slice(2);

  if (!targetWord || !guessWord) {
    console.error("Usage: tsx scripts/explain-hybrid-score.ts <target> <guess>");
    process.exit(1);
  }

  const target = vectorStore.get(targetWord);
  const guess = vectorStore.get(guessWord);

  if (!target || !guess) {
    console.error("Both words must exist in the vector store.");
    process.exit(1);
  }

  const cosine = cosineSimilarity(target.vector, guess.vector);
  const explanation = explainHybridScore(targetWord, guessWord, cosine);

  console.log(JSON.stringify(
    {
      target: targetWord,
      guess: guessWord,
      cosine,
      weights: HYBRID_WEIGHTS,
      ...explanation,
    },
    null,
    2,
  ));
}

main();
