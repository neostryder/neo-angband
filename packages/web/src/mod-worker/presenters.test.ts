// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet, type Api2ModDefinition, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { createApi2Host } from "../mod-api2-host";
import { modPluginContext } from "../mod-context";
import { setConsentBindings } from "../mod-consent-binding";
import { setModGrants, resetModTiers } from "../mod-tier";
import { askInstalledPresenter, setMenuPresenter } from "../menu-runtime";
import { showThroughPresenter, ScreenAbandoned, setScreenPresenter } from "../screen-runtime";
import { openTakenScreen, takeScreens, withHostManagementScreen } from "../mod-screens";
import { isCoreDrawn } from "../core-drawn";
import { withTerminal } from "../screen-runtime";
import { promptRequest } from "../prompt-view";
import { createModWorkerPanelRenderer } from "./panels";
import { buildMenuQuestion } from "../menu-view";
import { linesScreen } from "../screen-view";
import { resetModPanels, setModHostDialogOpen, suspendModPanels } from "../panel-runtime";
import { drawModControllerConsent, drawModPermissionConsent } from "../mod-consent-dialog";
import { assignTier } from "../mod-tier";
import { buildCatalog } from "../mod-store";
import { browserKeydown, dispatchUiInput } from "../input-door";
import type { ModDisplay } from "../mod-plugin";
import { installModWorkerBootstrap, type WorkerScope } from "./bootstrap";
import { startModWorker, type ModWorkerLike } from "./host";
import { cloneWorkerJson } from "./clone";
import { gridCommands, presentationDescription } from "./presenter-schema";
import { MOD_WORKER_PROTOCOL_VERSION, PRESENTER_WORKER_CALLS, type HostToModWorker, type ModWorkerToHost } from "./protocol";

type Handler = (value: unknown, id: string) => unknown;
type Replace = (describe: Handler | null, select?: Handler) => Promise<{ ok: boolean }>;
type Proxy = ModApi2 & { display: { replace: Replace }; ui: ModApi2["ui"] & { menu: { replace: Replace }; screen: { replace: Replace }; management: { replace: Replace } } };
const methods = Object.entries(PRESENTER_WORKER_CALLS);
const description = { title: "<script>bad()</script>", lines: ["<img src=x onerror=bad()>", "javascript:bad()"], rows: [{ id: "pick", label: "<b>Pick</b>" }] };
const commands = [{ col: 0, row: 0, glyph: "<", color: "normal" }];
const question = () => buildMenuQuestion({ id: "game:main", title: "Game", footer: "", rows: [{ id: "choice", label: "Choice" }], style: "screen", cursor: 0, browseOnly: false, commandKeys: [], ctrlCommandKeys: [] });
const view = () => ({ ...linesScreen("Inventory", [{ text: "An item" }], "Close"), id: "core:inventory" });
const cleanups: (() => void)[] = [];
const priorShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const priorClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

async function flush() { for (let i = 0; i < 40; i += 1) await Promise.resolve(); }
function button(label: string) {
  const result = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!result) throw new Error(`missing host button ${label}`);
  return result;
}

