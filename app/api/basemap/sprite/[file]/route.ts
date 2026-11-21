import { loadSprite } from "../../../../../src/cache/basemap";
import { spriteSuffix } from "../../../../../src/cache/policy";
import { bytesResponse, empty } from "../../../../../src/cache/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await context.params;
  if (!spriteSuffix(file)) return empty(404);
  try {
    const sprite = await loadSprite(file);
    if (!sprite) return empty(404);
    return bytesResponse(sprite.body, sprite.contentType, 86_400);
  } catch {
    return empty(404);
  }
}
