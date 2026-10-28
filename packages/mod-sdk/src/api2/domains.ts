/**
 * The mod API, version 2: what a mod's code is handed, as bounded domains.
 *
 * The same types serve a mod that runs in the game's own process and one that
 * runs in a Worker. Every method returns a promise of an `Api2Result`, and
 * every value that crosses the boundary is plain data that survives structured
 * clone. The consented `engine` domain is the in-process exception: its
 * namespace, state, and registries stay live and never reach a Worker. The
 * management authoring library and wizard facade also stay in process.
 *
 * `manage` and `truth` exist only for first-party mods the game's build names,
 * and are absent for every other mod. Absent is the whole check: a mod tests
 * `if (mod.truth)` and there is nothing to ask for.
 */

import type { JsonRecord, JsonValue } from "../compose.js";
import type { NetMethod, NetProblemCode } from "../net-request.js";
import type { Api2EventMap, Api2EventName } from "./events.js";
import type { Api2HookName, Api2Hooks } from "./hooks.js";
import type { Api2PlayerTileProvider, Api2Policies, Api2TileFiller } from "./policies.js";
import type { Api2BirthPresenter, Api2DomPanel, Api2PanelSpec, Api2Presentation, Api2Presenters, Api2Title, Api2TitleAction } from "./presentation.js";
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
import type { Api2Inspect, LoadoutChange, LoadoutSimulation } from "./inspection.js";
import type { Api2Character } from "./character.js";
import type { Api2Knowledge } from "./knowledge.js";
import type { Api2Options } from "./hooks.js";
import type { Api2KeyValueStore, Api2ManagedKeys, Api2ManagedLook, Api2ManagedMods, Api2ManagedOptions, Api2ProfileAction, Api2Saves, Api2Wizard } from "./management.js";

/** In-process hosts supply the engine types without making the SDK depend on Core. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Core augments this interface with its live types.
export interface Api2EngineBindings {}

type EngineBinding<K extends string> = K extends keyof Api2EngineBindings ? Api2EngineBindings[K] : unknown;

/** Live engine access requires consent outside verified first-party code. Import Core's types to bind the live members. */
export interface Api2Engine {
  /** This domain's own version, independent of meta.engine and meta.api. */
  readonly api: string;
  readonly core: EngineBinding<"core">;
  readonly state: EngineBinding<"state"> | undefined;
  readonly registries: EngineBinding<"registries"> | undefined;
  /**
   * The registry host an API 1 `register(host, ctx)` was given: effects, projections,
   * commands and their verbs, rooms, profiles, blows, stores, menus and the rest, each
   * gated by the matching `registry:` capability in the manifest. Present only while
   * `start` runs, because the game builds it for the mod then; a mod reads it there and
   * installs what it needs. Not offered to `hooks`, `policies`, `engineHooks` or `engineTiles`.
   */
  readonly registry: EngineBinding<"registry"> | undefined;
}

/** Whether a mod is one of the game's own (first-party) or anyone else's. */
export type Api2Tier = "first-party" | "public";

/** One enabled mod, as any mod may see it. */
/** What a registered command hears when it runs. */
export interface Api2CommandArgs {
  /** The direction the player chose (1 to 9), for a command registered with `direction: true`. */
  readonly dir?: number;
}

/** How a command asks for input before it runs. */
export interface Api2CommandOptions {
  /** Ask the player for a direction first. */
  readonly direction?: boolean;
}

export interface Api2ModSummary {
  readonly id: string;
  readonly name: string;
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
  readonly controllerArmed: boolean;
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
  readonly resting: {
    readonly active: boolean;
    readonly mode: "turns" | "complete" | "all-points" | "some-points" | null;
    readonly turnsRequested: number | null;
    readonly turnsRemaining: number | null;
    readonly turnsRested: number | null;
  } | null;
  readonly running: boolean;
  readonly repeating: boolean;
  readonly repeatsLeft: number;
  readonly unignoring: boolean;
  readonly messages: readonly { readonly text: string; readonly count: number; readonly color?: string }[] | null;
  readonly storeStatus: {
    readonly token: KnownToken;
    readonly feat: number;
    readonly ready: boolean;
    readonly noSelling: boolean;
    readonly inventory: readonly { readonly handle: number; readonly location?: "pack" | "quiver" | "equipment";
      readonly eligible: boolean; readonly price: number | null }[];
  } | null;
  readonly activeBlast: {
    readonly token: KnownToken;
    readonly radius: number;
    readonly arc?: number;
    readonly element: string;
    readonly wallsStop: boolean;
  } | null;
}

