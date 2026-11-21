import maplibregl, { type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/noto-sans-tc/chinese-traditional-400.css";
import "@fontsource/noto-sans-tc/chinese-traditional-700.css";
import "./style.css";
import { loadCameras, type Camera } from "./cameras";
import { copy } from "./copy";
import network from "./data/network.json";
import { addCameras, addTransit, expandCluster, layerGroups, markStation, setGroupVisible } from "./layers";
import { renderCamera, renderIdle, renderLayers, renderStation, renderStationLoading, type LayerState, type LineSchedule } from "./panel";
import { interpretSchedule } from "./schedule";
import { stationMatches } from "./search";
import type { LineRecord, Network, StationRecord } from "./types";

const data = network as Network;
const stations = new Map(data.stations.map((station) => [station.code, station]));
const lines = new Map<string, LineRecord>(data.lines.map((line) => [line.code, line]));
const names = new Map(data.stations.map((station) => [station.code, station.name]));

const body = document.querySelector<HTMLElement>("#panel-body");
const layerHost = document.querySelector<HTMLElement>("#layers");
const banners = document.querySelector<HTMLElement>("#banners");
const search = document.querySelector<HTMLInputElement>("#search");
const results = document.querySelector<HTMLElement>("#search-results");
const form = document.querySelector<HTMLFormElement>("#search-form");
const mapNode = document.querySelector<HTMLElement>("#map");

if (!body || !layerHost || !banners || !search || !results || !form || !mapNode) {
  throw new Error("page shell is incomplete");
}

const panelBody = body;
const bannerHost = banners;
const searchInput = search;
const searchResults = results;

let selectedCode: string | null = null;
let requestId = 0;
const layers: LayerState = { lines: true, stations: true, cctv: true, aid: true };

function showBanner(message: string): void {
  if ([...bannerHost.children].some((node) => node.textContent === message)) return;
  const item = document.createElement("p");
  item.textContent = message;
  bannerHost.append(item);
}

function hideBanner(message: string): void {
  for (const node of [...bannerHost.children]) {
    if (node.textContent === message) node.remove();
  }
}

function clearSelection(): void {
  requestId += 1;
  markStation(map, selectedCode, null);
  selectedCode = null;
  renderIdle(panelBody);
}

const SCHEDULE_TIMEOUT_MS = 8000;

async function readLine(code: string, stationCode: string): Promise<LineSchedule> {
  const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${code}&sta=${stationCode}&lang=TC`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCHEDULE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const payload: unknown = await response.json();
      return { code, ...interpretSchedule(payload, names) };
    } catch {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      clearTimeout(timer);
    }
  }
  return { code, trains: [], empty: false, delay: false, unreachable: true, notice: null, url: null };
}

function padFor(): maplibregl.PaddingOptions {
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  return narrow
    ? { top: 28, bottom: 180, left: 20, right: 20 }
    : { top: 28, bottom: 28, left: 28, right: 40 };
}

async function openStation(station: StationRecord): Promise<void> {
  const token = ++requestId;
  markStation(map, selectedCode, station.code);
  selectedCode = station.code;
  renderStationLoading(panelBody, station, lines);
  map.easeTo({
    center: [station.lng, station.lat],
    zoom: Math.max(map.getZoom(), 13),
    padding: padFor(),
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
  });

  const ordered = station.lines.slice().sort((a, b) => data.lines.findIndex((line) => line.code === a) - data.lines.findIndex((line) => line.code === b));
  const readings = await Promise.all(ordered.map((code) => readLine(code, station.code)));
  if (token !== requestId) return;
  renderStation(panelBody, station, readings, lines, clearSelection);
}

function openCamera(camera: Camera): void {
  requestId += 1;
  markStation(map, selectedCode, null);
  selectedCode = null;
  renderCamera(panelBody, camera, clearSelection);
  map.easeTo({
    center: [camera.lng, camera.lat],
    zoom: Math.max(map.getZoom(), 14),
    padding: padFor(),
    duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
  });
}

function searchMatches(query: string): StationRecord[] {
  return data.stations.filter((station) => stationMatches(station, query)).slice(0, 8);
}

function showMatches(matches: StationRecord[]): void {
  searchResults.replaceChildren();
  if (!searchInput.value.trim()) {
    searchResults.hidden = true;
    return;
  }
  searchResults.hidden = false;
  if (matches.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = copy.noSearch;
    searchResults.append(empty);
    return;
  }
  for (const station of matches) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${station.name} ${station.en}`;
    button.addEventListener("click", () => {
      searchInput.value = station.name;
      searchResults.hidden = true;
      void openStation(station);
    });
    item.append(button);
    searchResults.append(item);
  }
}

