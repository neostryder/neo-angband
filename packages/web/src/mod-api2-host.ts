/**
 * The in-process (first-party tier) host for the mod API, version 2.
 *
 * It builds every API 2 domain over the API 1 context the host already hands a
 * plugin (mod-context.ts): the same facades, the same grants, the same latches.
 * Nothing here reaches the game by a door API 1 does not already have; what
 * changes is what comes back. Reads go through the known-world builder, so a
 * mod sees what the player knows. Every value is cloned and frozen, so a mod
 * holds data outside the consented in-process engine domain. Every call answers with an Api2Result,
 * and a permission the player refused answers `not-granted` instead of
 * throwing.
 *
 * Management eligibility belongs to the loader's allowlist. Truth also opens for Workers holding either explicit truth grant, with a durable consequence before each snapshot.
 */

import { MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import { gameplayIntent } from "./mod-gameplay-intents";
import {
  AgentCapabilityError,
  ContentIdResolver,
  wizCreateObj,
  wizSummonNamed,
  buildKnownWorld,
  createAgentView,
  colorPrefId,
  colorTableSnapshot,
  colorToCss,
  describeLookGrid,
  knownMonsterMidx,
  monsterIsObvious,
  MON_RACE_FLAG_ENTRIES,
  MON_SPELL_ENTRIES,
  RSF,
  storeKnowledge,
  knownLoadoutSimulation,
  squareIsSeen,
  trueMonsterViews,
  tokenIsCurrent,
  provenanceOf,
  type AgentCapabilities,
  type AgentViewDeps,
  type AgentView,
  type ActionRegistry,
  type CommandVerbTable,
  type GameEventMap,
  type GameEventType,
  type GameState,
  type ModRegistryHost,
  type PlayerIntent,
  type PromptAnswer,
  type WizardDeps,
} from "@rpgm-tools/neo-angband-core";
import {
  API2_EVENT_NAMES,
  API2_HOOK_NAMES,
  api2NotGranted,
  api2Ok,
  api2Refused,
  api2Unavailable,
  MOD_API2_VERSION,
  ENGINE_API2_VERSION,
  type Api2Engine,
  type Api2Activation,
  type Api2BoundRecord,
  recordKey,
  type Api2Actor,
  type Api2Call,
  type Api2EventMap,
  type Api2EventName,
  type Api2HookName,
  type Api2Manage,
  type Api2NetRequest,
  type Api2Panel,
  type Api2PanelPatch,
  type Api2PrefsMigration,
  type Api2Result,
  type Api2Slot,
  type Api2TrueCell,
  type Api2TrueLevel,
  type Api2TrueMonster,
  type Api2Truth,
  type Api2Permissions,
  type Api2Title,
  type JsonRecord,
  type JsonValue,
  type KnownWorldData,
  type ModApi2,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPluginContext } from "./mod-plugin";
import { createModWorkerPanelRenderer, createModWorkerTextRenderer, type ModWorkerPanelRenderer } from "./mod-worker/panels";
import { WORKER_MANAGE_CALLS, validWorkerManageCall, type WorkerJson } from "./mod-worker/protocol";
import { modInstallPrefs, modKeyValueStore, type ModPrefs, type PrefsStorage } from "./mod-prefs";
import { createManageAdapter, workerManageOperation, type ManageAdapter } from "./mod-manager/manage-adapter";
import type { ModManagerService } from "./mod-manager/service";
import type { ManagerResult } from "./mod-manager/types";
import type { Api2ManagedMods, Api2ManagerConfirmation, Api2ScreenKey } from "@rpgm-tools/neo-angband-mod-sdk";
import { isScreenKey, screenHeldByOther, takeScreens } from "./mod-screens";
import { modRegistries } from "./mod-context";
import { OPTION_ENTRIES } from "@rpgm-tools/neo-angband-core";
import { bootPhase, onBootPhaseChanged } from "./presentation-phase";
import { menuRegistry } from "./menu-registry";
import { clearQueuedUiInputs, enqueueUiInputs, inputEvents } from "./input-door";
import { closeTopModPanel, modPanelsSuspended, modPresentationSuspended, onModPanelSuspension, suspendModPanels, topModPanelId } from "./panel-runtime";
import { removeBackupSink } from "./mod-backup";
import { prepareTruthRead } from "./mod-truth-consent";
import { consentBinding } from "./mod-consent-binding";
import { modHolds } from "./mod-tier";
import { workerProfileAccess } from "./profile-runtime";
import { workerSaveAccess } from "./saves-facade";
import { createModOptions } from "./mod-options";
import { createModKeybindings, isWorkerBindingKey } from "./mod-keybindings";
import { workerVisualFilter } from "./visual-filter";
import { cloneWorkerJson, payloadBytes } from "./mod-worker/clone";
import { SPAWN_SHARED_WORKER_CALLS } from "./mod-worker/protocol";

/** Asks the player for the real map on behalf of a mod; the game wires it at boot (main.ts). */
type TruthConsentAsk = (modId: string, reason: string) => Promise<"granted" | "declined" | "unavailable">;
let truthConsentAsk: TruthConsentAsk | undefined;
export function setApi2TruthConsent(ask: TruthConsentAsk | undefined): void {
  truthConsentAsk = ask;
}

/** The loader must authorize namespaces before the host can expose them. */
export interface Api2Allowlist {
  /** The management seam, for the first-party presentation mod. */
  readonly manage?: boolean;
  /** Hidden game state needs consent even when identity is first-party. */
  readonly truth?: boolean;
  readonly presentation?: boolean;
}

/** What the loader tells the host about one mod. */
export interface Api2HostOptions {
  readonly intent?: ModPluginContext["intent"];
  readonly developerInProcess?: boolean;
  readonly execution?: "in-process" | "worker" | "data";
  /** The gated registry host the loader built for this mod; offered as `engine.registry` while `start` runs. */
  readonly registry?: ModRegistryHost;
  readonly install?: Api2PrefsMigration | Api2HostPrefsMigration;
  readonly installStorage?: ModPrefs;
  readonly kvStorage?: PrefsStorage | null;
  readonly sessionStorage?: PrefsStorage | null;
  readonly management?: () => Promise<ModManagerService>;
  readonly workerManagement?: WorkerManagementHost;
  readonly workerSpawnShared?: WorkerSpawnSharedHost;
  readonly commands?: {
    readonly registry: Pick<ActionRegistry, "has" | "register" | "unregister">;
    readonly verbs?: CommandVerbTable;
  };
  /** Measured identity is independent of consent to hidden data. */
  readonly tier?: "first-party" | "public";
  /** The permissions the player granted this mod. */
  readonly grants: AgentCapabilities;
  /** The loader settles namespace grants separately from measured identity; the property name remains for compatibility. */
  readonly firstParty?: Api2Allowlist;
  /** Resolver and glyph sources for the known world (ids and glyphs are absent without them). */
  readonly viewDeps?: AgentViewDeps;
  /** The panel renderer; one drawing into this page's document by default. */
  readonly panels?: ModWorkerPanelRenderer;
  /** The hooks this mod declared, for `hooks.active`. */
  readonly activeHooks?: readonly Api2HookName[];
  /**
   * How this mod's stored preferences migrate, when it declares a version. A
   * Worker mod's migration answers asynchronously, across the broker.
   */
  readonly prefs?: Api2PrefsMigration | Api2HostPrefsMigration;
}

/** A preference migration that may answer later: how the Worker broker passes a Worker mod's. */
export interface Api2HostPrefsMigration {
  readonly version: number;
  migrate(value: JsonValue, fromVersion: number): JsonValue | Promise<JsonValue>;
}

const NO_GAME = "no game is running yet";
let managementHost: Api2HostOptions["management"];

export function setApi2ManagementHost(host: Api2HostOptions["management"]): void {
  managementHost = host;
}
let commandHost: Api2HostOptions["commands"];
interface KeymapCommand {
  readonly direction: boolean;
  readonly turn: boolean;
  /** Runs the handler and answers the energy it spent. */
  invoke(dir?: number): number;
}
const keymapCommands = new Map<string, KeymapCommand>();
let directionPrompt: (() => Promise<number | null>) | undefined;
let commandPusher: ((code: string, dir?: number) => void) | undefined;

/** Queues a command code into the game's turn, which is where a `turn: true` command runs from a bound key. */
export function setApi2CommandPusher(push: (code: string, dir?: number) => void): void {
  commandPusher = push;
}

/** The game's direction prompt, which a command registered with `direction: true` asks before it runs. */
export function setApi2DirectionPrompt(prompt: () => Promise<number | null>): void {
  directionPrompt = prompt;
}

export function runApi2KeymapCommand(action: string): boolean {
  const command = keymapCommands.get(action);
  if (!command) return false;
  const go = (dir?: number): void => {
    if (command.turn && commandPusher) commandPusher(action, dir);
    else command.invoke(dir);
  };
  if (!command.direction) go();
  else if (directionPrompt) void directionPrompt().then((dir) => { if (dir !== null) go(dir); });
  return true;
}

export function setApi2CommandHost(host: Api2HostOptions["commands"]): void {
  commandHost = host;
}
const disposers = new WeakMap<ModApi2, () => void>();

export function disposeApi2Host(api: ModApi2): void {
  disposers.get(api)?.();
  disposers.delete(api);
}

export function api2Engine(ctx: ModPluginContext, options: Api2HostOptions): Api2Engine | undefined {
  const held = (): boolean => options.execution !== "worker" && options.execution !== "data" &&
    (options.tier === "first-party" || options.developerInProcess === true) && options.grants.has("engine:access");
  if (!held()) return undefined;
  const read = <T>(value: () => T): T => {
    if (!held()) throw new AgentCapabilityError("this mod needs capability \"engine:access\"");
    return value();
  };
  return frozen({
    get api() { return read(() => ENGINE_API2_VERSION); },
    get core() { return read(() => ctx.core); },
    get state() { return read(() => ctx.state); },
    get registries() { return read(() => ctx.registries ?? modRegistries()); },
    get registry() { return read(() => options.registry); },
  });
}

/** Stopping and disposing a host are one act: both release every subscription, panel, key and command the mod holds. */
export function stopApi2Host(api: ModApi2): void {
  disposeApi2Host(api);
}

/** A clone the caller cannot use to reach or change anything else. */
function data<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/* Freeze one domain object; keeps the declared type so callbacks stay typed. */
function frozen<T extends object>(value: T): T {
  return Object.freeze(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/* Run one call so that a capability error from an older facade still answers
 * with a result rather than a rejection. Anything else is a real fault and
 * rejects, as it would for API 1. */
async function guarded<T>(body: () => Api2Result<T> | Promise<Api2Result<T>>): Api2Call<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof AgentCapabilityError) return api2Refused("capability", e.message);
    throw e;
  }
}

/**
 * Turn one game event into its API 2 payload, or undefined when the player
 * did not see it and the mod must not hear of it.
 *
 * The player knows outcomes against themselves. A monster's outcome requires a perceived target in view, and movement reveals only observed endpoints. Core captures identities before deleted monsters lose their slots.
 */
export function api2EventPayload<K extends Exclude<Api2EventName, "run-end">>(
  name: K,
  raw: GameEventMap[K & GameEventType],
): Api2EventMap[K] | undefined {
  const actor = (who: Api2Actor): Api2Actor =>
    typeof who === "object" ? { monster: who.monster } : who;
  const out = ((): unknown => {
    switch (name) {
      case "message": {
        const m = raw as GameEventMap["message"];
        return { text: m.msg ?? "", type: m.type };
      }
      case "dungeonlevel": {
        const d = raw as GameEventMap["dungeonlevel"];
        return { depth: d.depth, levelId: d.levelId, cause: d.cause, arena: d.arena };
      }
      case "combat-outcome": {
        const c = raw as GameEventMap["combat-outcome"];
        const attacker = c.perceivedAttacker === null ? null : actor(c.perceivedAttacker);
        const target = actor(c.perceivedTarget);
        const involved = attacker === "player" || target === "player";
        if (!involved && !c.seen) return undefined;
        if (target !== "player" && (target === "unseen" || !c.seen)) return undefined;
        return {
          attacker,
          target,
          kind: c.kind,
          hit: c.hit,
          died: c.died,
          grid: { x: c.grid.x, y: c.grid.y },
          ...(target === "player" ? { playerDamage: c.damage } : {}),
        };
      }
      case "motion": {
        const m = raw as GameEventMap["motion"];
        const who = actor(m.perceivedWho);
        if (who === "unseen" || (who !== "player" && !m.seen)) return undefined;
        return {
          who,
          ...(who === "player" || m.fromSeen ? { from: { x: m.from.x, y: m.from.y } } : {}),
          to: { x: m.to.x, y: m.to.y }, kind: m.kind,
        };
      }
      case "heal": {
        const h = raw as GameEventMap["heal"];
        const who = actor(h.perceivedWho);
        if (who === "unseen" || (who !== "player" && !h.seen)) return undefined;
        return { who, grid: { x: h.grid.x, y: h.grid.y }, ...(who === "player" ? { playerAmount: h.amount } : {}) };
      }
      case "player-command": {
        const c = raw as GameEventMap["player-command"];
        const args = Object.fromEntries(["handle", "floor", "spell", "index"].flatMap((key) => {
          const value = c.args?.[key];
          return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? [[key, value]] : [];
        }));
        return {
          code: c.code,
          ...(c.dir !== undefined ? { dir: c.dir } : {}),
          ...(Object.keys(args).length > 0 ? { args } : {}),
          phase: c.phase,
          token: { epoch: c.token.epoch, revision: c.token.revision },
        };
      }
      case "bolt": {
        const bolt = raw as GameEventMap["bolt"];
        if (!bolt.seen || !bolt.drawing) return undefined;
        return { grid: { x: bolt.x, y: bolt.y }, element: bolt.element, beam: bolt.beam };
      }
      case "explosion": {
        const explosion = raw as GameEventMap["explosion"];
        if (!explosion.drawing) return undefined;
        const grids = explosion.blastGrid.filter((_grid, index) => explosion.playerSeesGrid[index] === true)
          .map((grid) => ({ x: grid.x, y: grid.y }));
        if (grids.length === 0) return undefined;
        return { grids, element: explosion.element, arc: explosion.arc };
      }
      case "driver-changed":
        return structuredClone(raw);
      default:
        return null;
    }
  })();
  return out === undefined ? undefined : deepFreeze(out) as Api2EventMap[K];
}

