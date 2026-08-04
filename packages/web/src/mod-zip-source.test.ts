/**
 * Where an imported mod's bytes come from, and what the game may do with the file after.
 *
 * Driven through `zipImportDeps` with a fake scope rather than against its private
 * helpers, because the thing that has actually been wrong before is the WIRING - a
 * feature detected off the wrong global, a listing parsed from a shape the host never
 * sends. A test of the parser alone would pass with the bridge unread.
 */

import { describe, expect, it, vi } from "vitest";

import { zipImportDeps } from "./mod-zip-source";
import type { InstallEnv } from "./mod-install";

const env = {
  fetch: () => Promise.reject(new Error("not used")),
  subtle: { digest: () => Promise.reject(new Error("not used")) },
  now: () => "2026-08-03T00:00:00.000Z",
} as unknown as InstallEnv;

/** A scope shaped like the desktop preload's, with whatever this test needs on it. */
function desktopScope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    neoDesktop: {
      modsIndexUrl: "/mods/index.json",
      modsBaseUrl: "/mods",
      dataDir: "C:/game/neo-angband-data",
      discardModZip: () => Promise.resolve({ ok: true }),
      ...over,
    },
    fetch: () => Promise.resolve({ ok: false, status: 404 }),
  };
}

function jsonScope(body: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  const scope = desktopScope(over);
  scope["fetch"] = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  return scope;
}

describe("a browser tab has no mods folder, and says so by having no folder", () => {
  const web = zipImportDeps(env, () => true, { fetch: () => Promise.reject(new Error("x")) });

  it("offers no waiting archives", async () => {
    expect(await web.waiting()).toEqual([]);
  });

  it("cannot read one by name", async () => {
    expect(await web.read("anything.zip")).toBeNull();
  });

  it("reports discard as NULL, not as a discard that fails", async () => {
    /* The distinction is the whole point: null means "this platform never could",
     * which the screen prints as "your copy is still where you left it". A function
     * returning false would print "it could not be removed", which reads as a fault. */
    expect(web.discard).toBeNull();
  });

  it("names no folder", () => {
    expect(web.folder()).toBeNull();
  });
});

describe("the desktop mods folder, read off the index the shell already serves", () => {
  it("lists the archives waiting in it", async () => {
    const deps = zipImportDeps(env, () => true, jsonScope({ packs: [], zips: [{ name: "a.zip", bytes: 120 }] }));
    expect(await deps.waiting()).toEqual([{ name: "a.zip", bytes: 120 }]);
  });

  it("survives an index from a shell too old to have zips at all", async () => {
    /* The field is new. An older shell serves an index without it, and the honest
     * reading of a missing list is "none", not a crash on the mods screen. */
    const deps = zipImportDeps(env, () => true, jsonScope({ packs: [], order: [], dir: "x" }));
    expect(await deps.waiting()).toEqual([]);
  });

  it("drops rows that are not archives rather than showing a nameless one", async () => {
    const deps = zipImportDeps(env, () => true, jsonScope({ zips: [{ bytes: 1 }, null, "a.zip", { name: "" }, { name: "b.zip" }] }));
    expect(await deps.waiting()).toEqual([{ name: "b.zip", bytes: 0 }]);
  });

  it("shows nothing rather than an error when the index cannot be read", async () => {
    const deps = zipImportDeps(env, () => true, desktopScope());
    expect(await deps.waiting()).toEqual([]);
  });

  it("names the folder a player can drop a zip into", () => {
    expect(zipImportDeps(env, () => true, desktopScope()).folder()).toBe(
      "C:/game/neo-angband-data/mods",
    );
  });

  it("encodes the name it asks the route for", async () => {
    const seen: string[] = [];
    const scope = desktopScope();
    scope["fetch"] = (url: string) => {
      seen.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer),
      });
    };
    const deps = zipImportDeps(env, () => true, scope);
    expect(await deps.read("my mod #2.zip")).toEqual(new Uint8Array([1, 2]));
    /* A raw `#` would truncate the request at the fragment and fetch the folder. */
    expect(seen).toEqual(["/mods/my%20mod%20%232.zip"]);
  });

  it("answers null for an archive that has gone since the list was made", async () => {
    const deps = zipImportDeps(env, () => true, desktopScope());
    expect(await deps.read("gone.zip")).toBeNull();
  });
});

describe("discarding the archive is reported, never assumed", () => {
  it("passes the leaf name through and reports success", async () => {
    const discardModZip = vi.fn(() => Promise.resolve({ ok: true }));
    const deps = zipImportDeps(env, () => true, desktopScope({ discardModZip }));
    expect(await deps.discard?.("a.zip")).toEqual({ ok: true });
    expect(discardModZip).toHaveBeenCalledWith("a.zip");
  });

  it("carries the shell's reason back, because the screen has to print it", async () => {
    const deps = zipImportDeps(env, () => true, desktopScope({
      discardModZip: () => Promise.resolve({ ok: false, error: "EBUSY" }),
    }));
    expect(await deps.discard?.("a.zip")).toEqual({ ok: false, error: "EBUSY" });
  });

  it("treats a thrown bridge as a failed discard, not as a failed install", async () => {
    const deps = zipImportDeps(env, () => true, desktopScope({
      discardModZip: () => Promise.reject(new Error("the channel is gone")),
    }));
    expect(await deps.discard?.("a.zip")).toEqual({ ok: false, error: "the channel is gone" });
  });

  it("treats an answer that is not an answer as a failure", async () => {
    const deps = zipImportDeps(env, () => true, desktopScope({
      discardModZip: () => Promise.resolve(undefined),
    }));
    expect((await deps.discard?.("a.zip"))?.ok).toBe(false);
  });
});
