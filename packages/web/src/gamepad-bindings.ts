/**
 * What each button on THIS pad does, and what it does by default.
 *
 * A binding target is one of three strings, and the difference between them is
 * who owns the meaning:
 *
 * - `role:<name>` belongs to the adapter. Confirm, cancel, the command wheel,
 *   the modifier layer. These are the only inputs whose meaning changes with
 *   the question on screen, and they are the reason a pad can answer a prompt
 *   at all.
 * - `cmd:<name>` belongs to the game. The name is `commandName`'s: the
 *   ORIGINAL keyset's key for that command where it has one, and the command's
 *   own label where it does not. Either way it is a name rather than an
 *   instruction to press something, and the adapter looks the command up in the
 *   live command table, so a player using the roguelike keyset gets the same
 *   command through the key that keyset actually uses. Binding a pad button to
 *   a letter would have quietly changed meaning with the keyset option, which
 *   is exactly the bug a player would report as "my controller stopped
 *   working".
 * - `key:<literal>` is the escape hatch, one literal keypress, for the
 *   handful of root controls that are not command-table rows.
 *
 * Defaults are DERIVED from what the pad reports rather than looked up per
 * device. A layout table per controller model is a table that is wrong for
 * every controller nobody thought of, and the Gamepad API already answers the
 * only questions that matter: how many buttons, how many axes, and does the
 * browser recognise the arrangement.
 */
import type { PadCapabilities } from "./gamepad-device";
import { STANDARD_BUTTON } from "./gamepad-device";
import type { DeadZone } from "./gamepad-analog";
import { DEFAULT_DEAD_ZONE } from "./gamepad-analog";

/** Adapter-owned inputs. Everything else is a game command or a literal key. */
export type GamepadRole =
  | "confirm"
  | "cancel"
  | "commands"
  | "layer"
  | "stop"
  | "wait"
  | "page-prev"
  | "page-next"
  | "legend";

export const GAMEPAD_ROLES: readonly GamepadRole[] = [
  "confirm", "cancel", "commands", "layer", "stop", "wait", "page-prev", "page-next", "legend",
];

export const ROLE_LABEL: Record<GamepadRole, string> = {
  confirm: "Confirm",
  cancel: "Cancel or go back",
  commands: "Command wheel",
  layer: "Hold for second layer",
  stop: "Stop running or resting",
  wait: "Stand still",
  "page-prev": "Previous page or list",
  "page-next": "Next page or list",
  legend: "Controller legend and mapping",
};

export type BindingTarget = `role:${GamepadRole}` | `cmd:${string}` | `key:${string}`;

export interface GamepadBindings {
  /** Button index to target. An index with no entry does nothing. */
  readonly buttons: Readonly<Record<number, BindingTarget>>;
  /** The same, consulted instead while a `role:layer` button is held. */
  readonly layer: Readonly<Record<number, BindingTarget>>;
  readonly deadZone: DeadZone;
}

/**
 * Roles a pad cannot play without, in the order they are assigned when there
 * are not enough buttons to go round.
 *
 * Confirm and cancel come first because every prompt in the game needs both.
 * The wheel is third because it is what makes the remaining commands reachable
 * at all: on a four-button pad it is the difference between a playable
 * character and a character that can only walk.
 */
const ESSENTIAL_ROLES: readonly GamepadRole[] = ["confirm", "cancel", "commands", "layer"];

/**
 * Commands worth a button of their own on a pad that has buttons to spare.
 *
 * Chosen by how often a turn needs them rather than by how important the
 * command is: picking up, shooting the nearest monster and looking are the
 * actions a player takes between other actions, and a wheel visit for each one
 * is the thing that makes a controller feel slower than a keyboard.
 */
const PRIMARY_COMMANDS: readonly BindingTarget[] = ["cmd:g", "cmd:h"];

function assign(
  target: Record<number, BindingTarget>,
  index: number,
  value: BindingTarget,
  buttonCount: number,
): void {
  if (index < buttonCount) target[index] = value;
}

/**
 * The layout a player gets before they ever open the mapping screen.
 *
 * Every branch below is guarded on the reported button count, so a pad with
 * eleven buttons and a pad with seventeen both come out playable rather than
 * one of them coming out with bindings on buttons it does not have.
 */
