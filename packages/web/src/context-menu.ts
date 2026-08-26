/**
 * The right-click / long-press context menus (reference/src/ui-context.c):
 * context_menu_player (right-click the player's own tile), context_menu_cave
 * (right-click a map grid), and context_menu_object (a per-item action menu,
 * reached here from the inventory/equipment picker rather than the map).
 *
 * This module only builds the faithful entry lists (pure, unit-testable) and
 * classifies a click (routeContextClick, textui_process_click's routing).
 * Dispatch - pushing the SAME PlayerCommand the keyboard path would, or
 * calling the same shell handler a key press calls - lives in main.ts, which
 * owns the live GameState and every existing verb handler (castSpell,
 * useItem, fireCmd, ...) these menus reuse rather than reimplement.
 *
 * Every backing feature these menus reference is now wired in main.ts: Jump
 * Onto (jumpCmd), Recall Info (showMonsterRecall), Steal (stealCmd), the
 * knowledge menu (openKnowledgeMenu), full map (showLevelMap), monster list
 * (showMonsterList), options (runOptionsMenu) and the ignore toggle. A single
 * generic "Use" (upstream's CMD_USE, one key that auto-detects wand/rod/staff/
 * activatable) is the one deliberate omission: this port exposes those as
 * separate per-type verbs (aim/zap/use-staff/activate), and context_menu_object
 * below offers all four directly instead.
 */

import { t } from "@rpgm-tools/neo-angband-core";

