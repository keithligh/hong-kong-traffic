import type { ScheduleReading } from "./schedule";

export type LiveBoard = {
  fetchedAt: number;
  warming: boolean;
  schedules: Record<string, ScheduleReading>;
};

let board: LiveBoard | null = null;
const listeners = new Set<(next: LiveBoard) => void>();

export function currentBoard(): LiveBoard | null {
  return board;
}

export function onBoard(listener: (next: LiveBoard) => void): () => void {
  listeners.add(listener);
  if (board) listener(board);
  return () => listeners.delete(listener);
}

function publish(next: LiveBoard): void {
  board = next;
  for (const listener of listeners) listener(next);
}

function parseBoard(payload: unknown): LiveBoard | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as { fetchedAt?: unknown; warming?: unknown; schedules?: unknown };
  if (!record.schedules || typeof record.schedules !== "object" || Array.isArray(record.schedules)) return null;
  return {
    fetchedAt: typeof record.fetchedAt === "number" ? record.fetchedAt : 0,
    warming: record.warming === true,
    schedules: record.schedules as LiveBoard["schedules"],
  };
}

/** Read the shared board. The browser cache absorbs repeat views within its max-age. */
export function startLive(): () => void {
  let stopped = false;
  let timer = 0;
  const pull = async (): Promise<void> => {
    if (stopped) return;
    let wait = 15_000;
    try {
      const response = await fetch("/api/board");
      if (response.ok) {
        const next = parseBoard(await response.json());
        if (next) {
          publish(next);
          wait = next.warming || Object.keys(next.schedules).length === 0 ? 4_000 : 60_000;
        }
      }
    } catch {
      wait = 15_000;
    }
    if (!stopped) timer = window.setTimeout(() => void pull(), wait);
  };
  void pull();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
