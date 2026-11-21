import { fetchLimited } from "./fetch";
import {
  BASEMAP_TTL_MS,
  glyphUrl,
  isPng,
  isSpriteBase,
  isTileTemplate,
  PLANET_URL,
  rewritePlanet,
  rewriteStyle,
  shadeUrl,
  spriteSuffix,
  STYLE_URL,
  tileUrl,
} from "./policy";
import { HoldError, putRaw, readRaw, readThrough, type Cached } from "./store";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type Meta = { tileTemplate: string; spriteBase: string };

async function refreshBasemap(): Promise<{ body: Uint8Array; contentType: string }> {
  const styleFetched = await fetchLimited(STYLE_URL, (candidate) => candidate === STYLE_URL, 2_000_000);
  const planetFetched = await fetchLimited(PLANET_URL, (candidate) => candidate === PLANET_URL, 8_000_000);
  const style = rewriteStyle(JSON.parse(textDecoder.decode(styleFetched.body)));
  const planet = rewritePlanet(JSON.parse(textDecoder.decode(planetFetched.body)));
  if (!style || !planet) throw new HoldError(10 * 60_000);
  const meta: Meta = { tileTemplate: planet.tileTemplate, spriteBase: style.spriteBase };
  await putRaw("basemap:meta", textEncoder.encode(JSON.stringify(meta)), "application/json");
  await putRaw("basemap:planet", textEncoder.encode(JSON.stringify(planet.planet)), "application/json");
  return { body: textEncoder.encode(JSON.stringify(style.style)), contentType: "application/json" };
}

async function ensureBasemap(): Promise<void> {
  await readThrough("basemap:style", BASEMAP_TTL_MS, refreshBasemap);
}

async function meta(): Promise<Meta | null> {
  await ensureBasemap();
  const row = await readRaw("basemap:meta", BASEMAP_TTL_MS);
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(textDecoder.decode(row.body));
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { tileTemplate?: unknown; spriteBase?: unknown };
    if (typeof record.tileTemplate !== "string" || typeof record.spriteBase !== "string") return null;
    if (!isTileTemplate(record.tileTemplate) || !isSpriteBase(record.spriteBase)) return null;
    return { tileTemplate: record.tileTemplate, spriteBase: record.spriteBase };
  } catch {
    return null;
  }
}

export function loadStyle(): Promise<Cached | null> {
  return readThrough("basemap:style", BASEMAP_TTL_MS, refreshBasemap);
}

export async function loadPlanet(): Promise<Cached | null> {
  await ensureBasemap();
  return readRaw("basemap:planet", BASEMAP_TTL_MS);
}

export async function loadVectorTile(z: number, x: number, y: number): Promise<Cached | null> {
  const description = await meta();
  const url = description ? tileUrl(description.tileTemplate, z, x, y) : null;
  if (!url) return null;
  return readThrough(`tile:${z}:${x}:${y}`, BASEMAP_TTL_MS, async () => {
    const fetched = await fetchLimited(url, (candidate) => candidate === url, 2_000_000);
    return { body: fetched.body, contentType: "application/x-protobuf" };
  });
}

export function loadShade(z: number, x: number, y: number): Promise<Cached | null> {
  const url = shadeUrl(z, x, y);
  if (!url) return Promise.resolve(null);
  return readThrough(`shade:${z}:${x}:${y}`, BASEMAP_TTL_MS, async () => {
    const fetched = await fetchLimited(url, (candidate) => candidate === url, 2_000_000);
    if (!isPng(fetched.body)) throw new HoldError(60 * 60_000);
    return { body: fetched.body, contentType: "image/png" };
  });
}

export async function loadSprite(file: string): Promise<Cached | null> {
  const suffix = spriteSuffix(file);
  const description = suffix ? await meta() : null;
  if (!suffix || !description) return null;
  const url = `${description.spriteBase}${suffix}`;
  return readThrough(`sprite:${file}`, BASEMAP_TTL_MS, async () => {
    const fetched = await fetchLimited(url, (candidate) => candidate === url, 5_000_000);
    const png = file.endsWith(".png");
    if (png && !isPng(fetched.body)) throw new HoldError(60 * 60_000);
    if (!png && fetched.body[0] !== 0x7b && fetched.body[0] !== 0x5b) throw new HoldError(60 * 60_000);
    return { body: fetched.body, contentType: png ? "image/png" : "application/json" };
  });
}

export function loadGlyph(fontstack: string, range: string): Promise<Cached | null> {
  const url = glyphUrl(fontstack, range);
  if (!url) return Promise.resolve(null);
  return readThrough(`glyph:${fontstack}:${range}`, BASEMAP_TTL_MS, async () => {
    const fetched = await fetchLimited(url, (candidate) => candidate === url, 1_000_000);
    return { body: fetched.body, contentType: "application/x-protobuf" };
  });
}
