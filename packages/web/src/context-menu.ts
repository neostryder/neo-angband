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
 * Entries whose backing feature is not (yet) part of this shell are included
 * DISABLED rather than omitted, so the menu's shape stays recognisable even
 * where the action is not wired: Steal (CMD_STEAL) and Jump Onto a trap
 * (CMD_JUMP) have no core command; Recall Info has no monster-lore viewer;
 * the knowledge menu, full map, monster list and options screen do not exist
 * yet. A single generic "Use" (upstream's CMD_USE, one key that auto-detects
 * wand/rod/staff/activatable) has no equivalent either, since this port
 * exposes those as separate per-type verbs (aim/zap/use-staff/activate) -
 * context_menu_object below offers all four directly instead. Explore and
 * Rest ARE wired (session/game.ts's installRunning / createDefaultRegistry),
 * though "rest" is currently just a single-turn hold, not upstream's N-turn
 * prompt - the port's own current limitation, not this gap's.
 */

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
  out.push({ label: "Cast", action: "cast", disabled: !ctx.canCast });
  out.push({ label: "Go Up", action: "go-up", disabled: !ctx.onUpStairs });
  out.push({ label: "Go Down", action: "go-down", disabled: !ctx.onDownStairs });
  out.push({ label: "Explore", action: "explore" }); // installRunning's exploreAction (session/game.ts)
  // "rest" is registered but currently aliased to a single-turn hold
  // (player-turn.ts createDefaultRegistry), not the upstream N-turn prompt;
  // still faithful to dispatch - it does whatever the port's "rest" does.
  out.push({ label: "Rest", action: "rest" });
  out.push({ label: "Look", action: "look" });
  out.push({ label: "Inventory", action: "inventory" });
  if (ctx.hasFloorObject) {
    out.push({ label: "Floor", action: "floor" });
    out.push({ label: "Pick up", action: "pickup", disabled: !ctx.canPickup });
  }
  out.push({ label: "Character", action: "character" });
  if (!ctx.centerPlayerOption) out.push({ label: "Center Map", action: "center-map" });
  out.push({ label: "Other", action: "other" });
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
 * labels, disabled where the shell has no such screen yet.
 */
export function buildPlayerOtherMenu(): MenuEntry<PlayerOtherAction>[] {
  return [
    { label: "Knowledge", action: "knowledge", disabled: true },
    { label: "Show Map", action: "map", disabled: true },
    { label: "Show Messages", action: "messages" },
    { label: "Show Monster List", action: "monsters", disabled: true },
    { label: "Show Object List", action: "objects" },
    { label: "Toggle Ignored", action: "toggle-ignore", disabled: true },
    { label: "Ignore setup", action: "ignore-setup" },
    { label: "Options", action: "options", disabled: true },
    { label: "Commands", action: "help" },
    { label: "Abilities", action: "abilities" },
    { label: "Compare equipment", action: "equip-cmp" },
  ];
}

/* ------------------------------------------------------------------ */
/* context_menu_cave (ui-context.c L426)                               */
/* ------------------------------------------------------------------ */

export type CaveMenuAction =
  | "look"
  | "use-on"
  | "cast-on"
  | "alter"
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
 * the grid's live contents, matching do_cmd_alter. Steal and Jump Onto are
 * included disabled (no CMD_STEAL/CMD_JUMP in this port); Recall Info is
 * omitted entirely (no monster-lore viewer to open - see the module header).
 */
export function buildCaveMenu(ctx: CaveMenuCtx): MenuEntry<CaveMenuAction>[] {
  const out: MenuEntry<CaveMenuAction>[] = [{ label: "Look At", action: "look" }];
  out.push({ label: "Use Item On", action: "use-on" });
  if (ctx.canCast) out.push({ label: "Cast On", action: "cast-on" });

  if (ctx.adjacent) {
    out.push({ label: ctx.hasMonster ? "Attack" : "Alter", action: "alter" });
    if (ctx.chest) {
      if (ctx.chest.locked) {
        out.push({ label: "Disarm Chest", action: "disarm-chest" });
        out.push({ label: "Open Chest", action: "open-chest" });
      } else {
        out.push({ label: "Open Disarmed Chest", action: "open-chest" });
      }
    }
    if (ctx.isDisarmableTrap) {
      out.push({ label: "Disarm", action: "disarm-trap" });
      out.push({ label: "Jump Onto", action: "jump-trap", disabled: true }); // no CMD_JUMP yet
    }
    if (ctx.isOpenDoor) {
      out.push({ label: "Close", action: "close" });
    } else if (ctx.isClosedDoor) {
      out.push({ label: "Open", action: "open-door" });
      out.push({ label: "Lock", action: "lock" });
    } else if (ctx.isDiggable) {
      out.push({ label: "Tunnel", action: "tunnel" });
    }
    out.push({ label: "Walk Towards", action: "walk" });
  } else {
    out.push({ label: "Pathfind To", action: "pathfind" });
    out.push({ label: "Walk Towards", action: "walk" });
    out.push({ label: "Run Towards", action: "run" });
  }

  if (ctx.canFire) out.push({ label: "Fire On", action: "fire" });
  out.push({ label: "Throw To", action: "throw" });
  return out;
}

/* ------------------------------------------------------------------ */
/* context_menu_object (ui-context.c L654)                             */
/* ------------------------------------------------------------------ */

export type ObjectMenuAction =
  | "inspect"
  | "cast"
  | "study"
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
  useKind: ObjectUseKind;
  canFire: boolean;
  canRefill: boolean;
  isEquipped: boolean;
  canWear: boolean;
  canThrow: boolean;
  hasInscription: boolean;
}

