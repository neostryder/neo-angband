/**
 * The game event bus, ported from reference/src/game-event.h and
 * game-event.c (Angband 4.2.6).
 *
 * This is the core-to-UI seam: the engine signals what happened, front
 * ends subscribe. Event names map 1:1 to the upstream enum (EVENT_MAP ->
 * "map", EVENT_GEN_LEVEL_START -> "gen-level-start", ...). The C union of
 * payloads becomes a typed payload map; the C `user` pointer disappears
 * because closures carry state.
 */

import type { Loc } from "./loc";

/** EVENT_MESSAGE / EVENT_INITSTATUS payloads. */
export interface MessageEventData {
  msg: string;
  /** Message type (MSG_* index); front ends map it to color/sound. */
  type: number;
}

/** EVENT_BIRTHPOINTS payload. */
export interface BirthPointsEventData {
  points: readonly number[];
  incPoints: readonly number[];
  remaining: number;
}

/** EVENT_EXPLOSION payload. */
export interface ExplosionEventData {
  projType: number;
  numGrids: number;
  distanceToGrid: readonly number[];
  drawing: boolean;
  playerSeesGrid: readonly boolean[];
  blastGrid: readonly Loc[];
  centre: Loc;
}

/** EVENT_BOLT payload. */
export interface BoltEventData {
  projType: number;
  drawing: boolean;
  seen: boolean;
  beam: boolean;
  oy: number;
  ox: number;
  y: number;
  x: number;
}

/** EVENT_MISSILE payload. The object type is refined once objects land. */
export interface MissileEventData {
  obj: unknown;
  seen: boolean;
  y: number;
  x: number;
}

/** EVENT_GEN_ROOM_CHOOSE_SIZE payload. */
export interface SizeEventData {
  h: number;
  w: number;
}

/** EVENT_GEN_TUNNEL_FINISHED payload. */
export interface TunnelEventData {
  /** Total tunneling steps made. */
  nstep: number;
  /** Total wall piercings for rooms. */
  npierce: number;
  /** Tiles excavated, excluding wall piercings. */
  ndug: number;
  /** City-block distance from start to goal. */
  dstart: number;
  /** City-block distance from tunnel end to goal; 0 means it arrived. */
  dend: number;
  /** True if terminated by the random early-termination criteria. */
  early: boolean;
}

/**
 * Every game event and its payload type. `undefined` payloads are
 * signal-only events.
 */
export interface GameEventMap {
  map: Loc | undefined;
  stats: undefined;
  hp: undefined;
  mana: undefined;
  ac: undefined;
  experience: undefined;
  playerlevel: undefined;
  playertitle: undefined;
  gold: undefined;
  monsterhealth: undefined;
  dungeonlevel: undefined;
  playerspeed: undefined;
  "race-class": undefined;
  studystatus: undefined;
  status: undefined;
  detectionstatus: undefined;
  feeling: undefined;
  light: undefined;
  state: undefined;

  playermoved: undefined;
  seefloor: undefined;
  explosion: ExplosionEventData;
  bolt: BoltEventData;
  missile: MissileEventData;

  inventory: undefined;
  equipment: undefined;
  itemlist: undefined;
  monsterlist: undefined;
  monstertarget: undefined;
  objecttarget: undefined;
  message: MessageEventData;
  sound: MessageEventData;
  bell: MessageEventData;
  "use-store": undefined;
  storechanged: undefined;

  "input-flush": undefined;
  "message-flush": undefined;
  "check-interrupt": undefined;
  refresh: undefined;
  "new-level-display": undefined;
  "command-repeat": undefined;
  animate: undefined;
  "cheat-death": undefined;

  initstatus: MessageEventData;
  birthpoints: BirthPointsEventData;

  "enter-init": undefined;
  "leave-init": undefined;
  "enter-birth": undefined;
  "leave-birth": undefined;
  "enter-game": undefined;
  "leave-game": undefined;
  "enter-world": undefined;
  "leave-world": undefined;
  "enter-store": undefined;
  "leave-store": undefined;
  "enter-death": undefined;
  "leave-death": undefined;

