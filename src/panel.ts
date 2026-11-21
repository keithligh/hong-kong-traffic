import type { Camera } from "./cameras";
import { freshImageUrl } from "./cameras";
import { copy } from "./copy";
import type { ScheduleReading, Train } from "./schedule";
import type { LineRecord, StationRecord } from "./types";

export type LineSchedule = ScheduleReading & { code: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function groupTrains(trains: Train[]): Map<string, Train[]> {
  const groups = new Map<string, Train[]>();
  for (const train of trains) {
    const name = copy.towards(train.destName);
    const list = groups.get(name) ?? [];
    list.push(train);
    groups.set(name, list);
  }
  return groups;
}

export function renderIdle(body: HTMLElement): void {
  body.replaceChildren();
  body.removeAttribute("aria-busy");
  const block = el("div", "detail");
  block.append(
    el("h2", undefined, copy.idleTitle),
    el("p", "lead", copy.idleLead),
    el("p", undefined, copy.idleDense),
    el("h3", undefined, copy.sourcesTitle),
    el("p", "source", copy.aboutSources),
  );
  body.append(block);
}

export function renderStationLoading(body: HTMLElement, station: StationRecord, lines: Map<string, LineRecord>): void {
  body.replaceChildren();
  const block = el("div", "detail");
  block.append(el("h2", undefined, station.name), el("p", "en", station.en));
  const chips = el("ul", "chips");
  for (const code of station.lines) {
    const line = lines.get(code);
    if (!line) continue;
    const chip = el("li", "chip", line.name);
    chip.style.background = line.color;
    chip.style.color = line.text;
    chips.append(chip);
  }
  block.append(chips, el("p", "status", copy.loadingTrains));
  body.append(block);
  body.setAttribute("aria-busy", "true");
}

export function renderStation(
  body: HTMLElement,
  station: StationRecord,
  results: LineSchedule[],
  lines: Map<string, LineRecord>,
  onBack: () => void,
  view: { focus?: boolean; updatedAt?: string } = {},
): void {
  body.replaceChildren();
  body.removeAttribute("aria-busy");
  const block = el("div", "detail");
  const headingRow = el("div", "heading-row");
  headingRow.append(el("h2", undefined, station.name));
  const back = el("button", "text-button", copy.back);
  back.type = "button";
  back.addEventListener("click", onBack);
  headingRow.append(back);
  block.append(headingRow, el("p", "en", station.en));

  if (results.some((result) => result.delay)) {
    block.append(el("p", "notice", copy.delay));
  }

  for (const result of results) {
    const line = lines.get(result.code);
    const section = el("section", "line-block");
    const title = el("h3", "line-title");
    const swatch = el("span", "swatch");
    if (line) {
      swatch.style.background = line.color;
      title.append(swatch, document.createTextNode(line.name));
    }
    section.append(title);
    if (result.unreachable) {
      section.append(el("p", "status", copy.trainOffline));
    } else if (result.notice) {
      section.append(el("p", "status", result.notice));
      if (result.url) {
        const link = el("a", "text-button", copy.serviceLink);
        link.href = result.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        section.append(link);
      }
    } else if (result.empty) {
      section.append(el("p", "status", copy.noTrains));
    } else {
      for (const [dest, trains] of groupTrains(result.trains)) {
        section.append(el("h4", undefined, dest));
        const list = el("ul", "trains");
        for (const train of trains) {
          const item = el("li");
          const minuteLabel = train.minutes === null ? "" : train.minutes === 0 ? copy.arriving : copy.minutes(train.minutes);
          item.append(el("span", "minute", minuteLabel));
          const meta = el("span", "meta");
          if (train.platform) meta.append(el("span", undefined, copy.platform(train.platform)));
          if (train.clock) meta.append(el("span", undefined, train.clock));
          if (train.uncertain) meta.append(el("span", undefined, copy.uncertain));
          item.append(meta);
          list.append(item);
        }
        section.append(list);
      }
    }
    block.append(section);
  }
  if (view.updatedAt) block.append(el("p", "source", copy.updatedAt(view.updatedAt)));
  block.append(el("p", "source", copy.trainSource));
  body.append(block);
  if (view.focus !== false) back.focus();
}

export function renderCamera(body: HTMLElement, camera: Camera, onBack: () => void): void {
  body.replaceChildren();
  body.removeAttribute("aria-busy");
  const block = el("div", "detail");
  const headingRow = el("div", "heading-row");
  headingRow.append(el("h2", undefined, camera.description));
  const back = el("button", "text-button", copy.back);
  back.type = "button";
  back.addEventListener("click", onBack);
  headingRow.append(back);
  const place = [camera.region, camera.district].filter(Boolean).join(" · ");
  block.append(headingRow);
  if (place) block.append(el("p", "en", place));

  const loading = el("p", "status", copy.photoLoading);
  const image = el("img", "shot");
  image.alt = camera.description;
  image.width = 320;
  image.height = 240;
  image.addEventListener("load", () => loading.remove());
  image.addEventListener("error", () => {
    loading.replaceWith(el("p", "status", copy.photoFailed));
    image.remove();
  });
  image.src = freshImageUrl(camera.url);
  block.append(loading, image, el("p", undefined, copy.photoUpdating), el("p", "source", copy.photoOfficialFallback), el("p", "source", copy.photoSource));
  body.append(block);
  back.focus();
}

export type LayerState = {
  lines: boolean;
  stations: boolean;
  cctv: boolean;
  aid: boolean;
  trains: boolean;
};

const layerLabels: Record<keyof LayerState, string> = {
  lines: copy.lineLayer,
  stations: copy.stationLayer,
  cctv: copy.cctvLayer,
  aid: copy.aidLayer,
  trains: copy.trainLayer,
};

export function renderLayers(
  host: HTMLElement,
  state: LayerState,
  onToggle: (key: keyof LayerState, pressed: boolean) => void,
): void {
  host.replaceChildren(el("p", "layer-label", copy.layers));
  const row = el("div", "layer-row");
  for (const key of Object.keys(layerLabels) as (keyof LayerState)[]) {
    const button = el("button", "layer", layerLabels[key]);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state[key]));
    button.addEventListener("click", () => {
      const next = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(next));
      onToggle(key, next);
    });
    row.append(button);
  }
  host.append(row);
}
