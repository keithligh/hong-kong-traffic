/** Place a train on the curved track using minutes until it reaches a station. */

const SPEED_MPS = 10;

export type TrackPart = {
  coords: [number, number][];
  cumulative: number[];
  length: number;
};

export type PlacedTrain = {
  line: string;
  destCode: string;
  destName: string;
  stationCode: string;
  minutes: number;
  part: number;
  chainage: number;
};

function metres(a: [number, number], b: [number, number]): number {
  const cos = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111_320 * cos, (b[1] - a[1]) * 111_320);
}

export function trackPart(coords: number[][]): TrackPart {
  const points = coords.map((pair) => [pair[0], pair[1]] as [number, number]);
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + metres(points[index - 1], points[index]));
  }
  return { coords: points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

export function project(part: TrackPart, lng: number, lat: number): { chainage: number; distance: number } {
  let chainage = 0;
  let distance = Number.POSITIVE_INFINITY;
  const point: [number, number] = [lng, lat];
  for (let index = 1; index < part.coords.length; index += 1) {
    const start = part.coords[index - 1];
    const end = part.coords[index];
    const span = part.cumulative[index] - part.cumulative[index - 1];
    const cos = Math.cos(point[1] * Math.PI / 180);
    const px = (point[0] - start[0]) * 111_320 * cos;
    const py = (point[1] - start[1]) * 111_320;
    const dx = (end[0] - start[0]) * 111_320 * cos;
    const dy = (end[1] - start[1]) * 111_320;
    const lengthSq = dx * dx + dy * dy;
    const ratio = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
    const gap = Math.hypot(px - dx * ratio, py - dy * ratio);
    if (gap < distance) {
      distance = gap;
      chainage = part.cumulative[index - 1] + ratio * span;
    }
  }
  return { chainage, distance };
}

export function pointAt(part: TrackPart, chainage: number): [number, number] {
  const target = Math.max(0, Math.min(part.length, chainage));
  let index = 1;
  while (index < part.cumulative.length - 1 && part.cumulative[index] < target) index += 1;
  const span = part.cumulative[index] - part.cumulative[index - 1] || 1;
  const ratio = (target - part.cumulative[index - 1]) / span;
  const start = part.coords[index - 1];
  const end = part.coords[index];
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
}

/** The train is still before the station, on the opposite side from its destination. */
export function chainageBeforeStation(
  stationChainage: number,
  destChainage: number,
  samePart: boolean,
  ttntMinutes: number,
  partLength: number,
): number {
  if (!samePart || ttntMinutes <= 0) return Math.max(0, Math.min(partLength, stationChainage));
  const direction = destChainage >= stationChainage ? -1 : 1;
  const back = ttntMinutes * 60 * SPEED_MPS;
  return Math.max(0, Math.min(partLength, stationChainage + direction * back));
}

export function dedupeTrains(trains: PlacedTrain[]): PlacedTrain[] {
  const kept: PlacedTrain[] = [];
  const sorted = trains.slice().sort((a, b) => a.minutes - b.minutes);
  for (const train of sorted) {
    const clash = kept.some((other) => other.line === train.line
      && other.part === train.part
      && Math.abs(other.chainage - train.chainage) < 400);
    if (!clash) kept.push(train);
  }
  return kept;
}
