/**
 * PORT_TODO 3.23: the ODESC_BASE stand-in, and the two places it leaked.
 *
 * `objBaseName` - "the kind's plain name, `~` and `&` stripped" - stood in for
 * `object_desc(..., ODESC_BASE, p)` at every rune / flag / curse message in
 * obj/knowledge.ts, and `session/game.ts` passed the kind name RAW (not even
 * marker-stripped) for print_custom_message's {name} and {kind} tags.
 *
 * These are wiring tests on a real booted game, because the whole failure mode
 * is a seam with no supplier: the full suite was green before the fix, since
 * nothing exercised either path with a name that could show the difference.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { objBaseName } from "../obj/knowledge.js";
import { doRandart, RANDNAME_TOLKIEN } from "../obj/randart.js";
import { buildCurseTimedFoil } from "../obj/object.js";
import { bindPlayer } from "../player/bind.js";
import type { Artifact } from "../obj/types.js";

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

describe("the ODESC_BASE seam is supplied on a real game (PORT_TODO 3.23)", () => {
  it("wireGame supplies runeEnv.describeBase", () => {
    const { state } = startGame(pack, { seed: 5, depth: 1 });
    /* The whole item is "the seam exists and nothing fills it", so the presence
     * check IS the regression test - not a tautology. */
    expect(typeof state.runeEnv.describeBase).toBe("function");
  });

  it("it is the real object_desc, not the plain-name fallback", () => {
    const { state, booted } = startGame(pack, { seed: 5, depth: 1 });
    const kinds = booted.registries.objects.kinds;

    /* Ground truth from the pack: a flavoured kind the player is NOT aware of.
     * ODESC_BASE routes it through its flavour ("a Murky Potion"); the fallback
     * prints the kind's own name. If the pack had no such kind the assertion
     * below would be vacuous, so this fails instead. */
    const flavoured = kinds.find(
      (k) => state.hasFlavor?.(k) === true && state.isAware?.(k) !== true,
    );
    expect(flavoured, "fixture: an unaware flavoured kind exists").toBeDefined();

    const obj = { kind: flavoured!, known: { kind: flavoured! }, number: 1 };
    const real = state.runeEnv.describeBase!(obj as never);
    expect(real, "the flavour name, not the kind name").not.toBe(
      objBaseName(obj as never),
    );
  });

  it("no rune message can print a raw ~ or & marker", () => {
    const { state, booted } = startGame(pack, { seed: 5, depth: 1 });
    const marked = booted.registries.objects.kinds.filter((k) =>
      /[~&]/.test(k.name),
    );
    expect(marked.length, "fixture: the pack uses ~ and & markers").toBeGreaterThan(0);

    for (const kind of marked.slice(0, 40)) {
      const obj = { kind, known: { kind }, number: 1 };
      const text = state.runeEnv.describeBase!(obj as never);
      expect(text, `${kind.name} still carries a marker`).not.toMatch(/[~&]/);
    }
  });
});

describe("print_custom_message {name} and {kind} (PORT_TODO 3.23)", () => {
  it("neither tag prints a raw marker, and only {name} takes an article", () => {
    const { state, booted } = startGame(pack, { seed: 5, depth: 1 });
    const kind = booted.registries.objects.kinds.find(
      (k) => /[~&]/.test(k.name) && k.tval !== undefined,
    );
    expect(kind, "fixture: a marker-bearing kind exists").toBeDefined();

    const handle = state.gear.next++;
    state.gear.store.set(handle, {
      kind: kind!,
      known: { kind: kind! },
      number: 1,
    } as never);
    /* The getter reads state.actor.weapon, which is what a wield sets. */
    (state.actor as { weapon: unknown }).weapon = state.gear.store.get(handle)!;

    const desc = state.world!.timedHooks!.weapon!;
    expect(desc.name, "{name} marker-free").not.toMatch(/[~&]/);
    expect(desc.kind, "{kind} marker-free").not.toMatch(/[~&]/);
    /* upstream: {name} is ODESC_PREFIX | ODESC_BASE, {kind} is
     * object_kind_name - so the two are NOT the same string. Passing the raw
     * kind name for both was the bug. */
    expect(desc.name, "{name} carries the article {kind} does not").not.toBe(
      desc.kind,
    );
  });

  it("falls back to the obj == NULL tag forms when unarmed", () => {
    const { state } = startGame(pack, { seed: 5, depth: 1 });
    (state.actor as { weapon: unknown }).weapon = null;
    const desc = state.world!.timedHooks!.weapon!;
    expect(desc).toEqual({ name: "hands", kind: "hands", number: 2 });
  });
});