export function api2MayObserveKeys(ctx: Pick<ModPluginContext, "snapshot">): boolean {
  if (modPanelsSuspended() || ctx.snapshot?.()?.phase !== "play") return false;
  if (typeof document === "undefined") return true;
  const focus = document.activeElement;
  return focus === null || focus === document.body || focus === document.documentElement || focus.id === "game" || focus.id === "game-view";
}

/** Build the API 2 domains for one in-process mod over its API 1 context. */
export function createApi2Host(ctx: ModPluginContext, options: Api2HostOptions): ModApi2 {
  const cleanups = new Set<() => void>();
  const { grants } = options;
  const seams = options.firstParty;
  const granted = (capability: string): boolean => {
    if (capability === "engine:access") return options.execution !== "worker" && options.execution !== "data" &&
      (options.tier === "first-party" || options.developerInProcess === true) && grants.has(capability);
    try {
      return grants.has(capability);
    } catch {
      /* An unrecognised string is a permission nobody holds. */
      return false;
    }
  };
  const readable = (domain: string): boolean => granted(`state:${domain}.read`) || granted("state:*.read");
  const withState = <T>(body: (state: GameState) => Api2Result<T> | Promise<Api2Result<T>>): Api2Call<T> =>
    guarded(() => (ctx.state ? body(ctx.state) : api2Unavailable(NO_GAME)));
  const keyed = (world: KnownWorldData): KnownWorldData => data({ ...world,
    player: world.player ? { ...world.player, key: ctx.character?.key() ?? null } : null });
  const viewDeps = (state: GameState): AgentViewDeps => ({ ...state.knownWorldDeps, ...options.viewDeps });
  /* One part of the known world, built with only that part readable. */
  const part = (state: GameState, domain: string): KnownWorldData =>
    keyed(buildKnownWorld(state, viewDeps(state), {
      has: (c) => (c === `state:${domain}.read` && readable(domain)) ||
        (domain === "map" && c === "state:floor.read" && readable("floor")),
    }));
  const inspectRead = <T>(domains: readonly string[], read: (state: GameState, view: AgentView) => T): Api2Call<T> =>
    withState((state) => {
      for (const domain of domains) if (!readable(domain)) return api2NotGranted(`state:${domain}.read`);
      const view = createAgentView(state, undefined, { ...viewDeps(state), knowledgeSafe: true }, { has: granted });
      return api2Ok(data(read(state, view)));
    });

  let panels = options.panels;
  const renderer = (): ModWorkerPanelRenderer | undefined => {
    if (!panels && typeof document !== "undefined") panels = createModWorkerPanelRenderer(document);
    return panels;
  };

  const subscriptions = new Map<string, { type: GameEventType; handler: (type: GameEventType, raw: unknown) => void }>();
  const keySubscriptions = new Map<string, () => void>();
  const ownedKeys = new Set<string>();
  let stopped = false;
  const presentationHeld = (capability: string): boolean => !stopped && options.tier === "first-party" &&
    options.execution !== "worker" && options.execution !== "data" && seams?.presentation === true && granted(capability);
  const requirePresentation = (capability: string): void => {
    if (!presentationHeld(capability)) throw new AgentCapabilityError(`this mod needs capability "${capability}"`);
  };
  const presentationFacade = <T extends object>(source: T, capability: string): T => new Proxy({} as T, {
    get: (_target, key) => {
      requirePresentation(capability);
      const value: unknown = Reflect.get(source, key, source);
      return typeof value === "function" ? (...args: unknown[]) => {
        requirePresentation(capability);
        return Reflect.apply(value, source, args);
      } : value;
    },
    ownKeys: () => Reflect.ownKeys(source),
    getOwnPropertyDescriptor: (_target, key) => key in source ? { configurable: true, enumerable: true } : undefined,
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
  const presentationCapabilities = ["display:replace", "ui:sidebar.replace", "ui:status.replace", "ui:messages.replace",
    "ui:menu.replace", "ui:screen.replace", "ui:birth.replace", "ui:region.create", "keymap:edit", "screens:manage", "ui:title"];
  const presentation = presentationCapabilities.some(presentationHeld);
  const engineOptions = { ...options, grants: { has: (capability: string) => !stopped && granted(capability) } };
  let nextSubscription = 1;
  const runSubscriptions = new Map<string, () => void>();
  const titleRows = new Map<string, () => void>();
  const publicMod = options.tier !== "first-party";
  let actionBudget = 0;
  let actionUntil = 0;
  let choosingTitle = false;
  const ownedCommands = new Set<string>();
  const ownedMenuActions = new Set<string>();
  const playerAction = <T extends unknown[]>(run: (...args: T) => unknown) => (...args: T): void => {
    actionBudget = 8;
    actionUntil = Date.now() + 1000;
    void run(...args);
  };
  const inputAllowed = (): boolean => {
    if (modPanelsSuspended()) return false;
    const owner = ctx.driver?.();
    if (owner?.kind === "controller") return owner.owner === ctx.id;
    return actionBudget > 0 && Date.now() <= actionUntil;
  };
  const title: Api2Title | undefined = granted("ui:title") ? frozen<Api2Title>({
    registerRow: (row) => guarded(() => {
      if (!granted("ui:title")) return api2NotGranted("ui:title");
      if (!ctx.title) return api2Unavailable("this front end has no title actions");
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(row.id) || titleRows.has(row.id)) return api2Refused("bad-title-row", "a title action needs a free id");
      try {
        if (publicMod && (titleRows.size >= 16 || typeof row.label !== "string" || row.label.length > 120 || [...row.label].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || typeof row.run !== "function")) return api2Refused("bad-title-row", MOD_PERMISSION_TEXT.title);
        const remove = ctx.title.registerRow({ ...row, run: playerAction(row.run) });
        titleRows.set(row.id, remove);
        cleanups.add(remove);
        return api2Ok(frozen({ id: row.id }));
      } catch (error) {
        return api2Refused("bad-title-row", error instanceof Error ? error.message : String(error));
      }
    }),
    removeRow: (subscription) => guarded(() => {
      if (!granted("ui:title")) return api2NotGranted("ui:title");
      const remove = titleRows.get(subscription.id);
      remove?.();
      if (remove) cleanups.delete(remove);
      titleRows.delete(subscription.id);
      return api2Ok(null);
    }),
    choose: (label, choices) => guarded(async () => {
      if (!granted("ui:title")) return api2NotGranted("ui:title");
      if (publicMod && (choosingTitle || !inputAllowed() || ctx.snapshot?.()?.phase !== "pregame" || typeof label !== "string" || label.length > 120 ||
        !Array.isArray(choices) || choices.length > 32 || choices.some((choice) => typeof choice !== "string" || choice.length > 120))) return api2Refused("title", MOD_PERMISSION_TEXT.title);
      choosingTitle = true;
      try { return ctx.title ? api2Ok(await ctx.title.choose(label, [...choices])) : api2Unavailable("this front end has no title choices"); }
      finally { choosingTitle = false; }
    }),
  }) : undefined;
  const openPage = (spec: import("@rpgm-tools/neo-angband-mod-sdk").Api2PanelSpec) => guarded(() => {
    if (!["ui:region.create", "ui:screen.replace", "screens:manage"].some(presentationHeld)) return api2NotGranted("ui:region.create");
    if (!granted("ui:panel.mount")) return api2NotGranted("ui:panel.mount");
    if (!ctx.ui) return api2Unavailable("this front end mounts no pages");
    try {
      const panel = ctx.ui.openPanel(spec);
      const close = () => panel.close();
      const onKey = (event: KeyboardEvent) => {
        if (!panel.open || modPanelsSuspended() || topModPanelId() !== panel.id) return;
        if (!spec.modal && !panel.root.activeElement) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key === "Escape") {
          event.preventDefault(); event.stopImmediatePropagation();
          if (!event.repeat && !event.isComposing) closeTopModPanel();
        } else if (["Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "2", "4", "6", "8"].includes(event.key)) {
          const controls = [...panel.root.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),a[href]")];
          if (!controls.length) return;
          event.preventDefault(); event.stopImmediatePropagation();
          const index = controls.indexOf(panel.root.activeElement as HTMLElement);
          const step = ["ArrowUp", "ArrowLeft", "4", "8"].includes(event.key) || event.shiftKey ? -1 : 1;
          controls[(index + step + controls.length) % controls.length]!.focus();
        } else if (event.key === "Enter" && panel.root.activeElement?.matches("button,a[href],input[type=checkbox]")) {
          event.preventDefault(); event.stopImmediatePropagation();
          (panel.root.activeElement as HTMLElement).click();
        }
      };
      inputEvents.addEventListener("keydown", onKey, true);
      const off = () => inputEvents.removeEventListener("keydown", onKey, true);
      cleanups.add(close);
      cleanups.add(off);
      void panel.closed.then(() => { off(); cleanups.delete(off); cleanups.delete(close); });
      return api2Ok(panel);
    } catch (error) {
      return api2Refused("bad-panel", error instanceof Error ? error.message : String(error));
    }
  });
  const backupListeners = new Map<string, (file: { readonly name: string; readonly text: string }) => void>();
  const folder = ctx.backupFolder;
  const backupFolder: import("@rpgm-tools/neo-angband-mod-sdk").Api2BackupFolder | undefined = folder && granted("backup:folder") ? frozen({
    name: () => guarded(async () => api2Ok(await folder.name())),
    choose: () => guarded(async () => api2Ok(await folder.choose())),
    forget: () => guarded(async () => { await folder.forget(); return api2Ok(null); }),
    write: (name: string, text: string) => guarded(async () => api2Ok(await folder.write(name, text))),
    list: () => guarded(async () => api2Ok(data((await folder.list()).map((entry) => ({
      name: entry.name, characterName: entry.characterName, level: entry.level,
      ...(entry.lineage === undefined ? {} : { lineage: entry.lineage }),
    }))))),
    onSave: (listener: (file: { readonly name: string; readonly text: string }) => void) => guarded(() => {
      const id = `${ctx.id}:backup:${nextSubscription++}`;
      backupListeners.set(id, listener);
      folder.onSave((file) => {
        for (const callback of backupListeners.values()) callback(data({ name: file.name, text: file.text }));
      });
      return api2Ok(frozen({ id }));
    }),
    off: (subscription: { readonly id: string }) => guarded(() => {
      backupListeners.delete(subscription.id);
      if (!backupListeners.size) removeBackupSink(ctx.id);
      return api2Ok(null);
    }),
  }) : undefined;
  if (backupFolder) cleanups.add(() => { backupListeners.clear(); removeBackupSink(ctx.id); });

  const prefsEnvelope = "neo-angband/mod/prefs";
  const slot = (storage: ModPrefs, migration: Api2HostOptions["prefs"]): Api2Slot => {
    const wrap = (value: JsonValue, version: number): JsonValue => ({
      format: prefsEnvelope, schemaVersion: 1, data: { version, value },
    });
    let prefsRevision = 0;
    let pendingMigration: Promise<Api2Result<JsonValue | null>> | undefined;
    const prefs: Api2Slot = {
      get: () => guarded(async () => {
        const raw = storage.get() as JsonValue | null;
        if (raw === null || raw === undefined) return api2Ok(null);
        const stored = typeof raw === "object" && !Array.isArray(raw) ? raw : undefined;
        const contents = stored?.["data"];
        const envelopeData = contents !== null && typeof contents === "object" && !Array.isArray(contents) ? contents : undefined;
        const enveloped = stored?.["format"] === prefsEnvelope && stored["schemaVersion"] === 1 &&
          Object.keys(stored).length === 3 && envelopeData !== undefined && Object.keys(envelopeData).length === 2 &&
          typeof envelopeData["version"] === "number" && Number.isInteger(envelopeData["version"]) &&
          envelopeData["version"] >= 1 && Object.hasOwn(envelopeData, "value");
        const from = enveloped ? envelopeData!["version"] as number : 0;
        const value = enveloped ? envelopeData!["value"] ?? null : raw;
        if (!migration || from >= migration.version || value === null) return api2Ok(data(value));
        if (pendingMigration) return pendingMigration;
        const revision = prefsRevision;
        const migrating = (async (): Promise<Api2Result<JsonValue | null>> => {
          const migrated = await migration.migrate(structuredClone(value), from);
          if (revision !== prefsRevision) return prefs.get();
          storage.set(wrap(migrated, migration.version));
          return api2Ok(data(migrated));
        })();
        pendingMigration = migrating;
        try {
          return await migrating;
        } finally {
          pendingMigration = undefined;
        }
      }),
      set: (value) => guarded(() => {
        storage.set(value === null || !migration ? value : wrap(structuredClone(value), migration.version));
        prefsRevision += 1;
        return api2Ok(null);
      }),
    };
    return prefs;
  };
  const prefs = slot(ctx.prefs, options.prefs);
  const install = slot(options.installStorage ?? modInstallPrefs(ctx.id), options.install);

  const character: Api2Slot = {
    get: () => guarded(() => {
      if (!ctx.characterStore) return api2Unavailable("there is no character to keep data for yet");
      return api2Ok(data((ctx.characterStore.get() ?? null) as JsonValue | null));
    }),
    set: (value) => guarded(() => {
      if (!ctx.characterStore) return api2Unavailable("there is no character to keep data for yet");
      ctx.characterStore.set(value === null ? null : structuredClone(value));
      return api2Ok(null);
    }),
  };

  const records = (file: string): Api2Result<readonly JsonRecord[]> => {
    if (file === "option") return api2Ok(data(OPTION_ENTRIES.filter((e) => e.name !== "none").map((e) => ({
      name: e.name, birth: e.type === "BIRTH", cheat: e.type === "CHEAT", score: e.type === "SCORE",
    }))));
    const composed = ctx.composedRecords;
    if (!composed) return api2Unavailable("the game's content has not been composed yet");
    const list = composed[file];
    if (!list) return api2Refused("unknown-file", `the game has no "${file}" content file`);
    return api2Ok(data(list));
  };

  const engine = api2Engine(ctx, engineOptions);
  const api: ModApi2 = {
    ...(engine ? { engine } : {}),
    meta: frozen({
      id: ctx.id,
      api: MOD_API2_VERSION,
      engine: ctx.engine,
      tier: options.tier ?? "public",
      flags: data({ ...ctx.flags }),
      newCharacter: ctx.newCharacter,
      controllerArmed: ctx.controllerArmed === true,
      granted,
      log: (message: string) => ctx.log(message),
      settings: () => guarded(() => api2Ok(data({ ...(ctx.settings?.all() ?? {}) }))),
      setSetting: (id: string, value: number) => guarded(() => {
        const kept = ctx.settings?.set(id, value);
        return kept === undefined
          ? api2Refused("unknown-setting", `this mod declares no numeric setting "${id}"`)
          : api2Ok(kept);
      }),
      mods: () => guarded(() => (ctx.mods ? api2Ok(data(ctx.mods().map((mod) => ({ ...mod, name: mod.name ?? mod.id })))) : api2Unavailable("this front end lists no mods"))),
    }),

    view: frozen({
      options: () => withState((state) => {
        if (!readable("player")) return api2NotGranted("state:player.read");
        const opts = state.options;
        return opts ? api2Ok(data(opts.snapshot())) : api2Unavailable("this game has no options");
      }),
      messages: (since = 0) => guarded(() => {
        if (!readable("messages")) return api2NotGranted("state:messages.read");
        if (!Number.isSafeInteger(since) || since < 0) return api2Refused("invalid-cursor", "the message cursor must be a nonnegative integer");
        const messages = ctx.snapshot?.()?.messages;
        if (messages?.cursor === undefined || !messages.recent) return api2Unavailable("this front end has no message cursor");
        const entries = messages.recent.map((message, index) => ({ ...message,
          sequence: messages.cursor! - messages.recent!.length + index + 1 })).filter((message) => message.sequence > since);
        return api2Ok(data({ cursor: messages.cursor, entries }));
      }),
      knowledge: (category, id) => guarded(() => {
        if (!readable("knowledge")) return api2NotGranted("state:knowledge.read");
        const knowledge = ctx.knowledge;
        if (!knowledge) return api2Unavailable("this front end has no knowledge menu");
        const categories = knowledge.categories();
        const lists = Object.fromEntries(categories.flatMap(({ id: categoryId }) => {
          const list = knowledge.list(categoryId);
          return list ? [[categoryId, list]] : [];
        }));
        return api2Ok(data({ categories, lists,
          recall: category !== undefined && id !== undefined ? knowledge.recall(category, id) : null }));
      }),
      character: () => guarded(() => {
        if (!readable("player")) return api2NotGranted("state:player.read");
        const character = ctx.character;
        if (!character) return api2Unavailable("there is no character record");
        return api2Ok(data({ key: character.key(), sheet: character.sheet?.() ?? null,
          history: character.history(), report: options.tier === "first-party" ? character.runReport?.() ?? null : null }));
      }),
      inspect: frozen({
        simulateLoadout: (change) => api.view.simulateLoadout(change),
        item: (ref) => inspectRead(["inventory", ...(typeof ref === "number" ? [] : "floor" in ref ? ["floor"] : ["stores"])], (state, view) => {
          if (typeof ref !== "number" && "floor" in ref && (!state.chunk.inBounds(ref.floor) || !squareIsSeen(state.chunk, ref.floor))) return null;
          if (typeof ref !== "number" && "store" in ref && state.chunk.feat(state.actor.grid) !== state.stores?.[ref.store]?.feat) return null;
          return view.inspectItem!(ref);
        }),
        itemRules: () => inspectRead(["inventory"], (_state, view) => view.itemRules!()),
        itemTester: (code) => inspectRead(["inventory", "floor"], (_state, view) => view.itemTester!(code)),
        bookForItem: (handle) => inspectRead(["inventory", "spells"], (_state, view) => view.bookForItem!(handle)),
        spell: (index) => inspectRead(["spells"], (_state, view) => view.spellInfo!(index)),
        monsterRecall: (index) => inspectRead(["monsters"], (_state, view) => view.monsterRecall!(index)),
        projectionPath: (to) => inspectRead(["map"], (_state, view) => view.projectionPath!(to)),
        blastArea: (to, radius, arc) => inspectRead(["map"], (_state, view) => view.blastArea!(to, radius, arc)),
        travelPath: (to) => inspectRead(["map"], (_state, view) => view.travelPath!(to)),
        compareLoadoutSlots: (ref) => inspectRead(["player", "inventory", ...(ref.from === "floor" ? ["floor"] : ref.from === "store" ? ["stores"] : [])], (state, view) => {
          if (ref.from === "floor" && (!state.chunk.inBounds(ref) || !squareIsSeen(state.chunk, ref))) return { token: part(state, "player").token, slots: [] };
          if (ref.from === "store" && state.chunk.feat(state.actor.grid) !== state.stores?.[ref.store]?.feat) return { token: part(state, "player").token, slots: [] };
          const result = view.compareLoadoutSlots!(ref);
          return { ...result, slots: result.slots.map((slot) => ({ ...slot, comparison: knownLoadoutSimulation(state, slot.comparison) })) } as import("@rpgm-tools/neo-angband-mod-sdk").LoadoutSlotsResult;
        }),
        tileActions: (to) => inspectRead(["map"], (_state, view) => view.tileActions!(to)),
      }),
      catalogue: () => guarded(() => {
        if (!readable("interaction")) return api2NotGranted("state:interaction.read");
        const catalogue = ctx.intent?.catalogue?.();
        return catalogue ? api2Ok(data(catalogue)) : api2Unavailable("this front end has no command catalogue");
      }),
      world: () => withState((state) => api2Ok(keyed(buildKnownWorld(state, viewDeps(state), { has: granted })))),
      player: () => withState((state) => {
        if (!readable("player")) return api2NotGranted("state:player.read");
        const player = part(state, "player").player;
        return player ? api2Ok(player) : api2Unavailable(NO_GAME);
      }),
      monsters: () => withState((state) => {
        if (!readable("monsters")) return api2NotGranted("state:monsters.read");
        return api2Ok(part(state, "monsters").monsters ?? []);
      }),
      level: () => withState((state) => {
        if (!readable("map")) return api2NotGranted("state:map.read");
        const level = part(state, "map").level;
        return level ? api2Ok(level) : api2Unavailable("there is no level yet");
      }),
      input: () => guarded(() => {
        if (!readable("interaction")) return api2NotGranted("state:interaction.read");
        const snap = ctx.snapshot?.();
        if (!snap || snap.phase === null || snap.messagePending === null) return api2Unavailable(NO_GAME);
        return api2Ok(data({
          token: snap.token,
          driver: snap.driver,
          phase: snap.phase === "pregame" ? bootPhase() : snap.phase,
          messagePending: snap.messagePending,
          prompt: snap.prompt,
          resting: snap.resting,
          running: (ctx.state?.run?.running ?? 0) > 0,
          repeating: (ctx.state?.cmdQueue?.[0]?.repeatRemaining ?? 0) > 0,
          repeatsLeft: ctx.state?.cmdQueue?.[0]?.repeatRemaining ?? 0,
          unignoring: (ctx.state?.unignoring ?? 0) > 0,
          messages: readable("messages") ? snap.messages?.log.slice(-100) ?? null : null,
          storeStatus: readable("stores") && readable("inventory") ? snap.storeStatus : null,
          activeBlast: readable("map") ? snap.activeBlast : null,
        }));
      }),
      look: (grid) => withState((state) => {
        for (const domain of ["map", "floor", "monsters"]) {
          if (!readable(domain)) return api2NotGranted(`state:${domain}.read`);
        }
        if (!Number.isInteger(grid.x) || !Number.isInteger(grid.y) || !state.chunk.inBounds(grid)) {
          return api2Refused("invalid-grid", "the grid is outside the level");
        }
        return api2Ok(describeLookGrid(state, grid, 0, true).text);
      }),
      simulateLoadout: (change) => withState((state) => {
        for (const domain of ["player", "inventory"]) {
          if (!readable(domain)) return api2NotGranted(`state:${domain}.read`);
        }
        const refs = [...(change.wield ?? []), ...(change.wieldAt ?? []).map((entry) => entry.item),
          ...(change.carry ?? []).map((entry) => entry.item)];
        for (const ref of refs) {
          const domain = ref.from === "store" ? "stores" : ref.from === "floor" ? "floor" : "inventory";
          if (!readable(domain)) return api2NotGranted(`state:${domain}.read`);
          if (ref.from === "floor" && (!state.chunk.inBounds(ref) || !squareIsSeen(state.chunk, ref))) {
            return api2Refused("unobserved-item", "the floor item is not currently seen");
          }
          if (ref.from === "store" && state.chunk.feat(state.actor.grid) !== state.stores?.[ref.store]?.feat) {
            return api2Refused("unobserved-item", "the store item is not currently seen");
          }
        }
        const simulation = createAgentView(state, undefined, viewDeps(state), { has: granted }).simulateLoadout?.(structuredClone(change));
        return simulation ? api2Ok(data(knownLoadoutSimulation(state, simulation, ctx.character?.key() ?? null)) as import("@rpgm-tools/neo-angband-mod-sdk").LoadoutSimulation) : api2Unavailable("the game has no loadout calculation");
      }),
      isCurrent: (token) => withState((state) => api2Ok(tokenIsCurrent(state, token))),
    }),

    act: frozen({
      submit: (token, intent) => guarded(() => {
        if (stopped) return api2Unavailable("this mod has stopped");
        if (!granted("input:intent")) return api2NotGranted("input:intent");
        const gate = options.intent ?? ctx.intent;
        if (!gate) return api2Unavailable("this front end takes no commands from mods");
        const copy = structuredClone(intent) as PlayerIntent;
        if (publicMod && (!inputAllowed() || !gameplayIntent(copy))) return api2Refused("gameplay", MOD_PERMISSION_TEXT.gameplay);
        if (publicMod) actionBudget = copy.kind === "command" || copy.kind === "travel" ? 0 : actionBudget - 1;
        /* A monster target names the monster by its KnownMonster id. One the
         * player does not perceive now becomes 0, which the game refuses the
         * same way it refuses a monster it cannot target. */
        const sent: PlayerIntent = copy.kind === "target" && "midx" in copy
          ? { ...copy, midx: (ctx.state ? knownMonsterMidx(ctx.state, copy.midx) : null) ?? 0 }
          : copy;
        const result = gate.submit(structuredClone(token), sent);
        return result.accepted
          ? api2Ok(null)
          : api2Refused(result.code ?? "rejected", result.reason ?? "the game refused it");
      }),
      answer: (promptId, answer) => guarded(() => {
        if (!granted("input:prompt.reply")) return api2NotGranted("input:prompt.reply");
        if (publicMod && (!inputAllowed() || ctx.snapshot?.()?.phase !== "store")) return api2Refused("gameplay", MOD_PERMISSION_TEXT.gameplay);
        if (!ctx.prompt) return api2Unavailable("this front end takes no prompt answers from mods");
        const result = ctx.prompt.reply(promptId, structuredClone(answer) as PromptAnswer);
        return result.accepted
          ? api2Ok(null)
          : api2Refused(result.code ?? "rejected", result.reason ?? "the game refused the answer");
      }),
      controller: frozen({
        owns: () => guarded(() => api2Ok(ctx.controller !== undefined)),
        setStatus: (status) => guarded(() => {
          const c = ctx.controller;
          if (!c) return api2Refused("not-owner", "this mod does not hold the keyboard");
          c.setStatus(structuredClone(status));
          return api2Ok(null);
        }),
        markNondeterministic: () => guarded(() => {
          const c = ctx.controller;
          if (!c) return api2Refused("not-owner", "this mod does not hold the keyboard");
          c.markNondeterministic();
          return api2Ok(null);
        }),
        release: (reason?: string) => guarded(() => {
          const c = ctx.controller;
          if (!c) return api2Refused("not-owner", "this mod does not hold the keyboard");
          c.release(reason);
          return api2Ok(null);
        }),
      }),
    }),

    events: frozen({
      on: (name, listener) => guarded(() => {
        if (stopped) return api2Unavailable("this mod has stopped");
        if (!(API2_EVENT_NAMES as readonly string[]).includes(name)) {
          return api2Refused("unknown-event", `API 2 has no event "${String(name)}"`);
        }
        const capability = `event:${name}`;
        if (!granted(capability)) return api2NotGranted(capability);
        if (name === "run-end") {
          if (!ctx.character?.onRunEnd) return api2Unavailable("this front end has no run-end reports");
          const id = `${ctx.id}:${nextSubscription++}`;
          const unsubscribe = ctx.character.onRunEnd((report) => listener(data({ key: report.key,
            report: options.tier === "first-party" ? report : null }) as Api2EventMap[typeof name]));
          runSubscriptions.set(id, unsubscribe);
          return api2Ok(frozen({ id }));
        }
        if (!ctx.events) return api2Unavailable(NO_GAME);
        const type = name as GameEventType;
        const handler = (_type: GameEventType, raw: unknown): void => {
          const payload = api2EventPayload(name, raw as never);
          if (!stopped && payload !== undefined) listener(payload as Parameters<typeof listener>[0]);
        };
        ctx.events.on(type, handler as never);
        const id = `${ctx.id}:${nextSubscription++}`;
        subscriptions.set(id, { type, handler });
        return api2Ok(frozen({ id }));
      }),
      off: (subscription) => guarded(() => {
        runSubscriptions.get(subscription.id)?.();
        runSubscriptions.delete(subscription.id);
        const entry = subscriptions.get(subscription.id);
        if (entry) {
          ctx.events?.off(entry.type, entry.handler as never);
          subscriptions.delete(subscription.id);
        }
        return api2Ok(null);
      }),
    }),

    hooks: frozen({
      available: API2_HOOK_NAMES,
      active: Object.freeze([...(options.activeHooks ?? [])]),
    }),

    content: frozen({
      boundRecords: (file: string) => guarded(() => {
        const reg = ctx.registries ?? modRegistries();
        const list = records(file);
        if (!list.ok) return list;
        if (file !== "monster" && file !== "object") return api2Ok(data(list.value.map((record, index) => {
          const from = provenanceOf(record);
          const name = record["name"];
          const label = typeof name === "string" ? name : name && typeof name === "object" && !Array.isArray(name) && typeof name["name"] === "string" ? name["name"] : "";
          return { ...record, key: (file === "option" ? label : recordKey(file, record)) ?? label, index, name: label,
            owner: from?.owner ?? "core", ...(from ? { from } : {}),
          } as Api2BoundRecord;
        })));
        if (!reg) return api2Unavailable("the game's content has not been bound yet");
        const bound = file === "monster" ? reg.monsters.races : file === "object" ? reg.objects.kinds : null;
        if (!bound) return api2Unavailable("the game's content has not been bound yet");
        const result: Api2BoundRecord[] = bound.filter((record) => record !== null).map((record) => {
          const index = "ridx" in record ? record.ridx : record.kidx;
          const raw = list.value.find((value) => {
            const name = value["name"];
            return name === record.name || (name && typeof name === "object" && !Array.isArray(name) && name["name"] === record.name);
          });
          return { key: (raw ? recordKey(file, raw) : null) ?? record.name, index, name: record.name,
            ...("ridx" in record ? { base: record.base?.name ?? "" } : { tval: record.tval }),
            owner: record.from?.owner ?? "core",
            ...(record.from ? { from: record.from as NonNullable<Api2BoundRecord["from"]> } : {}),
            ...(record.ext ? { ext: record.ext as Readonly<Record<string, JsonValue>> } : {}),
          };
        });
        return api2Ok(data(result));
      }),
      activations: () => guarded(() => {
        const reg = ctx.registries ?? modRegistries();
        return reg ? api2Ok(data(reg.objects.activations.filter((a) => a !== null).map((a) => ({ ...a, effect: a.effect as unknown as JsonValue })))) : api2Unavailable("the game's content has not been bound yet");
      }),
      activation: (ref) => guarded(() => {
        const reg = ctx.registries ?? modRegistries();
        if (!reg) return api2Unavailable("the game's content has not been bound yet");
        const entry = "tval" in ref ? reg.objects.lookupKind(ref.tval, ref.sval) : "ego" in ref
          ? reg.objects.egos.find((e) => e?.name === ref.ego) : reg.objects.artifacts.find((a) => a?.name === ref.artifact);
        const activation = entry?.activation;
        return api2Ok(activation ? data({ ...activation, effect: activation.effect as unknown as JsonValue } satisfies Api2Activation) : null);
      }),
      colors: () => guarded(() => api2Ok(data(colorTableSnapshot().map((_color, index) => ({ index, id: colorPrefId(index), css: colorToCss(index) }))))),
      own: () => guarded(() => api2Ok(data({ ...ctx.data } as Record<string, JsonValue>))),
      asset: (path: string) => guarded(async () => {
        const url = await ctx.assetUrl(path);
        return url === null ? api2Refused("not-found", `this mod has no file "${path}" this front end can serve`) : api2Ok(url);
      }),
      records: (file: string) => guarded(() => records(file)),
      lookup: (ref) => guarded(() => {
        const list = records(ref.file);
        if (!list.ok) return list;
        const found = list.value.find((record) => (ref.file === "option" ? record["name"] : recordKey(ref.file, record)) === ref.key);
        return found
          ? api2Ok(found)
          : api2Refused("unknown-record", `the game's "${ref.file}" content has no record "${ref.key}"`);
      }),
    }),

    ui: frozen({
      onKey: (listener) => guarded(() => {
        if (stopped) return api2Unavailable("this mod has stopped");
        const observe = publicMod || options.execution === "worker";
        if (!granted(observe ? "input:observe" : "keymap:write")) return api2NotGranted(observe ? "input:observe" : "keymap:write");
        if (!ctx.display) return api2Unavailable("this front end sends no key events");
        const id = `${ctx.id}:key:${nextSubscription++}`;
        const off = ctx.display.onKey((event) => {
          if (observe && (!granted("input:observe") || !api2MayObserveKeys(ctx) || event.ctrlKey || event.altKey || event.metaKey || event.key === "Escape" ||
            (options.execution === "worker" && ["F5", "F11", "F12"].includes(event.key)))) return;
          if (!stopped) listener(data({ key: event.key, code: event.code, modifiers: [
            ...(event.shiftKey ? ["shift" as const] : []), ...(event.ctrlKey ? ["ctrl" as const] : []),
            ...(event.altKey ? ["alt" as const] : []), ...(event.metaKey ? ["meta" as const] : []),
          ], isRepeat: event.repeat }));
        });
        keySubscriptions.set(id, off);
        return api2Ok(frozen({ id }));
      }),
      offKey: (subscription) => guarded(() => {
        keySubscriptions.get(subscription.id)?.();
        keySubscriptions.delete(subscription.id);
        return api2Ok(null);
      }),
      ...(title ? { title } : {}),
      ...(presentationHeld("ui:region.create") || presentationHeld("ui:screen.replace") || presentationHeld("screens:manage") ? {
        overlay: (spec: import("@rpgm-tools/neo-angband-mod-sdk").Api2PanelSpec = { id: "overlay", modal: true }) => openPage(spec),
        mountPage: async (kind: string, mount: (root: ShadowRoot) => void, pageOptions?: Omit<import("@rpgm-tools/neo-angband-mod-sdk").Api2PanelSpec, "id">) => {
          const opened = await openPage({ id: kind, ...pageOptions });
          if (!opened.ok) return opened;
          try { mount(opened.value.root); }
          catch (error) {
            opened.value.close();
            return api2Refused("bad-page", error instanceof Error ? error.message : String(error));
          }
          return opened;
        },
      } : {}),
      commands: frozen({
        register: (id, verb, run, commandOptions) => guarded(() => {
          if (!granted("registry:command") && !granted("command:add")) return api2NotGranted("command:add");
          if (!id.startsWith(`${ctx.id}:`) || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(id) || !verb.trim() || typeof run !== "function") {
            return api2Refused("bad-command", "a command needs an owned id, a verb and a handler");
          }
          if (publicMod && ownedCommands.size >= 64) return api2Refused("quota", MOD_PERMISSION_TEXT.quota);
          const commands = options.commands ?? commandHost;
          if (!commands) return api2Unavailable("this front end installs no mod commands");
          if (commands.registry.has(id)) return api2Refused("command-taken", `command "${id}" is already registered`);
          const direction = commandOptions?.direction === true;
          const turn = commandOptions?.turn === true;
          const invoke = (dir?: number): number => {
            if (publicMod) { actionBudget = 8; actionUntil = Date.now() + 1000; }
            try {
              const result = run(dir === undefined ? {} : { dir });
              if (result instanceof Promise) {
                void result.catch((error: unknown) => ctx.log(`command failed: ${String(error)}`));
                return 0;
              }
              const energy = turn && result && typeof result === "object" ? (result as { energy?: unknown }).energy : undefined;
              return typeof energy === "number" && Number.isFinite(energy) ? Math.min(1000, Math.max(0, Math.trunc(energy))) : 0;
            } catch (error) {
              ctx.log(`command failed: ${String(error)}`);
              return 0;
            }
          };
          const entry: KeymapCommand = { direction, turn, invoke };
          keymapCommands.set(id, entry);
          ownedCommands.add(id);
          commands.registry.register(id, (_state, cmd) => invoke(cmd?.dir));
          commands.verbs?.set(id, verb);
          cleanups.add(() => {
            commands.registry.unregister(id);
            if (keymapCommands.get(id) === entry) keymapCommands.delete(id);
          });
          return api2Ok(null);
        }),
      }),
      gameMenu: frozen({
        register: (action, label, run) => guarded(() => {
          if (!granted("ui:menu.row") && !granted("registry:menu")) return api2NotGranted("ui:menu.row");
          if (!/^[a-z][a-z0-9-]{0,63}$/.test(action) || !label.trim() || /[\r\n]/.test(label) || typeof run !== "function") {
            return api2Refused("bad-action", "a menu action needs an id, a label and a handler");
          }
          if (publicMod && (ownedMenuActions.size >= 16 || ownedMenuActions.has(action) || label.length > 120)) return api2Refused("quota", MOD_PERMISSION_TEXT.quota);
          ownedMenuActions.add(action);
          menuRegistry.addAction("core:game-menu", action, label, playerAction(run), ctx.id);
          cleanups.add(() => menuRegistry.removeAction("core:game-menu", action, ctx.id));
          return api2Ok(null);
        }),
      }),
      mount: (panel: Api2Panel, onAction?: (action: string, value?: string | boolean) => void, onDismiss?: () => void) => guarded(() => {
        if (stopped) return api2Unavailable("this mod has stopped");
        if (!granted("ui:panel.mount")) return api2NotGranted("ui:panel.mount");
        const draw = renderer();
        if (!draw) return api2Unavailable("this front end draws no panels");
        try {
          draw.apply(ctx.id, "mount", structuredClone(panel) as unknown as WorkerJson, undefined, (_panelId, action, value) => { if (!stopped && onAction) playerAction(onAction)(action, value); }, onDismiss);
          cleanups.add(() => draw.teardown(ctx.id));
        } catch (e) {
          return api2Refused("bad-panel", e instanceof Error ? e.message : String(e));
        }
        return api2Ok(frozen({ panelId: panel.id }));
      }),
      unmount: (panelId) => guarded(() => {
        if (!granted("ui:panel.mount")) return api2NotGranted("ui:panel.mount");
        const draw = renderer();
        if (!draw) return api2Unavailable("this front end draws no panels");
        try { draw.apply(ctx.id, "unmount", null, panelId); }
        catch (error) { return api2Refused("bad-panel", error instanceof Error ? error.message : String(error)); }
        return api2Ok(null);
      }),
      patch: (panelId: string, patch: Api2PanelPatch) => guarded(() => {
        if (!granted("ui:panel.mount")) return api2NotGranted("ui:panel.mount");
        const draw = renderer();
        if (!draw) return api2Unavailable("this front end draws no panels");
        try {
          draw.apply(ctx.id, "patch", structuredClone(patch) as unknown as WorkerJson, panelId);
        } catch (e) {
          return api2Refused("bad-panel", e instanceof Error ? e.message : String(e));
        }
        return api2Ok(frozen({ panelId }));
      }),
      keys: frozen({
        isBindableTriggerKey: (trigger) => guarded(() => {
          if (!granted("keymap:write")) return api2NotGranted("keymap:write");
          return ctx.keymaps ? api2Ok(ctx.keymaps.isBindableTriggerKey(trigger)) : api2Unavailable(NO_GAME);
        }),
        bind: (trigger: string, action: string) => guarded(() => {
          if (stopped) return api2Unavailable("this mod has stopped");
          if (!granted("keymap:write")) return api2NotGranted("keymap:write");
          if (!ctx.keymaps) return api2Unavailable(NO_GAME);
          if (publicMod && (ownedKeys.size >= 64 || !action.startsWith(ctx.id + ":") || !keymapCommands.has(action))) return api2Refused("gameplay", MOD_PERMISSION_TEXT.gameplay);
          const bound = ctx.keymaps.bind(trigger, action);
          if (bound) ownedKeys.add(trigger);
          return bound
            ? api2Ok(null)
            : api2Refused("trigger-taken", `"${trigger}" is not a free key in this keyset`);
        }),
        list: () => guarded(() => {
          if (!granted("keymap:write")) return api2NotGranted("keymap:write");
          if (!ctx.keymaps) return api2Unavailable(NO_GAME);
          return api2Ok(data(ctx.keymaps.entries()));
        }),
        remove: (trigger: string) => guarded(() => {
          if (!granted("keymap:write")) return api2NotGranted("keymap:write");
          if (!ctx.keymaps) return api2Unavailable(NO_GAME);
          return ctx.keymaps.remove(trigger)
            ? api2Ok(null)
            : api2Refused("not-owned", `this mod owns no binding on "${trigger}"`);
        }),
      }),
    }),

    store: frozen({ prefs: Object.freeze(prefs), install: Object.freeze(install), character: Object.freeze(character),
      kv: modKeyValueStore(ctx.id, "kv", () => granted("store:kv"), options.kvStorage),
      session: modKeyValueStore(ctx.id, "session", () => granted("store:session"), options.sessionStorage),
    }),

    ...(ctx.net ? { net: netDomain(ctx.net) } : {}),
    ...(backupFolder ? { backupFolder } : {}),
    ...(options.tier === "first-party" && options.execution !== "worker" && options.execution !== "data" && seams?.manage ? { manage: manageDomain(ctx, options, cleanups, () => stopped) } : {}),
    ...(seams?.truth || (options.execution === "worker" && (granted("state:map-actual.read") || granted("state:monsters-actual.read")))
      ? { truth: truthDomain(ctx, options.viewDeps ?? {}, (capability) => !stopped && granted(capability) && (options.execution !== "worker" || modHolds(ctx.id, capability))) } : {}),
    ...(options.tier === "first-party" && options.execution !== "worker" && options.execution !== "data" && truthConsentAsk
      ? { permissions: permissionsDomain(ctx, options, granted, truthConsentAsk, () => stopped) } : {}),
    ...(presentation ? {
      presentation: frozen({
        cancelInput: (escapeCount: number = 3) => guarded(() => {
          if (!presentationHeld("keymap:edit")) return api2NotGranted("keymap:edit");
          if (modPanelsSuspended()) return api2Refused("input", "the host is asking for permission");
          if (!Number.isSafeInteger(escapeCount) || escapeCount < 1 || escapeCount > 32) return api2Refused("bad-count", "cancellation needs an escape count from 1 to 32");
          clearQueuedUiInputs();
          enqueueUiInputs(Array.from({ length: escapeCount }, () => ({
            key: { key: "Escape", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false },
          })));
          return api2Ok(null);
        }),
        ...(ctx.keyRepeat && presentationHeld("keymap:edit") ? { keyRepeat: () => {
          requirePresentation("keymap:edit");
          return ctx.keyRepeat!();
        } } : {}),
        ...(title ? { title } : {}),
        phase: bootPhase,
        onPhaseChanged: (listener: (phase: import("@rpgm-tools/neo-angband-mod-sdk").Api2BootPhase) => void) => {
          const off = onBootPhaseChanged((phase) => {
            if (!presentationCapabilities.some(presentationHeld)) return;
            try { listener(phase); }
            catch (error) { ctx.log(`phase listener failed: ${String(error)}`); }
          });
          cleanups.add(off);
          return () => { off(); cleanups.delete(off); };
        },
        ...(ctx.display && presentationHeld("display:replace") ? { display: presentationFacade({
          ...ctx.display,
          onKey: (listener: (event: KeyboardEvent) => void) => {
            requirePresentation("keymap:edit");
            const off = ctx.display!.onKey((event) => {
              if (presentationHeld("display:replace") && presentationHeld("keymap:edit") && !modPanelsSuspended()) listener(event);
            });
            cleanups.add(off);
            return () => { off(); cleanups.delete(off); };
          },
          ...(ctx.display.onFrame ? { onFrame: (listener: () => void) => {
            const off = ctx.display!.onFrame!(() => { if (presentationHeld("display:replace")) listener(); });
            cleanups.add(off);
            return () => { off(); cleanups.delete(off); };
          } } : {}),
        }, "display:replace") } : {}),
        ...(ctx.subwindows && presentationHeld("ui:region.create") ? { subwindows: presentationFacade(ctx.subwindows, "ui:region.create") } : {}),
        ...(ctx.tiles && presentationHeld("display:replace") ? { tiles: presentationFacade(ctx.tiles, "display:replace") } : {}),
        ...(ctx.ui && presentationHeld("ui:region.create") ? { panels: presentationFacade(ctx.ui, "ui:region.create") } : {}),
        ...(presentationHeld("ui:sidebar.replace") && typeof document !== "undefined" && document.getElementById("game-view") ? {
          sidebarHost: document.getElementById("game-view")!,
        } : {}),
      }),
    } : {}),
  };
  if (options.execution === "worker") workerManagementCalls.set(api, workerManageDomain(ctx, options, () => stopped));
  if (options.execution === "worker") spawnSharedWorkerCalls.set(api, spawnSharedWorkerDomain(ctx, options, () => stopped));
  if (options.execution === "worker") {
    const simple: SimpleWorkerHost = { ctx, held: (capability) => !stopped && granted(capability), capturing: false, filter: null,
      ...(ctx.state ? { keys: createModKeybindings(ctx.state, { worker: true }) } : {}) };
    simpleWorkerHosts.set(api, simple);
    const off = onModPanelSuspension((suspended) => {
      if (simple.filter !== null) ctx.display?.setVisualFilter(suspended || !simple.held("display:filter") ? null : simple.filter, { scope: "canvas" });
    });
    cleanups.add(() => { off(); if (simple.filter !== null) ctx.display?.setVisualFilter(null); });
    cleanups.add(() => { simple.text?.teardown(); });
    cleanups.add(() => { ctx.keybindings?.cancelCapture(); });
    cleanups.add(() => { simple.keys?.cancelCapture(); });
  }
  disposers.set(api, () => {
    stopped = true;
    panels?.teardown(ctx.id);
    for (const { type, handler } of subscriptions.values()) ctx.events?.off(type, handler as never);
    subscriptions.clear();
    for (const off of keySubscriptions.values()) off();
    keySubscriptions.clear();
    for (const trigger of ownedKeys) ctx.keymaps?.remove(trigger);
    ownedKeys.clear();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  });
  return Object.freeze(api);
}

interface SimpleWorkerHost {
  readonly ctx: ModPluginContext;
  readonly held: (capability: string) => boolean;
  capturing: boolean;
  filter: string | null;
  text?: ReturnType<typeof createModWorkerTextRenderer>;
  keys?: ReturnType<typeof createModKeybindings>;
}

const simpleWorkerHosts = new WeakMap<ModApi2, SimpleWorkerHost>();

/** The broker supplies liveness; this table supplies the connection's context. */
export function serveSimpleWorkerCall(api: ModApi2, method: string, args: readonly WorkerJson[], current: () => boolean): Api2Call<unknown> {
  return guarded<unknown>(async () => {
    const host = simpleWorkerHosts.get(api);
    if (!host || !current()) return api2Unavailable("this Worker call has expired");
    if (method === "options.set") {
      if (!host.held("options:write")) return api2NotGranted("options:write");
      if (args.length !== 1 || !plainRecord(args[0])) return api2Refused("bad-call", "options.set takes one options change");
      const change = args[0];
      if (Object.keys(change).some((key) => !["values", "hitpointWarn", "delayFactor", "lazymoveDelay"].includes(key)) ||
        (change["values"] !== undefined && !plainRecord(change["values"]))) return api2Refused("bad-call", "the options change has unknown fields or invalid values");
      const { ctx } = host;
      if (!ctx.state) return api2Unavailable(NO_GAME);
      const entries = change["values"] ?? {};
      if (Object.keys(entries).length > 128) return api2Refused("quota", MOD_PERMISSION_TEXT.quota);
      for (const [name, value] of Object.entries(entries)) {
        if (typeof value !== "boolean" || OPTION_ENTRIES.find((entry) => entry.name === name)?.type !== "INTERFACE") {
          return api2Refused("options", "this permission changes only interface options and delays");
        }
      }
      const editor = ctx.options?.set ? ctx.options : createModOptions(ctx.state, { writable: true });
      const result = editor.set!(change as import("./mod-options").ModOptionsChange);
      return result.ok ? api2Ok(data(result.changed)) : api2Refused("options", result.reason);
    }
    if (method.startsWith("keybindings.")) {
      if (!host.held("keymap:edit")) return api2NotGranted("keymap:edit");
      if (modPresentationSuspended()) return api2Refused("input", "the host is asking the player a question");
      const keys = host.keys;
      if (!keys) return api2Unavailable("the keybinding editor is unavailable");
      const operation = method.slice("keybindings.".length);
      if (operation === "set") {
        const [trigger, action, replace] = args;
        if (args.length < 2 || args.length > 3 || typeof trigger !== "string" || !isWorkerBindingKey(trigger) ||
          typeof action !== "string" || action.length < 1 || action.length > 256 ||
          (replace !== undefined && typeof replace !== "boolean")) return api2Refused("bad-call", "a binding needs a permitted key, a bounded action, and an optional replacement flag");
        const previous = keys.list().find((entry) => entry.trigger === trigger);
        if (previous && previous.action !== action && replace !== true) return api2Refused("key-conflict", "the key already has a binding");
        return keys.set(trigger, action) ? api2Ok(null) : api2Refused("keymap", "the binding is invalid");
      }
      if (operation === "remove") {
        const trigger = args[0];
        if (args.length !== 1 || typeof trigger !== "string" || !isWorkerBindingKey(trigger)) return api2Refused("bad-call", "remove takes one permitted trigger key");
        return api2Ok(keys.remove(trigger));
      }
      if (args.length !== 0) return api2Refused("bad-call", "this operation takes no arguments");
      if (operation === "keyset") return api2Ok(keys.keyset());
      if (operation === "list") return api2Ok(data(keys.list()));
      if (operation === "commands") return api2Ok(data(keys.commands()));
      if (operation === "cancelCapture") return api2Ok(keys.cancelCapture());
      if (operation === "capture") {
        if (host.capturing) return api2Refused("busy", "this mod is already capturing a key");
        host.capturing = true;
        const timer = setTimeout(() => keys.cancelCapture(), 10000);
        try {
          const key = await keys.capture();
          if (!current() || !host.held("keymap:edit")) return api2NotGranted("keymap:edit");
          return api2Ok(key !== null && isWorkerBindingKey(key) ? key : null);
        } finally {
          clearTimeout(timer);
          host.capturing = false;
        }
      }
    }
    if (method === "display.filter") {
      if (!host.held("display:filter")) return api2NotGranted("display:filter");
      if (args.length !== 1) return api2Refused("bad-call", "display.filter takes one filter choice or null");
      let filter: string | null;
      try { filter = workerVisualFilter(args[0]); }
      catch (error) { return api2Refused("bad-filter", error instanceof Error ? error.message : String(error)); }
      if (!host.ctx.display) return api2Unavailable("this front end has no display");
      if (modPresentationSuspended()) return api2Refused("input", "the host is asking the player a question");
      host.ctx.display.setVisualFilter(filter, { scope: "canvas" });
      host.filter = filter;
      return api2Ok(null);
    }
    if (["ui.messages.replace", "ui.sidebar.replace", "ui.status.replace", "ui.region.create", "ui.region.remove"].includes(method)) {
      const name = method.split(".")[1]!;
      const capability = name === "region" ? "ui:region.create" : `ui:${name}.replace`;
      if (!host.held(capability)) return api2NotGranted(capability);
      if (args.length !== 1) return api2Refused("bad-call", "text output takes one data value");
      if (modPresentationSuspended()) return api2Refused("input", "the host is asking the player a question");
      if (!host.ctx.display || typeof document === "undefined") return api2Unavailable("this front end draws no text regions");
      if (method === "ui.region.remove" && (typeof args[0] !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(args[0]))) return api2Refused("bad-call", "remove takes one owned region id");
      host.text ??= createModWorkerTextRenderer(host.ctx.display, host.held);
      try {
        if (method === "ui.region.create") host.text.create(args[0]!);
        else if (method === "ui.region.remove") host.text.remove(args[0] as string);
        else host.text.replace(name as "messages" | "sidebar" | "status", args[0]!);
      } catch (error) { return api2Refused("bad-region", error instanceof Error ? error.message : String(error)); }
      return api2Ok(null);
    }
    return api2Refused("bad-call", "this simple Worker method is unavailable");
  });
}

function plainRecord(value: unknown): value is Record<string, WorkerJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function netDomain(net: NonNullable<ModPluginContext["net"]>): NonNullable<ModApi2["net"]> {
  const secrets = net.secrets;
  return frozen({
    request: (request: Api2NetRequest) => guarded(async () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        headers[name] = typeof value === "string" ? value : `${value.prefix ?? ""}{secret:${value.credential}}`;
      }
      const response = await net.request({
        url: request.url,
        ...(request.method !== undefined ? { method: request.method } : {}),
        headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      });
      if (response.ok) return api2Ok(data({ status: response.status, headers: response.headers, body: response.body }));
      if (response.code === "not-declared") {
        let host = request.url;
        try {
          host = new URL(request.url).host;
        } catch {
          /* The problem text names it either way. */
        }
        return api2NotGranted(`network:${host}`);
      }
      return api2Refused(response.code, response.problem);
    }),
    credential: (name: string, prefix?: string) => frozen({ credential: name, ...(prefix !== undefined ? { prefix } : {}) }),
    credentials: frozen({
      status: (name: string) => guarded(async () => api2Ok(data(await secrets.has(name)))),
      set: (name: string, value: string, hosts: readonly string[]) => guarded(async () => {
        const r = await secrets.set(name, value, { hosts: [...hosts] });
        return r.ok ? api2Ok(frozen({ storage: r.storage })) : api2Refused("credential", r.problem);
      }),
      fromEnvironment: (name: string, variables: readonly string[], hosts: readonly string[]) => guarded(async () => {
        const r = await secrets.fromEnv(name, [...variables], { hosts: [...hosts] });
        return r.ok ? api2Ok(frozen({ storage: r.storage })) : api2Refused("credential", r.problem);
      }),
      remove: (name: string) => guarded(async () => {
        const r = await secrets.delete(name);
        return r.ok ? api2Ok(null) : api2Refused("credential", `no credential "${name}" was removed`);
      }),
    }),
  });
}

