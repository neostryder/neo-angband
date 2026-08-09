/**
 * TeleportEnv has a producer for every field, and it is the live game.
 *
 * WHAT THIS EXISTS TO CATCH. wireGame built the teleport environment as
 * `preds ? { seven fields } : undefined`. Nine of TeleportEnv's sixteen members
 * therefore had NO producer anywhere in the shipped game, and every one of them
 * is an ordinary upstream read whose subsystem has long since been built:
 *
 *   hasNoTeleport / onLearnNoTeleport  the OF_NO_TELEPORT curse never blocked a
 *                                      teleport, and its rune was never learned
 *   isDamaging                         a teleport could land the player in lava
 *   resistsNexus                       nexus resistance did not foil a hostile
 *                                      teleport-level
 *   maxPlayerDepth / maxDepth          force_descend targeted the CURRENT depth
 *                                      and the dungeon bottom was hardcoded 128
 *   getAimTarget                       Dimension Door returned false, always
 *   targetMonster                      a monster teleporting the monster it was
 *                                      aiming at teleported itself instead
 *   onMonsterPostMove                  no view refresh after a monster hop
 *
 * game/effect-teleport.test.ts passes a TeleportEnv of its own to every one of
 * these paths, which is exactly why none of it showed. So this file supplies
 * nothing: it reads `wizardBundles.effect.teleport` - the very object wireGame
 * built and every spell, wand, trap and monster breath reaches the handlers
 * through - and drives the real handlers with it.
 *
 * The three player reads are asserted to be LIVE, not frozen. The env is built
 * once per game and shared by reference, so a captured boolean would answer for
 * the character as they were at wiring time; each of those assertions changes
 * the state underneath and demands the seam notice.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, ELEM, FEAT, OF, SQUARE } from "../generated/index.js";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import { DDGRID, loc, locEq, locSum } from "../loc.js";
import type { Loc } from "../loc.js";
import type { EffectContext } from "../effects/interpreter.js";
import { sourceMonster, sourcePlayer } from "../effects/interpreter.js";
import { buildEffectContext } from "../game/effect-env.js";
import { attachGameEnv } from "../game/effect-game-env.js";
import { hasTeleportDestinationPrereqs } from "../game/effect-teleport.js";
import { gearGet } from "../game/gear.js";

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

interface Live {
  game: StartedGame;
  messages: string[];
}

function started(seed: number, depth = 6): Live {
  const game = startGame(pack, { seed, depth, className: "Warrior" });
  const messages: string[] = [];
  game.state.msg = (t: string): void => {
    messages.push(t);
  };
  return { game, messages };
}

/** The env wireGame built - not one this test assembled. */
function liveTeleport(game: StartedGame) {
  const eff = game.wizardBundles.effect;
  expect(eff, "a depth game must have the effect bundle").toBeTruthy();
  const tp = eff!.teleport;
  expect(tp, "wireGame must supply a TeleportEnv").toBeTruthy();
  return tp!;
}

/**
 * An effect context over the LIVE bundle - the same composition useAux and
 * spellCast build, so a handler run through it sees exactly what it sees in
 * play.
 */
function liveCtx(game: StartedGame): EffectContext {
  const eff = game.wizardBundles.effect!;
  return attachGameEnv(buildEffectContext(game.state, eff.envDeps!), {
    state: game.state,
    cast: eff.cast!,
    teleport: eff.teleport!,
    ...(eff.general ? { general: eff.general } : {}),
  });
}

describe("wireGame supplies every TeleportEnv member", () => {
  it("leaves none of the sixteen without a producer", () => {
    const { game } = started(5101);
    const tp = liveTeleport(game);
    /* The nine that had none. Naming them one by one rather than counting keys
     * means a future removal fails HERE, with the field's name in the output. */
    for (const key of [
      "hasNoTeleport",
      "onLearnNoTeleport",
      "onMonsterPostMove",
      "getAimTarget",
      "isDamaging",
      "resistsNexus",
      "forceDescend",
      "maxPlayerDepth",
      "maxDepth",
    ] as const) {
      expect(tp[key], `wireGame must supply ${key}`).toBeDefined();
    }
    /* And the seven that always had one. */
    for (const key of [
      "isPlayerTrap",
      "isWarded",
      "isWebbed",
      "isQuest",
      "getNextLevel",
      "changeLevel",
      "onPlayerPostMove",
    ] as const) {
      expect(tp[key], `wireGame must still supply ${key}`).toBeDefined();
    }
  });

  it("z_info->max_depth comes from the bound constants, not a hardcoded 128", () => {
    const { game } = started(5102);
    expect(liveTeleport(game).maxDepth).toBe(game.booted.registries.constants.maxDepth);
  });

  it("the player reads are LIVE, not frozen at wiring time", () => {
    const { game } = started(5103);
    const tp = liveTeleport(game);
    const player = game.state.actor.player;

    /* player->max_depth. The old default was "the current depth", which is what
     * made force_descend target the level the player is standing on. */
    expect(tp.maxPlayerDepth).toBe(player.maxDepth);
    player.maxDepth = player.maxDepth + 7;
    expect(tp.maxPlayerDepth, "a captured number would still read the old one").toBe(
      player.maxDepth,
    );

    /* player_resists(ELEM_NEXUS) off the live derived state. */
    const before = tp.resistsNexus;
    const el = game.state.playerState?.elInfo[ELEM.NEXUS];
    expect(el, "the derived state must carry a nexus element row").toBeDefined();
    el!.resLevel = before ? 0 : 1;
    expect(tp.resistsNexus, "a captured boolean would not move").toBe(!before);

    /* OPT(player, birth_force_descend) off the live option store. A birth
     * option is frozen after creation, so the discriminator is a game BORN with
     * it rather than a mid-run flip - the seam still has to read the store
     * rather than a compiled-in false. */
    expect(tp.forceDescend).toBe(false);
    const forced = startGame(pack, {
      seed: 5104,
      depth: 6,
      className: "Warrior",
      optionOverrides: { birth_force_descend: true },
    });
    expect(forced.state.options?.get("birth_force_descend")).toBe(true);
    expect(liveTeleport(forced).forceDescend, "the seam must read the store").toBe(true);
  });
});

