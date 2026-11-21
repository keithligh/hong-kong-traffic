import { loadGlyph } from "../../../../../src/cache/basemap";
import { bytesResponse, empty } from "../../../../../src/cache/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  if (path.length !== 2) return empty(404);
  const range = path[1].endsWith(".pbf") ? path[1].slice(0, -4) : "";
  if (!range) return empty(404);
  try {
    const glyph = await loadGlyph(path[0], range);
    if (!glyph) return empty(404);
    return bytesResponse(glyph.body, "application/x-protobuf", 86_400);
  } catch {
    return empty(404);
  }
}