function manageDomain(ctx: ModPluginContext, options: Api2HostOptions, cleanups: Set<() => void>, stopped: () => boolean): Api2Manage {
  cleanups.add(() => { ctx.keybindings?.cancelCapture(); });
  const profiles = (): NonNullable<ModPluginContext["profiles"]> | null => options.grants.has("profiles:manage") ? ctx.profiles ?? null : null;
  const session = (): NonNullable<ModPluginContext["session"]> | null => options.grants.has("session:control") ? ctx.session ?? null : null;
  const saved = (r: { readonly ok: boolean; readonly reason?: string }): Api2Result<null> =>
    r.ok ? api2Ok(null) : api2Refused("save", r.reason ?? "the game could not save");
  return frozen({
    profiles: frozen({
      list: () => guarded(() => {
        const p = profiles();
        if (!p) return api2NotGranted("profiles:manage");
        const r = p.list();
        return r.ok ? api2Ok(data(r.value)) : api2Refused("profiles", r.reason);
      }),
      create: (name: string, copyFrom?: string | null) => guarded(() => {
        const p = profiles();
        if (!p) return api2NotGranted("profiles:manage");
        const r = p.create(name, copyFrom === undefined ? undefined : { copyFrom });
        return r.ok ? api2Ok(data(r.value)) : api2Refused("profiles", r.reason);
      }),
      setEnabledMods: (id: string, mods: readonly string[]) => guarded(() => {
        const p = profiles();
        if (!p) return api2NotGranted("profiles:manage");
        const r = p.setEnabledMods(id, [...mods]);
        return r.ok ? api2Ok(null) : api2Refused("profiles", r.reason);
      }),
      switchTo: (id: string | null, action) => guarded(() => {
        const p = profiles();
        if (!p) return api2NotGranted("profiles:manage");
        const r = p.switchTo(id, action);
        return r.ok ? api2Ok(null) : api2Refused("profiles", r.reason);
      }),
    }),
    saves: frozen({
      list: () => guarded(async () => {
        if (!options.grants.has("saves:manage")) return api2NotGranted("saves:manage");
        if (!ctx.saves) return api2Unavailable("The character roster is unavailable.");
        const result = await ctx.saves.list();
        return result.ok ? api2Ok(data(result.entries)) : api2Refused("save", result.reason);
      }),
      create: (request) => guarded(async () => {
        if (!options.grants.has("saves:manage")) return api2NotGranted("saves:manage");
        return ctx.saves?.create ? saved(await ctx.saves.create(request)) : api2Unavailable("Character creation is unavailable.");
      }),
      load: (id, request) => guarded(async () => {
        if (!options.grants.has("saves:manage")) return api2NotGranted("saves:manage");
        if (!ctx.saves) return api2Unavailable("The character roster is unavailable.");
        return saved(await ctx.saves.load(id, request));
      }),
      rename: (id, name) => saveCommand("rename", id, name),
      delete: (id) => saveCommand("delete", id),
    }),
    options: frozen({
      get: () => guarded(() => {
        if (!options.grants.has("state:options.read") && !options.grants.has("state:*.read") && !options.grants.has("options:manage")) return api2NotGranted("state:options.read");
        return ctx.options ? api2Ok(data(ctx.options.get())) : api2Unavailable("The options editor is unavailable.");
      }),
      set: (change) => guarded(() => {
        if (!options.grants.has("options:write") && !options.grants.has("options:manage")) return api2NotGranted("options:manage");
        if (!ctx.options?.set) return api2Unavailable("The options editor is unavailable.");
        const result = ctx.options.set(change);
        return result.ok ? api2Ok(data(result.changed)) : api2Refused("options", result.reason);
      }),
    }),
    keys: frozen({
      keyset: () => keyCommand((keys) => api2Ok(keys.keyset())),
      list: (keyset) => keyCommand((keys) => api2Ok(data(keys.list(keyset)))),
      commands: () => keyCommand((keys) => api2Ok(data(keys.commands()))),
      capture: () => keyCommand(async (keys) => api2Ok(await keys.capture())),
      cancelCapture: () => keyCommand((keys) => api2Ok(keys.cancelCapture())),
      set: (trigger, action, keyset, replace = false) => keyCommand((keys) => {
        const previous = keys.list(keyset).find((entry) => entry.trigger === trigger);
        if (previous && previous.action !== action && !replace) return api2Refused("key-conflict", "The key already has a binding.");
        return keys.set(trigger, action, keyset) ? api2Ok(null) : api2Refused("keymap", "The key binding is invalid.");
      }),
      remove: (trigger, keyset) => keyCommand((keys) => keys.remove(trigger, keyset) ? api2Ok(null) : api2Refused("keymap", "The key has no binding.")),
    }),
    look: frozen({
      read: () => guarded(() => {
        if (!options.grants.has("screens:manage")) return api2NotGranted("screens:manage");
        return ctx.look ? api2Ok(data(ctx.look.read())) : api2Unavailable("The look is unavailable.");
      }),
      choose: (look) => guarded(() => {
        if (!options.grants.has("screens:manage")) return api2NotGranted("screens:manage");
        if (!ctx.look) return api2Unavailable("The look is unavailable.");
        if (look !== "Vanilla" && look !== "Neo") return api2Refused("look", "The look must be Vanilla or Neo.");
        return api2Ok(data(ctx.look.choose(look)));
      }),
    }),
    screens: frozen({
      take: (handlers) => guarded(() => {
        if (!options.grants.has("screens:manage")) return api2NotGranted("screens:manage");
        if (stopped()) return api2Unavailable("this mod has stopped");
        const named = Object.keys(handlers ?? {}).filter((key) => typeof (handlers as Record<string, unknown>)[key] === "function");
        if (named.length === 0) return api2Refused("no-screens", "name at least one screen to draw");
        const unknown = named.find((key) => !isScreenKey(key));
        if (unknown !== undefined) return api2Refused("unknown-screen", `the game has no screen named ${unknown} to take`);
        const held = screenHeldByOther(ctx.id, named as Api2ScreenKey[]);
        if (held !== null) return api2Refused("taken", `another mod already draws the ${held} screen`);
        cleanups.add(takeScreens(ctx.id, handlers));
        return api2Ok(null);
      }),
    }),
    mods: managedMods(ctx.id, options, cleanups, stopped),
    authoring: () => guarded(() => options.grants.has("mod:authoring") ? api2Ok(ctx.authoring) : api2NotGranted("mod:authoring")),
    wizard: () => guarded(() => options.grants.has("debug:wizard")
      ? ctx.wizard ? api2Ok(ctx.wizard) : api2Unavailable("The wizard test session is unavailable.")
      : api2NotGranted("debug:wizard")),
    loadForSession: (bytes) => guarded(async () => {
      if (!options.grants.has("mod:session")) return api2NotGranted("mod:session");
      if (!ctx.loadModForSession) return api2Unavailable("Session mod loading is unavailable.");
      const result = await ctx.loadModForSession(bytes);
      return result.ok ? api2Ok(data({ id: result.id, version: result.version, survivesReload: result.survivesReload })) : api2Refused("session-mod", result.problem);
    }),
    reloadGame: () => guarded(async () => {
      if (!options.grants.has("mod:session") && !options.grants.has("mod:install")) return api2NotGranted("mod:session");
      if (!ctx.reloadGame) return api2Unavailable("Game reload is unavailable.");
      await ctx.reloadGame();
      return api2Ok(null);
    }),
    session: frozen({
      save: () => guarded(() => {
        const s = session();
        return s ? saved(s.save()) : api2NotGranted("session:control");
      }),
      exitToTitle: () => guarded(async () => {
        const s = session();
        return s ? saved(await s.exitToTitle()) : api2NotGranted("session:control");
      }),
      quit: () => guarded(async () => {
        const s = session();
        return s ? saved(await s.quit()) : api2NotGranted("session:control");
      }),
    }),
  });

  function saveCommand(method: "rename" | "delete", id: string, name = ""): Api2Call<null> {
    return guarded(async () => {
      if (!options.grants.has("saves:manage")) return api2NotGranted("saves:manage");
      if (!ctx.saves) return api2Unavailable("The character roster is unavailable.");
      return saved(await (method === "rename" ? ctx.saves.rename(id, name) : ctx.saves[method](id)));
    });
  }

  function keyCommand<T>(run: (keys: NonNullable<ModPluginContext["keybindings"]>) => Api2Result<T> | Promise<Api2Result<T>>): Api2Call<T> {
    return guarded(() => {
      if (!options.grants.has("keymap:edit")) return api2NotGranted("keymap:edit");
      if (!ctx.keybindings) return api2Unavailable("The keymap editor is unavailable.");
      return run(ctx.keybindings);
    });
  }

  async function guarded<T>(body: () => Api2Result<T> | Promise<Api2Result<T>>): Api2Call<T> {
    if (stopped()) return api2Unavailable("The mod has stopped.");
    try { return await body(); }
    catch (error) {
      return error instanceof AgentCapabilityError ? api2Refused("capability", error.message)
        : api2Refused("management", "The management command failed.");
    }
  }
}

