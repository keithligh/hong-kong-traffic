import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import {
  chainageBeforeStation,
  dedupeTrains,
  pointAt,
  project,
  trackPart,
  type PlacedTrain,
  type TrackPart,
} from "./motion";
import { interpretSchedule } from "./schedule";
import type { Network } from "./types";

const SPEED_MPS = 10;
const POLL_MS = 45_000;

type Anchor = { part: number; chainage: number };
type Ghost = PlacedTrain & { shown: number; color: string; stationChainage: number };

async function fetchSchedule(line: string, station: string): Promise<ReturnType<typeof interpretSchedule>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${station}&lang=TC`,
      { cache: "no-store", signal: controller.signal },
    );
    if (!response.ok) throw new Error(String(response.status));
    return interpretSchedule(await response.json(), new Map());
  } finally {
    clearTimeout(timer);
  }
}

export function startTrains(
  map: MapLibreMap,
  network: Network,
  names: ReadonlyMap<string, string>,
): { stop: () => void } {
  const partsByLine = new Map<string, TrackPart[]>();
  const anchors = new Map<string, Anchor>();
  const colors = new Map(network.lines.map((line) => [line.code, line.color]));
  for (const line of network.lines) {
    const parts = line.coordinates.map((coords) => trackPart(coords));
    partsByLine.set(line.code, parts);
    for (const station of network.stations) {
      if (!station.lines.includes(line.code)) continue;
      let best: Anchor & { distance: number } = { part: 0, chainage: 0, distance: Number.POSITIVE_INFINITY };
      parts.forEach((part, index) => {
        const hit = project(part, station.lng, station.lat);
        if (hit.distance < best.distance) best = { part: index, chainage: hit.chainage, distance: hit.distance };
      });
      if (best.distance <= 400) anchors.set(`${line.code}:${station.code}`, best);
    }
  }

  const jobs = network.stations.flatMap((station) => station.lines
    .filter((line) => anchors.has(`${line}:${station.code}`))
    .map((line) => ({ line, station: station.code })));

  let ghosts = new Map<string, Ghost>();
  let stopped = false;
  let last = performance.now();

  async function poll(): Promise<void> {
    const placed: PlacedTrain[] = [];
    let cursor = 0;
    async function worker(): Promise<void> {
      while (!stopped) {
        const index = cursor;
        cursor += 1;
        const job = jobs[index];
        if (!job) return;
        try {
          const reading = await fetchSchedule(job.line, job.station);
          const here = anchors.get(`${job.line}:${job.station}`);
          const parts = partsByLine.get(job.line);
          if (!here || !parts) continue;
          for (const train of reading.trains) {
            if (train.minutes === null) continue;
            const dest = anchors.get(`${job.line}:${train.destCode}`);
            const same = Boolean(dest && dest.part === here.part);
            placed.push({
              line: job.line,
              destCode: train.destCode,
              destName: names.get(train.destCode) ?? train.destName,
              stationCode: job.station,
              minutes: train.minutes,
              part: here.part,
              chainage: chainageBeforeStation(
                here.chainage,
                dest?.chainage ?? here.chainage,
                same,
                train.minutes,
                parts[here.part].length,
              ),
            });
          }
        } catch {
          // One station failing leaves the rest of the line moving.
        }
        if (placed.length > 0 && placed.length % 8 === 0) publish(placed);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (!stopped) publish(placed);
  }

  function publish(placed: PlacedTrain[]): void {
    const next = new Map<string, Ghost>();
    for (const train of dedupeTrains(placed)) {
      const id = `${train.line}:${train.destCode}:${train.part}:${Math.round(train.chainage / 500)}`;
      const previous = ghosts.get(id);
      const here = anchors.get(`${train.line}:${train.stationCode}`);
      next.set(id, {
        ...train,
        shown: previous && Math.abs(previous.shown - train.chainage) < 800 ? previous.shown : train.chainage,
        color: colors.get(train.line) ?? "#17211c",
        stationChainage: here?.chainage ?? train.chainage,
      });
    }
    ghosts = next;
  }

  function tick(now: number): void {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const source = map.getSource("mtr-trains") as GeoJSONSource | undefined;
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: [...ghosts.values()].map((train) => {
          const toward = train.stationChainage - train.shown;
          if (Math.abs(toward) > 1) {
            const step = Math.min(Math.abs(toward), SPEED_MPS * dt);
            train.shown += Math.sign(toward) * step;
          }
          const part = partsByLine.get(train.line)?.[train.part];
          const [lng, lat] = part ? pointAt(part, train.shown) : [0, 0];
          const when = train.minutes === 0 ? "即將到站" : `約 ${train.minutes} 分鐘`;
          return {
            type: "Feature" as const,
            properties: { color: train.color, label: `往${train.destName} · ${when}` },
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
          };
        }),
      });
    }
    requestAnimationFrame(tick);
  }

  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);
  requestAnimationFrame(tick);
  map.on("click", "mtr-trains", (event) => {
    const label = event.features?.[0]?.properties?.label;
    if (typeof label !== "string" || !event.lngLat) return;
    new maplibregl.Popup({ closeButton: false, offset: 12 })
      .setLngLat(event.lngLat)
      .setText(label)
      .addTo(map);
  });
  map.on("mouseenter", "mtr-trains", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "mtr-trains", () => { map.getCanvas().style.cursor = ""; });

  return {
    stop() {
      stopped = true;
      window.clearInterval(timer);
    },
  };
}
