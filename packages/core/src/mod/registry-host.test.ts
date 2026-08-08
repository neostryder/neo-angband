/**
 * The in-process registry host (W2.2): capability gating and delegation to the
 * four live registries. The gate follows the perceive/act convention - absent
 * capabilities means a trusted host (all granted); a present-but-narrow set
 * throws AgentCapabilityError for the domains it omits, at call time.
 */

import { describe, expect, it, vi } from "vitest";
import { AgentCapabilityError } from "../agent/types.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { ActionRegistry } from "../game/player-turn.js";
import type { GameState } from "../game/context.js";
import type { RoomRegistry } from "../gen/room.js";
import { DungeonProfiles } from "../gen/cave.js";
import type { DunProfile } from "../gen/cave.js";
import { createModRegistryHost } from "./registry-host.js";
import { VocabularyRegistry } from "./vocabulary.js";

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
  return {
    effects: new EffectRegistry(),
    rooms,
    profiles,
    commands: new ActionRegistry(),
    state,
    vocab,
    _rooms: rooms,
    _profiles: profiles,
    _state: state,
    _vocab: vocab,
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
    expect(() => host.monsters.setTurnHook(() => true)).not.toThrow();
    expect(t._state.monsterTurnHook).toBeTypeOf("function");
    // W2.3 vocab domain is granted too.
    expect(() =>
      host.vocab.define({ kind: "stat", term: "demo:luck" }),
    ).not.toThrow();
    host.vocab.setValue("player", "demo:luck", 7);
    expect(host.vocab.getValue("player", "demo:luck")).toBe(7);
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
    expect(() => host.monsters.setTurnHook(() => true)).toThrow(
      /registry:monster/,
    );
    expect(() =>
      host.vocab.define({ kind: "flag", term: "mod:cursed" }),
    ).toThrow(/registry:vocab/);
    expect(() => host.profiles.list()).toThrow(/registry:profile/);
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
