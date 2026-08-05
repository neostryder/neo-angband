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
