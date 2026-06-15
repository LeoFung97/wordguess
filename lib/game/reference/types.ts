export type ExternalGuessReference = {
  word: string;
  /** Documented display percent from an external reference game. */
  externalPercent: number;
  /** Loose tolerance for regression drift — not exact calibration. */
  tolerance: number;
};

export type ExternalTargetSuite = {
  target: string;
  guesses: ExternalGuessReference[];
  externalOrder?: readonly string[];
  unrelated?: readonly string[];
};