export function defaultBindings(capabilities: PadCapabilities): GamepadBindings {
  const count = capabilities.buttonCount;
  const buttons: Record<number, BindingTarget> = {};
  const layer: Record<number, BindingTarget> = {};

  if (count < 4) {
    // Fewer than four buttons cannot hold the essential roles AND a modifier,
    // so the modifier is what goes: the wheel still reaches every command, it
    // just takes the whole of the small pad to drive.
    const minimal: readonly GamepadRole[] = ["confirm", "cancel", "commands"];
    minimal.forEach((role, index) => assign(buttons, index, `role:${role}`, count));
    return { buttons, layer, deadZone: DEFAULT_DEAD_ZONE };
  }

  assign(buttons, STANDARD_BUTTON.faceDown, "role:confirm", count);
  assign(buttons, STANDARD_BUTTON.faceRight, "role:cancel", count);

  if (capabilities.triggers) {
    // Shoulders page, triggers hold. That split is the one a player arrives
    // with: a shoulder button is where lists move and a trigger is where a
    // mode lives, on every pad-first game they have played.
    assign(buttons, STANDARD_BUTTON.faceLeft, PRIMARY_COMMANDS[0]!, count);
    assign(buttons, STANDARD_BUTTON.faceUp, PRIMARY_COMMANDS[1]!, count);
    assign(buttons, STANDARD_BUTTON.leftShoulder, "role:page-prev", count);
    assign(buttons, STANDARD_BUTTON.rightShoulder, "role:page-next", count);
    assign(buttons, STANDARD_BUTTON.leftTrigger, "role:layer", count);
    assign(buttons, STANDARD_BUTTON.rightTrigger, "role:commands", count);
  } else if (capabilities.shoulders) {
    assign(buttons, STANDARD_BUTTON.faceLeft, "role:commands", count);
    assign(buttons, STANDARD_BUTTON.faceUp, "role:layer", count);
    assign(buttons, STANDARD_BUTTON.leftShoulder, "role:page-prev", count);
    assign(buttons, STANDARD_BUTTON.rightShoulder, "role:page-next", count);
  } else {
    assign(buttons, STANDARD_BUTTON.faceLeft, "role:commands", count);
    assign(buttons, STANDARD_BUTTON.faceUp, "role:layer", count);
  }

  assign(buttons, STANDARD_BUTTON.view, "role:legend", count);
  // Start opens the game's own menu, which is what Escape does when no prompt
  // is waiting. Bound literally because the game menu is a root control rather
  // than a row of the command table.
  assign(buttons, STANDARD_BUTTON.menu, "key:Escape", count);
  if (capabilities.stickButtons) {
    assign(buttons, STANDARD_BUTTON.leftStick, "role:wait", count);
    assign(buttons, STANDARD_BUTTON.rightStick, "cmd:l", count);
  }

  // The second layer only exists where a modifier could be bound, and it is
  // filled from the same face and shoulder buttons the player's thumb is
  // already on rather than from buttons they would have to reach for.
  if (Object.values(buttons).includes("role:layer")) {
    const second: readonly [number, BindingTarget][] = [
      [STANDARD_BUTTON.faceDown, "cmd:m"],
      [STANDARD_BUTTON.faceRight, "cmd:q"],
      [STANDARD_BUTTON.faceLeft, "cmd:r"],
      [STANDARD_BUTTON.faceUp, "cmd:v"],
      [STANDARD_BUTTON.leftShoulder, "cmd:<"],
      [STANDARD_BUTTON.rightShoulder, "cmd:>"],
      [STANDARD_BUTTON.view, "cmd:C"],
      [STANDARD_BUTTON.menu, "cmd:R"],
      [STANDARD_BUTTON.leftStick, "cmd:i"],
      [STANDARD_BUTTON.rightStick, "cmd:e"],
    ];
    for (const [index, value] of second) {
      if (buttons[index] === "role:layer") continue;
      assign(layer, index, value, count);
    }
  }

  // A pad with no room for an essential role would be unplayable rather than
  // merely awkward, so they are placed last and are allowed to overwrite.
  for (const role of ESSENTIAL_ROLES) {
    if (Object.values(buttons).includes(`role:${role}`)) continue;
    for (let index = 0; index < count; index++) {
      if (buttons[index] === undefined) {
        buttons[index] = `role:${role}`;
        break;
      }
    }
  }
  return { buttons, layer, deadZone: DEFAULT_DEAD_ZONE };
}

