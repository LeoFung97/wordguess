import { NextResponse } from "next/server";
import { gameEngine } from "@/lib/game/engine";

type RouteContext = {
  params: Promise<{
    gameId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { gameId } = await context.params;

  try {
    return NextResponse.json(gameEngine.revealHint(gameId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提示失败。" },
      { status: 400 },
    );
  }
}
