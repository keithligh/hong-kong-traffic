type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  return null;
}

function localPath(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/basemap/")) return null;
  return origin + value;
}

function pageOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin;
  } catch {
    return false;
  }
}

/** Turn cached root-relative basemap paths into absolute URLs for this page. */
export function localizeBasemap(style: unknown, planet: unknown, origin: string): JsonRecord | null {
  if (!pageOrigin(origin)) return null;
  const spec = record(structuredClone(style));
  const tileset = record(planet);
  const sources = spec ? record(spec.sources) : null;
  const shaded = sources ? record(sources.ne2_shaded) : null;
  const vector = sources ? record(sources.openmaptiles) : null;
  const shadeTiles = shaded?.tiles;
  const planetTiles = tileset?.tiles;
  if (!spec || !sources || !shaded || !vector || !Array.isArray(shadeTiles) || !Array.isArray(planetTiles)) return null;
  const sprite = localPath(spec.sprite, origin);
  const glyphs = localPath(spec.glyphs, origin);
  const shade = shadeTiles.map((tile) => localPath(tile, origin));
  const tiles = planetTiles.map((tile) => localPath(tile, origin));
  if (!sprite || !glyphs || shade.some((tile) => tile === null) || tiles.some((tile) => tile === null) || tiles.length === 0) return null;
  spec.sprite = sprite;
  spec.glyphs = glyphs;
  shaded.tiles = shade;
  const source: JsonRecord = {
    type: "vector",
    tiles,
    minzoom: typeof tileset?.minzoom === "number" ? tileset.minzoom : 0,
    maxzoom: typeof tileset?.maxzoom === "number" ? tileset.maxzoom : 14,
  };
  if (typeof tileset?.attribution === "string") source.attribution = tileset.attribution;
  sources.openmaptiles = source;
  return spec;
}