describe("the OF_NO_TELEPORT curse blocks a teleport and teaches its rune", () => {
  /**
   * A curse is what carries this flag upstream (curse.txt:326
   * "anti-teleportation"), but a curse needs an object that rolled it. The flag
   * is put on a real EQUIPPED object instead, which is the same thing
   * player_of_has reads (game/context.ts playerOfHas walks the body slots
   * through runeEnv.slotObject).
   */
  function cursePlayer(game: StartedGame): boolean {
    const player = game.state.actor.player;
    for (let i = 0; i < player.body.count; i++) {
      const handle = player.equipment[i] ?? 0;
      if (!handle) continue;
      const obj = gearGet(game.state.gear, handle);
      if (!obj) continue;
      obj.flags.on(OF.NO_TELEPORT);
      return true;
    }
    return false;
  }

  it("CONTROL: with no curse, a teleport moves the player", () => {
    const { game, messages } = started(5201);
    const before = game.state.actor.grid;
    const ran = game.effects!.effectSimple(EF.TELEPORT, liveCtx(game), {
      origin: sourcePlayer(),
      diceString: "40",
    });
    expect(ran).toBe(true);
    expect(messages).not.toContain("Teleportation forbidden!");
    expect(locEq(game.state.actor.grid, before), "the player must have moved").toBe(false);
  });

  it("with the curse worn, the teleport is refused and the rune is learned", () => {
    const { game, messages } = started(5201);
    expect(cursePlayer(game), "the character must be wearing something").toBe(true);
    expect(liveTeleport(game).hasNoTeleport, "playerOfHas must see the worn flag").toBe(
      true,
    );
    const before = game.state.actor.grid;

    game.effects!.effectSimple(EF.TELEPORT, liveCtx(game), {
      origin: sourcePlayer(),
      diceString: "40",
    });

    expect(messages).toContain("Teleportation forbidden!");
    expect(locEq(game.state.actor.grid, before), "the player must not have moved").toBe(
      true,
    );
    /* equip_learn_flag: the whole point of the second half of the pair. */
    expect(
      game.state.actor.player.objKnown.flags.has(OF.NO_TELEPORT),
      "the rune must now be known",
    ).toBe(true);
  });
});

