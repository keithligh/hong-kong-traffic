import { camerasFromPayload, parseCameraXml, type Camera } from "../cameras";
import { fetchLimited } from "./fetch";
import { CAMERA_LIST_TTL_MS, CAMERA_LIST_URL, isJpeg, SNAPSHOT_TTL_MS, snapshotUrl } from "./policy";
import { HoldError, readThrough, type Cached } from "./store";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function published(cameras: Camera[]): Camera[] {
  return cameras.flatMap((camera) => {
    const url = snapshotUrl(camera.key);
    if (!url) return [];
    return [{ ...camera, url: `/api/snapshot/${camera.key}` }];
  });
}

export async function loadCameraList(): Promise<Camera[]> {
  const hit = await readThrough("cameras:list", CAMERA_LIST_TTL_MS, async () => {
    const fetched = await fetchLimited(CAMERA_LIST_URL, (candidate) => candidate === CAMERA_LIST_URL, 2_000_000);
    const cameras = published(parseCameraXml(textDecoder.decode(fetched.body)));
    if (cameras.length === 0) throw new HoldError(60_000);
    return { body: textEncoder.encode(JSON.stringify(cameras)), contentType: "application/json" };
  });
  if (!hit) return [];
  try {
    return camerasFromPayload(JSON.parse(textDecoder.decode(hit.body)));
  } catch {
    return [];
  }
}

export async function loadSnapshot(key: string): Promise<Cached | null> {
  const cameras = await loadCameraList();
  if (!cameras.some((camera) => camera.key === key)) return null;
  const url = snapshotUrl(key);
  if (!url) return null;
  return readThrough(`snapshot:${key}`, SNAPSHOT_TTL_MS, async () => {
    const fetched = await fetchLimited(url, (candidate) => candidate === url, 500_000);
    if (!isJpeg(fetched.body)) throw new HoldError(10 * 60_000);
    return { body: fetched.body, contentType: "image/jpeg" };
  });
}
