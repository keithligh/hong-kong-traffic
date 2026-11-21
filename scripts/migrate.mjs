import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim() ?? "";
if (url === "") {
  console.log("migrate: nothing to do");
  process.exit(0);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED?.trim() || url });
await client.connect();
try {
  await client.query("set lock_timeout = '60s'");
  await client.query("select pg_advisory_lock(7272741)");
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const name = "001_cache.sql";
  const done = await client.query("select 1 from schema_migrations where name = $1", [name]);
  if (done.rowCount === 0) {
    await client.query("begin");
    try {
      await client.query(await readFile(new URL("../migrations/001_cache.sql", import.meta.url), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log(`migrate: applied ${name}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.end();
}
