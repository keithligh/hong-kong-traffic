/** Fold variant characters so a typed station name still matches the map. */
export function foldStationText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("\u8318", "\u8354")
    .replaceAll("\u81fa", "\u53f0")
    .replaceAll("\u5cfd", "\u7864");
}

export function stationMatches(
  station: { name: string; en: string; code: string },
  query: string,
): boolean {
  const text = foldStationText(query);
  if (!text) return false;
  return foldStationText(station.name).includes(text)
    || station.en.toLowerCase().includes(text)
    || station.code.toLowerCase() === text;
}