function managedMods(id: string, options: Api2HostOptions, cleanups: Set<() => void>, stopped: () => boolean): Api2ManagedMods {
  let manager: Promise<ManagerResult<ManageAdapter>> | undefined;
  const subscriptions = new Map<string, () => void>();
  let nextId = 0;
  cleanups.add(() => { for (const off of subscriptions.values()) off(); subscriptions.clear(); });
  const read = async <T>(run: (adapter: ManageAdapter) => Api2Result<T> | Promise<Api2Result<T>>): Api2Call<T> => {
    if (stopped()) return api2Unavailable("The mod has stopped.");
    if (!options.grants.has("mod:install")) return api2NotGranted("mod:install");
    const provider = options.management ?? managementHost;
    if (!provider) return api2Unavailable("The mod manager is unavailable.");
    try {
      manager ??= provider().then((service) => createManageAdapter(service, id));
      const result = await manager;
      if (stopped()) return api2Unavailable("The mod has stopped.");
      return result.status === "ok" ? await run(result.value) : api2Refused("first-party", "The mod cannot manage mods.");
    } catch { return api2Refused("management", "The mod manager command failed."); }
  };
  const result = <T>(reply: ManagerResult<T>): Api2Result<T> => reply.status === "ok" ? api2Ok(data(reply.value))
    : reply.status === "refused" ? api2Refused(reply.code, reply.reason) : api2Refused("confirmation", "The command is waiting for confirmation.");
  const command = (reply: ManagerResult<unknown>): Api2Result<Api2ManagerConfirmation | null> => reply.status === "confirmation" ? api2Ok(data(reply.confirmation))
    : reply.status === "ok" ? api2Ok(null) : api2Refused(reply.code, reply.reason);
  return frozen<Api2ManagedMods>({
    snapshot: () => read((adapter) => api2Ok(data(adapter.snapshot()))),
    subscribe: (listener) => read((adapter) => {
      const subscription = String(++nextId);
      subscriptions.set(subscription, adapter.subscribe((state) => { if (!stopped()) listener(data(state)); }));
      return api2Ok({ id: subscription });
    }),
    unsubscribe: (subscription) => guarded(() => { subscriptions.get(subscription.id)?.(); subscriptions.delete(subscription.id); return api2Ok(null); }),
    browse: () => read(async (adapter) => result(await adapter.browse())),
    search: (query) => read((adapter) => result(adapter.search(query))),
    discover: (ref) => read(async (adapter) => result(await adapter.discover(ref))),
    refresh: () => read(async (adapter) => result(await adapter.refresh())),
    planInstall: (refs) => read(async (adapter) => result(await adapter.planInstall(refs))),
    applyPlan: (planId) => read((adapter) => command(adapter.applyPlan(planId))),
    recordConsent: (modId, decisions) => read((adapter) => command(adapter.recordConsent(modId, decisions))),
    enable: (modId) => read((adapter) => command(adapter.enable(modId))),
    disable: (modId) => read((adapter) => command(adapter.disable(modId))),
    update: (modId) => read(async (adapter) => command(await adapter.update(modId))),
    updateAll: () => read(async (adapter) => command(await adapter.updateAll())),
    remove: (modId) => read(async (adapter) => command(await adapter.remove(modId))),
    rollback: (modId) => read(async (adapter) => command(await adapter.rollback(modId))),
    restoreModList: (entries, replace) => read((adapter) => command(adapter.restoreModList(entries, replace))),
    reorder: (ids) => read((adapter) => command(adapter.reorder(ids))),
    moveEnabled: (modId, delta) => read((adapter) => command(adapter.moveEnabled(modId, delta))),
    setConflictOverride: (slot, winner) => read((adapter) => command(adapter.setConflictOverride(slot, winner))),
    setSectionChoice: (modId, section, on) => read((adapter) => command(adapter.setSectionChoice(modId, section, on))),
    setSettingValue: (modId, setting, value) => read((adapter) => command(adapter.setSettingValue(modId, setting, value))),
    setThirdPartyConsent: (allow) => read((adapter) => command(adapter.setThirdPartyConsent(allow))),
  });
}

