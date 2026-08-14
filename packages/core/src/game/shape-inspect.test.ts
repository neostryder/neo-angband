/**
 * PORT_TODO 3.21: the last two sections of the shape-lore chain, which were
 * seams no host supplied - shape_lore_append_change_effects
 * (ui-knowledge.c:3055) and shape_lore_append_triggering_spells (:3056).
 *
 * shape-lore.test.ts already proved the chain RENDERS both tails when they are
 * handed to it. That is the trap this file exists to close: a seam whose own
 * test passes while nothing on the live path supplies it. So everything here
 * runs against the shipped class and shape data through the same builder the
 * shell calls, and the expectations are derived from class.txt rather than
 * transcribed from it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import { shapeLoreLines } from "../player/shape-lore.js";
import type { Shape } from "../player/types.js";
import { PF } from "../generated/index.js";
import { OBJ_PROPERTY } from "../obj/types.js";
import { STAT_MAX } from "../player/types.js";
import type { ObjectInfoExtras } from "./object-inspect.js";
import {
  makeShapeLoreEnv,
  shapeChangeEffectText,
  shapeTriggeringSpells,
  type ShapeLoreExtras,
} from "./shape-inspect.js";

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

const { state, booted, players } = startGame(pack, { seed: 77, depth: 1 });
const reg = booted.registries.objects;

const inspect: ObjectInfoExtras = {
  projections: booted.registries.projections ?? [],
  constants: booted.registries.constants,
  timedDesc: (i) => state.world?.timedTable[i]?.desc ?? "",
  summonDesc: (i) => booted.registries.monsters.summons[i]?.desc ?? "",
};

const extras: ShapeLoreExtras = {
  properties: reg.properties,
  playerAbilities: players.properties
    .filter((pr) => pr.type === "player" && pr.code)
    .map((pr) => ({ index: (PF as Record<string, number>)[pr.code!]!, desc: pr.desc })),
  classes: players.classes,
  bookKindName: (tvalIdx, sval) => reg.lookupKind(tvalIdx, sval)?.name ?? null,
  inspect,
};

const shape = (name: string): Shape => {
  const s = players.shapes.find((x) => x.name === name);
  if (!s) throw new Error(`no shape "${name}" in the shipped pack`);
  return s;
};

/**
 * Every (class, book, spell) in the shipped data that changes into `name`,
 * derived by walking the pack rather than by naming the answer.
 */
function expectedTriggers(name: string): { cls: string; spell: string }[] {
  const out: { cls: string; spell: string }[] = [];
  for (const cls of players.classes) {
    for (const book of cls.magic.books) {
      for (const sp of book.spells) {
        for (const raw of sp.effectsRaw) {
          const rec = raw as { eff?: string; type?: string };
          if (rec.eff === "SHAPECHANGE" && rec.type === name) {
            out.push({ cls: cls.name, spell: sp.name });
          }
        }
      }
    }
  }
  return out;
}

