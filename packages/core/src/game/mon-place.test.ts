import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, ORIGIN, RF, TV } from "../generated";
import { bindConstants } from "../constants";
import { loc, locEq } from "../loc";
import { distance } from "../loc";
import type { Loc } from "../loc";
import { MonAllocTable } from "../mon/make";
import { SummonTable } from "../mon/summon";
import { MON_GROUP } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { GROUP_TYPE } from "../mon/monster";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import {
  applyMagic,
  ArtifactState,
  makeGold,
  ObjAllocState,
  objectPrep,
} from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { tvalIsMoney } from "../obj/object";
import { tvalFindIdx } from "../obj/bind";
import { deleteMonster, squareMonster } from "./context";
import type { GameState } from "./context";
import { summonGroup } from "./mon-group";
import { floorPile } from "./floor";
import {
  createMimickedObject,
  monCreateMimickedObject,
  multiplyMonster,
  placeNewMonster,
  placeNewMonsterOne,
  squareAllowsSummon,
  summonSpecific,
  wipeMonsterCounts,
} from "./mon-place";
import type { MimicDeps, MonPlaceDeps, SummonDeps } from "./mon-place";
import { Rng } from "../rng";
import type { GameObject } from "../obj/object";
import { GRANITE, addMon, makeRace, makeState, monReg } from "./harness";

const summons = new SummonTable(monReg.summons, monReg.bases);

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objReg = new ObjRegistry({
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
} as ObjPackJson);
const objConstants = bindConstants(loadJson("constants"));

function makeMimicDeps(): MimicDeps {
  const makeDeps: MakeDeps = {
    reg: objReg,
    alloc: new ObjAllocState(objReg, objConstants),
    constants: objConstants,
    artifacts: new ArtifactState(objReg.artifacts.length),
    noArtifacts: false,
  };
  return { makeDeps };
}

/** A real object-mimic race from the pack, by display name. */
function mimicRace(name: string): MonsterRace {
  const race = monReg.races.find((r) => r.name === name);
  if (!race || race.mimicKinds.length === 0) {
    throw new Error(`no object-mimic race "${name}" in the pack`);
  }
  return race;
}

function makeTable(): MonAllocTable {
  return new MonAllocTable(monReg.races, { maxDepth: 128 });
}

function deps(
  _state: GameState,
  extra: Partial<MonPlaceDeps> & Partial<SummonDeps> = {},
): SummonDeps {
  return { table: makeTable(), summons, ...extra };
}

function raceWhere(pred: (race: MonsterRace) => boolean): MonsterRace {
  const race = monReg.races.find((r, i) => i > 0 && pred(r));
  if (!race) throw new Error("no such race in the pack");
  return race;
}

/** A fresh non-unique race for placement (own curNum, real base). */
function plainRace(): MonsterRace {
  return makeRace({ level: 3 });
}

describe("squareAllowsSummon (cave-square.c L949)", () => {
  it("accepts an empty floor grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    expect(squareAllowsSummon(state, loc(12, 10))).toBe(true);
  });

  it("refuses walls, occupants, the player and the decoy", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addMon(state, plainRace(), loc(12, 10));
    expect(squareAllowsSummon(state, loc(0, 0))).toBe(false);
    expect(squareAllowsSummon(state, loc(12, 10))).toBe(false);
    expect(squareAllowsSummon(state, loc(10, 10))).toBe(false);
    state.decoy = loc(13, 10);
    expect(squareAllowsSummon(state, loc(13, 10))).toBe(false);
  });

  it("refuses warded and trapped grids through the predicates", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const warded = loc(12, 10);
    const trapped = loc(13, 10);
    const preds = {
      isPlayerTrap: (g: Loc) => locEq(g, trapped),
      isWebbed: () => false,
      isWarded: (g: Loc) => locEq(g, warded),
    };
    expect(squareAllowsSummon(state, warded, preds)).toBe(false);
    expect(squareAllowsSummon(state, trapped, preds)).toBe(false);
    expect(squareAllowsSummon(state, loc(14, 10), preds)).toBe(true);
  });
});