  "gen-level-start": string;
  "gen-level-end": boolean;
  "gen-room-start": string;
  "gen-room-choose-size": SizeEventData;
  "gen-room-choose-subtype": string;
  "gen-room-end": boolean;
  "gen-tunnel-finished": TunnelEventData;

  end: undefined;
}

export type GameEventType = keyof GameEventMap;

/** All event types, in upstream enum order. */
export const GAME_EVENT_TYPES: readonly GameEventType[] = [
  "map",
  "stats",
  "hp",
  "mana",
  "ac",
  "experience",
  "playerlevel",
  "playertitle",
  "gold",
  "monsterhealth",
  "dungeonlevel",
  "playerspeed",
  "race-class",
  "studystatus",
  "status",
  "detectionstatus",
  "feeling",
  "light",
  "state",
  "playermoved",
  "seefloor",
  "explosion",
  "bolt",
  "missile",
  "inventory",
  "equipment",
  "itemlist",
  "monsterlist",
  "monstertarget",
  "objecttarget",
  "message",
  "sound",
  "bell",
  "use-store",
  "storechanged",
  "input-flush",
  "message-flush",
  "check-interrupt",
  "refresh",
  "new-level-display",
  "command-repeat",
  "animate",
  "cheat-death",
  "initstatus",
  "birthpoints",
  "enter-init",
  "leave-init",
  "enter-birth",
  "leave-birth",
  "enter-game",
  "leave-game",
  "enter-world",
  "leave-world",
  "enter-store",
  "leave-store",
  "enter-death",
  "leave-death",
  "gen-level-start",
  "gen-level-end",
  "gen-room-start",
  "gen-room-choose-size",
  "gen-room-choose-subtype",
  "gen-room-end",
  "gen-tunnel-finished",
  "end",
];

export type GameEventHandler<K extends GameEventType> = (
  type: K,
  data: GameEventMap[K],
) => void;

/**
 * Typed pub/sub bus mirroring game-event.c's handler chains. Handlers for
 * one type are called in registration order, exactly like the upstream
 * linked list traversal.
 */
export class GameEvents {
  private handlers = new Map<
    GameEventType,
    Array<GameEventHandler<GameEventType>>
  >();

  /** event_add_handler. */
  on<K extends GameEventType>(type: K, fn: GameEventHandler<K>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn as GameEventHandler<GameEventType>);
    this.handlers.set(type, list);
  }

  /** event_remove_handler. */
  off<K extends GameEventType>(type: K, fn: GameEventHandler<K>): void {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn as GameEventHandler<GameEventType>);
    if (i >= 0) list.splice(i, 1);
  }

  /** event_add_handler_set. */
  onSet(
    types: readonly GameEventType[],
    fn: GameEventHandler<GameEventType>,
  ): void {
    for (const t of types) this.on(t, fn);
  }

  /** event_remove_handler_set. */
  offSet(
    types: readonly GameEventType[],
    fn: GameEventHandler<GameEventType>,
  ): void {
    for (const t of types) this.off(t, fn);
  }

  /** event_remove_handler_type. */
  removeHandlersOf(type: GameEventType): void {
    this.handlers.delete(type);
  }

  /** event_remove_all_handlers. */
  removeAllHandlers(): void {
    this.handlers.clear();
  }

  /** event_signal and the typed event_signal_* helpers, unified. */
  emit<K extends GameEventType>(type: K, data: GameEventMap[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    // Copy so handlers that unsubscribe during dispatch do not skip peers.
    for (const fn of [...list]) fn(type, data);
  }

  /** event_signal: signal-only convenience for payload-less events. */
  signal<K extends GameEventType & SignalOnly>(type: K): void {
    this.emit(type, undefined as GameEventMap[K]);
  }
}

/** Event types whose payload is undefined (signal-only). */
type SignalOnly = {
  [K in GameEventType]: undefined extends GameEventMap[K] ? K : never;
}[GameEventType];
