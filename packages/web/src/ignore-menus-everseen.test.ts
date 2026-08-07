/**
 * `everseen` gates the two ignore CONFIGURATION menus (ui-options.c:1427 for
 * egos, :1801-1802 for the sval menu's aware rows).
 *
 * Without them the menus enumerate the whole game: every ego and every object
 * kind gets a row whether or not the player has ever met it, which tells them
 * what EXISTS long before they find it. The port had the seen-set all along -
 * `EverseenKnowledge`, fed by `describeObject` on every live describe and
 * carried in the save - and the menus simply never consulted it. The ledger row
 * that recorded this called the seen-set "a follow-up"; it had already shipped.
 *
 * The UNAWARE sval row is deliberately NOT gated: "can unaware ignore anything"
 * (ui-options.c:1796). A test below pins that, because gating it too would look
 * like a tidier rule and would be wrong.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EverseenKnowledge,
  IgnoreSettings,
  ObjRegistry,
  TV,
} from "@rpgm-tools/neo-angband-core";
import type { EgoItem, ObjectKind } from "@rpgm-tools/neo-angband-core";
import { egoIgnoreMenu, svalKindMenu } from "./screens.js";
import type { GameState } from "@rpgm-tools/neo-angband-core";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as never);

describe("ego ignore menu: ego->everseen (ui-options.c:1427)", () => {
  it("lists nothing when the player has met no egos", () => {
    const { items } = egoIgnoreMenu(
      objReg.egos,
      objReg.kinds,
      new IgnoreSettings(),
      () => false,
    );
    expect(items).toHaveLength(0);
  });

  it("lists exactly the egos that HAVE been seen", () => {
    /* Ground truth from the pack: take the first ego that produces any row at
     * all under an all-seen predicate, then assert that seeing only that one
     * yields only its rows. A hand-made ego would prove only my own arithmetic. */
    const all = egoIgnoreMenu(
      objReg.egos, objReg.kinds, new IgnoreSettings(), () => true,
    );
    expect(all.items.length).toBeGreaterThan(1);

    const firstEidx = all.choices[0]!.eidx;
    const one = egoIgnoreMenu(
      objReg.egos,
      objReg.kinds,
      new IgnoreSettings(),
      (ego: EgoItem) => ego.eidx === firstEidx,
    );
    expect(one.choices.length).toBeGreaterThan(0);
    expect(one.choices.every((c) => c.eidx === firstEidx)).toBe(true);
    expect(one.items.length).toBeLessThan(all.items.length);
  });
});

describe("sval ignore menu: kind->everseen (ui-options.c:1801-1802)", () => {
  /** A state carrying only what svalKindMenu reads. */
  function stateWith(everseen: EverseenKnowledge | undefined): GameState {
    return {
      everseen,
      /* isAware false => every kind also gets its UNAWARE row. */
      isAware: () => false,
    } as unknown as GameState;
  }

  const TVAL = TV.SWORD;

  it("drops the AWARE rows for kinds the player has never seen", () => {
    const seenNone = svalKindMenu(objReg, TVAL, new IgnoreSettings(), stateWith(new EverseenKnowledge()));
    expect(seenNone.rows.length).toBeGreaterThan(0);
    expect(seenNone.rows.some((r) => r.aware)).toBe(false);
  });

  it("keeps the UNAWARE rows regardless - 'can unaware ignore anything'", () => {
    /* ui-options.c:1796. Gating this too would be a tidier-looking rule and
     * would silently remove the player's ability to pre-ignore. */
    const seenNone = svalKindMenu(objReg, TVAL, new IgnoreSettings(), stateWith(new EverseenKnowledge()));
    expect(seenNone.rows.every((r) => !r.aware)).toBe(true);
    expect(seenNone.rows.length).toBeGreaterThan(0);
  });

  it("brings an aware row back once that kind is marked seen", () => {
    const ev = new EverseenKnowledge();
    const kind = objReg.kinds.find(
      (k): k is ObjectKind => !!k && k.tval === TVAL,
    ) as ObjectKind;
    ev.markKind(kind);
    const rows = svalKindMenu(objReg, TVAL, new IgnoreSettings(), stateWith(ev)).rows;
    expect(rows.filter((r) => r.aware).map((r) => r.kidx)).toEqual([kind.kidx]);
  });
});
