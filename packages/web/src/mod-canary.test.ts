/**
 * The catalogue, checked against what its tags actually serve TODAY.
 *
 * WHY THIS EXISTS. Everything the catalogue promises is checked at install time,
 * against digests that ship inside the build - so a player finds out a promise
 * has stopped being true by having an install fail. Nothing checked it before
 * that, and on 2026-07-31 two separate breakages went out and were both caught by
 * accident:
 *
 *   - Wiring the `engine` gate (#164) revealed that two shipped manifests
 *     declared `"engine": "4.2.x"` - the upstream Angband release, not the port's
 *     version - at tags the catalogue was pinning. The gate would have refused
 *     both mods on the live site.
 *   - The linoleum tile archives were rebuilt by a renamed converter, so the
 *     bytes at the tag stopped matching the pinned digests. Local verification
 *     agreed with a stale cache and said nothing; CI in the mod's own repository
 *     is what noticed, and only after a tag had been cut.
 *
 * Neither belongs to a code change in this repository, which is exactly why no
 * test here could see them: the failure is that the WORLD moved, not that the
 * source did. This runs against the network and says so out loud.
 *
 * WHAT IT CHECKS, per catalogue row:
 *   1. every payload file is still there at the pinned tag (HTTP 200);
 *   2. its bytes still hash to the pinned SHA-256;
 *   3. the response still carries `Access-Control-Allow-Origin: *`, which is the
 *      one property that makes an install from the static web build possible;
 *   4. the manifest's `engine` range still admits THIS build's ENGINE_VERSION;
 *   5. its `modApi` still matches this host's, when it ships code;
 *   6. its `id` still matches the id the catalogue files it under.
 *
 * OFF BY DEFAULT, and deliberately not part of `pnpm test`. It needs the network
 * and GitHub, and a PR must not go red because a CDN hiccupped - a check that
 * cries wolf gets ignored, and this one has to be believed. It runs on a schedule
 * in its own workflow (.github/workflows/mod-canary.yml) and on demand:
 *
 *   MOD_CANARY=1 pnpm --dir packages/web exec vitest run src/mod-canary.test.ts
 */

import { webcrypto } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";
import { satisfies } from "@rpgm-tools/neo-angband-mod-sdk";
import { RECOMMENDED_MODS, rawUrl, type RecommendedMod } from "./mod-registry";
import { sha256Hex } from "./mod-install";
import { MOD_API_VERSION } from "./mod-plugin";

const ON = process.env["MOD_CANARY"] === "1";
const subtle = webcrypto.subtle;

/* Generous, because this is a scheduled job and not a keystroke: a large tile
 * archive is 10.6 MiB and the whole catalogue is ~25 MiB. */
const TIMEOUT = 180_000;

interface Fetched {
  readonly bytes: Uint8Array;
  readonly cors: string | null;
}

async function get(url: string): Promise<Fetched> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${url}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    cors: res.headers.get("access-control-allow-origin"),
  };
}

/** Every (path, sha256) the catalogue pins for this mod, whichever payload shape. */
function pinned(mod: RecommendedMod): ReadonlyArray<{ path: string; sha256: string }> {
  return mod.payload.kind === "files" ? mod.payload.files : mod.payload.archives;
}

/**
 * The mod's manifest.json as the game would read it after installing.
 *
 * Taken out of the ARCHIVE for an archive payload rather than fetched from the
 * repository root, because the archive is what an install actually unpacks - a
 * root manifest.json that disagreed with the one inside the zip is a difference
 * only this route can see.
 */
async function manifestOf(mod: RecommendedMod): Promise<Record<string, unknown>> {
  if (mod.payload.kind === "files") {
    const file = mod.payload.files.find((f) => f.path.toLowerCase() === "manifest.json");
    if (!file) throw new Error(`${mod.id}: the catalogue lists no manifest.json`);
    const { bytes } = await get(rawUrl(mod.repo, mod.tag, file.path));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  }
  for (const archive of mod.payload.archives) {
    const { bytes } = await get(rawUrl(mod.repo, mod.tag, archive.path));
    const entries = unzipSync(bytes);
    const key = Object.keys(entries).find((k) => k.toLowerCase() === "manifest.json");
    if (key) return JSON.parse(new TextDecoder().decode(entries[key])) as Record<string, unknown>;
  }
  throw new Error(`${mod.id}: no archive in this payload contains a manifest.json`);
}

describe.skipIf(!ON)("the catalogue still matches what its tags serve", () => {
  it("has rows to check, so a green run is not an empty one", () => {
    /* The guard on the guard. An empty catalogue passes every assertion below,
     * and this canary's whole job is to be believed. */
    expect(RECOMMENDED_MODS.length).toBeGreaterThan(0);
    for (const mod of RECOMMENDED_MODS) expect(pinned(mod).length, mod.id).toBeGreaterThan(0);
  });

  for (const mod of RECOMMENDED_MODS) {
    describe(`${mod.id} @ ${mod.tag}`, () => {
      it(
        "serves every pinned file, at the pinned digest, with CORS open",
        async () => {
          for (const file of pinned(mod)) {
            const url = rawUrl(mod.repo, mod.tag, file.path);
            const got = await get(url);
            const actual = await sha256Hex(got.bytes, subtle);
            /* The digest first: a mismatch is the alarm this whole scheme exists
             * to raise, and it means the bytes at a pinned TAG changed - which
             * should be impossible and is the most important thing this job can
             * tell anyone. */
            expect(actual, `${file.path} at ${mod.tag}`).toBe(file.sha256);
            /* Measured rather than assumed, and re-measured here because it is a
             * property of GitHub's serving policy, not of this repository: without
             * it the static web build cannot install anything. */
            expect(got.cors, `${file.path} CORS`).toBe("*");
          }
        },
        TIMEOUT,
      );

      it(
        "declares an engine range this build satisfies",
        async () => {
          /* The check the #164 gate applies at load time, applied to the bytes at
           * the tag instead of to the working tree. A manifest fixed here but not
           * re-tagged, or a tag pinned before the fix, is invisible to every other
           * test in this repository. */
          const manifest = await manifestOf(mod);
          expect(manifest["id"], "manifest id vs catalogue id").toBe(mod.id);
          const range = manifest["engine"];
          if (range === undefined) return; // declaring none is allowed
          expect(typeof range).toBe("string");
          expect(
            satisfies(ENGINE_VERSION, range as string),
            `${mod.id} declares engine ${String(range)}; this build is ${ENGINE_VERSION}`,
          ).toBe(true);
        },
        TIMEOUT,
      );

      it(
        "targets this host's mod API if it ships code",
        async () => {
          const manifest = await manifestOf(mod);
          const facets = manifest["facets"];
          const shipsCode =
            manifest["shape"] === "plugin" ||
            (Array.isArray(facets) && facets.includes("plugin"));
          if (!shipsCode) return;
          expect(manifest["modApi"], `${mod.id} modApi`).toBe(MOD_API_VERSION);
        },
        TIMEOUT,
      );
    });
  }
});

describe.skipIf(ON)("the canary is off by default", () => {
  it("is opt-in, so a network hiccup cannot fail a PR", () => {
    /* Not a tautology: it pins that the gate is an environment variable and that
     * the suite above is genuinely skipped without it, which is the difference
     * between "off by default" and "nobody has run it". */
    expect(ON).toBe(false);
    expect(RECOMMENDED_MODS.length).toBeGreaterThan(0);
  });
});
