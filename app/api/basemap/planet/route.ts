import { loadPlanet } from "../../../../src/cache/basemap";
import { bytesResponse, empty } from "../../../../src/cache/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const planet = await loadPlanet();
    if (!planet) return empty(503);
    return bytesResponse(planet.body, "application/json", 3600);
  } catch {
    return empty(503);
  }
}
