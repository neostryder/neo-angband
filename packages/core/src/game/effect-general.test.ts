import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, TV } from "../generated";
import { loc, locEq } from "../loc";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { GLYPH_DECOY, GLYPH_WARDING } from "../effects/effect";
import { bindTraps } from "../world/trap";
import type { TrapRecordJson } from "../world/trap";
import type { ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { makeRuneEnv } from "../obj/knowledge";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { squareIsWarded, squareIsWebbed } from "./trap";
import type { TrapDeps } from "./trap";
import { disenchantEquipment, registerGeneralHandlers } from "./effect-general";

const trapKinds = bindTraps(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/trap.json", import.meta.url),
        "utf8",
      ),
    ) as { records: TrapRecordJson[] }
  ).records,
);
const trapDeps: TrapDeps = { kinds: trapKinds };

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerGeneralHandlers(r);
  return r;
}

function env(
  state: GameState,
  game: Partial<GameEffectEnv> = {},
  msgs?: string[],
): EffectContext {
  const base: EffectContext = msgs
    ? { rng: state.rng, messages: { msg: (t) => msgs.push(t) } }
    : { rng: state.rng };
  return attachGameEnv(base, {
    state,
    cast: { projections: [], maxRange: 20, playerActor: basicPlayerActor(state) },
    general: { trapDeps },
    ...game,
  });
}

/** A synthetic enchantable item of the given tval. */
let nextKidx = 700;
function makeItem(tval: number, name = "Widget"): GameObject {
  const kind = {
    kidx: nextKidx++,
    tval,
    name,
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = tval;
  obj.number = 1;
  return obj;
}

/** Back the state's rune env with a plain per-slot equipment array. */
function equipArray(state: GameState): (GameObject | null)[] {
  const eq: (GameObject | null)[] = new Array(
    state.actor.player.body.count,
  ).fill(null);
  state.runeEnv = makeRuneEnv(
    (slot) => eq[slot] ?? null,
    (v) => state.rng.randcalcVaries(v),
  );
  return eq;
}

/** The first slot index of the given EQUIP_ type. */
function slotOf(state: GameState, type: string): number {
  const at = state.actor.player.body.slots.findIndex((s) => s.type === type);
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

describe("EF_GLYPH (effect-handler-general.c L700)", () => {
  it("places a glyph of warding under the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(EF.GLYPH, env(state), {
      origin: sourcePlayer(),
      subtype: GLYPH_WARDING,
    });
    expect(squareIsWarded(state, loc(10, 10))).toBe(true);
  });

  it("deploys a decoy and refuses a second one", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const r = registry();
    r.effectSimple(EF.GLYPH, env(state), {
      origin: sourcePlayer(),
      subtype: GLYPH_DECOY,
    });
    expect(state.decoy && locEq(state.decoy, loc(10, 10))).toBe(true);

    const msgs: string[] = [];
    const ran = r.effectSimple(EF.GLYPH, env(state, {}, msgs), {
      origin: sourcePlayer(),
      subtype: GLYPH_DECOY,
    });
    expect(ran).toBe(false);
    expect(msgs).toContain("You can only deploy one decoy at a time.");
  });

  it("no-ops without a game env (worldless)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(
      EF.GLYPH,
      { rng: state.rng },
      { origin: sourcePlayer(), subtype: GLYPH_WARDING },
    );
    expect(squareIsWarded(state, loc(10, 10))).toBe(false);
  });
});

