/**
 * The mod API, version 2: what a mod's code is handed, as bounded domains.
 *
 * The same types serve a mod that runs in the game's own process and one that
 * runs in a Worker. Every method returns a promise of an `Api2Result`, and
 * every value that crosses the boundary is plain data that survives structured
 * clone: no engine classes, no live game state, no mutable registries and no
 * way to call into the engine by name. The only functions a mod passes in are
 * its own listeners and hooks, which the host calls with plain data.
 *
 * `manage` and `truth` exist only for first-party mods the game's build names,
 * and are absent for every other mod. Absent is the whole check: a mod tests
 * `if (mod.truth)` and there is nothing to ask for.
 */

import type { JsonRecord, JsonValue } from "../compose.js";
import type { NetMethod, NetProblemCode } from "../net-request.js";
import type { Api2EventMap, Api2EventName } from "./events.js";
import type { Api2HookName, Api2Hooks } from "./hooks.js";
import type { Api2Policies } from "./policies.js";
import type { Api2Presentation, Api2Presenters } from "./presentation.js";
import type {
  KnownGrid,
  KnownItem,
  KnownLevel,
  KnownMonster,
  KnownPlayer,
  KnownToken,
  KnownTrap,
  KnownWorldData,
} from "./known.js";
import type { Api2Call, Api2Capability } from "./result.js";

/** Whether a mod is one of the game's own (first-party) or anyone else's. */
export type Api2Tier = "first-party" | "public";

/** One enabled mod, as any mod may see it. */
export interface Api2ModSummary {
  readonly id: string;
  readonly version: string;
  /** The flags that mod's manifest makes public. */
  readonly flags?: Readonly<Record<string, boolean>>;
}

/** Facts about this mod and this session, fixed when the mod starts. */
export interface Api2Meta {
  /** This mod's id. */
  readonly id: string;
  /** The mod API version the host implements, such as "2.0.0". */
  readonly api: string;
  /** The game's version, for diagnostics only. Gate on `api`, never on this. */
  readonly engine: string;
  readonly tier: Api2Tier;
  /** This mod's rule flags as the player set them. */
  readonly flags: Readonly<Record<string, boolean>>;
  /** True when the character was created this session rather than loaded. */
  readonly newCharacter: boolean;
  /** Whether the player granted a permission. No call is needed to ask. */
  granted(capability: Api2Capability): boolean;
  /** Write a diagnostic line; the host decides where it goes. */
  log(message: string): void;
  /** This mod's numeric settings, by id. */
  settings(): Api2Call<Readonly<Record<string, number>>>;
  /** Move one of this mod's settings as the Mods screen would; answers the value kept. */
  setSetting(id: string, value: number): Api2Call<number>;
  /** The enabled mods. */
  mods(): Api2Call<readonly Api2ModSummary[]>;
}

/** The phase of play at an input wait. */
export type Api2Phase = "title" | "birth" | "play" | "store" | "more" | "modal" | "dead";

/** The question the game is asking at an input wait. */
export type Api2Prompt =
  | { readonly kind: "ack"; readonly promptId: number; readonly label: string; readonly tag: "more" }
  | { readonly kind: "confirm"; readonly promptId: number; readonly label: string; readonly price?: number }
  | {
      readonly kind: "quantity";
      readonly promptId: number;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly defaultValue: number;
      readonly unitPrice?: number;
      readonly totalPrice?: number;
      readonly totals?: readonly number[];
      readonly gold?: number;
    }
  | {
      readonly kind: "text";
      readonly promptId: number;
      readonly label: string;
      readonly maxLength: number;
      readonly defaultValue: string;
      readonly tag?: "rest";
    }
  | { readonly kind: "direction"; readonly promptId: number; readonly label: string; readonly targetAllowed: boolean }
  | {
      readonly kind: "item";
      readonly promptId: number;
      readonly label: string;
      readonly choices: readonly { readonly handle: number; readonly label: string; readonly letter: string }[];
      readonly tabs: { readonly floor: boolean; readonly quiver: boolean; readonly equipment: boolean };
    }
  | {
      readonly kind: "spell";
      readonly promptId: number;
      readonly label: string;
      readonly choices: readonly {
        readonly index: number;
        readonly name: string;
        readonly level: number;
        readonly mana: number;
        readonly fail: number;
        readonly castable: boolean;
      }[];
    }
  | {
      readonly kind: "target";
      readonly promptId: number;
      readonly label: string;
      readonly mode: "interesting" | "free";
      readonly cursor: KnownGrid;
      readonly candidates: readonly KnownGrid[];
      readonly path: readonly KnownGrid[];
    };

