"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Converter } from "opencc-js/t2cn";
import { io, type Socket } from "socket.io-client";
import { GuessForm } from "@/components/GuessForm";
import { GuessHistory } from "@/components/GuessHistory";
import { SimilarityCalibrationCard } from "@/components/SimilarityCalibrationCard";
import { StatCard } from "@/components/StatCard";
import type { GuessResult, SimilarityCalibration } from "@/lib/game/types";

type Player = {
  id: string;
  name: string;
};

type PublicRoom = {
  roomCode: string;
  players: Player[];
  guesses: GuessResult[];
  bestGuess?: GuessResult;
  solved: boolean;
  attempts: number;
  customTarget: boolean;
  calibration: SimilarityCalibration;
};

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

type TargetMode = "random" | "custom";

const toSimplifiedChinese = Converter({ from: "tw", to: "cn" });
const MAX_WORD_LENGTH = 4;

export default function LobbyPage() {
  const params = useParams<{ roomCode: string }>();
  const requestedRoomCode = params.roomCode.toUpperCase();
  const [playerName, setPlayerName] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return localStorage.getItem("playerName") ?? "";
  });
  const [targetMode, setTargetMode] = useState<TargetMode>("random");
  const [targetWord, setTargetWord] = useState("");
  const [room, setRoom] = useState<PublicRoom>();
  const [error, setError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isHinting, setIsHinting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef<PublicRoom | undefined>(undefined);
  const playerNameRef = useRef(playerName);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  const shareUrl = useMemo(() => {
    if (!room || typeof window === "undefined") {
      return "";
    }

    return `${window.location.origin}/lobby/${room.roomCode}`;
  }, [room]);

  function getSocket() {
    if (!socketRef.current) {
      const socket = io();
      socket.on("room:update", (nextRoom: PublicRoom) => {
        if (!nextRoom.calibration) {
          return;
        }

        setRoom(nextRoom);
      });
      socket.on("connect", () => {
        const currentRoom = roomRef.current;
        if (!currentRoom) {
          return;
        }

        socket.emit(
          "room:join",
          { roomCode: currentRoom.roomCode, playerName: playerNameRef.current },
          (result: Ack<PublicRoom>) => {
            if (!result.ok) {
              setError(result.error);
              return;
            }

            setRoom(result.data);
          },
        );
      });
      socketRef.current = socket;
    }

    return socketRef.current;
  }

  async function joinRoom() {
    setError("");
    setIsJoining(true);
    localStorage.setItem("playerName", playerName.trim() || "匿名玩家");

    const normalizedTargetWord = toSimplifiedChinese(targetWord.trim().replace(/\s+/g, ""));
    if (requestedRoomCode === "NEW" && targetMode === "custom") {
      if (normalizedTargetWord.length < 1 || normalizedTargetWord.length > MAX_WORD_LENGTH) {
        setError(`自定义目标词需要 1 到 ${MAX_WORD_LENGTH} 个字。`);
        setIsJoining(false);
        return;
      }
    }

    const socket = getSocket();
    const eventName = requestedRoomCode === "NEW" ? "room:create" : "room:join";
    const payload =
      requestedRoomCode === "NEW"
        ? {
            playerName,
            ...(targetMode === "custom" ? { targetWord: normalizedTargetWord } : {}),
          }
        : {
            roomCode: requestedRoomCode,
            playerName,
          };

    socket.emit(eventName, payload, (result: Ack<PublicRoom>) => {
      setIsJoining(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (!result.data.calibration) {
        setError("服务器未返回参考刻度，请刷新后重试。");
        return;
      }

      setRoom(result.data);
      if (requestedRoomCode === "NEW") {
        window.history.replaceState(null, "", `/lobby/${result.data.roomCode}`);
      }
    });
  }

  async function submitGuess(word: string) {
    if (!room) {
      return false;
    }

    setError("");
    return new Promise<boolean>((resolve) => {
      getSocket().emit("guess:submit", { roomCode: room.roomCode, word }, (result: Ack<{ guess: GuessResult }>) => {
        if (!result.ok) {
          setError(result.error);
          resolve(false);
          return;
        }

        resolve(true);
      });
    });
  }

  async function resetRandomTarget() {
    if (!room || room.customTarget || isResetting) {
      return;
    }

    setError("");
    setIsResetting(true);
    getSocket().emit("room:reset", { roomCode: room.roomCode }, (result: Ack<PublicRoom>) => {
      setIsResetting(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setRoom(result.data);
    });
  }

  async function revealHint() {
    if (!room || room.solved || isHinting) {
      return;
    }

    setError("");
    setIsHinting(true);
    getSocket().emit("hint:request", { roomCode: room.roomCode }, (result: Ack<{ guess: GuessResult }>) => {
      setIsHinting(false);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  async function copyShareUrl() {
    if (!shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
  }

  if (!room) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <section className="w-full rounded-[2rem] border border-white/10 bg-white/[0.06] p-7 backdrop-blur">
          <Link href="/" className="text-sm font-bold tracking-[0.35em] text-teal-100">
            字距
          </Link>
          <h1 className="mt-6 text-4xl font-black text-white">
            {requestedRoomCode === "NEW" ? "创建一起猜的房间" : `加入房间 ${requestedRoomCode}`}
          </h1>
          <p className="mt-4 leading-7 text-white/60">
            输入昵称后进入大厅。和朋友一起猜同一个目标词，所有猜测都会实时同步。
          </p>
          {requestedRoomCode === "NEW" ? (
            <div className="mt-6 space-y-4">
              <p className="text-sm text-white/50">目标词模式</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setTargetMode("random")}
                  className={`rounded-2xl border px-5 py-4 text-left transition ${
                    targetMode === "random"
                      ? "border-teal-200/70 bg-teal-200/10 text-white"
                      : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                  }`}
                >
                  <span className="block font-semibold">随机目标词</span>
                  <span className="mt-1 block text-sm text-white/50">系统从词库中随机挑选</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTargetMode("custom")}
                  className={`rounded-2xl border px-5 py-4 text-left transition ${
                    targetMode === "custom"
                      ? "border-teal-200/70 bg-teal-200/10 text-white"
                      : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                  }`}
                >
                  <span className="block font-semibold">自定义目标词</span>
                  <span className="mt-1 block text-sm text-white/50">房主指定词库中的 1 到 4 个字</span>
                </button>
              </div>
              {targetMode === "custom" ? (
                <input
                  value={targetWord}
                  onChange={(event) => setTargetWord(event.target.value)}
                  placeholder="输入目标词，需在词库中"
                  className="min-h-14 w-full rounded-2xl border border-white/10 bg-white/10 px-5 text-white outline-none placeholder:text-white/35 focus:border-teal-200/70"
                />
              ) : null}
            </div>
          ) : null}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="你的昵称"
              className="min-h-14 flex-1 rounded-2xl border border-white/10 bg-white/10 px-5 text-white outline-none placeholder:text-white/35 focus:border-teal-200/70"
            />
            <button
              onClick={() => void joinRoom()}
              disabled={isJoining}
              className="min-h-14 rounded-2xl bg-gradient-to-r from-teal-300 to-cyan-300 px-7 font-bold text-slate-950 disabled:opacity-50"
            >
              {isJoining ? "连接中" : requestedRoomCode === "NEW" ? "创建房间" : "加入房间"}
            </button>
          </div>
          {error ? <p className="mt-4 text-sm text-rose-200">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      <nav className="mb-10 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-[0.4em] text-teal-100">
          字距
        </Link>
        <div className="flex gap-2">
          {!room.customTarget ? (
            <button
              onClick={() => void resetRandomTarget()}
              disabled={isResetting}
              className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/70 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isResetting ? "换词中" : "换新词"}
            </button>
          ) : null}
          <button
            onClick={() => void revealHint()}
            disabled={room.solved || isHinting}
            className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/70 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isHinting ? "提示中" : "提示"}
          </button>
          <button
            onClick={() => void copyShareUrl()}
            className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm text-white/70 transition hover:bg-white/[0.1]"
          >
            复制邀请链接
          </button>
        </div>
      </nav>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="space-y-5">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 backdrop-blur">
            <p className="text-sm text-teal-100">大厅模式</p>
            <h1 className="mt-3 text-4xl font-black text-white">房间 {room.roomCode}</h1>
            <p className="mt-4 leading-7 text-white/60">
              和朋友一起猜同一个目标词。每个人的猜测都会实时同步，可参考下方刻度判断热度。
              {room.customTarget ? " 本房间由房主指定了目标词。" : " 本房间使用随机目标词。"}
            </p>
          </div>

          <SimilarityCalibrationCard calibration={room.calibration} />

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <StatCard label="在线玩家" value={room.players.length} />
            <StatCard label="总猜测" value={room.attempts} />
            <StatCard label="最佳热度" value={room.bestGuess?.proximity.toFixed(2) ?? "0.00"} />
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <p className="mb-3 text-sm text-white/50">玩家</p>
            <div className="flex flex-wrap gap-2">
              {room.players.map((player) => (
                <span key={player.id} className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/75">
                  {player.name}
                </span>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <GuessForm onGuess={submitGuess} disabled={room.solved} buttonLabel="一起猜" />
            {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
            {room.solved ? <p className="mt-3 text-sm text-emerald-200">房间已命中目标词。</p> : null}
          </div>
          <GuessHistory guesses={room.guesses} emptyText="大厅还没有猜词，先带大家热身。" />
        </section>
      </section>
    </main>
  );
}