const map = new maplibregl.Map({
  container: mapNode,
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [114.15, 22.36],
  zoom: 10.4,
  attributionControl: false,
  fadeDuration: 0,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

map.on("style.load", () => hideBanner(copy.basemapOffline));
map.on("load", () => {
  hideBanner(copy.basemapOffline);
  addTransit(map, data);
  setGroupVisible(map, layerGroups.lines, layers.lines);
  setGroupVisible(map, layerGroups.stations, layers.stations);
  map.on("click", "mtr-stations", (event: MapLayerMouseEvent) => {
    const code = event.features?.[0]?.properties?.code;
    const station = typeof code === "string" ? stations.get(code) : undefined;
    if (station) void openStation(station);
  });
  map.on("mouseenter", "mtr-stations", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "mtr-stations", () => { map.getCanvas().style.cursor = ""; });
  const bounds = new maplibregl.LngLatBounds();
  for (const station of data.stations) bounds.extend([station.lng, station.lat]);
  map.fitBounds(bounds, { padding: window.matchMedia("(max-width: 760px)").matches ? 28 : { top: 36, bottom: 36, left: 48, right: 48 }, duration: 0, maxZoom: 11 });
  void loadCameras().then((cameras) => {
    if (cameras.length === 0) {
      showBanner(copy.camerasOffline);
      return;
    }
    addCameras(map, cameras);
    setGroupVisible(map, layerGroups.cctv, layers.cctv);
    setGroupVisible(map, layerGroups.aid, layers.aid);
    bindCameraClicks();
  }).catch(() => {
    showBanner(copy.camerasOffline);
  });
});

window.setTimeout(() => {
  if (!map.isStyleLoaded()) showBanner(copy.basemapOffline);
}, 15000);

function bindCameraClicks(): void {
  for (const kind of ["cctv", "aid"] as const) {
    map.on("click", `${kind}-points`, (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const props = feature?.properties;
      if (!props || feature.geometry.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates;
      openCamera({
        key: String(props.key),
        kind,
        description: String(props.description),
        district: String(props.district),
        region: String(props.region),
        url: String(props.url),
        lng: Number(lng),
        lat: Number(lat),
      });
    });
    map.on("click", `${kind}-clusters`, (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates;
      expandCluster(map, kind, Number(feature.properties?.cluster_id), [Number(lng), Number(lat)]);
    });
    for (const layer of [`${kind}-points`, `${kind}-clusters`]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
  }
}

renderIdle(panelBody);
renderLayers(layerHost, layers, (key, pressed) => {
  layers[key] = pressed;
  setGroupVisible(map, layerGroups[key], pressed);
});

searchInput.addEventListener("input", () => showMatches(searchMatches(searchInput.value)));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const first = searchMatches(searchInput.value)[0];
  if (!first) return;
  searchResults.hidden = true;
  void openStation(first);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchResults.hidden = true;
    if (selectedCode || panelBody.querySelector(".shot, .line-block")) clearSelection();
  }
});

mapNode.setAttribute("role", "region");
mapNode.setAttribute("aria-label", copy.mapLabel);
