#!/usr/bin/env python3
"""Build the MTR network the map draws.

Station order comes from the MTR routes file. Positions come from Lands
Department iGeoCom railway stations. Racecourse is in the live next-train
list and in iGeoCom, but not in the routes file, so it is added as a spur.

Shared corridors are bowed apart by 48 metres. That is about the width of a
wide Hong Kong road: enough to tell two line colours apart at street zoom,
and small enough that both lines still meet at the station dot.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src" / "data" / "network.json"
ROUTES_URL = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv"
IGEO_CANDIDATES = [
    Path("/tmp/hkca/iGeoCOM_POI.csv"),
    ROOT / "data" / "iGeoCOM_POI.csv",
]

# Public line colours. Light colours keep dark text so the name stays readable.
LINES = {
    "AEL": ("機場快綫", "#0E7C78", "#ffffff"),
    "TCL": ("東涌綫", "#E8882F", "#1b1714"),
    "TML": ("屯馬綫", "#8C3A22", "#ffffff"),
    "TKL": ("將軍澳綫", "#6B2D86", "#ffffff"),
    "EAL": ("東鐵綫", "#3AA0D8", "#102028"),
    "SIL": ("南港島綫", "#A8B82A", "#1c2208"),
    "TWL": ("荃灣綫", "#D61F26", "#ffffff"),
    "ISL": ("港島綫", "#0077C2", "#ffffff"),
    "KTL": ("觀塘綫", "#009E49", "#ffffff"),
    "DRL": ("迪士尼綫", "#E56AA8", "#2a1020"),
}

OFFSET_METRES = 48
TO_WGS = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)


def norm_zh(name: str) -> str:
    text = name.strip()
    if text.startswith("香港鐵路"):
        text = text[4:]
    if text.endswith("站"):
        text = text[:-1]
    return text.replace("\u8318", "\u8354")


def load_routes() -> list[dict[str, str]]:
    request = urllib.request.Request(ROUTES_URL, headers={"User-Agent": "hk-city-map/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8-sig")
    return [row for row in csv.DictReader(io.StringIO(raw)) if row["Line Code"].strip()]


def load_igeocom() -> dict[str, tuple[float, float, str]]:
    path = next((item for item in IGEO_CANDIDATES if item.exists()), None)
    if path is None:
        sys.exit("找不到 iGeoCom CSV。請先下載 iGeoCOM_POI.csv。")
    found: dict[str, tuple[float, float, str]] = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["CLASS"] != "TRS" or row["TYPE"] != "RSN":
                continue
            easting = float(row["EASTING"])
            northing = float(row["NORTHING"])
            lng, lat = TO_WGS.transform(easting, northing)
            found[norm_zh(row["CHINESENAME"])] = (lng, lat, row["CHINESENAME"])
    return found


def sequences(rows: list[dict[str, str]]) -> dict[str, dict[str, list[str]]]:
    grouped: dict[str, dict[str, list[tuple[float, str]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[row["Line Code"]][row["Direction"]].append((float(row["Sequence"]), row["Station Code"].strip()))
    ordered: dict[str, dict[str, list[str]]] = {}
    for line, directions in grouped.items():
        ordered[line] = {}
        for direction, items in directions.items():
            items.sort(key=lambda item: item[0])
            ordered[line][direction] = [code for _, code in items]
    return ordered


def choose_spine(directions: dict[str, list[str]]) -> tuple[str, list[str]]:
    preference = {"DT": 0, "UT": 1}

    def rank(item: tuple[str, list[str]]) -> tuple[int, int, str]:
        name, codes = item
        return (-len(codes), preference.get(name, 9), name)

    name, codes = sorted(directions.items(), key=rank)[0]
    return name, codes


def spurs_for(directions: dict[str, list[str]], spine: list[str]) -> list[list[str]]:
    spine_set = set(spine)
    spurs: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for codes in directions.values():
        index = 0
        while index < len(codes):
            if codes[index] in spine_set:
                index += 1
                continue
            end = index
            while end < len(codes) and codes[end] not in spine_set:
                end += 1
            run = codes[index:end]
            before = codes[index - 1] if index > 0 and codes[index - 1] in spine_set else None
            after = codes[end] if end < len(codes) and codes[end] in spine_set else None
            path: list[str] = []
            if before:
                path.append(before)
            path.extend(run)
            if after:
                path.append(after)
            key = tuple(path)
            reverse = tuple(reversed(path))
            if len(path) >= 2 and key not in seen and reverse not in seen:
                seen.add(key)
                spurs.append(path)
            index = end
    return spurs


def project_onto(origin: tuple[float, float], end: tuple[float, float], point: tuple[float, float]) -> tuple[float, float]:
    cos = math.cos(math.radians((origin[1] + end[1]) / 2))
    ax, ay = origin[0] * cos, origin[1]
    bx, by = end[0] * cos, end[1]
    px, py = point[0] * cos, point[1]
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy or 1
    ratio = max(0.15, min(0.85, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return ((ax + dx * ratio) / cos, ay + dy * ratio)


def edge_offsets(paths_by_line: dict[str, list[list[str]]]) -> dict[tuple[str, str], dict[str, float]]:
    users: dict[tuple[str, str], list[str]] = defaultdict(list)
    for line, paths in paths_by_line.items():
        for path in paths:
            for start, end in zip(path, path[1:]):
                key = tuple(sorted((start, end)))
                if line not in users[key]:
                    users[key].append(line)
    shifts: dict[tuple[str, str], dict[str, float]] = {}
    for key, lines in users.items():
        ordered = sorted(lines)
        count = len(ordered)
        shifts[key] = {
            line: (index - (count - 1) / 2) * OFFSET_METRES
            for index, line in enumerate(ordered)
        }
    return shifts


def offset_midpoint(start: tuple[float, float], end: tuple[float, float], metres: float) -> tuple[float, float]:
    lng1, lat1 = start
    lng2, lat2 = end
    mid_lng = (lng1 + lng2) / 2
    mid_lat = (lat1 + lat2) / 2
    cos = math.cos(math.radians(mid_lat))
    dx = (lng2 - lng1) * 111_320 * cos
    dy = (lat2 - lat1) * 111_320
    length = math.hypot(dx, dy) or 1
    px, py = -dy / length, dx / length
    return (mid_lng + (px * metres) / (111_320 * cos), mid_lat + (py * metres) / 111_320)


def draw_path(
    path: list[str],
    line: str,
    points: dict[str, tuple[float, float]],
    shifts: dict[tuple[str, str], dict[str, float]],
) -> list[list[float]]:
    coordinates: list[list[float]] = []
    for start, end in zip(path, path[1:]):
        shift = shifts[tuple(sorted((start, end)))].get(line, 0)
        begin = points[start]
        finish = points[end]
        part = [begin, finish] if shift == 0 else [begin, offset_midpoint(begin, finish, shift), finish]
        if coordinates:
            part = part[1:]
        coordinates.extend([[round(lng, 6), round(lat, 6)] for lng, lat in part])
    return coordinates


def main() -> None:
    rows = load_routes()
    names: dict[str, tuple[str, str]] = {}
    for row in rows:
        names[row["Station Code"].strip()] = (row["Chinese Name"].strip(), row["English Name"].strip())
    names["RAC"] = ("馬場", "Racecourse")

    located = load_igeocom()
    points: dict[str, tuple[float, float]] = {}
    missing = []
    for code, (zh, _en) in names.items():
        hit = located.get(norm_zh(zh))
        if hit is None:
            missing.append(f"{code} {zh}")
            continue
        points[code] = (hit[0], hit[1])
    if missing:
        sys.exit("這些站對不上座標：\n" + "\n".join(missing))

    by_line = sequences(rows)
    paths_by_line: dict[str, list[list[str]]] = {}
    for line in LINES:
        _direction, spine = choose_spine(by_line[line])
        paths_by_line[line] = [spine, *spurs_for(by_line[line], spine)]

    # Racecourse sits on a short branch beside the University–Fo Tan span.
    uni, fot = points["UNI"], points["FOT"]
    rac = points["RAC"]
    junction = project_onto(uni, fot, rac)
    rac_branch = [list(junction), [rac[0], rac[1]]]

    shifts = edge_offsets(paths_by_line)
    line_features = []
    station_lines: dict[str, list[str]] = defaultdict(list)
    for line, (label, color, text) in LINES.items():
        geometry = [draw_path(path, line, points, shifts) for path in paths_by_line[line]]
        for path in paths_by_line[line]:
            for code in path:
                if line not in station_lines[code]:
                    station_lines[code].append(line)
        if line == "EAL":
            geometry.append([[round(lng, 6), round(lat, 6)] for lng, lat in rac_branch])
            station_lines["RAC"].append("EAL")
        line_features.append({
            "code": line,
            "name": label,
            "color": color,
            "text": text,
            "coordinates": geometry,
        })

    stations = []
    for code, (zh, en) in sorted(names.items(), key=lambda item: item[1][0]):
        lng, lat = points[code]
        stations.append({
            "code": code,
            "name": zh,
            "en": en,
            "lng": round(lng, 6),
            "lat": round(lat, 6),
            "lines": station_lines[code],
        })

    if any(not station["lines"] for station in stations):
        empty = [station["code"] for station in stations if not station["lines"]]
        sys.exit(f"這些站沒有被放進任何路線：{empty}")

    payload = {
        "sources": {
            "routes": "港鐵路線及車站表，馬場站按實時班次 API 補上",
            "coordinates": "地政總署社區地理數據庫 iGeoCom 鐵路站",
        },
        "lines": line_features,
        "stations": stations,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} stations={len(stations)} lines={len(line_features)}")
    for feature in line_features:
        parts = len(feature["coordinates"])
        print(f"  {feature['code']} {feature['name']} parts={parts}")


if __name__ == "__main__":
    main()
