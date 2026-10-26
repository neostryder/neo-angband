/**
 * API 2 events: what happened, as the player saw it.
 *
 * Each event is named after the game event it comes from and needs the same
 * permission, `event:<name>`. Its payload holds only what the player could
 * know. Combat, movement and healing arrive only when they happened in the
 * player's view, and damage and healing amounts only when they happened to the
 * player, whose hit points are on screen. A monster is named by its id only
 * while the player perceives it; otherwise it is `"unseen"`, and movement or
 * healing by a monster the player cannot see does not arrive at all. Game events that would reveal more (level generation,
 * a thrown object) have no API 2
 * form.
 */

import type { KnownGrid, KnownToken } from "./known.js";
import type { Api2RunEndEvent } from "./character.js";

/** A message the game printed. */
export interface Api2MessageEvent {
  readonly text: string;
  /** The message type (MSG_* index), which picks its colour and sound. */
  readonly type: number;
}

/** The player arrived on a level. */
export interface Api2LevelEvent {
  readonly depth: number;
  readonly levelId: number;
  readonly cause: "new-game" | "load" | "change";
  readonly arena: boolean;
}

/**
 * Who acted, as the player saw it when it happened: the player, a monster the
 * player perceived (by its KnownMonster id), or something the player could not
 * see, which includes every monster while the player hallucinates. A monster
 * the event killed is reported as the player saw it before it died.
 */
export type Api2Actor = "player" | "unseen" | { readonly monster: number };

/** A blow, shot, spell or trap the player saw land or miss. */
export interface Api2CombatEvent {
  /** Null for a trap or an effect with no visible source. */
  readonly attacker: Api2Actor | null;
  readonly target: Api2Actor;
  readonly kind: "melee" | "ranged" | "spell" | "effect" | "trap";
  readonly hit: boolean;
  readonly died: boolean;
  readonly grid: KnownGrid;
  /** Hit points the player lost; present only when the target is the player. */
  readonly playerDamage?: number;
}

/** A movement the player saw. */
export interface Api2MotionEvent {
  readonly who: Api2Actor;
  /** The origin is absent when the player did not observe it. */
  readonly from?: KnownGrid;
  readonly to: KnownGrid;
  readonly kind: "walk" | "teleport";
}

/** Healing the player saw. */
export interface Api2HealEvent {
  readonly who: Api2Actor;
  readonly grid: KnownGrid;
  /** Hit points the player regained; present only when the player healed. */
  readonly playerAmount?: number;
}

/** A command the player gave, reported before it runs. A controller's own commands do not fire it. */
export interface Api2CommandEvent {
  readonly code: string;
  readonly dir?: number;
  readonly args?: { readonly handle?: number; readonly floor?: number; readonly spell?: number; readonly index?: number };
  readonly phase: "play" | "store";
  readonly token: KnownToken;
}

/** Who holds the keyboard now. */
export type Api2DriverEvent =
  | { readonly kind: "player" }
  | { readonly kind: "controller"; readonly owner: string; readonly label?: string; readonly reason?: string };

/**
 * Every API 2 event and its payload. An event whose payload is `null` is a
 * notice that something changed; read the view for the new value.
 */
export interface Api2EventMap {
  bolt: Api2BoltEvent;
  explosion: Api2ExplosionEvent;
  "run-end": Api2RunEndEvent;
  message: Api2MessageEvent;
  dungeonlevel: Api2LevelEvent;
  "combat-outcome": Api2CombatEvent;
  motion: Api2MotionEvent;
  heal: Api2HealEvent;
  "player-command": Api2CommandEvent;
  "driver-changed": Api2DriverEvent;
  hp: null;
  mana: null;
  gold: null;
  experience: null;
  playerlevel: null;
  status: null;
  inventory: null;
  equipment: null;
  monsterlist: null;
  itemlist: null;
  "enter-store": null;
  "leave-store": null;
  "enter-world": null;
  "leave-world": null;
}

/** The name of an API 2 event. */
export type Api2EventName = keyof Api2EventMap;

/** Every API 2 event name. */
export const API2_EVENT_NAMES: readonly Api2EventName[] = Object.freeze([
  "bolt",
  "explosion",
  "run-end",
  "message",
  "dungeonlevel",
  "combat-outcome",
  "motion",
  "heal",
  "player-command",
  "driver-changed",
  "hp",
  "mana",
  "gold",
  "experience",
  "playerlevel",
  "status",
  "inventory",
  "equipment",
  "monsterlist",
  "itemlist",
  "enter-store",
  "leave-store",
  "enter-world",
  "leave-world",
]);

/** The permission an event needs. */
export function api2EventCapability(name: Api2EventName): string {
  return `event:${name}`;
}

export interface Api2BoltEvent {
  readonly grid: KnownGrid;
  readonly element: string;
  readonly beam: boolean;
}

export interface Api2ExplosionEvent {
  readonly grids: readonly KnownGrid[];
  readonly element: string;
  readonly arc: boolean;
}
