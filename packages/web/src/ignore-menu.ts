/**
 * The per-item ignore menu (ui-object.c:1701-1837 textui_cmd_ignore /
 * textui_cmd_ignore_menu). A faithful port of the 'k' / ^D command: pick one
 * carried, worn or floor item, then choose how widely to ignore it - this item
 * only, its whole flavour/kind, its ego across a quality type, or every item of
 * its quality tier and type. There are no confirmation prompts and no result
 * messages upstream, so there are none here.
 *
 * The menu assembly (buildIgnoreItemMenu) is pure and DOM-free so it is unit
 * testable; the mutation (applyIgnoreItemChoice) drives the port's ignore
 * engine (packages/core/src/obj/ignore.ts); showIgnoreItemMenu wires the item
 * picker, the overlay menu and the ignore-drop pass together for main.ts.
 *
 * The port carries no per-object `known` twin (obj/ignore.ts's KNOWLEDGE note):
 * every object runs as fully known, so `obj->known->notice` reads obj.notice
 * and `obj->known->ego` reads obj.ego directly. The upstream
 * `player->upkeep->notice |= PN_IGNORE` re-run (ui-object.c:1820) is the shell's
 * applyIgnoreDrop() pass, invoked by showIgnoreItemMenu after the choice.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import {
  describeObject,
  ODESC,
  ignoreTypeOf,
  ignoreLevelOf,
  ITYPE_MAX,
  IGNORE,
  QUALITY_VALUE_NAMES,
  IGNORE_TYPE_ENTRIES,
  OBJ_NOTICE,
  tvalIsJewelry,
  gearGet,
  floorPile,
} from "@neo-angband/core";
import type { GameState, GameObject } from "@neo-angband/core";
import { packMenu, objectName, SVAL_DEPENDENT } from "./screens";
import { selectFromMenu } from "./overlay";
import type { MenuItem } from "./overlay";
import type { GlyphTerm } from "./term";

/**
 * The seven selectable actions (ui-object.c:1701-1709 anonymous enum). Kept as
 * string tags rather than ints so the menu-entry array is self-describing.
 */
export const IGNORE_ACTION = {
  ITEM: "ignore-this-item",
  UNIGNORE_ITEM: "unignore-this-item",
  FLAVOR: "ignore-this-flavor",
  UNIGNORE_FLAVOR: "unignore-this-flavor",
  EGO: "ignore-this-ego",
  UNIGNORE_EGO: "unignore-this-ego",
  QUALITY: "ignore-this-quality",
} as const;

export type IgnoreAction = (typeof IGNORE_ACTION)[keyof typeof IGNORE_ACTION];

/** One assembled menu row: its exact label and the action it performs. */
export interface IgnoreMenuEntry {
  label: string;
  action: IgnoreAction;
}

/**
 * The pure inputs buildIgnoreItemMenu needs - every conditional and label
 * already resolved from the object + ignore settings (ignoreItemMenuCtx does
 * that resolution against the live game). Optional rows are present exactly
 * when their upstream guard passes.
 */
export interface IgnoreItemMenuCtx {
  /** obj->known->notice & OBJ_NOTICE_IGNORE (ui-object.c:1728). */
  itemIgnored: boolean;
  /**
   * The flavour/kind row - present iff ignore_tval(obj->tval) &&
   * (!obj->artifact || !object_flavor_is_aware(obj)) (ui-object.c:1735-1736).
   * `label` is the ODESC_NOEGO|ODESC_BASE|ODESC_PLURAL name (the `tmp` at
   * ui-object.c:1741); `ignored` is kind_is_ignored_aware ||
   * kind_is_ignored_unaware (ui-object.c:1737-1738).
   */
  flavor?: { label: string; ignored: boolean };
  /**
   * The ego row - present iff obj->known->ego && ignore_type_of(obj) !=
   * ITYPE_MAX (ui-object.c:1755). `name` is ego_item_name's tmp+4
   * (ui-object.c:1763-1765): the ignore type's name + " " + the full ego name
   * (upstream passes short_name="" so the whole ego name lands as the
   * "prefix"; see ui-options.c:1301 ego_item_name).
   */
  ego?: { name: string; ignored: boolean };
  /**
   * The quality row - present iff value != IGNORE_MAX && ignore_type_of(obj)
   * != ITYPE_MAX (ui-object.c:1779), where value is ignore_level_of(obj) with
   * the jewelry special-case (ui-object.c:1774-1777). `tierName` is
   * quality_values[value].name, `typeName` is ignore_name_for_type(type)
   * (ui-object.c:1780-1781).
   */
  quality?: { tierName: string; typeName: string };
}

/**
 * buildIgnoreItemMenu (ui-object.c:1724-1784): assemble the ordered menu rows.
 * The order is fixed - basic, flavour, ego, quality - and each optional row
 * appears only when its ctx field is present. Pure: no game state, no DOM.
 */
