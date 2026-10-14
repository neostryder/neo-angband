/**
 * API 2 mods on the API 1 loader, and the map from one API to the other.
 *
 * The loader still takes API 1 plugins only: `validateModPlugin` checks an
 * integer `api`, and the register loop hands each plugin an API 1 context.
 * `api2Plugin` wraps an API 2 definition as an API 1 plugin, so an API 2 mod
 * runs through the same loader, the same capability grants and the same
 * guarded hook composition, and an API 1 plugin keeps running exactly as it
 * did. A Worker mod runs the same definition behind the Worker broker
 * (mod-worker/host.ts), which shares `checkApi2Definition` and the policy
 * interpreter with this module.
 *
 * `API1_CONTEXT_MAP` names, for every member of the API 1 context, where its
 * job lives in API 2, or why it has no API 2 form.
 */

import type { ModHooks, ModPluginContext } from "@rpgm-tools/neo-angband-core";
import { inputToken, tokenIsCurrent, type PlayerCommand } from "@rpgm-tools/neo-angband-core";
import {
  api2PolicyEffects,
  apiRangeVerdict,
  checkApi2Policies,
  type Api2HookName,
  type Api2Hooks,
  type Api2ModDefinition,
  type Api2Policies,
  type Api2PolicyRegistrations,
  type Api2TileFill,
  type JsonValue,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { bootPhase } from "./presentation-phase";
import { api2Engine, createApi2Host, disposeApi2Host, type Api2HostOptions } from "./mod-api2-host";
import type { ModPlugin } from "./mod-plugin";
import { createIntentGate } from "./intent-gate";

/** The API 1 plugin version an API 2 mod presents to the loader. */
const SHIM_PLUGIN_API = 1;

/**
 * Why a candidate is not an API 2 definition this host can run, or null when
 * it is one. The `api` range is checked against this host's API 2 version.
 */
export function checkApi2Definition(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "an API 2 mod default-exports an object";
  const d = candidate as Partial<Api2ModDefinition>;
  if (typeof d.api !== "string") return `an API 2 mod declares its "api" range as a string, such as ">=2.0.0 <3.0.0"`;
  const verdict = apiRangeVerdict(d.api);
  if (!verdict.ok) return `"api": "${d.api}" ${verdict.why}`;
  for (const member of ["hooks", "policies", "start", "stop", "migrateBag", "controller", "armed", "birth"] as const) {
    if (d[member] !== undefined && typeof d[member] !== "function") return `${member} is not a function`;
  }
  for (const slot of ["prefs", "install"] as const) if (d[slot] !== undefined) {
    const p = d[slot] as Partial<NonNullable<Api2ModDefinition["prefs"]>>;
    if (typeof p.version !== "number" || !Number.isInteger(p.version) || p.version < 1) {
      return `${slot}.version is a whole number from 1`;
    }
    if (typeof p.migrate !== "function") return `${slot}.migrate is not a function`;
  }
  if (d.presentation !== undefined) {
    if (d.presentation === null || typeof d.presentation !== "object") return "presentation is not an object";
    for (const member of ["menu", "screen", "hud", "birth"] as const) {
      if (d.presentation[member] !== undefined && typeof d.presentation[member] !== "function") return `presentation.${member} is not a function`;
    }
  }
  if (d.actions !== undefined && (!Array.isArray(d.actions) || d.actions.some((action) =>
    !action || action.menu !== "core:game-menu" || typeof action.action !== "string" || typeof action.label !== "string" || typeof action.run !== "function"))) {
    return "actions must declare a Game-menu id, action, label and handler";
  }
  if (d.titleActions !== undefined && (!Array.isArray(d.titleActions) || d.titleActions.some((row) =>
    !row || typeof row.id !== "string" || typeof row.label !== "string" || typeof row.run !== "function"))) {
    return "titleActions must declare an id, label and handler";
  }
  if (d.hooks === undefined && d.policies === undefined && d.start === undefined && d.controller === undefined &&
    !d.presentation?.menu && !d.presentation?.screen && !d.presentation?.hud && !d.presentation?.birth && !d.birth && !d.actions?.length && !d.titleActions?.length) {
    return "an API 2 mod declares hooks, policies, start, controller or a combination";
  }
  return null;
}

/** A plain, frozen copy of a hook argument, so a mod holds data and never a live object. */
function plain<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const copy = structuredClone(value);
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const child of Object.values(v as Record<string, unknown>)) freeze(child);
    }
  };
  freeze(copy);
  return copy;
}