/** The known world, read at the current input wait. */
export interface Api2View {
  character(): Api2Call<Api2Character>;
  knowledge(category?: string, id?: string): Api2Call<Api2Knowledge>;
  messages(since?: number): Api2Call<Api2MessageLog>;
  readonly inspect: Api2Inspect;
  catalogue(): Api2Call<{
    readonly token: KnownToken;
    readonly commands: readonly { readonly code: string; readonly verb: string | null; readonly args: string; readonly phase: "play" | "store" }[];
    readonly intents: readonly { readonly kind: string; readonly args: string }[];
  }>;
  options(): Api2Call<Api2Options>;
  /** Everything the mod may read, in one value. Parts without permission are null. */
  world(): Api2Call<KnownWorldData>;
  /** The player. Needs `state:player.read`. */
  player(): Api2Call<KnownPlayer>;
  /** The monsters the player perceives. Needs `state:monsters.read`. */
  monsters(): Api2Call<readonly KnownMonster[]>;
  /** The level as the player remembers it. Needs `state:map.read`. */
  level(): Api2Call<KnownLevel>;
  look(grid: KnownGrid): Api2Call<string>;
  simulateLoadout(change: LoadoutChange): Api2Call<LoadoutSimulation>;
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

export interface Api2MessageLog {
  readonly cursor: number;
  readonly entries: readonly { readonly sequence: number; readonly text: string; readonly count: number; readonly color?: string }[];
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
  boundRecords(file: string): Api2Call<readonly Api2BoundRecord[]>;
  activations(): Api2Call<readonly Api2Activation[]>;
  activation(ref: Api2ActivationRef): Api2Call<Api2Activation | null>;
  colors(): Api2Call<readonly { readonly index: number; readonly id: string; readonly css: string }[]>;
  /** This mod's own record files, parsed, keyed without `.json`. */
  own(): Api2Call<Readonly<Record<string, JsonValue>>>;
  /** A URL for one of this mod's own files, by path inside its folder. */
  asset(path: string): Api2Call<string>;
  /** Every record of one pack file, as the running game composed it. */
  records(file: string): Api2Call<readonly JsonRecord[]>;
  /** One record by its stable reference. */
  lookup(ref: Api2ContentRef): Api2Call<JsonRecord>;
}

export interface Api2BoundRecord {
  readonly key: string;
  readonly index: number;
  readonly name: string;
  readonly owner: string;
  readonly base?: string;
  readonly tval?: number;
  readonly from?: { readonly owner: string; readonly modifiedBy?: readonly string[]; readonly was?: Readonly<Record<string, JsonValue>> };
  readonly ext?: Readonly<Record<string, JsonValue>>;
}

export interface Api2Activation {
  readonly index: number;
  readonly name: string;
  readonly aim: boolean;
  readonly level: number;
  readonly power: number;
  readonly message: string;
  readonly desc: string;
  readonly effect: JsonValue;
}

export type Api2ActivationRef = { readonly tval: number; readonly sval: number } | { readonly ego: string } | { readonly artifact: string };

export interface Api2KeyEvent {
  readonly key: string;
  readonly code: string;
  readonly modifiers: readonly ("shift" | "ctrl" | "alt" | "meta")[];
  readonly isRepeat: boolean;
}

/** The host-drawn panel vocabulary: text, buttons, rows and columns. */
export type Api2PanelNode =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "button"; readonly label: string; readonly action: string; readonly disabled?: boolean }
  | { readonly type: "input"; readonly label: string; readonly action: string; readonly value?: string; readonly placeholder?: string; readonly disabled?: boolean }
  | { readonly type: "checkbox"; readonly label: string; readonly action: string; readonly checked: boolean; readonly disabled?: boolean }
  | { readonly type: "download"; readonly label: string; readonly name: string; readonly text: string; readonly disabled?: boolean }
  | { readonly type: "row"; readonly children: readonly Api2PanelNode[] }
  | { readonly type: "column"; readonly children: readonly Api2PanelNode[] };

