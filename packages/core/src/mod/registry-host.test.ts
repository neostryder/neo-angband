/**
 * The in-process registry host (W2.2): capability gating and delegation to the
 * four live registries. The gate follows the perceive/act convention - absent
 * capabilities means a trusted host (all granted); a present-but-narrow set
 * throws AgentCapabilityError for the domains it omits, at call time.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCapabilityError } from "../agent/types.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { ActionRegistry } from "../game/player-turn.js";
import { CommandVerbTable } from "../cmd.js";
import type { GameState } from "../game/context.js";
import type { RoomRegistry } from "../gen/room.js";
import { DungeonProfiles } from "../gen/cave.js";
import type { DunProfile } from "../gen/cave.js";
import {
  StoreBehaviourRegistry,
  registerCoreStoreBehaviour,
} from "../store/store.js";
import {
  BlowEffectRegistry,
  monMeleeAttack,
  registerCoreBlowEffects,
  RESOLVED_BLOW_EFFECTS,
} from "../combat/mon-melee.js";
import type { BlowEffectContext, MonBlowEnv } from "../combat/mon-melee.js";
import { Dice } from "../dice.js";
import { FlagSet } from "../bitflag.js";
import { TMD } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { blankMonster } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import { RF_SIZE } from "../mon/types.js";
import type { BlowEffect, BlowMethod, MonsterRace } from "../mon/types.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";

/**
 * A monster whose one blow carries an effect NAME core has no handler for.
 * Hand-built rather than bound from the pack: the point of these tests is a
 * blow_effects record that does not exist in core, which by definition cannot
 * come from core's pack.
 */
function monsterWithBlow(effectName: string): Monster {
  const method = {
    name: "HIT",
    messages: [],
    msgt: "MON_HIT",
    phys: true,
  } as unknown as BlowMethod;
  const effect = { name: effectName, power: 40 } as unknown as BlowEffect;
  const dice = new Dice();
  dice.parseString("10");
  const race = {
    name: "test-fiend",
    level: 10,
    flags: new FlagSet(RF_SIZE),
    blows: [{ method, effect, dice, diceRaw: "10" }],
  } as unknown as MonsterRace;
  const mon = blankMonster(race);
  mon.hp = 100;
  mon.maxhp = 100;
  return mon;
}

/** A player object with enough filled in to take a blow. */
function blankTestPlayer(): Player {
  const p = blankPlayer(
    {} as never,
    {} as never,
    { slots: [] } as unknown as never,
  );
  p.lev = 1;
  p.chp = 100;
  p.mhp = 100;
  return p;
}

/** A MonBlowEnv that logs what was applied to the world. */
function recordingBlowEnv(player: Player, applied: string[]): MonBlowEnv {
  let died = false;
  return {
    playerGrid: () => loc(0, 0),
    applyReduction: (dam) => dam,
    takeHit: (dam) => {
      player.chp -= dam;
      died = player.chp < 0;
      applied.push(`takeHit(${String(dam)})`);
    },
    get playerDied() {
      return died;
    },
    msg: () => {},
    monName: "The test-fiend",
    showDamage: false,
    monVisible: true,
    elementalDam: (_proj, dam) => dam,
    invenDamage: () => {},
    resists: () => false,
    incTimed: (tmd, amount) => {
      applied.push(`incTimed(${String(tmd)},${String(amount)})`);
      return true;
    },
    saveVsSkill: () => false,
    drainStat: () => {},
    hasHoldLife: () => false,
    drainExp: () => {},
    drainCharges: () => {},
    eatGold: () => false,
    eatItem: () => ({ blinked: false, obvious: true }),
    eatFood: () => {},
    eatLight: () => {},
    disenchant: () => {},
    earthquake: () => {},
    thrust: () => {},
    blinkAway: () => {},
  };
}
import { createModRegistryHost } from "./registry-host.js";
import { ProjectionHandlerRegistry } from "../game/projection-handlers.js";
import { VocabularyRegistry } from "./vocabulary.js";
import { messageTypes } from "../sound/message-types.js";
import { soundPrefRegistry } from "../sound/sound-registry.js";

/** An exact-match capability set (mirrors CapabilitySet's has()). */
function grant(...caps: string[]): { has: (c: string) => boolean } {
  const set = new Set(caps);
  return { has: (c) => set.has(c) };
}