/**
 * The core hooks an API 2 hook set stands for. A hook the mod leaves out stays
 * absent, so it costs nothing and composes as no contribution at all.
 */
export function api2ToModHooks(hooks: Api2Hooks): ModHooks {
  const out: ModHooks = {};
  if (hooks.messageText) {
    const f = hooks.messageText.bind(hooks);
    out.messageText = (raw) => f(raw);
  }
  if (hooks.screenText) {
    const f = hooks.screenText.bind(hooks);
    out.screenText = (raw, site) => f(raw, plain(site));
  }
  if (hooks.characterBackground) {
    const f = hooks.characterBackground.bind(hooks);
    out.characterBackground = (text) => f(text);
  }
  if (hooks.objectInfoText) {
    const f = hooks.objectInfoText.bind(hooks);
    out.objectInfoText = (text, site) => f(text, plain(site));
  }
  if (hooks.effectIntro) {
    const f = hooks.effectIntro.bind(hooks);
    out.effectIntro = (intro) => f(plain(intro));
  }
  if (hooks.historyAdd) {
    const f = hooks.historyAdd.bind(hooks);
    /* API 1 hands one shared, writable entry down the chain; API 2 hands a
     * copy and takes a decision back, which is written onto the shared entry
     * so the contributors after this one see it as API 1 promises. */
    out.historyAdd = (entry) => {
      const decision = f(plain({
        what: entry.what,
        type: entry.type,
        duplicate: entry.duplicate,
        ...(entry.rawUserInput !== undefined ? { rawUserInput: entry.rawUserInput } : {}),
        ...(entry.expandUserInput ? { expandUserInput: true as const } : {}),
      }));
      if (typeof decision?.what === "string") entry.what = decision.what;
      if (decision?.expandUserInput === true) entry.expandUserInput = true;
      return decision?.keep !== false;
    };
  }
  if (hooks.historyDisplay) {
    const f = hooks.historyDisplay.bind(hooks);
    out.historyDisplay = (entry, playerName) => f(plain(entry), playerName);
  }
  if (hooks.objectListTiebreak) {
    const f = hooks.objectListTiebreak.bind(hooks);
    out.objectListTiebreak = (a, b) => f({ dy: a.dy, dx: a.dx }, { dy: b.dy, dx: b.dx });
  }
  if (hooks.saveNoiseScent) {
    const f = hooks.saveNoiseScent.bind(hooks);
    out.saveNoiseScent = () => f();
  }
  if (hooks.shapeLearnObviousFlagsDirectly) {
    const f = hooks.shapeLearnObviousFlagsDirectly.bind(hooks);
    out.shapeLearnObviousFlagsDirectly = () => f();
  }
  if (hooks.optionsChanged) {
    const f = hooks.optionsChanged.bind(hooks);
    out.optionsChanged = (options) => f(plain(options));
  }
  if (hooks.abilityGained) {
    const f = hooks.abilityGained.bind(hooks);
    out.abilityGained = (ability) => f(plain(ability));
  }
  if (hooks.monsterBecameVisible) {
    const f = hooks.monsterBecameVisible.bind(hooks);
    out.monsterBecameVisible = (mon) => f(plain(mon));
  }
  if (hooks.artifactIdentified) {
    const f = hooks.artifactIdentified.bind(hooks);
    out.artifactIdentified = (found) => f(plain(found));
  }
  return out;
}

