/**
 * Installing a mod from a repository.
 *
 * The assertions that matter here are about ORDER and REFUSAL, not about the happy
 * path: this is the one code path that takes bytes off the network and lets them run
 * as part of the game, so what it must not do is more important than what it does.
 *
 *   - nothing is stored under a mod's name until every digest has matched
 *   - the meta record is written LAST, so its presence means the install finished
 *   - a path that escapes the mod folder is refused, including one that came out of a
 *     zip rather than out of the catalogue
 */

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STORE_MODS, STORE_MOD_META } from "./idb";
import {
  DigestMismatchError,
  type FetchLike,
  type InstallEnv,
  fetchVerified,
  installRecommendedMod,
  installedModSource,
  installedMods,
  loadInstalledMods,
  sha256Hex,
  uninstallMod,
} from "./mod-install";
import { type RecommendedMod, badPath, rawUrl, validateRecommendedMod } from "./mod-registry";
import { contributedTileModes, mergeModSources } from "./tile-mods";
import { loadModCode, type ModCodeReport } from "./mod-code";
import { modPluginContext } from "./mod-context";

const subtle = webcrypto.subtle;

/* ------------------------------------------------------------------ *
 * A multi-store IndexedDB fake.
 *
 * Store-aware, unlike mod-folder.test.ts's, because that is the whole point of the
 * shared idb.ts: files and provenance live in DIFFERENT stores, and a fake that
 * ignores the store name cannot tell the two apart - so it would pass while the real
 * thing wrote a mod's bytes over its meta record.
 * ------------------------------------------------------------------ */

