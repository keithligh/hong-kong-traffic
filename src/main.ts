import maplibregl, { type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/noto-sans-tc/chinese-traditional-400.css";
import "@fontsource/noto-sans-tc/chinese-traditional-700.css";
import "./style.css";
import { localizeBasemap } from "./basemap";
import { loadCameras, type Camera } from "./cameras";
import { copy } from "./copy";
import network from "./data/network.json";
import { addCameras, addTransit, addTrains, expandCluster, layerGroups, markStation, setGroupVisible } from "./layers";
import { currentBoard, onBoard, startLive } from "./live";
import { renderCamera, renderIdle, renderLayers, renderStation, renderStationLoading, type LayerState, type LineSchedule } from "./panel";
import { stationMatches } from "./search";
import { startTrains } from "./trains";
import type { LineRecord, Network, StationRecord } from "./types";

const data = network as Network;
const stations = new Map(data.stations.map((station) => [station.code, station]));
const names = new Map(data.stations.map((station) => [station.code, station.name]));
const lines = new Map<string, LineRecord>(data.lines.map((line) => [line.code, line]));

export async function boot(): Promise<() => void> {
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
  const layers: LayerState = { lines: true, stations: true, cctv: true, aid: true, trains: true };

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

  function hongKongClock(date = new Date()): string {
    return new Intl.DateTimeFormat("zh-HK", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Hong_Kong",
    }).format(date);
  }

  function padFor(): maplibregl.PaddingOptions {
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    return narrow
      ? { top: 28, bottom: 180, left: 20, right: 20 }
      : { top: 28, bottom: 28, left: 28, right: 40 };
  }

  function readingsFor(station: StationRecord): LineSchedule[] {
    const board = currentBoard();
    const ordered = station.lines.slice().sort((a, b) => data.lines.findIndex((line) => line.code === a) - data.lines.findIndex((line) => line.code === b));
    return ordered.map((code) => {
      const reading = board?.schedules[`${code}:${station.code}`];
      if (!reading) return { code, trains: [], empty: false, delay: false, unreachable: true, notice: null, url: null };
      return { code, ...reading };
    });
  }

  function paintStation(station: StationRecord, focus: boolean): void {
    const board = currentBoard();
    if (!board || (board.warming && Object.keys(board.schedules).length === 0)) {
      renderStationLoading(panelBody, station, lines);
      return;
    }
    const updatedAt = board.fetchedAt > 0 ? hongKongClock(new Date(board.fetchedAt)) : "—";
    renderStation(panelBody, station, readingsFor(station), lines, clearSelection, { focus, updatedAt });
  }

  function clearSelection(): void {
    markStation(map, selectedCode, null);
    selectedCode = null;
    renderIdle(panelBody);
  }

  function openStation(station: StationRecord): void {
    markStation(map, selectedCode, station.code);
    selectedCode = station.code;
    paintStation(station, true);
    map.easeTo({
      center: [station.lng, station.lat],
      zoom: Math.max(map.getZoom(), 13),
      padding: padFor(),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
    });
  }

  function openCamera(camera: Camera): void {
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
        openStation(station);
      });
      item.append(button);
      searchResults.append(item);
    }
  }

  const [styleResponse, planetResponse] = await Promise.all([
    fetch("/api/basemap/style").catch(() => null),
    fetch("/api/basemap/planet").catch(() => null),
  ]);
  const localized = styleResponse?.ok && planetResponse?.ok
    ? localizeBasemap(await styleResponse.json(), await planetResponse.json(), window.location.origin)
    : null;
  if (!localized) showBanner(copy.basemapOffline);
  const map = new maplibregl.Map({
    container: mapNode,
    style: (localized ?? { version: 8, sources: {}, layers: [] }) as maplibregl.StyleSpecification,
    center: [114.15, 22.36],
    zoom: 10.4,
    attributionControl: false,
    fadeDuration: 0,
    maxZoom: 16,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

  let trains: { stop: () => void } | null = null;
  map.on("style.load", () => hideBanner(copy.basemapOffline));
  map.on("load", () => {
    hideBanner(copy.basemapOffline);
    addTransit(map, data);
    addTrains(map);
    trains = startTrains(map, data, names);
    setGroupVisible(map, layerGroups.lines, layers.lines);
    setGroupVisible(map, layerGroups.stations, layers.stations);
    setGroupVisible(map, layerGroups.trains, layers.trains);
    map.on("click", "mtr-stations", (event: MapLayerMouseEvent) => {
      const top = map.queryRenderedFeatures(event.point, { layers: ["mtr-trains", "mtr-stations"] })[0];
      if (top?.layer.id === "mtr-trains") return;
      const code = event.features?.[0]?.properties?.code;
      const station = typeof code === "string" ? stations.get(code) : undefined;
      if (station) openStation(station);
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

  const basemapTimer = window.setTimeout(() => {
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

  const onInput = (): void => showMatches(searchMatches(searchInput.value));
  const onSubmit = (event: Event): void => {
    event.preventDefault();
    const first = searchMatches(searchInput.value)[0];
    if (!first) return;
    searchResults.hidden = true;
    openStation(first);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    searchResults.hidden = true;
    if (selectedCode || panelBody.querySelector(".shot, .line-block")) clearSelection();
  };
  searchInput.addEventListener("input", onInput);
  form.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", onKey);
  const stopLive = startLive();
  const stopBoard = onBoard(() => {
    if (!selectedCode) return;
    const station = stations.get(selectedCode);
    if (station) paintStation(station, false);
  });

  mapNode.setAttribute("role", "region");
  mapNode.setAttribute("aria-label", copy.mapLabel);

  return () => {
    window.clearTimeout(basemapTimer);
    stopLive();
    stopBoard();
    trains?.stop();
    searchInput.removeEventListener("input", onInput);
    form.removeEventListener("submit", onSubmit);
    document.removeEventListener("keydown", onKey);
    map.remove();
  };
}
