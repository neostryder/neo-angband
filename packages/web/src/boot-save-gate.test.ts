import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import { describe, expect, it, vi } from "vitest";
import { createBootSaveGate } from "./boot-save-gate";

describe("boot save gate", () => {
  it("refuses saves until opened and remembers that one was asked for", () => {
    const gate = createBootSaveGate();
    expect(gate.admit()).toBe(false);
    expect(gate.admit()).toBe(false);
    expect(gate.open()).toBe(true);
    expect(gate.admit()).toBe(true);
  });

  it("asks for no catch-up save when nothing was requested early", () => {
    const gate = createBootSaveGate();
    expect(gate.open()).toBe(false);
    expect(gate.admit()).toBe(true);
  });

  it("reports a missed save only once", () => {
    const gate = createBootSaveGate();
    gate.admit();
    expect(gate.open()).toBe(true);
    expect(gate.open()).toBe(false);
  });
});

/*
 * #479, the page's own wiring rather than the gate object: the Ctrl-Z reload installs the
 * controller (finishAutoplayerInstall) and saves before bootMenus has built the mod catalog
 * and the mod-set guard, and persistSave answers false without them. These run main.ts's
 * real autosave and bootMenus's real catch-up statement, so a save path that skips the gate
 * or a catch-up moved above the guard's construction fails here.
 */
describe("the Ctrl-Z handoff save in main.ts (#479)", () => {
  const source = ts.createSourceFile("main.ts", readFileSync(new URL("./main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const fn = (name: string): ts.FunctionDeclaration =>
    source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name)!;

  function harness() {
    let ready = false;
    const persistSave = vi.fn(() => ready);
    const say = vi.fn();
    const deps = {
      dead: false, bootSaveGate: createBootSaveGate(), persistSave, say,
      t: (_key: string, fallback: string) => fallback, performance: { now: () => 1_000_000 },
    };
    const body = fn("bootMenus").body!;
    const catchUp = body.statements.find((s) => s.getText(source).includes("bootSaveGate.open()"));
    const emitted = ts.transpileModule(`let lastSaveMs = -Infinity; let autosaveFailed = false;
${fn("autosave").getText(source)}
return { autosave, catchUp: () => { ${catchUp?.getText(source) ?? "throw new Error('bootMenus has no catch-up save');"} } };`,
    { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
    const runtime = new Function(...Object.keys(deps), emitted)(...Object.values(deps)) as { autosave: (force?: boolean) => void; catchUp: () => void };
    return { runtime, persistSave, say, body, catchUp, setReady: () => { ready = true; } };
  }

  it("holds the controller's save until boot can write it, then writes it once without a failure line", () => {
    const h = harness();
    /* finishAutoplayerInstall's autosave(true) on the just-confirmed boot, before bootMenus. */
    h.runtime.autosave(true);
    h.runtime.autosave(true);
    expect(h.persistSave).not.toHaveBeenCalled();
    expect(h.say).not.toHaveBeenCalled();
    /* bootMenus has built the catalog and the guard. */
    h.setReady();
    h.runtime.catchUp();
    expect(h.persistSave).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.say).not.toHaveBeenCalled();
  });

  it("still reports a save that fails after boot", () => {
    const h = harness();
    h.runtime.catchUp();
    h.runtime.autosave(true);
    expect(h.say).toHaveBeenCalledExactlyOnceWith("Saving failed.");
  });

  it("opens the gate only after the catalog and the mod-set guard exist", () => {
    const h = harness();
    expect(h.catchUp).toBeDefined();
    const at = (pattern: RegExp): number => h.body.statements.findIndex((s) => pattern.test(s.getText(source)));
    const catchUp = h.body.statements.indexOf(h.catchUp!);
    expect(at(/^saveCatalog = /u)).toBeGreaterThanOrEqual(0);
    expect(at(/^modSaveGuard = new ModSaveGuard/u)).toBeGreaterThanOrEqual(0);
    expect(catchUp).toBeGreaterThan(at(/^saveCatalog = /u));
    expect(catchUp).toBeGreaterThan(at(/^modSaveGuard = new ModSaveGuard/u));
  });

  it("sends every save the controller install makes through the gated autosave", () => {
    for (const name of ["finishAutoplayerInstall", "markSaveNondeterministic"]) {
      const text = fn(name).getText(source);
      expect(text, name).toMatch(/\bautosave\(true\)/u);
      expect(text, name).not.toMatch(/\bpersistSave\(/u);
    }
  });
});
