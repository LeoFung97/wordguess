/**
 * Reference guesses for target 海豚 from an external Chinese Semantle site.
 * Used for relative ordering / sanity checks — not exact heat matching.
 */
import type { ExternalTargetSuite } from "./types";

export const DOLPHIN_REFERENCE = {
  target: "海豚",
  guesses: [
    { word: "鲸鱼", externalPercent: 93.11, tolerance: 15 },
    { word: "鹦鹉", externalPercent: 68.87, tolerance: 15 },
    { word: "金鱼", externalPercent: 66.88, tolerance: 15 },
  ],
  externalOrder: ["鲸鱼", "鹦鹉", "金鱼"],
  unrelated: ["汽车"],
} as const satisfies ExternalTargetSuite;
