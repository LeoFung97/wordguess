import type { Server, Socket } from "socket.io";
import { GameEngine, bestGuess } from "../lib/game/engine";
import type { GuessResult } from "../lib/game/types";

type Player = {
  id: string;
  name: string;
};

type LobbyRoom = {
  roomCode: string;
  session: ReturnType<GameEngine["createSharedSession"]>;
  players: Map<string, Player>;
  createdAt: number;
  emptyRoomCleanup?: NodeJS.Timeout;
};

type ClientAck<T> = (result: { ok: true; data: T } | { ok: false; error: string }) => void;

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomCode(existingCodes: Set<string>) {
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)]).join(
      "",
    );
  } while (existingCodes.has(code));

  return code;
}

function normalizePlayerName(name?: string) {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 16) : "匿名玩家";
}

function publicRoom(room: LobbyRoom) {
  return {
    roomCode: room.roomCode,
    players: Array.from(room.players.values()),
    guesses: room.session.guesses,
    bestGuess: bestGuess(room.session.guesses),
    solved: room.session.solved,
    attempts: room.session.guesses.length,
  };
}

export function registerLobbyHandlers(io: Server) {
  const gameEngine = new GameEngine();
  const rooms = new Map<string, LobbyRoom>();
  const emptyRoomTtlMs = 5 * 60 * 1000;

  function joinSocketToRoom(socket: Socket, room: LobbyRoom, playerName?: string) {
    if (room.emptyRoomCleanup) {
      clearTimeout(room.emptyRoomCleanup);
      room.emptyRoomCleanup = undefined;
    }

    socket.join(room.roomCode);
    socket.data.roomCode = room.roomCode;
    socket.data.playerName = normalizePlayerName(playerName);
    room.players.set(socket.id, {
      id: socket.id,
      name: socket.data.playerName,
    });
  }

  io.on("connection", (socket) => {
    socket.on("room:create", (payload: { playerName?: string }, ack: ClientAck<ReturnType<typeof publicRoom>>) => {
      const roomCode = createRoomCode(new Set(rooms.keys()));
      const room: LobbyRoom = {
        roomCode,
        session: gameEngine.createSharedSession(),
        players: new Map(),
        createdAt: Date.now(),
      };
      rooms.set(roomCode, room);
      joinSocketToRoom(socket, room, payload.playerName);
      ack({ ok: true, data: publicRoom(room) });
      io.to(roomCode).emit("room:update", publicRoom(room));
    });

    socket.on("room:join", (payload: { roomCode?: string; playerName?: string }, ack: ClientAck<ReturnType<typeof publicRoom>>) => {
      const roomCode = payload.roomCode?.trim().toUpperCase();
      const room = roomCode ? rooms.get(roomCode) : undefined;

      if (!room) {
        ack({ ok: false, error: "找不到这个房间。" });
        return;
      }

      joinSocketToRoom(socket, room, payload.playerName);
      ack({ ok: true, data: publicRoom(room) });
      io.to(room.roomCode).emit("room:update", publicRoom(room));
    });

    socket.on(
      "guess:submit",
      (payload: { roomCode?: string; word?: string }, ack: ClientAck<{ guess: GuessResult }>) => {
        const roomCode = payload.roomCode?.trim().toUpperCase() || socket.data.roomCode;
        const room = roomCode ? rooms.get(roomCode) : undefined;

        if (!room || !payload.word) {
          ack({ ok: false, error: "无法提交这个猜测。" });
          return;
        }

        try {
          const result = gameEngine.submitGuessToSession(room.session, payload.word, socket.data.playerName);
          ack({ ok: true, data: { guess: result.guess } });
          io.to(room.roomCode).emit("room:update", publicRoom(room));
        } catch (error) {
          ack({ ok: false, error: error instanceof Error ? error.message : "提交失败。" });
        }
      },
    );

    socket.on("hint:request", (payload: { roomCode?: string }, ack: ClientAck<{ guess: GuessResult }>) => {
      const roomCode = payload.roomCode?.trim().toUpperCase() || socket.data.roomCode;
      const room = roomCode ? rooms.get(roomCode) : undefined;

      if (!room) {
        ack({ ok: false, error: "无法生成提示。" });
        return;
      }

      try {
        const result = gameEngine.revealHintInSession(room.session);
        ack({ ok: true, data: { guess: result.guess } });
        io.to(room.roomCode).emit("room:update", publicRoom(room));
      } catch (error) {
        ack({ ok: false, error: error instanceof Error ? error.message : "提示失败。" });
      }
    });

    socket.on("disconnect", () => {
      const roomCode = socket.data.roomCode;
      const room = roomCode ? rooms.get(roomCode) : undefined;
      if (!room) {
        return;
      }

      room.players.delete(socket.id);
      if (room.players.size === 0) {
        room.emptyRoomCleanup = setTimeout(() => {
          if (room.players.size === 0) {
            rooms.delete(room.roomCode);
          }
        }, emptyRoomTtlMs);
        return;
      }

      io.to(room.roomCode).emit("room:update", publicRoom(room));
    });
  });
}
