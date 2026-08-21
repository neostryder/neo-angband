/**
 * Mods loaded for this session only.
 *
 * WHAT IS WORTH ASSERTING HERE, and it is not "a mod can be staged". The staging
 * call is a thin arrangement of functions that are tested where they live -
 * `readModZip`'s ceilings, `archiveFaults`' standards inspection, the origin pin.
 * What only this file can pin down is the set of claims the FEATURE makes, each of
 * which is a thing a player was told:
 *
 *   - the archive survives a reload and nothing else does: the record round-trips
 *     through session storage and produces a real pack, and NOTHING lands in the
 *     persistent stores;
 *   - a grant made for one session does not become a standing grant;
 *   - a staged mod is on whatever else says, including over a stored "off" and over
 *     a `?mods=` override, because staging is the gesture and there is no row;
 *   - a staged copy of an installed id shadows it rather than losing to it, and the
 *     collision is reported;
 *   - the mod-facing door refuses code and the player's door does not, which is the
 *     one asymmetry the whole design rests on;
 *   - and a session mod cannot be quietly resident: it is in the list, marked, and
 *     droppable.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  dropSessionMods,
  loadSessionMods,
  MAX_SESSION_ARCHIVE_BYTES,
  previewSessionArchive,
  SESSION_MODS_KEY,
  sessionMods,
  sessionSurvivesReload,
  stageSessionMod,
  type SessionStorageLike,
} from "./mod-session";
import {
  resetDiskPacks,
  sessionPacks,
  diskPacks,
  setDiskPacks,
  NO_DISK_PACKS,
  type DiskPack,
  type DiskPackReport,
} from "./disk-packs";
import { buildCatalog, resolveEnabledIds } from "./mod-store";
import { createModSessionLoader } from "./install-runtime";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function manifest(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "draft",
    name: "A draft",
    version: "0.1.0",
    shape: "content",
    modApi: 1,
    engine: ">=0.1.0",
    author: "a player",
    /* A REAL repository URL, because `archiveFaults` runs the same standards
     * inspection the install door runs and `declare-a-repository` refuses anything
     * else. That refusal reaching this door is the property under test in its own
     * right: a session load must not accept an archive the install would turn
     * away. */
    repository: "https://github.com/a-player/draft",
    ...over,
  });
}

function archive(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, body]) => [path, enc(body)])),
  );
}

const CONTENT = (): Uint8Array =>
  archive({
    "manifest.json": manifest(),
    "monster.json": JSON.stringify([{ name: "Snarl", base: "dog", level: 3 }]),
  });

const WITH_CODE = (): Uint8Array =>
  archive({
    "manifest.json": manifest({
      facets: ["content", "plugin"],
      shape: "plugin",
      capabilities: ["command:add"],
    }),
    "monster.json": "[]",
    "plugin.js": "export default { api: 1, hooks: () => ({}) };",
  });

/** A session store of its own, so one test cannot see another's staging. */
function store(): SessionStorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A scope with a session store and nothing else - no IndexedDB, no localStorage. */
function scopeWith(s: SessionStorageLike): unknown {
  return { sessionStorage: s, crypto: globalThis.crypto };
}

