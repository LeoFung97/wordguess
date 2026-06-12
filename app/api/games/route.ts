import { NextResponse } from "next/server";
import { gameEngine } from "@/lib/game/engine";

export async function POST() {
  return NextResponse.json(gameEngine.createGame());
}
