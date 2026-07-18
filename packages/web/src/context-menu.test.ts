import { describe, expect, it } from "vitest";
import {
  buildCaveMenu,
  buildObjectMenu,
  buildPlayerMenu,
  buildPlayerOtherMenu,
  routeContextClick,
} from "./context-menu";

describe("routeContextClick (ui-context.c textui_process_click L998)", () => {
  it("is 'player' on the player's own grid", () => {
    expect(routeContextClick({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe("player");
  });

  it("is 'cave-adjacent' within one square (including diagonals)", () => {
    expect(routeContextClick({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe("cave-adjacent");
    expect(routeContextClick({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe("cave-adjacent");
    expect(routeContextClick({ x: 5, y: 5 }, { x: 4, y: 4 })).toBe("cave-adjacent");
  });

  it("is 'cave-far' beyond one square", () => {
    expect(routeContextClick({ x: 5, y: 5 }, { x: 7, y: 5 })).toBe("cave-far");
    expect(routeContextClick({ x: 5, y: 5 }, { x: 5, y: 8 })).toBe("cave-far");
  });
});

describe("buildPlayerMenu (ui-context.c context_menu_player L248)", () => {
  const base = {
    canCast: false,
    onUpStairs: false,
    onDownStairs: false,
    hasFloorObject: false,
    canPickup: false,
    centerPlayerOption: false,
  };

  it("always offers Look, Inventory, Character, and Other", () => {
    const items = buildPlayerMenu(base);
    const actions = items.map((i) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["look", "inventory", "character", "other"]));
  });

  it("gates Cast / Go Up / Go Down on the matching context flags", () => {
    const none = buildPlayerMenu(base);
    expect(none.find((i) => i.action === "cast")!.disabled).toBe(true);
    expect(none.find((i) => i.action === "go-up")!.disabled).toBe(true);
    expect(none.find((i) => i.action === "go-down")!.disabled).toBe(true);

    const full = buildPlayerMenu({ ...base, canCast: true, onUpStairs: true, onDownStairs: true });
    expect(full.find((i) => i.action === "cast")!.disabled).toBeFalsy();
    expect(full.find((i) => i.action === "go-up")!.disabled).toBeFalsy();
    expect(full.find((i) => i.action === "go-down")!.disabled).toBeFalsy();
  });

  it("only shows Floor / Pick up when there is a floor object under the player", () => {
    expect(buildPlayerMenu(base).some((i) => i.action === "floor")).toBe(false);
    expect(buildPlayerMenu(base).some((i) => i.action === "pickup")).toBe(false);

    const withFloor = buildPlayerMenu({ ...base, hasFloorObject: true, canPickup: true });
    expect(withFloor.find((i) => i.action === "floor")!.disabled).toBeFalsy();
    expect(withFloor.find((i) => i.action === "pickup")!.disabled).toBeFalsy();

    const tooHeavy = buildPlayerMenu({ ...base, hasFloorObject: true, canPickup: false });
    expect(tooHeavy.find((i) => i.action === "pickup")!.disabled).toBe(true);
  });

  it("hides Center Map when the center_player option is already on", () => {
    expect(buildPlayerMenu(base).some((i) => i.action === "center-map")).toBe(true);
    expect(buildPlayerMenu({ ...base, centerPlayerOption: true }).some((i) => i.action === "center-map")).toBe(false);
  });

  it("offers Explore and Rest (both are wired, even if 'rest' is currently just a hold)", () => {
    const items = buildPlayerMenu(base);
    expect(items.find((i) => i.action === "explore")!.disabled).toBeFalsy();
    expect(items.find((i) => i.action === "rest")!.disabled).toBeFalsy();
  });
});

describe("buildPlayerOtherMenu (ui-context.c context_menu_player_2 L84)", () => {
  it("offers every submenu feature enabled (all are wired now)", () => {
    const items = buildPlayerOtherMenu();
    for (const action of [
      "messages",
      "objects",
      "ignore-setup",
      "help",
      "abilities",
      "equip-cmp",
      "knowledge",
      "map",
      "monsters",
      "toggle-ignore",
      "options",
    ]) {
      expect(items.find((i) => i.action === action)!.disabled).toBeFalsy();
    }
  });
});

describe("buildCaveMenu (ui-context.c context_menu_cave L426)", () => {
  const base = {
    adjacent: true,
    hasMonster: false,
    canCast: false,
    canFire: false,
    canSteal: false,
    chest: null,
    isDisarmableTrap: false,
    isOpenDoor: false,
    isClosedDoor: false,
    isDiggable: false,
  };

  it("adds Recall Info right after Look At only when a monster is present", () => {
    expect(buildCaveMenu(base).some((i) => i.action === "recall")).toBe(false);
    const withMon = buildCaveMenu({ ...base, hasMonster: true });
    expect(withMon[0]!.action).toBe("look");
    expect(withMon[1]!.action).toBe("recall");
  });

  it("offers Steal only when a monster is present and the player has PF_STEAL", () => {
    expect(buildCaveMenu({ ...base, hasMonster: true }).some((i) => i.action === "steal")).toBe(false);
    expect(buildCaveMenu({ ...base, canSteal: true }).some((i) => i.action === "steal")).toBe(false);
    expect(
      buildCaveMenu({ ...base, hasMonster: true, canSteal: true }).some((i) => i.action === "steal"),
    ).toBe(true);
  });

  it("labels the alter entry Attack when a monster is present, Alter otherwise", () => {
    expect(buildCaveMenu(base).find((i) => i.action === "alter")!.label).toBe("Alter");
    expect(buildCaveMenu({ ...base, hasMonster: true }).find((i) => i.action === "alter")!.label).toBe("Attack");
  });

  it("offers chest Disarm+Open when locked, just Open when unlocked", () => {
    const locked = buildCaveMenu({ ...base, chest: { locked: true } });
    expect(locked.some((i) => i.action === "disarm-chest")).toBe(true);
    expect(locked.some((i) => i.action === "open-chest")).toBe(true);

    const unlocked = buildCaveMenu({ ...base, chest: { locked: false } });
    expect(unlocked.some((i) => i.action === "disarm-chest")).toBe(false);
    expect(unlocked.filter((i) => i.action === "open-chest")).toHaveLength(1);
  });

  it("offers Disarm and an enabled Jump Onto for a disarmable trap", () => {
    const items = buildCaveMenu({ ...base, isDisarmableTrap: true });
    expect(items.find((i) => i.action === "disarm-trap")!.disabled).toBeFalsy();
    expect(items.find((i) => i.action === "jump-trap")!.disabled).toBeFalsy();
  });

  it("offers Close on an open door, Open+Lock on a closed door, Tunnel on diggable terrain", () => {
    expect(buildCaveMenu({ ...base, isOpenDoor: true }).some((i) => i.action === "close")).toBe(true);
    const closed = buildCaveMenu({ ...base, isClosedDoor: true });
    expect(closed.some((i) => i.action === "open-door")).toBe(true);
    expect(closed.some((i) => i.action === "lock")).toBe(true);
    expect(buildCaveMenu({ ...base, isDiggable: true }).some((i) => i.action === "tunnel")).toBe(true);
  });

  it("offers Pathfind/Walk/Run when not adjacent, and just Walk when adjacent", () => {
    const far = buildCaveMenu({ ...base, adjacent: false });
    expect(far.map((i) => i.action)).toEqual(expect.arrayContaining(["pathfind", "walk", "run"]));
    const near = buildCaveMenu(base);
    expect(near.some((i) => i.action === "pathfind")).toBe(false);
    expect(near.some((i) => i.action === "run")).toBe(false);
    expect(near.some((i) => i.action === "walk")).toBe(true);
  });

  it("offers Fire On only when the player can fire, and always offers Throw To", () => {
    expect(buildCaveMenu(base).some((i) => i.action === "fire")).toBe(false);
    expect(buildCaveMenu({ ...base, canFire: true }).some((i) => i.action === "fire")).toBe(true);
    expect(buildCaveMenu(base).some((i) => i.action === "throw")).toBe(true);
  });
});

describe("buildObjectMenu (ui-context.c context_menu_object L654)", () => {
  const base = {
    isBook: false,
    canCast: false,
    canStudy: false,
    useKind: "other" as const,
    canFire: false,
    canRefill: false,
    isEquipped: false,
    canWear: false,
    canThrow: false,
    hasInscription: false,
  };

  it("always offers Inspect, Drop, and Inscribe", () => {
    const items = buildObjectMenu(base);
    expect(items.map((i) => i.action)).toEqual(expect.arrayContaining(["inspect", "drop", "inscribe"]));
  });

  it("offers Cast/Study only for a book, gated on the player's caster ability", () => {
    expect(buildObjectMenu({ ...base, isBook: true }).some((i) => i.action === "cast")).toBe(false);
    const casterBook = buildObjectMenu({ ...base, isBook: true, canCast: true, canStudy: true });
    expect(casterBook.some((i) => i.action === "cast")).toBe(true);
    expect(casterBook.some((i) => i.action === "study")).toBe(true);
  });

  it("maps each device tval to its faithful verb label", () => {
    expect(buildObjectMenu({ ...base, useKind: "wand" }).find((i) => i.action === "aim")).toBeDefined();
    expect(buildObjectMenu({ ...base, useKind: "rod" }).find((i) => i.action === "zap")).toBeDefined();
    expect(buildObjectMenu({ ...base, useKind: "staff" }).find((i) => i.action === "use-staff")).toBeDefined();
    expect(buildObjectMenu({ ...base, useKind: "scroll" }).find((i) => i.action === "read")).toBeDefined();
    expect(buildObjectMenu({ ...base, useKind: "potion" }).find((i) => i.action === "quaff")).toBeDefined();
    expect(buildObjectMenu({ ...base, useKind: "food" }).find((i) => i.action === "eat")).toBeDefined();
  });

  it("Activate is disabled unless the activatable item is worn", () => {
    const notWorn = buildObjectMenu({ ...base, useKind: "activatable" });
    expect(notWorn.find((i) => i.action === "activate")!.disabled).toBe(true);
    const worn = buildObjectMenu({ ...base, useKind: "activatable", isEquipped: true });
    expect(worn.find((i) => i.action === "activate")!.disabled).toBeFalsy();
  });

  it("offers Take off when equipped, Equip when wearable and not equipped, neither otherwise", () => {
    expect(buildObjectMenu({ ...base, isEquipped: true }).some((i) => i.action === "takeoff")).toBe(true);
    expect(buildObjectMenu({ ...base, canWear: true }).some((i) => i.action === "equip")).toBe(true);
    expect(buildObjectMenu(base).some((i) => i.action === "takeoff" || i.action === "equip")).toBe(false);
  });

  it("offers Throw only when throwable, Uninscribe only when inscribed, Refill only when refillable", () => {
    expect(buildObjectMenu(base).some((i) => i.action === "throw")).toBe(false);
    expect(buildObjectMenu({ ...base, canThrow: true }).some((i) => i.action === "throw")).toBe(true);
    expect(buildObjectMenu(base).some((i) => i.action === "uninscribe")).toBe(false);
    expect(buildObjectMenu({ ...base, hasInscription: true }).some((i) => i.action === "uninscribe")).toBe(true);
    expect(buildObjectMenu(base).some((i) => i.action === "refill")).toBe(false);
    expect(buildObjectMenu({ ...base, canRefill: true }).some((i) => i.action === "refill")).toBe(true);
  });
});
