import { loadPublicBoard } from "../../../src/cache/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  try {
    const board = await loadPublicBoard();
    if (board.warming) {
      return Response.json(
        { fetchedAt: 0, warming: true, schedules: {} },
        { headers: { "cache-control": "public, max-age=3" } },
      );
    }
    return Response.json(
      { fetchedAt: board.fetchedAt, warming: false, schedules: board.schedules },
      { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=30" } },
    );
  } catch {
    return Response.json(
      { fetchedAt: 0, warming: true, schedules: {} },
      { headers: { "cache-control": "public, max-age=3" } },
    );
  }
}