describe("EF_WEB (effect-handler-general.c L732)", () => {
  it("webs the floor around the casting monster", () => {
    const state = makeState({ playerGrid: loc(30, 5), seed: 2 });
    const race = { ...makeRace(), spellPower: 10 };
    const mon = addMon(state, race, loc(10, 10), { hp: 30 });

    registry().effectSimple(
      EF.WEB,
      env(state, { monCurrent: mon.midx }),
      { origin: sourceMonster(mon.midx) },
    );

    /* Radius 1 at spell power 10: the whole 3x3 block is webbed. */
    let webbed = 0;
    for (let y = 9; y <= 11; y++)
      for (let x = 9; x <= 11; x++)
        if (squareIsWebbed(state, loc(x, y))) webbed++;
    expect(webbed).toBe(9);
    /* And nothing beyond the radius. */
    expect(squareIsWebbed(state, loc(12, 10))).toBe(false);
  });

  it("a stronger spinner webs a wider area", () => {
    const state = makeState({ playerGrid: loc(30, 5), seed: 2 });
    const race = { ...makeRace(), spellPower: 50 };
    const mon = addMon(state, race, loc(10, 10), { hp: 30 });
    registry().effectSimple(
      EF.WEB,
      env(state, { monCurrent: mon.midx }),
      { origin: sourceMonster(mon.midx) },
    );
    expect(squareIsWebbed(state, loc(12, 10))).toBe(true);
  });

  it("fails for a player source (no acting monster)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ran = registry().effectSimple(EF.WEB, env(state), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(squareIsWebbed(state, loc(10, 10))).toBe(false);
  });
});

describe("EF_DISENCHANT (effect-handler-general.c L2003)", () => {
  it("disenchants a worn weapon's to-hit and to-dam and refreshes bonuses", () => {
    const state = makeState({ seed: 31 });
    const eq = equipArray(state);
    const sword = makeItem(TV.SWORD, "Test Sword");
    sword.toH = 8;
    sword.toD = 8;
    eq[slotOf(state, "WEAPON")] = sword;
    let refreshes = 0;
    state.updateBonuses = (): void => {
      refreshes++;
    };

    const msgs: string[] = [];
    /* The slot pick is random over all eligible slots; repeat until it
     * lands (deterministic under the fixed seed). */
    for (let i = 0; i < 30; i++) {
      disenchantEquipment(state, { msg: (t) => msgs.push(t) });
    }
    expect(sword.toH).toBeLessThan(8);
    expect(sword.toD).toBeLessThan(8);
    expect(refreshes).toBeGreaterThan(0);
    expect(msgs.some((m) => m.includes("disenchanted!"))).toBe(true);
  });

  it("disenchants armour's to-ac; artifacts can resist", () => {
    const state = makeState({ seed: 32 });
    const eq = equipArray(state);
    const mail = makeItem(TV.HARD_ARMOR, "Test Mail");
    mail.toA = 10;
    mail.artifact = { aidx: 1 } as GameObject["artifact"];
    eq[slotOf(state, "BODY_ARMOR")] = mail;

    const msgs: string[] = [];
    for (let i = 0; i < 40; i++) {
      disenchantEquipment(state, { msg: (t) => msgs.push(t) });
    }
    /* Under the fixed seed both branches fire: some resists, some hits. */
    expect(msgs.some((m) => m.includes("resists disenchantment!"))).toBe(true);
    expect(mail.toA).toBeLessThan(10);
  });

  it("never touches rings, amulets or lights", () => {
    const state = makeState({ seed: 33 });
    const eq = equipArray(state);
    const ring = makeItem(TV.RING, "Test Ring");
    ring.toA = 6;
    eq[slotOf(state, "RING")] = ring;

    for (let i = 0; i < 40; i++) disenchantEquipment(state, {});
    expect(ring.toA).toBe(6);
  });

  it("runs through the effect stack with a game env", () => {
    const state = makeState({ seed: 34 });
    const eq = equipArray(state);
    const sword = makeItem(TV.SWORD);
    sword.toH = 9;
    eq[slotOf(state, "WEAPON")] = sword;

    const r = registry();
    for (let i = 0; i < 30; i++) {
      r.effectSimple(EF.DISENCHANT, env(state), { origin: sourcePlayer() });
    }
    expect(sword.toH).toBeLessThan(9);
  });
});