describe("staging an archive", () => {
  it("holds a content pack and can read it back", async () => {
    const s = store();
    const staged = await stageSessionMod(
      { bytes: CONTENT(), source: "draft.zip", allowed: true },
      scopeWith(s),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.mod.id).toBe("draft");
    expect(staged.code).toBe(false);
    /* Under ONE key, so the whole session tier is one thing to drop and one thing
     * to size against the quota. */
    expect([...s.map.keys()]).toEqual([SESSION_MODS_KEY]);
    expect(sessionMods(scopeWith(s)).map((m) => m.id)).toEqual(["draft"]);
  });

  it("measures a digest, so a screen can name which bytes it is about to run", async () => {
    const s = store();
    const first = await stageSessionMod(
      { bytes: CONTENT(), source: "draft.zip", allowed: true },
      scopeWith(s),
    );
    const second = await stageSessionMod(
      {
        bytes: archive({ "manifest.json": manifest(), "monster.json": "[]" }),
        source: "draft.zip",
        allowed: true,
      },
      scopeWith(s),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.mod.digest).not.toBe("");
    /* Two drafts of the same mod are different bytes, so a confirmation that
     * remembered the last digest can tell that it is being asked again. */
    expect(first.mod.digest).not.toBe(second.mod.digest);
  });

  it("re-staging the same id replaces it rather than listing it twice", async () => {
    const s = store();
    await stageSessionMod({ bytes: CONTENT(), source: "a.zip", allowed: true }, scopeWith(s));
    await stageSessionMod({ bytes: CONTENT(), source: "b.zip", allowed: true }, scopeWith(s));
    const held = sessionMods(scopeWith(s));
    expect(held).toHaveLength(1);
    expect(held[0]?.source).toBe("b.zip");
  });

  it("refuses when the third-party switch is off, before opening the archive", async () => {
    const s = store();
    const staged = await stageSessionMod(
      { bytes: CONTENT(), source: "draft.zip", allowed: false },
      scopeWith(s),
    );
    expect(staged.ok).toBe(false);
    expect(sessionMods(scopeWith(s))).toEqual([]);
  });

  it("refuses an archive too big to hold for a session, and says the size", async () => {
    const s = store();
    /* INCOMPRESSIBLE, and that is not incidental. A repeated character shrinks to
     * nothing in a zip - the first version of this test built a 3 MB payload and
     * measured a 3 KB archive, which would have made the assertion below pass for
     * the wrong reason forever. The ceiling is on the ARCHIVE, so the fixture has
     * to be an archive of that size. */
    const noise = new Uint8Array(MAX_SESSION_ARCHIVE_BYTES + 65536);
    /* Real randomness, in chunks because getRandomValues caps at 64 KiB per call.
     * An arithmetic "pseudo-random" string was tried and compressed to 4 KB: any
     * short cycle is a pattern, and a zip finds patterns. */
    for (let at = 0; at < noise.length; at += 65536) {
      globalThis.crypto.getRandomValues(noise.subarray(at, Math.min(at + 65536, noise.length)));
    }
    const big = zipSync({
      "manifest.json": enc(manifest()),
      "monster.json": enc("[]"),
      "tiles/noise.bin": noise,
    });
    /* The zip has to actually exceed the ceiling for this to be the assertion it
     * claims to be - a compressible payload can shrink under it. */
    expect(big.length).toBeGreaterThan(MAX_SESSION_ARCHIVE_BYTES);
    const staged = await stageSessionMod(
      { bytes: big, source: "big.zip", allowed: true },
      scopeWith(s),
    );
    expect(staged.ok).toBe(false);
    if (staged.ok) return;
    expect(staged.problem).toContain("one session");
    /* And it points at the door that CAN take it, rather than just refusing. */
    expect(staged.problem).toContain("Install it instead");
  });

  it("does not read the caller's buffer after it has been checked", async () => {
    const s = store();
    const bytes = CONTENT();
    const staged = await stageSessionMod(
      { bytes, source: "draft.zip", allowed: true },
      scopeWith(s),
    );
    expect(staged.ok).toBe(true);
    /* Scribbled on AFTER the call: what was held is the copy, so what loads is
     * what was checked. */
    bytes.fill(0);
    const report = await loadSessionMods(scopeWith(s));
    expect(report.packs.map((p) => p.manifest.id)).toEqual(["draft"]);
  });
});

