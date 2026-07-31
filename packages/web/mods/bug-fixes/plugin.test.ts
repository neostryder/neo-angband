/**
 * The `bug-fixes` mod's entry point, and the four patches whose whole body is a
 * hook (the staircase repair has its own file, stairs.test.ts; the string table
 * has strings.test.ts).
 *
 * Every test drives the mod the way the game does: call the default export with
 * resolved flags, install the result as GameState.modHooks / MakeDeps.hooks, and
 * assert the game's behaviour. The matching SEAM tests in core assert the other
 * half - that core offers each point, and what it does with an absent hook.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ArtifactState,
  FlagSet,
  HIST,
  KF,
  MFLAG_SIZE,
  ObjAllocState,
  ObjRegistry,
  RF,
  RF_SIZE,
  Rng,
  bindConstants,
  histHas,
  loadGame,
  makeArtifact,
  objectListStandardCompare,
  objectPrep,
  saveGame,
  startGame,
} from "@neo-angband/core";
import type {
  Artifact,
  GameObject,
  GamePack,
  MakeDeps,
  ObjectListEntry,
} from "@neo-angband/core";
import * as neoCore from "@neo-angband/core";
import plugin from "./plugin";

/**
 * The mod's behaviour, driven the way the HOST drives it: the entry point is a
 * ModPlugin whose `hooks` reads the engine off `ctx.core`
 * (mods/bug-fixes/plugin.ts), and the host reduces that to a function of flags
 * (src/mod-hooks.ts pluginAdapter). Same reduction here, with the real core.
 */
const bugFixesHooks = (flags: Readonly<Record<string, boolean>>): ModHooks =>
  plugin.hooks({ flags, core: neoCore });

/* ------------------------------------------------------------------ *
 * Content.
 * ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const objPack = {
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
};

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
  obj: objPack,
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

/** Every flag the manifest declares, all ON - what enabling the mod gives you. */
const ALL_ON: Readonly<Record<string, boolean>> = {
  "bugfix.uniqueKillHistory": true,
  "bugfix.noiseScentSave": true,
  "bugfix.objectListOrder": true,
  "bugfix.duplicateArtifact": true,
  "bugfix.stairsReachable": true,
  "bugfix.miscStrings": true,
};

/** flag -> the ONE hook it installs. The map the whole mod comes down to. */
const FLAG_TO_HOOK: readonly [string, string][] = [
  ["bugfix.uniqueKillHistory", "historyAdd"],
  ["bugfix.noiseScentSave", "saveNoiseScent"],
  ["bugfix.objectListOrder", "objectListTiebreak"],
  ["bugfix.duplicateArtifact", "artifactCommit"],
  ["bugfix.stairsReachable", "levelGenerated"],
  ["bugfix.miscStrings", "messageText"],
];

describe("the bug-fixes mod's entry point", () => {
  it("matches the manifest: every declared flag maps to exactly one hook", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
    ) as { rules: { flag: string }[] };
    /* If a rule is added to the manifest without code behind it, the player gets a
     * toggle that does nothing; if code is added without a rule, they get a change
     * they cannot switch off. Tie the two together here. */
    expect(manifest.rules.map((r) => r.flag).sort()).toEqual(
      FLAG_TO_HOOK.map(([flag]) => flag).sort(),
    );
    expect(Object.keys(ALL_ON).sort()).toEqual(FLAG_TO_HOOK.map(([f]) => f).sort());
  });

  it("contributes nothing when the mod is enabled but every patch is off", () => {
    expect(bugFixesHooks({})).toEqual({});
    const allOff = Object.fromEntries(FLAG_TO_HOOK.map(([flag]) => [flag, false]));
    expect(bugFixesHooks(allOff)).toEqual({});
  });

  it("installs exactly the hook each patch needs, and no other", () => {
    for (const [flag, hook] of FLAG_TO_HOOK) {
      const hooks = bugFixesHooks({ [flag]: true });
      expect(Object.keys(hooks), `${flag} alone`).toEqual([hook]);
    }
  });

  it("installs all six with the whole patch set on", () => {
    expect(Object.keys(bugFixesHooks(ALL_ON)).sort()).toEqual(
      FLAG_TO_HOOK.map(([, hook]) => hook).sort(),
    );
  });
});

