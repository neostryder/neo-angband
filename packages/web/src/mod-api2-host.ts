/**
 * The in-process (first-party tier) host for the mod API, version 2.
 *
 * It builds every API 2 domain over the API 1 context the host already hands a
 * plugin (mod-context.ts): the same facades, the same grants, the same latches.
 * Nothing here reaches the game by a door API 1 does not already have; what
 * changes is what comes back. Reads go through the known-world builder, so a
 * mod sees what the player knows. Every value is cloned and frozen, so a mod
 * holds data and never a live object. Every call answers with an Api2Result,
 * and a permission the player refused answers `not-granted` instead of
 * throwing.
 *
 * `manage` and `truth` are built only when the caller says this mod is
 * allowlisted for them. The real allowlist (the build's first-party origins
 * plus a digest check of the installed bytes) belongs to the loader; this
 * module takes the answer as an argument.
 */

import {
  AgentCapabilityError,
  buildKnownWorld,
  createAgentView,
  knownMonsterMidx,
  trueMonsterViews,
  tokenIsCurrent,
  type AgentCapabilities,
  type AgentViewDeps,
  type ActionRegistry,
  type CommandVerbTable,
  type GameEventMap,
  type GameEventType,
  type GameState,
  type PlayerIntent,
  type PromptAnswer,
} from "@rpgm-tools/neo-angband-core";
import {
  API2_EVENT_NAMES,
  API2_HOOK_NAMES,
  api2NotGranted,
  api2Ok,
  api2Refused,
  api2Unavailable,
  MOD_API2_VERSION,
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
  type Api2Title,
  type JsonRecord,
  type JsonValue,
  type KnownWorldData,
  type ModApi2,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPluginContext } from "./mod-plugin";
import { createModWorkerPanelRenderer, type ModWorkerPanelRenderer } from "./mod-worker/panels";
import type { WorkerJson } from "./mod-worker/protocol";
import { bootPhase, onBootPhaseChanged } from "./presentation-phase";
import { menuRegistry } from "./menu-registry";
import { clearQueuedUiInputs, enqueueUiInputs, inputEvents } from "./input-door";
import { closeTopModPanel, modPanelsSuspended, topModPanelId } from "./panel-runtime";
import { removeBackupSink } from "./mod-backup";

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
  readonly commands?: {
    readonly registry: Pick<ActionRegistry, "has" | "register" | "unregister">;
    readonly verbs?: CommandVerbTable;
  };
  /** Measured identity is independent of consent to hidden data. */
  readonly tier?: "first-party" | "public";
  /** The permissions the player granted this mod. */
  readonly grants: AgentCapabilities;
  /** The loader settles namespace grants separately from measured identity. */
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
let commandHost: Api2HostOptions["commands"];
const keymapCommands = new Map<string, () => void>();

export function runApi2KeymapCommand(action: string): boolean {
  const run = keymapCommands.get(action);
  if (!run) return false;
  run();
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
export function api2EventPayload<K extends Api2EventName>(
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
        return {
          code: c.code,
          ...(c.dir !== undefined ? { dir: c.dir } : {}),
          phase: c.phase,
          token: { epoch: c.token.epoch, revision: c.token.revision },
        };
      }
      case "driver-changed":
        return structuredClone(raw);
      default:
        return null;
    }
  })();
  return out === undefined ? undefined : deepFreeze(out) as Api2EventMap[K];
}

