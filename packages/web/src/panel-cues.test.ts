// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { ChromeNotice } from "./chrome-notice";
import { clearInputDoor, dispatchUiInput, onKeydown } from "./input-door";
import {
  CUE_SHOWS_PER_SCREEN,
  DEFAULT_PANEL_CUE_STATE,
  PANEL_CUES_STORAGE_KEY,
  mountPanelCues,
  readPanelCueState,
} from "./panel-cues";

afterEach(() => {
  clearInputDoor();
  document.body.replaceChildren();
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

function harness(storage = memoryStorage()) {
  const notices: string[] = [];
  const notice: ChromeNotice = { show: (text) => notices.push(text), dismiss: () => {} };
  const open = new Set<string>();
  const cues = mountPanelCues({
    host: document.body,
    notice,
    storage,
    label: (id) => ({ inventory: "Inventory", monsters: "Monsters" })[id] ?? id,
    isOpen: (id) => open.has(id),
    open: (id) => { open.add(id); cues.notePanelOpened(); },
  });
  const button = () => document.querySelector<HTMLButtonElement>(".panel-pin")!;
  return { cues, notices, open, button, storage };
}

const plus = { key: { key: "+", modifiers: { ctrl: false, shift: true, alt: false, meta: false }, repeat: false } };

describe("panel cues (#317)", () => {
  it("names the pin key the first few times a screen opens, then goes quiet", () => {
    const { cues, notices } = harness();
    for (let i = 0; i < CUE_SHOWS_PER_SCREEN + 2; i++) cues.enterScreen("inventory")();
    expect(notices).toHaveLength(CUE_SHOWS_PER_SCREEN);
    expect(notices[0]).toBe("Inventory can stay open beside the map. Press +, or the + button at the top right, to keep it there.");
  });

  it("counts each screen on its own", () => {
    const { cues, notices } = harness();
    for (let i = 0; i < CUE_SHOWS_PER_SCREEN; i++) cues.enterScreen("inventory")();
    cues.enterScreen("monsters")();
    expect(notices.at(-1)).toContain("Monsters");
  });

  it("opens the panel from the + key while the screen is open, and says how to remove it", () => {
    const { cues, notices, open, button } = harness();
    const leave = cues.enterScreen("inventory");
    onKeydown(() => {}, true);
    expect(button().hidden).toBe(false);
    dispatchUiInput(plus);
    expect([...open]).toEqual(["inventory"]);
    expect(button().hidden).toBe(true);
    expect(notices.at(-1)).toBe("Inventory now stays open beside the map. Remove it in Options (=), Subwindow setup (w).");
    leave();
  });

  it("opens the panel from the pin button", () => {
    const { cues, open, button } = harness();
    const leave = cues.enterScreen("monsters");
    button().click();
    expect([...open]).toEqual(["monsters"]);
    leave();
    expect(button().hidden).toBe(true);
  });

  it("stops the notices once any panel is open, and keeps the state across launches", () => {
    const storage = memoryStorage();
    const first = harness(storage);
    const leave = first.cues.enterScreen("inventory");
    first.button().click();
    leave();
    document.body.replaceChildren();
    const second = harness(storage);
    second.cues.enterScreen("monsters")();
    second.cues.welcome();
    expect(second.notices).toEqual([]);
    expect(readPanelCueState(storage).panelOpened).toBe(true);
  });

  it("points to Subwindow setup once on the first dungeon level", () => {
    const { cues, notices } = harness();
    cues.welcome();
    cues.welcome();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Subwindow setup (w)");
  });

  it("hides the notices and the button when the switch is off, and + still works", () => {
    const { cues, notices, open, button } = harness();
    cues.setEnabled(false);
    const leave = cues.enterScreen("inventory");
    onKeydown(() => {}, true);
    expect(button().hidden).toBe(true);
    cues.welcome();
    expect(notices).toEqual([]);
    dispatchUiInput(plus);
    expect([...open]).toEqual(["inventory"]);
    leave();
  });

  it("gives + back to the game once the screen closes", () => {
    const { cues, open } = harness();
    const seen: string[] = [];
    cues.enterScreen("inventory")();
    onKeydown((event) => seen.push(event.key));
    dispatchUiInput(plus);
    expect(open.size).toBe(0);
    expect(seen).toEqual(["+"]);
  });

  it("reads missing, malformed and future documents as the defaults", () => {
    for (const raw of [null, "not json", "[]", JSON.stringify({ v: 2, enabled: false })]) {
      const storage = memoryStorage();
      if (raw !== null) storage.setItem(PANEL_CUES_STORAGE_KEY, raw);
      expect(readPanelCueState(storage)).toEqual(DEFAULT_PANEL_CUE_STATE);
    }
  });
});