interface FakeReq<T> {
  result?: T;
  onsuccess?: (() => void) | null;
  onerror?: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

function fakeIdb(opts: { putFails?: boolean; openFails?: boolean } = {}): {
  factory: IDBFactory;
  stores: Map<string, Map<string, unknown>>;
} {
  const stores = new Map<string, Map<string, unknown>>();
  const storeOf = (n: string): Map<string, unknown> => {
    let s = stores.get(n);
    if (!s) {
      s = new Map();
      stores.set(n, s);
    }
    return s;
  };
  const created = new Set<string>();
  const factory = {
    open() {
      const req: FakeReq<unknown> = {};
      queueMicrotask(() => {
        if (opts.openFails) {
          req.onerror?.();
          return;
        }
        req.result = {
          objectStoreNames: { contains: (n: string) => created.has(n) },
          createObjectStore: (n: string) => {
            created.add(n);
            storeOf(n);
            return {};
          },
          transaction(name: string, _mode?: string) {
            const tx: {
              oncomplete?: (() => void) | null;
              onerror?: (() => void) | null;
              onabort?: (() => void) | null;
              objectStore(): unknown;
            } = {
              objectStore: () => ({
                get(key: string) {
                  const r: FakeReq<unknown> = {};
                  queueMicrotask(() => {
                    r.result = storeOf(name).get(key);
                    r.onsuccess?.();
                  });
                  return r;
                },
                getAllKeys() {
                  const r: FakeReq<unknown[]> = {};
                  queueMicrotask(() => {
                    r.result = [...storeOf(name).keys()];
                    r.onsuccess?.();
                  });
                  return r;
                },
                put(value: unknown, key: string) {
                  if (opts.putFails) {
                    queueMicrotask(() => tx.onerror?.());
                    return {};
                  }
                  storeOf(name).set(key, value);
                  queueMicrotask(() => tx.oncomplete?.());
                  return {};
                },
                delete(key: string) {
                  storeOf(name).delete(key);
                  queueMicrotask(() => tx.oncomplete?.());
                  return {};
                },
              }),
            };
            return tx;
          },
        };
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, stores };
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function res(bytes: Uint8Array, status = 200): FetchLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () =>
      Promise.resolve(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
  };
}

const MANIFEST = JSON.stringify({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  shape: "content",
});
const PLUGIN = "export default { api: 1, hooks: () => ({}) };";

async function envFor(
  files: Record<string, Uint8Array>,
  opts: { idb?: IDBFactory; missing?: string[] } = {},
): Promise<{ env: InstallEnv; stores: Map<string, Map<string, unknown>> }> {
  const made = fakeIdb();
  const factory = opts.idb ?? made.factory;
  return {
    stores: made.stores,
    env: {
      subtle,
      now: () => "2026-07-30T00:00:00.000Z",
      scope: { indexedDB: factory },
      fetch: (url: string) => {
        const path = decodeURIComponent(url.split("/refs/tags/")[1]?.split("/").slice(1).join("/") ?? "");
        if (opts.missing?.includes(path)) return Promise.resolve(res(enc("404: Not Found"), 404));
        const bytes = files[path];
        if (!bytes) return Promise.resolve(res(enc("404: Not Found"), 404));
        return Promise.resolve(res(bytes));
      },
    },
  };
}

async function modFor(
  files: Record<string, Uint8Array>,
  tamper: Partial<Record<string, string>> = {},
): Promise<RecommendedMod> {
  const list = [];
  for (const [path, bytes] of Object.entries(files)) {
    list.push({ path, sha256: tamper[path] ?? (await sha256Hex(bytes, subtle)) });
  }
  return {
    id: "demo",
    name: "Demo",
    repo: "neostryder/neo-angband-mod-demo",
    tag: "v1.0.0",
    summary: "A demo mod.",
    preChecked: false,
    approxBytes: 200,
    payload: { kind: "files", files: list },
  };
}

/* ------------------------------------------------------------------ *
 * Hashing.
 * ------------------------------------------------------------------ */

describe("sha256Hex", () => {
  it("matches the published digest of the empty string", async () => {
    expect(await sha256Hex(new Uint8Array(0), subtle)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the published digest of \"abc\"", async () => {
    expect(await sha256Hex(enc("abc"), subtle)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes only this view, not the whole buffer behind it", async () => {
    /* The bug this guards: a Uint8Array from an unzip is a VIEW onto one big buffer,
     * and digesting the buffer would hash the neighbouring files too. Every digest
     * would then be wrong in a way that looks like tampering. */
    const backing = enc("XXXabcXXX");
    const view = backing.subarray(3, 6);
    expect(await sha256Hex(view, subtle)).toBe(await sha256Hex(enc("abc"), subtle));
  });
});

/* ------------------------------------------------------------------ *
 * Fetching.
 * ------------------------------------------------------------------ */

describe("fetchVerified", () => {
  it("returns the bytes when the digest matches", async () => {
    const bytes = enc("hello");
    const { env } = await envFor({ "a.txt": bytes });
    const got = await fetchVerified(
      rawUrl("o/r", "v1", "a.txt"),
      await sha256Hex(bytes, subtle),
      "a.txt",
      env,
    );
    expect(new TextDecoder().decode(got)).toBe("hello");
  });

  it("refuses bytes whose digest differs, naming BOTH digests", async () => {
    const { env } = await envFor({ "a.txt": enc("hello") });
    const wrong = "0".repeat(64);
    await expect(
      fetchVerified(rawUrl("o/r", "v1", "a.txt"), wrong, "a.txt", env),
    ).rejects.toThrow(DigestMismatchError);
    /* Both values in the text: a player pasting this into a report gives the author
     * something actionable, and "the download did not match" does not. */
    await expect(
      fetchVerified(rawUrl("o/r", "v1", "a.txt"), wrong, "a.txt", env),
    ).rejects.toThrow(/expected 0{64}, got [0-9a-f]{64}/u);
  });

  it("says a 404 is a 404, so the catalogue is the suspect", async () => {
    const { env } = await envFor({}, { missing: ["gone.txt"] });
    await expect(
      fetchVerified(rawUrl("o/r", "v1", "gone.txt"), "0".repeat(64), "gone.txt", env),
    ).rejects.toThrow(/not found at this tag \(HTTP 404\)/u);
  });
});

/* ------------------------------------------------------------------ *
 * Installing.
 * ------------------------------------------------------------------ */

describe("installRecommendedMod", () => {
  it("stores every file plus a meta record", async () => {
    const files = { "manifest.json": enc(MANIFEST), "plugin.js": enc(PLUGIN) };
    const { env, stores } = await envFor(files);
    const r = await installRecommendedMod(await modFor(files), env);

    expect(r.ok).toBe(true);
    expect([...(stores.get(STORE_MODS)?.keys() ?? [])].sort()).toEqual([
      "demo/manifest.json",
      "demo/plugin.js",
    ]);
    expect(stores.get(STORE_MOD_META)?.get("demo")).toMatchObject({
      id: "demo",
      repo: "neostryder/neo-angband-mod-demo",
      tag: "v1.0.0",
      installedAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("reports progress per file", async () => {
    const files = { "manifest.json": enc(MANIFEST), "plugin.js": enc(PLUGIN) };
    const { env } = await envFor(files);
    const seen: string[] = [];
    await installRecommendedMod(await modFor(files), env, (p) =>
      seen.push(`${p.done}/${p.total} ${p.path}`),
    );
    expect(seen).toEqual(["1/2 manifest.json", "2/2 plugin.js"]);
  });

  it("stores NOTHING when one file's digest is wrong", async () => {
    const files = { "manifest.json": enc(MANIFEST), "plugin.js": enc(PLUGIN) };
    const { env, stores } = await envFor(files);
    /* The manifest is fine and would be fetched first; the plugin is tampered with.
     * A version that stored as it went would leave a mod folder holding a valid
     * manifest and no code - installed, enabled, and silently doing nothing. */
    const mod = await modFor(files, { "plugin.js": "1".repeat(64) });
    const r = await installRecommendedMod(mod, env);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problem).toMatch(/does not match the expected checksum/u);
    expect(stores.get(STORE_MODS)?.size ?? 0).toBe(0);
    expect(stores.get(STORE_MOD_META)?.size ?? 0).toBe(0);
  });

  it("refuses a download with no manifest.json", async () => {
    const files = { "plugin.js": enc(PLUGIN) };
    const { env, stores } = await envFor(files);
    const mod = await modFor(files);
    /* Bypass the catalogue check to prove the INSTALLER also refuses: the archive path
     * produces a file list the catalogue never saw. */
    const r = await installRecommendedMod(mod, env);
    expect(r.ok).toBe(false);
    expect(stores.get(STORE_MOD_META)?.size ?? 0).toBe(0);
  });

  it("reports a refused write instead of claiming success", async () => {
    const files = { "manifest.json": enc(MANIFEST) };
    const { factory } = fakeIdb({ putFails: true });
    const { env } = await envFor(files, { idb: factory });
    const r = await installRecommendedMod(await modFor(files), env);
    /* The failure this guards is the one already fixed once in the save path: a
     * reporting layer sitting on top of an IO call that returns void, so every layer
     * claims success while nothing is stored. */
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problem).toMatch(/could not be saved|out of storage/u);
  });

  it("replaces an older copy rather than merging with it", async () => {
    /* One store across both installs, which is the whole point: the second install
     * must not inherit the first's files. */
    const made = fakeIdb();

    const v1 = { "manifest.json": enc(MANIFEST), "old.json": enc("{}") };
    const { env: env1 } = await envFor(v1, { idb: made.factory });
    await installRecommendedMod(await modFor(v1), env1);
    expect(made.stores.get(STORE_MODS)?.has("demo/old.json")).toBe(true);

    const v2 = { "manifest.json": enc(MANIFEST), "new.json": enc("{}") };
    const { env: env2 } = await envFor(v2, { idb: made.factory });
    await installRecommendedMod(await modFor(v2), env2);

    /* A mod that is half v1 and half v2 is a mod whose bug reports mean nothing. */
    expect(made.stores.get(STORE_MODS)?.has("demo/old.json")).toBe(false);
    expect(made.stores.get(STORE_MODS)?.has("demo/new.json")).toBe(true);
  });
});

describe("installRecommendedMod, from an archive", () => {
  function archiveMod(zip: Uint8Array, sha: string): RecommendedMod {
    return {
      id: "demo",
      name: "Demo",
      repo: "neostryder/neo-angband-mod-demo",
      tag: "v1.0.0",
      summary: "A demo mod.",
      preChecked: false,
      approxBytes: zip.byteLength,
      payload: { kind: "archive", archives: [{ path: "pack.zip", sha256: sha }] },
    };
  }

  it("unpacks a verified archive into the mod's files", async () => {
    const zip = zipSync({
      "manifest.json": enc(MANIFEST),
      "tiles/orc.png": enc("not really a png"),
    });
    const sha = await sha256Hex(zip, subtle);
    const { env, stores } = await envFor({ "pack.zip": zip });
    const r = await installRecommendedMod(archiveMod(zip, sha), env);

    expect(r.ok).toBe(true);
    expect([...(stores.get(STORE_MODS)?.keys() ?? [])].sort()).toEqual([
      "demo/manifest.json",
      "demo/tiles/orc.png",
    ]);
  });

  it("never parses an archive whose digest is wrong", async () => {
    const zip = zipSync({ "manifest.json": enc(MANIFEST) });
    const { env, stores } = await envFor({ "pack.zip": zip });
    const r = await installRecommendedMod(archiveMod(zip, "2".repeat(64)), env);
    /* The unzip is the most hostile thing this code does to untrusted bytes, and the
     * reason the digest covers the ARCHIVE is so it never runs on unexpected bytes. */
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problem).toMatch(/does not match the expected checksum/u);
    expect(stores.get(STORE_MODS)?.size ?? 0).toBe(0);
  });

  it("refuses an entry that escapes the mod folder", async () => {
    /* Zip slip. The catalogue validated one path - "pack.zip" - so the paths inside
     * are attacker-controlled in a way the listed ones are not, and they have to be
     * checked AFTER the unzip. */
    const zip = zipSync({
      "manifest.json": enc(MANIFEST),
      "../../saves/stolen.json": enc("{}"),
    });
    const sha = await sha256Hex(zip, subtle);
    const { env, stores } = await envFor({ "pack.zip": zip });
    const r = await installRecommendedMod(archiveMod(zip, sha), env);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problem).toMatch(/escapes the mod folder/u);
    expect(stores.get(STORE_MODS)?.size ?? 0).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Reading them back.
 * ------------------------------------------------------------------ */

describe("installed mods, read back", () => {
  let scope: { indexedDB: IDBFactory };

  beforeEach(() => {
    scope = { indexedDB: fakeIdb().factory };
  });

  it("round-trips through readModDir as a usable pack", async () => {
    const files = { "manifest.json": enc(MANIFEST), "plugin.js": enc(PLUGIN) };
    const made = fakeIdb();
    const { env } = await envFor(files, { idb: made.factory });
    await installRecommendedMod(await modFor(files), env);

    const report = await loadInstalledMods({ indexedDB: made.factory });
    expect(report.available).toBe(true);
    expect(report.kind).toBe("installed");
    expect(report.packs.map((p) => p.manifest.id)).toEqual(["demo"]);
    /* No path, because nobody put these anywhere - see installedModSource. */
    expect(report.dir).toBeNull();
    expect(report.problems).toEqual([]);
  });

  it("is 'no directory' when nothing is installed", async () => {
    const report = await loadInstalledMods(scope);
    expect(report.available).toBe(false);
    expect(report.kind).toBe("none");
  });

  it("lists provenance sorted by id", async () => {
    const made = fakeIdb();
    for (const id of ["zed", "alpha"]) {
      const files = {
        "manifest.json": enc(
          JSON.stringify({ id, name: id, version: "1.0.0", shape: "content" }),
        ),
      };
      const { env } = await envFor(files, { idb: made.factory });
      await installRecommendedMod({ ...(await modFor(files)), id }, env);
    }
    expect((await installedMods({ indexedDB: made.factory })).map((m) => m.id)).toEqual([
      "alpha",
      "zed",
    ]);
  });

  it("uninstalling removes both the record and the files", async () => {
    const files = { "manifest.json": enc(MANIFEST), "plugin.js": enc(PLUGIN) };
    const made = fakeIdb();
    const { env } = await envFor(files, { idb: made.factory });
    await installRecommendedMod(await modFor(files), env);

    expect(await uninstallMod("demo", { indexedDB: made.factory })).toBe(true);
    expect(await installedMods({ indexedDB: made.factory })).toEqual([]);
    expect(made.stores.get(STORE_MODS)?.size ?? 0).toBe(0);
  });

  it("sorts a mod's paths into records, code and assets", async () => {
    const source = installedModSource(
      [
        {
          id: "demo",
          repo: "o/r",
          tag: "v1",
          files: [
            "manifest.json",
            "monster.json",
            "plugin.js",
            "lib/dice.mjs",
            "tiles/orc.png",
            "data/spawns.json",
          ],
          installedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      () => Promise.resolve(null),
    );
    const [entry] = await source.list();
    expect(entry?.files).toEqual(["manifest.json", "monster.json"]);
    expect(entry?.code).toEqual(["plugin.js", "lib/dice.mjs"]);
    /* Nested JSON is an asset, not a record contribution: a pack names what it
     * contributes by the top-level filename and there is no rule for a nested one. */
    expect(entry?.assets).toEqual(["tiles/orc.png", "data/spawns.json"]);
  });

  it("ignores a load-order.json the mod author shipped", async () => {
    const source = installedModSource([], () => Promise.resolve(null));
    /* The author's file has no business ordering the PLAYER's other mods. */
    expect(await source.order()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The catalogue's own rules.
 * ------------------------------------------------------------------ */

describe("rawUrl", () => {
  it("spells out refs/tags so a same-named branch cannot win", async () => {
    expect(rawUrl("neostryder/neo-angband-mod-qol", "v1.0.0", "manifest.json")).toBe(
      "https://raw.githubusercontent.com/neostryder/neo-angband-mod-qol/refs/tags/v1.0.0/manifest.json",
    );
  });

  it("encodes each segment but keeps the separators", () => {
    expect(rawUrl("o/r", "v1", "tiles/dark elf.png")).toContain("tiles/dark%20elf.png");
  });
});

describe("badPath", () => {
  it("accepts ordinary pack-relative paths", () => {
    for (const p of ["manifest.json", "lib/dice.js", "tiles/orc.png"]) {
      expect(badPath(p)).toBeNull();
    }
  });

  it("refuses anything that leaves the mod folder", () => {
    for (const p of ["../x", "a/../../b", "/etc/passwd", "C:/x", "a\\b", "./x"]) {
      expect(badPath(p)).not.toBeNull();
    }
  });
});

describe("validateRecommendedMod", () => {
  const base: RecommendedMod = {
    id: "qol",
    name: "Quality of Life",
    repo: "neostryder/neo-angband-mod-qol",
    tag: "v1.0.0",
    summary: "s",
    preChecked: true,
    approxBytes: 1,
    payload: {
      kind: "files",
      files: [{ path: "manifest.json", sha256: "a".repeat(64) }],
    },
  };

  it("accepts a well-formed entry", () => {
    expect(validateRecommendedMod(base)).toBeNull();
  });

  it("refuses a ref path, which is how a branch sneaks in", () => {
    /* A branch resolves over HTTP exactly like a tag, and makes the pinned digest a
     * lie the moment anything is pushed. */
    expect(validateRecommendedMod({ ...base, tag: "refs/heads/master" })).toMatch(
      /looks like a ref path/u,
    );
  });

  it("refuses a digest that is not 64 lower-case hex characters", () => {
    for (const sha of ["A".repeat(64), "a".repeat(63), "", "z".repeat(64)]) {
      const bad = validateRecommendedMod({
        ...base,
        payload: { kind: "files", files: [{ path: "manifest.json", sha256: sha }] },
      });
      expect(bad).toMatch(/is not a lower-case hex SHA-256/u);
    }
  });

  it("refuses a file list with no manifest.json", () => {
    expect(
      validateRecommendedMod({
        ...base,
        payload: {
          kind: "files",
          files: [{ path: "plugin.js", sha256: "a".repeat(64) }],
        },
      }),
    ).toMatch(/no manifest\.json/u);
  });
});

/* ------------------------------------------------------------------ *
 * The whole chain, for a TILES mod.
 *
 * Every link below is covered on its own elsewhere; this is the one test that runs
 * them in a row, because that is where the bug was. A mod installed from a repository
 * used to be listed, enableable and INERT: tile discovery consulted only the
 * build-time bundle glob, and even had it not, `tilePacks[].path` was a site-root URL
 * base - a form an installed mod cannot produce, since its bytes live in IndexedDB
 * and have no path at all (MOD_REACH gap 8).
 *
 * So: install an archive, read it back, and follow the row all the way to the URL an
 * <img> would be given. Nothing here mocks the resolver.
 * ------------------------------------------------------------------ */

describe("an installed TILES mod registers a Graphics row and draws its own art", () => {
  const TILES_MANIFEST = JSON.stringify({
    id: "demo",
    name: "Demo Tiles",
    version: "1.0.0",
    shape: "tiles",
    tilePacks: [
      {
        grafID: 101,
        engine: "linoleum",
        menuname: "Demo Set (Linoleum)",
        path: "my-set",
      },
    ],
  });

  /** A one-pixel PNG, so the asset is real bytes rather than a string. */
  const PNG = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52,
  ]);

  /** Blob URLs, which node has no implementation of. Recorded so the type is checked. */
  function stubObjectUrls(): { made: Array<{ url: string; type: string }> } {
    const made: Array<{ url: string; type: string }> = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      const url = `blob:neo/${made.length + 1}`;
      made.push({ url, type: blob.type });
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    afterEach(() => {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    });
    return { made };
  }

  it("reaches the pack's files through the installed mod's own bytes", async () => {
    const urls = stubObjectUrls();
    const zip = zipSync({
      "manifest.json": enc(TILES_MANIFEST),
      "my-set/manifest.txt": enc("pack:demo:Demo Set\nformat:png\nresolution:8\n"),
      "my-set/images/8/feat_floor_lit_0.png": PNG,
    });
    const sha = await sha256Hex(zip, subtle);
    const made = fakeIdb();
    const { env } = await envFor({ "pack.zip": zip }, { idb: made.factory });
    const installed = await installRecommendedMod(
      {
        id: "demo",
        name: "Demo Tiles",
        repo: "neostryder/neo-angband-mod-demo",
        tag: "v1.0.0",
        summary: "A demo tiles mod.",
        preChecked: false,
        approxBytes: zip.byteLength,
        payload: { kind: "archive", archives: [{ path: "pack.zip", sha256: sha }] },
      },
      env,
    );
    expect(installed.ok).toBe(true);

    // Read back exactly as boot does.
    const report = await loadInstalledMods({ indexedDB: made.factory });
    expect(report.kind).toBe("installed");
    expect(report.assetUrl).not.toBeNull();

    // Discovery must see it even though it is in NO bundle glob.
    const merged = mergeModSources({ bundled: new Map(), disk: report });
    const modes = contributedTileModes({ ...merged, enabledIds: ["demo"] });
    expect(modes).toHaveLength(1);
    expect(modes[0]?.menuname).toBe("Demo Set (Linoleum)");
    expect(modes[0]?.grafID).toBe(101);

    // And the row's resolver must reach the mod's stored bytes, by PACK-relative
    // path - `my-set/` comes from the manifest, not from anything the caller knows.
    const manifestUrl = await modes[0]?.resolve?.("manifest.txt");
    const tileUrl = await modes[0]?.resolve?.("images/8/feat_floor_lit_0.png");
    expect(manifestUrl).toMatch(/^blob:neo\//u);
    expect(tileUrl).toMatch(/^blob:neo\//u);
    expect(manifestUrl).not.toBe(tileUrl);
    // The PNG must be typed, or an <img> refuses the blob outright.
    expect(urls.made.find((u) => u.url === tileUrl)?.type).toBe("image/png");
    expect(urls.made.find((u) => u.url === manifestUrl)?.type).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("has no resolver for a file the mod did not install", async () => {
    stubObjectUrls();
    const zip = zipSync({ "manifest.json": enc(TILES_MANIFEST) });
    const sha = await sha256Hex(zip, subtle);
    const made = fakeIdb();
    const { env } = await envFor({ "pack.zip": zip }, { idb: made.factory });
    await installRecommendedMod(
      {
        id: "demo",
        name: "Demo Tiles",
        repo: "neostryder/neo-angband-mod-demo",
        tag: "v1.0.0",
        summary: "A demo tiles mod.",
        preChecked: false,
        approxBytes: zip.byteLength,
        payload: { kind: "archive", archives: [{ path: "pack.zip", sha256: sha }] },
      },
      env,
    );
    const report = await loadInstalledMods({ indexedDB: made.factory });
    const merged = mergeModSources({ bundled: new Map(), disk: report });
    const modes = contributedTileModes({ ...merged, enabledIds: ["demo"] });
    // The row still exists - the manifest declared it - and the pack simply does not
    // load, which leaves the map ASCII exactly as a missing tilesheet does.
    expect(modes).toHaveLength(1);
    expect(await modes[0]?.resolve?.("manifest.txt")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The call site.
 *
 * This whole module was reachable and unreached: loadInstalledMods had NO production
 * caller, so a mod could be fetched, hashed, verified and stored, and then take part
 * in nothing. Reading the code could not show that - the function exists, is exported,
 * is tested - which is precisely why the absence needs a test of its own. Source-level,
 * because main.ts boots a real game at module scope and cannot be imported here.
 * ------------------------------------------------------------------ */

describe("boot reads installed mods", () => {
  const main = readFileSync(join(import.meta.dirname, "main.ts"), "utf8");

  it("calls loadInstalledMods at boot", () => {
    expect(main).toContain("loadInstalledMods");
    expect(main).toMatch(/await loadInstalledMods\(\)/u);
  });

  it("COMBINES it with the folder rather than choosing between them", () => {
    // Choosing is right between the shell's folder and a picked one - two answers to
    // one question. Installed mods are not an alternative to having a folder, and the
    // bug this guards is the shape `shellPacks.available ? shell : picked` had: one
    // winner, and no third seat at all.
    expect(main).toMatch(/combineDiskReports\(\[folder, await loadInstalledMods\(\)\]\)/u);
    expect(main).toMatch(/setDiskPacks\(combineDiskReports\(/u);
  });

  it("lists the folder FIRST, so a mod put there deliberately outranks a download", () => {
    const at = main.indexOf("combineDiskReports([folder,");
    expect(at, "the combine call must be present").toBeGreaterThan(0);
  });
});

describe("an INSTALLED mod's plugin.js actually runs", () => {
  /**
   * The gap this closes, and it is the one that matters most for the de-bundling.
   *
   * Every test above proves an installed mod is stored, verified and read back as a
   * usable pack. None of them proved its CODE runs. Those are different pieces of
   * machinery: reading a pack goes through `readModDir`, while running its plugin goes
   * through `installedModSource.codeUrl` -> `buildModuleGraph` -> blob URLs ->
   * `loadModCode` -> `validateModPlugin`. The game now bundles NO mods, so this chain is
   * how every mod anybody has arrives at being executed. Before this, it had never been
   * driven end to end from a real install.
   *
   * ONE THING IS FAKED, and only one: `URL.createObjectURL`, which node does not have.
   * It hands back a `data:` URL over the same bytes, so the module a real browser would
   * fetch from a blob is the module imported here. The alternative - asserting that the
   * blob was created - would be a test of the mock.
   */
  const RUNNING_PLUGIN = [
    "export default {",
    "  api: 1,",
    "  hooks(ctx) {",
    "    if (ctx.flags['demo.on'] !== true) return null;",
    "    return { messageText: (raw) => raw + ' [ran from an installed mod]' };",
    "  },",
    "};",
  ].join("\n");

  /**
   * The two browser primitives node lacks, and nothing else.
   *
   * `URL.createObjectURL` has to be SYNCHRONOUS (production calls it inside
   * `urlFor`), and a real Blob only yields its bytes asynchronously - so the Blob is
   * stubbed too, purely to keep the parts it was constructed with reachable. What
   * comes back is a `data:` URL over exactly those bytes, which means the module a
   * browser would fetch from a blob: URL is the module imported here. Asserting that a
   * blob was created instead would be a test of the stub.
   */
  let realCreate: unknown;
  let realRevoke: unknown;
  let realBlob: unknown;

  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    realCreate = (URL as unknown as Record<string, unknown>)["createObjectURL"];
    realRevoke = (URL as unknown as Record<string, unknown>)["revokeObjectURL"];
    realBlob = g["Blob"];
    g["Blob"] = class FakeBlob {
      readonly body: string;
      readonly type: string;
      constructor(parts: unknown[], opts?: { type?: string }) {
        this.body = parts.map((p) => String(p)).join("");
        this.type = opts?.type ?? "";
      }
    };
    (URL as unknown as Record<string, unknown>)["createObjectURL"] = (blob: {
      body?: string;
    }): string =>
      `data:text/javascript;base64,${Buffer.from(blob.body ?? "", "utf8").toString("base64")}`;
    (URL as unknown as Record<string, unknown>)["revokeObjectURL"] = (): void => {};
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    (URL as unknown as Record<string, unknown>)["createObjectURL"] = realCreate;
    (URL as unknown as Record<string, unknown>)["revokeObjectURL"] = realRevoke;
    g["Blob"] = realBlob;
  });

  /**
   * A manifest that DECLARES it ships code.
   *
   * Not the shared MANIFEST, and the first attempt at this test used it and failed -
   * usefully. `loadModCode` refuses a pack that ships plugin.js without the "plugin"
   * facet: "add \"facets\": [\"content\", \"plugin\"], so that running code is something
   * the mod states". That gate is exactly what should stop a downloaded mod from
   * executing code it never admitted to carrying, and seeing it fire here is the
   * evidence it is not decorative. Both real first-party mods declare the facet.
   */
  const CODE_MANIFEST = JSON.stringify({
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    shape: "content",
    facets: ["content", "plugin"],
    modApi: 1,
  });

  /** Install a mod carrying `code`, then load its plugin the way boot does. */
  async function installAndLoad(code: string): Promise<ModCodeReport> {
    const files = { "manifest.json": enc(CODE_MANIFEST), "plugin.js": enc(code) };
    const made = fakeIdb();
    const { env } = await envFor(files, { idb: made.factory });
    const result = await installRecommendedMod(await modFor(files), env);
    expect(result.ok, result.ok ? "" : result.problem).toBe(true);

    const report = await loadInstalledMods({ indexedDB: made.factory });
    expect(report.problems).toEqual([]);
    expect(report.packs).toHaveLength(1);

    return await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl!,
      enabled: () => true,
      consented: () => [],
      importer: (url) => import(url),
    });
  }

  it("loads, validates and RUNS the plugin the installer stored", async () => {
    const report = await installAndLoad(RUNNING_PLUGIN);
    expect(report.problems).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.plugins).toHaveLength(1);

    const hooks = report.plugins[0]!.plugin.hooks!(modPluginContext("demo", { "demo.on": true }));
    /* Calling the hook, not inspecting its shape: a hook that is present and throws
     * would satisfy every assertion above. */
    expect(hooks!.messageText!("you feel a sense of loss")).toBe(
      "you feel a sense of loss [ran from an installed mod]",
    );
  });

  it("contributes nothing when its patch is off, exactly as a bundled mod would", async () => {
    const report = await installAndLoad(RUNNING_PLUGIN);
    expect(report.plugins[0]!.plugin.hooks!(modPluginContext("demo", {}))).toBeNull();
  });

  it("reports a stored plugin that is not a valid plugin, rather than loading it", async () => {
    /* Guards the guard. If the chain above silently accepted anything, the passing test
     * would prove only that no exception escaped. */
    const report = await installAndLoad("export const notADefault = 1;");
    expect(report.plugins).toEqual([]);
    expect(report.problems.length + report.skipped.length).toBeGreaterThan(0);
  });
});
