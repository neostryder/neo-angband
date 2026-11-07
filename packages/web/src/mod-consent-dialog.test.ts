// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerLocale, resetLocales } from "@rpgm-tools/neo-angband-core";
import { MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import { drawModControllerConsent, drawModPermissionConsent } from "./mod-consent-dialog";
import { setConsentBindings } from "./mod-consent-binding";
import * as snapshots from "./mod-code-snapshot";
import { buildCatalog, ModStore } from "./mod-store";
import { assignTier } from "./mod-tier";
import { modPanelsSuspended, resetModPanels } from "./panel-runtime";

const priorShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const priorClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  vi.spyOn(snapshots, "modPayloadDigest").mockImplementation((id) => id === "two" ? "b".repeat(64) : "a".repeat(64));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  setConsentBindings(new Map([["probe", "digest-a"]]));
});
afterEach(() => {
  for (const dialog of document.querySelectorAll("dialog")) dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
  document.body.replaceChildren(); document.body.removeAttribute("style");
  if (priorShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", priorShow); else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (priorClose) Object.defineProperty(HTMLDialogElement.prototype, "close", priorClose); else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  resetLocales(); resetModPanels(); setConsentBindings(new Map()); vi.restoreAllMocks();
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
    expect(dialog.style.font).toContain("monospace");
    expect(dialog.style.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(dialog.querySelectorAll("input")).toHaveLength(2);
    expect(modPanelsSuspended()).toBe(true);
    expect(document.activeElement?.textContent).toBe(MOD_PERMISSION_TEXT.cancel);
    for (const input of dialog.querySelectorAll<HTMLInputElement>("input")) {
      expect(input.checked).toBe(false);
      input.checked = true;
    }
    apply();
    expect((await result)?.get("probe")).toEqual({ granted: ["input:controller", "input:intent"], refused: [], binding: "digest-a" });
    expect(modPanelsSuspended()).toBe(false);
  });

  it("starts prior grants unchecked and rejects content changes while a dialog is open", async () => {
    const result = drawModPermissionConsent([ask()], () => ({ granted: ["input:intent"], refused: ["input:controller"] }));
    document.querySelector<HTMLInputElement>("dialog input")!.checked = false;
    apply();
    expect((await result)?.get("probe")).toEqual({ granted: [], refused: ["input:controller", "input:intent"], binding: "digest-a" });
    const changed = drawModPermissionConsent([ask()]);
    setConsentBindings(new Map([["probe", "digest-b"]])); apply();
    expect(await changed).toBeNull();
    const store = new ModStore(null);
    expect(() => store.setDecisions("probe", { granted: ["input:controller"], refused: [], binding: "digest-a" }, "1.0.0")).toThrow(MOD_PERMISSION_TEXT.changed);
  });

  it("requires positive choices for input, network and action capabilities", async () => {
    const caps = ["input:controller", "input:observe", "input:intent", "input:prompt.reply", "network:*", "network:local", "network:example.com", "command:add", "command:submit", "ui:title", "keymap:write", "keymap:edit", "ui:panel.mount", "state:map-actual.read", "display:filter", "ui:panel"];
    const result = drawModPermissionConsent([ask(caps)]);
    apply();
    expect((await result)?.get("probe")).toEqual({ granted: [], refused: caps, binding: "digest-a" });
  });

  it("distinguishes identical display names by id, repository, and digest", async () => {
    const request = ask();
    setConsentBindings(new Map([["one", "digest-one"], ["two", "digest-two"]]));
    const lines: string[] = [];
    for (const id of ["one", "two"]) {
      const mod = { ...request.mod, id, name: "Same name", manifest: { ...request.mod.manifest, id, repository: `https://github.com/owner/${id}` } };
      const result = drawModPermissionConsent([{ mod, caps: request.caps }]);
      expect(document.querySelector("dialog h3")?.textContent).toBe("Same name");
      lines.push(document.querySelector(".neo-consent-identity")!.textContent!);
      expect(lines.at(-1)).toContain(`Id: ${id}`);
      expect(lines.at(-1)).toContain(`Repository: https://github.com/owner/${id}`);
      expect(lines.at(-1)).toContain("SHA-256:");
      expect(lines.at(-1)).toContain(`SHA-256: ${(id === "two" ? "b" : "a").repeat(12)}`);
      apply(); await result;
    }
    expect(lines[0]).not.toBe(lines[1]);
  });

  it("refuses an absent binding before drawing a dialog", async () => {
    setConsentBindings(new Map());
    expect(await drawModPermissionConsent([ask()])).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("normalizes names and removes format and line controls before truncating", async () => {
    const request = ask();
    const name = "\u200b".repeat(130) + "\uff2d\uff4f\uff44\u061c\u2028\u2029\u2060\ufeff\u{e0001}" + "x".repeat(130);
    const result = drawModPermissionConsent([{ ...request, mod: { ...request.mod, name } }]);
    expect(document.querySelector("dialog h3")?.textContent).toBe("Mod" + "x".repeat(117));
    apply(); await result;
  });

  it("restores panels if constructing the dialog throws", async () => {
    const append = vi.spyOn(document.body, "append").mockImplementation(() => { throw new Error("append failed"); });
    try {
      await expect(drawModPermissionConsent([ask()])).rejects.toThrow("append failed");
      expect(modPanelsSuspended()).toBe(false);
      expect(document.querySelector("dialog")).toBeNull();
    } finally { append.mockRestore(); }
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