describe("shapeTriggeringSpells (shape_lore_append_triggering_spells, :3056)", () => {
  it("names every class spell that reaches a shape, derived from class.txt", () => {
    /* Pick a shape the shipped data actually has a spell for; asserting on one
     * with no spell would pass against a function that returns nothing. */
    const withSpell = players.shapes.find(
      (s) => s.name !== "normal" && expectedTriggers(s.name).length > 0,
    );
    expect(withSpell, "no shipped shape is reachable by any class spell").toBeTruthy();

    const want = expectedTriggers(withSpell!.name);
    const lines = shapeTriggeringSpells(withSpell!, extras);
    expect(lines).toHaveLength(want.length);
    for (const { cls, spell } of want) {
      expect(lines.some((l) => l.includes(cls) && l.includes(spell))).toBe(true);
    }
  });

  it("uses upstream's exact sentence, including the book it lives in", () => {
    const withSpell = players.shapes.find(
      (s) => s.name !== "normal" && expectedTriggers(s.name).length > 0,
    )!;
    const line = shapeTriggeringSpells(withSpell, extras)[0]!;
    expect(line).toMatch(
      /^The .+ spell, .+, from .+ triggers the shapechange\.$/u,
    );
  });

  it("says nothing for a shape no spell changes into", () => {
    /* MEASURED, not hunted: the shipped data has nine shapes and eight
     * SHAPECHANGE spells, and the only shape without one is "normal", which
     * the browser never lists. Searching for a spell-less shape therefore
     * finds nothing and the test would pass by not running - so build the
     * case. The name is what the match is on (effect:SHAPECHANGE:<name>). */
    const orphan: Shape = { ...shape("fox"), name: "no-such-shape" };
    expect(shapeTriggeringSpells(orphan, extras)).toEqual([]);
    /* Not vacuous the other way either: the real fox does get lines. */
    expect(shapeTriggeringSpells(shape("fox"), extras).length).toBeGreaterThan(0);
  });

  it("walks EVERY class, not the player's own", () => {
    /* Upstream's loop is `for (c = classes; c; c = c->next)`. A port that read
     * the player's class would still pass the tests above whenever the fixture
     * character happened to be the right class. */
    const byClass = new Map<string, number>();
    for (const s of players.shapes) {
      for (const { cls } of expectedTriggers(s.name)) {
        byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
      }
    }
    expect(byClass.size, "shapechange spells are all in one class").toBeGreaterThan(1);
    /* The fixture player is one class; the lines still name the others. */
    const named = new Set<string>();
    for (const s of players.shapes) {
      for (const l of shapeTriggeringSpells(s, extras)) {
        for (const c of byClass.keys()) if (l.includes(c)) named.add(c);
      }
    }
    expect(named.size).toBe(byClass.size);
  });

  it("matches on the EFFECT as well as the shape, not the shape alone", () => {
    /* A mutation that stops checking `eff === SHAPECHANGE` survives the whole
     * shipped catalogue, because no other effect in class.txt carries a
     * subtype that happens to be a shape name. So construct one: a spell that
     * CURES something called "bear" must not be reported as a way to become a
     * bear. */
    const target = shape("bear");
    const donor = extras.classes.find((c) => c.magic.books.length > 0)!;
    const book = donor.magic.books[0]!;
    const decoy = {
      ...donor,
      name: "Decoy",
      magic: {
        ...donor.magic,
        books: [
          {
            ...book,
            spells: [
              {
                ...book.spells[0]!,
                name: "Not A Shapechange",
                effectsRaw: [{ eff: "CURE", type: target.name }],
              },
            ],
          },
        ],
      },
    };
    const lines = shapeTriggeringSpells(target, { ...extras, classes: [decoy] });
    expect(lines).toEqual([]);
    /* And the same decoy WITH the right effect name is reported, so the
     * negative is about the effect check and not about the fixture. */
    const real = {
      ...decoy,
      magic: {
        ...decoy.magic,
        books: [
          {
            ...decoy.magic.books[0]!,
            spells: [
              {
                ...decoy.magic.books[0]!.spells[0]!,
                effectsRaw: [{ eff: "SHAPECHANGE", type: target.name }],
              },
            ],
          },
        ],
      },
    };
    expect(shapeTriggeringSpells(target, { ...extras, classes: [real] })).toHaveLength(1);
  });

  it("skips a book whose object kind is missing (L2078)", () => {
    const withSpell = players.shapes.find(
      (s) => s.name !== "normal" && expectedTriggers(s.name).length > 0,
    )!;
    const blind: ShapeLoreExtras = { ...extras, bookKindName: () => null };
    expect(shapeTriggeringSpells(withSpell, blind)).toEqual([]);
  });
});