describe("placeNewMonsterOne (mon-make.c L1079, live)", () => {
  it("constructs and registers a monster, counting its race", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = plainRace();
    const before = race.curNum;
    const ok = placeNewMonsterOne(
      state,
      loc(14, 10),
      race,
      false,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    expect(ok).toBe(true);
    const mon = squareMonster(state, loc(14, 10));
    expect(mon).toBeTruthy();
    expect(mon!.race).toBe(race);
    expect(mon!.hp).toBeGreaterThan(0);
    expect(race.curNum).toBe(before + 1);
    /* The monster started its own group and leads it. */
    const group = state.groups[mon!.groupInfo[GROUP_TYPE.PRIMARY]!.index];
    expect(group?.leader).toBe(mon!.midx);
    /* deleteMonster forgets the racial occurrence. */
    deleteMonster(state, mon!.midx);
    expect(race.curNum).toBe(before);
  });

  it("sleep places the monster asleep with the racial value", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    const race = { ...plainRace(), sleep: 20 };
    placeNewMonsterOne(
      state,
      loc(14, 10),
      race,
      true,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    const mon = squareMonster(state, loc(14, 10))!;
    /* (val * 2) + randint1(val * 10). */
    expect(mon.mTimed[MON_TMD.SLEEP]).toBeGreaterThanOrEqual(41);
  });

  it("refuses occupied grids, the player, walls and glyphs", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = plainRace();
    const info = { index: 0, role: MON_GROUP.LEADER };
    addMon(state, plainRace(), loc(12, 10));
    const d = deps(state);
    expect(placeNewMonsterOne(state, loc(12, 10), race, false, info, d)).toBe(false);
    expect(placeNewMonsterOne(state, loc(10, 10), race, false, info, d)).toBe(false);
    expect(placeNewMonsterOne(state, loc(0, 0), race, false, info, d)).toBe(false);
    const warded = loc(15, 10);
    const dp = deps(state, {
      preds: {
        isPlayerTrap: () => false,
        isWebbed: () => false,
        isWarded: (g: Loc) => locEq(g, warded),
      },
    });
    expect(placeNewMonsterOne(state, warded, race, false, info, dp)).toBe(false);
  });

  it("enforces uniqueness and FORCE_DEPTH", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const info = { index: 0, role: MON_GROUP.LEADER };
    const d = deps(state);

    const unique = makeRace({ level: 3, flags: [RF.UNIQUE] });
    unique.maxNum = 1;
    expect(placeNewMonsterOne(state, loc(14, 10), unique, false, info, d)).toBe(true);
    /* One at a time. */
    expect(placeNewMonsterOne(state, loc(16, 10), unique, false, info, d)).toBe(false);
    /* Dead (max_num 0) stays dead. */
    deleteMonster(state, squareMonster(state, loc(14, 10))!.midx);
    unique.maxNum = 0;
    expect(placeNewMonsterOne(state, loc(14, 10), unique, false, info, d)).toBe(false);

    /* FORCE_DEPTH refuses above the native depth (chunk depth 0 here). */
    const deep = makeRace({ level: 40, flags: [RF.FORCE_DEPTH] });
    expect(placeNewMonsterOne(state, loc(16, 10), deep, false, info, d)).toBe(false);
    state.chunk.depth = 40;
    expect(placeNewMonsterOne(state, loc(16, 10), deep, false, info, d)).toBe(true);
  });

  it("accumulates mon_rating exactly (level^2 + OOD bonus), item #74's add_to_monster_rating", () => {
    /* Faithful to mon-make.c place_new_monster_one L1112-1126: this is the
     * live-cave twin of gen/util.ts's placeNewMonsterOne. Since
     * chunk.feeling is computed once at gen-end (gen/generate.ts
     * generateLevel) and never recomputed, this post-gen accumulation is
     * harmless bookkeeping - it must not disturb an already-shown feeling. */
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    state.chunk.feeling = 42; /* stand-in for an already-computed feeling */
    const race = makeRace({ level: 20 }); /* OOD: level(20) > depth(5) */

    expect(state.chunk.monRating).toBe(0);
    const ok = placeNewMonsterOne(
      state,
      loc(14, 10),
      race,
      false,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    expect(ok).toBe(true);

    const base = race.level * race.level;
    const ood = (race.level - state.chunk.depth) * race.level * race.level;
    expect(state.chunk.monRating).toBe(base + ood);
    expect(state.chunk.feeling).toBe(42);
  });
});

