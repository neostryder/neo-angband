/**
 * The in-process registry host (W2.2): capability gating and delegation to the
 * four live registries. The gate follows the perceive/act convention - absent
 * capabilities means a trusted host (all granted); a present-but-narrow set
 * throws AgentCapabilityError for the domains it omits, at call time.
 */

import { describe, expect, it, vi } from "vitest";
import { AgentCapabilityError } from "../agent/types";
import { EffectRegistry } from "../effects/interpreter";
import { ActionRegistry } from "../game/player-turn";
import type { GameState } from "../game/context";
import type { RoomRegistry } from "../gen/room";
import { createModRegistryHost } from "./registry-host";
import { VocabularyRegistry } from "./vocabulary";

/** An exact-match capability set (mirrors CapabilitySet's has()). */
function grant(...caps: string[]): { has: (c: string) => boolean } {
  const set = new Set(caps);
  return { has: (c) => set.has(c) };
}

function targets() {
  const rooms = { register: vi.fn() } as unknown as RoomRegistry;
  const state = {} as GameState;
  const vocab = new VocabularyRegistry();
  return {
    effects: new EffectRegistry(),
    rooms,
    commands: new ActionRegistry(),
    state,
    vocab,
    _rooms: rooms,
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
