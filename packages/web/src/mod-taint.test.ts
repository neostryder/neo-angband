/**
 * A mod's hook throwing MID-TURN, and the save it must not be allowed to write.
 *
 * WHAT WAS ACTUALLY THERE. Nothing caught this, and the port looked like it was
 * coping for a reason worth writing down: the autosave sits at the TAIL of the
 * turn, so an uncaught throw unwound past it and the last good save survived. The
 * protection was the exception itself. What the player got with it was a frozen
 * screen mid-turn, no repaint, no message, and no name of the mod responsible -
 * and the moment the hooks were guarded so the turn could finish, that accidental
 * protection would have vanished and the tail autosave would have written the
 * half-updated state straight over the good one.
 *
 * So the two halves have to be tested together, and they are two different
 * claims: core's guardModHooks turns the throw into that hook's neutral answer
 * (pinned in core/src/mod/hooks.test.ts), and this host treats the fault as
 * terminal for the session - stop writing, name the mod, offer the reload.
 *
 * THE SAVE GATE IS ASSERTED ON SOURCE, with comments stripped. main.ts is a
 * script module that boots a game on import, so it cannot be imported here; and
 * the thing that matters about persistSave is not that a taint check exists
 * somewhere but that it runs BEFORE the write, in the one function every save
 * path goes through. A prose citation would satisfy a naive match, so the
 * comments are removed before the assertion sees the text.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOD_API_VERSION } from "./mod-plugin";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks, type DiskPack } from "./disk-packs";
import { loadModCode, PLUGIN_FILE, resetModCode, setModCode } from "./mod-code";
import { activeModHooks } from "./mod-hooks";
import { modFaults, problemsFor, resetModFaults } from "./mod-problems";
import {
  onSessionTaint,
  resetSessionTaint,
  sessionTaint,
  taintNotice,
  taintSession,
} from "./mod-taint";
import type { CodeUrlResolver } from "./disk-packs";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";

/* No vi.resetModules(), for the same reason as mod-engine-gate.test.ts: it would
 * give a dynamic import private copies of the latches this file writes to. */
afterEach(() => {
  resetDiskPacks();
  resetModCode();
  resetModFaults();
  resetSessionTaint();
});

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

/** Source with line and block comments stripped, so a citation cannot score. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/* --- the taint itself ------------------------------------------------------ */

const FAULT = { id: "rowdy", hook: "historyAdd", why: "boom" } as const;

describe("the session taint", () => {
  it("starts absent, so an ordinary session saves", () => {
    expect(sessionTaint()).toBeNull();
  });

  it("records the fault that ended the session", () => {
    taintSession(FAULT);
    expect(sessionTaint()).toEqual(FAULT);
  });

  it("keeps the FIRST fault, not the latest", () => {
    /* The first one happened while the state was still good, so it is the one
     * that explains what went wrong. A later mod failing in the wreckage of the
     * first does not get to relabel the wound - it still reaches the manager
     * through reportModFault. */
    taintSession(FAULT);
    taintSession({ id: "bystander", hook: "messageText", why: "later" });
    expect(sessionTaint()?.id).toBe("rowdy");
  });

  it("tells a listener once, with the fault", () => {
    const told = vi.fn();
    onSessionTaint(told);
    taintSession(FAULT);
    taintSession({ id: "bystander", hook: "messageText", why: "later" });
    expect(told).toHaveBeenCalledTimes(1);
    expect(told).toHaveBeenCalledWith(FAULT);
  });

  it("tells a listener that registered too late", () => {
    /* The fault can land before the shell has finished booting its listeners -
     * a plugin's hooks run during startGame. Losing the notice to boot order
     * would leave a session that has silently stopped saving. */
    taintSession(FAULT);
    const told = vi.fn();
    onSessionTaint(told);
    expect(told).toHaveBeenCalledWith(FAULT);
  });
});

describe("what the player is told", () => {
  const text = taintNotice(FAULT).join("\n");

  it("names the mod, the hook and the error", () => {
    expect(text).toContain("rowdy");
    expect(text).toContain("historyAdd");
    expect(text).toContain("boom");
  });

  it("says the game has stopped saving, and that the old save is intact", () => {
    /* Both halves, because either one alone is misleading. "Stopped saving" on
     * its own reads as "your character is gone"; "your save is fine" on its own
     * invites the player to carry on and lose the next hour. */
    expect(text).toMatch(/STOPPED SAVING/u);
    expect(text.toLowerCase()).toContain("last save");
    expect(text.toLowerCase()).toMatch(/untouched|still good/u);
  });

  it("says what to do about it", () => {
    expect(text.toLowerCase()).toContain("reload");
  });
});