/**
 * A mod's policy tables as hooks, with its hook functions over them: a hook
 * function wins over the table for the same hook. Throws for tables that fail
 * `checkApi2Policies`, which the caller reports as it reports a throw from
 * `hooks`.
 */
export function mergePolicies(policies: unknown, hooks: Api2Hooks | undefined, granted: (capability: string) => boolean = () => true): Api2Hooks | undefined {
  if (policies === undefined || policies === null) return hooks;
  const problem = checkApi2Policies(policies);
  if (problem) throw new Error(`its policies are not valid: ${problem}`);
  const fromTables = api2PolicyEffects(policies as Api2Policies, granted).hooks;
  const merged: Record<string, unknown> = { ...fromTables };
  for (const [name, fn] of Object.entries(hooks ?? {})) if (typeof fn === "function") merged[name] = (fn as (...args: unknown[]) => unknown).bind(hooks);
  return merged as Api2Hooks;
}

/**
 * Where the host installs the registrations a mod's policy tables stand for:
 * the game's store behaviour and the mod's own slot in the tile registry. A
 * null target is one this game does not have, and its registrations are
 * skipped.
 */
export interface Api2PolicyTargets {
  readonly stores: {
    registerDiscountRoll(handler: (roll: { readonly rng: { oneIn(n: number): boolean }; readonly cost: number }) => number): void;
  } | null;
  readonly tiles: { register(filler: (fill: Api2TileFill) => void): void } | null;
}

/**
 * Install a mod's policy registrations. `active` is asked on every use, and a
 * mod that is no longer active answers as if it had installed nothing: no
 * discount and no roll drawn, and no tile filled.
 */
export function installApi2PolicyRegistrations(
  registrations: Api2PolicyRegistrations,
  targets: Api2PolicyTargets,
  active: () => boolean,
): void {
  const roll = registrations.discountRoll;
  if (roll && targets.stores) {
    targets.stores.registerDiscountRoll((ctx) => (active() ? roll({ cost: ctx.cost, oneIn: (n) => ctx.rng.oneIn(n) }) : 0));
  }
  const filler = registrations.tileFiller;
  if (filler && targets.tiles) {
    targets.tiles.register((fill) => {
      if (active()) filler(fill);
    });
  }
}

const pluginPolicies = new WeakMap<ModPlugin, { id: string; flags: Readonly<Record<string, boolean>>; registrations: Api2PolicyRegistrations }>();

/** A factory fault must not run again outside guarded hook composition, so registration reads only its cached results. */
export function api2PluginRegistrations(
  plugin: ModPlugin,
  id: string,
  flags: Readonly<Record<string, boolean>>,
): Api2PolicyRegistrations | undefined {
  const cached = pluginPolicies.get(plugin);
  if (!cached || cached.id !== id || Object.keys(cached.flags).length !== Object.keys(flags).length ||
    Object.entries(cached.flags).some(([name, value]) => flags[name] !== value)) return undefined;
  const { registrations } = cached;
  return Object.keys(registrations).length > 0 ? registrations : undefined;
}

/** The hooks a definition declares, by name, for `hooks.active`. */
function declaredHooks(hooks: Api2Hooks | undefined): Api2HookName[] {
  if (!hooks) return [];
  return (Object.keys(hooks) as Api2HookName[]).filter((name) => typeof hooks[name] === "function");
}

/** What the loader tells the shim about one mod; the same facts the host takes, less what the definition supplies. */
export type Api2PluginOptions = Omit<Api2HostOptions, "activeHooks" | "prefs">;

/**
 * The shim reads `options` at hook composition and registration so both use the loader's settled grants.
 *
 * - `hooks(ctx)` asks the definition for its hooks with the mod's id and flags
 *   and converts them to core hooks.
 * - `register(host, ctx)` builds the API 2 domains over `ctx` and calls
 *   `start`. A rejected `start` is logged through `ctx.log`, as a throw from an
 *   API 1 `register` is reported by the loader.
 * - `migrateBag` and `uninstall` pass through to `migrateBag` and `stop`.
 */