/**
 * A dungeon profile with every field filled in. Written out rather than derived
 * from the gamedata pack because these tests are about the FACADE, not about
 * whether a particular profile record loads.
 */
function profileFixture(name: string, builder: string): DunProfile {
  return {
    name,
    builder,
    blockSize: 11,
    dunRooms: 50,
    dunUnusual: 200,
    maxRarity: 2,
    tun: { rnd: 10, chg: 30, con: 15, pen: 25, jct: 90 },
    str: { den: 5, rng: 40, mag: 3, mc: 90, qua: 2, qc: 40 },
    roomProfiles: [],
    minLevel: 1,
    alloc: 0,
  };
}

function targets() {
  const rooms = { register: vi.fn() } as unknown as RoomRegistry;
  const state = {} as GameState;
  const vocab = new VocabularyRegistry();
  const profiles = new DungeonProfiles();
  profiles.registerBuilder("classic", () => ({ ok: true }) as never);
  const blows = new BlowEffectRegistry();
  registerCoreBlowEffects(blows);
  const stores = new StoreBehaviourRegistry();
  registerCoreStoreBehaviour(stores);
  const projections = new ProjectionHandlerRegistry();
  const menus = { register: vi.fn(), handlerFor: vi.fn(() => null) };
  return {
    effects: new EffectRegistry(),
    rooms,
    profiles,
    blows,
    stores,
    commands: new ActionRegistry(),
    commandVerbs: new CommandVerbTable(),
    state,
    projections,
    menus,
    vocab,
    _rooms: rooms,
    _profiles: profiles,
    _blows: blows,
    _stores: stores,
    _projections: projections,
    _state: state,
    _vocab: vocab,
    _menus: menus,
  };
}

describe("createModRegistryHost - trusted host (no capabilities)", () => {
  it("grants every domain when no capability set is supplied", () => {
    const t = targets();
    const host = createModRegistryHost(t);
    expect(() =>
      host.effects.register("mod:zap", { handler: () => true }),
    ).not.toThrow();
    expect(host.effects.isRegistered("mod:zap")).toBe(true);
    expect(() => host.rooms.register("mod:cave", () => true)).not.toThrow();
    expect(() =>
      host.profiles.registerBuilder("mod:hollow", () => ({ ok: true }) as never),
    ).not.toThrow();
    expect(() => host.commands.register("mod:dance", () => 0)).not.toThrow();
    expect(host.commands.has("mod:dance")).toBe(true);
    expect(() => host.commands.setVerb("mod:dance", "dance with")).not.toThrow();
    expect(host.commands.verbFor("mod:dance")).toBe("dance with");
    expect(() => host.monsters.setTurnHook(() => true)).not.toThrow();
    expect(t._state.monsterTurnHook).toBeTypeOf("function");
    /* The projection domain, on all three sides. Asserted here because this
     * test claims EVERY domain is granted, and a domain it never touches is a
     * claim wider than the check. */
    expect(() => {
      host.projections.feat.set("mod:sludge", () => true);
    }).not.toThrow();
    expect(t._projections.feat.has("mod:sludge")).toBe(true);
    expect(host.projections.obj.has("FIRE")).toBe(true);
    expect(host.projections.player.handlerFor("FIRE")).toBeTypeOf("function");
    // W2.3 vocab domain is granted too.
    expect(() =>
      host.vocab.define({ kind: "stat", term: "demo:luck" }),
    ).not.toThrow();
    host.vocab.setValue("player", "demo:luck", 7);
    expect(host.vocab.getValue("player", "demo:luck")).toBe(7);
    expect(() => host.menus.register("core:game-menu", (_id, rows) => rows)).not.toThrow();
    expect(t._menus.register).toHaveBeenCalledWith("core:game-menu", expect.any(Function));
  });
});

