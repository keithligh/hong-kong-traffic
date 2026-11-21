import assert from "node:assert/strict";
import test from "node:test";
import {
  glyphAllowed,
  glyphUrl,
  isMtrScheduleUrl,
  isTileTemplate,
  mtrScheduleUrl,
  rewritePlanet,
  rewriteStyle,
  snapshotUrl,
  tileAllowed,
  tileUrl,
} from "./policy.ts";

test("MTR queries stay on the official schedule endpoint", () => {
  const url = mtrScheduleUrl("ISL", "CEN");
  assert.equal(isMtrScheduleUrl(url ?? ""), true);
  assert.equal(mtrScheduleUrl("isl", "CEN"), null);
  assert.equal(mtrScheduleUrl("ISL", "CEN&x=1"), null);
  assert.equal(isMtrScheduleUrl("https://evil.example/getSchedule.php?line=ISL&sta=CEN&lang=TC"), false);
});

test("snapshot keys cannot leave the camera host", () => {
  assert.equal(snapshotUrl("H106F"), "https://tdcctv.data.one.gov.hk/H106F.JPG");
  assert.equal(snapshotUrl("../etc"), null);
  assert.equal(snapshotUrl("a"), null);
});

test("tiles outside Hong Kong are refused", () => {
  assert.equal(tileAllowed(0, 0, 0, 14), true);
  assert.equal(tileAllowed(10, 0, 0, 14), false);
  assert.equal(tileAllowed(15, 1, 1, 14), false);
  let hongKong = 0;
  for (let x = 0; x < 256; x += 1) {
    for (let y = 0; y < 256; y += 1) {
      if (tileAllowed(8, x, y, 14)) hongKong += 1;
    }
  }
  assert.ok(hongKong > 0);
  assert.ok(hongKong < 16);
});

test("vector tile templates cannot be pointed at another host", () => {
  const template = "https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf";
  assert.equal(isTileTemplate(template), true);
  assert.equal(isTileTemplate("https://tiles.openfreemap.org.evil/planet/a/{z}/{x}/{y}.pbf"), false);
  assert.equal(tileUrl(template, 10, 0, 0), null);
});

test("glyphs and style rewrites stay on the OpenFreeMap paths we mirror", () => {
  assert.equal(glyphAllowed("Noto Sans Regular", "0-255"), true);
  assert.equal(glyphAllowed("Noto Sans Regular", "1-256"), false);
  assert.equal(glyphUrl("Comic Sans", "0-255"), null);
  const rewritten = rewriteStyle({
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    sources: { ne2_shaded: { tiles: ["https://example.invalid/{z}/{x}/{y}.png"] }, openmaptiles: { url: "https://example.invalid/planet" } },
  });
  assert.equal(rewritten?.spriteBase.endsWith("/ofm"), true);
  assert.equal(rewritten?.style.sprite, "/api/basemap/sprite/ofm");
  const planet = rewritePlanet({ tiles: ["https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf"] });
  assert.equal(planet?.tileTemplate.includes("openfreemap.org"), true);
  assert.deepEqual(planet?.planet.tiles, ["/api/basemap/tile/{z}/{x}/{y}"]);
  assert.equal(rewritePlanet({ tiles: ["https://evil.example/{z}/{x}/{y}.pbf"] }), null);
});
