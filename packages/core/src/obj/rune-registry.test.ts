/**
 * The rune registry's own checks: that core seeded it, that a mod can widen it,
 * that a mod's rune reaches the list every consumer enumerates, and that it
 * cannot silently fall behind `knowledge.ts`.
 *
 * Behaviour parity is `rune-vectors.test.ts`'s job - 99 runes and both signs of
 * all 16 modifiers, recorded before this registry existed. What is here is the
 * seam itself.
 */

import { afterEach, describe, expect, it } from "vitest";

import { OBJ_MOD } from "../generated/index.js";
import { TV } from "../generated/tvals.js";
import {
  buildRuneList,
  objectHasRune,
  objectLearnOnWield,
  playerKnowsRune,
  playerLearnRune,
  runeDesc,
  runeKey,
  runeName,
} from "./knowledge.js";
import { resetRuneRegistry, runeRegistry } from "./rune-registry.js";
import { runeVectorWorld } from "./rune-vectors.fixtures.js";

/** A variety core has never heard of - a mod's own. */
const MOD_VARIETY = "demo:attunement";

describe("the rune registry", () => {
  /* Module-level tables: restore core's arms so one test cannot leak into the
   * next. */
  afterEach(() => {
    resetRuneRegistry();
  });

  it("has an arm in every table for every variety the pack produces", () => {
    /* THE CHECK THIS FILE EXISTS FOR, and it is DERIVED rather than listed: the
     * varieties come from the real rune list, so a variety that gained runes
     * and no handler fails here instead of answering "" / false forever.
     *
     * `name` is deliberately excluded. Its unregistered fallback is the bare
     * rune name, which is upstream's own `default` arm - three of core's seven
     * varieties take it, so requiring an arm there would be requiring core to
     * differ from the C.
     *
     * THE IMPORT IS LOAD-BEARING, and that is the gap-15 lesson repeated: a
     * module-level registry's arms exist only if the seeding module is in the
     * import graph. `buildRuneList` below is what drags `knowledge.ts` in, so
     * no unused-import sweep can quietly empty this test. */
    const world = runeVectorWorld();
    const varieties = [...new Set(buildRuneList(world.env).map((r) => r.variety))];
    expect(varieties.length).toBe(7);

    const reg = runeRegistry();
    const missing = varieties.flatMap((v) =>
      (["desc", "knows", "objectHas", "learn"] as const)
        .filter((table) => !reg[table].has(v))
        .map((table) => `${table}:${v}`),
    );
    expect(missing).toEqual([]);
  });

  it("a mod's rune is invisible, unknowable and unlearnable until it registers", () => {
    /* The BEFORE picture, kept as a test so the seam's value is measured rather
     * than asserted. Note that every one of these is a SILENT wrong answer, not
     * an error - which is why the closed union was worth opening. */
    const world = runeVectorWorld();
    const rune = { variety: MOD_VARIETY, index: 0, name: "attunement" };
    const p = world.player();
    const obj = world.object(TV.RING);

    expect({
      desc: runeDesc(world.env, rune),
      knows: playerKnowsRune(p, rune),
      has: objectHasRune(world.env, obj, rune),
      learned: playerLearnRune(p, world.env, rune, true),
      /* ... except the display name, which falls back to upstream's own
       * default arm. A mod's rune is nameable before it is anything else. */
      name: runeName(rune),
      key: runeKey(rune),
    }).toEqual({
      desc: "",
      knows: false,
      has: false,
      learned: false,
      name: "attunement",
      key: "demo:attunement:attunement",
    });
  });

  it("a registered variety answers every question, with the mod's own store", () => {
    const world = runeVectorWorld();
    const rune = { variety: MOD_VARIETY, index: 0, name: "attunement" };
    const reg = runeRegistry();

    /* The mod keeps its own knowledge, exactly as `mod/vocabulary.ts` intends:
     * core hands the handler the player and never needs a slot of its own. */
    const learnedBy = new Set<object>();

    reg.desc.set(MOD_VARIETY, (_env, r) => `Object attunes the wielder to ${r.name}.`);
    reg.knows.set(MOD_VARIETY, (p) => learnedBy.has(p));
    reg.objectHas.set(MOD_VARIETY, (_env, o) => o.tval === TV.RING);
    reg.learn.set(MOD_VARIETY, (p, env, r, message) => {
      if (learnedBy.has(p)) return false;
      learnedBy.add(p);
      if (message) env.msg?.(`You have learned the rune of ${r.name}.`);
      return true;
    });
    reg.name.set(MOD_VARIETY, (r) => `${r.name} attunement`);

    const p = world.player();
    const obj = world.object(TV.RING);
    world.drain();

    const learned = playerLearnRune(p, world.env, rune, true);
    const messages = world.drain();

    expect({
      desc: runeDesc(world.env, rune),
      name: runeName(rune),
      has: objectHasRune(world.env, obj, rune),
      learned,
      messages,
      knows: playerKnowsRune(p, rune),
      /* Learning it twice must not learn it twice - the same contract core's
       * own arms are held to by the vectors' `learnedAgain` column. */
      again: playerLearnRune(p, world.env, rune, true),
    }).toEqual({
      desc: "Object attunes the wielder to attunement.",
      name: "attunement attunement",
      has: true,
      learned: true,
      messages: ["You have learned the rune of attunement."],
      knows: true,
      again: false,
    });
  });

  it("contribute puts a mod's rune into the list every consumer enumerates", () => {
    /* THE CALLER CHECK. Six handler tables with no way into buildRuneList would
     * be a seam every caller walks past: nothing in core ever asks about a rune
     * that is not in this list. */
    const world = runeVectorWorld();
    const before = buildRuneList(world.env);
    expect(before.some((r) => r.variety === MOD_VARIETY)).toBe(false);

    runeRegistry().contribute(() => [
      { variety: MOD_VARIETY, index: 0, name: "flame" },
      { variety: MOD_VARIETY, index: 1, name: "frost" },
    ]);

    const after = buildRuneList(world.env);
    expect({
      grew: after.length - before.length,
      /* Core's list is untouched and comes FIRST - a contributor appends, it
       * does not interleave. Every consumer keys on the list index, so an
       * insertion in the middle would renumber core's runes. */
      corePrefixUnchanged: after
        .slice(0, before.length)
        .every((r, i) => runeKey(r) === runeKey(before[i]!)),
      added: after.slice(before.length).map((r) => runeKey(r)),
    }).toEqual({
      grew: 2,
      corePrefixUnchanged: true,
      added: ["demo:attunement:flame", "demo:attunement:frost"],
    });
  });

  it("a mod widens a modifier message by WRAPPING, and core's survives", () => {
    const world = runeVectorWorld();
    const reg = runeRegistry();

    /* A modifier core has no arm for says nothing. */
    expect(reg.modMessage.has(OBJ_MOD.TUNNEL)).toBe(false);
    reg.modMessage.set(OBJ_MOD.TUNNEL, (v) =>
      v > 0 ? "Your hands itch to dig." : null,
    );

    /* And an existing arm can be composed rather than shadowed. */
    const inner = reg.modMessage.handlerFor(OBJ_MOD.STR)!;
    reg.modMessage.set(OBJ_MOD.STR, (v) => {
      const core = inner(v);
      return core ? `${core} Mightily so.` : core;
    });

    const say = (mod: number, value: number): string[] => {
      const p = world.player();
      /* blankObject, for the reason rune-vectors.fixtures.ts gives: a prepared
       * ring is a Ring of Strength and would print its own lines first. */
      const obj = world.blankObject(TV.RING);
      obj.modifiers[mod] = value;
      world.drain();
      objectLearnOnWield(p, obj, world.env);
      return world.drain().filter((m) => !m.startsWith("You have learned"));
    };

    expect({
      tunnelUp: say(OBJ_MOD.TUNNEL, 2),
      tunnelDown: say(OBJ_MOD.TUNNEL, -2),
      strUp: say(OBJ_MOD.STR, 2),
      strDown: say(OBJ_MOD.STR, -2),
    }).toEqual({
      tunnelUp: ["Your hands itch to dig."],
      tunnelDown: [],
      strUp: ["You feel stronger! Mightily so."],
      strDown: ["You feel weaker! Mightily so."],
    });
  });

  it("reset drops a mod's registrations and restores core's", () => {
    const world = runeVectorWorld();
    const before = buildRuneList(world.env).length;

    runeRegistry().desc.set("brand", () => "replaced");
    runeRegistry().contribute(() => [
      { variety: MOD_VARIETY, index: 0, name: "flame" },
    ]);
    expect(buildRuneList(world.env).length).toBe(before + 1);

    resetRuneRegistry();

    const brand = buildRuneList(world.env).find((r) => r.variety === "brand")!;
    expect({
      length: buildRuneList(world.env).length,
      contributors: runeRegistry().contributorCount(),
      descRestored: runeDesc(world.env, brand).startsWith("Object brands"),
    }).toEqual({ length: before, contributors: 0, descRestored: true });
  });
});