export interface MenuEntry<A extends string> {
  label: string;
  action: A;
  disabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* context_menu_player (ui-context.c L248)                             */
/* ------------------------------------------------------------------ */

export type PlayerMenuAction =
  | "cast"
  | "go-up"
  | "go-down"
  | "explore"
  | "rest"
  | "look"
  | "inventory"
  | "floor"
  | "pickup"
  | "character"
  | "center-map"
  | "other";

export interface PlayerMenuCtx {
  canCast: boolean;
  onUpStairs: boolean;
  onDownStairs: boolean;
  /** square_object(cave, player->grid) exists and is not ignored. */
  hasFloorObject: boolean;
  /** inven_carry_okay(obj): whether Pick up is actionable right now. */
  canPickup: boolean;
  /** OPT(player, center_player): Center Map is offered only when off. */
  centerPlayerOption: boolean;
}

/** context_menu_player (L248-424), minus the mouse-specific labels/keys. */
export function buildPlayerMenu(ctx: PlayerMenuCtx): MenuEntry<PlayerMenuAction>[] {
  const out: MenuEntry<PlayerMenuAction>[] = [];
  out.push({ label: t("contextMenu.player.cast.label", "Cast"), action: "cast", disabled: !ctx.canCast });
  out.push({ label: t("contextMenu.player.goUp.label", "Go Up"), action: "go-up", disabled: !ctx.onUpStairs });
  out.push({
    label: t("contextMenu.player.goDown.label", "Go Down"),
    action: "go-down",
    disabled: !ctx.onDownStairs,
  });
  out.push({ label: t("contextMenu.player.explore.label", "Explore"), action: "explore" }); // installRunning's exploreAction (session/game.ts)
  // "Look" precedes "Rest" (ui-context.c L289 before L292) - the entry order
  // sets the auto-assigned quick-select letters, so the order must match.
  out.push({ label: t("contextMenu.player.look.label", "Look"), action: "look" });
  // "Rest" opens the full do_cmd_rest prompt (main.ts restCmd): N turns, '&' as
  // needed, '*' HP+SP, '!' HP or SP - matching textui_cmd_rest.
  out.push({ label: t("contextMenu.player.rest.label", "Rest"), action: "rest" });
  out.push({ label: t("contextMenu.player.inventory.label", "Inventory"), action: "inventory" });
  if (ctx.hasFloorObject) {
    out.push({ label: t("contextMenu.player.floor.label", "Floor"), action: "floor" });
    out.push({
      label: t("contextMenu.player.pickup.label", "Pick up"),
      action: "pickup",
      disabled: !ctx.canPickup,
    });
  }
  out.push({ label: t("contextMenu.player.character.label", "Character"), action: "character" });
  if (!ctx.centerPlayerOption)
    out.push({ label: t("contextMenu.player.centerMap.label", "Center Map"), action: "center-map" });
  out.push({ label: t("contextMenu.player.other.label", "Other"), action: "other" });
  return out;
}

/* context_menu_player_2 (L84-215): the "Other" submenu. */
export type PlayerOtherAction =
  | "knowledge"
  | "map"
  | "messages"
  | "monsters"
  | "objects"
  | "toggle-ignore"
  | "ignore-setup"
  | "options"
  | "help"
  | "abilities"
  | "equip-cmp";

/**
 * The "Other" submenu. Abilities and Compare-equipment are this port's own
 * discoverable homes for the two new screens (no vanilla keybinding exists
 * for either - see the gap's risk note); everything else mirrors upstream's
 * labels. Knowledge, Show Map, Show Monster List, Toggle Ignored and Options
 * are all wired now (openKnowledgeMenu / showLevelMap / showMonsterList /
 * the K ignore toggle / runOptionsMenu in main.ts), so none are disabled.
 */
export function buildPlayerOtherMenu(): MenuEntry<PlayerOtherAction>[] {
  return [
    { label: t("contextMenu.playerOther.knowledge.label", "Knowledge"), action: "knowledge" },
    { label: t("contextMenu.playerOther.map.label", "Show Map"), action: "map" },
    { label: t("contextMenu.playerOther.messages.label", "Show Messages"), action: "messages" },
    { label: t("contextMenu.playerOther.monsters.label", "Show Monster List"), action: "monsters" },
    { label: t("contextMenu.playerOther.objects.label", "Show Object List"), action: "objects" },
    { label: t("contextMenu.playerOther.toggleIgnore.label", "Toggle Ignored"), action: "toggle-ignore" },
    { label: t("contextMenu.playerOther.ignoreSetup.label", "Ignore setup"), action: "ignore-setup" },
    { label: t("contextMenu.playerOther.options.label", "Options"), action: "options" },
    { label: t("contextMenu.playerOther.help.label", "Commands"), action: "help" },
    { label: t("contextMenu.playerOther.abilities.label", "Abilities"), action: "abilities" },
    { label: t("contextMenu.playerOther.equipCmp.label", "Compare equipment"), action: "equip-cmp" },
  ];
}

/* ------------------------------------------------------------------ */
/* context_menu_cave (ui-context.c L426)                               */
/* ------------------------------------------------------------------ */

export type CaveMenuAction =
  | "look"
  | "recall"
  | "use-on"
  | "cast-on"
  | "alter"
  | "steal"
  | "disarm-chest"
  | "open-chest"
  | "disarm-trap"
  | "jump-trap"
  | "close"
  | "open-door"
  | "lock"
  | "tunnel"
  | "walk"
  | "run"
  | "pathfind"
  | "fire"
  | "throw";

export interface CaveMenuCtx {
  adjacent: boolean;
  hasMonster: boolean;
  canCast: boolean;
  canFire: boolean;
  /** player_has(player, PF_STEAL): the rogue steal ability. */
  canSteal: boolean;
  /** chest_check(player, grid, CHEST_ANY) not ignored. */
  chest: { locked: boolean } | null;
  isDisarmableTrap: boolean;
  isOpenDoor: boolean;
  isClosedDoor: boolean;
  isDiggable: boolean;
}

/**
 * context_menu_cave (L426-649). "Attack" vs "Alter" (L462) collapse to one
 * action - the core "alter" command already resolves attack-vs-alter from
 * the grid's live contents, matching do_cmd_alter. "Recall Info" (L450-453,
 * key '/') is shown whenever the grid holds a monster and opens the lore
 * viewer (main.ts showMonsterRecall). Steal (L478-480) is a cave-menu entry
 * when the grid holds a monster and the player has PF_STEAL. Jump Onto
 * (CMD_JUMP, main.ts jumpCmd) is now wired, so it is enabled.
 */
export function buildCaveMenu(ctx: CaveMenuCtx): MenuEntry<CaveMenuAction>[] {
  const out: MenuEntry<CaveMenuAction>[] = [
    { label: t("contextMenu.cave.look.label", "Look At"), action: "look" },
  ];
  // Recall Info sits right after Look At when a monster is present (L450-453).
  if (ctx.hasMonster)
    out.push({ label: t("contextMenu.cave.recall.label", "Recall Info"), action: "recall" });
  out.push({ label: t("contextMenu.cave.useOn.label", "Use Item On"), action: "use-on" });
  if (ctx.canCast) out.push({ label: t("contextMenu.cave.castOn.label", "Cast On"), action: "cast-on" });

  if (ctx.adjacent) {
    out.push({
      label: ctx.hasMonster
        ? t("contextMenu.cave.attack.label", "Attack")
        : t("contextMenu.cave.alter.label", "Alter"),
      action: "alter",
    });
    if (ctx.chest) {
      if (ctx.chest.locked) {
        out.push({ label: t("contextMenu.cave.disarmChest.label", "Disarm Chest"), action: "disarm-chest" });
        out.push({ label: t("contextMenu.cave.openChest.label", "Open Chest"), action: "open-chest" });
      } else {
        out.push({
          label: t("contextMenu.cave.openDisarmedChest.label", "Open Disarmed Chest"),
          action: "open-chest",
        });
      }
    }
    // Steal follows the chest block, before trap disarm (L478-480).
    if (ctx.hasMonster && ctx.canSteal)
      out.push({ label: t("contextMenu.cave.steal.label", "Steal"), action: "steal" });
    if (ctx.isDisarmableTrap) {
      out.push({ label: t("contextMenu.cave.disarm.label", "Disarm"), action: "disarm-trap" });
      out.push({ label: t("contextMenu.cave.jumpOnto.label", "Jump Onto"), action: "jump-trap" }); // CMD_JUMP -> jumpCmd
    }
    if (ctx.isOpenDoor) {
      out.push({ label: t("contextMenu.cave.close.label", "Close"), action: "close" });
    } else if (ctx.isClosedDoor) {
      out.push({ label: t("contextMenu.cave.open.label", "Open"), action: "open-door" });
      out.push({ label: t("contextMenu.cave.lock.label", "Lock"), action: "lock" });
    } else if (ctx.isDiggable) {
      out.push({ label: t("contextMenu.cave.tunnel.label", "Tunnel"), action: "tunnel" });
    }
    out.push({ label: t("contextMenu.cave.walkTowards.label", "Walk Towards"), action: "walk" });
  } else {
    out.push({ label: t("contextMenu.cave.pathfindTo.label", "Pathfind To"), action: "pathfind" });
    out.push({ label: t("contextMenu.cave.walkTowards.label", "Walk Towards"), action: "walk" });
    out.push({ label: t("contextMenu.cave.runTowards.label", "Run Towards"), action: "run" });
  }

  if (ctx.canFire) out.push({ label: t("contextMenu.cave.fireOn.label", "Fire On"), action: "fire" });
  out.push({ label: t("contextMenu.cave.throwTo.label", "Throw To"), action: "throw" });
  return out;
}

/* ------------------------------------------------------------------ */
/* context_menu_object (ui-context.c L654)                             */
/* ------------------------------------------------------------------ */

export type ObjectMenuAction =
  | "inspect"
  | "cast"
  | "study"
  | "browse"
  | "aim"
  | "zap"
  | "use-staff"
  | "read"
  | "quaff"
  | "eat"
  | "activate"
  | "fire"
  | "refill"
  | "takeoff"
  | "equip"
  | "drop"
  | "throw"
  | "inscribe"
  | "uninscribe"
  | "ignore";

export type ObjectUseKind = "wand" | "rod" | "staff" | "scroll" | "potion" | "food" | "activatable" | "other";

export interface ObjectMenuCtx {
  isBook: boolean;
  canCast: boolean;
  canStudy: boolean;
  /**
   * player_can_read(player, false) (ui-context.c:689), the gate on the Browse
   * row. Separate from canCast because a class that cannot cast from a book can
   * still read it, and blind/confused blocks reading without blocking either of
   * the other two.
   */
  canBrowse: boolean;
  useKind: ObjectUseKind;
  canFire: boolean;
  canRefill: boolean;
  isEquipped: boolean;
  canWear: boolean;
  canThrow: boolean;
  hasInscription: boolean;
  /** object_is_ignored(obj) (ui-context.c:770): drives the Ignore/Unignore label. */
  isIgnored: boolean;
}

/**
 * context_menu_object (L654-900). The Ignore/Unignore entry (ui-context.c:770)
 * opens the same per-item ignore menu as the 'k' / ^D command
 * (textui_cmd_ignore_menu; see web/src/ignore-menu.ts).
 *
 * Browse (L690) used to be omitted here, with a comment saying the read-only
 * spellbook view "has no port screen yet" - it had one all along (browseCmd, the
 * 'b' command). The stated reason was untrue, so nothing ever went back to check
 * it, and a spellbook in this menu offered Cast and Study with no way to read it.
 */
export function buildObjectMenu(ctx: ObjectMenuCtx): MenuEntry<ObjectMenuAction>[] {
  const out: MenuEntry<ObjectMenuAction>[] = [
    { label: t("contextMenu.object.inspect.label", "Inspect"), action: "inspect" },
  ];

  if (ctx.isBook) {
    /* L683-690, in this order: Cast, Study, Browse. */
    if (ctx.canCast) out.push({ label: t("contextMenu.object.cast.label", "Cast"), action: "cast" });
    if (ctx.canStudy) out.push({ label: t("contextMenu.object.study.label", "Study"), action: "study" });
    if (ctx.canBrowse) out.push({ label: t("contextMenu.object.browse.label", "Browse"), action: "browse" });
  } else {
    switch (ctx.useKind) {
      case "wand":
        out.push({ label: t("contextMenu.object.aim.label", "Aim"), action: "aim" });
        break;
      case "rod":
        out.push({ label: t("contextMenu.object.zap.label", "Zap"), action: "zap" });
        break;
      case "staff":
        out.push({ label: t("contextMenu.object.useStaff.label", "Use"), action: "use-staff" });
        break;
      case "scroll":
        out.push({ label: t("contextMenu.object.read.label", "Read"), action: "read" });
        break;
      case "potion":
        out.push({ label: t("contextMenu.object.quaff.label", "Quaff"), action: "quaff" });
        break;
      case "food":
        out.push({ label: t("contextMenu.object.eat.label", "Eat"), action: "eat" });
        break;
      case "activatable":
        out.push({
          label: t("contextMenu.object.activate.label", "Activate"),
          action: "activate",
          disabled: !ctx.isEquipped,
        });
        break;
      default:
        if (ctx.canFire) out.push({ label: t("contextMenu.object.fire.label", "Fire"), action: "fire" });
        break;
    }
  }

  if (ctx.canRefill) out.push({ label: t("contextMenu.object.refill.label", "Refill"), action: "refill" });

  if (ctx.isEquipped) out.push({ label: t("contextMenu.object.takeoff.label", "Take off"), action: "takeoff" });
  else if (ctx.canWear) out.push({ label: t("contextMenu.object.equip.label", "Equip"), action: "equip" });

  out.push({ label: t("contextMenu.object.drop.label", "Drop"), action: "drop" });
  if (ctx.canThrow) out.push({ label: t("contextMenu.object.throw.label", "Throw"), action: "throw" });
  out.push({ label: t("contextMenu.object.inscribe.label", "Inscribe"), action: "inscribe" });
  if (ctx.hasInscription)
    out.push({ label: t("contextMenu.object.uninscribe.label", "Uninscribe"), action: "uninscribe" });
  out.push({
    label: ctx.isIgnored
      ? t("contextMenu.object.unignore.label", "Unignore")
      : t("contextMenu.object.ignore.label", "Ignore"),
    action: "ignore",
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* textui_process_click's routing (ui-context.c L998)                  */
/* ------------------------------------------------------------------ */

export type ContextClickTarget = "player" | "cave-adjacent" | "cave-far";

/**
 * Classify a right-click / long-press grid against the player's own grid:
 * the player's tile opens context_menu_player; any other tile opens
 * context_menu_cave, "adjacent" when the two grids are within one square
 * (loc_eq / the +-1 bounding test at L1070-1071 and L1106-1107).
 */
export function routeContextClick(
  playerGrid: { x: number; y: number },
  clickGrid: { x: number; y: number },
): ContextClickTarget {
  if (playerGrid.x === clickGrid.x && playerGrid.y === clickGrid.y) return "player";
  const dx = Math.abs(clickGrid.x - playerGrid.x);
  const dy = Math.abs(clickGrid.y - playerGrid.y);
  return dx <= 1 && dy <= 1 ? "cave-adjacent" : "cave-far";
}
