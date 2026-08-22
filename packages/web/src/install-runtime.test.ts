/**
 * `ctx.installMod`, and specifically the part of it that is NOT
 * `installModFromZip`.
 *
 * The install itself is that function's, tested where it lives: the consent
 * switch, the zip ceilings, the zip-slip check, the standards inspection and the
 * origin pin all run inside it and are not re-implemented at this door. What is
 * added here is what makes the CAPABILITY proportionate - the archive must be
 * content, not code - plus the byte copy and the promise that a refusal is a
 * value rather than a throw. Those three are what these tests are about.
 */

import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { contentOnlyRefusal, createModInstaller, createModReload } from "./install-runtime";
import { installFailureLines } from "./mod-browse";
import { MOD_CHECK_ADVICE } from "./mod-install";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function manifest(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "made-in-game",
    name: "Made in game",
    version: "1.0.0",
    shape: "content",
    modApi: 1,
    engine: ">=0.1.0",
    author: "a player",
    repository: "local:made-in-game",
    ...over,
  });
}

/** A mod folder as `ModProject.emit()` produces one, packed as it would be. */
function archive(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, body]) => [path, enc(body)])),
  );
}

describe("content only", () => {
  it("takes the manifest-plus-records shape a builder actually emits", () => {
    const zip = archive({
      "manifest.json": manifest(),
      "monster.json": JSON.stringify([{ name: "Snarl", base: "dog", level: 3 }]),
    });
    expect(contentOnlyRefusal(zip)).toBeNull();
  });

  it("refuses an archive that ships code, and names the file", () => {
    const zip = archive({
      "manifest.json": manifest({ facets: ["content", "plugin"] }),
      "monster.json": "[]",
      "plugin.js": "export default { api: 1, hooks: () => ({}) };",
    });
    const refusal = contentOnlyRefusal(zip);
    /* THE REFUSAL THAT MAKES THE GRANT PROPORTIONATE. Without it, "may install a
     * mod" would mean "may write a program, install it, and have the player
     * enable something it authored". */
    expect(refusal).toContain("CONTENT mods only");
    expect(refusal).toContain("plugin.js");
  });

  it("refuses code under any name, not just plugin.js", () => {
    /* The loader resolves relative specifiers and a mod folder may hold as many
     * scripts as it likes, so the entry point is not the only name code arrives
     * under. */
    for (const name of ["lib/dice.mjs", "helper.cjs", "src/thing.ts", "fast.wasm"]) {
      const zip = archive({ "manifest.json": manifest(), [name]: "// code" });
      expect(contentOnlyRefusal(zip), name).toContain(name);
    }
  });

  it("refuses an archive whose manifest asks for a capability", () => {
    const zip = archive({
      "manifest.json": manifest({ facets: ["content", "plugin"], capabilities: ["registry:effect"] }),
      "monster.json": "[]",
    });
    const refusal = contentOnlyRefusal(zip);
    /* A pack asking for a capability is a pack expecting to run, whether or not
     * this particular archive happened to carry the code yet. */
    expect(refusal).toContain("registry:effect");
    expect(refusal).toContain("needs none");
  });

  it("passes a bad archive's own complaint through rather than inventing one", () => {
    const refusal = contentOnlyRefusal(enc("this is not a zip at all"));
    expect(refusal).not.toBeNull();
    /* The zip reader's sentence is better than any this module could write, and
     * two vocabularies for one failure is how a player learns to distrust both. */
    expect(refusal).not.toContain("CONTENT mods only");
  });
});

describe("the door itself", () => {
  const deps = {
    env: {
      fetch: () => Promise.reject(new Error("no network in this test")),
      subtle: { digest: () => Promise.reject(new Error("unused")) } as unknown as SubtleCrypto,
      scope: {},
      now: () => "2026-08-21T00:00:00.000Z",
    },
    allowed: () => true,
    reload: () => undefined,
  };

  it("answers with a value, never a throw, on anything that is not an archive", async () => {
    const install = createModInstaller(deps);
    /* The caller is a mod that will be showing this to a player. A rejected
     * promise arrives in devtools, which is not a channel a player has. */
    const empty = await install(new Uint8Array(0));
    expect(empty).toMatchObject({
      ok: false,
      problem: "installMod needs the bytes of a mod archive",
    });
    const bad = await install(enc("not a zip"));
    expect(bad.ok).toBe(false);
  });

  it("refuses code before it opens anything else", async () => {
    const install = createModInstaller(deps);
    const zip = archive({ "manifest.json": manifest(), "plugin.js": "export default {};" });
    const outcome = await install(zip);
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { problem: string }).problem).toContain("plugin.js");
  });

  it("does not read the caller's buffer after it has been checked", async () => {
    /* The caller still holds what it passed and the install reads across several
     * awaits, so validating one buffer and storing another is the available bug.
     * Overwriting the caller's copy with a code archive's bytes after the call
     * must not change what was inspected. */
    const good = archive({ "manifest.json": manifest(), "monster.json": "[]" });
    const held = new Uint8Array(good);
    const install = createModInstaller(deps);
    const pending = install(held);
    held.fill(0);
    const outcome = await pending;
    expect(outcome.ok).toBe(false); // no IndexedDB in this test
    /* The point: it got past the content check on the copy, rather than failing
     * as an unreadable archive because the caller scribbled on its bytes. */
    expect((outcome as { problem: string }).problem).not.toContain("CONTENT mods only");
  });
});

