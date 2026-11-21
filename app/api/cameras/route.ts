import { loadCameraList } from "../../../src/cache/snapshots";
import { empty } from "../../../src/cache/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const cameras = await loadCameraList();
    if (cameras.length === 0) return empty(503);
    return Response.json(cameras, { headers: { "cache-control": "public, max-age=3600" } });
  } catch {
    return empty(503);
  }
}
