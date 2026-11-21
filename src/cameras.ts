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

const LIST_URL = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml";
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

export async function loadCameras(fetchImpl: typeof fetch = fetch): Promise<Camera[]> {
  const response = await fetchImpl(LIST_URL);
  if (!response.ok) throw new Error(`camera-list-${response.status}`);
  return parseCameraXml(await response.text());
}

/** Refresh the JPEG about as often as the Transport Department updates it. */
export function freshImageUrl(url: string, now = Date.now()): string {
  if (!url.startsWith(IMAGE_HOST)) return url;
  const bucket = Math.floor(now / 120_000);
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}t=${bucket}`;
}
