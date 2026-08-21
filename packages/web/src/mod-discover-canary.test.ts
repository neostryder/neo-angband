/**
 * Discovery, run against the repositories that actually exist TODAY.
 *
 * The unit tests for mod-curated / mod-source / mod-discover all run over a fake
 * fetch, which proves the logic and proves nothing about the world. This runs the
 * real thing: read the curated registry over HTTPS, ask each repository it names
 * what mod it holds, and check the answers are usable. The failure it exists to
 * catch is the one no source change can cause - a repository renamed, a tag
 * deleted, a manifest that stopped parsing, GitHub dropping a CORS header.
 *
 * It is the honest answer to "does this feature work", asked before a UI is built
 * on top of it. A discovery path that only ever saw a mock is a discovery path
 * nobody has run.
 *
 * OFF BY DEFAULT, same reasoning as mod-canary.test.ts: it needs the network, and
 * a PR must not go red because a CDN hiccupped. A check that cries wolf gets
 * ignored, and this one has to be believed.
 *
 *   MOD_CANARY=1 pnpm exec vitest run packages/web/src/mod-discover-canary.test.ts
 */

import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";

import { ALL_PACKS } from "@rpgm-tools/neo-angband-linoleum";
import { DEFAULT_REGISTRY_URL, fetchRegistry } from "./mod-curated";
import { discoverMod, type DiscoverEnv } from "./mod-discover";

const ON = process.env["MOD_CANARY"] === "1";

/* Generous: three requests per mod, over the public API, from a cold cache. */
const TIMEOUT = 120_000;

const env: DiscoverEnv = {
  engineVersion: ENGINE_VERSION,
  fetch: async (url) => {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  },
};

describe.skipIf(!ON)("the curated registry, live", () => {
  it(
    "is readable, and CORS-open so the static web build can read it too",
    async () => {
      const res = await fetch(DEFAULT_REGISTRY_URL);
      expect(res.ok).toBe(true);
      /* The one header that decides whether the deployed site can do this at all.
       * Measured rather than assumed, because it is not this project's to guarantee. */
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      const r = await fetchRegistry(DEFAULT_REGISTRY_URL, { fetch: env.fetch });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.registry.problems).toEqual([]);
      expect(r.registry.mods.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "names repositories that describe themselves well enough to install",
    async () => {
      const list = await fetchRegistry(DEFAULT_REGISTRY_URL, { fetch: env.fetch });
      expect(list.ok).toBe(true);
      if (!list.ok) return;

      /* Reported as one table rather than one failing assertion per mod, so a run
       * says what the WHOLE list looks like today instead of stopping at the first
       * repository that moved. */
      const rows: string[] = [];
      const broken: string[] = [];
      for (const ref of list.registry.mods) {
        const r = await discoverMod(ref, env);
        if (!r.ok) {
          rows.push(`${ref.repo}: PROBLEM ${r.problem}`);
          broken.push(`${ref.repo}: ${r.problem}`);
          continue;
        }
        const m = r.mod;
        rows.push(
          `${ref.repo}: id=${m.id} ${m.tag} v${m.version} ` +
            `engine=${m.engine ?? "-"} compatible=${String(m.compatible)} ` +
            `payload=${String(m.payload.length)}${m.guessedPayload ? " (guessed)" : ""} ` +
            `bytes=${m.bytes === null ? "?" : String(m.bytes)}`,
        );

        /* Per mod, the things an install would need. */
        expect(m.id, `${ref.repo} id`).not.toBe("");
        expect(m.tags.length, `${ref.repo} tags`).toBeGreaterThan(0);
        /* Only checkable for a files-only payload: an archive's manifest.json is
         * inside a zip, and nothing has opened one at discovery time. This
         * assertion made the same wrong assumption discoverMod did, and failed the
         * run for the same good mod - so it is conditioned the same way, and the
         * unpacked check stays where it can be answered (storeMod). */
        if (m.payload.every((p) => p.kind === "file")) {
          expect(
            m.payload.some((p) => p.path === "manifest.json"),
            `${ref.repo} manifest`,
          ).toBe(true);
        }

        /* A GUESSED payload cannot know that a committed .zip is a pack to unpack
         * rather than a file to store - only a manifest can say that. So a
         * repository whose files include zips and whose manifest declares no
         * payload would install those zips unopened, and the mod would be there
         * and not work. This is the assertion that found exactly that on
         * neo-linoleum: 11 files, 25.8 MB, every archive stored shut. */
        const zips = m.payload.filter((p) => p.path.toLowerCase().endsWith(".zip"));
        if (m.guessedPayload && zips.length > 0) {
          broken.push(
            `${ref.repo}: ships ${String(zips.length)} .zip file(s) and declares no ` +
              `payload, so they would be stored instead of unpacked`,
          );
        }
      }
      /* No eslint-disable here, deliberately. `no-console` is scoped to exclude
       * test files (eslint.config.mjs `ignores`), so a disable is REDUNDANT - and
       * reportUnusedDisableDirectives makes a redundant one an error. This file
       * shipped with one and kept CI red for four commits while every local check I
       * ran was green, because I had linted the files I touched rather than the tree.
       * mod-canary.test.ts, which prints the same kind of report, never had one. */
      console.log(`discovery against live repositories:\n  ${rows.join("\n  ")}`);

      /* A repository in MY curated list that cannot be discovered is my problem,
       * not the player's, so it fails the run rather than being logged and passed
       * over. A borg with no release yet is exactly this case and should say so. */
      expect(broken).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "the linoleum mod still ships one archive per converter pack",
    async () => {
      /* INHERITED FROM tile-catalog.test.ts, which could ask this locally while the
       * catalogue compiled into the build listed the mod's files. It cannot now: a
       * mod's payload comes from its own manifest at a tag. The question is the same
       * one and it is worth keeping - a pack added to the converter and never shipped
       * is a Graphics screen with a row missing and nothing to say why.
       *
       * It is asked of the DECLARED payload rather than a guessed one, because a
       * guess is a directory listing and would pass on any repository that happens to
       * contain zips. */
      const list = await fetchRegistry(DEFAULT_REGISTRY_URL, { fetch: env.fetch });
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      const ref = list.registry.mods.find((m) => m.repo.endsWith("-mod-linoleum"));
      expect(ref, "the curated list no longer names the linoleum mod").toBeDefined();
      if (!ref) return;

      const r = await discoverMod(ref, env);
      expect(r.ok, `linoleum: ${r.ok ? "" : r.problem}`).toBe(true);
      if (!r.ok) return;
      expect(r.mod.guessedPayload, "linoleum declares its payload").toBe(false);

      const paths = r.mod.payload.map((p) => p.path);
      expect(paths).toContain("dist/neo-linoleum-mod.zip");
      expect(ALL_PACKS.length, "the converter defines packs to check for").toBeGreaterThan(0);
      for (const key of ALL_PACKS.map((p) => p.key)) {
        expect(paths, `no archive ships the ${key} pack`).toContain(
          `dist/neo-linoleum-${key}.zip`,
        );
      }
      expect(paths.length).toBe(ALL_PACKS.length + 1);
    },
    TIMEOUT,
  );
});
