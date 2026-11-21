import type { ScheduleReading } from "./schedule";
import type { Network } from "./types";
import {
  chainageBeforeStation,
  dedupeTrains,
  project,
  trackPart,
  type PlacedTrain,
  type TrackPart,
} from "./motion";

type Anchor = { part: number; chainage: number };

export type TrackIndex = {
  partsByLine: Map<string, TrackPart[]>;
  anchors: Map<string, Anchor>;
  colors: Map<string, string>;
};

export function indexTracks(network: Network): TrackIndex {
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
  return { partsByLine, anchors, colors };
}

export function placeFromSchedules(
  index: TrackIndex,
  schedules: Readonly<Record<string, ScheduleReading>>,
  names: ReadonlyMap<string, string>,
): PlacedTrain[] {
  const placed: PlacedTrain[] = [];
  for (const [key, reading] of Object.entries(schedules)) {
    const split = key.indexOf(":");
    if (split <= 0) continue;
    const line = key.slice(0, split);
    const station = key.slice(split + 1);
    const here = index.anchors.get(key);
    const parts = index.partsByLine.get(line);
    if (!here || !parts || !reading?.trains) continue;
    for (const train of reading.trains) {
      if (train.minutes === null) continue;
      const dest = index.anchors.get(`${line}:${train.destCode}`);
      const same = Boolean(dest && dest.part === here.part);
      placed.push({
        line,
        destCode: train.destCode,
        destName: names.get(train.destCode) ?? train.destName,
        stationCode: station,
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
  }
  return dedupeTrains(placed);
}
