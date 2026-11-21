import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { onBoard } from "./live";
import { pointAt } from "./motion";
import { indexTracks, placeFromSchedules } from "./place";
import type { PlacedTrain } from "./motion";
import type { Network } from "./types";

const SPEED_MPS = 10;

type Ghost = PlacedTrain & { shown: number; color: string; stationChainage: number };

export function startTrains(
  map: MapLibreMap,
  network: Network,
  names: ReadonlyMap<string, string>,
): { stop: () => void } {
  const index = indexTracks(network);
  let ghosts = new Map<string, Ghost>();

  const stopListen = onBoard((board) => {
    const next = new Map<string, Ghost>();
    for (const train of placeFromSchedules(index, board.schedules, names)) {
      const id = `${train.line}:${train.destCode}:${train.part}:${Math.round(train.chainage / 500)}`;
      const previous = ghosts.get(id);
      const here = index.anchors.get(`${train.line}:${train.stationCode}`);
      next.set(id, {
        ...train,
        shown: previous && Math.abs(previous.shown - train.chainage) < 800 ? previous.shown : train.chainage,
        color: index.colors.get(train.line) ?? "#17211c",
        stationChainage: here?.chainage ?? train.chainage,
      });
    }
    ghosts = next;
    draw(0);
  });

  function draw(dt: number): void {
    const source = map.getSource("mtr-trains") as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: [...ghosts.values()].map((train) => {
        const toward = train.stationChainage - train.shown;
        if (dt > 0 && Math.abs(toward) > 1) {
          const step = Math.min(Math.abs(toward), SPEED_MPS * dt);
          train.shown += Math.sign(toward) * step;
        }
        const part = index.partsByLine.get(train.line)?.[train.part];
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

  const timer = window.setInterval(() => draw(0.25), 250);
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
      window.clearInterval(timer);
      stopListen();
    },
  };
}