/** Build the API 2 domains for one in-process mod over its API 1 context. */
export function createApi2Host(ctx: ModPluginContext, options: Api2HostOptions): ModApi2 {
  const cleanups = new Set<() => void>();
  const { grants } = options;
  const granted = (capability: string): boolean => {
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
  /* One part of the known world, built with only that part readable. */
  const part = (state: GameState, domain: string): KnownWorldData =>
    buildKnownWorld(state, options.viewDeps ?? {}, {
      has: (c) => c === `state:${domain}.read` && readable(domain),
    });

  let panels = options.panels;
  const renderer = (): ModWorkerPanelRenderer | undefined => {
    if (!panels && typeof document !== "undefined") panels = createModWorkerPanelRenderer(document);
    return panels;
  };

  const subscriptions = new Map<string, { type: GameEventType; handler: (type: GameEventType, raw: unknown) => void }>();
  let nextSubscription = 1;
  const titleRows = new Map<string, () => void>();
  const title: Api2Title | undefined = options.tier === "first-party" && options.firstParty?.presentation ? frozen<Api2Title>({
    registerRow: (row) => guarded(() => {
      if (!granted("ui:title")) return api2NotGranted("ui:title");
      if (!ctx.title) return api2Unavailable("this front end has no title actions");
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(row.id) || titleRows.has(row.id)) return api2Refused("bad-title-row", "a title action needs a free id");
      try {
        const remove = ctx.title.registerRow(row);
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
      return ctx.title ? api2Ok(await ctx.title.choose(label, [...choices])) : api2Unavailable("this front end has no title choices");
    }),
  }) : undefined;
  const openPage = (spec: import("@rpgm-tools/neo-angband-mod-sdk").Api2PanelSpec) => guarded(() => {
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

  const prefsEnvelope = "$api2prefs";
  let prefsRevision = 0;
  let pendingMigration: Promise<Api2Result<JsonValue | null>> | undefined;
  const prefs: Api2Slot = {
    get: () => guarded(async () => {
      const raw = ctx.prefs.get() as JsonValue | null;
      const migration = options.prefs;
      if (!migration || raw === null || raw === undefined) return api2Ok(raw === undefined ? null : data(raw));
      const enveloped = typeof raw === "object" && !Array.isArray(raw) && typeof raw[prefsEnvelope] === "number";
      const from = enveloped ? (raw as Record<string, JsonValue>)[prefsEnvelope] as number : 0;
      const value = enveloped ? (raw as Record<string, JsonValue>)["value"] ?? null : raw;
      if (from >= migration.version || value === null) return api2Ok(data(value));
      if (pendingMigration) return pendingMigration;
      const revision = prefsRevision;
      const migrating = (async (): Promise<Api2Result<JsonValue | null>> => {
        const migrated = await migration.migrate(structuredClone(value), from);
        if (revision !== prefsRevision) return prefs.get();
        ctx.prefs.set({ [prefsEnvelope]: migration.version, value: migrated });
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
      const migration = options.prefs;
      ctx.prefs.set(value === null || !migration ? value : { [prefsEnvelope]: migration.version, value: structuredClone(value) });
      prefsRevision += 1;
      return api2Ok(null);
    }),
  };

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
    const composed = ctx.composedRecords;
    if (!composed) return api2Unavailable("the game's content has not been composed yet");
    const list = composed[file];
    if (!list) return api2Refused("unknown-file", `the game has no "${file}" content file`);
    return api2Ok(data(list));
  };

  const api: ModApi2 = {
    meta: frozen({
      id: ctx.id,
      api: MOD_API2_VERSION,
      engine: ctx.engine,
      tier: options.tier ?? "public",
      flags: data({ ...ctx.flags }),
      newCharacter: ctx.newCharacter,
      granted,
      log: (message: string) => ctx.log(message),
      settings: () => guarded(() => api2Ok(data({ ...(ctx.settings?.all() ?? {}) }))),
      setSetting: (id: string, value: number) => guarded(() => {
        const kept = ctx.settings?.set(id, value);
        return kept === undefined
          ? api2Refused("unknown-setting", `this mod declares no numeric setting "${id}"`)
          : api2Ok(kept);
      }),
      mods: () => guarded(() => (ctx.mods ? api2Ok(data(ctx.mods())) : api2Unavailable("this front end lists no mods"))),
    }),

    view: frozen({
      world: () => withState((state) => api2Ok(buildKnownWorld(state, options.viewDeps ?? {}, { has: granted }) as KnownWorldData)),
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
        }));
      }),
      isCurrent: (token) => withState((state) => api2Ok(tokenIsCurrent(state, token))),
    }),

    act: frozen({
      submit: (token, intent) => guarded(() => {
        if (!granted("input:intent")) return api2NotGranted("input:intent");
        if (!ctx.intent) return api2Unavailable("this front end takes no commands from mods");
        const copy = structuredClone(intent) as PlayerIntent;
        /* A monster target names the monster by its KnownMonster id. One the
         * player does not perceive now becomes 0, which the game refuses the
         * same way it refuses a monster it cannot target. */
        const sent: PlayerIntent = copy.kind === "target" && "midx" in copy
          ? { ...copy, midx: (ctx.state ? knownMonsterMidx(ctx.state, copy.midx) : null) ?? 0 }
          : copy;
        const result = ctx.intent.submit(structuredClone(token), sent);
        return result.accepted
          ? api2Ok(null)
          : api2Refused(result.code ?? "rejected", result.reason ?? "the game refused it");
      }),
      answer: (promptId, answer) => guarded(() => {
        if (!granted("input:prompt.reply")) return api2NotGranted("input:prompt.reply");
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
        if (!(API2_EVENT_NAMES as readonly string[]).includes(name)) {
          return api2Refused("unknown-event", `API 2 has no event "${String(name)}"`);
        }
        const capability = `event:${name}`;
        if (!granted(capability)) return api2NotGranted(capability);
        if (!ctx.events) return api2Unavailable(NO_GAME);
        const type = name as GameEventType;
        const handler = (_type: GameEventType, raw: unknown): void => {
          const payload = api2EventPayload(name, raw as never);
          if (payload !== undefined) listener(payload);
        };
        ctx.events.on(type, handler as never);
        const id = `${ctx.id}:${nextSubscription++}`;
        subscriptions.set(id, { type, handler });
        return api2Ok(frozen({ id }));
      }),
      off: (subscription) => guarded(() => {
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
      own: () => guarded(() => api2Ok(data({ ...ctx.data } as Record<string, JsonValue>))),
      asset: (path: string) => guarded(async () => {
        const url = await ctx.assetUrl(path);
        return url === null ? api2Refused("not-found", `this mod has no file "${path}" this front end can serve`) : api2Ok(url);
      }),
      records: (file: string) => guarded(() => records(file)),
      lookup: (ref) => guarded(() => {
        const list = records(ref.file);
        if (!list.ok) return list;
        const found = list.value.find((record) => recordKey(ref.file, record) === ref.key);
        return found
          ? api2Ok(found)
          : api2Refused("unknown-record", `the game's "${ref.file}" content has no record "${ref.key}"`);
      }),
    }),

    ui: frozen({
      ...(title ? { title } : {}),
      ...(options.tier === "first-party" && options.firstParty?.presentation ? {
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
        register: (id, verb, run) => guarded(() => {
          if (!granted("registry:command") && !granted("command:add")) return api2NotGranted("command:add");
          if (!id.startsWith(`${ctx.id}:`) || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(id) || !verb.trim() || typeof run !== "function") {
            return api2Refused("bad-command", "a command needs an owned id, a verb and a handler");
          }
          const commands = options.commands ?? commandHost;
          if (!commands) return api2Unavailable("this front end installs no mod commands");
          if (commands.registry.has(id)) return api2Refused("command-taken", `command "${id}" is already registered`);
          const invoke = () => {
            try {
              const result = run();
              if (result) void result.catch((error: unknown) => ctx.log(`command failed: ${String(error)}`));
            } catch (error) {
              ctx.log(`command failed: ${String(error)}`);
            }
          };
          keymapCommands.set(id, invoke);
          commands.registry.register(id, () => { invoke(); return 0; });
          commands.verbs?.set(id, verb);
          cleanups.add(() => {
            commands.registry.unregister(id);
            if (keymapCommands.get(id) === invoke) keymapCommands.delete(id);
          });
          return api2Ok(null);
        }),
      }),
      gameMenu: frozen({
        register: (action, label, run) => guarded(() => {
          if (!granted("registry:menu")) return api2NotGranted("registry:menu");
          if (!/^[a-z][a-z0-9-]{0,63}$/.test(action) || !label.trim() || /[\r\n]/.test(label) || typeof run !== "function") {
            return api2Refused("bad-action", "a menu action needs an id, a label and a handler");
          }
          menuRegistry.addAction("core:game-menu", action, label, run, ctx.id);
          cleanups.add(() => menuRegistry.removeAction("core:game-menu", action, ctx.id));
          return api2Ok(null);
        }),
      }),
      mount: (panel: Api2Panel, onAction?: (action: string, value?: string | boolean) => void, onDismiss?: () => void) => guarded(() => {
        if (!granted("ui:panel.mount")) return api2NotGranted("ui:panel.mount");
        const draw = renderer();
        if (!draw) return api2Unavailable("this front end draws no panels");
        try {
          draw.apply(ctx.id, "mount", structuredClone(panel) as unknown as WorkerJson, undefined, (_panelId, action, value) => onAction?.(action, value), onDismiss);
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
          if (!granted("keymap:write")) return api2NotGranted("keymap:write");
          if (!ctx.keymaps) return api2Unavailable(NO_GAME);
          return ctx.keymaps.bind(trigger, action)
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

    store: frozen({ prefs: Object.freeze(prefs), character: Object.freeze(character) }),

    ...(ctx.net ? { net: netDomain(ctx.net) } : {}),
    ...(backupFolder ? { backupFolder } : {}),
    ...(options.firstParty?.manage ? { manage: manageDomain(ctx) } : {}),
    ...(options.firstParty?.truth ? { truth: truthDomain(ctx, options.viewDeps ?? {}) } : {}),
    ...(options.tier === "first-party" && options.firstParty?.presentation ? {
      presentation: frozen({
        cancelInput: (escapeCount: number = 3) => guarded(() => {
          if (!Number.isSafeInteger(escapeCount) || escapeCount < 1) return api2Refused("bad-count", "cancellation needs a positive escape count");
          clearQueuedUiInputs();
          enqueueUiInputs(Array.from({ length: escapeCount }, () => ({
            key: { key: "Escape", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false },
          })));
          return api2Ok(null);
        }),
        ...(ctx.keyRepeat ? { keyRepeat: ctx.keyRepeat } : {}),
        ...(title ? { title } : {}),
        phase: bootPhase,
        onPhaseChanged: (listener: (phase: import("@rpgm-tools/neo-angband-mod-sdk").Api2BootPhase) => void) => {
          const off = onBootPhaseChanged((phase) => {
            try { listener(phase); }
            catch (error) { ctx.log(`phase listener failed: ${String(error)}`); }
          });
          cleanups.add(off);
          return () => { off(); cleanups.delete(off); };
        },
        ...(ctx.display ? { display: frozen({
          ...ctx.display,
          onKey: (listener: (event: KeyboardEvent) => void) => {
            const off = ctx.display!.onKey(listener);
            cleanups.add(off);
            return () => { off(); cleanups.delete(off); };
          },
          ...(ctx.display.onFrame ? { onFrame: (listener: () => void) => {
            const off = ctx.display!.onFrame!(listener);
            cleanups.add(off);
            return () => { off(); cleanups.delete(off); };
          } } : {}),
        }) } : {}),
        ...(ctx.subwindows ? { subwindows: ctx.subwindows } : {}),
        ...(ctx.tiles ? { tiles: ctx.tiles } : {}),
        ...(ctx.ui ? { panels: ctx.ui } : {}),
        ...(typeof document !== "undefined" && document.getElementById("game-view") ? {
          sidebarHost: document.getElementById("game-view")!,
        } : {}),
      }),
    } : {}),
  };
  disposers.set(api, () => {
    for (const { type, handler } of subscriptions.values()) ctx.events?.off(type, handler as never);
    subscriptions.clear();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  });
  return Object.freeze(api);
}

function netDomain(net: NonNullable<ModPluginContext["net"]>): NonNullable<ModApi2["net"]> {
  const secrets = net.secrets;
  return frozen({
    request: (request: Api2NetRequest) => guarded(async () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers ?? {})) {
        headers[name] = typeof value === "string" ? value : `{secret:${value.credential}}`;
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
    credential: (name: string) => frozen({ credential: name }),
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

function manageDomain(ctx: ModPluginContext): Api2Manage {
  const profiles = (): NonNullable<ModPluginContext["profiles"]> | null => ctx.profiles ?? null;
  const session = (): NonNullable<ModPluginContext["session"]> | null => ctx.session ?? null;
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
      switchTo: (id: string | null) => guarded(() => {
        const p = profiles();
        if (!p) return api2NotGranted("profiles:manage");
        const r = p.switchTo(id);
        return r.ok ? api2Ok(null) : api2Refused("profiles", r.reason);
      }),
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
}

function truthDomain(ctx: ModPluginContext, deps: AgentViewDeps): Api2Truth {
  /* A trusted view (no capability set) reads the real map, and
   * trueMonsterViews lists every monster, perceived or not. Only an
   * allowlisted mod reaches this. */
  const view = (state: GameState) => createAgentView(state, undefined, deps);
  return frozen({
    monsters: () => guarded(() => {
      if (!ctx.state) return api2Unavailable(NO_GAME);
      return api2Ok(data(trueMonsterViews(ctx.state, deps)) as readonly Api2TrueMonster[]);
    }),
    level: () => guarded(() => {
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