describe("createModRegistryHost - capability gating", () => {
  it("allows a granted domain and throws on an ungranted one", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:effect"));
    // Granted: effect register works.
    expect(() =>
      host.effects.register("mod:zap", { handler: () => true }),
    ).not.toThrow();
    // Ungranted: room/command/monster throw AgentCapabilityError.
    expect(() => host.rooms.register("mod:cave", () => true)).toThrow(
      AgentCapabilityError,
    );
    expect(() => host.commands.register("mod:dance", () => 0)).toThrow(
      /registry:command/,
    );
    expect(() => host.commands.setVerb("mod:dance", "dance with")).toThrow(
      /registry:command/,
    );
    expect(() => host.monsters.setTurnHook(() => true)).toThrow(
      /registry:monster/,
    );
    expect(() =>
      host.vocab.define({ kind: "flag", term: "mod:cursed" }),
    ).toThrow(/registry:vocab/);
    expect(() => host.profiles.list()).toThrow(/registry:profile/);
    expect(() => host.blows.names()).toThrow(/registry:blow/);
    expect(() => host.stores.massProduceTvals()).toThrow(/registry:store/);
    expect(() => host.menus.handlerFor("core:game-menu")).toThrow(/registry:menu/);
  });

  it("gates each domain independently and only at call time", () => {
    const t = targets();
    // Grant only monster; the facade object is built for every domain but the
    // gate is checked per call, so building the host never throws.
    const host = createModRegistryHost(t, grant("registry:monster"));
    expect(() => host.effects.isRegistered("x")).toThrow(AgentCapabilityError);
    expect(() => host.monsters.setTurnHook(() => false)).not.toThrow();
    expect(t._state.monsterTurnHook).toBeTypeOf("function");
  });
});

describe("createModRegistryHost - delegation and targets", () => {
  it("delegates to the live registries", () => {
    const t = targets();
    const host = createModRegistryHost(t);
    host.rooms.register("mod:cave", () => true);
    expect(t._rooms.register).toHaveBeenCalledWith("mod:cave", expect.any(Function));

    const action = vi.fn(() => 5);
    host.commands.register("walk", action);
    // Overriding an existing code replaces the live action.
    expect(t.commands.get("walk")).toBe(action);

    // The verb is a SEPARATE live table, seeded with core's (cmd.ts).
    expect(host.commands.verbFor("walk")).toBe("walk");
    host.commands.setVerb("walk", "stroll");
    expect(t.commandVerbs.verbFor("walk")).toBe("stroll");
  });

  it("setTurnHook(null) clears the state hook", () => {
    const t = targets();
    const host = createModRegistryHost(t);
    host.monsters.setTurnHook(() => true);
    expect(t._state.monsterTurnHook).toBeTypeOf("function");
    host.monsters.setTurnHook(null);
    expect(t._state.monsterTurnHook).toBeUndefined();
  });

  it("throws a clear error when a registry was not wired", () => {
    const host = createModRegistryHost({ effects: null });
    expect(() => host.effects.register("x", { handler: () => true })).toThrow(
      /not available/,
    );
  });
});

describe("createModRegistryHost - the dungeon-profile facade", () => {
  it("registers a cave builder and adds a profile that names it", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:profile"));
    host.profiles.registerBuilder("mod:hollow", () => ({ ok: true }) as never);
    expect(host.profiles.hasBuilder("mod:hollow")).toBe(true);
    host.profiles.addProfile(profileFixture("mod:hollow", "mod:hollow"));
    expect(host.profiles.find("mod:hollow")?.builder).toBe("mod:hollow");
    // Delegation is to the LIVE registry, which is what generation reads.
    expect(t._profiles.find("mod:hollow")).not.toBeNull();
  });

  it("refuses a profile naming a builder nobody registered", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:profile"));
    // The failure would otherwise surface from inside generation on some later
    // level change, with nothing pointing back at the mod that caused it.
    expect(() =>
      host.profiles.addProfile(profileFixture("mod:ghost", "mod:absent")),
    ).toThrow(/not registered/);
    expect(t._profiles.find("mod:ghost")).toBeNull();
  });

  it("hands back a core builder so a mod can wrap rather than replace it", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:profile"));
    const core = host.profiles.builder("classic");
    expect(core).toBeTypeOf("function");
    expect(() => host.profiles.builder("mod:absent")).toThrow(/no cave builder/);
  });

  it("appends, because choose_profile's weighted pass depends on list order", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:profile"));
    host.profiles.registerBuilder("mod:a", () => ({ ok: true }) as never);
    t._profiles.addProfile(profileFixture("core:first", "classic"));
    host.profiles.addProfile(profileFixture("mod:second", "mod:a"));
    expect(host.profiles.list().map((p) => p.name)).toEqual([
      "core:first",
      "mod:second",
    ]);
  });

  it("says which registry was missing when the host did not wire profiles", () => {
    const host = createModRegistryHost({ profiles: null });
    expect(() => host.profiles.list()).toThrow(/"profile" registry is not available/);
  });
});

