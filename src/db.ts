import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

type Row = Record<string, unknown>;

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool: pg.Pool | undefined;
let local: Promise<PGlite> | undefined;
let readyOnce: Promise<void> | undefined;

export function ready(): Promise<void> {
  readyOnce ??= prepare().catch((error: unknown) => {
    readyOnce = undefined;
    throw error;
  });
  return readyOnce;
}

async function prepare(): Promise<void> {
  const sqlText = await readFile(path.join(process.cwd(), "migrations", "001_cache.sql"), "utf8");
  if (databaseUrl !== "") {
    pool ??= new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(sqlText);
    return;
  }
  await (await localDb()).exec(sqlText);
}

function localDb(): Promise<PGlite> {
  local ??= Promise.resolve(new PGlite());
  return local;
}

export async function sql(text: string, params: unknown[] = []): Promise<Row[]> {
  await ready();
  if (databaseUrl !== "") {
    const result = await pool!.query(text, params);
    return result.rows as Row[];
  }
  const result = await (await localDb()).query<Row>(text, params);
  return result.rows;
}