describe("placeNewMonster (mon-make.c L1360, live groups)", () => {
  it("places a same-race friend group sharing one group", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 7 });
    state.chunk.depth = 10;
    /* A real pack race that brings same-race friends. */
    const race = raceWhere(
      (r) =>
        !r.flags.has(RF.UNIQUE) &&
        r.level <= 5 &&
        r.friends.length > 0 &&
        r.friends[0]!.race === r &&
        r.friends[0]!.percentChance === 100,
    );
    const ok = placeNewMonster(
      state,
      loc(20, 12),
      race,
      false,
      true,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state),
    );
    expect(ok).toBe(true);
    const placed = state.monsters.filter(Boolean);
    expect(placed.length).toBeGreaterThan(1);
    /* All in the leader's group. */
    const leader = squareMonster(state, loc(20, 12))!;
    const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;
    for (const mon of placed) {
      expect(mon!.groupInfo[GROUP_TYPE.PRIMARY]!.index).toBe(gi);
    }
    expect(state.groups[gi]!.leader).toBe(leader.midx);
    /* Wiping the counts puts every race back. */
    wipeMonsterCounts(state);
    expect(race.curNum).toBe(0);
  });
});

describe("summonSpecific (mon-summon.c L402)", () => {
  it("summons an eligible monster near the grid and returns its level", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 11 });
    state.chunk.depth = 10;
    const level = summonSpecific(
      state,
      state.actor.grid,
      10,
      summons.nameToIdx("UNDEAD"),
      false,
      false,
      deps(state),
    );
    expect(level).toBeGreaterThan(0);
    const placed = state.monsters.filter(Boolean);
    expect(placed.length).toBe(1);
    const mon = placed[0]!;
    expect(mon.race.flags.has(RF.UNDEAD)).toBe(true);
    expect(distance(mon.grid, state.actor.grid)).toBeLessThanOrEqual(4);
    /* Summoned awake. */
    expect(mon.mTimed[MON_TMD.SLEEP] ?? 0).toBe(0);
  });

  it("returns 0 when no race is eligible", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    /* Ancient dragons do not allocate at depth 0 / low level. */
    const level = summonSpecific(
      state,
      state.actor.grid,
      1,
      summons.nameToIdx("HI_DRAGON"),
      false,
      false,
      deps(state),
    );
    expect(level).toBe(0);
    expect(state.monsters.filter(Boolean).length).toBe(0);
  });

  it("delay zeroes energy and holds only faster summons", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const state = makeState({ playerGrid: loc(10, 10), seed });
      state.chunk.depth = 15;
      const level = summonSpecific(
        state,
        state.actor.grid,
        15,
        summons.nameToIdx("MONSTER"),
        true,
        false,
        deps(state),
      );
      if (!level) continue;
      const mon = state.monsters.filter(Boolean)[0]!;
      expect(mon.energy).toBe(0);
      if (mon.mspeed > state.actor.speed) {
        expect(mon.mTimed[MON_TMD.HOLD] ?? 0).toBeGreaterThan(0);
      } else {
        expect(mon.mTimed[MON_TMD.HOLD] ?? 0).toBe(0);
      }
    }
  });

  it("call moves an out-of-sight eligible monster to the summon point", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 17 });
    state.chunk.depth = 10;
    /* Wall off a corner so the resident undead is out of LOS. */
    for (let y = 1; y < 24; y++) state.chunk.setFeat(loc(30, y), GRANITE);
    const undead = addMon(
      state,
      makeRace({ level: 8, flags: [RF.UNDEAD] }),
      loc(35, 10),
      { hp: 40 },
    );
    undead.mTimed[MON_TMD.SLEEP] = 50;
    const level = summonSpecific(
      state,
      state.actor.grid,
      8,
      summons.nameToIdx("UNDEAD"),
      false,
      true,
      deps(state),
    );
    expect(level).toBe(undead.race.level);
    /* The undead was moved beside the player, woken, drained of energy. */
    expect(distance(undead.grid, state.actor.grid)).toBeLessThanOrEqual(4);
    expect(undead.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(undead.energy).toBe(0);
    /* No new monster was created. */
    expect(state.monsters.filter(Boolean).length).toBe(1);
  });
});

describe("summoner group joining", () => {
  it("puts summons in the summoner's summon group", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 19 });
    state.chunk.depth = 10;
    const summoner = addMon(state, makeRace({ level: 20 }), loc(14, 10));
    const level = summonSpecific(
      state,
      summoner.grid,
      15,
      summons.nameToIdx("MONSTER"),
      false,
      false,
      deps(state, { monCurrent: summoner.midx }),
    );
    expect(level).toBeGreaterThan(0);
    const summoned = state.monsters.filter(
      (m) => m && m !== summoner,
    )[0]!;
    expect(summoned.groupInfo[GROUP_TYPE.PRIMARY]!.role).toBe(MON_GROUP.SUMMON);
    const group = summonGroup(state, summoner.midx);
    expect(summoned.groupInfo[GROUP_TYPE.PRIMARY]!.index).toBe(group!.index);
  });
});