export function buildIgnoreItemMenu(ctx: IgnoreItemMenuCtx): IgnoreMenuEntry[] {
  const entries: IgnoreMenuEntry[] = [];

  /* Basic ignore option (ui-object.c:1727-1732). */
  if (!ctx.itemIgnored) {
    entries.push({ label: "This item only", action: IGNORE_ACTION.ITEM });
  } else {
    entries.push({ label: "Unignore this item", action: IGNORE_ACTION.UNIGNORE_ITEM });
  }

  /* Flavour-aware ignore (ui-object.c:1734-1750). */
  if (ctx.flavor) {
    if (!ctx.flavor.ignored) {
      entries.push({ label: `All ${ctx.flavor.label}`, action: IGNORE_ACTION.FLAVOR });
    } else {
      entries.push({
        label: `Unignore all ${ctx.flavor.label}`,
        action: IGNORE_ACTION.UNIGNORE_FLAVOR,
      });
    }
  }

  /* Ego ignoring (ui-object.c:1754-1771). */
  if (ctx.ego) {
    if (!ctx.ego.ignored) {
      entries.push({ label: `All ${ctx.ego.name}`, action: IGNORE_ACTION.EGO });
    } else {
      entries.push({
        label: `Unignore all ${ctx.ego.name}`,
        action: IGNORE_ACTION.UNIGNORE_EGO,
      });
    }
  }

  /* Quality ignoring (ui-object.c:1773-1784). */
  if (ctx.quality) {
    entries.push({
      label: `All ${ctx.quality.tierName} ${ctx.quality.typeName}`,
      action: IGNORE_ACTION.QUALITY,
    });
  }

  return entries;
}

/** True flavour awareness for an object's kind (object_flavor_is_aware). */
function flavorIsAware(state: GameState, game: IgnoreMenuGame, obj: GameObject): boolean {
  if (game.flavor) return game.flavor.isAware(obj.kind);
  return state.isAware ? state.isAware(obj.kind) : true;
}

/** ignore_tval (ui-options.c:1699): the tval is an sval-ignore category. A
 * real held object always has num_svals >= 1, so only the sval_dependent
 * membership test (SVAL_DEPENDENT) is meaningful here. */
function ignoreTval(tval: number): boolean {
  return SVAL_DEPENDENT.some((d) => d.tval === tval);
}

/**
 * Resolve the live object + ignore settings into the pure ctx that
 * buildIgnoreItemMenu consumes, mirroring the guards in
 * textui_cmd_ignore_menu (ui-object.c:1724-1784).
 */
export function ignoreItemMenuCtx(
  obj: GameObject,
  state: GameState,
  game: IgnoreMenuGame,
): IgnoreItemMenuCtx {
  const ctx: IgnoreItemMenuCtx = {
    itemIgnored: (obj.notice & OBJ_NOTICE.IGNORE) !== 0,
  };

  const type = ignoreTypeOf(obj);
  const aware = flavorIsAware(state, game, obj);

  /* Flavour row (ui-object.c:1735-1736). */
  if (ignoreTval(obj.tval) && (!obj.artifact || !aware)) {
    const kidx = obj.kind.kidx;
    const ignored =
      state.ignore.kindIsIgnoredAware(kidx) || state.ignore.kindIsIgnoredUnaware(kidx);
    ctx.flavor = {
      label: describeObject(state, obj, ODESC.NOEGO | ODESC.BASE | ODESC.PLURAL),
      ignored,
    };
  }

  /* Ego row (ui-object.c:1755). The label is the ignore type's name + " " +
   * the full ego name (ego_item_name's tmp+4 with an empty short_name). */
  if (obj.ego && type !== ITYPE_MAX) {
    const typeName = IGNORE_TYPE_ENTRIES[type]?.description ?? "";
    ctx.ego = {
      name: `${typeName} ${obj.ego.name}`,
      ignored: state.ignore.egoIsIgnored(obj.ego.eidx, type),
    };
  }

  /* Quality row (ui-object.c:1773-1784) with the jewelry special-case. */
  let value: number = ignoreLevelOf(obj);
  if (tvalIsJewelry(obj.tval) && ignoreLevelOf(obj) !== IGNORE.BAD) {
    value = IGNORE.MAX;
  }
  if (value !== IGNORE.MAX && type !== ITYPE_MAX) {
    ctx.quality = {
      tierName: QUALITY_VALUE_NAMES[value] ?? "",
      typeName: IGNORE_TYPE_ENTRIES[type]?.description ?? "",
    };
  }

  return ctx;
}

/** The flavour-knowledge slice this menu reads off the booted game. */
export interface IgnoreMenuGame {
  flavor?: { isAware(kind: GameObject["kind"]): boolean };
}

/**
 * applyIgnoreItemChoice (ui-object.c:1801-1818): perform the exact ignore-state
 * mutation for a chosen action. It does NOT run the ignore-drop pass - the
 * caller does, matching the upstream PN_IGNORE re-run (ui-object.c:1820).
 */
