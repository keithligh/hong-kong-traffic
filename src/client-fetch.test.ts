import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the browser bundle does not call the upstream data hosts", () => {
  const files = ["main.ts", "trains.ts", "live.ts", "panel.ts"];
  const source = files.map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");
  assert.equal(source.includes("data.gov.hk"), false);
  assert.equal(source.includes("openfreemap.org"), false);
  assert.equal(source.includes("tdcctv.data.one.gov.hk"), false);
});
