import assert from "node:assert/strict";
import test from "node:test";
import { chainageBeforeStation, dedupeTrains, pointAt, project, trackPart } from "./motion.ts";

const part = trackPart([
  [114, 22],
  [114.01, 22],
  [114.02, 22],
]);

test("a train due now sits on the station", () => {
  const station = project(part, 114.01, 22);
  assert.ok(station.distance < 5);
  const chainage = chainageBeforeStation(station.chainage, part.length, true, 0, part.length);
  assert.ok(Math.abs(chainage - station.chainage) < 1);
});

test("a train going onward is still behind the station", () => {
  const station = project(part, 114.01, 22);
  const chainage = chainageBeforeStation(station.chainage, part.length, true, 2, part.length);
  assert.ok(chainage < station.chainage);
  assert.ok(station.chainage - chainage > 1000);
  assert.ok(station.chainage - chainage < 1300);
});

test("pointAt stays on the line", () => {
  const [lng, lat] = pointAt(part, part.length / 2);
  assert.ok(Math.abs(lat - 22) < 0.0001);
  assert.ok(lng > 114 && lng < 114.02);
});

test("nearby estimates of one train collapse", () => {
  const trains = dedupeTrains([
    { line: "ISL", destCode: "CHW", destName: "柴灣", stationCode: "CEN", minutes: 1, part: 0, chainage: 1000 },
    { line: "ISL", destCode: "CHW", destName: "柴灣", stationCode: "ADM", minutes: 3, part: 0, chainage: 1200 },
    { line: "ISL", destCode: "KET", destName: "堅尼地城", stationCode: "CEN", minutes: 2, part: 0, chainage: 4000 },
  ]);
  assert.equal(trains.length, 2);
});