function permissionsDomain(ctx: ModPluginContext, options: Api2HostOptions, held: (capability: string) => boolean, ask: TruthConsentAsk, stopped: () => boolean): Api2Permissions {
  /* A yes to the question holds the real map from then on, though the capability set the mod started with does not name it. */
  let allowed = false;
  const granted = (capability: string): boolean => !stopped() && (held(capability) || (allowed && capability === "state:map-actual.read"));
  let truth: Api2Truth | undefined = options.firstParty?.truth ? truthDomain(ctx, options.viewDeps ?? {}, granted) : undefined;
  return frozen({
    truthHeld: () => truth !== undefined,
    requestTruth: async (reason: string): Api2Call<Api2Truth> => {
      if (stopped()) return api2Unavailable("this mod has stopped");
      if (truth) return api2Ok(truth);
      if (typeof reason !== "string" || reason.trim() === "") return api2Refused("bad-reason", "the question needs a reason to show the player");
      const answer = await ask(ctx.id, reason);
      if (stopped()) return api2Unavailable("this mod has stopped");
      if (answer === "unavailable") return api2Refused("unavailable", "this mod may not ask for the real map");
      if (answer === "declined") return api2Refused("declined", "the player did not allow it");
      allowed = true;
      truth = truthDomain(ctx, options.viewDeps ?? {}, granted);
      return api2Ok(truth);
    },
  });
}