describe("multiplyMonster (mon-make.c multiply_monster, L983) - become_aware", () => {
  it("reveals a camouflaged child when the (already-revealed) parent multiplies", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ flags: [RF.UNAWARE] });
    const mon = addMon(state, race, loc(20, 10));
    /* blankMonster leaves MFLAG_CAMOUFLAGE off - the parent is "already
     * revealed", matching monster_is_camouflaged(mon) == false upstream. */

    let revealedMidx: number | null = null;
    state.becomeAware = (m) => {
      revealedMidx = m.midx;
    };

    const ok = multiplyMonster(state, mon, deps(state));
    expect(ok).toBe(true);

    const child = state.monsters.find((m) => m && m !== mon && m.race === race);
    expect(child).toBeTruthy();
    expect(child!.mflag.has(MFLAG.CAMOUFLAGE)).toBe(true);
    expect(revealedMidx).toBe(child!.midx);
  });

  it("does not reveal the child when the parent is itself still camouflaged", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ flags: [RF.UNAWARE] });
    const mon = addMon(state, race, loc(20, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE); // parent still hidden

    let called = false;
    state.becomeAware = () => {
      called = true;
    };

    const ok = multiplyMonster(state, mon, deps(state));
    expect(ok).toBe(true);
    expect(called).toBe(false);
  });
});

describe("mon_create_mimicked_object (mon-make.c L899)", () => {
  it("places a gold mimic's fake coin on the floor and links both sides", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 3;
    const race = mimicRace("creeping copper coins"); // single money kind
    const grid = loc(14, 10);

    const ok = placeNewMonsterOne(
      state,
      grid,
      race,
      false,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state, { mimic: makeMimicDeps() }),
    );
    expect(ok).toBe(true);

    const mon = squareMonster(state, grid)!;
    const pile = floorPile(state, grid);
    expect(pile).toHaveLength(1);
    const fake = pile[0]!;
    expect(tvalIsMoney(fake.tval)).toBe(true);
    expect(fake.mimickingMIdx).toBe(mon.midx);
    expect(mon.mimickedObj).not.toBe(0);
  });

  it("prepped item mimic carries ORIGIN_DROP_MIMIC and the chunk depth", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 4;
    const race = mimicRace("potion mimic");
    const grid = loc(14, 10);

    placeNewMonsterOne(
      state,
      grid,
      race,
      false,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state, { mimic: makeMimicDeps() }),
    );

    const fake = floorPile(state, grid)[0]!;
    expect(fake.tval).toBe(TV.POTION);
    expect(fake.origin).toBe(ORIGIN.DROP_MIMIC);
    expect(fake.originDepth).toBe(4);
    expect(fake.number).toBe(1);
  });

  it("draws RNG in exactly upstream order (reservoir one_in_ loop, then object make)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 3;
    const race = mimicRace("potion mimic"); // 6 kinds -> reservoir draws
    const grid = loc(14, 10);
    const mon = addMon(state, race, grid); // no RNG drawn
    const mdeps = makeMimicDeps();

    const snapshot = state.rng.getState();
    monCreateMimickedObject(state, mon, mdeps);
    const fake = floorPile(state, grid)[0]!;
    const endState = state.rng.getState();

    /* Independent replay of the exact C sequence from the same snapshot. */
    state.rng.setState(snapshot);
    const kinds = race.mimicKinds;
    const resolve = (m: { tval: string; sval: string }) => {
      const tval = tvalFindIdx(m.tval);
      return objReg.lookupKind(tval, objReg.lookupSval(tval, m.sval))!;
    };
    let kind = resolve(kinds[0]!);
    let i = 1;
    for (const mk of kinds) {
      if (state.rng.oneIn(i)) kind = resolve(mk);
      i++;
    }
    const expected = objectPrep(
      state.rng,
      objReg,
      objConstants,
      kind,
      race.level,
      "randomise",
    );
    applyMagic(
      state.rng,
      mdeps.makeDeps,
      expected,
      race.level,
      true,
      false,
      false,
      false,
      state.chunk.depth,
    );

    /* Same draw sequence (final RNG states match) and same selected kind. */
    expect(endState).toEqual(state.rng.getState());
    expect(fake.kind).toBe(kind);
    expect(fake.sval).toBe(expected.sval);
  });

  it("makeGold uses the chunk depth and the mimic kind's coin type", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 6;
    const race = mimicRace("creeping copper coins");
    const grid = loc(14, 10);
    const mon = addMon(state, race, grid);
    const mdeps = makeMimicDeps();

    const snapshot = state.rng.getState();
    monCreateMimickedObject(state, mon, mdeps);
    const fake = floorPile(state, grid)[0]!;
    const endState = state.rng.getState();

    /* Replay: single kind -> one_in_(1) draws nothing, then makeGold. */
    state.rng.setState(snapshot);
    const m = race.mimicKinds[0]!;
    const tval = tvalFindIdx(m.tval);
    const kind = objReg.lookupKind(tval, objReg.lookupSval(tval, m.sval))!;
    const gold = makeGold(state.rng, mdeps.makeDeps, state.chunk.depth, kind.name);
    expect(endState).toEqual(state.rng.getState());
    expect(fake.kind).toBe(gold.kind);
    expect(fake.pval).toBe(gold.pval);
  });

  it("floor cannot hold: RF_MIMIC_INV gives the object to the monster, else discards; mimicry cleared", () => {
    /* A mimic race that also carries the fake item when the floor is full. */
    const base = mimicRace("potion mimic");
    const invRace: MonsterRace = { ...base, flags: base.flags.clone() };
    invRace.flags.on(RF.MIMIC_INV);

    for (const [race, expectHeld] of [
      [invRace, true],
      [base, false],
    ] as const) {
      const state = makeState({ playerGrid: loc(10, 10) });
      state.chunk.depth = 3;
      const grid = loc(14, 10);
      const mon = addMon(state, race, grid);
      /* Make the grid unable to hold objects so floor_carry fails. */
      state.chunk.setFeat(grid, GRANITE);

      monCreateMimickedObject(state, mon, makeMimicDeps());

      expect(floorPile(state, grid)).toHaveLength(0);
      expect(mon.mimickedObj).toBe(0);
      if (expectHeld) {
        expect(mon.heldObj).toHaveLength(1);
        expect(mon.heldObj[0]!.mimickingMIdx).toBe(0);
        expect(mon.heldObj[0]!.heldMIdx).toBe(mon.midx);
      } else {
        expect(mon.heldObj).toHaveLength(0);
      }
    }
  });

  it("is inert when the caller supplies no mimic deps (mon.mimickedObj stays 0)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = mimicRace("creeping copper coins");
    const grid = loc(14, 10);

    placeNewMonsterOne(
      state,
      grid,
      race,
      false,
      { index: 0, role: MON_GROUP.LEADER },
      deps(state), // no `mimic`
    );

    const mon = squareMonster(state, grid)!;
    expect(mon.mimickedObj).toBe(0);
    expect(floorPile(state, grid)).toHaveLength(0);
  });
});

