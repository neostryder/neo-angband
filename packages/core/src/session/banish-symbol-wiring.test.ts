/**
 * EF_BANISH has a producer, and it is the live game.
 *
 * WHAT THIS EXISTS TO CATCH. `GameEffectEnv.banishSymbol` was declared, typed,
 * documented and READ by the handler (game/effect-monster.ts) - and nothing in
 * the shipped game ever supplied it. `env.banishSymbol ? env.banishSymbol() :
 * null` therefore evaluated to null on every real cast, the handler returned
 * false, and the Banishment spell (class.txt:429), the Scroll of Banishment
 * (object.txt:2776), the Staff of Banishment (object.txt:4364) and the artifact
 * activation all silently did nothing. game/effect-monster.test.ts passed the
 * whole time: it supplies the seam itself, as every harness did.
 *
 * So this file supplies nothing. It starts a REAL game, puts a real Scroll of
 * Banishment in the pack, and runs the REAL "read" command with the glyph
 * riding on the command exactly as the shell's prompt puts it there - then
 * counts the monsters. The control is the same command with no glyph: it must
 * banish nothing and consume nothing, which is what makes "the monsters went
 * away" a statement that had a way to be false.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TV } from "../generated/index.js";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import { banishSymbolRequest, BANISH_PROMPT } from "../game/effect-monster.js";
import { buildObjectEffectChain } from "../game/obj-cmd.js";
import type { EffectRecordJson } from "../obj/types.js";
import { gearGet, invenCarry } from "../game/gear.js";
import { monsterIsUnique } from "../mon/predicate.js";
import { objectPrep } from "../obj/make.js";
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

/** The live monsters, by the glyph EF_BANISH matches on (original race first). */
function glyphCensus(game: StartedGame): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 1; i < game.state.monsters.length; i++) {
    const mon = game.state.monsters[i];
    if (!mon || monsterIsUnique(mon)) continue;
    const glyph = (mon.originalRace ?? mon.race).dChar;
    counts.set(glyph, (counts.get(glyph) ?? 0) + 1);
  }
  return counts;
}

/**
 * A real game with a real Scroll of Banishment in the pack.
 *
 * The player's hit points are left ALONE. An early draft set chp = mhp = 5000
 * and the control read them back as 28: the command path recomputes the derived
 * player state and clamps chp to the real maximum, so the inflated pool never
 * survived to the effect. The 1d4-per-monster rebound is survived instead by
 * choosing a glyph whose worst-case damage fits inside the real pool
 * (survivableGlyph), which is a bound the test can state rather than fake.
 */
function gameWithScroll(seed: number): { game: StartedGame; handle: number } {
  const game = startGame(pack, { seed, depth: 12 });
  const reg = game.booted.registries;
  const kind = reg.objects.kinds.find(
    (k) => k.tval === TV.SCROLL && k.name === "Banishment",
  );
  expect(kind, "the shipped object.txt must define a Scroll of Banishment").toBeDefined();
  const scroll = objectPrep(new Rng(seed), reg.objects, reg.constants, kind!, 0, "minimise");

  /* Straight into the pack rather than through a floor drop and pickup: the
   * subject is the command's tgtsymbol plumbing, and a pickup that failed for
   * an unrelated reason would make this test silently measure nothing. */
  const handle = invenCarry(game.state.gear, game.state.actor.player, scroll, {
    quiverSlotSize: reg.constants.quiverSlotSize,
    thrownQuiverMult: reg.constants.thrownQuiverMult,
  });
  expect(handle, "the scroll must reach the pack").toBeGreaterThan(0);
  return { game, handle };
}

/**
 * The most numerous glyph whose worst case (4 damage a head) still leaves the
 * player alive - so the assertion is about a SET of monsters, not one lucky
 * one, and death is not what ends the run.
 */
function survivableGlyph(
  census: Map<string, number>,
  chp: number,
): [string, number] | null {
  const fits = [...census.entries()]
    .filter(([, n]) => n * 4 < chp)
    .sort((a, b) => b[1] - a[1]);
  return fits[0] ?? null;
}

/** Read the scroll through the registered command, as the shell queues it. */
function readScroll(
  game: StartedGame,
  handle: number,
  tgtsymbol?: string,
): void {
  const action = game.registry.get("read");
  expect(action, "the session must register the read command").toBeDefined();
  action!(game.state, {
    code: "read",
    args: { handle, ...(tgtsymbol !== undefined ? { tgtsymbol } : {}) },
  });
}