export function applyIgnoreItemChoice(
  action: IgnoreAction,
  obj: GameObject,
  state: GameState,
  game: IgnoreMenuGame,
): void {
  switch (action) {
    /* obj->known->notice |= OBJ_NOTICE_IGNORE (ui-object.c:1801-1802). */
    case IGNORE_ACTION.ITEM:
      obj.notice |= OBJ_NOTICE.IGNORE;
      break;
    /* obj->known->notice &= ~OBJ_NOTICE_IGNORE (ui-object.c:1803-1804). */
    case IGNORE_ACTION.UNIGNORE_ITEM:
      obj.notice &= ~OBJ_NOTICE.IGNORE;
      break;
    /* object_ignore_flavor_of(obj) (ui-object.c:1805-1806 / obj-ignore.c:370):
     * set the aware or unaware kind bit by current flavour awareness. */
    case IGNORE_ACTION.FLAVOR:
      if (flavorIsAware(state, game, obj)) {
        state.ignore.kindIgnoreWhenAware(obj.kind.kidx);
      } else {
        state.ignore.kindIgnoreWhenUnaware(obj.kind.kidx);
      }
      break;
    /* kind_ignore_clear(obj->kind) (ui-object.c:1807-1808 / obj-ignore.c:519). */
    case IGNORE_ACTION.UNIGNORE_FLAVOR:
      state.ignore.kindIgnoreClear(obj.kind.kidx);
      break;
    /* ego_ignore(obj) / ego_ignore_clear(obj) (ui-object.c:1809-1812 /
     * obj-ignore.c:525/532). The port exposes only egoToggle (see MODULE NOTE
     * in the returned report); the menu only offers the ignore action when the
     * ego is not ignored and the unignore action when it is, so the toggle
     * always lands on the intended boolean. */
    case IGNORE_ACTION.EGO:
    case IGNORE_ACTION.UNIGNORE_EGO:
      if (obj.ego) state.ignore.egoToggle(obj.ego.eidx, ignoreTypeOf(obj));
      break;
    /* ignore_level[ignore_type_of(obj)] = ignore_level_of(obj)
     * (ui-object.c:1813-1817). */
    case IGNORE_ACTION.QUALITY: {
      const type = ignoreTypeOf(obj);
      if (type !== ITYPE_MAX) state.ignore.level[type] = ignoreLevelOf(obj);
      break;
    }
  }
}

/** The nothing-to-ignore text (ui-object.c:1831). */
const IGNORE_REJECT = "You have nothing to ignore.";
/** The item-pick prompt (ui-object.c:1830). */
const IGNORE_PROMPT = "Ignore which item?";
/** The menu's top line (ui-object.c:1796). */
const IGNORE_TITLE = "(Enter to select, ESC) Ignore:";

/**
 * The get_item pick for textui_cmd_ignore (ui-object.c:1832-1833):
 * USE_INVEN | USE_QUIVER | USE_EQUIP | USE_FLOOR. The quiver rides the pack in
 * this gear model (as in main.ts's selectTargetItem), so packMenu covers it.
 * Returns the chosen live object, or null on ESC / an empty menu.
 */
async function pickIgnoreItem(
  term: GlyphTerm,
  state: GameState,
  say: (text: string) => void,
): Promise<GameObject | null> {
  const items: MenuItem[] = [];
  const objs: GameObject[] = [];

  const { items: packItems, handles } = packMenu(state, () => true);
  packItems.forEach((it, i) => {
    const obj = gearGet(state.gear, handles[i]!);
    if (!obj) return;
    items.push(it);
    objs.push(obj);
  });

  const player = state.actor.player;
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    items.push({ label: objectName(state, obj), color: "#c8c8d4" });
    objs.push(obj);
  }

  floorPile(state, state.actor.grid).forEach((obj) => {
    items.push({ label: `${objectName(state, obj)} (on floor)`, color: "#c8c8d4" });
    objs.push(obj);
  });

  if (items.length === 0) {
    say(IGNORE_REJECT);
    return null;
  }

  const idx = await selectFromMenu(term, IGNORE_PROMPT, items);
  if (idx === null) return null;
  return objs[idx] ?? null;
}

/**
 * showIgnoreItemMenu (ui-object.c:1825-1837 textui_cmd_ignore +
 * textui_cmd_ignore_menu): the whole 'k' / ^D flow. Pick an item, build and
 * show the ignore menu, apply the choice, then run the ignore-drop pass (the
 * PN_IGNORE re-run). ESC at either prompt aborts with no change.
 */
export async function showIgnoreItemMenu(
  term: GlyphTerm,
  state: GameState,
  game: IgnoreMenuGame,
  say: (text: string) => void,
  applyIgnoreDrop: () => Promise<void>,
): Promise<void> {
  const obj = await pickIgnoreItem(term, state, say);
  if (!obj) return;

  const entries = buildIgnoreItemMenu(ignoreItemMenuCtx(obj, state, game));
  const items: MenuItem[] = entries.map((e) => ({ label: e.label }));
  const idx = await selectFromMenu(term, IGNORE_TITLE, items);
  if (idx === null) return;

  const entry = entries[idx];
  if (!entry) return;

  applyIgnoreItemChoice(entry.action, obj, state, game);
  await applyIgnoreDrop();
}
