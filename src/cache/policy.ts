/** What this server is willing to fetch, and how long a shared copy stays valid. */

export const BOARD_TTL_MS = 60_000;
export const CAMERA_LIST_TTL_MS = 12 * 60 * 60 * 1000;
export const SNAPSHOT_TTL_MS = 120_000;
export const BASEMAP_TTL_MS = 24 * 60 * 60 * 1000;
export const BOARD_BUDGET_MS = 12_000;

const HK = { west: 113.55, south: 21.93, east: 114.72, north: 22.78 };

const MTR_URL = /^https:\/\/rt\.data\.gov\.hk\/v1\/transport\/mtr\/getSchedule\.php\?line=[A-Z]{2,4}&sta=[A-Z0-9]{2,4}&lang=TC$/;
const TILE_TEMPLATE = /^https:\/\/tiles\.openfreemap\.org\/planet\/[A-Za-z0-9_]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/;
const SPRITE_BASE = /^https:\/\/tiles\.openfreemap\.org\/sprites\/[A-Za-z0-9_]+\/ofm$/;
const GLYPH_FONTS = new Set(["Noto Sans Regular", "Noto Sans Italic", "Noto Sans Bold"]);

export const CAMERA_LIST_URL = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml";
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const PLANET_URL = "https://tiles.openfreemap.org/planet";

export function mtrScheduleUrl(line: string, station: string): string | null {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`;
  return MTR_URL.test(url) ? url : null;
}

export function isMtrScheduleUrl(url: string): boolean {
  return MTR_URL.test(url);
}

export function snapshotUrl(key: string): string | null {
  if (!/^[A-Za-z0-9]{3,32}$/.test(key)) return null;
  return `https://tdcctv.data.one.gov.hk/${key}.JPG`;
}

export function isTileTemplate(url: string): boolean {
  return TILE_TEMPLATE.test(url);
}

export function isSpriteBase(url: string): boolean {
  return SPRITE_BASE.test(url);
}

export function spriteSuffix(file: string): string | null {
  if (file === "ofm.json") return ".json";
  if (file === "ofm.png") return ".png";
  if (file === "ofm@2x.json") return "@2x.json";
  if (file === "ofm@2x.png") return "@2x.png";
  return null;
}

export function glyphAllowed(fontstack: string, range: string): boolean {
  const fonts = fontstack.split(",");
  if (fonts.length < 1 || fonts.length > 3 || !fonts.every((font) => GLYPH_FONTS.has(font))) return false;
  const match = /^(\d+)-(\d+)$/.exec(range);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return start % 256 === 0 && end === start + 255 && start <= 65_280;
}

export function glyphUrl(fontstack: string, range: string): string | null {
  if (!glyphAllowed(fontstack, range)) return null;
  return `https://tiles.openfreemap.org/fonts/${encodeURIComponent(fontstack)}/${range}.pbf`;
}

export function shadeUrl(z: number, x: number, y: number): string | null {
  if (!tileAllowed(z, x, y, 6)) return null;
  return `https://tiles.openfreemap.org/natural_earth/ne2sr/${z}/${x}/${y}.png`;
}

export function tileUrl(template: string, z: number, x: number, y: number): string | null {
  if (!isTileTemplate(template) || !tileAllowed(z, x, y, 14)) return null;
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

function tileLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileLat(y: number, z: number): number {
  const mercator = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(mercator));
}

/** Hong Kong tiles only, so the cache cannot be used to crawl the planet. */
export function tileAllowed(z: number, x: number, y: number, maxZoom: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < 0 || z > maxZoom || z > 14) return false;
  const span = 2 ** z;
  if (x < 0 || y < 0 || x >= span || y >= span) return false;
  const west = tileLng(x, z);
  const east = tileLng(x + 1, z);
  const north = tileLat(y, z);
  const south = tileLat(y + 1, z);
  return east > HK.west && west < HK.east && north > HK.south && south < HK.north;
}

export function parseTileParts(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) return null;
  return { z: Number(z), x: Number(x), y: Number(y) };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  return null;
}

export function rewriteStyle(upstream: unknown): { style: JsonRecord; spriteBase: string } | null {
  const style = record(structuredClone(upstream));
  const sources = style ? record(style.sources) : null;
  const shaded = sources ? record(sources.ne2_shaded) : null;
  const planet = sources ? record(sources.openmaptiles) : null;
  const sprite = style && typeof style.sprite === "string" ? style.sprite : "";
  if (!style || !sources || !shaded || !planet || !isSpriteBase(sprite)) return null;
  shaded.tiles = ["/api/basemap/shade/{z}/{x}/{y}"];
  planet.url = "/api/basemap/planet";
  style.sprite = "/api/basemap/sprite/ofm";
  style.glyphs = "/api/basemap/glyph/{fontstack}/{range}.pbf";
  return { style, spriteBase: sprite };
}

export function rewritePlanet(upstream: unknown): { planet: JsonRecord; tileTemplate: string } | null {
  const planet = record(structuredClone(upstream));
  const tiles = planet?.tiles;
  const template = Array.isArray(tiles) && typeof tiles[0] === "string" ? tiles[0] : "";
  if (!planet || !isTileTemplate(template)) return null;
  planet.tiles = ["/api/basemap/tile/{z}/{x}/{y}"];
  return { planet, tileTemplate: template };
}

export function isJpeg(body: Uint8Array): boolean {
  return body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
}

export function isPng(body: Uint8Array): boolean {
  return body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
}
