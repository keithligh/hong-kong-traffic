export type CameraKind = "cctv" | "aid";

export type Camera = {
  key: string;
  kind: CameraKind;
  region: string;
  district: string;
  description: string;
  lng: number;
  lat: number;
  url: string;
};

const IMAGE_HOST = "https://tdcctv.data.one.gov.hk/";

function field(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) return "";
  return match[1]
    .trim()
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseCameraXml(xml: string): Camera[] {
  const cameras: Camera[] = [];
  for (const block of xml.match(/<image>[\s\S]*?<\/image>/g) ?? []) {
    const key = field(block, "key");
    const lat = Number(field(block, "latitude"));
    const lng = Number(field(block, "longitude"));
    if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 22 || lat > 23 || lng < 113.8 || lng > 114.5) continue;
    const given = field(block, "url");
    const url = given.startsWith(IMAGE_HOST) ? given : `${IMAGE_HOST}${key}.JPG`;
    cameras.push({
      key,
      kind: key.startsWith("AID") ? "aid" : "cctv",
      region: field(block, "region"),
      district: field(block, "district"),
      description: field(block, "description") || key,
      lng,
      lat,
      url,
    });
  }
  return cameras;
}

const localSnapshot = /^\/api\/snapshot\/[A-Za-z0-9]{3,32}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/** Accept only cameras this site serves. A cached payload cannot point the browser elsewhere. */
export function camerasFromPayload(payload: unknown): Camera[] {
  if (!Array.isArray(payload)) return [];
  const cameras: Camera[] = [];
  for (const item of payload) {
    const row = asRecord(item);
    if (!row) continue;
    const key = typeof row.key === "string" ? row.key : "";
    const url = typeof row.url === "string" ? row.url : "";
    const lat = typeof row.lat === "number" ? row.lat : Number.NaN;
    const lng = typeof row.lng === "number" ? row.lng : Number.NaN;
    const kind = row.kind === "aid" || row.kind === "cctv" ? row.kind : null;
    if (!kind || !key || !localSnapshot.test(url)) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 22 || lat > 23 || lng < 113.8 || lng > 114.5) continue;
    cameras.push({
      key,
      kind,
      region: typeof row.region === "string" ? row.region : "",
      district: typeof row.district === "string" ? row.district : "",
      description: typeof row.description === "string" && row.description.trim() ? row.description : key,
      lng,
      lat,
      url,
    });
  }
  return cameras;
}

export async function loadCameras(fetchImpl: typeof fetch = fetch): Promise<Camera[]> {
  const response = await fetchImpl("/api/cameras");
  if (!response.ok) throw new Error(`camera-list-${response.status}`);
  return camerasFromPayload(await response.json());
}

/** Refresh the JPEG about as often as the Transport Department updates it. */
export function freshImageUrl(url: string, now = Date.now()): string {
  if (!url.startsWith(IMAGE_HOST)) return url;
  const bucket = Math.floor(now / 120_000);
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}t=${bucket}`;
}
