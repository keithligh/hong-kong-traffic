import { loadShade } from "../../../../../../../src/cache/basemap";
import { parseTileParts } from "../../../../../../../src/cache/policy";
import { bytesResponse, empty } from "../../../../../../../src/cache/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const params = await context.params;
  const tile = parseTileParts(params.z, params.x, params.y);
  if (!tile) return empty(404);
  try {
    const body = await loadShade(tile.z, tile.x, tile.y);
    if (!body) return empty(404);
    return bytesResponse(body.body, "image/png", 86_400);
  } catch {
    return empty(404);
  }
}
