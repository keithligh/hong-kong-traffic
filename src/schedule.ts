export type Train = {
  destCode: string;
  destName: string;
  platform: string;
  minutes: number | null;
  clock: string;
  uncertain: boolean;
};

export type ScheduleReading = {
  trains: Train[];
  empty: boolean;
  delay: boolean;
  unreachable: boolean;
  notice: string | null;
  url: string | null;
};

type RawTrain = {
  dest?: unknown;
  plat?: unknown;
  time?: unknown;
  ttnt?: unknown;
  valid?: unknown;
  seq?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function trainList(value: unknown): RawTrain[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RawTrain => record(item) !== null);
}

function clockOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function platformOf(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function minutesOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readTrain(raw: RawTrain, names: ReadonlyMap<string, string>): Train | null {
  const destCode = typeof raw.dest === "string" ? raw.dest.trim() : "";
  if (!destCode) return null;
  const minutes = minutesOf(raw.ttnt);
  const platform = platformOf(raw.plat);
  return {
    destCode,
    destName: names.get(destCode) ?? destCode,
    platform,
    minutes,
    clock: clockOf(raw.time),
    uncertain: raw.valid === "N",
  };
}

const GENERIC_NOTICE = new Set(["", "successful", "the contents are empty!"]);

function serviceNotice(root: Record<string, unknown>): { notice: string | null; url: string | null } {
  const message = typeof root.message === "string" ? root.message.trim() : "";
  const error = record(root.error);
  const errorMsg = error && typeof error.errorMsg === "string" ? error.errorMsg.trim() : "";
  const text = message || errorMsg;
  const notice = GENERIC_NOTICE.has(text.toLowerCase()) ? null : text;
  const rawUrl = typeof root.url === "string" ? root.url.trim() : "";
  const url = rawUrl.startsWith("https://") ? rawUrl : null;
  return { notice, url };
}

/** Turn one next-train response into rows the panel can show. */
export function interpretSchedule(payload: unknown, names: ReadonlyMap<string, string>): ScheduleReading {
  const root = record(payload);
  if (!root) return { trains: [], empty: false, delay: false, unreachable: true, notice: null, url: null };

  const status = root.status;
  const failed = status === 0 || status === "0";
  const data = record(root.data);
  const block = data ? record(Object.values(data)[0]) : null;
  if (failed || !block) {
    return { trains: [], empty: true, delay: false, unreachable: false, ...serviceNotice(root) };
  }

  const trains = [...trainList(block.UP), ...trainList(block.DOWN)]
    .map((raw) => readTrain(raw, names))
    .filter((train): train is Train => train !== null)
    .sort((a, b) => {
      const left = a.minutes ?? Number.POSITIVE_INFINITY;
      const right = b.minutes ?? Number.POSITIVE_INFINITY;
      return left - right || a.destName.localeCompare(b.destName, "zh-Hant");
    });

  return {
    trains,
    empty: trains.length === 0,
    delay: root.isdelay === "Y",
    unreachable: false,
    notice: null,
    url: null,
  };
}