/** Who holds the keyboard. */
export type Api2Driver =
  | { readonly kind: "player" }
  | { readonly kind: "controller"; readonly owner: string; readonly label?: string; readonly reason?: string };

/** The input wait: its phase, any pending "-more-", the open prompt and the keyboard's owner. */
export interface Api2InputState {
  readonly token: KnownToken;
  readonly driver: Api2Driver;
  readonly phase: Api2Phase;
  readonly messagePending: boolean;
  readonly prompt: Api2Prompt | null;
}

/** The known world, read at the current input wait. */
export interface Api2View {
  /** Everything the mod may read, in one value. Parts without permission are null. */
  world(): Api2Call<KnownWorldData>;
  /** The player. Needs `state:player.read`. */
  player(): Api2Call<KnownPlayer>;
  /** The monsters the player perceives. Needs `state:monsters.read`. */
  monsters(): Api2Call<readonly KnownMonster[]>;
  /** The level as the player remembers it. Needs `state:map.read`. */
  level(): Api2Call<KnownLevel>;
  /** The input wait. Needs `state:interaction.read`. */
  input(): Api2Call<Api2InputState>;
  /** Whether `token` still names the current input wait. */
  isCurrent(token: KnownToken): Api2Call<boolean>;
}

/** A game command: the action code and its direction or arguments. */
export interface Api2Command {
  readonly code: string;
  readonly dir?: number;
  readonly args?: Readonly<Record<string, JsonValue>>;
}

/** Something the player could do at an input wait. */
export type Api2Intent =
  | { readonly kind: "command"; readonly command: Api2Command }
  | {
      readonly kind: "travel";
      readonly x: number;
      readonly y: number;
      readonly modifiers?: { readonly shift?: boolean; readonly ctrl?: boolean };
    }
  /** Target a monster by its KnownMonster id (the field keeps its API 1 name). */
  | { readonly kind: "target"; readonly midx: number }
  | { readonly kind: "target"; readonly x: number; readonly y: number }
  | { readonly kind: "stop-resting" }
  | { readonly kind: "ignore" | "unignore"; readonly handle: number }
  | {
      readonly kind: "item-rule";
      readonly rule: "kind-aware" | "kind-unaware" | "ego" | "quality" | "note-aware" | "note-unaware";
      readonly index: number;
      readonly itype?: number;
      readonly value: boolean | number | string;
    };

/** An answer to the open prompt. */
export type Api2PromptAnswer =
  | boolean
  | number
  | string
  | { readonly action: "move"; readonly x: number; readonly y: number }
  | { readonly action: "next" | "previous" | "toggle" | "select" | "cancel" | "acknowledge" };

/** What a controller may say about what it is doing. */
export interface Api2ControllerStatus {
  readonly label?: string;
  readonly reason?: string;
}

/** The controller this mod installed, while it holds the keyboard. */
export interface Api2Controller {
  /** Whether this mod holds the keyboard now. */
  owns(): Api2Call<boolean>;
  setStatus(status: Api2ControllerStatus): Api2Call<null>;
  /** Mark the save as no longer replayable from its seed. Permanent for the save. */
  markNondeterministic(): Api2Call<null>;
  /** Give the keyboard back to the player. */
  release(reason?: string): Api2Call<null>;
}

