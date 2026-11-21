import { sql } from "../db";

export type Cached = {
  body: Uint8Array;
  contentType: string;
  fetchedAtMs: number;
};

export class HoldError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super("hold");
    this.name = "HoldError";
    this.ms = ms;
  }
}

type Stored = {
  body: Uint8Array | null;
  contentType: string | null;
  fetchedAtMs: number | null;
  claimUntilMs: number | null;
};

const inflight = new Map<string, Promise<Cached | null>>();

function asBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  return null;
}

function asMillis(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowOf(row: Record<string, unknown> | undefined): Stored | null {
  if (!row) return null;
  return {
    body: asBytes(row.body),
    contentType: typeof row.content_type === "string" ? row.content_type : null,
    fetchedAtMs: asMillis(row.fetched_at_ms),
    claimUntilMs: asMillis(row.claim_until_ms),
  };
}

async function readRow(key: string): Promise<Stored | null> {
  const rows = await sql(
    "select body, content_type, fetched_at_ms, claim_until_ms from cache_object where key = $1",
    [key],
  );
  return rowOf(rows[0]);
}

async function claim(key: string, claimUntil: number, staleBefore: number, now: number): Promise<boolean> {
  const updated = await sql(
    `update cache_object
     set claim_until_ms = $2
     where key = $1
       and (fetched_at_ms is null or fetched_at_ms < $3)
       and (claim_until_ms is null or claim_until_ms < $4)
     returning key`,
    [key, claimUntil, staleBefore, now],
  );
  if (updated.length > 0) return true;
  const inserted = await sql(
    `insert into cache_object (key, body, content_type, fetched_at_ms, claim_until_ms)
     values ($1, null, null, null, $2)
     on conflict (key) do nothing
     returning key`,
    [key, claimUntil],
  );
  return inserted.length > 0;
}

async function save(key: string, body: Uint8Array, contentType: string, fetchedAtMs: number): Promise<void> {
  await sql(
    `update cache_object
     set body = $2, content_type = $3, fetched_at_ms = $4, claim_until_ms = null
     where key = $1`,
    [key, Buffer.from(body), contentType, fetchedAtMs],
  );
}

async function hold(key: string, until: number): Promise<void> {
  await sql("update cache_object set claim_until_ms = $2 where key = $1", [key, until]);
}

async function evict(prefix: string, keep: number): Promise<void> {
  const pattern = `${prefix}%`;
  const rows = await sql("select count(*) as count from cache_object where key like $1", [pattern]);
  const count = Number(rows[0]?.count ?? 0);
  if (count <= keep) return;
  await sql(
    `delete from cache_object
     where key like $1
       and key not in (
         select key from cache_object where key like $1 order by fetched_at_ms desc nulls last limit $2
       )`,
    [pattern, keep],
  );
}

function ready(row: Stored | null, now: number, ttlMs: number): Cached | null {
  if (!row?.body || row.fetchedAtMs === null || now - row.fetchedAtMs >= ttlMs) return null;
  return { body: row.body, contentType: row.contentType ?? "application/octet-stream", fetchedAtMs: row.fetchedAtMs };
}

function stale(row: Stored | null): Cached | null {
  if (!row?.body || row.fetchedAtMs === null) return null;
  return { body: row.body, contentType: row.contentType ?? "application/octet-stream", fetchedAtMs: row.fetchedAtMs };
}

async function readThroughInner(
  key: string,
  ttlMs: number,
  load: (previous: Uint8Array | null) => Promise<{ body: Uint8Array; contentType: string }>,
): Promise<Cached | null> {
  const now = Date.now();
  const row = await readRow(key);
  const fresh = ready(row, now, ttlMs);
  if (fresh) return fresh;
  const owned = await claim(key, now + 30_000, now - ttlMs, now);
  if (!owned) return stale(row);
  try {
    const loaded = await load(row?.body ?? null);
    const fetchedAtMs = Date.now();
    await save(key, loaded.body, loaded.contentType, fetchedAtMs);
    if (key.startsWith("tile:")) await evict("tile:", 2_500);
    if (key.startsWith("shade:")) await evict("shade:", 400);
    if (key.startsWith("glyph:")) await evict("glyph:", 800);
    if (key.startsWith("snapshot:")) await evict("snapshot:", 400);
    return { body: loaded.body, contentType: loaded.contentType, fetchedAtMs };
  } catch (error) {
    const pause = error instanceof HoldError ? error.ms : 15_000;
    await hold(key, Date.now() + pause);
    return stale(row);
  }
}

/** One upstream fetch per key for the whole server, shared by every visitor. */
export function readThrough(
  key: string,
  ttlMs: number,
  load: (previous: Uint8Array | null) => Promise<{ body: Uint8Array; contentType: string }>,
): Promise<Cached | null> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = readThroughInner(key, ttlMs, load).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export async function putRaw(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const now = Date.now();
  await sql(
    `insert into cache_object (key, body, content_type, fetched_at_ms, claim_until_ms)
     values ($1, $2, $3, $4, null)
     on conflict (key) do update
     set body = excluded.body,
         content_type = excluded.content_type,
         fetched_at_ms = excluded.fetched_at_ms,
         claim_until_ms = null`,
    [key, Buffer.from(body), contentType, now],
  );
}

export async function readRaw(key: string, ttlMs: number): Promise<Cached | null> {
  return ready(await readRow(key), Date.now(), ttlMs);
}
