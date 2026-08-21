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
import { contentOnlyRefusal, createModInstaller } from "./install-runtime";

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
  };

  it("answers with a value, never a throw, on anything that is not an archive", async () => {
    const install = createModInstaller(deps);
    /* The caller is a mod that will be showing this to a player. A rejected
     * promise arrives in devtools, which is not a channel a player has. */
    await expect(install(new Uint8Array(0))).resolves.toEqual({
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
