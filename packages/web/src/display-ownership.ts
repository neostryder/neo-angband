/** Per-mod requests for the shared display setters. */
import type { ModDisplay } from "./mod-plugin";
import type { ChromeTheme } from "./chrome-theme";
import type { TerminalGround } from "./terminal-ground";

function copy<T>(value: T): T {
  return value !== null && typeof value === "object" ? structuredClone(value) : value;
}

function slot<T>(apply: (value: T) => void, fallback: T, read?: () => T) {
  const values = new Map<string, T>();
  return {
    set(id: string, value: T | null, clear: boolean): void {
      const previous = new Map(values);
      try {
        values.delete(id);
        if (!clear) values.set(id, copy(value as T));
        apply(copy(values.size ? [...values.values()].at(-1)! : fallback));
      } catch (err) {
        values.clear();
        for (const [owner, request] of previous) values.set(owner, request);
        throw err;
      }
    },
    get(): T { return copy(read ? read() : (values.size ? [...values.values()].at(-1)! : fallback)); },
    clear(id: string): void {
      if (!values.has(id)) return;
      values.delete(id);
      apply(copy(values.size ? [...values.values()].at(-1)! : fallback));
    },
  };
}

export function createDisplayOwnership(display: ModDisplay) {
  const grid = slot((value: Parameters<ModDisplay["setGrid"]>[0]) => display.setGrid(value), null, display.getGrid?.bind(display));
  const camera = slot((value: Parameters<ModDisplay["setCamera"]>[0]) => display.setCamera(value), null, display.getCamera?.bind(display));
  const mapView = slot((value: Parameters<ModDisplay["setMapView"]>[0]) => display.setMapView(value), null, display.getMapView?.bind(display));
  const sidebar = slot((value: Parameters<ModDisplay["setSidebarExtent"]>[0]) => display.setSidebarExtent(value), null, display.getSidebarExtent?.bind(display));
  const margin = slot((value: Parameters<NonNullable<ModDisplay["setMapMargin"]>>[0]) => display.setMapMargin?.(value), null, display.getMapMargin?.bind(display));
  const scaling = slot((value: "auto" | "crisp") => display.setTileScaling(value), "auto" as const, display.getTileScaling?.bind(display));
  const overview = slot((value: boolean) => display.setFullMapOverview(value), false, display.getFullMapOverview?.bind(display));
  type Filter = { readonly filter: string; readonly scope: "canvas" | "game" } | null;
  const filter = slot((value: Filter) => display.setVisualFilter(value?.filter ?? null, value ? { scope: value.scope } : undefined), null, display.getVisualFilter?.bind(display));
  const chrome = slot((value: ChromeTheme | null) => display.setChromeTheme?.(value), null, display.getChromeTheme?.bind(display));
  const ground = slot((value: TerminalGround | null) => display.setTerminalGround?.(value), null, display.getTerminalGround?.bind(display));
  return {
    forMod(id: string): ModDisplay {
      return {
        snapshot: () => display.snapshot(),
        onKey: (listener) => display.onKey(listener),
        setGrid: (value) => grid.set(id, value, value === null),
        getGrid: () => grid.get(),
        setCamera: (value) => camera.set(id, value, value === null),
        getCamera: () => camera.get(),
        setMapView: (value) => mapView.set(id, value, value === null),
        getMapView: () => mapView.get(),
        setSidebarExtent: (value) => sidebar.set(id, value, value === null),
        getSidebarExtent: () => sidebar.get(),
        ...(display.setMapMargin ? {
          setMapMargin: (value: Parameters<NonNullable<ModDisplay["setMapMargin"]>>[0]) => margin.set(id, value, value === null),
          getMapMargin: () => margin.get(),
        } : {}),
        setTileScaling: (value) => scaling.set(id, value, value === null),
        getTileScaling: () => scaling.get(),
        setFullMapOverview: (value) => overview.set(id, value, value === null),
        getFullMapOverview: () => overview.get(),
        setStoreItemNameEllipsis: (value) => display.setStoreItemNameEllipsis(value),
        setStoreSelectionDescription: (value) => display.setStoreSelectionDescription(value),
        setQuiverItemization: (value) => display.setQuiverItemization(value),
        setMonsterListColorKey: (value) => display.setMonsterListColorKey(value),
        setVisualFilter: (value, options) => filter.set(id, value === null ? null : { filter: value, scope: options?.scope ?? "canvas" }, value === null),
        getVisualFilter: () => filter.get(),
        ...(display.setChromeTheme ? {
          setChromeTheme: (value: ChromeTheme | null) => chrome.set(id, value, value === null),
          getChromeTheme: () => chrome.get(),
        } : {}),
        ...(display.setTerminalGround ? {
          setTerminalGround: (value: TerminalGround | null) => ground.set(id, value, value === null),
          getTerminalGround: () => ground.get(),
        } : {}),
        repaint: () => display.repaint(),
      };
    },
    clear(id: string): void {
      for (const entry of [grid, camera, mapView, sidebar, margin, scaling, overview, filter, chrome, ground]) entry.clear(id);
    },
  };
}