/* --- end to end, through the real composition ------------------------------ */

const resolver: CodeUrlResolver = ((id: string, file: string) =>
  Promise.resolve(`mem://${id}/${file}`)) as CodeUrlResolver;

function codePack(id: string): DiskPack {
  return {
    manifest: {
      id,
      name: id,
      version: "1.0.0",
      shape: "plugin",
      modApi: MOD_API_VERSION,
    } as PackManifest,
    files: {},
    code: [PLUGIN_FILE],
    assets: [],
  };
}

function folderWith(...packs: DiskPack[]): Parameters<typeof setDiskPacks>[0] {
  return {
    packs,
    order: packs.map((p) => p.manifest.id),
    problems: [],
    dir: "my-mods",
    available: true,
    kind: "picked",
    codeUrl: null,
    assetUrl: null,
    origins: [{ kind: "picked", dir: "my-mods", count: packs.length }],
  };
}

/**
 * Install a folder mod whose `saveNoiseScent` throws, through the real loader.
 *
 * saveNoiseScent rather than a livelier hook because it collides with nothing
 * else the bundled demo contributes, so the composed object under test holds this
 * mod's hook and no other - the fold is pinned separately in core.
 */
async function withExplodingMod(...also: DiskPack[]): Promise<{
  hooks: ReturnType<typeof activeModHooks>;
  calls: () => number;
}> {
  let calls = 0;
  const packs = [codePack("rowdy"), ...also];
  setDiskPacks(folderWith(...packs));
  setModCode(
    await loadModCode({
      packs,
      codeUrl: resolver,
      enabled: () => true,
      consented: () => [],
      importer: (url: string) =>
        Promise.resolve({
          default: {
            api: MOD_API_VERSION,
            hooks: () =>
              url.startsWith("mem://rowdy/")
                ? {
                    saveNoiseScent: (): boolean => {
                      calls++;
                      throw new Error("cannot read properties of undefined");
                    },
                  }
                : { messageText: (raw: string) => `${raw} (still here)` },
          },
        }),
    }),
  );
  return { hooks: activeModHooks(), calls: () => calls };
}

describe("a hook that throws mid-turn", () => {
  it("answers with the faithful behaviour instead of escaping into the turn", async () => {
    const { hooks } = await withExplodingMod();
    expect(hooks?.saveNoiseScent).toBeTypeOf("function");
    expect(() => hooks?.saveNoiseScent?.()).not.toThrow();
    expect(hooks?.saveNoiseScent?.()).toBe(false);
  });

  it("taints the session, naming the mod and the hook", async () => {
    const { hooks } = await withExplodingMod();
    expect(sessionTaint()).toBeNull(); // composing does not call the hook
    hooks?.saveNoiseScent?.();
    expect(sessionTaint()).toEqual({
      id: "rowdy",
      hook: "saveNoiseScent",
      why: "cannot read properties of undefined",
    });
  });

  it("puts the fault on that mod's row too, saying the game stopped saving", async () => {
    const { hooks } = await withExplodingMod();
    hooks?.saveNoiseScent?.();
    const why = problemsFor(modFaults(), "rowdy").join(" ");
    expect(why).toContain("saveNoiseScent");
    expect(why).toContain("stopped saving");
    expect(why).toContain("cannot read properties of undefined");
  });

  it("is not called again for the rest of the session", async () => {
    const { hooks, calls } = await withExplodingMod();
    hooks?.saveNoiseScent?.();
    hooks?.saveNoiseScent?.();
    hooks?.saveNoiseScent?.();
    expect(calls()).toBe(1);
    expect(problemsFor(modFaults(), "rowdy")).toHaveLength(1);
  });

  it("costs that mod and not the ones beside it", async () => {
    const { hooks } = await withExplodingMod(codePack("polite"));
    hooks?.saveNoiseScent?.();
    expect(hooks?.messageText?.("You feel a draught.")).toBe(
      "You feel a draught. (still here)",
    );
  });

  it("leaves an untainted session alone", async () => {
    setDiskPacks(NO_DISK_PACKS);
    expect(activeModHooks()).toBeUndefined();
    expect(sessionTaint()).toBeNull();
    expect(modFaults()).toEqual([]);
  });
});

