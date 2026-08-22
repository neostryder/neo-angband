import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated/index.js";
import type { PlayerCommand } from "../game/context.js";
import { runGameLoop } from "../game/loop.js";
import type { GamePack } from "../session/game.js";
import { startGame } from "../session/game.js";
import type { Store } from "./store.js";
import {
  enterStoreGuard,
  storeBuyGuard,
  storeRetrieveGuard,
  storeSellGuard,
  storeStashGuard,
} from "./store-cmd.js";

/** Only `feat` is read by the guards. */
function storeWithFeat(feat: number): Store {
  return { feat } as unknown as Store;
}

const HOME = storeWithFeat(FEAT.HOME);
const SHOP = storeWithFeat(FEAT.STORE_ARMOR);

describe("the store commands' entry guards (store.c / ui-store.c)", () => {
  it("do_cmd_buy refuses outside a store (store.c:1667-1670)", () => {
    expect(storeBuyGuard(null)).toBe(
      "You cannot purchase items when not in a store.",
    );
    expect(storeBuyGuard(SHOP)).toBeNull();
    /* The Home is a store for do_cmd_buy's purposes; do_cmd_retrieve is the
     * Home's own command and has its own guard below. */
    expect(storeBuyGuard(HOME)).toBeNull();
  });

  it("do_cmd_retrieve is SILENT with no store, and speaks in the wrong one (store.c:1793-1800)", () => {
    /* store.c:1794 is a bare `if (!store) return;` - no message. Collapsing
     * that into the wrong-store branch would invent a line upstream never says. */
    expect(storeRetrieveGuard(null)).toBeNull();
    expect(storeRetrieveGuard(SHOP)).toBe("You are not currently at home.");
    expect(storeRetrieveGuard(HOME)).toBeNull();
  });

  it("do_cmd_sell refuses outside a store (store.c:1902-1905)", () => {
    expect(storeSellGuard(null)).toBe(
      "You cannot sell items when not in a store.",
    );
    expect(storeSellGuard(SHOP)).toBeNull();
    expect(storeSellGuard(HOME)).toBeNull();
  });

  it("do_cmd_stash speaks for BOTH no store and the wrong store (store.c:2031-2034)", () => {
    /* Unlike retrieve, the condition here is `!store || feat != FEAT_HOME`, so
     * the null case DOES get the message. */
    expect(storeStashGuard(null)).toBe("You are not in your home.");
    expect(storeStashGuard(SHOP)).toBe("You are not in your home.");
    expect(storeStashGuard(HOME)).toBeNull();
  });

  it("enter_store refuses a grid with no store (ui-store.c:1257-1262)", () => {
    expect(enterStoreGuard(null)).toBe("You see no store here.");
    expect(enterStoreGuard(SHOP)).toBeNull();
    expect(enterStoreGuard(HOME)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * shop-buy / shop-sell / shop-exit, through the SAME command path an
 * agent controller drives (docs/PLANNED.md, "An agent cannot trade").
 * A real startGame town, a real command queue, runGameLoop.
 * ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
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
  store: loadRecords("store"),
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

/** Run one queued command through the same registry the agent facade builds
 * commands for (game/loop.ts runGameLoop -> ActionRegistry, exactly the path
 * `state.nextCommand` feeds during real play or an installed controller). */
function runCommand(
  game: ReturnType<typeof startGame>,
  cmd: PlayerCommand,
): void {
  let delivered = false;
  game.state.nextCommand = (): PlayerCommand | null => {
    if (delivered) return null;
    delivered = true;
    return cmd;
  };
  runGameLoop(game.state, game.registry);
}

describe("shop-buy / shop-sell / shop-exit reach a real handler (docs/PLANNED.md)", () => {
  /** A fresh town game standing on the General Store's entrance. */
  function townOnGeneralStore(seed: number) {
    const game = startGame(pack, { seed, depth: 0 });
    const state = game.state;
    const messages: string[] = [];
    state.msg = (text: string): void => {
      messages.push(text);
    };
    const general = state.stores!.find((s) => s.feat === FEAT.STORE_GENERAL)!;
    expect(general).toBeDefined();
    /* Stamp the entrance under the player, exactly as save.test.ts stamps
     * FEAT.MORE under the player to test a different grid-read command. */
    state.chunk.setFeat(state.actor.grid, general.feat);
    return { game, state, messages, general };
  }

  /** Total count of tval FOOD across the player's pack (may span stacks). */
  function foodCount(state: ReturnType<typeof townOnGeneralStore>["state"]): number {
    let n = 0;
    for (const handle of state.gear.pack) {
      const obj = state.gear.store.get(handle);
      if (obj?.tval === TV.FOOD) n += obj.number;
    }
    return n;
  }

  it("shop-buy resolves a stock index into a real storeBuy, through the registry", () => {
    const { game, state, messages, general } = townOnGeneralStore(4300);
    /* The General Store's `always:` table guarantees a Ration of Food. The
     * starting kit already carries some, so the purchase may MERGE into the
     * existing stack rather than opening a new pack slot - assert on the
     * total count, not the slot count. */
    const index = general.stock.findIndex((o) => o.tval === TV.FOOD);
    expect(index).toBeGreaterThanOrEqual(0);

    const goldBefore = state.actor.player.au;
    const foodBefore = foodCount(state);

    runCommand(game, { code: "shop-buy", args: { index, quantity: 1 } });

    expect(state.actor.player.au).toBeLessThan(goldBefore);
    expect(foodCount(state)).toBe(foodBefore + 1);
    expect(messages.some((m) => m.startsWith("You bought"))).toBe(true);
  });

  it("shop-sell resolves a gear handle into a real storeSell, through the registry", () => {
    const { game, state, messages, general } = townOnGeneralStore(4301);
    const index = general.stock.findIndex((o) => o.tval === TV.FOOD);
    const foodBefore = foodCount(state);
    runCommand(game, { code: "shop-buy", args: { index, quantity: 1 } });
    expect(foodCount(state)).toBe(foodBefore + 1);
    const handle = state.gear.pack.find(
      (h) => state.gear.store.get(h)?.tval === TV.FOOD,
    )!;
    expect(handle).toBeDefined();

    /* birth_no_selling defaults to true (generated/options.ts): a real game
     * starts with shops paying nothing for a sale, so the item is still
     * taken (do_cmd_sell L1966-1969) but no gold changes hands - "You had
     * ..." rather than "You sold ... for N gold." */
    expect(state.options?.get("birth_no_selling")).toBe(true);
    const goldAfterBuy = state.actor.player.au;
    runCommand(game, { code: "shop-sell", args: { handle, quantity: 1 } });

    expect(state.actor.player.au).toBe(goldAfterBuy);
    expect(foodCount(state)).toBe(foodBefore);
    expect(messages.some((m) => m.startsWith("You had"))).toBe(true);
  });

  it("shop-sell pays real gold with birth_no_selling off", () => {
    const game = startGame(pack, {
      seed: 4304,
      depth: 0,
      optionOverrides: { birth_no_selling: false },
    });
    const state = game.state;
    const messages: string[] = [];
    state.msg = (text: string): void => {
      messages.push(text);
    };
    const general = state.stores!.find((s) => s.feat === FEAT.STORE_GENERAL)!;
    state.chunk.setFeat(state.actor.grid, general.feat);
    expect(state.options?.get("birth_no_selling")).toBe(false);

    const index = general.stock.findIndex((o) => o.tval === TV.FOOD);
    runCommand(game, { code: "shop-buy", args: { index, quantity: 1 } });
    const handle = state.gear.pack.find(
      (h) => state.gear.store.get(h)?.tval === TV.FOOD,
    )!;
    expect(handle).toBeDefined();

    const goldAfterBuy = state.actor.player.au;
    runCommand(game, { code: "shop-sell", args: { handle, quantity: 1 } });

    expect(state.actor.player.au).toBeGreaterThan(goldAfterBuy);
    expect(messages.some((m) => m.startsWith("You sold"))).toBe(true);
  });

  it("shop-exit is a real, no-energy handler (not a silent drop)", () => {
    const { game, state } = townOnGeneralStore(4302);
    const turnBefore = state.turn;
    expect(() => runCommand(game, { code: "shop-exit" })).not.toThrow();
    /* A store command spends no game turn, exactly like a real leave-store. */
    expect(state.turn).toBe(turnBefore);
  });

  it("shop-buy off a store tile refuses through the SAME re-resolved guard do_cmd_buy runs", () => {
    const { game, state, messages, general } = townOnGeneralStore(4303);
    /* Step off the shop's entrance: store_at now resolves to null. */
    state.chunk.setFeat(state.actor.grid, FEAT.FLOOR);
    const index = general.stock.findIndex((o) => o.tval === TV.FOOD);
    const goldBefore = state.actor.player.au;

    runCommand(game, { code: "shop-buy", args: { index, quantity: 1 } });

    expect(state.actor.player.au).toBe(goldBefore);
    expect(messages).toContain("You cannot purchase items when not in a store.");
  });
});
