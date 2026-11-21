import assert from "node:assert/strict";
import test from "node:test";
import { HoldError, readThrough } from "./store.ts";

const text = new TextEncoder();
const decode = new TextDecoder();

test("one upstream read serves every caller until it expires", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { body: text.encode("ok"), contentType: "text/plain" };
  };
  const [first, second] = await Promise.all([
    readThrough("test:share", 60_000, load),
    readThrough("test:share", 60_000, load),
  ]);
  const third = await readThrough("test:share", 60_000, load);
  assert.equal(calls, 1);
  assert.equal(decode.decode(first?.body), "ok");
  assert.equal(decode.decode(second?.body), "ok");
  assert.equal(decode.decode(third?.body), "ok");
});

test("a failed read holds the key so the next caller does not retry immediately", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    throw new HoldError(60_000);
  };
  assert.equal(await readThrough("test:hold", 60_000, load), null);
  assert.equal(await readThrough("test:hold", 60_000, load), null);
  assert.equal(calls, 1);
});
