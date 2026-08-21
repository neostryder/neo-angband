/**
 * What a `registry:*` capability actually gates, measured rather than assumed.
 *
 * The gate in `packages/core/src/mod/registry-host.ts` is real and it works: a
 * facade whose capability the manifest did not declare throws. What it does NOT
 * do is put the underlying registry out of reach, because the same live object
 * arrives at the plugin a second time through `ctx` - `ctx.registries` carries
 * the bound `CoreRegistries`, `ctx.state` carries the live `GameState`, and
 * `ctx.core` is the whole engine namespace including its module-level registry
 * singletons. All three are handed over with no capability check, by design: a
 * mod is meant to be able to LOOK at everything the game is made of without
 * declaring anything.
 *
 * So the gate is a DECLARATION, not a containment boundary, and the honest
 * statement of what it buys is: the manifest says what this mod means to
 * override, the player sees that list before consenting, the conflict report is
 * built from it, and an author who forgot to declare a domain gets a clear throw
 * instead of a silent surprise. It is not a claim that undeclared code cannot
 * reach the registry, and for in-process code it could not be: the plugin holds
 * the engine.
 *
 * THIS FILE PINS THAT, in both directions, because the two halves are easy to
 * confuse and the difference decides what the consent screen is allowed to say.
 * Every assertion runs against the real producers - `bindCore` over the shipped
 * pack for the registries, `createModRegistryHost` for the gate, and
 * `modPluginContext` for the context - so nothing here is a fixture agreeing
 * with its own premise. A drift guard at the end reads `main.ts` to confirm the
 * shipped wiring really does hand both paths one object; without it every test
 * above could pass over a pair of registries no boot path ever shares.
 *
 * If a later change makes any of this false - a read-only view over
 * `ctx.registries`, a capability gate on `ctx.core` - these tests are where it
 * shows up, and `docs/modding/PLUGINS.md` is the prose that has to move with it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AgentCapabilityError,
  bindCore,
  createModRegistryHost,
  tvalRegistry,
} from "@rpgm-tools/neo-angband-core";
import type { CoreRegistries } from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { loadGamePack } from "./pack";
import { modPluginContext, setModRegistries } from "./mod-context";

const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/**
 * A plugin manifest that declares NO registry domain. `event:turn-start` is
 * there so the pack is a plugin asking for something rather than a pack asking
 * for nothing: a set that is merely empty could pass a gate that fails open, and
 * this file is about what a granted-something mod can still reach.
 */
const NO_REGISTRY_CAPS: PackManifest = {
  id: "reach-probe",
  name: "Reach probe",
  version: "1.0.0",
  shape: "plugin",
  capabilities: ["event:turn-start"],
};

/** The real bound registries, from the shipped pack. Bound once; it is not cheap. */
let bound: CoreRegistries | undefined;
function registries(): CoreRegistries {
  bound ??= bindCore(loadGamePack());
  return bound;
}

/**
 * The gated host, wired exactly as `main.ts` wires it for a folder plugin - the
 * three targets this file is about read off the same `CoreRegistries` the
 * context reports.
 */
function gatedHost(reg: CoreRegistries): ReturnType<typeof createModRegistryHost> {
  return createModRegistryHost(
    {
      rooms: reg.rooms,
      profiles: reg.profiles,
      glyphs: reg.rooms.glyphs,
      tval: tvalRegistry(),
    },
    CapabilitySet.fromManifest(NO_REGISTRY_CAPS),
  );
}

/** The context that same plugin is handed, through the real latch. */
function pluginContext(reg: CoreRegistries): ReturnType<typeof modPluginContext> {
  setModRegistries(reg);
  return modPluginContext(
    NO_REGISTRY_CAPS.id,
    {},
    undefined,
    {},
    { capabilities: CapabilitySet.fromManifest(NO_REGISTRY_CAPS) },
  );
}

describe("the gate refuses an undeclared domain", () => {
  it("throws on rooms, profiles and glyphs, naming the capability to declare", () => {
    const host = gatedHost(registries());
    expect(() => host.rooms.register("reach:probe", () => true)).toThrow(AgentCapabilityError);
    expect(() => host.rooms.register("reach:probe", () => true)).toThrow(/registry:room/u);
    expect(() => host.profiles.registerBuilder("reach:probe", () => undefined as never)).toThrow(
      /registry:profile/u,
    );
    expect(() => host.glyphs.set("vault", "Q", {})).toThrow(/registry:glyph/u);
    expect(() => host.tval.classes.set("reach:isProbe", () => true)).toThrow(/registry:tval/u);
  });
});

