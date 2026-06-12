"use client";

import { useMemo, useState } from "react";
import type { GuessResult } from "@/lib/game/types";
import { temperatureClass, temperatureCopy } from "./temperature";

type GuessHistoryProps = {
  guesses: GuessResult[];
  emptyText?: string;
};

type SortView = "ranking" | "latest";

function sortGuesses(guesses: GuessResult[], view: SortView) {
  return [...guesses].sort((first, second) => {
    if (view === "latest") {
      return second.createdAt - first.createdAt || second.attempt - first.attempt;
    }

    return first.rank - second.rank || second.similarity - first.similarity;
  });
}

export function GuessHistory({ guesses, emptyText = "还没有猜词，试试第一个词。" }: GuessHistoryProps) {
  const [view, setView] = useState<SortView>("latest");
  const orderedGuesses = useMemo(() => sortGuesses(guesses, view), [guesses, view]);

  if (guesses.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-white/60">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-white/45">猜词记录</p>
        <div className="flex rounded-full border border-white/10 bg-white/[0.04] p-0.5">
          <button
            type="button"
            onClick={() => setView("ranking")}
            className={`rounded-full px-3 py-1 text-xs transition ${
              view === "ranking" ? "bg-white/15 text-white" : "text-white/50 hover:text-white/70"
            }`}
          >
            按排名
          </button>
          <button
            type="button"
            onClick={() => setView("latest")}
            className={`rounded-full px-3 py-1 text-xs transition ${
              view === "latest" ? "bg-white/15 text-white" : "text-white/50 hover:text-white/70"
            }`}
          >
            按最新
          </button>
        </div>
      </div>

      {orderedGuesses.map((guess) => (
        <article
          key={`${guess.attempt}-${guess.word}-${guess.playerName ?? "solo"}`}
          className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-md shadow-black/10 backdrop-blur"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold tracking-[0.2em] text-white">{guess.word}</span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${temperatureClass[guess.temperature]}`}
                >
                  {temperatureCopy[guess.temperature]}
                </span>
              </div>
              {guess.playerName ? (
                <p className="mt-0.5 truncate text-[11px] text-white/45">由 {guess.playerName} 猜出</p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-bold leading-none text-teal-200">{guess.similarity.toFixed(2)}</p>
              <p className="mt-0.5 text-[10px] text-white/45">相似度</p>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300"
              style={{ width: `${Math.min(100, guess.similarity)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/45">
            <span>第 {guess.attempt} 次</span>
            <span>排名 #{guess.rank} · 超过 {guess.percentile}% 词汇</span>
          </div>
        </article>
      ))}
    </div>
  );
}
