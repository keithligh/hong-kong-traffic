export type LineRecord = {
  code: string;
  name: string;
  color: string;
  text: string;
  coordinates: number[][][];
};

export type StationRecord = {
  code: string;
  name: string;
  en: string;
  lng: number;
  lat: number;
  lines: string[];
};

export type Network = {
  sources: { routes: string; coordinates: string; shapes: string };
  lines: LineRecord[];
  stations: StationRecord[];
};