/** A panel the host draws for the mod. `id` and every button `action` are lower-case words joined by hyphens. */
export interface Api2Panel {
  readonly id: string;
  readonly title?: string;
  readonly modal?: boolean;
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
  unmount(panelId: string): Api2Call<null>;
  onKey(listener: (event: Api2KeyEvent) => void): Api2Call<Api2Subscription>;
  offKey(subscription: Api2Subscription): Api2Call<null>;
  readonly mountPage?: (kind: string, mount: (root: ShadowRoot) => void, options?: Omit<Api2PanelSpec, "id">) => Api2Call<Api2DomPanel>;
  readonly overlay?: (spec?: Api2PanelSpec) => Api2Call<Api2DomPanel>;
  readonly title?: Api2Title;
  readonly commands: {
    /**
     * Register a command a key or the command menu can run. With `{ direction: true }`
     * the game asks the player for a direction first and `run` hears it as `args.dir`
     * (keypad digits 1 to 9); Escape runs nothing.
     */
    register(id: string, verb: string, run: (args: Api2CommandArgs) => void | Promise<void>, options?: Api2CommandOptions): Api2Call<null>;
  };
  readonly gameMenu: {
    register(action: string, label: string, run: () => void | Promise<void>): Api2Call<null>;
  };
  /**
   * Show a panel. Needs `ui:panel.mount`. The host draws it; `onAction` hears
   * the `action` of each button the player uses.
   */
  mount(panel: Api2Panel, onAction?: (action: string, value?: string | boolean) => void, onDismiss?: () => void): Api2Call<{ readonly panelId: string }>;
  unmount(panelId: string): Api2Call<null>;
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
  readonly kv: Api2KeyValueStore;
  readonly session: Api2KeyValueStore;
  readonly install: Api2Slot;
  readonly prefs: Api2Slot;
  readonly character: Api2Slot;
}

/** An opaque name for a credential the host keeps. The mod never holds the value. */
export interface Api2CredentialRef {
  readonly credential: string;
  readonly prefix?: string;
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
  credential(name: string, prefix?: string): Api2CredentialRef;
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
    switchTo(id: string | null, action?: Api2ProfileAction): Api2Call<null>;
  };
  readonly saves: Api2Saves;
  readonly options: Api2ManagedOptions;
  readonly keys: Api2ManagedKeys;
  readonly look: Api2ManagedLook;
  readonly mods: Api2ManagedMods;
  authoring(): Api2Call<typeof import("../index.js")>;
  wizard(): Api2Call<Api2Wizard>;
  loadForSession(bytes: Uint8Array): Api2Call<{ readonly id: string; readonly version: string; readonly survivesReload: boolean }>;
  reloadGame(): Api2Call<null>;
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
  readonly perceived: boolean;
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

export interface Api2TrueRace {
  readonly ridx: number;
  readonly flags: readonly string[];
  readonly spells: readonly number[];
  readonly blows: readonly { readonly dice: number; readonly sides: number; readonly effect: string }[];
  readonly level: number;
  readonly sleep: number;
  readonly spellPower: number;
  readonly freqInnate: number;
  readonly freqSpell: number;
  readonly hasFriends: boolean;
}

export interface Api2StoreKnowledge {
  readonly storeIndex: number;
  readonly feat: number;
  readonly depth: number;
  readonly lastVisitTurn: number | null;
  readonly snapshotTurn: number;
  readonly stalenessRule: "current";
  readonly remoteStockUsable: true;
}

/** One grid as it really is. */
/**
 * A real object on the level. It carries the turns left until it recharges
 * (`timeout`) where a known item carries only what its name says.
 */
export type Api2TrueItem = Omit<KnownItem, "charging" | "unknownRunes" | "baseName" | "carried" | "artifactId" | "fuel"> & { readonly timeout: number };

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
  race(index: number): Api2Call<Api2TrueRace | null>;
  storeKnowledge(): Api2Call<readonly Api2StoreKnowledge[]>;
  level(): Api2Call<Api2TrueLevel>;
}

/** Everything API 2 hands a running mod. */
export interface ModApi2 {
  readonly engine?: Api2Engine;
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
  readonly backupFolder?: Api2BackupFolder;
}

/** What `hooks` is told when the host asks a mod for its hooks. */
export interface Api2HookContext {
  readonly id: string;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly engine?: Api2Engine;
}

export interface Api2ControllerContext extends Api2HookContext {
  readonly armed: boolean;
}

/** A key the player pressed while this mod's controller holds the keyboard. */
export interface Api2ControllerKey {
  /** The key's DOM name, as `KeyboardEvent.key` gives it: "a", "Enter", "F1". */
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  /** True when a held key is repeating. */
  readonly repeat: boolean;
}

/**
 * `keep`: the controller goes on driving, and the host shows `message` on the
 * message line when one is given. `release`: the keyboard goes back to the
 * player, with `reason` shown in place of the usual line.
 */
export type Api2ControllerKeyAnswer =
  | { readonly kind: "keep"; readonly message?: string }
  | { readonly kind: "release"; readonly reason?: string };

/** How a mod brings its stored preferences forward when their shape changes. */
export interface Api2PrefsMigration {
  /** The version of the shape `store.prefs` holds now. Starts at 1; data stored before any version is 0. */
  readonly version: number;
  /** Bring a value stored under `fromVersion` up to `version`. */
  migrate(value: JsonValue, fromVersion: number): JsonValue;
}

