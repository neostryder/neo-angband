import { describe, expect, it } from "vitest";
import { FEAT } from "../generated/index.js";
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