describe("the code asymmetry, which is the whole design", () => {
  it("the PLAYER's door takes an archive that ships code", async () => {
    const s = store();
    const staged = await stageSessionMod(
      { bytes: WITH_CODE(), source: "theirs.zip", granted: ["command:add"], allowed: true },
      scopeWith(s),
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.code).toBe(true);
    expect(staged.mod.granted).toEqual(["command:add"]);
  });

  it("the MOD's door refuses one, and names the file", async () => {
    const s = store();
    const load = createModSessionLoader({
      env: {
        fetch: () => Promise.reject(new Error("no network in this test")),
        subtle: globalThis.crypto.subtle,
        scope: scopeWith(s),
        now: () => new Date(0).toISOString(),
      },
      allowed: () => true,
    });
    const outcome = await load(WITH_CODE());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    /* The refusal a mod gets is `contentOnlyRefusal`'s, so a mod trying to launder
     * code through the session door hears the same sentence it hears at the install
     * door. Nothing about "for one session" relaxes it. */
    expect(outcome.problem).toContain("plugin.js");
    expect(sessionMods(scopeWith(s))).toEqual([]);
  });

  it("the MOD's door takes content, and reports whether it will survive the reload", async () => {
    const s = store();
    const load = createModSessionLoader({
      env: {
        fetch: () => Promise.reject(new Error("no network in this test")),
        subtle: globalThis.crypto.subtle,
        scope: scopeWith(s),
        now: () => new Date(0).toISOString(),
      },
      allowed: () => true,
    });
    const outcome = await load(CONTENT());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.id).toBe("draft");
    expect(outcome.survivesReload).toBe(true);
  });

  it("grants nothing when a mod stages content, because content asks for nothing", async () => {
    const s = store();
    const load = createModSessionLoader({
      env: {
        fetch: () => Promise.reject(new Error("no network in this test")),
        subtle: globalThis.crypto.subtle,
        scope: scopeWith(s),
        now: () => new Date(0).toISOString(),
      },
      allowed: () => true,
    });
    await load(CONTENT());
    expect(sessionMods(scopeWith(s))[0]?.granted).toEqual([]);
  });
});

describe("looking before staging", () => {
  it("names the code files and the declared capabilities, so consent has a subject", async () => {
    const preview = await previewSessionArchive(WITH_CODE());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.code).toEqual(["plugin.js"]);
    expect(preview.capabilities).toEqual(["command:add"]);
    expect(preview.id).toBe("draft");
  });

  it("distinguishes 'asks for nothing' from 'the manifest would not parse'", async () => {
    const clean = await previewSessionArchive(CONTENT());
    expect(clean.ok && clean.capabilities).toEqual([]);
    const broken = await previewSessionArchive(
      archive({ "manifest.json": "{ not json", "monster.json": "[]" }),
    );
    /* readModZip needs a readable manifest to find the mod folder at all, so a
     * manifest this broken never reaches the capability read - and the refusal it
     * does produce is the one the player should see. Either way the two answers are
     * different, which is the property under test. */
    if (broken.ok) expect(broken.capabilities).toBeNull();
    else expect(broken.problem.length).toBeGreaterThan(0);
  });
});

describe("the lifetime, and what it is honestly worth", () => {
  it("survives a reload: a fresh load reads the staged archive back as a pack", async () => {
    const s = store();
    await stageSessionMod({ bytes: CONTENT(), source: "draft.zip", allowed: true }, scopeWith(s));
    /* A new scope object over the SAME store is what a reload looks like: the page
     * is gone, the session storage is not. */
    const report = await loadSessionMods(scopeWith(s));
    expect(report.available).toBe(true);
    expect(report.kind).toBe("session");
    expect(report.packs.map((p) => p.manifest.id)).toEqual(["draft"]);
    /* The records are really there, not just the manifest. */
    expect(report.packs[0]?.files["monster"]).toBeDefined();
  });

  it("says so when the browser will not hold it, rather than promising a reload", () => {
    const refusing: SessionStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage is off in this window");
      },
      removeItem: () => undefined,
    };
    expect(sessionSurvivesReload(scopeWith(refusing))).toBe(false);
    /* And with no session storage at all - the fallback is in memory, which cannot
     * survive a reload either, and must not claim to. */
    expect(sessionSurvivesReload({})).toBe(false);
  });

  it("dropping it leaves nothing to load", async () => {
    const s = store();
    await stageSessionMod({ bytes: CONTENT(), source: "draft.zip", allowed: true }, scopeWith(s));
    dropSessionMods(scopeWith(s), "draft");
    expect(sessionMods(scopeWith(s))).toEqual([]);
    const report = await loadSessionMods(scopeWith(s));
    expect(report.packs).toEqual([]);
    expect(sessionPacks().packs).toEqual([]);
  });

  it("refuses a record written under a different shape rather than guessing", () => {
    const s = store();
    s.setItem(SESSION_MODS_KEY, JSON.stringify({ v: 999, mods: [{ id: "draft" }] }));
    expect(sessionMods(scopeWith(s))).toEqual([]);
  });

  it("reads a corrupt record as nothing staged rather than throwing at boot", () => {
    const s = store();
    s.setItem(SESSION_MODS_KEY, "{ not json");
    expect(sessionMods(scopeWith(s))).toEqual([]);
  });
});

