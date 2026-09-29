/**
 * Cues that show a player how to keep a screen open as a panel (#317).
 *
 * A new install opens with the dungeon view alone, as upstream does. While a
 * screen that has a panel twin is open (the inventory, the monster list, the
 * message history and so on), `+` or a small `+` button keeps that screen open
 * beside the map. The first few times each such screen opens, a fading notice
 * says so, and on the first dungeon level one line points to Subwindow setup.
 * The notices stop once the player has opened any panel, and one switch on the
 * Subwindow setup screen turns the notices and the button off.
 *
 * `+` is a plain key on purpose. Every browser, desktop and screen-reader
 * shortcut needs a modifier, so a plain key cannot collide with any of them,
 * while Alt+letter chords open browser menus on Windows and type accented
 * letters on macOS. No screen with a panel twin reads `+`, and it is not a
 * dead key on the common international layouts.
 */

import { t } from "@rpgm-tools/neo-angband-core";
import type { ChromeNotice } from "./chrome-notice";
import { armViewPin, VIEW_PIN_KEY } from "./input-door";

export const PANEL_CUES_STORAGE_KEY = "neo-angband:panel-cues";

/** How many times each screen names its pin key before going quiet. */
export const CUE_SHOWS_PER_SCREEN = 3;

export interface PanelCueState {
  /** The Subwindow setup switch: notices and the pin button. */
  readonly enabled: boolean;
  /** The player has opened a panel, so the notices have done their job. */
  readonly panelOpened: boolean;
  /** The first-level pointer to Subwindow setup has been shown. */
  readonly welcomed: boolean;
  /** Notices shown so far, per panel id. */
  readonly shown: Readonly<Record<string, number>>;
}

export const DEFAULT_PANEL_CUE_STATE: PanelCueState = Object.freeze({
  enabled: true,
  panelOpened: false,
  welcomed: false,
  shown: Object.freeze({}),
});

type CueStorage = Pick<Storage, "getItem" | "setItem">;

/** Anything absent, unreadable or malformed reads as the default. */
export function readPanelCueState(storage: CueStorage): PanelCueState {
  try {
    const raw = storage.getItem(PANEL_CUES_STORAGE_KEY);
    if (raw === null) return DEFAULT_PANEL_CUE_STATE;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data === null || typeof data !== "object" || data["v"] !== 1) return DEFAULT_PANEL_CUE_STATE;
    const shown: Record<string, number> = {};
    const stored = data["shown"];
    if (stored !== null && typeof stored === "object") {
      for (const [id, count] of Object.entries(stored as Record<string, unknown>)) {
        if (typeof count === "number" && Number.isInteger(count) && count >= 0) shown[id] = Math.min(count, CUE_SHOWS_PER_SCREEN);
      }
    }
    return Object.freeze({
      enabled: data["enabled"] !== false,
      panelOpened: data["panelOpened"] === true,
      welcomed: data["welcomed"] === true,
      shown: Object.freeze(shown),
    });
  } catch {
    return DEFAULT_PANEL_CUE_STATE;
  }
}

export function writePanelCueState(storage: CueStorage, state: PanelCueState): boolean {
  try {
    storage.setItem(PANEL_CUES_STORAGE_KEY, JSON.stringify({ v: 1, ...state }));
    return true;
  } catch {
    return false;
  }
}

export interface PanelCueHost {
  /** The element the pin button sits in (the dungeon view). */
  readonly host: HTMLElement;
  readonly notice: ChromeNotice;
  readonly storage: CueStorage;
  /** The short name a panel goes by ("Inventory"). */
  readonly label: (id: string) => string;
  readonly isOpen: (id: string) => boolean;
  readonly open: (id: string) => void;
}

export interface PanelCues {
  /**
   * Mark a screen with a panel twin as open. The returned function marks it
   * closed; call it from a `finally` so a thrown screen cannot leave the pin
   * armed.
   */
  enterScreen(id: string): () => void;
  /** Keep the current screen open as a panel, as `+` and the button do. */
  pin(): void;
  /** Any panel was opened, from anywhere. The notices stop. */
  notePanelOpened(): void;
  /** The first dungeon level: point to Subwindow setup, once. */
  welcome(): void;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  state(): PanelCueState;
}

export function mountPanelCues(opts: PanelCueHost): PanelCues {
  let state = readPanelCueState(opts.storage);
  let current: string | undefined;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "panel-pin";
  button.hidden = true;
  const buttonLabel = t("panelCues.button", "Keep open beside the map ({key})", { key: VIEW_PIN_KEY });
  button.title = buttonLabel;
  button.setAttribute("aria-label", buttonLabel);
  button.textContent = VIEW_PIN_KEY;
  /* A pointer press must not take focus from the game or start a drag. */
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    pin();
  });
  opts.host.appendChild(button);

  function save(next: PanelCueState): void {
    state = Object.freeze(next);
    writePanelCueState(opts.storage, state);
  }

  function refreshButton(): void {
    button.hidden = !(state.enabled && current !== undefined && !opts.isOpen(current));
  }

  function pin(): void {
    if (current !== undefined) pinScreen(current);
  }

  function pinScreen(id: string): void {
    if (opts.isOpen(id)) return;
    opts.open(id);
    save({ ...state, panelOpened: true });
    refreshButton();
    opts.notice.show(t(
      "panelCues.pinned",
      "{panel} now stays open beside the map. Remove it in Options (=), Subwindow setup (w).",
      { panel: opts.label(id) },
    ));
  }

  return {
    enterScreen(id) {
      const outer = current;
      current = id;
      const disarm = armViewPin(() => pinScreen(id));
      refreshButton();
      const count = state.shown[id] ?? 0;
      if (state.enabled && !state.panelOpened && !opts.isOpen(id) && count < CUE_SHOWS_PER_SCREEN) {
        save({ ...state, shown: { ...state.shown, [id]: count + 1 } });
        opts.notice.show(t(
          "panelCues.tip",
          "{panel} can stay open beside the map. Press {key}, or the {key} button at the top right, to keep it there.",
          { panel: opts.label(id), key: VIEW_PIN_KEY },
        ));
      }
      let left = false;
      return () => {
        if (left) return;
        left = true;
        current = outer;
        disarm();
        refreshButton();
      };
    },
    pin,
    notePanelOpened() {
      if (!state.panelOpened) save({ ...state, panelOpened: true });
    },
    welcome() {
      if (!state.enabled || state.panelOpened || state.welcomed) return;
      save({ ...state, welcomed: true });
      opts.notice.show(t(
        "panelCues.welcome",
        "You can keep your inventory, equipment, monster list or messages open beside the map. Open one of them and press {key}, or add panels in Options (=), Subwindow setup (w).",
        { key: VIEW_PIN_KEY },
      ));
    },
    enabled: () => state.enabled,
    setEnabled(enabled) {
      save({ ...state, enabled });
      refreshButton();
    },
    state: () => state,
  };
}