describe("#4245: no duplicate unique-kill history entries", () => {
  const hook = bugFixesHooks(ALL_ON).historyAdd!;

  it("suppresses a duplicate and permits everything else", () => {
    expect(hook({ what: "Killed Grip", type: HIST.SLAY_UNIQUE, duplicate: true })).toBe(false);
    expect(hook({ what: "Killed Grip", type: HIST.SLAY_UNIQUE, duplicate: false })).toBe(true);
    /* It keys on the duplicate flag core computes, not on the text - so it cannot
     * accidentally swallow an unrelated entry that happens to read the same. */
    expect(hook({ what: "Found The Phial", type: HIST.ARTIFACT_KNOWN, duplicate: false })).toBe(true);
  });

  it("in a real game, a re-kill logs one entry instead of two", () => {
    const uniqueFlags = new FlagSet(RF_SIZE);
    uniqueFlags.on(RF.UNIQUE);
    const race = {
      ridx: 2,
      name: "Grip, Farmer Maggot's Dog",
      mexp: 1,
      level: 1,
      flags: uniqueFlags,
      blows: [],
      drops: [],
      maxNum: 1,
    };
    const mon = (): never =>
      ({
        race,
        originalRace: null,
        midx: 0,
        grid: { x: 20, y: 12 },
        heldObj: [],
        mflag: new FlagSet(MFLAG_SIZE),
      }) as never;

    const game = startGame(pack, { seed: 4242, depth: 1, modHooks: bugFixesHooks(ALL_ON) });
    race.maxNum = 1;
    game.state.onPlayerKill?.(mon());
    game.state.onPlayerKill?.(mon());
    const logged = game.state.actor.player.hist.filter((e) =>
      histHas(e.type, HIST.SLAY_UNIQUE),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.event).toBe("Killed Grip, Farmer Maggot's Dog");
  });
});

describe("#4605: noise and scent ride the save", () => {
  it("asks for them", () => {
    expect(bugFixesHooks(ALL_ON).saveNoiseScent!()).toBe(true);
  });

  it("in a real game, the heatmaps survive save/reload exactly", () => {
    const hooks = bugFixesHooks(ALL_ON);
    const game = startGame(pack, { seed: 808, depth: 3, modHooks: hooks });
    /* One hand-set scent value, so an all-zero map cannot make the round trip
     * pass vacuously. (Playing turns would fill the maps too, but it would make
     * this test depend on the turn loop as well as on the save.) */
    const c = game.state.chunk;
    c.scent[game.state.actor.grid.y * c.width + game.state.actor.grid.x] = 42;

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as {
      chunk: { scent?: unknown; noise?: unknown };
    };
    expect(saved.chunk.scent).toBeDefined();
    expect(saved.chunk.noise).toBeDefined();

    const restored = loadGame(pack, saved as never).state;
    expect(Array.from(restored.chunk.scent)).toEqual(Array.from(c.scent));
    expect(Array.from(restored.chunk.noise)).toEqual(Array.from(c.noise));
  });
});