const STORAGE_KEY = "neo-angband:gamepad-bindings";

interface StoredBindings {
  readonly buttons?: Record<string, string>;
  readonly layer?: Record<string, string>;
  readonly deadZone?: { inner?: number; outer?: number };
}

function isTarget(value: unknown): value is BindingTarget {
  return typeof value === "string"
    && (value.startsWith("cmd:") || value.startsWith("key:")
      || (value.startsWith("role:") && (GAMEPAD_ROLES as readonly string[]).includes(value.slice(5))));
}

function readMap(source: Record<string, string> | undefined): Record<number, BindingTarget> {
  const out: Record<number, BindingTarget> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && isTarget(value)) out[index] = value;
  }
  return out;
}

function clampZone(zone: StoredBindings["deadZone"]): DeadZone {
  const inner = typeof zone?.inner === "number" ? Math.min(0.9, Math.max(0, zone.inner)) : DEFAULT_DEAD_ZONE.inner;
  const outer = typeof zone?.outer === "number" ? Math.min(1, Math.max(inner + 0.05, zone.outer)) : DEFAULT_DEAD_ZONE.outer;
  return { inner, outer };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // Storage denied. The defaults still play.
  }
}

/**
 * Saved bindings for one pad signature, merged over that pad's defaults.
 *
 * Merged rather than replaced: a player who remapped two buttons on a pad, and
 * later plays on a build that gained a role, keeps their two changes and picks
 * up a working default for the rest. Storing the whole layout would have frozen
 * their pad at the layout that existed the day they touched the screen.
 */
export function loadBindings(signature: string, capabilities: PadCapabilities): GamepadBindings {
  const base = defaultBindings(capabilities);
  const store = storage();
  if (!store) return base;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, StoredBindings> | null;
    const saved = parsed?.[signature];
    if (!saved) return base;
    return {
      buttons: { ...base.buttons, ...readMap(saved.buttons) },
      layer: { ...base.layer, ...readMap(saved.layer) },
      deadZone: clampZone(saved.deadZone),
    };
  } catch {
    return base; // Unreadable storage is a default layout, never a dead pad.
  }
}

/** Persist one pad's bindings without disturbing another pad's. */
export function saveBindings(signature: string, bindings: GamepadBindings): void {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(STORAGE_KEY);
    const parsed = (raw ? JSON.parse(raw) : null) as Record<string, StoredBindings> | null;
    const all: Record<string, StoredBindings> = parsed && typeof parsed === "object" ? parsed : {};
    all[signature] = {
      buttons: Object.fromEntries(Object.entries(bindings.buttons)),
      layer: Object.fromEntries(Object.entries(bindings.layer)),
      deadZone: bindings.deadZone,
    };
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* A pad that cannot save its layout still plays with the one in memory. */
  }
}

/** Rebind one button, clearing whatever else held a single-instance role. */
export function rebind(
  bindings: GamepadBindings,
  index: number,
  target: BindingTarget | undefined,
  layer = false,
): GamepadBindings {
  const map = { ...(layer ? bindings.layer : bindings.buttons) };
  if (target === undefined) delete map[index];
  else {
    // Two buttons that both claim to be Cancel is a pad with no Cancel a player
    // can predict, so a role moves rather than duplicating.
    if (target.startsWith("role:")) {
      for (const key of Object.keys(map)) {
        if (map[Number(key)] === target) delete map[Number(key)];
      }
    }
    map[index] = target;
  }
  return layer ? { ...bindings, layer: map } : { ...bindings, buttons: map };
}

/** The role a button plays, or undefined when it is a command or a key. */
export function roleOf(target: BindingTarget | undefined): GamepadRole | undefined {
  if (!target?.startsWith("role:")) return undefined;
  return target.slice(5) as GamepadRole;
}
