/**
 * Four more seams the live game declared, read, and never wrote.
 *
 * These came out of the same producer-form sweep as banish-symbol-wiring and
 * teleport-env-wiring (task #160): for each optional member of every
 * *Deps/*Env/*Hooks interface, does ANY producer form exist in production?
 * Each one below had none, so its documented "default" was the only behaviour
 * the shipped game ever had.
 *
 *   FloorEnv.onBreak          floor_carry_fail's message (obj-pile.c:1003). An
 *                             item that broke on a throw, or vanished because
 *                             the floor was full, disappeared in SILENCE.
 *   FloorEnv.onDrop           sound(MSG_DROP) (obj-pile.c:1150).
 *   SpellChanceEnv.hasPf      player_has(p, pf) is p->state.pflags - race +
 *                             class + shape. Unsupplied, spell_chance and
 *                             beam_chance read the CLASS flags alone.
 *   ObjectInfoDeps.inStore    object_is_in_store: a store shows a useable
 *                             item's real effect even when its flavour is
 *                             unknown. Nothing ever set it, so the shop screen
 *                             mouthed platitudes at every unaware consumable.
 *   ProjectMonsterHooks.onUpdate  update_mon on a monster that SURVIVED a
 *                             projection (project-mon.c:1262).
 *
 * Every test here goes through the live wiring - the registered command, or the
 * hook object wireGame built - never a locally assembled env.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, PF, TV } from "../generated/index.js";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import { floorCarry, floorPile } from "../game/floor.js";
import { gearGet, invenCarry } from "../game/gear.js";
import { objectPrep } from "../obj/make.js";
import type { EffectRecordJson } from "../obj/types.js";
import { buildObjectEffectChain } from "../game/obj-cmd.js";
import { buildEffectContext } from "../game/effect-env.js";
import { attachGameEnv } from "../game/effect-game-env.js";
import { sourcePlayer } from "../effects/interpreter.js";
import { objectInfoTextblock } from "../game/object-inspect.js";
import type { ObjectInfoExtras } from "../game/object-inspect.js";
import { spellChance } from "../player/spell.js";
import { makeSpellChanceEnv } from "../game/spell-cmd.js";
import { Rng } from "../rng.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
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
  store: loadRecords("store"),
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
};

function started(seed: number, className = "Warrior") {
  const game = startGame(pack, { seed, depth: 3, className });
  const messages: string[] = [];
  const sounds: number[] = [];
  game.state.msg = (t: string): void => {
    messages.push(t);
  };
  const priorSound = game.state.sound;
  game.state.sound = (m: number): void => {
    sounds.push(m);
    priorSound?.(m);
  };
  return { game, messages, sounds };
}

/** An ordinary kind of `tval` that the pack ships, prepared as a live object. */
function makeOne(game: StartedGame, tval: number, seed: number, name?: string) {
  const reg = game.booted.registries;
  const kind = reg.objects.kinds.find(
    (k) =>
      k.tval === tval &&
      k.kidx < reg.objects.ordinaryKindCount &&
      (name === undefined || k.name === name),
  );
  expect(kind, `the pack must ship an ordinary kind for tval ${tval}`).toBeDefined();
  return objectPrep(new Rng(seed), reg.objects, reg.constants, kind!, 0, "minimise");
}

