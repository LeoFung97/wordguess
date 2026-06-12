"use client";

import type { GuessResult } from "@/lib/game/types";
import { temperatureClass, temperatureCopy } from "./temperature";

type GuessHistoryProps = {
  guesses: GuessResult[];
  emptyText?: string;
};

export function GuessHistory({ guesses, emptyText = "还没有猜词，试试第一个词。" }: GuessHistoryProps) {
  const orderedGuesses = [...guesses].sort((first, second) => second.attempt - first.attempt);

  if (orderedGuesses.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center text-white/60">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orderedGuesses.map((guess) => (
        <article
          key={`${guess.attempt}-${guess.word}-${guess.playerName ?? "solo"}`}
          className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-xl shadow-black/10 backdrop-blur"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-semibold tracking-[0.25em] text-white">{guess.word}</span>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${temperatureClass[guess.temperature]}`}
                >
                  {temperatureCopy[guess.temperature]}
                </span>
              </div>
              {guess.playerName ? (
                <p className="mt-1 text-sm text-white/50">由 {guess.playerName} 猜出</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-teal-200">{guess.similarity.toFixed(2)}</p>
              <p className="text-xs text-white/50">相似度</p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300"
              style={{ width: `${Math.min(100, guess.similarity)}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-white/50">
            <span>第 {guess.attempt} 次</span>
            <span>排名 #{guess.rank} · 超过 {guess.percentile}% 词汇</span>
          </div>
        </article>
      ))}
    </div>
  );
}