/**
 * The blow-effect facade. These tests do not stop at "the registry holds what
 * the mod put in it" - the last two run a real `monMeleeAttack` down BOTH paths,
 * because a registry the combat code does not consult is exactly the failure
 * this seam was built to close.
 */
describe("createModRegistryHost - the monster blow facade", () => {
  /** The blow context a handler is called with, filled in enough to resolve. */
  function blowCtx(rng: Rng, baseDamage = 20): BlowEffectContext {
    return {
      rng,
      baseDamage,
      ac: 0,
      rlev: 10,
      phys: true,
      method: { messages: [], msgt: "MON_HIT" } as unknown as BlowMethod,
    };
  }

  it("adds a blow effect core has never heard of, from one description", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:blow"));
    expect(host.blows.has("mod:soulburn")).toBe(false);
    host.blows.define("mod:soulburn", {
      after: () => [{ kind: "timed", effect: "AFRAID", amount: 4 }],
    });
    expect(t._blows.has("mod:soulburn")).toBe(true);
    const handler = t._blows.handlerFor("mod:soulburn");
    expect(handler).not.toBeNull();
    const result = handler?.record(blowCtx(new Rng(1)));
    expect(result?.hpDamage).toBe(20);
    expect(result?.sideEffects).toEqual([
      { kind: "timed", effect: "AFRAID", amount: 4 },
    ]);
  });

  it("hands back a core handler so a mod can wrap rather than replace it", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:blow"));
    const core = host.blows.handlerFor("POISON");
    expect(core).not.toBeNull();
    let wrapped = 0;
    host.blows.register("POISON", {
      record: (ctx) => {
        wrapped += 1;
        return core!.record(ctx);
      },
      live: (ctx, env) => core!.live(ctx, env),
    });
    const out = t._blows.handlerFor("POISON")?.record(blowCtx(new Rng(1)));
    expect(wrapped).toBe(1);
    /* Still core's POISON underneath: the elemental intent is core's, not the
     * wrapper's, so this proves the wrapper called THROUGH rather than around. */
    expect(out?.sideEffects.some((s) => s.kind === "elemental")).toBe(true);
  });

  /**
   * The table and the list that documents it have to be the same 30 names.
   * RESOLVED_BLOW_EFFECTS exists so a test can prove the mapping total against
   * the pack; if a handler were added without joining the list, or listed
   * without being registered, everything else would still pass.
   */
  it("holds exactly the 30 effects RESOLVED_BLOW_EFFECTS names", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:blow"));
    expect([...host.blows.names()].sort()).toEqual([...RESOLVED_BLOW_EFFECTS].sort());
  });

  it("says which registry was missing when the host did not wire blows", () => {
    const host = createModRegistryHost({ blows: null });
    expect(() => host.blows.names()).toThrow(/"blow" registry is not available/);
  });

  /**
   * The two that matter. A mod-registered effect has to reach the combat code,
   * on both of the paths that resolve a blow - a seam only one of them consults
   * would give a modded monster one behaviour in the harness and another in the
   * game, with nothing to say so.
   */
  it("a mod's blow effect reaches the worldless combat path", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:blow"));
    host.blows.define("mod:soulburn", {
      damage: (ctx) => ctx.baseDamage * 2,
      after: () => [{ kind: "timed", effect: "AFRAID", amount: 4 }],
    });

    const player = blankTestPlayer();
    const result = monMeleeAttack(
      new Rng(5),
      monsterWithBlow("mod:soulburn"),
      player,
      { ac: 0, toA: 0 },
      { blowEffects: t._blows },
    );
    expect(result.blows[0]?.effect).toBe("mod:soulburn");
    expect(result.sideEffects).toEqual([
      { kind: "timed", effect: "AFRAID", amount: 4 },
    ]);
    /* damage doubled by the mod's own damage function, not by core. */
    expect(result.totalDamage).toBe(20);
  });

  it("a mod's blow effect reaches the LIVE combat path, applying for real", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:blow"));
    host.blows.define("mod:soulburn", {
      damage: (ctx) => ctx.baseDamage * 2,
      after: () => [{ kind: "timed", effect: "AFRAID", amount: 4 }],
    });

    const player = blankTestPlayer();
    const applied: string[] = [];
    const env = recordingBlowEnv(player, applied);
    const result = monMeleeAttack(
      new Rng(5),
      monsterWithBlow("mod:soulburn"),
      player,
      { ac: 0, toA: 0 },
      { env, blowEffects: t._blows },
    );
    expect(result.blows[0]?.effect).toBe("mod:soulburn");
    /* The SAME description that was recorded as an intent above is applied here
     * through the env - TMD.AFRAID is 4 turns of fear, for real. */
    expect(applied).toContain(`incTimed(${String(TMD.AFRAID)},4)`);
    expect(applied).toContain("takeHit(20)");
  });
});