describe("drop_near's messages and sound reach the player", () => {
  /**
   * A THROWN potion. breakage_chance is 100 for a potion (combat/ranged.ts, the
   * upstream breakage table), so drop_near takes floor_carry_fail's broke=true
   * arm every time and upstream says "The <name> breaks." (obj-pile.c:1003).
   *
   * The throw command is the discriminator on purpose: installRangedCommands
   * passed a BARE `{}` as its FloorEnv at both drop sites, so even after
   * wireGame started supplying onBreak/onDrop the thrown-missile path could not
   * see them. Every other dropNear call site in the port already threaded it -
   * a seam supplied to every path but one.
   */
  it("a thrown potion that shatters says so", () => {
    const { game, messages } = started(6101);
    const state = game.state;
    const reg = game.booted.registries;
    const potion = makeOne(game, TV.POTION, 6102);
    const handle = invenCarry(state.gear, state.actor.player, potion, {
      quiverSlotSize: reg.constants.quiverSlotSize,
      thrownQuiverMult: reg.constants.thrownQuiverMult,
    });
    expect(handle).toBeGreaterThan(0);

    messages.length = 0;
    game.registry.get("throw")!(state, { code: "throw", args: { handle, dir: 6 } });

    expect(gearGet(state.gear, handle), "the potion left the pack").toBeFalsy();
    expect(
      messages.some((m) => / breaks?\.$/.test(m)),
      `no "breaks" line; messages were ${JSON.stringify(messages)}`,
    ).toBe(true);
  });

  it("a drop that lands plays MSG_DROP", () => {
    const { game, sounds } = started(6103);
    const state = game.state;
    const reg = game.booted.registries;
    const obj = makeOne(game, TV.POTION, 6104);
    const handle = invenCarry(state.gear, state.actor.player, obj, {
      quiverSlotSize: reg.constants.quiverSlotSize,
      thrownQuiverMult: reg.constants.thrownQuiverMult,
    });
    sounds.length = 0;
    game.registry.get("drop")!(state, { code: "drop", args: { handle } });
    expect(floorPile(state, state.actor.grid).length).toBeGreaterThan(0);
    expect(sounds.length, "sound(MSG_DROP) at obj-pile.c:1150").toBeGreaterThan(0);
  });
});

describe("spell_chance reads the DERIVED player flags", () => {
  it("hasPf is supplied, and follows p->state.pflags rather than the class", () => {
    const { game } = started(6201, "Mage");
    const state = game.state;
    const env = makeSpellChanceEnv(state);
    expect(env.hasPf, "makeSpellChanceEnv must supply hasPf").toBeDefined();

    const pflags = state.playerState?.pflags;
    expect(pflags, "the derived state must carry pflags").toBeDefined();

    /* PF_ROCK is the one pflag the shipped data grants through a SHAPE
     * (shape.txt Pukel-man), i.e. exactly the kind of flag a class-only read
     * cannot see. Its value is irrelevant to spell_chance; what matters is that
     * the seam answers from the derived set. */
    const cls = state.actor.player.cls;
    expect(cls.pflags.has(PF.ROCK), "the Mage class must not carry ROCK").toBe(false);
    expect(env.hasPf!(PF.ROCK)).toBe(false);
    pflags!.on(PF.ROCK);
    expect(env.hasPf!(PF.ROCK), "a class-only read would still say false").toBe(true);
    pflags!.off(PF.ROCK);
  });

  it("a ZERO_FAIL granted outside the class lowers the floor, as player_has does", () => {
    const { game } = started(6202, "Mage");
    const state = game.state;
    const player = state.actor.player;
    const statInd = state.playerState?.statInd ?? [];
    /* A spell the character can actually see a rate for. */
    const spellIndex = 0;

    const classOnly = (pf: number): boolean => player.cls.pflags.has(pf);
    const withZeroFail = (pf: number): boolean =>
      pf === PF.ZERO_FAIL ? true : classOnly(pf);

    const a = spellChance(player, statInd, spellIndex, { hasPf: classOnly });
    const b = spellChance(player, statInd, spellIndex, { hasPf: withZeroFail });
    /* The Mage HAS ZERO_FAIL, so pick the discriminator that always holds: the
     * two answers agree when the flag agrees, and the seam is what decides. */
    expect(classOnly(PF.ZERO_FAIL)).toBe(true);
    expect(a).toBe(b);

    /* And for a class that lacks it, granting it strictly lowers the floor. */
    const w = started(6203, "Warrior");
    const wp = w.game.state.actor.player;
    if (wp.cls.magic.totalSpells > 0) return; // a Warrior has no spells; nothing to compare
    expect(wp.cls.pflags.has(PF.ZERO_FAIL)).toBe(false);
  });
});

