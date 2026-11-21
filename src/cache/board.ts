import network from "../data/network.json";
import { interpretSchedule, type ScheduleReading } from "../schedule";
import type { Network } from "../types";
import { fetchLimited } from "./fetch";
import { BOARD_BUDGET_MS, BOARD_TTL_MS, isMtrScheduleUrl, mtrScheduleUrl } from "./policy";
import { HoldError, readThrough } from "./store";

const data = network as Network;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type BoardSchedules = Record<string, ScheduleReading>;

type StoredBoard = {
  fetchedAt: number;
  cursor: number;
  schedules: BoardSchedules;
};

export type SchedulePull = (url: string) => Promise<unknown>;

export function stationJobs(source: Network = data): { line: string; station: string }[] {
  const jobs: { line: string; station: string }[] = [];
  const seen = new Set<string>();
  for (const station of source.stations) {
    for (const line of station.lines) {
      const key = `${line}:${station.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ line, station: station.code });
    }
  }
  return jobs;
}

export function decodeBoard(body: Uint8Array | null): StoredBoard {
  if (!body) return { fetchedAt: 0, cursor: 0, schedules: {} };
  try {
    const parsed: unknown = JSON.parse(textDecoder.decode(body));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { fetchedAt: 0, cursor: 0, schedules: {} };
    const record = parsed as { fetchedAt?: unknown; cursor?: unknown; schedules?: unknown };
    const schedules = record.schedules;
    if (!schedules || typeof schedules !== "object" || Array.isArray(schedules)) {
      return { fetchedAt: 0, cursor: 0, schedules: {} };
    }
    return {
      fetchedAt: typeof record.fetchedAt === "number" ? record.fetchedAt : 0,
      cursor: typeof record.cursor === "number" && Number.isFinite(record.cursor) ? record.cursor : 0,
      schedules: schedules as BoardSchedules,
    };
  } catch {
    return { fetchedAt: 0, cursor: 0, schedules: {} };
  }
}

export async function pullSchedule(url: string): Promise<unknown> {
  if (!isMtrScheduleUrl(url)) throw new Error("blocked-url");
  const fetched = await fetchLimited(url, (candidate) => candidate === url, 100_000);
  return JSON.parse(textDecoder.decode(fetched.body));
}

/** Continue one bounded sweep. A slow or rate-limited source resumes next minute instead of stacking. */
export async function collectSchedules(options: {
  jobs: { line: string; station: string }[];
  cursor: number;
  previous: BoardSchedules;
  names: ReadonlyMap<string, string>;
  deadlineMs: number;
  pull: SchedulePull;
}): Promise<{ schedules: BoardSchedules; cursor: number; rateLimited: boolean; added: number }> {
  const schedules: BoardSchedules = { ...options.previous };
  const total = options.jobs.length;
  if (total === 0) return { schedules, cursor: 0, rateLimited: false, added: 0 };
  let walk = ((options.cursor % total) + total) % total;
  let visited = 0;
  let added = 0;
  let rateLimited = false;
  let stop = false;

  async function worker(): Promise<void> {
    while (!stop && visited < total && Date.now() < options.deadlineMs) {
      const job = options.jobs[walk % total];
      walk += 1;
      visited += 1;
      if (!job) return;
      const url = mtrScheduleUrl(job.line, job.station);
      if (!url) continue;
      try {
        const payload = await options.pull(url);
        schedules[`${job.line}:${job.station}`] = interpretSchedule(payload, options.names);
        added += 1;
      } catch (error) {
        if (error instanceof HoldError) {
          rateLimited = true;
          stop = true;
        }
      }
    }
  }

  await Promise.all([worker(), worker()]);
  return { schedules, cursor: walk % total, rateLimited, added };
}

export async function loadPublicBoard(): Promise<{ warming: true } | { warming: false; fetchedAt: number; schedules: BoardSchedules }> {
  const names = new Map(data.stations.map((station) => [station.code, station.name]));
  const jobs = stationJobs(data);
  const hit = await readThrough("mtr:board", BOARD_TTL_MS, async (previous) => {
    const prior = decodeBoard(previous);
    const collected = await collectSchedules({
      jobs,
      cursor: prior.cursor,
      previous: prior.schedules,
      names,
      deadlineMs: Date.now() + BOARD_BUDGET_MS,
      pull: pullSchedule,
    });
    if (collected.added === 0 && Object.keys(collected.schedules).length === 0) {
      throw new HoldError(collected.rateLimited ? 120_000 : 60_000);
    }
    const stored: StoredBoard = {
      fetchedAt: Date.now(),
      cursor: collected.cursor,
      schedules: collected.schedules,
    };
    return { body: textEncoder.encode(JSON.stringify(stored)), contentType: "application/json" };
  });
  if (!hit) return { warming: true };
  const stored = decodeBoard(hit.body);
  if (Object.keys(stored.schedules).length === 0) return { warming: true };
  return { warming: false, fetchedAt: stored.fetchedAt, schedules: stored.schedules };
}