describe("#4664: a strict total order for the floor object list", () => {
  const tiebreak = bugFixesHooks(ALL_ON).objectListTiebreak!;

  it("orders nearer-to-top first, then leftmost", () => {
    expect(tiebreak({ dy: 3, dx: 4 }, { dy: 4, dx: 3 })).toBeLessThan(0);
    expect(tiebreak({ dy: 4, dx: 3 }, { dy: 3, dx: 4 })).toBeGreaterThan(0);
    /* Same row: dx decides. */
    expect(tiebreak({ dy: 2, dx: 1 }, { dy: 2, dx: 5 })).toBeLessThan(0);
    /* The same grid twice really is equal - a total order still has ties for
     * identical keys, and returning non-zero here would make the sort lie. */
    expect(tiebreak({ dy: 2, dx: 2 }, { dy: 2, dx: 2 })).toBe(0);
  });

  it("is a legal comparator: antisymmetric and transitive", () => {
    const keys = [
      { dy: -2, dx: 3 },
      { dy: 0, dx: 0 },
      { dy: 0, dx: 7 },
      { dy: 1, dx: -4 },
      { dy: 1, dx: 6 },
      { dy: 5, dx: -1 },
    ];
    for (const a of keys) {
      for (const b of keys) {
        /* Summed rather than negated: Math.sign(0) is +0 and -Math.sign(0) is -0,
         * which Object.is (and so toBe) treats as different numbers. */
        expect(Math.sign(tiebreak(a, b)) + Math.sign(tiebreak(b, a))).toBe(0);
        for (const c of keys) {
          if (tiebreak(a, b) < 0 && tiebreak(b, c) < 0) {
            expect(tiebreak(a, c)).toBeLessThan(0);
          }
        }
      }
    }
  });

  it("breaks the tie inside core's comparator, on a real game state", () => {
    const { state } = startGame(pack, { seed: 99, depth: 1, modHooks: bugFixesHooks(ALL_ON) });
    const obj = {
      kind: { name: "Ration of Food", dChar: ",", dAttr: "w", cost: 3 },
      tval: 80,
      sval: 1,
      number: 1,
      artifact: null,
      notice: 0,
    } as unknown as GameObject;
    /* (dx=3, dy=4) and (dx=4, dy=3) are both 25 units away: every upstream key
     * ties, including distance, so only the hook can order them. */
    const a = { object: obj, unknown: false, count: [1, 0], dx: 3, dy: 4 } as unknown as ObjectListEntry;
    const b = { object: obj, unknown: false, count: [1, 0], dx: 4, dy: 3 } as unknown as ObjectListEntry;
    const cmp = objectListStandardCompare(state);
    expect(cmp(a, b)).toBeGreaterThan(0); // b (dy=3) is nearer the top
    expect(cmp(b, a)).toBeLessThan(0);
  });
});

describe("#4510: an artifact cannot be committed twice", () => {
  const reg = new ObjRegistry(objPack as never);
  const constants = bindConstants(loadJson("constants") as never);

  /** A normal (non-special) artifact whose (tval, sval) is unique in the list. */
  function uniqueNormalArt(): Artifact {
    const arts = reg.artifacts.filter((a): a is Artifact => a !== null);
    const found = arts.find((art) => {
      const kind = reg.lookupKind(art.tval, art.sval);
      if (!kind || kind.kindFlags.has(KF.INSTA_ART)) return false;
      return arts.filter((o) => o.tval === art.tval && o.sval === art.sval).length === 1;
    });
    if (!found) throw new Error("no unique normal artifact in the pack");
    return found;
  }

  function deps(hooks?: MakeDeps["hooks"]): MakeDeps {
    const d: MakeDeps = {
      reg,
      alloc: new ObjAllocState(reg, constants),
      constants,
      artifacts: new ArtifactState(reg.artifacts.length),
      noArtifacts: false,
    };
    if (hooks) d.hooks = hooks;
    return d;
  }

  it("refuses a commit of an already-created artifact, and permits a fresh one", () => {
    const hook = bugFixesHooks(ALL_ON).artifactCommit!;
    expect(hook(7, true)).toBe(false);
    expect(hook(7, false)).toBe(true);
  });

  it("in the object pipeline, clears the artifact and reports failure", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const d = deps(bugFixesHooks(ALL_ON));
    d.artifacts.markCreated(art.aidx, true); // already created elsewhere
    const obj = objectPrep(new Rng(1), reg, constants, kind, art.allocMin, "randomise");
    obj.artifact = art;

    expect(makeArtifact(new Rng(1), d, obj, art.allocMin)).toBe(false);
    expect(obj.artifact).toBeNull();
  });

  it("faithful core (patch off) re-commits it - the wart this patch covers", () => {
    const art = uniqueNormalArt();
    const kind = reg.lookupKind(art.tval, art.sval)!;
    const d = deps(); // no hooks at all
    d.artifacts.markCreated(art.aidx, true);
    const obj = objectPrep(new Rng(1), reg, constants, kind, art.allocMin, "randomise");
    obj.artifact = art;

    expect(makeArtifact(new Rng(1), d, obj, art.allocMin)).toBe(true);
    expect(obj.artifact?.aidx).toBe(art.aidx);
  });
});
