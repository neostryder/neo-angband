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
  colorPrefId,
  colorTableSnapshot,
  colorToCss,
  describeLookGrid,
  knownMonsterMidx,
  knownLoadoutSimulation,
  squareIsSeen,
  trueMonsterViews,
  tokenIsCurrent,
  type AgentCapabilities,
  type AgentViewDeps,
  type AgentView,
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
  type JsonRecord,
  type JsonValue,
  type KnownWorldData,
  type ModApi2,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPluginContext } from "./mod-plugin";
import { createModWorkerPanelRenderer, type ModWorkerPanelRenderer } from "./mod-worker/panels";
import type { WorkerJson } from "./mod-worker/protocol";

/** The loader must authorize namespaces before the host can expose them. */
export interface Api2Allowlist {
  /** The management seam, for the first-party presentation mod. */
  readonly manage?: boolean;
  /** Hidden game state needs consent even when identity is first-party. */
  readonly truth?: boolean;
}

/** What the loader tells the host about one mod. */
export interface Api2HostOptions {
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

/** Build the API 2 domains for one in-process mod over its API 1 context. */
export function createApi2Host(ctx: ModPluginContext, options: Api2HostOptions): ModApi2 {
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
  const keyed = (world: KnownWorldData): KnownWorldData => data({ ...world,
    player: world.player ? { ...world.player, key: ctx.character?.key() ?? null } : null });
  /* One part of the known world, built with only that part readable. */
  const part = (state: GameState, domain: string): KnownWorldData =>
    keyed(buildKnownWorld(state, options.viewDeps ?? state.knownWorldDeps ?? {}, {
      has: (c) => (c === `state:${domain}.read` && readable(domain)) ||
        (domain === "map" && c === "state:floor.read" && readable("floor")),
    }));
  const inspectRead = <T>(domains: readonly string[], read: (state: GameState, view: AgentView) => T): Api2Call<T> =>
    withState((state) => {
      for (const domain of domains) if (!readable(domain)) return api2NotGranted(`state:${domain}.read`);
      const view = createAgentView(state, undefined, { ...(options.viewDeps ?? state.knownWorldDeps ?? {}), knowledgeSafe: true }, { has: granted });
      return api2Ok(data(read(state, view)));
    });

  let panels = options.panels;
  const renderer = (): ModWorkerPanelRenderer | undefined => {
    if (!panels && typeof document !== "undefined") panels = createModWorkerPanelRenderer(document);
    return panels;
  };

  const subscriptions = new Map<string, { type: GameEventType; handler: (type: GameEventType, raw: unknown) => void }>();
  let nextSubscription = 1;
  const runSubscriptions = new Map<string, () => void>();

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
      world: () => withState((state) => api2Ok(keyed(buildKnownWorld(state, options.viewDeps ?? state.knownWorldDeps ?? {}, { has: granted })))),
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
          phase: snap.phase,
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
        const simulation = createAgentView(state, undefined, options.viewDeps ?? {}, { has: granted }).simulateLoadout?.(structuredClone(change));
        return simulation ? api2Ok(data(knownLoadoutSimulation(state, simulation, ctx.character?.key() ?? null)) as import("@rpgm-tools/neo-angband-mod-sdk").LoadoutSimulation) : api2Unavailable("the game has no loadout calculation");
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
          if (payload !== undefined) listener(payload as Parameters<typeof listener>[0]);
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
        const found = list.value.find((record) => recordKey(ref.file, record) === ref.key);
        return found
          ? api2Ok(found)
          : api2Refused("unknown-record", `the game's "${ref.file}" content has no record "${ref.key}"`);
      }),
    }),

    ui: frozen({
      mount: (panel: Api2Panel, onAction?: (action: string) => void) => guarded(() => {
        if (!granted("ui:panel.mount")) return api2NotGranted("ui:panel.mount");
        const draw = renderer();
        if (!draw) return api2Unavailable("this front end draws no panels");
        try {
          draw.apply(ctx.id, "mount", structuredClone(panel) as unknown as WorkerJson, undefined, (_panelId, action) => onAction?.(action));
        } catch (e) {
          return api2Refused("bad-panel", e instanceof Error ? e.message : String(e));
        }
        return api2Ok(frozen({ panelId: panel.id }));
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
    ...(options.firstParty?.manage ? { manage: manageDomain(ctx) } : {}),
    ...(options.firstParty?.truth ? { truth: truthDomain(ctx, options.viewDeps ?? {}) } : {}),
  };
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