/**
 * PORT_TODO 5.4: the RANDNAME_TOLKIEN corpus reaches artifact_gen_name.
 *
 * randnameMake, build_prob and artifactGenName are ported and unit-tested
 * against an independent oracle (obj/randname.upstream.test.ts,
 * obj/randart.test.ts), and doRandart takes the word list as an argument - so
 * every one of those tests would still pass if the live boot handed it an empty
 * list and the generator fell back to its own syllables. This is the assertion
 * that the SHIPPED pack fills it.
 */
describe("the names corpus is supplied to the live randart generator (5.4)", () => {
  it("boot loads names.txt section 1, and it is not empty", () => {
    const { booted } = startGame(pack, { seed: 5, depth: 1 });
    const words = booted.registries.nameSections.get(RANDNAME_TOLKIEN) ?? [];
    expect(words.length, "names.json section 1 reached CoreRegistries").toBeGreaterThan(
      100,
    );
    /* Real words, not placeholders - a corpus of empty strings would satisfy a
     * length check and produce nothing but the fallback. */
    expect(words.every((w) => /^[A-Za-z]{2,}$/u.test(w))).toBe(true);
  });

  it("the corpus changes the names, so the argument is not decorative", () => {
    const { booted } = startGame(pack, { seed: 5, depth: 1 });
    const words = booted.registries.nameSections.get(RANDNAME_TOLKIEN) ?? [];
    const withCorpus = doRandart(booted.registries.objects, 4242, false, words);
    const without = doRandart(booted.registries.objects, 4242, false, []);
    /* doRandart returns a slot-indexed array with holes (index 0 and any base
     * item it could not use), so filter before reading a name. */
    const names = (set: readonly ({ name: string } | null)[]): string =>
      set.filter((a) => a !== null).map((a) => a.name).join("|");
    expect(names(withCorpus)).not.toBe(names(without));
  });
});

/**
 * PORT_TODO 5.7: the TIMED_INC curse foil reaches the randart generator.
 *
 * artifact_curse_conflicts' "effect foiled by an existing artifact property"
 * arm (obj-curse.c:267-296) is ported and unit-tested in obj/randart.test.ts -
 * but against a HAND-BUILT two-entry foil map, so nothing said the SHIPPED
 * player_timed table produces a usable one, and nothing said swapRandartSet
 * hands it over. doRandart takes it as an optional argument; an optional
 * argument nobody passes is a branch that never runs.
 */
describe("the curse TIMED_INC foil reaches the randart generator (5.7)", () => {
  it("the shipped player_timed table yields a foil map with real entries", () => {
    const foil = buildCurseTimedFoil(bindPlayer(pack.player).timed);
    expect(foil.size, "player_timed.json ships fail: lines").toBeGreaterThan(0);
    /* Derived, not declared: at least one entry must carry a real failure
     * code, or the map would be a set of empty lists that can foil nothing. */
    const withFails = [...foil.values()].filter((f) => f.length > 0);
    expect(withFails.length).toBeGreaterThan(0);
  });

  it("the foil changes the generated set, so the argument is load-bearing", () => {
    const { booted } = startGame(pack, { seed: 5, depth: 1 });
    const foil = buildCurseTimedFoil(bindPlayer(pack.player).timed);
    const words = booted.registries.nameSections.get(RANDNAME_TOLKIEN) ?? [];

    /*
     * Same seed, same corpus; the ONLY difference is the foil. Seed 1 is
     * chosen rather than assumed: sweeping 1..60 found the foil changes the
     * set on 9 of them (1, 4, 15, 31, 36, 41, 47, 52, 58), so most seeds
     * generate no artifact whose own properties foil the curse it drew. The
     * first two seeds tried produced identical sets and would have asserted
     * nothing.
     */
    const withFoil = doRandart(booted.registries.objects, 1, false, words, { timedFoil: foil });
    const without = doRandart(booted.registries.objects, 1, false, words);
    const curses = (set: readonly (Artifact | null)[]): string =>
      set
        .filter((a): a is Artifact => a !== null)
        .map((a) => `${a.name}:${(a.curses ?? []).join(",")}`)
        .join("|");
    expect(curses(withFoil)).not.toBe(curses(without));
  });
});
