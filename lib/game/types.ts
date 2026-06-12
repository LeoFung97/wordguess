export type WordVectorEntry = {
  word: string;
  vector: number[];
  commonness: number;
};

export type GuessTemperature =
  | "ice"
  | "cold"
  | "warm"
  | "hot"
  | "burning"
  | "solved";

export type GuessResult = {
  word: string;
  attempt: number;
  similarity: number;
  percentile: number;
  rank: number;
  temperature: GuessTemperature;
  isCorrect: boolean;
  playerName?: string;
  createdAt: number;
};

export type PublicGameState = {
  gameId: string;
  guesses: GuessResult[];
  bestGuess?: GuessResult;
  solved: boolean;
  attempts: number;
};

export type CreateGameResult = PublicGameState & {
  targetLength: number;
};