describe("createMimickedObject (GameState-free core, used by the gen path)", () => {
  it("draws from the target's own RNG/carry, not the live floor or state.rng", () => {
    /* The generation path calls createMimickedObject with g.rng and a
     * side-table carry (no live GameState). Prove the core is decoupled:
     * it must draw from the supplied RNG and park the object via the supplied
     * carry, leaving state.rng and state.floor untouched. */
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 3;
    const race = mimicRace("creeping copper coins");
    const grid = loc(14, 10);
    const mon = addMon(state, race, grid); // no RNG drawn

    const stateRngBefore = state.rng.getState();
    const parked: Array<{ grid: Loc; obj: GameObject }> = [];
    const ownRng = new Rng(12345);

    createMimickedObject(
      {
        depth: state.chunk.depth,
        rng: ownRng,
        makeDeps: makeMimicDeps().makeDeps,
        carry: (g, obj) => {
          parked.push({ grid: g, obj });
          return true;
        },
      },
      mon,
    );

    /* The live state was not touched at all. */
    expect(state.rng.getState()).toEqual(stateRngBefore);
    expect(floorPile(state, grid)).toHaveLength(0);

    /* The object went to the supplied carry, linked to the monster. */
    expect(parked).toHaveLength(1);
    expect(parked[0]!.grid).toEqual(grid);
    expect(parked[0]!.obj.mimickingMIdx).toBe(mon.midx);
    expect(mon.mimickedObj).not.toBe(0);
  });

  it("carry failure clears the mimicry (matches floor_carry rejection)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 3;
    const race = mimicRace("potion mimic");
    const grid = loc(14, 10);
    const mon = addMon(state, race, grid);

    createMimickedObject(
      {
        depth: state.chunk.depth,
        rng: new Rng(7),
        makeDeps: makeMimicDeps().makeDeps,
        carry: () => false, // the grid cannot hold the object
      },
      mon,
    );

    expect(mon.mimickedObj).toBe(0);
    /* No RF_MIMIC_INV on "potion mimic", so the object is dropped. */
    expect(mon.heldObj).toHaveLength(0);
  });
});
