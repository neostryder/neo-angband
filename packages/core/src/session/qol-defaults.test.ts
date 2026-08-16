/**
 * Two things this suite pins after the mod-scope reset (2026-07-16):
 *
 *  1. FAITHFUL CORE OPTIONS. Every upstream Angband option ships in core with
 *     its upstream default (OPTION_ENTRIES.normal) - the qol mod does NOT
 *     redefine option defaults (that was the earlier mistake). A new character
 *     gets exactly the table defaults; there is no interface-defaults override
 *     seam any more.
 *
 *  2. THE modRules SEAM. startGame / loadGame accept the host-resolved mod-rule
 *     flags and seed GameState.modRules with a COPY; absent = faithful (no map).
 *     This is the declarative bundled-mod mechanism (qol / bug-fixes).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { OPTION_ENTRIES } from "../generated/options.js";
import { FEAT } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import type { GameState } from "../game/context.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
} as unknown as GamePack;

describe("faithful core option defaults", () => {
  it("a new character gets the upstream OPTION_ENTRIES.normal default for every option", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const opts = state.options!;
    for (const entry of OPTION_ENTRIES) {
      expect(opts.get(entry.name)).toBe(entry.normal);
    }
  });

  it("options that were briefly mislabelled QoL are plain core options at their upstream default", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const opts = state.options!;
    // These are all upstream INTERFACE options; core ships them at the exact
    // upstream default, whatever it is (the qol mod must not touch them).
    for (const name of [
      "show_damage",
      "show_flavors",
      "center_player",
      "purple_uniques",
      "effective_speed",
      "notify_recharge",
      "auto_more",
    ]) {
      const entry = OPTION_ENTRIES.find((e) => e.name === name)!;
      expect(opts.get(name)).toBe(entry.normal);
    }
  });
});

describe("startGame modRules seam (declarative bundled-mod mechanism)", () => {
  it("seeds GameState.modRules from opts.modRules", () => {
    const { state } = startGame(pack, {
      seed: 123,
      depth: 1,
      modRules: { "qol.autoDig": true, "bugfix.duplicateArtifact": true },
    });
    expect(state.modRules).toEqual({
      "qol.autoDig": true,
      "bugfix.duplicateArtifact": true,
    });
  });

  it("leaves modRules absent (faithful 4.2.6) when none are supplied", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    expect(state.modRules).toBeUndefined();
  });

  it("copies the map so later menu toggles do not mutate the caller's object", () => {
    const supplied = { "qol.autoDig": true };
    const { state } = startGame(pack, { seed: 123, depth: 1, modRules: supplied });
    state.modRules!["qol.autoDig"] = false;
    expect(supplied["qol.autoDig"]).toBe(true); // caller's copy untouched
  });
});

describe("RNG neutrality: the empty mod system does not perturb the stream (Phase 3 / D1=B)", () => {
  /*
   * The hard rule (docs/PARITY.md): with no RNG-altering mod loaded, no hook,
   * seam, or guard may add, drop, or reorder a single draw. A fixed-seed run
   * with the mod system PRESENT-but-empty must draw exactly as it does with the
   * mod system ABSENT. This is the live-path integration guard over the whole
   * of startGame (level generation is by far the largest RNG consumer and
   * exercises the object pipeline, including the make_artifact mod guard wired
   * live through GameState.modRules). Because the RNG state is a pure function
   * of the entire draw history, byte-identical end states prove an identical
   * draw sequence.
   */

  /* Every bundled-mod rule flag, all explicitly OFF (mod system present, no
   * behavior-changing mod enabled) - the neutral default install. Core does not
   * read these any more (modRules is opaque to it); the point of keeping them is
   * that RECORDING a player's choices must not perturb anything either. */
  const ALL_FLAGS_OFF: Record<string, boolean> = {
    "bugfix.duplicateArtifact": false,
    "qol.autoDig": false,
    "bugfix.uniqueKillHistory": false,
    "bugfix.noiseScentSave": false,
    "bugfix.objectListOrder": false,
    "bugfix.stairsReachable": false,
  };

  it("startGame draws the identical RNG stream whether modRules is absent or all-false", () => {
    const absent = startGame(pack, { seed: 20260722, depth: 2 });
    const empty = startGame(pack, {
      seed: 20260722,
      depth: 2,
      modRules: ALL_FLAGS_OFF,
    });

    const a = absent.state.rng.getState();
    const b = empty.state.rng.getState();
    // Sanity: a real WELL table was advanced (not a vacuous empty comparison).
    expect(a.state.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("a mod whose every hook is INSTALLED but neutral draws the identical stream", () => {
    /*
     * Strictly stronger than the flag-map version above, and the pin that matters
     * now: back then "no mod" meant a map of false values core short-circuited on,
     * so nothing was ever called. Here all seven hooks are really present and
     * really invoked during birth and level generation, each answering exactly
     * what faithful core does on its own - so this proves that CALLING a mod does
     * not itself move the stream.
     */
    const NEUTRAL: import("../mod/hooks.js").ModHooks = {
      walkBlockedByDiggable: () => null,
      objectListTiebreak: () => 0,
      levelGenerated: () => true,
      artifactCommit: () => true,
      historyAdd: () => true,
      saveNoiseScent: () => false,
      messageText: (raw) => raw,
    };
    const absent = startGame(pack, { seed: 20260722, depth: 2 });
    const hooked = startGame(pack, { seed: 20260722, depth: 2, modHooks: NEUTRAL });

    expect(hooked.state.rng.getState()).toEqual(absent.state.rng.getState());
    /* Not just the stream: the level itself. */
    expect(Array.from(hooked.state.chunk.featCount)).toEqual(
      Array.from(absent.state.chunk.featCount),
    );
    expect(hooked.state.actor.grid).toEqual(absent.state.actor.grid);
  });
});

describe("the levelGenerated seam reaches level generation from startGame", () => {
  /*
   * The end-to-end guard on the ONE piece of plumbing a level mod needs: the
   * session must hand GameState.modHooks to cave_generate (session/game.ts
   * spreads it onto the GenDeps that generateLevel receives). No unit test on a
   * mod's repair can catch that wire coming loose, and neither can an
   * all-hooks-neutral stream comparison - only a hook whose answer actually
   * changes the outcome can.
   *
   * The staircase repair that used to be tested here is the bug-fixes mod's
   * (the neo-angband-mod-bug-fixes repo), and its end-to-end proof on these seeds
   * now lives with it. What stays here is the CONTROL - core still strands
   * floors, on purpose - plus the seam itself.
   *
   * These birth seeds were measured stranded through startGame itself, and they
   * cover both directions, including a down-only case - the direction that
   * actually blocks descent. The rate was 12 of 120 sampled (10.0%) until
   * help_greater_vault was restored on 2026-07-26; with greater vaults no longer
   * swallowing every deep level it is roughly 1-2%, matching the raw generator.
   */
  const STRANDED: readonly [number, number, string][] = [
    /*
     * RE-PINNED 2026-08-07 for #143, which moved reference/ from upstream
     * master back to the 4.2.6 tag. 4.2.6 ships 1,631 more lines of
     * room_template.txt and a different vault.txt, so the generation stream
     * differs from the first room draw onward and three of the six previous
     * seeds went stale. Rate held: 28 stranded in a 7,500-seed birth sweep
     * (2,500 each at depths 40/50/60). See the long note on gen/gen.test.ts'
     * STRANDED list for the equivalent measurement on the raw generator.
     *
     * Every direction is DERIVED from strandedDirs, never hand-written: the
     * 2026-08-06 re-pin nearly shipped 22 guessed labels.
     *
     * RE-PINNED AGAIN 2026-08-12, five of the six. Restoring KF_GOOD on dungeon
     * spellbooks (player/spell.ts, init.c L269-275) puts twelve kinds into the
     * GREAT allocation table, and the first good/great draw that lands on one
     * moves every draw after it -- including the store stocking startGame does
     * before it reaches the dungeon, which is why a level's LAYOUT changes at a
     * fixed seed even though the change is about objects.
     *
     * Most of the list going stale is normally the signal for a behavioural
     * regression rather than a stream shift (see the long note on gen.test.ts'
     * STRANDED list). It is not one here, and the control says so directly:
     * gen/gen.test.ts pins 32 seeds through the RAW generator -- bootLevel, no
     * player, no stores, no book kinds -- and all 32 still strand in the same
     * directions after this change. The generator's stranding behaviour did not
     * move; where in startGame's seed space it lands did.
     *
     * The rate held too. Replacement searches over consecutive seeds hit a
     * stranding at 3/1126 (d40), 1/241 and 1/593 (d50) and 1/1875 (d60) -- about
     * 0.2-0.3%, against the 0.26% measured over 12,000 seeds when #143 last
     * re-pinned this list.
     *
     *   d40 801221  -> 801295
     *   d50 1000004 -> 1000245
     *   d50 1000369 -> 1000962
     *   d60 1201183 -> 1203058
     *   d60 1201610 -> (dropped; see below)
     */
    [40, 800126, "up"],
    [40, 801295, "up"],
    [50, 1000245, "up"],
    [50, 1000962, "up"],
    /*
     * ONE down-only case, not two: the direction that actually blocks descent.
     * Both old d60 seeds resolved to the same replacement, and a further 8,000
     * consecutive d60 seeds past it produced no second down-only stranding, so
     * the list carries one rather than a padded second entry. gen.test.ts' raw
     * generator list keeps several down cases if more are ever wanted.
     */
    [60, 1203058, "down"],
  ];

  /** The directions of this level that have a stair but no walk-reachable one. */
  function strandedDirs(state: GameState): string[] {
    const c = state.chunk;
    const trav = (gr: Loc): boolean => c.isPassable(gr) || c.isDoor(gr) || c.isRubble(gr);
    const seen = new Uint8Array(c.width * c.height);
    const start = state.actor.grid;
    const stack: Loc[] = [start];
    seen[start.y * c.width + start.x] = 1;
    const d8 = [loc(0,1),loc(0,-1),loc(1,0),loc(-1,0),loc(1,1),loc(1,-1),loc(-1,1),loc(-1,-1)];
    while (stack.length) {
      const cur = stack.pop() as Loc;
      for (const d of d8) {
        const n = loc(cur.x + d.x, cur.y + d.y);
        if (!c.inBounds(n)) continue;
        const idx = n.y * c.width + n.x;
        if (seen[idx] || !trav(n)) continue;
        seen[idx] = 1;
        stack.push(n);
      }
    }
    const out: string[] = [];
    for (const [name, feat] of [["down", FEAT.MORE], ["up", FEAT.LESS]] as const) {
      let total = 0;
      let reached = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (c.feat(loc(x, y)) !== feat) continue;
          total++;
          if (seen[y * c.width + x]) reached++;
        }
      }
      if (total > 0 && reached === 0) out.push(name);
    }
    return out;
  }

  it("CONTROL: a faithful game (no mod loaded) is born on a stranded floor", () => {
    for (const [depth, seed, dirs] of STRANDED) {
      const { state } = startGame(pack, { seed, depth });
      expect(strandedDirs(state).join("+"), `d${depth} seed ${seed}`).toBe(dirs);
    }
  });

  it("a hook's in-place repair of the level survives into the live game", () => {
    /* The mutation is deliberately one a real repair makes: a staircase on the
     * player's own grid, which upstream itself lays under birth_connect_stairs
     * (gen-util.c:427-433). If the Gen the hook mutates were a copy, or were
     * mutated after the chunk was taken, this grid would not be a stair. */
    const [entry] = STRANDED;
    const [depth, seed] = entry as [number, number, string];
    const calls: boolean[] = [];
    const { state } = startGame(pack, {
      seed,
      depth,
      modHooks: {
        levelGenerated: (gen, quest) => {
          const g = gen as { c: { setFeat: (grid: Loc, feat: number) => void }; playerSpot: Loc | null };
          calls.push(quest);
          if (g.playerSpot) g.c.setFeat(g.playerSpot, FEAT.MORE);
          return true;
        },
      },
    });
    expect(calls).toEqual([false]); // called once, told this is not a quest level
    expect(state.chunk.feat(state.actor.grid)).toBe(FEAT.MORE);
  });

  it("a hook's refusal re-rolls the level, exactly as a monster overflow does", () => {
    const [entry] = STRANDED;
    const [depth, seed] = entry as [number, number, string];
    const faithful = startGame(pack, { seed, depth }).state;

    let refusals = 0;
    const rerolled = startGame(pack, {
      seed,
      depth,
      modHooks: {
        levelGenerated: () => {
          /* Refuse the first level only, then accept - a hook that always refused
           * would exhaust cave_generate's attempts, which is its own test. */
          refusals++;
          return refusals > 1;
        },
      },
    }).state;

    expect(refusals).toBe(2);
    /* A different level from the same seed: the rejection really went back
     * through the retry loop rather than being swallowed. */
    expect(Array.from(rerolled.chunk.featCount)).not.toEqual(
      Array.from(faithful.chunk.featCount),
    );
  });
});
