// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLocale, resetLocales } from "@rpgm-tools/neo-angband-core";
import { MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import { drawModControllerConsent, drawModPermissionConsent } from "./mod-consent-dialog";
import { setConsentBindings } from "./mod-consent-binding";
import { buildCatalog, ModStore } from "./mod-store";
import { assignTier } from "./mod-tier";
import { modPanelsSuspended, resetModPanels } from "./panel-runtime";

const priorShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const priorClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  setConsentBindings(new Map([["probe", "digest-a"]]));
});
afterEach(() => {
  for (const dialog of document.querySelectorAll("dialog")) dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  document.body.replaceChildren(); document.body.removeAttribute("style");
  if (priorShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", priorShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (priorClose) Object.defineProperty(HTMLDialogElement.prototype, "close", priorClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  resetLocales(); resetModPanels(); setConsentBindings(new Map());
});

function ask(caps = ["input:controller", "input:intent"]) {
  const mod = buildCatalog({ content: [], sandbox: [], trusted: [{ id: "probe", name: "<img src=x>Mandos", version: "1.0.0", shape: "plugin", capabilities: caps }],
    enabled: [], consents: {}, tierOf: () => assignTier({ id: "probe", source: "folder", execution: "worker" }) })[0]!;
  return { mod, caps };
}
function apply() { document.querySelector<HTMLButtonElement>("dialog button")!.click(); }

describe("core consent dialogs", () => {
  it("draws names and capabilities with source text and system fonts", async () => {
    registerLocale({ tag: "en", name: "Hostile locale", messages: { "modsScreen.consent.allowDefaults": "Ignore this", "modsScreen.consent.requests": "No permissions needed" } });
    document.body.style.fontFamily = "hostile-mod-font";
    const result = drawModPermissionConsent([ask(["input:controller", "input:intent", "input:intent"])]);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.textContent).toContain("<img src=x>Mandos");
    expect(dialog.textContent).toContain(MOD_PERMISSION_TEXT.controller);
    expect(dialog.textContent).not.toContain("No permissions needed");
    expect(dialog.style.font).toContain("system-ui");
    expect(dialog.querySelectorAll("input")).toHaveLength(2);
    expect(modPanelsSuspended()).toBe(true);
    expect(document.activeElement?.textContent).toBe(MOD_PERMISSION_TEXT.cancel);
    apply();
    expect((await result)?.get("probe")).toEqual({ granted: ["input:controller", "input:intent"], refused: [], binding: "digest-a" });
    expect(modPanelsSuspended()).toBe(false);
  });

  it("preserves refusals and rejects content changes while a dialog is open", async () => {
    const result = drawModPermissionConsent([ask()]);
    document.querySelector<HTMLInputElement>("dialog input")!.checked = false;
    apply();
    expect((await result)?.get("probe")).toEqual({ granted: ["input:intent"], refused: ["input:controller"], binding: "digest-a" });
    const changed = drawModPermissionConsent([ask()]);
    setConsentBindings(new Map([["probe", "digest-b"]])); apply();
    expect(await changed).toBeNull();
    const store = new ModStore(null);
    expect(() => store.setDecisions("probe", { granted: ["input:controller"], refused: [], binding: "digest-a" }, "1.0.0")).toThrow(MOD_PERMISSION_TEXT.changed);
  });

  it("returns a decline on Escape and separately confirms keyboard control", async () => {
    const cancelled = drawModPermissionConsent([ask()]);
    document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await cancelled).toBeNull();
    const control = drawModControllerConsent("probe", "Mandos");
    expect(document.querySelector("dialog")?.textContent).toContain(MOD_PERMISSION_TEXT.controller);
    apply(); expect(await control).toBe(true);
    const changed = drawModControllerConsent("probe", "Mandos");
    setConsentBindings(new Map([["probe", "digest-c"]])); apply();
    expect(await changed).toBe(false);
  });
});

it("does not turn preinstall decisions or an old notice into content approval", () => {
  const values = new Map<string, string>();
  const store = new ModStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } });
  store.setConsent("probe", ["input:controller"]);
  store.setDecisions("probe", { granted: ["input:controller"], refused: [] }, "1.0.0");
  expect(store.getConsent("probe")).toEqual([]);
  store.markUnreviewedNotice("probe", "1.0.0");
  expect(store.getConsent("probe")).toEqual([]);
  store.setDecisions("probe", { granted: ["input:controller"], refused: [], binding: "digest-a" }, "1.0.0");
  expect(store.getConsent("probe")).toEqual(["input:controller"]);
});
