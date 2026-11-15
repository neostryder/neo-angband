// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet, MOD_PERMISSION_TEXT, type Api2ModDefinition, type ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import { createApi2Host, disposeApi2Host } from "./mod-api2-host";
import { modPluginContext } from "./mod-context";
import { menuRegistry } from "./menu-registry";
import { setMenuPresenter } from "./menu-runtime";
import { MENU_ACTION, selectFromMenu, type SelectMenuOptions } from "./overlay";
import { createModUi, resetModPanels, setModHostDialogOpen } from "./panel-runtime";
import { installModWorkerBootstrap, type WorkerScope } from "./mod-worker/bootstrap";
import { startModWorker, type ModWorkerLike, type WorkerApiOptions } from "./mod-worker/host";
import { MOD_WORKER_PROTOCOL_VERSION, type HostToModWorker, type ModWorkerToHost } from "./mod-worker/protocol";
import type { GlyphTerm } from "./term";

const grants = ["ui:menu.row", "ui:panel.mount"];
const apis: ModApi2[] = [];
const cleanups: Array<() => void> = [];

function host(options?: WorkerApiOptions): ModApi2 {
  const capabilities = CapabilitySet.fromManifest({ id: "probe", name: "Probe", version: "1.0.0", shape: "plugin", capabilities: grants });
  const api = createApi2Host(modPluginContext("probe", {}, undefined, {}, { capabilities }), { grants: capabilities, ...options, execution: options ? "worker" : "in-process" });
  apis.push(api);
  return api;
}

function worker(definition: Api2ModDefinition) {
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (message: ModWorkerToHost) => {
      const copy = structuredClone(message);
      queueMicrotask(() => transport.onmessage?.({ data: copy } as MessageEvent<unknown>));
    },
  };
  const transport: ModWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message: HostToModWorker) => {
      const copy = structuredClone(message);
      queueMicrotask(() => scope.onmessage?.({ data: copy } as MessageEvent<HostToModWorker>));
    },
    terminate: () => {},
  };
  installModWorkerBootstrap(scope, MOD_WORKER_PROTOCOL_VERSION, () => Promise.resolve({ default: definition }), MOD_PERMISSION_TEXT);
  const session = startModWorker(transport, { id: "probe", entryUrl: "staged:entry", grants, flags: {}, engine: "9.9.9", newCharacter: false, net: false, api: host });
  cleanups.push(() => session.teardown());
  return session;
}

function term(): GlyphTerm {
  return { size: () => ({ cols: 80, rows: 24 }), clear: () => {}, print: () => {}, prt: () => {}, eraseToEol: () => {}, onCellTap: () => {} } as unknown as GlyphTerm;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const api of apis.splice(0)) disposeApi2Host(api);
  setModHostDialogOpen(false);
  resetModPanels();
  setMenuPresenter(null);
  menuRegistry.clear();
  document.body.replaceChildren();
});

describe.each(["in-process", "worker"])("%s Game-menu panels", (execution) => {
  it.each(["keyboard", "terminal picker", "presenter"])("mounts a panel after the %s closes its modal", async (picker) => {
    let mounted: unknown;
    const register = async (api: ModApi2) => {
      await api.ui.gameMenu.register("loadouts", "Loadouts...", async () => {
        mounted = await api.ui.mount({ id: "loadouts", modal: true, root: { type: "text", text: "Loadouts" } });
      });
    };
    if (execution === "worker") {
      const session = worker({ api: ">=2.0.0 <3.0.0", start: register });
      await session.ready;
      session.start();
      await vi.waitFor(() => expect(menuRegistry.transform("core:game-menu", [])).toHaveLength(1));
    } else {
      await register(host());
    }
    const row = menuRegistry.transform("core:game-menu", [])[0]!;
    let action: (() => Promise<void>) | undefined;
    const extra: SelectMenuOptions = { onModAction: (run) => { action = run; } };
    if (picker === "terminal picker") extra.terminalPicker = async () => row.id;
    if (picker === "presenter") setMenuPresenter({ id: "skin", presenter: { ask: async () => ({ kind: "choose", choice: row.id }) } });
    setModHostDialogOpen(true);
    const selected = selectFromMenu(term(), "core:game-menu", "Game menu", [], undefined, extra);
    if (picker === "keyboard") window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(await selected).toBe(MENU_ACTION);
    setModHostDialogOpen(false);
    await action?.();
    await vi.waitFor(() => expect(mounted).toEqual({ ok: true, value: { panelId: "loadouts" } }));
    const container = document.querySelector<HTMLElement>('[role="dialog"][aria-label="probe:loadouts"]');
    expect(container).not.toBeNull();
    expect(container!.style.visibility).not.toBe("hidden");
  });
});

it("names a host dialog when it refuses a panel", () => {
  setModHostDialogOpen(true);
  expect(() => createModUi("probe").openPanel({ id: "loadouts", modal: true })).toThrow('panel "loadouts": the game has a dialog open; open it again afterwards');
});

it("keeps the permission wording while a real permission menu is open", async () => {
  setModHostDialogOpen(true);
  const selected = selectFromMenu(term(), "core:mod-permission-choice", "Mod permissions", [{ label: "Cancel" }]);
  expect(() => createModUi("probe").openPanel({ id: "loadouts", modal: true })).toThrow('panel "loadouts": the game is asking the player about mod permissions; open it again afterwards');
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(await selected).toBeNull();
});