describe("the shell's banish glyph reaches EF_BANISH (effect-handler-general.c:2352)", () => {
  it("the RNG-free probe tells the shell to ask, and quotes get_com verbatim", () => {
    const { game } = gameWithScroll(7701);
    const reg = game.booted.registries;
    const kind = reg.objects.kinds.find(
      (k) => k.tval === TV.SCROLL && k.name === "Banishment",
    )!;
    const chain = buildObjectEffectChain(
      (kind.effect ?? []) as EffectRecordJson[],
      game.state,
    );
    expect(banishSymbolRequest(chain, game.state)).toBe(BANISH_PROMPT);
    expect(BANISH_PROMPT).toBe("Choose a monster race (by symbol) to banish: ");

    /* The arena guard precedes the prompt upstream, so the probe must not ask
     * there - the effect says "Nothing happens." and succeeds. */
    game.state.arenaLevel = true;
    expect(banishSymbolRequest(chain, game.state)).toBeNull();
    game.state.arenaLevel = false;

    /* A chain with no BANISH must not make the shell prompt for nothing. */
    const cure = reg.objects.kinds.find(
      (k) => k.tval === TV.POTION && (k.effect?.length ?? 0) > 0,
    );
    expect(cure, "the shipped data must have a potion with an effect").toBeDefined();
    const other = buildObjectEffectChain(
      (cure!.effect ?? []) as EffectRecordJson[],
      game.state,
    );
    expect(banishSymbolRequest(other, game.state)).toBeNull();
  });

  it("CONTROL: with no glyph on the command, nothing is banished and nothing is spent", () => {
    const { game, handle } = gameWithScroll(7702);
    const before = glyphCensus(game);
    expect(
      [...before.values()].reduce((a, b) => a + b, 0),
      "the level must hold non-unique monsters or this proves nothing",
    ).toBeGreaterThan(0);
    const hpBefore = game.state.actor.player.chp;

    readScroll(game, handle);

    expect(glyphCensus(game), "a cancelled get_com banishes nobody").toEqual(before);
    expect(game.state.actor.player.chp, "and costs no hit points").toBe(hpBefore);
    /* effect_do returned false, so use_aux never consumed the scroll - the
     * upstream cancel path, and the reason a mis-keyed prompt is not punished. */
    expect(gearGet(game.state.gear, handle), "the scroll survives a cancel").toBeTruthy();
  });

  it("a glyph on the command removes exactly that race's non-uniques", () => {
    const { game, handle } = gameWithScroll(7702);
    const before = glyphCensus(game);
    const hpBefore = game.state.actor.player.chp;
    const pick = survivableGlyph(before, hpBefore);
    expect(pick, "the level must hold a banishable glyph the player survives").not.toBeNull();
    const [glyph, count] = pick!;

    readScroll(game, handle, glyph);

    const after = glyphCensus(game);
    expect(after.get(glyph) ?? 0, `every non-unique '${glyph}' is gone`).toBe(0);
    for (const [other, n] of before) {
      if (other === glyph) continue;
      expect(after.get(other) ?? 0, `'${other}' is untouched`).toBe(n);
    }
    /* dam += randint1(4) per monster: strictly positive, at most 4 each. The
     * bound is the check that the damage came from THIS banishment. */
    const lost = hpBefore - game.state.actor.player.chp;
    expect(lost).toBeGreaterThanOrEqual(count);
    expect(lost).toBeLessThanOrEqual(count * 4);
    /* And the scroll was used up, because effect_do returned true. */
    expect(gearGet(game.state.gear, handle), "a used scroll is consumed").toBeFalsy();
  });

  it("uniques ignore it, as the warning in the C says", () => {
    const { game, handle } = gameWithScroll(7703);
    const uniques = game.state.monsters.filter((m) => m && monsterIsUnique(m));
    const glyphs = new Set(uniques.map((m) => (m!.originalRace ?? m!.race).dChar));
    if (glyphs.size === 0) return; // nothing to prove on this level
    const glyph = [...glyphs][0]!;

    readScroll(game, handle, glyph);

    for (const mon of uniques) {
      expect(
        game.state.monsters[mon!.midx],
        `the unique ${mon!.race.name} must survive a banish of '${glyph}'`,
      ).toBeTruthy();
    }
  });
});
