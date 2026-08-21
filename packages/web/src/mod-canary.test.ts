/**
 * The curated mods, checked against what their repositories actually serve TODAY,
 * by the route a player's game takes.
 *
 * WHY THIS EXISTS. Everything here is checked at install time, on the player's
 * machine, so the way a broken promise is normally discovered is by having an install
 * fail. Nothing checked it before that, and on 2026-07-31 two separate breakages went
 * out and were both caught by accident:
 *
 *   - Wiring the `engine` gate (#164) revealed that two shipped manifests declared
 *     `"engine": "4.2.x"` - the upstream Angband release, not the port's version - at
 *     tags that were being offered. The gate would have refused both mods on the live
 *     site.
 *   - The linoleum tile archives were rebuilt by a renamed converter, so the bytes at
 *     the tag changed under a pinned digest. Local verification agreed with a stale
 *     cache and said nothing.
 *
 * Neither belongs to a code change in this repository, which is exactly why no other
 * test here can see them: the failure is that the WORLD moved, not that the source
 * did. This runs against the network and says so out loud.
 *
 * WHAT CHANGED WHEN RECOMMENDED_MODS WENT, because this file lost a check and it
 * should not be quiet about it. It used to read a catalogue compiled into the build -
 * repo, tag, and a SHA-256 per file - and could therefore assert that the bytes at a
 * pinned tag still hashed to the pinned value. **That assertion is gone, because the
 * value it compared against is gone**; a mod is now discovered from its own
 * repository, and nothing here knows what its files are supposed to hash to. What
 * replaces it is not a substitute for it: it is the rest of the promise, checked
 * through the code a player actually runs.
 *
 * That is a real trade and it went the other way on purpose - see mod-registry.ts for
 * why. What this file can still say, and now says through `discoverMod` rather than
 * through a literal:
 *
 *   1. the curated list is readable and CORS-open, so the static build can read it;
 *   2. every repository it names still describes a mod this game could install;
 *   3. each manifest's `engine` range still admits THIS build's ENGINE_VERSION;
 *   4. its `modApi` still matches this host's, when it ships code;
 *   5. every declared payload file is still served, at the tag, with CORS open;
 *   6. and the qol plugin, DOWNLOADED, still does what it says.
 *
 * OFF BY DEFAULT, and deliberately not part of `pnpm test`. It needs the network and
 * GitHub, and a PR must not go red because a CDN hiccupped - a check that cries wolf
 * gets ignored, and this one has to be believed. It runs on a schedule in its own
 * workflow (.github/workflows/mod-canary.yml) and on demand:
 *
 *   MOD_CANARY=1 pnpm --dir packages/web exec vitest run src/mod-canary.test.ts
 */

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { composeModHooks, ENGINE_VERSION, OptionState } from "@rpgm-tools/neo-angband-core";
import type { GameState } from "@rpgm-tools/neo-angband-core";
import { satisfies } from "@rpgm-tools/neo-angband-mod-sdk";
import { rawUrl } from "./mod-registry";
import { DEFAULT_REGISTRY_URL, fetchRegistry } from "./mod-curated";
import { discoverMod, type DiscoverEnv, type DiscoveredMod } from "./mod-discover";
import { MOD_API_VERSION, type ModPlugin } from "./mod-plugin";
import { modPluginContext } from "./mod-context";
import { modPrefs } from "./mod-prefs";
import { notifyOptionsChanged, optionsFingerprint } from "./options";

const ON = process.env["MOD_CANARY"] === "1";

/* Generous, because this is a scheduled job and not a keystroke: a large tile
 * archive is 10.6 MiB and the whole curated set is ~25 MiB. */
const TIMEOUT = 180_000;

const env: DiscoverEnv = {
  engineVersion: ENGINE_VERSION,
  fetch: async (url) => {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  },
};

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

/**
 * Discover every repository the curated list names, once, for the whole file.
 *
 * ONE PASS, not one per assertion. Discovery is three requests per mod against the
 * public API, and re-running it inside each `it` is how a scheduled job earns a rate
 * limit - which fails the run for a reason that has nothing to do with the mods.
 */
const discovered: Promise<readonly DiscoveredMod[]> = (async () => {
  if (!ON) return [];
  const list = await fetchRegistry(DEFAULT_REGISTRY_URL, { fetch: env.fetch });
  if (!list.ok) throw new Error(`the curated registry: ${list.problem}`);
  const out: DiscoveredMod[] = [];
  const failed: string[] = [];
  for (const ref of list.registry.mods) {
    const r = await discoverMod(ref, env);
    if (r.ok) out.push(r.mod);
    else failed.push(`${ref.repo}: ${r.problem}`);
  }
  if (failed.length > 0) {
    /* A repository in MY curated list that cannot be discovered is my problem, not
     * the player's, so it fails the run rather than being logged and passed over. */
    throw new Error(`repositories that could not be discovered:\n  ${failed.join("\n  ")}`);
  }
  return out;
})();

