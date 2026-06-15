"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ROOM_CODE_LENGTH = 4;

export function JoinLobbyForm() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();

    if (code.length !== ROOM_CODE_LENGTH) {
      setError(`请输入 ${ROOM_CODE_LENGTH} 位房间码。`);
      return;
    }

    setError("");
    router.push(`/lobby/${code}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <input
          value={roomCode}
          onChange={(event) => {
            setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH));
            setError("");
          }}
          placeholder="输入 4 位房间码"
          maxLength={ROOM_CODE_LENGTH}
          className="min-h-14 w-full rounded-2xl border border-white/15 bg-white/[0.08] px-5 text-center text-lg font-semibold tracking-[0.35em] text-white outline-none placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-white/35 focus:border-teal-200/70 focus:bg-white/[0.12]"
        />
        {error ? <p className="mt-2 text-sm text-rose-200">{error}</p> : null}
      </div>
      <button
        type="submit"
        className="min-h-14 shrink-0 rounded-2xl border border-white/15 bg-white/[0.08] px-7 font-bold text-white backdrop-blur transition hover:bg-white/[0.12]"
      >
        加入大厅
      </button>
    </form>
  );
}