function truthDomain(ctx: ModPluginContext, deps: AgentViewDeps, granted: (capability: string) => boolean): Api2Truth {
  /* A view without a capability set reads truth, so the durable mark must precede its construction even when the caller only wants one race. */
  const view = (state: GameState) => createAgentView(state, undefined, deps);
  /* Exact monsters and race records have a narrower permission of their own; the level and the shops need the real map. */
  const open = async (capability: "state:map-actual.read" | "state:monsters-actual.read"): Promise<boolean> => {
    if (!granted(capability)) return false;
    const state = ctx.state;
    return (!state || await prepareTruthRead(ctx.id, capability, state)) && state === ctx.state && granted(capability);
  };
  const mapOpen = () => open("state:map-actual.read");
  const monstersOpen = async () => await mapOpen() || await open("state:monsters-actual.read");
  return frozen({
    monsters: () => guarded(async () => {
      if (!await monstersOpen()) return api2NotGranted("state:monsters-actual.read");
      if (!ctx.state) return api2Unavailable(NO_GAME);
      return api2Ok(data(trueMonsterViews(ctx.state, deps).map((mon) => ({
        ...mon,
        perceived: monsterIsObvious(ctx.state!.monsters[mon.id]!),
      }))) as readonly Api2TrueMonster[]);
    }),
    race: (index: number) => guarded(async () => {
      if (!await monstersOpen()) return api2NotGranted("state:monsters-actual.read");
      if (!ctx.state) return api2Unavailable(NO_GAME);
      if (!ctx.registries) return api2Unavailable("there are no monster races yet");
      const race = ctx.registries.monsters.races.find((race) => race.ridx === index);
      if (!race) return api2Ok(null);
      return api2Ok(data({
        ridx: race.ridx,
        flags: [...race.flags].flatMap((flag) => MON_RACE_FLAG_ENTRIES[flag] ? [MON_RACE_FLAG_ENTRIES[flag]!.name] : []),
        spells: [...race.spellFlags].filter((flag) => flag >= RSF.MAX || !!MON_SPELL_ENTRIES[flag]).sort((a, b) => a - b),
        blows: race.blows.map((blow) => {
          const dice = blow.dice?.randomValue();
          return { dice: dice?.dice ?? 0, sides: dice?.sides ?? 0, effect: blow.effect.name };
        }),
        level: race.level,
        sleep: race.sleep,
        spellPower: race.spellPower,
        freqInnate: race.freqInnate,
        freqSpell: race.freqSpell,
        hasFriends: race.friends.length > 0 || race.friendsBase.length > 0,
      }));
    }),
    storeKnowledge: () => guarded(async () => {
      if (!await mapOpen()) return api2NotGranted("state:map-actual.read");
      if (!ctx.state) return api2Unavailable(NO_GAME);
      return api2Ok(data(storeKnowledge(ctx.state)));
    }),
    level: () => guarded(async () => {
      if (!await mapOpen()) return api2NotGranted("state:map-actual.read");
      if (!ctx.state) return api2Unavailable(NO_GAME);
      const level = view(ctx.state).knownLevel?.() ?? null;
      if (!level) return api2Unavailable("there is no level yet");
      const cells: Api2TrueCell[] = [];
      for (const cell of level.cells) {
        if (!cell.actual) continue;
        cells.push({ x: cell.x, y: cell.y, ...cell.actual });
      }
      const real: Api2TrueLevel = {
        token: level.token,
        levelId: level.levelId,
        depth: level.depth,
        width: level.width,
        height: level.height,
        cells,
      };
      return api2Ok(data(real));
    }),
  });
}

