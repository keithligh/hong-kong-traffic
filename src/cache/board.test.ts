import assert from "node:assert/strict";
import test from "node:test";
import network from "../data/network.json" with { type: "json" };
import type { Network } from "../types.ts";
import { collectSchedules, stationJobs } from "./board.ts";
import { HoldError } from "./store.ts";
import { isMtrScheduleUrl, mtrScheduleUrl } from "./policy.ts";

const data = network as Network;

test("every station pair is an allowlisted MTR query", () => {
  const jobs = stationJobs(data);
  assert.equal(jobs.length, 121);
  for (const job of jobs) {
    const url = mtrScheduleUrl(job.line, job.station);
    assert.equal(isMtrScheduleUrl(url ?? ""), true);
  }
});

test("a rate limit stops the sweep instead of calling the rest", async () => {
  const jobs = [
    { line: "ISL", station: "CEN" },
    { line: "ISL", station: "ADM" },
    { line: "ISL", station: "WAC" },
    { line: "ISL", station: "CAB" },
  ];
  let calls = 0;
  const collected = await collectSchedules({
    jobs,
    cursor: 0,
    previous: {},
    names: new Map([["CHW", "柴灣"]]),
    deadlineMs: Date.now() + 5_000,
    pull: () => {
      calls += 1;
      throw new HoldError(60_000);
    },
  });
  assert.equal(calls, 1);
  assert.equal(collected.added, 0);
  assert.equal(collected.rateLimited, true);
});

test("successful reads are kept and the cursor advances", async () => {
  const jobs = [
    { line: "ISL", station: "CEN" },
    { line: "ISL", station: "ADM" },
  ];
  const collected = await collectSchedules({
    jobs,
    cursor: 0,
    previous: {},
    names: new Map([["CHW", "柴灣"]]),
    deadlineMs: Date.now() + 5_000,
    pull: async () => ({
      status: 1,
      data: { ISL: { UP: [{ dest: "CHW", ttnt: "2", plat: "1", time: "2026-01-01 10:00:00" }] } },
    }),
  });
  assert.equal(collected.added, 2);
  assert.equal(collected.schedules["ISL:CEN"]?.trains[0]?.destName, "柴灣");
  assert.equal(collected.cursor, 0);
});