async function fixture(grants: string[], handler: Handler = () => description, select: Handler = () => ({ kind: "choose", choice: "choice" })) {
  vi.useFakeTimers();
  const authorize = (caps: string[]) => setModGrants(new Map([["probe", { granted: caps, refusedByTier: [], refusedByPlayer: [], undecided: [], blocking: [] }]]));
  authorize(grants);
  setConsentBindings(new Map([["probe", "digest"]]));
  const caps = CapabilitySet.fromManifest({ id: "probe", name: "Probe", version: "1", shape: "plugin", capabilities: grants });
  const listeners = new Set<() => void>();
  const snapshot = { mode: "play", grid: { cols: 80, rows: 24, cellWidth: 10, cellHeight: 20 },
    viewport: { origin: { x: 0, y: 0 }, size: { width: 50, height: 20 }, screenOrigin: { x: 13, y: 1 } }, level: { width: 100, height: 100 }, layout: "left",
    regions: { map: { name: "map", cells: { col: 13, row: 1, cols: 50, rows: 20 }, pixels: { x: 130, y: 20, width: 500, height: 400 } } } };
  const display = { snapshot: () => snapshot, onFrame: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } } as unknown as ModDisplay;
  let proxy: Proxy | undefined;
  const received: ModWorkerToHost[] = [];
  const sent: HostToModWorker[] = [];
  let stuck = false;
  const definition = { api: ">=2.0.0 <3.0.0", start: (api: ModApi2) => { proxy = api as Proxy; } } satisfies Api2ModDefinition;
  const worker: ModWorkerLike = {
    onmessage: null, onerror: null, terminate() {},
    postMessage(message) {
      cloneWorkerJson(message);
      sent.push(structuredClone(message));
      if (!stuck) queueMicrotask(() => scope.onmessage?.({ data: structuredClone(message) } as MessageEvent<HostToModWorker>));
    },
  };
  const scope: WorkerScope = { onmessage: null, postMessage(message) {
    cloneWorkerJson(message);
    received.push(structuredClone(message));
    queueMicrotask(() => worker.onmessage?.({ data: structuredClone(message) } as MessageEvent));
  } };
  const hostContext = { ...modPluginContext("probe", {}), display };
  installModWorkerBootstrap(scope, MOD_WORKER_PROTOCOL_VERSION, async () => ({ default: definition }));
  const session = startModWorker(worker, { id: "probe", entryUrl: "staged:entry", engine: "1", grants, flags: {}, newCharacter: false, net: false,
    api: () => createApi2Host(hostContext, { execution: "worker", grants: caps }),
    timing: { heartbeatMs: 60000 },
  });
  cleanups.push(() => session.teardown());
  await flush();
  await session.ready;
  session.start();
  await flush();
  const api = proxy!;
  const replace = (method: string, describe = handler, onSelect = select) => {
    if (method === "display.replace") return api.display.replace(describe, onSelect);
    if (method === "ui.menu.replace") return api.ui.menu.replace(describe, onSelect);
    if (method === "ui.screen.replace") return api.ui.screen.replace(describe, onSelect);
    return api.ui.management.replace(describe, onSelect);
  };
  let next = 100;
  const raw = async (method: string, args: unknown[] = [1], extra: Record<string, unknown> = {}) => {
    const requestId = ++next;
    worker.onmessage?.({ data: { type: "call", protocolVersion: MOD_WORKER_PROTOCOL_VERSION, pluginId: "probe", epoch: 1, requestId, method, args, ...extra } } as MessageEvent);
    await flush();
    return sent.find((message) => message.type === "reply" && message.requestId === requestId);
  };
  const offer = async (method: string) => {
    if (method === "ui.menu.replace") return askInstalledPresenter(question());
    if (method === "ui.screen.replace") return showThroughPresenter(view())?.then(() => true, () => false);
    if (method === "ui.management.replace") return openTakenScreen("mods");
    await vi.advanceTimersByTimeAsync(100);
    return undefined;
  };
  return { api, session, sent, received, replace, raw, offer, authorize, snapshot, listeners, setStuck: () => { stuck = true; },
    changeSession: () => { Object.defineProperty(hostContext, "state", { value: {}, configurable: true }); } };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  setMenuPresenter(null); setScreenPresenter(null); setModHostDialogOpen(false); resetModPanels(); resetModTiers(); setConsentBindings(new Map());
  document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks();
  if (priorShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", priorShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (priorClose) Object.defineProperty(HTMLDialogElement.prototype, "close", priorClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("serialized Worker presenters", () => {
  it.each(methods)("refuses an ungranted %s without drawing", async (method) => {
    const f = await fixture([]);
    const result = f.replace(method);
    await flush();
    expect(await result).toMatchObject({ ok: false, reason: "not-granted" });
    expect(document.body.children).toHaveLength(0);
  });

  it.each(methods)("rejects spoofing, stale epochs, malformed, non-JSON, and oversized %s calls", async (method, capability) => {
    const f = await fixture([capability]);
    expect(await f.raw(method, [1], { pluginId: "victim" })).toBeUndefined();
    expect(await f.raw(method, [1], { epoch: 0 })).toMatchObject({ ok: false });
    for (const args of [[{}], [0], [-1], ["x".repeat(65536)], [new Uint8Array(4)], [() => 1]]) {
      expect(await f.raw(method, args)).toMatchObject({ type: "reply" });
    }
    expect(document.body.children).toHaveLength(0);
    expect(await f.raw("engine.constructor", [])).toMatchObject({ result: { ok: false } });
    expect(f.sent.filter((message) => message.type === "ask" && message.question.kind === "presentation")).toHaveLength(0);
  });

  it.each(methods)("refuses over-rate %s registrations without widening authority", async (method, capability) => {
    const f = await fixture([capability]);
    for (let i = 0; i < 8; i += 1) expect(await f.raw(method, [null])).toMatchObject({ result: { ok: true } });
    expect(await f.raw(method, [1])).toMatchObject({ result: { ok: false } });
    expect(document.body.children).toHaveLength(0);
  });

  it.each(methods)("drops a revoked mid-flight %s description", async (method, capability) => {
    let resolve!: (value: unknown) => void;
    const f = await fixture([capability], () => new Promise((done) => { resolve = done; }));
    const registered = f.replace(method);
    await flush(); await registered;
    const offered = f.offer(method);
    await flush();
    f.authorize([]);
    resolve(method === "display.replace" ? commands : description);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.body.children).toHaveLength(0);
    await offered;
  });

  it.each(methods)("declines a stalled %s Worker and ignores its late answer", async (method, capability) => {
    let resolve!: (value: unknown) => void;
    const f = await fixture([capability], () => new Promise((done) => { resolve = done; }));
    const registered = f.replace(method);
    await flush(); await registered;
    const offered = f.offer(method);
    await flush();
    await vi.advanceTimersByTimeAsync(251);
    expect(document.body.children).toHaveLength(0);
    resolve(method === "display.replace" ? commands : description);
    await flush();
    expect(f.session.staleCount()).toBeGreaterThan(0);
    expect(document.body.children).toHaveLength(0);
    await offered;
  });

  it.each(methods)("drops %s answers after a binding or session change", async (method, capability) => {
    for (const change of ["binding", "session"]) {
      let resolve!: (value: unknown) => void;
      const f = await fixture([capability], () => new Promise((done) => { resolve = done; }));
      const registered = f.replace(method); await flush(); await registered;
      const offered = f.offer(method); await flush();
      if (change === "binding") setConsentBindings(new Map([["probe", "different-digest"]]));
      else f.changeSession();
      resolve(method === "display.replace" ? commands : description); await flush();
      await vi.advanceTimersByTimeAsync(100);
      expect(document.body.children).toHaveLength(0);
      await offered; f.session.teardown(); setScreenPresenter(null);
    }
  });

  it.each(methods)("rejects malformed and oversized %s descriptions before drawing", async (method, capability) => {
    for (const value of [{ ...description, html: "<script>bad()</script>" }, { ...description, lines: ["x".repeat(257)] }, Array.from({ length: 513 }, () => commands[0])]) {
      const f = await fixture([capability], () => value);
      const registered = f.replace(method);
      await flush(); await registered;
      const offered = f.offer(method);
      await flush(); await vi.advanceTimersByTimeAsync(101);
      expect(document.body.children).toHaveLength(0);
      await offered;
      f.session.teardown(); setScreenPresenter(null);
    }
  });

  it("renders menu markup as text, delivers opaque selections, and validates choices", async () => {
    const select = vi.fn(() => ({ kind: "choose", choice: "choice" }));
    const f = await fixture(["ui:menu.replace"], () => description, select);
    const registered = f.replace("ui.menu.replace"); await flush(); await registered;
    setModHostDialogOpen(true);
    const answer = askInstalledPresenter(question()); await flush();
    expect(document.querySelector("[role=region]")?.textContent).toContain(description.title);
    expect(document.querySelector("script,img,b")).toBeNull();
    expect(document.querySelector<HTMLElement>("[role=region]")!.style.zIndex).toBe("15");
    button("<b>Pick</b>").click(); await flush();
    expect(await answer).toEqual({ kind: "choose", choice: "choice" });
    expect(select).toHaveBeenCalledWith({ action: "pick" }, expect.any(String));
    expect(f.sent.every((message) => { cloneWorkerJson(message); return true; })).toBe(true);
    select.mockReturnValue({ kind: "choose", choice: "foreign" });
    const invalid = askInstalledPresenter(question()); await flush(); button("<b>Pick</b>").click(); await flush();
    expect(await invalid).toBeUndefined();
  });

  it.each(["disabled", "browse-only"])("rejects a menu selection that is %s", async (kind) => {
    const f = await fixture(["ui:menu.replace"]);
    const registered = f.replace("ui.menu.replace"); await flush(); await registered;
    const menu = question();
    const answer = askInstalledPresenter({ ...menu, browseOnly: kind === "browse-only",
      choices: menu.choices.map((choice) => ({ ...choice, disabled: kind === "disabled" })) });
    await flush(); button("<b>Pick</b>").click(); await flush();
    expect(await answer).toBeUndefined(); expect(document.body.children).toHaveLength(0);
  });

  it("drops a menu choice revoked while the Worker handles its selection", async () => {
    let resolve!: (value: unknown) => void;
    const f = await fixture(["ui:menu.replace"], () => description, () => new Promise((done) => { resolve = done; }));
    const registered = f.replace("ui.menu.replace"); await flush(); await registered;
    const answer = askInstalledPresenter(question()); await flush();
    button("<b>Pick</b>").click(); await flush();
    f.authorize([]); resolve({ kind: "choose", choice: "choice" }); await flush();
    expect(await answer).toBeUndefined(); expect(document.body.children).toHaveLength(0);
  });

  it("keeps protected menu and screen ids away from the Worker", async () => {
    const f = await fixture(["ui:menu.replace", "ui:screen.replace"]);
    const menu = f.replace("ui.menu.replace"); const screen = f.replace("ui.screen.replace"); await flush(); await menu; await screen;
    expect(await askInstalledPresenter({ ...question(), id: "core:mod-capabilities" })).toBeUndefined();
    expect(showThroughPresenter({ ...view(), id: "core:mod-permission-choice" })).toBeNull();
    expect(f.sent.filter((message) => message.type === "ask")).toHaveLength(0);
  });

  it("declines live screen actions without invoking host handlers", async () => {
    const f = await fixture(["ui:screen.replace"], () => description, () => ({ action: "rename" }));
    const registered = f.replace("ui.screen.replace"); await flush(); await registered;
    const invoke = vi.fn(async () => undefined);
    const shown = showThroughPresenter({ ...view(), actions: [{ id: "rename", key: "c", label: "change name" }] }, undefined, { invoke });
    const declined = expect(shown).rejects.toBeInstanceOf(ScreenAbandoned);
    await flush(); expect(invoke).not.toHaveBeenCalled(); button("<b>Pick</b>").click(); await flush(); await declined;
    expect(invoke).not.toHaveBeenCalled();
    setScreenPresenter(null);
    const invalid = showThroughPresenter(view(), undefined, { invoke });
    const rejected = expect(invalid).rejects.toBeInstanceOf(ScreenAbandoned);
    await flush(); button("<b>Pick</b>").click(); await flush(); await rejected;
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refreshes a Worker screen with data and dismisses without a live host action", async () => {
    const select = vi.fn<Handler>().mockReturnValueOnce({ kind: "refresh" }).mockReturnValueOnce({ kind: "dismiss" });
    const describe = vi.fn(() => description);
    const f = await fixture(["ui:screen.replace"], describe, select);
    const registered = f.replace("ui.screen.replace"); await flush(); await registered;
    const shown = showThroughPresenter(view()); await flush();
    button("<b>Pick</b>").click(); await flush();
    expect(describe).toHaveBeenCalledTimes(2);
    button("<b>Pick</b>").click(); await flush(); await shown;
    expect(document.body.children).toHaveLength(0);
  });

  it("bounds a screen that keeps requesting refreshes", async () => {
    const describe = vi.fn(() => description);
    const f = await fixture(["ui:screen.replace"], describe, () => ({ kind: "refresh" }));
    const registered = f.replace("ui.screen.replace"); await flush(); await registered;
    const shown = showThroughPresenter(view());
    const declined = expect(shown).rejects.toBeInstanceOf(ScreenAbandoned);
    await flush();
    for (let i = 0; i < 64; i += 1) { button("<b>Pick</b>").click(); await flush(); }
    await declined;
    expect(describe).toHaveBeenCalledTimes(64); expect(document.body.children).toHaveLength(0);
  });

  it("keeps a host route to the permission screen and ignores stale screen buttons", async () => {
    const select = vi.fn();
    const f = await fixture(["screens:manage"], () => description, select);
    const registered = f.replace("ui.management.replace"); await flush(); await registered;
    const shown = openTakenScreen("mods"); await flush();
    const stale = button("<b>Pick</b>");
    button("Permissions and game controls").click(); await flush();
    expect(await shown).toBe(false);
    stale.click(); await flush(); expect(select).not.toHaveBeenCalled();
    expect(document.body.children).toHaveLength(0);
  });

  it("keeps permission recovery above mounted panels and makes the fallback entirely Core-drawn", async () => {
    const f = await fixture(methods.map(([, capability]) => capability), () => description);
    for (const method of ["ui.menu.replace", "ui.screen.replace", "ui.management.replace"]) {
      const registered = f.replace(method); await flush(); await registered;
    }
    const panels = createModWorkerPanelRenderer();
    cleanups.push(() => panels.teardown("cover"));
    panels.apply("cover", "mount", { id: "cover", modal: true, root: { type: "text", text: "A covering panel" } });
    const shown = openTakenScreen("mods"); await flush();
    const control = button("Permissions and game controls");
    expect(Number(control.parentElement!.style.zIndex)).toBeGreaterThan(1008);
    control.click(); await flush(); expect(await shown).toBe(false);
    const before = f.sent.length;
    await expect(withHostManagementScreen(async () => {
      expect(isCoreDrawn("game:main")).toBe(true);
      expect(await askInstalledPresenter(question())).toBeUndefined();
      expect(showThroughPresenter(view())).toBeNull();
      const panel = document.querySelector<HTMLElement>("[data-mod-panel]")!;
      expect(panel.inert).toBe(true); expect(panel.style.visibility).toBe("hidden");
      throw new Error("host screen failed");
    })).rejects.toThrow("host screen failed");
    expect(isCoreDrawn("game:main")).toBe(false);
    expect(f.sent).toHaveLength(before);
  });

  it("declines legacy management handlers inside the Core recovery scope", async () => {
    const handler = vi.fn();
    const release = takeScreens("legacy", { mods: handler });
    try { expect(await withHostManagementScreen(() => openTakenScreen("mods"))).toBe(false); }
    finally { release(); }
    expect(handler).not.toHaveBeenCalled();
  });

  it("yields a screen and its host controls before a host prompt", async () => {
    const f = await fixture(["ui:screen.replace"]);
    const registered = f.replace("ui.screen.replace"); await flush(); await registered;
    const shown = showThroughPresenter(view()); await flush();
    const root = document.querySelector<HTMLElement>("[role=region]")!;
    const controls = document.querySelector<HTMLElement>("[aria-label='Game presenter controls']")!;
    await withTerminal(promptRequest("core:rename", "rename", "line", "Name", { cols: 80, rows: 24 }), async () => {
      expect(root.hidden).toBe(true); expect(root.inert).toBe(true); expect(controls.hidden).toBe(true);
      const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      browserKeydown(escape); await flush();
      expect(root.isConnected).toBe(true); expect(escape.defaultPrevented).toBe(false);
    });
    expect(root.hidden).toBe(false); expect(controls.hidden).toBe(false);
    button("Close").click(); await flush(); await shown;
  });

  it.each(methods)("renders %s data without interpreting HTML or scripts", async (method, capability) => {
    const f = await fixture([capability], () => method === "display.replace" ? commands : description);
    const registered = f.replace(method); await flush(); await registered;
    const offered = f.offer(method); await flush();
    expect(document.querySelector("script,img,b,canvas,dialog")).toBeNull();
    if (method !== "display.replace") {
      expect(document.querySelector("[role=region]")!.textContent).toContain("<img src=x onerror=bad()>");
      button("Close").click(); await flush();
    }
    await offered;
  });

  it("clips glyphs to the map and restores the underlying display when the Worker stalls", async () => {
    const f = await fixture(["display:replace"], () => [...commands, { ...commands[0], col: -1 }, { ...commands[0], col: 50 }, { ...commands[0], row: 20 }]);
    const registered = f.replace("display.replace"); await flush(); await registered;
    const root = document.querySelector<HTMLElement>("[aria-label='probe map']")!;
    expect(root.childElementCount).toBe(1); expect(root.textContent).toBe("<"); expect(root.inert).toBe(true);
    expect(root.style.left).toBe("130px"); expect(root.style.width).toBe("500px"); expect(root.style.zIndex).toBe("10");
    f.setStuck(); await vi.advanceTimersByTimeAsync(251);
    expect(document.body.children).toHaveLength(0);
  });

  it.each(methods)("suspends %s for permission and controller showModal dialogs", async (method, capability) => {
    const f = await fixture([capability], () => method === "display.replace" ? commands : description);
    const registered = f.replace(method); await flush(); await registered;
    setModHostDialogOpen(true);
    const offered = f.offer(method); await flush();
    const mod = buildCatalog({ content: [], sandbox: [], trusted: [{ id: "probe", name: "Probe", version: "1", shape: "plugin", capabilities: [capability] }],
      enabled: [], consents: {}, tierOf: () => assignTier({ id: "probe", source: "folder", execution: "worker" }) })[0]!;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
    for (const ask of [() => drawModPermissionConsent([{ mod, caps: [capability] }]), () => drawModControllerConsent("probe", "Probe")]) {
      const consent = ask(); await flush();
      expect(document.querySelector("dialog[open]")).not.toBeNull();
      expect(document.querySelector("[role=region],[aria-label='probe map']")).toBeNull();
      expect(document.querySelector("[aria-label='Game presenter controls']")).toBeNull();
      const count = f.sent.filter((message) => message.type === "ask").length;
      await vi.advanceTimersByTimeAsync(150);
      expect(f.sent.filter((message) => message.type === "ask")).toHaveLength(count);
      document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); await flush(); await consent;
    }
    await offered;
  });

  it.each(methods)("never delivers reserved keys through %s selection events", async (method, capability) => {
    const select = vi.fn();
    const f = await fixture([capability], () => method === "display.replace" ? commands : description, select);
    const registered = f.replace(method); await flush(); await registered;
    const answer = f.offer(method); await flush();
    for (const key of ["F5", "F11", "F12", "z"]) dispatchUiInput({ key: { key, modifiers: { ctrl: key === "z", shift: false, alt: false, meta: false }, repeat: false } });
    await flush(); expect(select).not.toHaveBeenCalled();
    dispatchUiInput({ key: { key: "Escape", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } }); await flush();
    await answer; expect(select).not.toHaveBeenCalled();
  });

  it.each(methods)("invalidates an in-flight %s answer even after a nested Core question closes", async (method, capability) => {
    let resolve!: (value: unknown) => void;
    const f = await fixture([capability], () => new Promise((done) => { resolve = done; }));
    const registered = f.replace(method); await flush(); await registered;
    setModHostDialogOpen(true);
    const offered = f.offer(method); await flush();
    const restore = suspendModPanels(); restore();
    resolve(method === "display.replace" ? commands : description); await flush();
    expect(document.body.children).toHaveLength(0);
    await offered;
  });

  it("drops a screen refresh revoked during selection", async () => {
    let resolve!: (value: unknown) => void;
    const describe = vi.fn(() => description);
    const f = await fixture(["ui:screen.replace"], describe, () => new Promise((done) => { resolve = done; }));
    const registered = f.replace("ui.screen.replace"); await flush(); await registered;
    const invoke = vi.fn(async () => undefined);
    const shown = showThroughPresenter({ ...view(), actions: [{ id: "rename", key: "c", label: "change name" }] }, undefined, { invoke });
    const declined = expect(shown).rejects.toBeInstanceOf(ScreenAbandoned);
    await flush(); button("<b>Pick</b>").click(); await flush();
    f.authorize([]); resolve({ kind: "refresh" }); await flush(); await declined;
    expect(describe).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled(); expect(document.body.children).toHaveLength(0);
  });

  it("rejects non-JSON presenter values and self-selected styles", () => {
    for (const value of [() => {}, document.body, new Uint8Array(1), new ArrayBuffer(1), new Map(), new SharedArrayBuffer(1)]) {
      expect(() => presentationDescription(value)).toThrow(); expect(() => gridCommands(value)).toThrow();
    }
    expect(() => gridCommands([{ col: 0, row: 0, glyph: "x", color: "url(https://bad.test)" }])).toThrow();
    expect(() => presentationDescription({ ...description, rows: [description.rows[0], description.rows[0]] })).toThrow();
    const restore = suspendModPanels(); restore();
  });
});