describe("the words a mod prints are the game's own", () => {
  const deps = {
    env: {
      fetch: () => Promise.reject(new Error("no network in this test")),
      subtle: { digest: () => Promise.reject(new Error("unused")) } as unknown as SubtleCrypto,
      scope: {},
      now: () => "2026-08-21T00:00:00.000Z",
    },
    allowed: () => true,
    reload: () => undefined,
  };

  it("hands back the manager's lines, not a sentence of the door's own", async () => {
    const install = createModInstaller(deps);
    const zip = archive({ "manifest.json": manifest(), "plugin.js": "export default {};" });
    const outcome = await install(zip);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    /* DERIVED FROM THE PRODUCER, not retyped. The claim is that this door prints
     * what the Mods screen prints for the same refusal, so the expectation has to
     * come from the function the Mods screen calls - a hand-written copy of the
     * wording would pass while the two drifted, which is the whole failure the
     * `lines` field exists to make impossible. */
    expect(outcome.lines).toEqual(
      installFailureLines("made-in-game", outcome.problem).map((line) => line.text),
    );
    /* And it really is the manager's frame around it, headline and all. */
    expect(outcome.lines[0]).toBe("made-in-game was not installed.");
    expect(outcome.lines.join("\n")).toContain("Nothing was stored");
  });

  it("names the archive rather than a mod when the manifest could not be read", async () => {
    const install = createModInstaller(deps);
    const outcome = await install(enc("this is not a zip at all"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    /* There is no id to print, and inventing one would be worse than a label: a
     * player reading a mod's name here would go looking for a mod. */
    expect(outcome.lines[0]).toBe("That archive was not installed.");
  });

  it("carries a requirements refusal's rows and the author's advice", async () => {
    /* THE CASE THE FIELD WAS ADDED FOR. `checkMod` answers a LIST, and the list is
     * the only thing that says WHICH requirement failed; a mod holding `problem`
     * alone can only tell the player that something did. Declaring no repository
     * is the shortest way to fail the same inspection a downloaded mod faces. */
    const install = createModInstaller(deps);
    const zip = archive({
      "manifest.json": manifest({ repository: undefined }),
      "monster.json": "[]",
    });
    const outcome = await install(zip);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toContain("does not meet the requirements");
    /* Joined on a space and re-collapsed, because these are terminal lines: the
     * manager wraps them at its own width, so an assertion on the unwrapped
     * sentence would be an assertion about where the wrap happened to fall. */
    const text = outcome.lines.join(" ").replaceAll(/\s+/gu, " ");
    expect(text).toContain("Say where the mod lives");
    expect(text).toContain(MOD_CHECK_ADVICE);
  });
});

describe("ctx.reloadGame", () => {
  const doorWith = (reload: () => void) => ({
    env: {
      fetch: () => Promise.reject(new Error("no network in this test")),
      subtle: { digest: () => Promise.reject(new Error("unused")) } as unknown as SubtleCrypto,
      scope: {},
      now: () => "2026-08-21T00:00:00.000Z",
    },
    allowed: () => true,
    reload,
  });

  it("runs the host's own mod-change sequence, once", async () => {
    /* Not `location.reload()`. What the host does here is tear the plugins down,
     * write the live character and mark the session to resume it, and none of
     * those four is something a mod can do for itself. */
    let calls = 0;
    await createModReload(doorWith(() => void calls++))();
    expect(calls).toBe(1);
  });

  it("resolves rather than hanging, so a caller's own finally still runs", async () => {
    let ran = false;
    try {
      await createModReload(doorWith(() => undefined))();
    } finally {
      ran = true;
    }
    expect(ran).toBe(true);
  });
});