/** Acting in the game: semantic commands, prompt answers and controller ownership. */
export interface Api2Act {
  /**
   * Do something at the input wait `token` names. Needs `input:intent`. A
   * stale token, a command the game refuses, or another mod holding the
   * keyboard answers `refused` with the game's reason.
   */
  submit(token: KnownToken, intent: Api2Intent): Api2Call<null>;
  /** Answer the open prompt. Needs `input:prompt.reply`. */
  answer(promptId: number, answer: Api2PromptAnswer): Api2Call<null>;
  readonly controller: Api2Controller;
}

/** A subscription's handle, for `off`. */
export interface Api2Subscription {
  readonly id: string;
}

/** What happened in the game, as the player saw it. Each event needs `event:<name>`. */
export interface Api2Events {
  on<K extends Api2EventName>(name: K, listener: (payload: Api2EventMap[K]) => void): Api2Call<Api2Subscription>;
  off(subscription: Api2Subscription): Api2Call<null>;
}

/** The hooks this host runs. A mod declares its hooks in its definition, not here. */
export interface Api2HooksDomain {
  /** Every hook this host knows, so a mod can tell what a game version supports. */
  readonly available: readonly Api2HookName[];
  /** The hooks this mod declared and the host is running. */
  readonly active: readonly Api2HookName[];
}

/** A stable reference to one record of the running game's content. */
export interface Api2ContentRef {
  /** The pack file stem, such as `monster` or `object`. */
  readonly file: string;
  /** The record's key within that file, as the SDK's `recordKey` derives it. */
  readonly key: string;
}

/** The game's content and this mod's own files, as data. */
export interface Api2Content {
  /** This mod's own record files, parsed, keyed without `.json`. */
  own(): Api2Call<Readonly<Record<string, JsonValue>>>;
  /** A URL for one of this mod's own files, by path inside its folder. */
  asset(path: string): Api2Call<string>;
  /** Every record of one pack file, as the running game composed it. */
  records(file: string): Api2Call<readonly JsonRecord[]>;
  /** One record by its stable reference. */
  lookup(ref: Api2ContentRef): Api2Call<JsonRecord>;
}

/** The host-drawn panel vocabulary: text, buttons, rows and columns. */
export type Api2PanelNode =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "button"; readonly label: string; readonly action: string }
  | { readonly type: "row"; readonly children: readonly Api2PanelNode[] }
  | { readonly type: "column"; readonly children: readonly Api2PanelNode[] };

/** A panel the host draws for the mod. `id` and every button `action` are lower-case words joined by hyphens. */
export interface Api2Panel {
  readonly id: string;
  readonly title?: string;
  readonly root: Api2PanelNode;
}

/** A change to a mounted panel: a new title (null removes it), a new tree, or visibility. */
export interface Api2PanelPatch {
  readonly title?: string | null;
  readonly root?: Api2PanelNode;
  readonly visible?: boolean;
}

/** One key binding this mod owns. */
export interface Api2KeyBinding {
  readonly trigger: string;
  readonly action: string;
}

/** Key bindings this mod owns in the player's keyset. Needs `keymap:write`. */
export interface Api2Keys {
  isBindableTriggerKey(trigger: string): Api2Call<boolean>;
  /** Bind an unused trigger. Refused when the trigger is already bound. */
  bind(trigger: string, action: string): Api2Call<null>;
  list(): Api2Call<readonly Api2KeyBinding[]>;
  remove(trigger: string): Api2Call<null>;
}

/** Host-owned interface: panels the host draws from data, and input bindings. */
export interface Api2Ui {
  readonly commands: {
    register(id: string, verb: string, run: () => void | Promise<void>): Api2Call<null>;
  };
  readonly gameMenu: {
    register(action: string, label: string, run: () => void | Promise<void>): Api2Call<null>;
  };
  /**
   * Show a panel. Needs `ui:panel.mount`. The host draws it; `onAction` hears
   * the `action` of each button the player uses.
   */
  mount(panel: Api2Panel, onAction?: (action: string) => void): Api2Call<{ readonly panelId: string }>;
  /** Change a mounted panel. Needs `ui:panel.mount`. */
  patch(panelId: string, patch: Api2PanelPatch): Api2Call<{ readonly panelId: string }>;
  readonly keys: Api2Keys;
}