describe("shapeChangeEffectText (shape_lore_append_change_effects, :3055)", () => {
  it("describes the change effect under upstream's prefix", () => {
    const withEffect = players.shapes.find(
      (s) => s.name !== "normal" && s.effects.length > 0,
    );
    expect(withEffect, "no shipped shape carries a change effect").toBeTruthy();
    const text = shapeChangeEffectText(state, withEffect!, extras);
    expect(text).toBeTruthy();
    expect(text!).toMatch(/^Changing into the shape /u);
  });

  it("is null for a shape with no change effect, so no empty sentence", () => {
    const noEffect = players.shapes.find(
      (s) => s.name !== "normal" && s.effects.length === 0,
    );
    expect(noEffect, "every shipped shape has a change effect").toBeTruthy();
    expect(shapeChangeEffectText(state, noEffect!, extras)).toBeNull();
  });

  it("draws nothing from the game RNG", () => {
    const snapshot = state.rng.getState();
    const expected = state.rng.randint0(1_000_000);
    state.rng.setState(snapshot);
    for (const s of players.shapes) shapeChangeEffectText(state, s, extras);
    expect(state.rng.randint0(1_000_000)).toBe(expected);
  });
});

describe("makeShapeLoreEnv: the tails reach the page the browser draws", () => {
  const env = makeShapeLoreEnv(state, extras);

  it("puts both tails into shapeLoreLines for a shape that has them", () => {
    /* THE POINT OF THIS FILE. Not "the seam renders when supplied" - that was
     * already green while every shape recall ended at the misc flags - but
     * "the env the shell builds carries them". */
    const target = players.shapes.find(
      (s) =>
        s.name !== "normal" && s.effects.length > 0 && expectedTriggers(s.name).length > 0,
    );
    expect(target, "no shipped shape has both a change effect and a spell").toBeTruthy();

    const lines = shapeLoreLines(target!, env);
    expect(lines.some((l) => l.startsWith("Changing into the shape "))).toBe(true);
    expect(lines.some((l) => /triggers the shapechange\.$/u.test(l))).toBe(true);
  });

  it("still ends at the misc flags for a shape with neither", () => {
    /* Same measurement as above: no shipped shape has neither, so this pair of
     * negatives has to be constructed or it is a guard that cannot fire. */
    const bare: Shape = { ...shape("fox"), name: "no-such-shape", effects: [] };
    const lines = shapeLoreLines(bare, env);
    expect(lines.some((l) => l.startsWith("Changing into the shape "))).toBe(false);
    expect(lines.some((l) => /triggers the shapechange\.$/u.test(l))).toBe(false);
    /* And the same shape WITH its name back gets both, so the negative is
     * about the data and not about shapeLoreLines having stopped working. */
    const real = shapeLoreLines(
      { ...shape("bat"), effects: shape("bat").effects },
      env,
    );
    expect(real.some((l) => /triggers the shapechange\.$/u.test(l))).toBe(true);
  });

  it("names the stat in the stat-modifier line (stats count as mods)", () => {
    /* Found by reading the rendered page, not by reasoning about the code:
     * every shape with a stat modifier printed "Adds -3 to ." because
     * shape-lore had its own copy of lookup_obj_property without upstream's
     * "special case - stats count as mods" (obj-properties.c:36). The stat
     * section looks stats up as MODs, exactly as upstream does. */
    const withStat = players.shapes.find(
      (s) =>
        s.name !== "normal" &&
        s.modifiers.slice(0, STAT_MAX).some((m) => (m ?? 0) !== 0),
    );
    expect(withStat, "no shipped shape carries a stat modifier").toBeTruthy();
    const lines = shapeLoreLines(withStat!, env);
    const adds = lines.filter((l) => l.startsWith("Adds "));
    expect(adds.length).toBeGreaterThan(0);
    for (const l of adds) {
      expect(l, "a modifier line with an empty name").not.toMatch(/ to (,|\.| and)/u);
    }
    /* And positively: the stat's real name is on the page. */
    const idx = withStat!.modifiers.slice(0, STAT_MAX).findIndex((m) => (m ?? 0) !== 0);
    const prop = reg.properties.find(
      (p) => p && p.type === OBJ_PROPERTY.STAT && p.propIndex === idx,
    );
    expect(prop, "no stat property at that index").toBeTruthy();
    expect(lines.some((l) => l.includes(prop!.name))).toBe(true);
  });

  it("keeps the three table fields it used to be hand-built from", () => {
    expect(env.properties).toBe(reg.properties);
    expect(env.elementNames.length).toBe((booted.registries.projections ?? []).length);
    expect(env.playerAbilities.length).toBe(extras.playerAbilities.length);
  });
});
