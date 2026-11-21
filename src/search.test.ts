import assert from "node:assert/strict";
import test from "node:test";
import { stationMatches } from "./search.ts";

const stations = [
  { name: "荔枝角", en: "Lai Chi Kok", code: "LCK" },
  { name: "荔景", en: "Lai King", code: "LAK" },
  { name: "宋皇臺", en: "Sung Wong Toi", code: "SUW" },
  { name: "石硤尾", en: "Shek Kip Mei", code: "SKM" },
];

test("common and variant characters find the same station", () => {
  assert.equal(stations.some((station) => stationMatches(station, "荔枝角")), true);
  assert.equal(stations.some((station) => stationMatches(station, "茘枝角")), true);
  assert.equal(stations.some((station) => stationMatches(station, "荔景")), true);
  assert.equal(stations.some((station) => stationMatches(station, "宋皇台")), true);
  assert.equal(stations.some((station) => stationMatches(station, "石峽尾")), true);
  assert.equal(stations.some((station) => stationMatches(station, "lai chi kok")), true);
});