/** One stored value. */
export interface Api2Slot {
  get(): Api2Call<JsonValue | null>;
  /** Replace the value; null removes it. */
  set(value: JsonValue | null): Api2Call<null>;
}

/**
 * Storage this mod owns. `prefs` is what the player likes, kept apart from any
 * character; `character` lives in the current character's save and is
 * unavailable until a character exists.
 */
export interface Api2Store {
  readonly prefs: Api2Slot;
  readonly character: Api2Slot;
}

/** An opaque name for a credential the host keeps. The mod never holds the value. */
export interface Api2CredentialRef {
  readonly credential: string;
}

/** An HTTP request. A header may name a credential, which the host fills in. */
export interface Api2NetRequest {
  readonly url: string;
  readonly method?: NetMethod;
  readonly headers?: Readonly<Record<string, string | Api2CredentialRef>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

/** A response, whatever its status. A failure to get one is a `refused` answer carrying a net problem code. */
export interface Api2NetResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Where the host keeps a credential. */
export type Api2CredentialStorage = "os" | "environment" | "page";

/** Credentials the host keeps for this mod, by name. */
export interface Api2Credentials {
  /** Whether a credential is set, and where. Never its value. */
  status(name: string): Api2Call<{ readonly present: boolean; readonly storage?: Api2CredentialStorage }>;
  /** Keep a value under `name`, to be sent only to `hosts`. */
  set(name: string, value: string, hosts: readonly string[]): Api2Call<{ readonly storage: Api2CredentialStorage }>;
  /** Take the value from the first set environment variable (desktop app only; the player is asked). */
  fromEnvironment(name: string, variables: readonly string[], hosts: readonly string[]): Api2Call<{ readonly storage: Api2CredentialStorage }>;
  remove(name: string): Api2Call<null>;
}

/** Requests the host sends on the mod's behalf, to the hosts its permissions name. */
export interface Api2Net {
  request(request: Api2NetRequest): Api2Call<Api2NetResponse>;
  /** A reference to a credential, for a request header. */
  credential(name: string): Api2CredentialRef;
  readonly credentials: Api2Credentials;
}

/** Codes a refused net request may carry. */
export type Api2NetProblem = NetProblemCode;

/** A player profile. */
export interface Api2Profile {
  readonly id: string | null;
  readonly name: string;
  readonly active: boolean;
}

/** Saving and leaving the game, as the game menu does. */
export interface Api2SessionControl {
  save(): Api2Call<null>;
  exitToTitle(): Api2Call<null>;
  quit(): Api2Call<null>;
}

/** Management for first-party presentation mods. Absent for every other mod. */
export interface Api2Manage {
  readonly profiles: {
    list(): Api2Call<readonly Api2Profile[]>;
    create(name: string, copyFrom?: string | null): Api2Call<Api2Profile>;
    setEnabledMods(id: string, mods: readonly string[]): Api2Call<null>;
    switchTo(id: string | null): Api2Call<null>;
  };
  readonly session: Api2SessionControl;
}

/** A monster as it really is, for a first-party autoplayer. */
export interface Api2TrueMonster {
  readonly id: number;
  readonly race: string;
  readonly raceIndex: number;
  readonly raceId?: string;
  readonly grid: KnownGrid;
  readonly visible: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly speed: number;
  readonly asleep: boolean;
  readonly afraid: boolean;
  readonly confused: boolean;
  readonly stunned: boolean;
  readonly poisoned: boolean;
  readonly level: number;
  readonly raceFlags: readonly string[];
  readonly spellFlags: readonly string[];
  readonly knownSpellFlags: readonly string[];
  readonly unique: boolean;
  readonly questGuardian: boolean;
  readonly finalGuardian: boolean;
  readonly glyph?: string;
}

/** One grid as it really is. */
/**
 * A real object on the level. It carries the turns left until it recharges
 * (`timeout`) where a known item carries only what its name says.
 */
export type Api2TrueItem = Omit<KnownItem, "charging" | "unknownRunes"> & { readonly timeout: number };

export interface Api2TrueCell {
  readonly x: number;
  readonly y: number;
  readonly feat: number;
  readonly featCode?: string;
  readonly traps: readonly KnownTrap[];
  readonly objects: readonly Api2TrueItem[];
  /** The monster's id, or 0. */
  readonly monster: number;
}

/** The real level, for a first-party autoplayer. */
export interface Api2TrueLevel {
  readonly token: KnownToken;
  readonly levelId: number;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Api2TrueCell[];
}

/**
 * Hidden game state, for the first-party autoplayer only. Absent for every
 * other mod, and never covered by a wildcard permission.
 */
export interface Api2Truth {
  monsters(): Api2Call<readonly Api2TrueMonster[]>;
  level(): Api2Call<Api2TrueLevel>;
}

/** Everything API 2 hands a running mod. */
export interface ModApi2 {
  readonly meta: Api2Meta;
  readonly view: Api2View;
  readonly act: Api2Act;
  readonly events: Api2Events;
  readonly hooks: Api2HooksDomain;
  readonly content: Api2Content;
  readonly ui: Api2Ui;
  readonly store: Api2Store;
  /** Present when the mod's manifest names at least one network host. */
  readonly net?: Api2Net;
  /** First-party presentation mods only. */
  readonly manage?: Api2Manage;
  /** The first-party autoplayer only. */
  readonly truth?: Api2Truth;
  readonly presentation?: Api2Presentation;
}

/** What `hooks` is told when the host asks a mod for its hooks. */
export interface Api2HookContext {
  readonly id: string;
  readonly flags: Readonly<Record<string, boolean>>;
}

/** How a mod brings its stored preferences forward when their shape changes. */
export interface Api2PrefsMigration {
  /** The version of the shape `store.prefs` holds now. Starts at 1; data stored before any version is 0. */
  readonly version: number;
  /** Bring a value stored under `fromVersion` up to `version`. */
  migrate(value: JsonValue, fromVersion: number): JsonValue;
}

/** An API 2 mod's code: its default export. */
export interface Api2ModDefinition {
  /** The mod API range this code was written for, such as ">=2.0.0 <3.0.0". */
  readonly api: string;
  readonly presentation?: Api2Presenters;
  readonly actions?: readonly Api2MenuAction[];
  /**
   * The hooks this mod contributes, given its flags. Asked once when content
   * composes. In a Worker only the notification hooks (optionsChanged,
   * abilityGained, monsterBecameVisible, artifactIdentified) may be declared
   * here; every hook that returns an answer is declared in `policies`.
   */
  hooks?(context: Api2HookContext): Api2Hooks | undefined;
  /**
   * Changes as policy tables the host applies itself, synchronously, given
   * the mod's flags: hook answers, and the registrations the kinds in
   * `API2_POLICY_KINDS` install. A hook function from `hooks` takes
   * precedence over the table for the same hook.
   */
  policies?(context: Api2HookContext): Api2Policies | undefined;
  /** Runs once the game is ready, with the API. */
  start?(mod: ModApi2): void | Promise<void>;
  /** Runs before the mod is taken down. */
  stop?(): void;
  /** Bring this mod's character data forward from an older `saveSchema`. */
  migrateBag?(data: JsonValue, fromSchema: number): JsonValue;
  /** Bring this mod's stored preferences forward. */
  readonly prefs?: Api2PrefsMigration;
}

export interface Api2MenuAction {
  readonly menu: "core:game-menu";
  readonly action: string;
  readonly label: string;
  run(mod: ModApi2): void | Promise<void>;
}

/** Declare an API 2 mod. Returns its argument; the type checks the shape. */
export function defineApi2Mod(definition: Api2ModDefinition): Api2ModDefinition {
  return definition;
}
