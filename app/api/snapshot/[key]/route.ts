import { bytesResponse, empty } from "../../../../src/cache/respond";
import { loadSnapshot } from "../../../../src/cache/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const { key } = await context.params;
  if (!/^[A-Za-z0-9]{3,32}$/.test(key)) return empty(404);
  try {
    const image = await loadSnapshot(key);
    if (!image) return empty(404);
    return bytesResponse(image.body, "image/jpeg", 60);
  } catch {
    return empty(404);
  }
}