describe("ctx hands the same live objects over ungated", () => {
  it("reports the registries by identity, not as a copy", () => {
    const reg = registries();
    const ctx = pluginContext(reg);
    /* The whole finding in one line: what the facade guards and what the context
     * reports are one object. A copy here would make every assertion below a
     * statement about a clone nothing else reads. */
    expect(ctx.registries).toBe(reg);
    expect(ctx.registries?.rooms).toBe(reg.rooms);
    expect(ctx.registries?.profiles).toBe(reg.profiles);
    expect(ctx.registries?.rooms.glyphs).toBe(reg.rooms.glyphs);
  });

  it("installs a room builder the gate had just refused", () => {
    const reg = registries();
    const ctx = pluginContext(reg);
    expect(reg.rooms.has("reach:ungated-room")).toBe(false);
    ctx.registries?.rooms.register("reach:ungated-room", () => true);
    /* Not "the registry accepted a write" but "generation would now select it":
     * `get` is what `build_room` calls, so a builder visible here is a builder
     * the level generator would run. */
    expect(typeof reg.rooms.get("reach:ungated-room")).toBe("function");
  });

  it("installs a cave builder and a dungeon profile the gate had just refused", () => {
    const reg = registries();
    const ctx = pluginContext(reg);
    const builder = ((): never => {
      throw new Error("never called");
    }) as unknown as Parameters<typeof reg.profiles.registerBuilder>[1];
    ctx.registries?.profiles.registerBuilder("reach:ungated-cave", builder);
    expect(reg.profiles.hasBuilder("reach:ungated-cave")).toBe(true);
    /* addProfile too, which is the half that changes what a player GETS at a
     * depth. The facade refuses a profile naming an unregistered builder; the
     * ungated path has no such check, which is a second, smaller thing the
     * facade was doing that a mod can now skip. */
    const before = reg.profiles.list().length;
    reg.profiles.addProfile({
      ...reg.profiles.list()[0]!,
      name: "reach:ungated-profile",
      builder: "reach:ungated-cave",
    });
    expect(reg.profiles.list()).toHaveLength(before + 1);
    expect(reg.profiles.find("reach:ungated-profile")?.builder).toBe("reach:ungated-cave");
  });

  it("installs a vault glyph handler the gate had just refused", () => {
    const reg = registries();
    const ctx = pluginContext(reg);
    expect(reg.rooms.glyphs.has("vault", "Q")).toBe(false);
    ctx.registries?.rooms.glyphs.set("vault", "Q", { terrain: () => undefined });
    expect(reg.rooms.glyphs.handlerFor("vault", "Q")).not.toBeNull();
  });
});

describe("ctx.core reaches the module-level registries the same way", () => {
  it("is the very singleton the tval facade writes through", () => {
    /* The three above need `ctx.registries` to be reachable. This one does not:
     * `tvalRegistry` is a module-level singleton and `ctx.core` is the module
     * namespace, so the twin for `registry:tval` was reachable before
     * `ctx.registries` existed and stays reachable if it goes away. The same is
     * true of the rune, randart, effect-info, message-type and sound-pref
     * registries, and of `ctx.state` for blows, stores, projections, ui-entry,
     * command verbs and the monster-turn hook. */
    const core = pluginContext(registries()).core as unknown as {
      tvalRegistry: typeof tvalRegistry;
    };
    expect(core.tvalRegistry()).toBe(tvalRegistry());
    core.tvalRegistry().classes.set("reach:isProbe", () => true);
    expect(tvalRegistry().classes.has("reach:isProbe")).toBe(true);
  });

  it("exports the gate itself, which grants everything when handed no capabilities", () => {
    /* Absent capabilities means a fully trusted host, which is the documented
     * convention the perceive/act facades share and which every headless caller
     * relies on. It also means the ungated host is one call away for anything
     * holding the namespace, so a gate on `ctx.core` would have to withhold this
     * export as well. Named here so a future reader does not mistake the three
     * tests above for the whole of it. */
    const core = pluginContext(registries()).core as unknown as {
      createModRegistryHost: typeof createModRegistryHost;
    };
    const ungated = core.createModRegistryHost({ rooms: registries().rooms });
    expect(() => ungated.rooms.register("reach:selfhost", () => true)).not.toThrow();
  });
});

describe("the shipped wiring really does share one object (drift guard)", () => {
  it("passes booted.registries to both the gate and the latch", () => {
    /* Every test above would still pass if `main.ts` built the gate over a
     * different set from the one it latches, and the finding would be false in
     * the game while green here. These four lines are what make it true. */
    expect(MAIN_TS_SOURCE).toMatch(/setModRegistries\(booted\.registries\);/u);
    expect(MAIN_TS_SOURCE).toMatch(/rooms: booted\.registries\.rooms,/u);
    expect(MAIN_TS_SOURCE).toMatch(/profiles: booted\.registries\.profiles,/u);
    expect(MAIN_TS_SOURCE).toMatch(/glyphs: booted\.registries\.rooms\.glyphs,/u);
  });
});
