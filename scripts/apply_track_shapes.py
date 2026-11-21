#!/usr/bin/env python3
"""Replace straight station-to-station segments with OpenStreetMap track curves.

The passenger route relations tagged network=港鐵 MTR already follow the rails.
Both directions are kept when they use different tracks, then identical copies
are dropped. Station dots stay on the Lands Department positions.
"""

from __future__ import annotations

import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NETWORK = ROOT / "src" / "data" / "network.json"
CACHE = Path("/tmp/osm-mtr-routes.json")
OVERPASS = "https://overpass-api.de/api/interpreter"
REFS = "ISL|TWL|KTL|TKL|EAL|TML|TCL|AEL|SIL|DRL"
JOIN_METRES = 25
# A station entrance can sit a short walk from the rail. Farther than this
# means that line's geometry missed the station.
STATION_METRES = 350

QUERY = f"""
[out:json][timeout:180];
relation["network"="港鐵 MTR"]["route"="subway"]["ref"~"^({REFS})$"];
out geom;
"""


def fetch() -> dict:
    if CACHE.exists() and CACHE.stat().st_size > 1000:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    request = urllib.request.Request(
        OVERPASS,
        data=QUERY.encode(),
        headers={"User-Agent": "hk-city-map/1.0 (transit map; ODbL)"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)
    CACHE.write_text(json.dumps(payload), encoding="utf-8")
    return payload


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    lng1, lat1 = a
    lng2, lat2 = b
    cos = math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lng2 - lng1) * 111_320 * cos, (lat2 - lat1) * 111_320)


def coords_of(geometry: list[dict]) -> list[tuple[float, float]]:
    return [(point["lon"], point["lat"]) for point in geometry]


