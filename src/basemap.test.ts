import assert from "node:assert/strict";
import test from "node:test";
import { localizeBasemap } from "./basemap.ts";

const style = {
  sprite: "/api/basemap/sprite/ofm",
  glyphs: "/api/basemap/glyph/{fontstack}/{range}.pbf",
  sources: {
    ne2_shaded: { tiles: ["/api/basemap/shade/{z}/{x}/{y}"] },
    openmaptiles: { type: "vector", url: "/api/basemap/planet" },
  },
};
const planet = {
  tiles: ["/api/basemap/tile/{z}/{x}/{y}"],
  minzoom: 0,
  maxzoom: 14,
  attribution: "OpenFreeMap",
};

test("basemap paths become absolute urls for the page that is open", () => {
  const localized = localizeBasemap(style, planet, "https://hong-kong-traffic.apps.grok.bot");
  assert.equal(localized?.sprite, "https://hong-kong-traffic.apps.grok.bot/api/basemap/sprite/ofm");
  const sources = localized?.sources as { openmaptiles: { tiles: string[]; attribution: string }; ne2_shaded: { tiles: string[] } };
  assert.equal(sources.openmaptiles.tiles[0], "https://hong-kong-traffic.apps.grok.bot/api/basemap/tile/{z}/{x}/{y}");
  assert.equal(sources.openmaptiles.attribution, "OpenFreeMap");
  assert.equal(sources.ne2_shaded.tiles[0].startsWith("https://hong-kong-traffic.apps.grok.bot/api/"), true);
});

test("a basemap payload cannot send the browser to another host", () => {
  assert.equal(localizeBasemap(style, planet, "javascript:alert(1)"), null);
  assert.equal(localizeBasemap(style, { tiles: ["https://evil.example/{z}/{x}/{y}"] }, "https://map.example"), null);
});