describe("createModRegistryHost - the store facade", () => {
  it("says which registry was missing when the host did not wire stores", () => {
    const host = createModRegistryHost({ stores: null });
    expect(() => host.stores.massProduceTvals()).toThrow(
      /"store" registry is not available/,
    );
  });

  it("delegates to the live registry, not to a copy of it", () => {
    const t = targets();
    const host = createModRegistryHost(t, grant("registry:store"));
    host.stores.setMassProduce(999, () => 3);
    expect(t._stores.massProduceFor(999)).not.toBeNull();
    host.stores.setWillBuy(42, () => true);
    expect(t._stores.willBuyFor(42)).not.toBeNull();
  });
});

/**
 * Gap rows 20 and 21: the message-vocabulary facade.
 *
 * Two closed tables with no producer - MESSAGE_ENTRIES (154) and
 * SOUND_PREF_ENTRIES (149) - behind one capability, because a mod's new spell
 * needs a message type AND the sound it plays or neither is any use. The
 * mechanics of each are proved in sound/message-types.test.ts and
 * sound/sound-registry.test.ts; what is proved HERE is the facade: that a
 * plugin can reach them at all, and cannot without consent.
 */
describe("createModRegistryHost - the message facade", () => {
  afterEach(() => {
    messageTypes.clear();
    soundPrefRegistry.clear();
  });

  it("defines a message type and binds a sound to it, through the facade", () => {
    const host = createModRegistryHost(targets(), grant("registry:message"));
    const idx = host.messages.define("SOULFIRE", "soulfire");
    expect(idx).toBe(154);
    expect(host.messages.lookup("SOULFIRE")).toBe(154);
    /* And core's own names still resolve through the same door. */
    expect(host.messages.lookup("HIT")).toBe(2);
    expect(host.messages.lookup("XYZZY")).toBe(-1);

    host.messages.addSounds([{ type: "SOULFIRE", sounds: "sf_one sf_two" }]);
    expect(host.messages.sounds()).toEqual([
      { type: "SOULFIRE", sounds: "sf_one sf_two" },
    ]);
    expect(host.messages.types()).toEqual([
      { name: "SOULFIRE", sound: "soulfire", owner: null },
    ]);
  });

  it("defaults to core's module-level registries when the host wires none", () => {
    /* Deliberate, and documented on RegistryTargets: both are process-wide, so
     * there is exactly one of each and a host has nothing else to pass. */
    const host = createModRegistryHost({}, grant("registry:message"));
    host.messages.define("SOULFIRE", "soulfire");
    expect(messageTypes.lookup("SOULFIRE")).toBe(154);
  });

  it("honours an explicit null as 'not available here'", () => {
    const host = createModRegistryHost({ messages: null }, grant("registry:message"));
    expect(() => host.messages.define("SOULFIRE")).toThrow(/host did not wire it/);
  });

  it("refuses every method without registry:message", () => {
    const host = createModRegistryHost(targets(), grant("registry:effect"));
    for (const call of [
      (): void => void host.messages.define("SOULFIRE"),
      (): void => void host.messages.lookup("HIT"),
      (): void => void host.messages.types(),
      (): void => void host.messages.addSounds([{ type: "HIT", sounds: "x" }]),
      (): void => void host.messages.sounds(),
    ]) {
      expect(call).toThrow(AgentCapabilityError);
      expect(call).toThrow(/registry:message/);
    }
    /* And nothing was registered on the way to the throw. */
    expect(messageTypes.size).toBe(0);
    expect(soundPrefRegistry.added()).toEqual([]);
  });
});