/**
 * context_menu_object (L654-900), minus Browse (obj_can_browse's read-only
 * spellbook view has no port screen yet) and per-instance Ignore/Unignore
 * (this port's ignore system is quality/ego/kind-based, not per-object - see
 * openIgnoreSetup; there is no single "ignore just this stack" command).
 */
export function buildObjectMenu(ctx: ObjectMenuCtx): MenuEntry<ObjectMenuAction>[] {
  const out: MenuEntry<ObjectMenuAction>[] = [{ label: "Inspect", action: "inspect" }];

  if (ctx.isBook) {
    if (ctx.canCast) out.push({ label: "Cast", action: "cast" });
    if (ctx.canStudy) out.push({ label: "Study", action: "study" });
  } else {
    switch (ctx.useKind) {
      case "wand":
        out.push({ label: "Aim", action: "aim" });
        break;
      case "rod":
        out.push({ label: "Zap", action: "zap" });
        break;
      case "staff":
        out.push({ label: "Use", action: "use-staff" });
        break;
      case "scroll":
        out.push({ label: "Read", action: "read" });
        break;
      case "potion":
        out.push({ label: "Quaff", action: "quaff" });
        break;
      case "food":
        out.push({ label: "Eat", action: "eat" });
        break;
      case "activatable":
        out.push({ label: "Activate", action: "activate", disabled: !ctx.isEquipped });
        break;
      default:
        if (ctx.canFire) out.push({ label: "Fire", action: "fire" });
        break;
    }
  }

  if (ctx.canRefill) out.push({ label: "Refill", action: "refill" });

  if (ctx.isEquipped) out.push({ label: "Take off", action: "takeoff" });
  else if (ctx.canWear) out.push({ label: "Equip", action: "equip" });

  out.push({ label: "Drop", action: "drop" });
  if (ctx.canThrow) out.push({ label: "Throw", action: "throw" });
  out.push({ label: "Inscribe", action: "inscribe" });
  if (ctx.hasInscription) out.push({ label: "Uninscribe", action: "uninscribe" });
  out.push({ label: "Ignore", action: "ignore", disabled: true });

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
