/**
 * Guards the ammo_tval WIRING into calc_inventory, at the session level.
 *
 * earlier_object reads `player->state.ammo_tval` straight off the global player
 * (player-calcs.c:952-959), so in the C every caller of calc_inventory sees the
 * live value with no plumbing at all. In this port it arrives as an optional
 * CalcInventoryOpts argument, and two session call sites originally omitted it:
 * `refreshInventory` (the PU_INVEN pass after inven_carry, wired into
 * PickupDeps) and `refreshQuiver` (the store-purchase pass). A pickup therefore
 * sorted the quiver as if no launcher were wielded, and usable ammo lost its
 * precedence over unusable ammo of a higher tval.
 *
 * game/gear-quiver.test.ts covers the FUNCTION -- it proves earlier_object
 * honours the input. It cannot catch this, because either call site could drop
 * the argument again and it would still pass. That is the same hole the
 * caveKnown/caveIlluminateKnown order guard closed (town-known-order.test.ts),
 * and the rule it came from: when a fix has two or more call sites, the guard
 * has to exercise the wiring, not the function.
 *
 * The discriminator: TV_BOLT (4) outranks TV_ARROW (3) under "objects sort by
 * decreasing type" (player-calcs.c:962-964), which runs AFTER the ammo branch at
 * :952-959. So bolts lead on tval alone, and arrows in slot 0 is an arrangement
 * ONLY a live ammo_tval can produce.
 *
 * MEASURED coverage, not assumed. Deleting the ammoTval line from
 * `refreshInventory` makes this test report "quiver slot 0 holds tval 4",
 * i.e. it bites. Deleting it from `refreshQuiver` instead leaves the test
 * PASSING, because that is the store-purchase path and a pickup never reaches
 * it. So this file guards ONE of the two call sites. Guarding the other needs a
 * store transaction driven end to end; recorded here rather than left implied.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KF, TV } from "../generated/index.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { floorCarry } from "../game/floor.js";
import { gearGet, objectIsInQuiver } from "../game/gear.js";
import { floorPile } from "../game/floor.js";
import { objectPrep } from "../obj/make.js";
import { Rng } from "../rng.js";

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

describe("ammo_tval reaches calc_inventory from the session (player-calcs.c:952-959)", () => {
  it("a picked-up usable arrow outranks an unusable bolt of higher tval", () => {
    const game = startGame(pack, { seed: 4242, depth: 1 });
    const { state, registry } = game;
    const reg = game.booted.registries;

    /* A launcher that shoots arrows, so calc_bonuses sets ammoTval = TV_ARROW
     * (player/calcs.ts:1230-1232, the KF_SHOOTS_ARROWS branch). Wielded through
     * the real command, so the derived-state refresh runs as it does in play. */
    const bowKind = reg.objects.kinds.find(
      (k) => k.tval === TV.BOW && k.kindFlags.has(KF.SHOOTS_ARROWS),
    );
    expect(bowKind, "the shipped data must have a bow with KF_SHOOTS_ARROWS").toBeDefined();
    const bow = objectPrep(new Rng(1), reg.objects, reg.constants, bowKind!, 0, "minimise");
    floorCarry(state, state.actor.grid, bow);
    pickup(state, registry);
    const bowHandle = state.gear.pack.find((h) => gearGet(state.gear, h)?.tval === TV.BOW);
    expect(bowHandle, "the bow must be in the pack after pickup").toBeDefined();
    wield(state, registry, bowHandle!);
    expect(
      state.playerState?.ammoTval,
      "wielding a SHOOTS_ARROWS bow must make ARROW the usable ammo tval",
    ).toBe(TV.ARROW);

    /* One stack of each ammo type on the floor. Bolts are dropped FIRST so
     * neither gear order nor tval order favours the arrows: only the ammo_tval
     * branch can put them in slot 0. */
    for (const tval of [TV.BOLT, TV.ARROW]) {
      const kind = reg.objects.kinds.find(
        (k) => k.tval === tval && k.kidx < reg.objects.ordinaryKindCount,
      );
      expect(kind, `the shipped data must have an ordinary kind for tval ${tval}`).toBeDefined();
      const ammo = objectPrep(new Rng(2 + tval), reg.objects, reg.constants, kind!, 0, "minimise");
      ammo.number = 10;
      floorCarry(state, state.actor.grid, ammo);
    }

    /* One pickup takes one item (player_pickup_item), so keep going until the
     * grid is clear. Without this the first draft picked up only the arrows and
     * the ordering assertion below was vacuous -- no bolt ever competed. */
    for (let i = 0; i < 8 && floorPile(state, state.actor.grid).length > 0; i++) {
      pickup(state, registry);
    }

    /* PRECONDITION, not decoration: both ammo types must actually be carried,
     * or "arrows lead" is trivially true. */
    const carried = state.gear.pack.map((h) => gearGet(state.gear, h)?.tval);
    expect(carried, "both ammo stacks must have been picked up").toContain(TV.BOLT);
    expect(carried).toContain(TV.ARROW);

    const slot0 = state.gear.quiver?.[0] ?? 0;
    expect(slot0, "the pickup must have populated the quiver").not.toBe(0);
    const first = gearGet(state.gear, slot0);
    expect(
      first?.tval,
      `quiver slot 0 holds tval ${String(first?.tval)}; only a live ammo_tval ` +
        `puts ARROW (${TV.ARROW}) ahead of BOLT (${TV.BOLT})`,
    ).toBe(TV.ARROW);
    expect(objectIsInQuiver(state.gear, slot0)).toBe(true);
  });
});

/** The registered pickup action -- the seam PickupDeps.refreshInventory hangs off. */
function pickup(state: Parameters<typeof floorCarry>[0], registry: ReturnType<typeof startGame>["registry"]): void {
  const action = registry.get("pickup");
  expect(action, "the session must register a pickup action").toBeTruthy();
  action!(state, { code: "pickup" });
}

function wield(
  state: Parameters<typeof floorCarry>[0],
  registry: ReturnType<typeof startGame>["registry"],
  handle: number,
): void {
  const action = registry.get("wield");
  expect(action, "the session must register a wield action").toBeTruthy();
  action!(state, { code: "wield", args: { handle } });
}
