"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GuessForm } from "@/components/GuessForm";
import { GuessHistory } from "@/components/GuessHistory";
import { StatCard } from "@/components/StatCard";
import type { CreateGameResult, PublicGameState } from "@/lib/game/types";

type GuessResponse = {
  state: PublicGameState;
  error?: string;
};

export default function PlayPage() {
  const [game, setGame] = useState<CreateGameResult | PublicGameState>();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function startGame() {
    setIsLoading(true);
    setError("");
    const response = await fetch("/api/games", { method: "POST" });
    const nextGame = (await response.json()) as CreateGameResult;
    setGame(nextGame);
    setIsLoading(false);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialGame() {
      const response = await fetch("/api/games", { method: "POST" });
      const nextGame = (await response.json()) as CreateGameResult;

      if (!isMounted) {
        return;
      }

      setGame(nextGame);
      setIsLoading(false);
    }

    void loadInitialGame();

    return () => {
      isMounted = false;
    };
  }, []);

  async function submitGuess(word: string) {
    if (!game) {
      return false;
    }

    setError("");
    const response = await fetch(`/api/games/${game.gameId}/guesses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ word }),
    });
    const result = (await response.json()) as GuessResponse;

    if (!response.ok) {
      setError(result.error ?? "提交失败。");
      return false;
    }

    setGame(result.state);
    return true;
  }

  const bestScore = useMemo(() => game?.bestGuess?.similarity.toFixed(2) ?? "0.00", [game]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      <nav className="mb-10 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-[0.4em] text-teal-100">
          字距
        </Link>
        <button
          onClick={() => void startGame()}
          className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/70 transition hover:bg-white/[0.1]"
        >
          新开一局
        </button>
      </nav>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 backdrop-blur">
          <p className="text-sm text-teal-100">单人模式</p>
          <h1 className="mt-3 text-4xl font-black text-white">找到隐藏的两个字词</h1>
          <p className="mt-4 leading-7 text-white/60">
            每次猜一个常用二字词。相似度由词向量距离计算，分数越高表示语义越接近。
          </p>

          <div className="mt-7 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <StatCard label="尝试次数" value={game?.attempts ?? 0} />
            <StatCard label="最佳分数" value={bestScore} />
            <StatCard label="状态" value={game?.solved ? "已命中" : "寻找中"} />
          </div>

          {game?.solved ? (
            <div className="mt-6 rounded-3xl border border-emerald-300/25 bg-emerald-300/10 p-5 text-emerald-50">
              你找到了目标词。可以新开一局继续挑战。
            </div>
          ) : null}
        </aside>

        <section className="space-y-5">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <GuessForm onGuess={submitGuess} disabled={isLoading || !game || game.solved} />
            {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
          </div>

          {isLoading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center text-white/60">
              正在准备词向量...
            </div>
          ) : (
            <GuessHistory guesses={game?.guesses ?? []} />
          )}
        </section>
      </section>
    </main>
  );
}
