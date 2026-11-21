import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { interpretSchedule } from "./schedule.ts";
import type { Network } from "./types.ts";

const network = JSON.parse(readFileSync(new URL("./data/network.json", import.meta.url), "utf8")) as Network;
const names = new Map(network.stations.map((station) => [station.code, station.name]));

test("network keeps every heavy-rail station, including Racecourse", () => {
  assert.equal(network.stations.length, 98);
  assert.equal(network.lines.length, 10);
  const admiralty = network.stations.find((station) => station.code === "ADM");
  assert.deepEqual(admiralty?.lines.slice().sort(), ["EAL", "ISL", "SIL", "TWL"]);
  assert.equal(network.stations.find((station) => station.code === "RAC")?.name, "馬場");
  assert.equal(network.stations.find((station) => station.code === "LHP")?.lines.includes("TKL"), true);
  assert.equal(network.stations.find((station) => station.code === "LMC")?.lines.includes("EAL"), true);
  const eastRail = network.lines.find((line) => line.code === "EAL");
  assert.equal(eastRail?.coordinates.length, 3);
});

test("empty racecourse timetable is a clear empty state", () => {
  const reading = interpretSchedule(
    {
      status: 1,
      isdelay: "N",
      message: "successful",
      data: { "EAL-RAC": { UP: [], DOWN: [] } },
    },
    names,
  );
  assert.equal(reading.empty, true);
  assert.equal(reading.unreachable, false);
  assert.equal(reading.delay, false);
});

test("a terminus without a DOWN field still shows its trains", () => {
  const reading = interpretSchedule(
    {
      status: 1,
      isdelay: "N",
      data: {
        "DRL-DIS": {
          UP: [{ dest: "SUN", plat: "1", time: "2026-11-21 10:35:15", ttnt: "2", valid: "Y" }],
        },
      },
    },
    names,
  );
  assert.equal(reading.empty, false);
  assert.equal(reading.trains.length, 1);
  assert.equal(reading.trains[0]?.destName, "欣澳");
  assert.equal(reading.trains[0]?.minutes, 2);
  assert.equal(reading.trains[0]?.clock, "10:35");
});

test("arriving trains and both directions use Chinese destinations", () => {
  const reading = interpretSchedule(
    {
      status: 1,
      isdelay: "Y",
      data: {
        "ISL-CEN": {
          UP: [{ dest: "CHW", plat: "3", time: "2026-11-21 10:34:46", ttnt: "2", valid: "Y" }],
          DOWN: [{ dest: "KET", plat: "4", time: "2026-11-21 10:32:46", ttnt: "0", valid: "N" }],
        },
      },
    },
    names,
  );
  assert.equal(reading.delay, true);
  assert.deepEqual(
    reading.trains.map((train) => train.minutes),
    [0, 2],
  );
  assert.equal(reading.trains[0]?.destName, "堅尼地城");
  assert.equal(reading.trains[0]?.uncertain, true);
  assert.equal(reading.trains[1]?.destName, "柴灣");
});

test("a rejected line and station pair is empty, not a connection failure", () => {
  const reading = interpretSchedule(
    { status: 0, message: "The contents are empty!", error: { errorCode: "NT-204" } },
    names,
  );
  assert.equal(reading.empty, true);
  assert.equal(reading.unreachable, false);
  assert.equal(reading.notice, null);
});

test("a service notice is shown and a generic empty error is not", () => {
  const notice = interpretSchedule(
    {
      status: 0,
      message: "因熱帶氣旋，車站暫停服務",
      url: "https://www.mtr.com.hk/alert",
    },
    names,
  );
  assert.equal(notice.notice, "因熱帶氣旋，車站暫停服務");
  assert.equal(notice.url, "https://www.mtr.com.hk/alert");
  const blocked = interpretSchedule({ status: 0, message: "詳情", url: "javascript:alert(1)" }, names);
  assert.equal(blocked.url, null);
});