export interface WorkerManagementHost {
  confirm(id: string, plan: string): Promise<boolean>;
  pickSaves(id: string, entries: readonly import("./mod-plugin").SaveEntry[]): Promise<readonly string[] | null>;
  scope(): string;
  markCheat(id: string, state: GameState): boolean;
  saveOptions(): void;
}

let workerManagementHost: WorkerManagementHost | undefined;
let workerManagementBusy = false;
type WorkerManagementCall = (method: string, args: readonly WorkerJson[], current: () => boolean) => Promise<Api2Result<unknown>>;
const workerManagementCalls = new WeakMap<ModApi2, WorkerManagementCall>();

export function setApi2WorkerManagementHost(host: WorkerManagementHost | undefined): void {
  workerManagementHost = host;
}

export async function callWorkerManage(api: ModApi2, method: string, args: readonly WorkerJson[], current: () => boolean): Promise<Api2Result<unknown>> {
  return workerManagementCalls.get(api)?.(method, args, current) ?? api2Unavailable("Worker management is unavailable.");
}

function workerManageDomain(ctx: ModPluginContext, options: Api2HostOptions, stopped: () => boolean): WorkerManagementCall {
  const binding = consentBinding(ctx.id);
  const tokens = new Map<string, { id: string; scope: string }>();
  const requests: number[] = [];
  const host = options.workerManagement ?? workerManagementHost;
  const scope = host?.scope();
  const saved = (result: { ok: boolean; reason?: string }) => result.ok ? api2Ok(null) : api2Refused("management", result.reason ?? "The operation failed.");
  return async (method, args, epochCurrent) => {
    const capability = Object.hasOwn(WORKER_MANAGE_CALLS, method) ? WORKER_MANAGE_CALLS[method] : undefined;
    const current = () => !stopped() && epochCurrent() && typeof binding === "string" && binding === consentBinding(ctx.id) && !!host && scope === host.scope() && !!capability && options.grants.has(capability) && modHolds(ctx.id, capability);
    if (!capability || !options.grants.has(capability)) return api2NotGranted(capability ?? "profiles:manage");
    if (!validWorkerManageCall(method, args)) return api2Refused("bad-call", "The management request has invalid arguments.");
    if (!current() || !host) return api2Refused("revoked", "The management request is no longer authorized.");
    if (workerManagementBusy) return api2Refused("busy", "The host is handling another management request.");
    const now = Date.now();
    while (requests[0] !== undefined && requests[0] < now - 60000) requests.shift();
    if (requests.length >= 32) return api2Refused("rate", "A Worker can request management at most 32 times per minute.");
    requests.push(now);
    workerManagementBusy = true;
    try {
      const confirm = async (plan: string, fingerprint: () => string): Promise<boolean> => {
        const before = fingerprint();
        return await host.confirm(ctx.id, plan) && current() && before === fingerprint();
      };
      if (method.startsWith("manage.mods.")) {
        const provider = options.management ?? managementHost;
        if (!provider) return api2Unavailable("The mod manager is unavailable.");
        const service = await provider();
        const result = await workerManageOperation(service, ctx.id, method.slice("manage.mods.".length), args, (plan) => host.confirm(ctx.id, plan), current);
        return result.status === "ok" ? api2Ok(data(result.value)) : result.status === "refused" ? api2Refused(result.code, result.reason) : api2Refused("confirmation", "The operation needs a player decision.");
      }
      if (method.startsWith("manage.profiles.")) {
        const profiles = ctx.profiles;
        const access = profiles && workerProfileAccess(profiles);
        if (!profiles || !access) return api2Unavailable("The profile manager is unavailable.");
        const list = () => access.list();
        if (method === "manage.profiles.list") return api2Ok(data(list()));
        if (method !== "manage.profiles.create" && !list().some((profile) => profile.id === args[0])) return api2Refused("profile", "This mod did not create that profile.");
        if (method === "manage.profiles.create" && list().length >= 64) return api2Refused("quota", "A mod can create at most 64 profiles.");
        if (method === "manage.profiles.switchTo" && args[1] !== undefined && (!options.grants.has("saves:manage") || !modHolds(ctx.id, "saves:manage"))) return api2NotGranted("saves:manage");
        if (!(await confirm(JSON.stringify({ operation: method, args }), () => access.fingerprint(method === "manage.profiles.create" ? undefined : args[0] as string)))) return api2Refused("changed", "The profile request was declined or changed.");
        if (method === "manage.profiles.switchTo" && args[1] !== undefined && !modHolds(ctx.id, "saves:manage")) return api2NotGranted("saves:manage");
        if (method === "manage.profiles.create") {
          const result = profiles.create(args[0] as string);
          return result.ok ? api2Ok(data(result.value)) : api2Refused("profile", result.reason);
        }
        return saved(method === "manage.profiles.rename" ? access.rename(args[0] as string, args[1] as string) : profiles.switchTo(args[0] as string, args[1] as unknown as import("./mod-plugin").ModProfileAction));
      }
      if (method.startsWith("manage.saves.")) {
        const saves = ctx.saves;
        const access = saves && workerSaveAccess(saves);
        if (!saves || !access) return api2Unavailable("The character roster is unavailable.");
        const roster = () => access.listRoster();
        if (method === "manage.saves.list") {
          const result = await saves.list();
          if (!result.ok) return api2Refused("save", result.reason);
          if (!current() || result.entries.length > 128) return api2Refused("quota", "The character selection is unavailable or too large.");
          const before = JSON.stringify(roster());
          const selected = await host.pickSaves(ctx.id, result.entries);
          if (!selected || !current() || before !== JSON.stringify(roster()) || selected.length > 128 || new Set(selected).size !== selected.length || selected.some((id) => !result.entries.some((entry) => entry.id === id))) return api2Refused("changed", "The character selection was declined or changed.");
          tokens.clear();
          return api2Ok(data(result.entries.filter((entry) => selected.includes(entry.id)).map((entry) => {
            const token = crypto.randomUUID();
            tokens.set(token, { id: entry.id, scope: host.scope() });
            return { ...entry, id: token };
          })));
        }
        const selected = tokens.get(args[0] as string);
        if (!selected || selected.scope !== host.scope()) return api2Refused("save", "The player has not selected that character.");
        const meta = roster().find((entry) => entry.id === selected.id);
        if (!meta) return api2Refused("save", "The selected character no longer exists.");
        const fingerprint = () => JSON.stringify([roster(), access.activeSlot(), access.namePinned(), access.fingerprint?.(selected.id)]);
        if (!(await confirm(JSON.stringify({ operation: method, character: meta.name, args: args.slice(1) }), fingerprint))) return api2Refused("changed", "The character request was declined or changed.");
        if (method === "manage.saves.delete") {
          if (access.activeSlot() === selected.id) return api2Refused("save", "The active character cannot be deleted.");
          access.deleteSlot(selected.id);
          tokens.delete(args[0] as string);
          return api2Ok(null);
        }
        if (method === "manage.saves.rename") return saved(await saves.rename(selected.id, args[1] as string));
        if (!meta.alive) return api2Refused("save", "This character has died.");
        const request = args[1] as { resumeAutoplayer?: boolean } | undefined;
        const before = fingerprint();
        return saved(await access.load(selected.id, () => current() && before === fingerprint(), request?.resumeAutoplayer ? ctx.id : undefined));
      }
      if (method.startsWith("manage.options.")) {
        if (!ctx.state) return api2Unavailable(NO_GAME);
        const editor = createModOptions(ctx.state, { writable: true, management: true, beforeCheat: () => current() && host.markCheat(ctx.id, ctx.state!), afterChange: () => host.saveOptions() });
        if (method === "manage.options.get") return api2Ok(data(editor.get()));
        const change = args[0] as unknown as import("@rpgm-tools/neo-angband-mod-sdk").Api2OptionsChange;
        const cheat = Object.keys(change.values ?? {}).some((name) => OPTION_ENTRIES.some((entry) => entry.name === name && entry.type === "CHEAT"));
        if (!(await confirm(JSON.stringify({ operation: method, change, ...(cheat ? { consequence: "Cheat changes permanently make this character unscorable." } : {}) }), () => JSON.stringify(editor.get())))) return api2Refused("changed", "The options request was declined or changed.");
        const result = editor.set!(change);
        return result.ok ? api2Ok(data(result.changed)) : api2Refused("options", result.reason);
      }
      if (method === "manage.session.save") {
        if (!ctx.session) return api2Unavailable(NO_GAME);
        if (!(await confirm("Save the current character.", () => host.scope()))) return api2Refused("changed", "The save request was declined or changed.");
        return saved(ctx.session.save());
      }
      return api2Refused("mechanism", "This operation requires a host mechanism Workers do not have; exit, quit, and wizard require proven detachment from saves.");
    } catch {
      return api2Refused("management", "The management request failed.");
    } finally {
      workerManagementBusy = false;
    }
  };
}

