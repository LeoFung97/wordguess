import { NextResponse } from "next/server";
import { gameEngine } from "@/lib/game/engine";

type RouteContext = {
  params: Promise<{
    gameId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { gameId } = await context.params;
  const body = (await request.json()) as { word?: string };

  if (!body.word) {
    return NextResponse.json({ error: "请输入一个词。" }, { status: 400 });
  }

  try {
    return NextResponse.json(gameEngine.submitGuess(gameId, body.word));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "提交失败。" },
      { status: 400 },
    );
  }
}