/** What `engineTiles` hands the game's tile seams. */
export interface Api2EngineTiles {
  readonly filler?: Api2TileFiller;
  readonly player?: Api2PlayerTileProvider;
}

/** An API 2 mod's code: its default export. */
export interface Api2ModDefinition {
  /** The mod API range this code was written for, such as ">=2.0.0 <3.0.0". */
  readonly api: string;
  /** First-party input decisions submit actions under the current input token. */
  controller?(mod: ModApi2, input: Api2InputState): void | Promise<void>;
  /** Birth consent is independent of current keyboard ownership. Core still confirms takeover. */
  armed?(context: Api2ControllerContext): boolean;
  /**
   * Called for each key the player presses while this mod's controller has the
   * keyboard and the game window has focus. Return `keep` to go on driving or
   * `release` to hand the keyboard back. Escape and Ctrl-Z always hand back
   * without reaching this handler; without a handler every other key hands back.
   * Answer synchronously, so do the key's work before returning; a promise, a
   * throw or any other answer hands the keyboard back and counts as a fault in
   * the mod. The key itself never reaches the game. Needs `controller`.
   */
  onKey?(press: Api2ControllerKey): Api2ControllerKeyAnswer;
  /**
   * What the character's death does while this mod's controller holds the
   * keyboard. `reincarnate`, the default, starts the next character in place.
   * `end` runs the ordinary death (the tombstone, the score table and the run
   * report); the controller stays installed until the page reloads. Needs
   * `controller`.
   */
  readonly onDeath?: "reincarnate" | "end";
  readonly presentation?: Api2Presenters;
  readonly actions?: readonly Api2MenuAction[];
  readonly titleActions?: readonly Api2TitleAction[];
  birth?(mod: ModApi2): Api2BirthPresenter | undefined;
  /**
   * The hooks this mod contributes, given its flags. Asked once when content
   * composes. In a Worker only the notification hooks (optionsChanged,
   * abilityGained, monsterBecameVisible, artifactIdentified) may be declared
   * here; every hook that returns an answer is declared in `policies`.
   */
  hooks?(context: Api2HookContext): Api2Hooks | undefined;
  /**
   * The game's own hook members, for the points API 2 has no hook for (a
   * generated level, a stack merge, a pack overflow, an artifact commit). They
   * take the live arguments the game passes, as API 1 hooks did, so this needs
   * the `engine` domain: it is asked only for a first-party mod or one the
   * player gave `engine:access`, and never in a Worker. A name that has an API
   * 2 form (a hook or a policy table) is refused; declare that one the API 2
   * way.
   */
  engineHooks?(context: Api2HookContext & { readonly engine: Api2Engine }): Readonly<Record<string, (...args: never[]) => unknown>> | undefined;
  /**
   * The game's two tile seams, for a tile set that draws what its art was never
   * made for: a `filler` that supplies tiles for monsters and objects the pack
   * has none for (a mod's additions, drawn as their kin), and a `player`
   * provider that picks the player's tile from who the character is (a
   * shapechange). Both take the engine's tiles, which come from `fill.derive`.
   * Needs the `registry:tiles` grant and the `engine` domain: it is asked only
   * for a first-party mod or one the player gave `engine:access`, and never in
   * a Worker. A mod that also declares a `tileMap` table keeps the table's
   * filler, so declare the filler here or in the table, not both.
   */
  engineTiles?(context: Api2HookContext & { readonly engine: Api2Engine }): Api2EngineTiles | undefined;
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
  readonly install?: Api2PrefsMigration;
}

export interface Api2MenuAction {
  readonly menu: "core:game-menu";
  readonly action: string;
  readonly label: string;
  run(mod: ModApi2): void | Promise<void>;
}

export interface Api2BackupFolderEntry {
  readonly name: string;
  readonly lineage?: string;
  readonly characterName: string;
  readonly level: number;
}

export interface Api2BackupFolder {
  name(): Api2Call<string | null>;
  choose(): Api2Call<string | null>;
  forget(): Api2Call<null>;
  write(name: string, text: string): Api2Call<boolean>;
  list(): Api2Call<readonly Api2BackupFolderEntry[]>;
  onSave(listener: (file: { readonly name: string; readonly text: string }) => void): Api2Call<Api2Subscription>;
  off(subscription: Api2Subscription): Api2Call<null>;
}

/** Declare an API 2 mod. Returns its argument; the type checks the shape. */
export function defineApi2Mod(definition: Api2ModDefinition): Api2ModDefinition {
  return definition;
}
