import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionState } from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import type { GameState } from "@rpgm-tools/neo-angband-core";
import { createModOptions } from "./mod-options";
import { createModKeybindings } from "./mod-keybindings";
import { clearKeymaps, keymapAdd, keymapFind, keymapOwner, keymapSetOwner } from "./keymap-store";
import { createModKnowledge } from "./knowledge-read";
import { modPluginContext, setModKnowledgeSource, setModRunReports } from "./mod-context";
import { createRunReports } from "./run-report";

function stateWith(options = new OptionState()): GameState {
  return { options, modHooks: {} } as unknown as GameState;
}

describe("ctx.options", () => {
  it("lists every page's options and marks only interface options writable", () => {
    const view = createModOptions(stateWith(), { writable: true }).get();
    const byName = new Map(view.entries.map((e) => [e.name, e]));
    expect(byName.get("rogue_like_commands")).toMatchObject({ page: "interface", writable: true });
    expect([...byName.values()].some((e) => e.page === "birth" && !e.writable)).toBe(true);
    expect([...byName.values()].some((e) => e.page === "cheat" && !e.writable)).toBe(true);
    expect(view.hitpointWarn).toBe(3);
    expect(Object.isFrozen(view.entries)).toBe(true);
    expect(createModOptions(stateWith(), { writable: false }).set).toBeUndefined();
  });

  it("applies a whole change, notifies mods and saves, or applies none of it", () => {
    const options = new OptionState();
    const state = stateWith(options);
    const optionsChanged = vi.fn();
    (state as { modHooks: unknown }).modHooks = { optionsChanged };
    const afterChange = vi.fn();
    const door = createModOptions(state, { writable: true, afterChange });

    const refused = door.set!({ values: { use_sound: true, cheat_live: true } });
    expect(refused).toMatchObject({ ok: false });
    expect(options.get("use_sound")).toBe(false);
    expect(door.set!({ hitpointWarn: 12 })).toMatchObject({ ok: false });
    expect(door.set!({ values: { no_such_option: true } })).toMatchObject({ ok: false });
    expect(afterChange).not.toHaveBeenCalled();

    const done = door.set!({ values: { use_sound: true }, hitpointWarn: 5 });
    expect(done).toEqual({ ok: true, changed: ["use_sound", "hitpointWarn"] });
    expect(options.get("use_sound")).toBe(true);
    expect(options.hitpointWarn).toBe(5);
    expect(optionsChanged).toHaveBeenCalledTimes(1);
    expect(afterChange).toHaveBeenCalledTimes(1);

    expect(door.set!({ values: { use_sound: true } })).toEqual({ ok: true, changed: [] });
    expect(afterChange).toHaveBeenCalledTimes(1);
  });
});

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function fakeWindow(): FakeWindow {
  const listeners: Array<{ fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(_t, fn, capture = false) { listeners.push({ fn, capture }); },
    removeEventListener(_t, fn, capture = false) {
      const i = listeners.findIndex((l) => l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) { for (const l of [...listeners]) l.fn(ev); },
  };
}

function press(win: FakeWindow, key: string): Event {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
  return ev;
}

describe("ctx.keybindings", () => {
  let win: FakeWindow;
  beforeEach(() => {
    const map = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    clearKeymaps();
    win = fakeWindow();
    (globalThis as { window?: unknown }).window = win;
  });
  afterEach(() => {
    clearKeymaps();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("lists, replaces and removes any binding in the current keyset", () => {
    const options = new OptionState();
    const door = createModKeybindings(stateWith(options));
    keymapAdd("orig", "F2", "a");
    keymapSetOwner("orig", "F2", "some-mod");
    expect(door.keyset()).toBe("original");
    expect(door.list()).toEqual([{ trigger: "F2", action: "a", owner: "some-mod" }]);
    expect(door.set("F2", "b")).toBe(true);
    expect(keymapFind("orig", "F2")).toBe("b");
    expect(keymapOwner("orig", "F2")).toBeNull();
    expect(door.set("F3", "")).toBe(false);
    expect(door.remove("F2")).toBe(true);
    expect(door.remove("F2")).toBe(false);
    options.set("rogue_like_commands", true);
    expect(door.keyset()).toBe("roguelike");
  });

  it("captures the next bindable key before the game sees it, and Escape as null", async () => {
    const door = createModKeybindings(stateWith());
    const first = door.capture();
    const shift = press(win, "Shift");
    expect(shift.defaultPrevented).toBe(false);
    const f5 = press(win, "F5");
    expect(f5.defaultPrevented).toBe(true);
    expect(await first).toBe("F5");
    const second = door.capture();
    press(win, "Escape");
    expect(await second).toBeNull();
    const stale = door.capture();
    const fresh = door.capture();
    expect(await stale).toBeNull();
    press(win, "g");
    expect(await fresh).toBe("g");
  });
});

describe("ctx.knowledge", () => {
  afterEach(() => setModKnowledgeSource(undefined));

  it("is present only with state:knowledge.read or state:*.read, and only in a game", () => {
    const door = createModKnowledge({}, () => undefined);
    setModKnowledgeSource(() => door);
    const ctx = (caps: string[], state?: GameState) =>
      modPluginContext("m", {}, state, {}, { capabilities: CapabilitySet.fromManifest({ id: "m", name: "M", version: "1.0.0", shape: "plugin", capabilities: caps } as never) });
    expect(ctx(["state:knowledge.read"], stateWith()).knowledge).toBe(door);
    expect(ctx(["state:*.read"], stateWith()).knowledge).toBe(door);
    expect(ctx(["state:player.read"], stateWith()).knowledge).toBeUndefined();
    expect(ctx(["state:knowledge.read"]).knowledge).toBeUndefined();
  });
});

describe("ctx.character run journal", () => {
  afterEach(() => setModRunReports(undefined));

  it("offers history always and the run report once the host installs it", () => {
    const state = { ...stateWith(), actor: { player: { hist: [], fullName: "" } } } as unknown as GameState;
    const source = { state: () => state, characterKey: () => "k", viewDeps: () => ({}) } as never;
    const caps = CapabilitySet.fromManifest({ id: "m", name: "M", version: "1.0.0", shape: "plugin", capabilities: ["state:player.read"] } as never);
    const ctx = () => modPluginContext("m", {}, state, {}, { capabilities: caps, snapshotSource: source });
    expect(ctx().character?.history()).toEqual([]);
    expect(ctx().character?.runReport).toBeUndefined();

    const reports = createRunReports();
    setModRunReports(reports);
    const heard = vi.fn();
    ctx().character!.onRunEnd!(heard);
    reports.publish({ outcome: "death" } as never);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ctx().character!.runReport!()).toEqual({ outcome: "death" });
  });
});