export function api2Plugin(definition: Api2ModDefinition, options: () => Api2PluginOptions): ModPlugin {
  let active: Api2HookName[] = [];
  const hosts = new Set<ReturnType<typeof createApi2Host>>();
  let stopped = false;
  let generation = 0;
  const build = (ctx: ModPluginContext, extra: Partial<Api2HostOptions> = {}) => {
    const mod = createApi2Host(ctx, { ...options(), activeHooks: active,
      ...(definition.prefs ? { prefs: definition.prefs } : {}),
      ...(definition.install ? { install: definition.install } : {}), ...extra });
    hosts.add(mod);
    return mod;
  };
  const plugin: { -readonly [K in keyof ModPlugin]: ModPlugin[K] } = { api: SHIM_PLUGIN_API };
  const hostFor = (ctx: ModPluginContext): import("@rpgm-tools/neo-angband-mod-sdk").ModApi2 => {
    const mod = createApi2Host(ctx, options());
    hosts.add(mod);
    return mod;
  };
  for (const member of ["menu", "screen", "hud"] as const) {
    const presenter = definition.presentation?.[member];
    if (!presenter) continue;
    Object.defineProperty(plugin, member, {
      enumerable: true,
      get: () => options().tier === "first-party" && options().firstParty?.presentation
        ? (ctx: ModPluginContext) => definition.presentation![member]!(hostFor(ctx))
        : undefined,
    });
  }
  const birth = definition.birth ?? definition.presentation?.birth;
  if (birth) Object.defineProperty(plugin, "birth", {
    enumerable: true,
    get: () => options().tier === "first-party" && options().firstParty?.presentation
      ? (ctx: ModPluginContext) => birth.call(definition.birth ? definition : definition.presentation, hostFor(ctx))
      : undefined,
  });
  if (definition.hooks || definition.policies) {
    const hooksOf = definition.hooks?.bind(definition);
    const policiesOf = definition.policies?.bind(definition);
    plugin.hooks = (ctx: ModPluginContext): ModHooks | undefined => {
      pluginPolicies.delete(plugin as ModPlugin);
      const engine = api2Engine(ctx, options());
      const context = { id: ctx.id, flags: plain({ ...ctx.flags }), ...(engine ? { engine } : {}) };
      const declared = hooksOf?.(context);
      const policies = policiesOf?.(context);
      let fromTables: Api2Hooks | undefined;
      if (policies !== undefined && policies !== null) {
        const problem = checkApi2Policies(policies);
        if (problem) throw new Error(`its policies are not valid: ${problem}`);
        const grants = options().grants;
        const effects = api2PolicyEffects(policies, (capability) => grants.has(capability));
        fromTables = effects.hooks;
        pluginPolicies.set(plugin as ModPlugin, { ...context, registrations: effects.registrations });
      }
      const merged = fromTables === undefined ? declared : { ...fromTables };
      if (fromTables && merged) {
        for (const [name, fn] of Object.entries(declared ?? {})) {
          if (typeof fn === "function") (merged as Record<string, unknown>)[name] = (fn as (...args: unknown[]) => unknown).bind(declared);
        }
      }
      active = declaredHooks(merged);
      return merged ? api2ToModHooks(merged) : undefined;
    };
  }
  if (definition.start || definition.actions?.length || definition.titleActions?.length) {
    const start = definition.start?.bind(definition);
    plugin.register = (_host, ctx) => {
      stopped = false;
      const mod = build(ctx);

      for (const row of definition.titleActions ?? []) {
        if (!mod.ui.title || !mod.meta.granted("profiles:manage") || !mod.meta.granted("saves:manage")) {
          ctx.log(`title action "${row.id}" needs title, profile and save grants`);
          continue;
        }
        void mod.ui.title.registerRow(row).then((result) => {
          if (!result.ok) ctx.log(`title action "${row.id}" was refused`);
        });
      }
      for (const action of definition.actions ?? []) {
        void mod.ui.gameMenu.register(action.action, action.label, () => action.run(mod)).then((result) => {
          if (!result.ok) ctx.log(`menu action "${action.action}" was refused`);
        });
      }
      const started = start?.(mod);
      if (started && typeof (started as Promise<void>).then === "function") {
        (started as Promise<void>).catch((e: unknown) => {
          ctx.log(`start failed: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    };
  }
  if (definition.controller) {
    const decide = definition.controller.bind(definition);
    plugin.controller = (ctx) => {
      const opts = options();
      if (opts.tier !== "first-party" || opts.execution === "worker" || !ctx.state) return undefined;
      const engine = api2Engine(ctx, opts);
      if (definition.armed && !definition.armed({ id: ctx.id, flags: plain({ ...ctx.flags }), armed: ctx.controllerArmed === true, ...(engine ? { engine } : {}) })) return undefined;
      stopped = false;
      const state = ctx.state;
      const installedGeneration = generation;
      let pending = false;
      let deciding = false;
      let queued: { command: PlayerCommand; token: ReturnType<typeof inputToken> } | undefined;
      const takeAnswer = (): PlayerCommand | null => {
        const answer = queued;
        queued = undefined;
        return answer && tokenIsCurrent(state, answer.token) ? answer.command : null;
      };
      const gate = createIntentGate({ state,
        registry: {
          has: (code) => ctx.intent?.catalogue?.().commands.some((command) => command.code === code) ?? true,
          codes: () => ctx.intent?.catalogue?.().commands.map((command) => command.code) ?? [],
        },
        snapshotSource: { phase: () => ctx.snapshot?.()?.phase ?? "play", prompt: () => ctx.snapshot?.()?.prompt ?? null },
        push: (command) => { queued = { command, token: inputToken(state) }; },
        storeCommand: (command) => { queued = { command, token: inputToken(state) }; return true; },
        advance: () => undefined,
      });
      const mod = build(ctx, { intent: { submit: (token, intent) => {
        if (stopped || installedGeneration !== generation || !deciding || queued) return { accepted: false, reason: "this controller decision has ended" };
        const driver = ctx.driver?.();
        if (driver && (driver.kind !== "controller" || driver.owner !== ctx.id)) return { accepted: false, code: "controller-owned", reason: "this mod does not hold the keyboard" };
        return gate.submit(token, intent);
      } } });
      return () => {
        if (stopped || installedGeneration !== generation) return null;
        if (queued) {
          return takeAnswer();
        }
        if (pending) return null;
        const snap = ctx.snapshot?.();
        if (!opts.grants.has("state:interaction.read") && !opts.grants.has("state:*.read")) return null;
        const input = plain({ token: inputToken(state), driver: snap?.driver ?? { kind: "controller" as const, owner: ctx.id },
          phase: snap?.phase === "pregame" ? bootPhase() : snap?.phase ?? "play" as const, messagePending: snap?.messagePending ?? false, prompt: snap?.prompt ?? null,
          resting: snap?.resting ?? null,
          running: (ctx.state?.run?.running ?? 0) > 0,
          repeating: (ctx.state?.cmdQueue?.[0]?.repeatRemaining ?? 0) > 0,
          repeatsLeft: ctx.state?.cmdQueue?.[0]?.repeatRemaining ?? 0,
          unignoring: (ctx.state?.unignoring ?? 0) > 0,
          messages: opts.grants.has("state:messages.read") || opts.grants.has("state:*.read") ? snap?.messages?.log.slice(-100) ?? null : null,
          storeStatus: (opts.grants.has("state:stores.read") && opts.grants.has("state:inventory.read")) || opts.grants.has("state:*.read") ? snap?.storeStatus ?? null : null,
          activeBlast: opts.grants.has("state:map.read") || opts.grants.has("state:*.read") ? snap?.activeBlast ?? null : null });
        deciding = true;
        try {
          const result = decide(mod, input);
          if (result && typeof result.then === "function") {
            pending = true;
            result.catch((error: unknown) => ctx.log(`controller failed: ${error instanceof Error ? error.message : String(error)}`))
              .finally(() => { pending = false; deciding = false; });
          } else deciding = false;
        } catch (error) {
          deciding = false;
          throw error;
        }
        return takeAnswer();
      };
    };
  }
  if (definition.migrateBag) {
    const migrate = definition.migrateBag.bind(definition);
    plugin.migrateBag = (data, fromSchema) => migrate(structuredClone(data) as JsonValue, fromSchema);
  }
  plugin.uninstall = () => {
    stopped = true;
    generation += 1;
    try { definition.stop?.(); } finally {
      for (const mod of hosts) disposeApi2Host(mod);
      hosts.clear();
    }
  };
  return plugin;
}

/**
 * Where each member of the API 1 context lives in API 2. "retired" members
 * have no API 2 form: they hand out live engine objects, mutable registries or
 * call-by-name access, and each names what replaces it.
 */
export const API1_CONTEXT_MAP: Readonly<Record<keyof ModPluginContext, string>> = Object.freeze({
  id: "meta.id",
  api: "meta.api (a semver string, not an integer)",
  engine: "meta.engine",
  flags: "meta.flags",
  settings: "meta.settings, meta.setSetting",
  core: "engine.core (in-process only, with engine:access)",
  authoring: "manage.authoring (first-party only, with mod:authoring)",
  state: "engine.state (in-process only, with engine:access)",
  assetUrl: "content.asset",
  data: "content.own",
  prefs: "store.prefs (with an explicit prefs migration)",
  display: "presentation.display (first-party only)",
  subwindows: "presentation.subwindows (first-party only)",
  snapshot: "view.input",
  driver: "view.input().driver",
  controller: "act.controller",
  mods: "meta.mods",
  events: "events.on, events.off (known-data payloads)",
  knownLevel: "view.level",
  inspect: "view.inspect (inspectItem is item; spellInfo is spell)",
  intent: "act.submit, view.catalogue",
  prompt: "act.answer",
  tiles: "presentation.tiles (first-party only)",
  keyRepeat: "presentation.keyRepeat (first-party only)",
  options: "view.options, manage.options (first-party editor)",
  keybindings: "manage.keys (first-party editor)",
  knowledge: "view.knowledge (category and id select a recall page)",
  saves: "manage.saves (first-party only)",
  session: "manage.session (first-party only)",
  shared: "not yet in API 2: values shared between mods",
  title: "ui.title, presentation.title (first-party only)",
  profiles: "manage.profiles (first-party only)",
  controllerArmed: "meta.controllerArmed",
  character: "view.character, view.player().key, events.on(\"run-end\")",
  keymaps: "ui.keys",
  characterStore: "store.character",
  newCharacter: "meta.newCharacter",
  log: "meta.log",
  net: "net.request, net.credentials (credentials by opaque reference)",
  backupFolder: "backupFolder (under backup:folder)",
  ui: "ui.mount, ui.patch; presentation.panels (first-party DOM panels)",
  installMod: "manage.mods.planInstall, manage.mods.applyPlan (repository installs, first-party only)",
  reloadGame: "manage.reloadGame (first-party only)",
  loadModForSession: "manage.loadForSession (first-party only)",
  readMod: "manage.mods.discover (first-party only)",
  debug: "retired from public mods: debug tooling is first-party",
  wizard: "manage.wizard (first-party only, with debug:wizard)",
  registries: "engine.registries (in-process only, with engine:access)",
  composedRecords: "content.records, content.lookup",
});
