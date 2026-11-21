import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Camera } from "./cameras";
import type { Network } from "./types";

const LINE = "mtr-lines";
const STATIONS = "mtr-stations";
const LABELS = "mtr-labels";

export function addTransit(map: MapLibreMap, network: Network): void {
  map.addSource("mtr-lines", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: network.lines.map((line) => ({
        type: "Feature",
        properties: { code: line.code, name: line.name, color: line.color },
        geometry: { type: "MultiLineString", coordinates: line.coordinates },
      })),
    },
  });
  map.addSource("stations", {
    type: "geojson",
    promoteId: "code",
    data: {
      type: "FeatureCollection",
      features: network.stations.map((station) => ({
        type: "Feature",
        id: station.code,
        properties: {
          code: station.code,
          name: station.name,
          en: station.en,
          lineCount: station.lines.length,
        },
        geometry: { type: "Point", coordinates: [station.lng, station.lat] },
      })),
    },
  });

  map.addLayer({
    id: LINE,
    type: "line",
    source: "mtr-lines",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 13, 4, 16, 7],
      "line-opacity": 0.95,
    },
  });
  map.addLayer({
    id: STATIONS,
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 13, 5.5, 16, 8],
      "circle-color": "#fbfcfa",
      "circle-stroke-color": ["case", ["boolean", ["feature-state", "selected"], false], "#0c6b4d", "#17211c"],
      "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 4, 1.6],
    },
  });
  map.addLayer({
    id: LABELS,
    type: "symbol",
    source: "stations",
    minzoom: 12,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-offset": [0, 1.05],
      "text-anchor": "top",
      "text-optional": true,
      "symbol-sort-key": ["-", ["get", "lineCount"]],
    },
    paint: {
      "text-color": "#17211c",
      "text-halo-color": "#fbfcfa",
      "text-halo-width": 1.3,
    },
  });
}

export function addCameras(map: MapLibreMap, cameras: Camera[]): void {
  for (const kind of ["cctv", "aid"] as const) {
    const points = cameras.filter((camera) => camera.kind === kind);
    map.addSource(kind, {
      type: "geojson",
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 14,
      data: {
        type: "FeatureCollection",
        features: points.map((camera) => ({
          type: "Feature",
          properties: {
            key: camera.key,
            description: camera.description,
            district: camera.district,
            region: camera.region,
            url: camera.url,
            kind: camera.kind,
          },
          geometry: { type: "Point", coordinates: [camera.lng, camera.lat] },
        })),
      },
    });
    const color = kind === "cctv" ? "#C2410C" : "#1D4E89";
    map.addLayer({
      id: `${kind}-clusters`,
      type: "circle",
      source: kind,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": color,
        "circle-radius": ["step", ["get", "point_count"], 13, 20, 16, 80, 20],
        "circle-opacity": 0.88,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#fbfcfa",
      },
    });
    map.addLayer({
      id: `${kind}-count`,
      type: "symbol",
      source: kind,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
      },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: `${kind}-points`,
      type: "circle",
      source: kind,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": color,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 5, 16, 7],
        "circle-stroke-width": 1.4,
        "circle-stroke-color": "#fbfcfa",
      },
    });
  }
}

export function setGroupVisible(map: MapLibreMap, ids: string[], visible: boolean): void {
  const value = visible ? "visible" : "none";
  for (const id of ids) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", value);
  }
}

export function markStation(map: MapLibreMap, previous: string | null, next: string | null): void {
  if (previous) map.setFeatureState({ source: "stations", id: previous }, { selected: false });
  if (next) map.setFeatureState({ source: "stations", id: next }, { selected: true });
}

export function expandCluster(map: MapLibreMap, sourceId: string, clusterId: number, center: [number, number]): void {
  const source = map.getSource(sourceId) as GeoJSONSource;
  source.getClusterExpansionZoom(clusterId).then((zoom) => {
    map.easeTo({ center, zoom });
  }).catch(() => {
    map.easeTo({ center, zoom: map.getZoom() + 1 });
  });
}

export const layerGroups = {
  lines: [LINE],
  stations: [STATIONS, LABELS],
  cctv: ["cctv-clusters", "cctv-count", "cctv-points"],
  aid: ["aid-clusters", "aid-count", "aid-points"],
};