export interface WorkerSpawnRequest {
  readonly kind: "object" | "monster";
  readonly index: number;
  readonly name: string;
  readonly count: number;
}

export interface WorkerSpawnSharedHost {
  confirm(id: string, request: WorkerSpawnRequest): Promise<boolean>;
  mark(id: string, capability: "debug:spawn" | "shared:publish", state: GameState, current: () => boolean): boolean | Promise<boolean>;
  spawn(state: GameState, request: WorkerSpawnRequest): number;
}

let workerSpawnSharedHost: WorkerSpawnSharedHost | undefined;
let workerSpawnBusy = false;
const spawnSharedWorkerCalls = new WeakMap<ModApi2, WorkerManagementCall>();
const workerPublishedNames = new Map<string, Set<string>>();
export const WORKER_SHARED_ENTRY_BYTES = 16 * 1024;
export const WORKER_SHARED_ENTRY_COUNT = 32;
export const WORKER_SHARED_CALLS_PER_SECOND = 16;
export const WORKER_SPAWN_COUNT = 16;

export function setApi2WorkerSpawnSharedHost(host: WorkerSpawnSharedHost | undefined): void {
  workerSpawnSharedHost = host;
}

export function serveSpawnSharedWorkerCall(api: ModApi2, method: string, args: readonly WorkerJson[], current: () => boolean): Api2Call<unknown> {
  return spawnSharedWorkerCalls.get(api)?.(method, args, current) ?? Promise.resolve(api2Unavailable("Worker spawning and sharing are unavailable."));
}

function spawnSharedWorkerDomain(ctx: ModPluginContext, options: Api2HostOptions, stopped: () => boolean): WorkerManagementCall {
  const host = options.workerSpawnShared ?? workerSpawnSharedHost;
  const binding = consentBinding(ctx.id);
  const sharedTimes: number[] = [];
  const spawnTimes: number[] = [];
  let sharedMarked = false;
  let markingShared = false;
  const name = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
  return async (method, rawArgs, live) => {
    const capability = SPAWN_SHARED_WORKER_CALLS[method];
    if (!capability) return api2Refused("bad-call", "This operation has no Worker mechanism.");
    const state = ctx.state;
    const current = () => live() && !stopped() && typeof binding === "string" && binding === consentBinding(ctx.id) &&
      state === ctx.state && options.grants.has(capability) && modHolds(ctx.id, capability);
    if (!current()) return api2NotGranted(capability);
    let args: WorkerJson[];
    try { args = cloneWorkerJson(rawArgs) as WorkerJson[]; }
    catch { return api2Refused("bad-call", "Only JSON values can be shared or spawned."); }
    const time = Date.now();
    const times = method.startsWith("debug.") ? spawnTimes : sharedTimes;
    const interval = method.startsWith("debug.") ? 60000 : 1000;
    while (times[0] !== undefined && times[0] <= time - interval) times.shift();
    if (times.length >= (method.startsWith("debug.") ? 4 : WORKER_SHARED_CALLS_PER_SECOND)) return api2Refused("rate", "This mod has sent too many spawn or shared requests.");
    times.push(time);
    try {
      if (method.startsWith("debug.")) {
        const [which, quantity = 1] = args;
        if (args.length < 1 || args.length > 2 ||
          !(typeof which === "number" && Number.isSafeInteger(which) && which >= 0 || typeof which === "string" && which.length > 0 && which.length <= 128 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(which)) ||
          typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > WORKER_SPAWN_COUNT) return api2Refused("bad-call", "Spawning needs a known content id or index and a count from 1 to 16.");
        if (!state || !ctx.registries || !host) return api2Unavailable("The live spawn host is unavailable.");
        const kind = method === "debug.spawnObject" ? "object" : "monster";
        const records = kind === "object" ? ctx.registries.objects.kinds : ctx.registries.monsters.races;
        const ids = new ContentIdResolver(ctx.registries);
        const contentIndex = typeof which === "string" ? kind === "object" ? ids.kindIndex(which) : ids.raceIndex(which) : undefined;
        const index = typeof which === "number" ? which : contentIndex ?? records.findIndex((record) => record && record.name === which);
        const record = records[index];
        if (!record || !record.name) return api2Refused("content", "That content is not in the current game.");
        const request: WorkerSpawnRequest = Object.freeze({ kind, index, name: record.name, count: quantity });
        if (workerSpawnBusy) return api2Refused("busy", "The host is handling another spawn request.");
        workerSpawnBusy = true;
        try {
          if (!await host.confirm(ctx.id, request)) return api2Refused("declined", "The player declined the spawn request.");
          if (!current()) return api2NotGranted(capability);
          if (!await host.mark(ctx.id, "debug:spawn", state, current)) return api2Refused("save", "The permanent spawn mark could not be saved.");
          if (!current()) return api2NotGranted(capability);
          return api2Ok({ spawned: host.spawn(state, request) });
        } finally { workerSpawnBusy = false; }
      }
      if (!ctx.shared) return api2Unavailable("The shared value store is unavailable.");
      if (method === "shared.read") {
        if (args.length !== 2 || !name(args[0]) || !name(args[1]) || args[0] === ctx.id) return api2Refused("bad-call", "Reads name another publisher and an explicitly published value.");
        const value = ctx.shared.read(args[0], args[1]);
        if (value !== null && payloadBytes(value.value) > WORKER_SHARED_ENTRY_BYTES) return api2Refused("quota", "This published entry exceeds the Worker limit.");
        return api2Ok(cloneWorkerJson(value));
      }
      if (method === "shared.withdraw") {
        if (args.length !== 1 || !name(args[0])) return api2Refused("bad-call", "Withdrawal takes one owned publication name.");
        ctx.shared.withdraw(args[0]);
        workerPublishedNames.get(ctx.id)?.delete(args[0]);
        return api2Ok(null);
      }
      if (args.length !== 3 || !name(args[0]) || typeof args[1] !== "number" || !Number.isSafeInteger(args[1]) || args[1] < 0) return api2Refused("bad-call", "Publication takes a name, a nonnegative version, and a JSON value.");
      if (payloadBytes(args[2]) > WORKER_SHARED_ENTRY_BYTES) return api2Refused("quota", "This publication exceeds 16 KiB.");
      const own = workerPublishedNames.get(ctx.id) ?? new Set<string>();
      if (!own.has(args[0]) && own.size >= WORKER_SHARED_ENTRY_COUNT) return api2Refused("quota", "This mod already publishes 32 entries.");
      if (!sharedMarked) {
        if (!state || !host) return api2Unavailable("The shared publication save writer is unavailable.");
        if (markingShared) return api2Refused("busy", "This mod is recording its first publication.");
        markingShared = true;
        try {
          if (!await host.mark(ctx.id, "shared:publish", state, current)) return api2Refused("save", "The shared publication consequence could not be saved.");
          if (!current()) return api2NotGranted(capability);
          sharedMarked = true;
        } finally { markingShared = false; }
      }
      if (!current()) return api2NotGranted(capability);
      ctx.shared.publish(args[0], args[1], args[2]);
      own.add(args[0]);
      workerPublishedNames.set(ctx.id, own);
      return api2Ok(null);
    } catch {
      return api2Refused("operation", "The spawn or shared request failed.");
    }
  };
}

export function spawnWorkerContent(state: GameState, request: WorkerSpawnRequest, deps: WizardDeps): number {
  let spawned = 0;
  for (let index = 0; index < request.count; index++) {
    const race = deps.races?.[request.index];
    const done = request.kind === "object" ? wizCreateObj(state, { index: request.index }, deps) : !!race && wizSummonNamed(state, { race }, deps);
    if (!done) break;
    spawned++;
  }
  return spawned;
}

export async function drawWorkerSpawnConsent(id: string, name: string, request: WorkerSpawnRequest): Promise<boolean> {
  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined" || typeof HTMLDialogElement.prototype.showModal !== "function") return false;
  const restore = suspendModPanels();
  const dialog = document.createElement("dialog");
  const clean = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").slice(0, 128);
  const heading = document.createElement("h2");
  heading.textContent = `${clean(name)} (${clean(id)}) asks to conjure content`;
  const description = document.createElement("p");
  description.textContent = `${request.count} ${request.kind === "object" ? "item(s)" : "creature(s)"}: ${clean(request.name)} will appear near your character. This permanently makes the character unscorable.`;
  const accept = document.createElement("button");
  accept.textContent = "Conjure";
  const decline = document.createElement("button");
  decline.textContent = "Cancel";
  dialog.append(heading, description, accept, decline);
  dialog.style.cssText = "color:#fff;background:#000;max-width:42rem;max-height:85vh;overflow:auto";
  try {
    document.body.append(dialog);
    return await new Promise<boolean>((resolve) => {
      accept.addEventListener("click", () => resolve(true));
      decline.addEventListener("click", () => resolve(false));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); resolve(false); });
      dialog.addEventListener("close", () => resolve(false));
      dialog.addEventListener("keydown", (event) => event.stopPropagation());
      dialog.showModal();
      decline.focus();
    });
  } finally {
    dialog.remove();
    restore();
  }
}
