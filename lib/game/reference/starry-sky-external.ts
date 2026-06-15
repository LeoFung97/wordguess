/**
 * Reference guesses for target 星空 from an external Chinese Semantle site.
 * Used for relative ordering / sanity checks — not exact heat matching.
 */
import type { ExternalTargetSuite } from "./types";

export const STARRY_SKY_REFERENCE = {
  target: "星空",
  guesses: [
    { word: "星星", externalPercent: 93.46, tolerance: 20 },
    { word: "天空", externalPercent: 91.09, tolerance: 20 },
    { word: "星河", externalPercent: 90.9, tolerance: 20 },
    { word: "航天", externalPercent: 80.51, tolerance: 20 },
    { word: "航空", externalPercent: 57.93, tolerance: 20 },
  ],
  externalOrder: ["星星", "天空", "星河", "航天", "航空"],
  unrelated: ["汽车"],
} as const satisfies ExternalTargetSuite;