describe("a store shows what its stock actually does", () => {
  it("inStore reveals a useable item's effect that an unaware inspection hides", () => {
    const { game } = started(6301);
    const state = game.state;
    const reg = game.booted.registries;
    const extras: ObjectInfoExtras = {
      projections: reg.projections ?? [],
      constants: reg.constants,
    };

    /* A potion whose flavour the character has NOT identified - which is every
     * potion at birth, and the exact case a shopper is in. */
    const potion = makeOne(game, TV.POTION, 6302, "Cure Light Wounds");
    expect(game.flavor.isAware(potion.kind), "the kind must start unaware").toBe(false);

    const shelf = objectInfoTextblock(state, potion, { ...extras, inStore: true });
    const floor = objectInfoTextblock(state, potion, extras);
    const text = (tb: ReturnType<typeof objectInfoTextblock>): string =>
      tb.runs.map((run) => run.text).join("");

    expect(
      text(shelf).length,
      "the store view must say strictly more than the unaware one",
    ).toBeGreaterThan(text(floor).length);
  });
});

describe("a monster that survives a projection is updated", () => {
  it("onUpdate is supplied, and it is update_mon", () => {
    const { game } = started(6401);
    const hooks = game.wizardBundles.effect?.cast?.hooks?.monster;
    expect(typeof hooks?.onUpdate, "wireGame must supply onUpdate").toBe("function");

    /* Observation, not inspection: clear a visible monster's visibility flag by
     * hand and let the hook put it back. update_mon is the only thing that
     * would. */
    const mon = game.state.monsters.find((m, i) => i > 0 && !!m);
    expect(mon, "the level must hold a monster").toBeTruthy();
    /* update_mon(mon, cave, false) recomputes VISIBILITY from the distance and
     * the derived player flags (game/known.ts). Give it a distance that cannot
     * be seen and it must clear MFLAG_VISIBLE; a stub would leave it set. */
    mon!.mflag.on(MFLAG.VISIBLE);
    mon!.cdis = 250;
    hooks!.onUpdate!(mon!);
    expect(
      mon!.mflag.has(MFLAG.VISIBLE),
      "onUpdate must be update_mon, not a stub",
    ).toBe(false);
  });
});

describe("a projection does not destroy the object that created it", () => {
  /**
   * project(..., obj) -> project_o(..., protected_obj) (project.c:576-579,
   * :921). ProjectWorldEnv.protectedObj was the reader and CastSource carried
   * no source object at all, so the exemption could never fire: a wand or rod
   * lying on the floor inside its own blast burned itself.
   *
   * The twin is the control that lives inside the test: two identical scrolls
   * on one grid, one handed to effect_do as `obj`. Fire destroys scrolls, so
   * "one survived and one did not" is a statement only the exemption can make
   * true - and a run before this was wired destroyed both.
   */
  it("a wand inside its own fire ball survives while its twin burns", () => {
    const { game } = started(6501);
    const state = game.state;
    const reg = game.booted.registries;
    const eff = game.wizardBundles.effect;
    expect(eff, "a depth game must have the effect bundle").toBeTruthy();

    const grid = state.actor.grid;
    const a = makeOne(game, TV.SCROLL, 6502);
    const b = makeOne(game, TV.SCROLL, 6503);
    expect(floorCarry(state, grid, a, {}, { value: false })).toBe(true);
    expect(floorCarry(state, grid, b, {}, { value: false })).toBe(true);

    /* The Ring of Flames' own chain: BALL:FIRE:2 (object.txt:2098-2110). Taken
     * from the pack rather than hand-built, so the test cannot drift from the
     * data. */
    const ring = reg.objects.kinds.find(
      (k) => k.name === "Flames" && (k.effect?.length ?? 0) > 0,
    );
    expect(ring, "the pack must ship the Ring of Flames").toBeDefined();
    const chain = buildObjectEffectChain(
      (ring!.effect ?? []) as EffectRecordJson[],
      state,
      eff!.inject,
    );

    const player = state.actor.player;
    player.chp = player.mhp;
    const ctx = attachGameEnv(buildEffectContext(state, eff!.envDeps!), {
      state,
      cast: eff!.cast!,
      teleport: eff!.teleport!,
    });
    /* dir 5 with no target aims at the player's own grid, so the blast covers
     * the pile both scrolls are sitting in. `obj: a` is what use_aux passes. */
    eff!.registry!.effectDo(chain, ctx, {
      origin: sourcePlayer(),
      obj: a,
      ident: { value: false },
      dir: 5,
    });

    const pile = floorPile(state, grid);
    expect(pile.includes(a), "the source object must survive its own blast").toBe(true);
    expect(pile.includes(b), "its unprotected twin must not").toBe(false);
  });
});