/**
 * The mod's manifest.json as the game would read it after installing.
 *
 * Taken out of the ARCHIVE for an archive payload rather than fetched from the
 * repository root, because the archive is what an install actually unpacks - a root
 * manifest.json that disagreed with the one inside the zip is a difference only this
 * route can see.
 */
async function manifestOf(mod: DiscoveredMod): Promise<Record<string, unknown>> {
  const files = mod.payload.filter((p) => p.kind === "file");
  const plain = files.find((f) => f.path.toLowerCase() === "manifest.json");
  if (plain) {
    const { bytes } = await get(rawUrl(mod.repo, mod.tag, plain.path));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  }
  for (const archive of mod.payload.filter((p) => p.kind === "archive")) {
    const { bytes } = await get(rawUrl(mod.repo, mod.tag, archive.path));
    const entries = unzipSync(bytes);
    const key = Object.keys(entries).find((k) => k.toLowerCase() === "manifest.json");
    if (key) return JSON.parse(new TextDecoder().decode(entries[key])) as Record<string, unknown>;
  }
  throw new Error(`${mod.id}: nothing in this payload contains a manifest.json`);
}

describe.skipIf(!ON)("the curated mods still serve what this build needs", () => {
  it(
    "the list is readable, and CORS-open so the static web build can read it too",
    async () => {
      const res = await fetch(DEFAULT_REGISTRY_URL);
      expect(res.ok).toBe(true);
      /* The one header that decides whether the deployed site can do this at all.
       * Measured rather than assumed, because it is not this project's to guarantee. */
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    },
    TIMEOUT,
  );

  it(
    "has mods to check, so a green run is not an empty one",
    async () => {
      /* The guard on the guard. An empty list passes every assertion below, and this
       * canary's whole job is to be believed. */
      const mods = await discovered;
      expect(mods.length).toBeGreaterThan(0);
      for (const m of mods) expect(m.payload.length, m.id).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "every declared payload file is served at the tag, with CORS open",
    async () => {
      /* What is left of the digest check, and it is honestly less: this says the
       * bytes are REACHABLE, not that they are the bytes the author published. The
       * value that could have said the second thing shipped inside the build and
       * went with it. A 404 here is still the common real failure - a tag deleted, a
       * file renamed, a repository made private - and it is the one a player meets
       * as a broken install. */
      const problems: string[] = [];
      for (const mod of await discovered) {
        for (const entry of mod.payload) {
          const url = rawUrl(mod.repo, mod.tag, entry.path);
          try {
            const got = await get(url);
            if (got.bytes.length === 0) problems.push(`${mod.id}: ${entry.path} is empty`);
            /* Re-measured here because it is a property of GitHub's serving policy,
             * not of this repository: without it the static build installs nothing. */
            if (got.cors !== "*") problems.push(`${mod.id}: ${entry.path} CORS ${String(got.cors)}`);
          } catch (e) {
            problems.push(`${mod.id}: ${entry.path}: ${String(e)}`);
          }
        }
      }
      expect(problems).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "every manifest declares an engine range this build satisfies",
    async () => {
      /* The check the #164 gate applies at load time, applied to the bytes at the tag
       * instead of to the working tree. A manifest fixed but not re-tagged is
       * invisible to every other test in this repository.
       *
       * Asserted on the MANIFEST as well as on discoverMod's `compatible`, because
       * they are two different claims: `compatible` is the loader's verdict, which a
       * content-only mod can pass while declaring a range this build sits outside. */
      const problems: string[] = [];
      for (const mod of await discovered) {
        const manifest = await manifestOf(mod);
        if (manifest["id"] !== mod.id) {
          problems.push(`${mod.repo}: manifest id ${String(manifest["id"])} vs ${mod.id}`);
        }
        const range = manifest["engine"];
        if (range === undefined) continue; // declaring none is allowed
        if (typeof range !== "string" || !satisfies(ENGINE_VERSION, range)) {
          problems.push(
            `${mod.id} declares engine ${String(range)}; this build is ${ENGINE_VERSION}`,
          );
        }
      }
      expect(problems).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "every mod that ships code targets this host's mod API",
    async () => {
      const problems: string[] = [];
      let checked = 0;
      for (const mod of await discovered) {
        const manifest = await manifestOf(mod);
        const facets = manifest["facets"];
        const shipsCode =
          manifest["shape"] === "plugin" || (Array.isArray(facets) && facets.includes("plugin"));
        if (!shipsCode) continue;
        checked++;
        if (manifest["modApi"] !== MOD_API_VERSION) {
          problems.push(`${mod.id} modApi ${String(manifest["modApi"])} vs ${MOD_API_VERSION}`);
        }
      }
      expect(problems).toEqual([]);
      /* Not a tautology: if every curated mod stopped shipping code this assertion
       * would pass by checking nothing, and the API-version gate would go unwatched. */
      expect(checked, "no curated mod ships code any more").toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

describe.skipIf(ON)("the canary is off by default", () => {
  it("is opt-in, so a network hiccup cannot fail a PR", () => {
    /* Not a tautology: it pins that the gate is an environment variable and that the
     * suite above is genuinely skipped without it, which is the difference between
     * "off by default" and "nobody has run it". */
    expect(ON).toBe(false);
  });
});

/**
 * The DOWNLOADED qol plugin, driven through the host's own chain.
 *
 * Everything above checks that the mods can still be fetched and would still load.
 * This checks that the bytes still DO something - and it is the only test anywhere
 * that runs the plugin a player actually receives rather than a local build of it or
 * a fixture shaped like one.
 *
 * The chain is the host's, function for function, in the host's order:
 *
 *   plugin.js downloaded -> evaluated as a module (mod-code.ts does this with a
 *   blob URL; node has no blob URL, so a data: URL, which is the same dynamic
 *   import of the same source text)
 *     -> modPluginContext(...)              the context main.ts builds
 *     -> plugin.hooks(ctx)                  WITHOUT state, as the host calls it
 *     -> composeModHooks([...])             core's fold
 *     -> notifyOptionsChanged(state, before) what the '=' screen calls on close
 *     -> plugin.register(host, ctx)         with newCharacter, as main.ts calls it
 *
 * WHY IT IS WORTH THE NETWORK. Every link in that chain has its own unit test and all
 * of them passed while the capture half was reading `ctx.state.options` - a property
 * the host never puts on a hooks() context. The feature was dead and three green
 * suites said otherwise. Only running the whole chain finds that.
 */
describe.skipIf(!ON)("the qol mod, downloaded and actually run", () => {
  it(
    "remembers a setting, and applies it to a new character",
    async () => {
      const mod = (await discovered).find((m) => m.id === "qol");
      /* So this suite cannot pass by finding nothing. */
      expect(mod, "qol is not in the curated list any more").toBeDefined();
      if (!mod) return;

      const entry = mod.payload.find((p) => p.kind === "file" && p.path === "plugin.js");
      expect(entry, "qol ships no plugin.js").toBeDefined();
      if (!entry) return;
      const { bytes } = await get(rawUrl(mod.repo, mod.tag, entry.path));
      const source = new TextDecoder().decode(bytes);

      const loaded = (await import(
        /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
      )) as { default: ModPlugin };
      const plugin = loaded.default;
      expect(plugin.api).toBe(MOD_API_VERSION);

      /* The player's toggles, resolved as the host resolves them: the manifest's
       * defaults, read from the manifest that was downloaded beside the code. */
      const manifest = await manifestOf(mod);
      const rules = manifest["rules"] as ReadonlyArray<{ flag: string; default: boolean }>;
      const flags: Record<string, boolean> = {};
      for (const rule of rules) flags[rule.flag] = rule.default;
      expect(flags["qol.rememberSettings"]).toBe(true);
      expect(flags["qol.rememberCheats"]).toBe(false);

      /* One preference store for both halves, exactly as the host gives one mod one
       * store across a session. In-memory so the run leaves nothing behind. */
      const store = new Map<string, string>();
      const prefs = modPrefs(mod.id, {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      });

      /* ---- character one: change a setting through the '=' screen ---- */
      const first = { options: new OptionState() } as unknown as GameState;
      /* hooks() gets NO state - the host composes hooks before the game exists. */
      const composed = composeModHooks([
        plugin.hooks?.(modPluginContext(mod.id, flags, undefined, {}, { prefs })) ?? {},
      ]);
      if (composed) first.modHooks = composed;
      expect(composed?.optionsChanged, "the mod listens for option changes").toBeTypeOf(
        "function",
      );

      const before = optionsFingerprint(first);
      first.options!.set("use_sound", true);
      first.options!.hitpointWarn = 8;
      first.options!.set("cheat_live", true); // must NOT be remembered
      notifyOptionsChanged(first, before);

      expect(store.size, "the mod wrote its preferences").toBe(1);

      /* ---- character two: a brand-new one, built from table defaults ---- */
      const second = { options: new OptionState() } as unknown as GameState;
      expect(second.options!.get("use_sound")).toBe(false);
      plugin.register?.(
        {} as never,
        modPluginContext(mod.id, flags, second, {}, { prefs, newCharacter: true }),
      );

      expect(second.options!.get("use_sound"), "the setting carried over").toBe(true);
      expect(second.options!.hitpointWarn).toBe(8);
      expect(second.options!.get("cheat_live"), "cheats are not inherited by default").toBe(
        false,
      );
      expect(second.options!.get("score_live")).toBe(false);

      /* ---- and a LOADED character is left exactly as its save had it ---- */
      const loadedChar = { options: new OptionState() } as unknown as GameState;
      plugin.register?.(
        {} as never,
        modPluginContext(mod.id, flags, loadedChar, {}, { prefs, newCharacter: false }),
      );
      expect(loadedChar.options!.get("use_sound"), "a save keeps what it was saved with").toBe(
        false,
      );
    },
    TIMEOUT,
  );
});