describe("the report, fused into the boot report", () => {
  beforeEach(() => {
    resetDiskPacks();
  });

  const pack = (id: string): DiskPack =>
    ({
      manifest: { id, name: id, version: "1.0.0", shape: "content" } as PackManifest,
      files: {},
      code: [],
      assets: [],
    }) as DiskPack;

  const report = (kind: DiskPackReport["kind"], ids: readonly string[]): DiskPackReport => ({
    ...NO_DISK_PACKS,
    packs: ids.map(pack),
    available: true,
    kind,
    origins: [{ kind, dir: null, count: ids.length }],
  });

  it("is absent until something is staged, and then leads", async () => {
    setDiskPacks(report("installed", ["draft", "other"]));
    expect(diskPacks().kind).toBe("installed");

    const s = store();
    await stageSessionMod({ bytes: CONTENT(), source: "draft.zip", allowed: true }, scopeWith(s));
    await loadSessionMods(scopeWith(s));

    const fused = diskPacks();
    /* THE SESSION COPY SHADOWS THE INSTALLED ONE, which is the point of staging a
     * draft of a mod you already have. */
    expect(fused.kind).toBe("session");
    expect(fused.packs.map((p) => p.manifest.id)).toEqual(["draft", "other"]);
    /* And the collision is REPORTED rather than resolved in silence. */
    expect(fused.problems.some((p) => p.id === "draft")).toBe(true);
  });

  it("returns the same object until an input changes, so the composer does not recompose", async () => {
    setDiskPacks(report("installed", ["other"]));
    const first = diskPacks();
    expect(diskPacks()).toBe(first);

    const s = store();
    await stageSessionMod({ bytes: CONTENT(), source: "draft.zip", allowed: true }, scopeWith(s));
    await loadSessionMods(scopeWith(s));
    const afterStage = diskPacks();
    /* A NEW object, because the content changed - `composition()` compares the
     * report by identity to decide whether to compose again, so a stable object
     * here would mean a staged mod that never reached the game. */
    expect(afterStage).not.toBe(first);
    expect(diskPacks()).toBe(afterStage);
  });
});

describe("a staged mod is on, and is not quietly resident", () => {
  it("is enabled over a stored decision to keep it off", () => {
    /* The author installed this mod once, turned it off, and is now staging a
     * draft of it. The stored "off" is about the copy they have; it must not
     * silence the copy they just asked to try. */
    const ids = resolveEnabledIds({
      url: null,
      stored: [],
      discovered: ["draft"],
      choices: { draft: false },
      forced: ["draft"],
    });
    expect(ids).toEqual(["draft"]);
  });

  it("is enabled even under a ?mods= override, which discards everything else", () => {
    const ids = resolveEnabledIds({
      url: ["other"],
      stored: null,
      discovered: ["draft", "other"],
      forced: ["draft"],
    });
    expect(ids).toEqual(["other", "draft"]);
  });

  it("loads LAST, so a staged draft composes over what it shadows", () => {
    const ids = resolveEnabledIds({
      url: null,
      stored: ["other"],
      discovered: ["draft", "other"],
      forced: ["draft"],
    });
    expect(ids).toEqual(["other", "draft"]);
  });

  it("gets a row that says what it is, and no persistent on/off", () => {
    const rows = buildCatalog({
      content: [{ id: "draft", name: "A draft", version: "0.1.0", shape: "content" } as PackManifest],
      sandbox: [],
      trusted: [],
      enabled: ["draft"],
      consents: {},
      session: ["draft"],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session).toBe(true);
  });

  it("is not marked when nothing is staged, so the flag cannot be ambient", () => {
    const rows = buildCatalog({
      content: [{ id: "draft", name: "A draft", version: "0.1.0", shape: "content" } as PackManifest],
      sandbox: [],
      trusted: [],
      enabled: ["draft"],
      consents: {},
    });
    expect(rows[0]?.session).toBeUndefined();
  });
});