def stitch(ways: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    pieces: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for way in ways:
        if len(way) < 2:
            continue
        if not current:
            current = way[:]
            continue
        end = current[-1]
        if metres(end, way[0]) <= JOIN_METRES:
            current.extend(way[1:])
        elif metres(end, way[-1]) <= JOIN_METRES:
            current.extend(reversed(way[:-1]))
        else:
            pieces.append(current)
            current = way[:]
    if current:
        pieces.append(current)
    return pieces


def signature(line: list[tuple[float, float]]) -> tuple:
    rounded = [(round(lng, 5), round(lat, 5)) for lng, lat in line]
    forward = tuple(rounded)
    backward = tuple(reversed(rounded))
    return forward if forward <= backward else backward


def length_of(piece: list[tuple[float, float]]) -> float:
    return sum(metres(a, b) for a, b in zip(piece, piece[1:]))


def novel_parts(
    piece: list[tuple[float, float]],
    kept: list[list[tuple[float, float]]],
    gap: float = 60,
    minimum: float = 500,
) -> list[list[tuple[float, float]]]:
    """Return only the stretches that leave the tracks already chosen."""
    if not kept:
        return [piece]
    parts: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    for start, end in zip(piece, piece[1:]):
        middle = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        if nearest(middle, kept) > gap:
            current = [start, end] if not current else [*current, end]
            continue
        if length_of(current) >= minimum:
            parts.append(current)
        current = []
    if length_of(current) >= minimum:
        parts.append(current)
    return parts


def select_for_stations(
    pieces: list[list[tuple[float, float]]],
    station_points: list[tuple[float, float]],
) -> list[list[tuple[float, float]]]:
    """One corridor, plus a branch only when a station would otherwise be left off it."""
    if not pieces:
        return []
    ordered = sorted(pieces, key=length_of, reverse=True)
    kept = [ordered[0]]
    for point in station_points:
        if nearest(point, kept) <= 400:
            continue
        best = min(ordered, key=lambda piece: nearest(point, [piece]))
        extra = [
            part
            for part in novel_parts(best, kept, gap=50, minimum=200)
            if nearest(point, [part]) <= 400
        ]
        if extra:
            kept.append(min(extra, key=lambda part: nearest(point, [part])))
        elif nearest(point, [best]) < nearest(point, kept):
            kept.append(best)
    return kept


def distance_to_segment(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    # Local metres, good enough for a few kilometres of track.
    cos = math.cos(math.radians(point[1]))
    px, py = (point[0] - start[0]) * 111_320 * cos, (point[1] - start[1]) * 111_320
    dx, dy = (end[0] - start[0]) * 111_320 * cos, (end[1] - start[1]) * 111_320
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(px, py)
    ratio = max(0.0, min(1.0, (px * dx + py * dy) / length_sq))
    return math.hypot(px - dx * ratio, py - dy * ratio)


def simplify(points: list[tuple[float, float]], epsilon: float = 10) -> list[tuple[float, float]]:
    """Douglas–Peucker. Ten metres keeps bends and drops points on straight viaducts."""
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    index, farthest = 0, 0.0
    for i in range(1, len(points) - 1):
        distance = distance_to_segment(points[i], start, end)
        if distance > farthest:
            index, farthest = i, distance
    if farthest <= epsilon:
        return [start, end]
    left = simplify(points[: index + 1], epsilon)
    right = simplify(points[index:], epsilon)
    return left[:-1] + right


def nearest(point: tuple[float, float], pieces: list[list[tuple[float, float]]]) -> float:
    best = float("inf")
    for piece in pieces:
        for vertex in piece:
            best = min(best, metres(point, vertex))
    return best


def main() -> None:
    payload = fetch()
    by_ref: dict[str, list[list[tuple[float, float]]]] = {}
    for element in payload["elements"]:
        if element.get("type") != "relation":
            continue
        ref = element.get("tags", {}).get("ref")
        if not ref:
            continue
        ways = []
        for member in element.get("members", []):
            if member.get("type") != "way" or member.get("role") not in ("", "forward", "backward"):
                continue
            geometry = member.get("geometry") or []
            if len(geometry) >= 2:
                ways.append(coords_of(geometry))
        by_ref.setdefault(ref, []).extend(stitch(ways))

    network = json.loads(NETWORK.read_text(encoding="utf-8"))
    stations = {station["code"]: (station["lng"], station["lat"]) for station in network["stations"]}
    problems = []
    for line in network["lines"]:
        raw = by_ref.get(line["code"], [])
        unique: list[list[tuple[float, float]]] = []
        seen: set[tuple] = set()
        for piece in raw:
            if len(piece) < 2 or metres(piece[0], piece[-1]) < 30 and len(piece) < 4:
                continue
            key = signature(piece)
            if key in seen:
                continue
            seen.add(key)
            unique.append(piece)
        chosen = select_for_stations(unique, [stations[code] for code in line_station_codes(network, line["code"])])
        if not chosen:
            problems.append(f"{line['code']} 沒有軌道幾何")
            continue
        for code in line_station_codes(network, line["code"]):
            distance = nearest(stations[code], chosen)
            if distance > STATION_METRES:
                problems.append(f"{line['code']} {code} 離軌道 {distance:.0f} 米")
        simplified = [simplify(piece) for piece in chosen]
        line["coordinates"] = [
            [[round(lng, 6), round(lat, 6)] for lng, lat in piece]
            for piece in simplified
        ]
        points = sum(len(piece) for piece in simplified)
        print(f"{line['code']} pieces={len(simplified)} points={points}")

    if problems:
        raise SystemExit("軌道沒有蓋住這些站：\n" + "\n".join(problems))

    network.setdefault("sources", {})
    network["sources"]["shapes"] = "OpenStreetMap 港鐵軌道（ODbL）"
    NETWORK.write_text(json.dumps(network, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {NETWORK}")


def line_station_codes(network: dict, code: str) -> list[str]:
    return [station["code"] for station in network["stations"] if code in station["lines"]]


if __name__ == "__main__":
    main()