describe("Dimension Door (EF_TELEPORT_TO, the player-choice branch)", () => {
  it("CONTROL: with no direction pre-resolved, it aborts and nobody moves", () => {
    const { game } = started(5301);
    game.state.effectAimDir = null;
    const before = game.state.actor.grid;
    const ran = game.effects!.effectSimple(EF.TELEPORT_TO, liveCtx(game), {
      origin: sourcePlayer(),
    });
    /* upstream `if (!get_aim_dir(&dir)) return false` - the cancel path. */
    expect(ran, "a cancelled aim prompt aborts the effect").toBe(false);
    expect(locEq(game.state.actor.grid, before)).toBe(true);
  });

  it("a pre-resolved direction lands the player near the adjacent grid", () => {
    const { game } = started(5301);
    const start = game.state.actor.grid;
    /* Every keypad direction in turn, so this does not rest on one lucky
     * neighbour being passable. The landing search widens until it succeeds, so
     * "near" is the assertion the C supports - loc_offset(start, ddx, ddy) is
     * the AIM, not the destination. */
    let moved = 0;
    for (const dir of [1, 2, 3, 4, 6, 7, 8, 9]) {
      const g = started(5301);
      g.game.state.effectAimDir = dir;
      const aim: Loc = locSum(g.game.state.actor.grid, DDGRID[dir] ?? loc(0, 0));
      const ran = g.game.effects!.effectSimple(EF.TELEPORT_TO, liveCtx(g.game), {
        origin: sourcePlayer(),
      });
      expect(ran, `direction ${dir} must not abort`).toBe(true);
      const landed = g.game.state.actor.grid;
      expect(
        Math.max(Math.abs(landed.x - aim.x), Math.abs(landed.y - aim.y)),
        `direction ${dir} landed too far from its aim`,
      ).toBeLessThanOrEqual(8);
      if (!locEq(landed, start)) moved++;
    }
    expect(moved, "at least one direction must actually relocate the player").toBeGreaterThan(0);
  });

  it("DIR_TARGET with no live target is the cancel the C's while() loop produces", () => {
    const { game } = started(5302);
    game.state.effectAimDir = 5;
    game.state.target = { ...game.state.target, grid: loc(0, 0), midx: 0, set: false };
    const before = game.state.actor.grid;
    const ran = game.effects!.effectSimple(EF.TELEPORT_TO, liveCtx(game), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(locEq(game.state.actor.grid, before)).toBe(true);
  });
});

describe("the landing search refuses damaging terrain", () => {
  it("square_isdamaging is wired, so lava is not a legal destination", () => {
    const { game } = started(5401);
    const tp = liveTeleport(game);
    const chunk = game.state.chunk;

    /* Find a passable grid, make it fiery, and ask the LIVE env. Before this
     * was wired, isDamaging was undefined and the `tp.isDamaging?.(grid)` guard
     * evaluated to undefined - i.e. "not damaging" - for every grid on every
     * level. */
    let target: Loc | null = null;
    for (let y = 1; y < chunk.height - 1 && !target; y++) {
      for (let x = 1; x < chunk.width - 1; x++) {
        const g = loc(x, y);
        if (chunk.isPassable(g) && chunk.mon(g) === 0) {
          target = g;
          break;
        }
      }
    }
    expect(target, "the level must have a free passable grid").not.toBeNull();
    expect(hasTeleportDestinationPrereqs(game.state, target!, true, tp)).toBe(true);

    chunk.setFeat(target!, FEAT.LAVA);
    expect(chunk.isDamaging(target!), "the grid must now be fiery").toBe(true);
    expect(
      hasTeleportDestinationPrereqs(game.state, target!, true, tp),
      "a fiery grid must be refused",
    ).toBe(false);
  });
});

describe("monster_target_monster reaches the teleport handlers", () => {
  it("EF_TELEPORT_LEVEL from a monster removes the monster it is aiming at", () => {
    const { game } = started(5501);
    const state = game.state;
    const live = state.monsters
      .map((m, i) => (m && i > 0 ? i : 0))
      .filter((i) => i > 0);
    expect(live.length, "the level must hold at least two monsters").toBeGreaterThan(1);
    const caster = live[0]!;
    const victim = live[1]!;
    /* mon->target.midx: the port has carried this since monster targeting
     * landed, which is what made the "#19 deferred" seam an excuse rather than
     * a gap. */
    state.monsters[caster]!.target = {
      ...state.monsters[caster]!.target,
      midx: victim,
    };

    const ran = game.effects!.effectSimple(EF.TELEPORT_LEVEL, liveCtx(game), {
      origin: sourceMonster(caster),
    });

    expect(ran).toBe(true);
    expect(state.monsters[victim], "the targeted monster is simply gone").toBeFalsy();
    expect(state.monsters[caster], "the caster stays").toBeTruthy();
  });

  it("CONTROL: with no monster target, the same cast teleports the PLAYER's level", () => {
    const { game } = started(5501);
    const state = game.state;
    const live = state.monsters
      .map((m, i) => (m && i > 0 ? i : 0))
      .filter((i) => i > 0);
    const caster = live[0]!;
    expect(state.monsters[caster]!.target.midx, "no monster target").toBe(0);
    const others = live.length;

    game.effects!.effectSimple(EF.TELEPORT_LEVEL, liveCtx(game), {
      origin: sourceMonster(caster),
    });

    /* Nobody was deleted; the player path ran instead (it either changes level
     * or says "Nothing happens.", both of which leave the monsters alone). */
    expect(
      state.monsters.filter((m, i) => m && i > 0).length,
      "no monster may be removed when none was targeted",
    ).toBe(others);
  });
});

describe("SQUARE.NO_TELEPORT still wins, curse or not", () => {
  it("refuses a long teleport from a no-teleport grid", () => {
    const { game, messages } = started(5601);
    game.state.chunk.sqinfoOn(game.state.actor.grid, SQUARE.NO_TELEPORT);
    const before = game.state.actor.grid;
    game.effects!.effectSimple(EF.TELEPORT, liveCtx(game), {
      origin: sourcePlayer(),
      diceString: "40",
    });
    expect(messages).toContain("Teleportation forbidden!");
    expect(locEq(game.state.actor.grid, before)).toBe(true);
  });
});