/* --- the half that lives in main.ts ---------------------------------------- */

describe("the save refusal is wired into the one function every save goes through", () => {
  const persist = stripComments(functionBody(MAIN, "persistSave"));

  it("persistSave checks the taint", () => {
    expect(persist).toMatch(/sessionTaint\(\)/u);
  });

  it("checks it BEFORE anything is encoded or written", () => {
    /* Order is the whole claim. A taint check after encodeSavedGame/writeSlot
     * would refuse nothing. */
    const gate = persist.indexOf("sessionTaint()");
    const write = persist.search(/encodeSavedGame|writeSlot/u);
    expect(gate).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(gate);
  });

  it("gates persistSave and not merely autosave", () => {
    /* The tail autosave is not the only writer: a level change, the 'S' command,
     * the options screen and pagehide all force a save. Gating autosave() alone
     * would leave four ways to overwrite the good file by walking downstairs. */
    const auto = stripComments(functionBody(MAIN, "autosave"));
    expect(auto).not.toMatch(/sessionTaint/u);
    const flush = stripComments(functionBody(MAIN, "flushSaveOnExit"));
    expect(flush).toMatch(/persistSave\(\)/u);
  });

  it("registers the notice, and defers it out of the turn", () => {
    /* The fault surfaces inside core, halfway through a turn: painting an overlay
     * from there would be painted straight back over by the turn's tail render. */
    const src = stripComments(MAIN);
    const at = src.indexOf("onSessionTaint(");
    expect(at).toBeGreaterThan(-1);
    /* A character window rather than a brace match, and generous: the handler
     * grew a branch for core faults and a 400-column window silently stopped
     * covering `location.reload()`, which is the last line of it. Too small a
     * window fails loudly, which is the right way round. */
    const handler = src.slice(at, at + 900);
    expect(handler).toMatch(/setTimeout/u);
    /* `taintScreenLines` wraps `taintNotice` (issue #59: it also turns the
     * core-fault branch's one URL-bearing line into clickable runs), so the
     * handler now calls that wrapper rather than `taintNotice` directly - the
     * wording itself is still exactly what `taintNotice` returns, which is what
     * mod-taint.test.ts's OWN "taintNotice" tests pin. */
    expect(handler).toMatch(/taintScreenLines/u);
    expect(handler).toMatch(/location\.reload\(\)/u);
  });

  it("contains a throw from the ENGINE, not just from a mod's hook", () => {
    /* The gap this closes. guardModHooks catches a mod; nothing caught a port
     * bug, so an uncaught throw inside runGameLoop escaped advance() and left
     * the game frozen on the frame before the keypress - no repaint, no
     * message, and the save protected only by the accident of the exception
     * unwinding past the tail autosave. 'S' and a level change do not unwind. */
    const advance = stripComments(functionBody(MAIN, "advance"));
    expect(advance).toMatch(/try\s*\{[\s\S]*runGameLoop\(/u);
    expect(advance).toMatch(/catch/u);
    expect(advance).toMatch(/taintSession\(/u);
    /* And it must taint as CORE, or the notice blames a mod for the game's own bug. */
    expect(advance).toMatch(/id:\s*null/u);
  });

  it("words a core fault as a core fault", () => {
    const lines = taintNotice({
      id: null,
      hook: "taking a turn",
      why: "cannot read properties of undefined",
    }).join(" ");
    expect(lines).toContain("The game hit a bug");
    expect(lines).not.toContain("mod");
    /* The two things a player needs after a crash: their save is fine, and
     * where to send it. */
    expect(lines).toContain("untouched and still good");
    expect(lines).toContain("issues");
    expect(lines).toContain("discord.gg");
  });

  it("still words a mod fault as a mod fault", () => {
    const lines = taintNotice({ id: "qol", hook: "onMove", why: "boom" }).join(" ");
    expect(lines).toContain('The mod "qol"');
    expect(lines).toContain("onMove");
  });
});
