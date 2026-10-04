/**
 * The headless mod runner: boot the real game under Node with a set of mods, play
 * a short fixed session, and report what the mods did to it.
 *
 * It drives the same loader chain the page uses at boot (readModDir, loadModCode,
 * content composition, activeModHooks, the register() loop through the health
 * monitor, teardownModPlugins), so a mod that passes here met the same gates it
 * meets in the game. What it cannot reach is anything that needs a document: no
 * panels, no renderer, no input. A Worker-tier mod is listed and reported as not
 * checked until a host for Worker mods exists under Node (`HeadlessWorkerHost`).
 *
 * The session runs twice in one process, first with every mod off and then with
 * the set on, from the same seed and the same commands. When no mod in the set
 * declares a gameplay change, the two saves must agree; a difference is a
 * `runner/parity-drift` finding.
 *
 * Module state is global, so one run must finish before the next starts, and the
 * page's own singletons (the mod store, the disk report, the code latch, the
 * health monitor, core's mod registries) are reset at the start of each session.
 */

import {
  AgentCapabilityError,
  createModRegistryHost,
  decodeSavedGame,
  effectInfoRegistry,
  encodeSavedGame,
  ENGINE_VERSION,
  fnv1aIntegrity,
  GAME_EVENT_TYPES,
  GameEvents,
  gearGet,
  loadGame,
  randartRegistry,
  resetEffectInfoRegistry,
  resetRandartRegistry,
  resetRuneRegistry,
  resetTvalRegistry,
  runeRegistry,
  runGameLoop,
  saveGame,
  startGame,
  tvalRegistry,
  TV,
  VocabularyRegistry,
} from "@rpgm-tools/neo-angband-core";
import type { GamePack, PlayerCommand, StartedGame } from "@rpgm-tools/neo-angband-core";
import {
  CapabilityError,
  CapabilitySet,
  composedObjects,
  turnBudgetMs as declaredBudgetMs,
  worstSeverity,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type {
  HeadlessRunHealth,
  HeadlessRunMod,
  HeadlessRunParity,
  HeadlessRunPhase,
  HeadlessRunPhaseName,
  HeadlessRunReport,
  ModFinding,
  ModFindingReport,
  PackManifest,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { NO_DISK_PACKS, readModDir, resetDiskPacks, setDiskPacks } from "../disk-packs";
import type { DiskPackReport, ModDirSource } from "../disk-packs";
import { reportEventFault } from "../first-level";
import { MenuRegistry } from "../menu-registry";
import { loadModCode, resetModCode, setModCode } from "../mod-code";
import type { LoadedModWorker, ModCodeReport } from "../mod-code";
import { modOwnFiles, modPluginContext, setModComposedRecords, setModRegistries } from "../mod-context";
import { modHealth, turnBudgetMs } from "../mod-health";
import type { ModFault, ModOverBudget } from "../mod-health";
import { activeModHooks, resolveModRuleFlagsByMod } from "../mod-hooks";
import { setPrefsStorage } from "../mod-prefs";
import { faultMessage, reportModFault, resetModFaults } from "../mod-problems";
import { resetSharedValues, retireSharedValues } from "../mod-shared-values";
import { defaultModStore, resolveModRules, setModStorage } from "../mod-store";
import type { StorageLike } from "../mod-store";
import { resetSessionTaint } from "../mod-taint";
import { resetModTeardown, teardownModPlugins } from "../mod-teardown";
import {
  composedRecords,
  diskPackStatus,
  loadEnabledModRuleDecls,
  loadGamePack,
  presentNamespaces,
  resetComposition,
  sectionBirthChoices,
} from "../pack";
import { TileFillerRegistry } from "../tile-registry";

/** The tool name every finding report carries. */
export const HEADLESS_RUNNER_TOOL = "headless-runner";

/** The seed the session starts from unless the caller names another. */
export const DEFAULT_RUN_SEED = 20260715;

/**
 * Where a later step plugs in Worker-tier mods. The runner hands it the Worker
 * mods the loader accepted, after the in-process session, and merges what it
 * returns into each mod's report. Without one, each Worker mod gets a
 * `runner/worker-unsupported` finding.
 */
export interface HeadlessWorkerHost {
  check(workers: readonly LoadedModWorker[]): Promise<ReadonlyMap<string, readonly ModFinding[]>>;
}

export interface HeadlessRunOptions {
  /** The mods to load. `nodeModsSource` reads local folders. */
  readonly source: ModDirSource;
  /** Ids to turn on, in load order. Defaults to every mod the source lists. */
  readonly enable?: readonly string[];
  readonly seed?: number;
  readonly workerHost?: HeadlessWorkerHost;
  /** Replaces `import()` for a plugin's code (tests). */
  readonly importer?: (url: string) => Promise<unknown>;
  /**
   * Also count rejections that no mod call returned (`unhandledRejection` on the
   * Node process) and trace each to a mod by its stack. Off by default, because a
   * test runner owns that event; the command-line entry turns it on.
   */
  readonly watchProcess?: boolean;
}

/** Storage that lives only as long as the run. */
function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

function isCapabilityRefusal(error: unknown): boolean {
  return (
    error instanceof AgentCapabilityError ||
    error instanceof CapabilityError ||
    (error instanceof Error && error.constructor.name === "SandboxCapabilityError")
  );
}

function stackOf(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
}

/** Feed a fixed command list to the loop, one per step. */
function queue(commands: readonly PlayerCommand[]): () => PlayerCommand | null {
  const left = [...commands];
  return () => left.shift() ?? null;
}

const HOLD: PlayerCommand = { code: "hold" };

/** Save keys that describe the mod set or the message log rather than the game world. */
const DIGEST_SKIPS = new Set(["manifest", "mods", "sectionBirth", "orphans", "orphansAcknowledged", "messages"]);

/** A digest of the game world: the save with the mod-set bookkeeping left out. */
function stateDigest(game: StartedGame): string {
  const save = saveGame(game) as unknown as Record<string, unknown>;
  const world: Record<string, unknown> = {};
  for (const key of Object.keys(save).sort()) {
    if (!DIGEST_SKIPS.has(key)) world[key] = save[key];
  }
  return fnv1aIntegrity.digest(new TextEncoder().encode(JSON.stringify(world)));
}

interface EventCounts {
  emitted: number;
  delivered: number;
  /** Emits that ended early, with the mod a stack trace pointed to. */
  broken: { type: string; owner: string | null; error: unknown }[];
}

interface SessionResult {
  readonly booted: boolean;
  readonly phases: HeadlessRunPhase[];
  readonly digest: string | null;
  /** Phases that threw, with what they threw. */
  readonly failures: { phase: HeadlessRunPhaseName; error: unknown }[];
  readonly events: EventCounts;
}

/** Everything one run collects from the health monitor and the process. */
interface Collected {
  faults: ModFault[];
  overBudget: ModOverBudget[];
  unattributed: number;
  processRejections: Map<string, unknown[]>;
}

/** Back to a fresh page: every latch, store and registry the boot path reads. */
function resetHost(): void {
  setModStorage(memoryStorage());
  setPrefsStorage(memoryStorage());
  resetDiskPacks();
  resetModCode();
  resetComposition();
  resetModFaults();
  resetSessionTaint();
  resetSharedValues();
  resetModTeardown();
  resetCoreRegistries();
}

/** Core's mod-extendable registries back to core's own entries, as a reload leaves them. */
function resetCoreRegistries(): void {
  resetTvalRegistry();
  resetRuneRegistry();
  resetRandartRegistry();
  resetEffectInfoRegistry();
}

function activeModRules(): Record<string, boolean> {
  return resolveModRules(loadEnabledModRuleDecls(), defaultModStore().getRuleChoices());
}

/**
 * One session: boot, register, play, save and reload, tear down. `code` is the
 * loader's answer for the mods-on session and null for the mods-off one.
 */
function playSession(
  seed: number,
  code: ModCodeReport | null,
  attribute: (error: unknown) => string | null,
  setCurrent: (game: StartedGame | null) => void,
): SessionResult {
  const phases: HeadlessRunPhase[] = [];
  const failures: { phase: HeadlessRunPhaseName; error: unknown }[] = [];
  const events: EventCounts = { emitted: 0, delivered: 0, broken: [] };
  let stopped = false;

  /** Run one phase; a throw marks it failed and every later phase skipped. */
  const phase = (name: HeadlessRunPhaseName, body: () => string | void): void => {
    if (stopped) {
      phases.push({ name, outcome: "skipped", detail: "An earlier phase failed." });
      return;
    }
    try {
      const skipped = body();
      phases.push(skipped ? { name, outcome: "skipped", detail: skipped } : { name, outcome: "passed" });
    } catch (error) {
      failures.push({ phase: name, error });
      phases.push({ name, outcome: "failed", detail: faultMessage(error) });
      stopped = true;
    }
  };

  const plugins = code?.plugins ?? [];

  /** The page's register() loop over a started or loaded game, then the event probe. */
  const attach = (game: StartedGame, newCharacter: boolean): void => {
    const { state } = game;
    const bus = new GameEvents();
    state.events = bus;
    state.onEventFault = reportEventFault;
    setModRegistries(game.booted.registries);
    setModComposedRecords(composedObjects(composedRecords()));
    setCurrent(game);
    const menus = new MenuRegistry((owner, problem) => {
      if (owner !== null) reportModFault(owner, problem);
    });
    const tiles = new TileFillerRegistry((owner, problem) => {
      if (owner !== null) reportModFault(owner, problem);
    });
    const flags = resolveModRuleFlagsByMod();
    for (const loaded of plugins) {
      const register = loaded.plugin.register;
      if (!register) continue;
      const capabilities = CapabilitySet.fromManifest(loaded.manifest);
      try {
        const host = createModRegistryHost(
          {
            effects: game.effects,
            rooms: game.booted.registries.rooms,
            profiles: game.booted.registries.profiles,
            blows: state.blowEffects ?? null,
            stores: state.storeBehaviour ?? null,
            commands: game.registry,
            commandVerbs: state.commandVerbs ?? null,
            state,
            projections: state.projectionHandlers ?? null,
            uiEntry: state.uiEntry ?? null,
            glyphs: game.booted.registries.rooms.glyphs,
            effectInfo: effectInfoRegistry(),
            randart: randartRegistry(),
            tval: tvalRegistry(),
            rune: runeRegistry(),
            vocab: new VocabularyRegistry(),
            menus: menus.forOwner(loaded.id),
            tiles: tiles.forOwner(loaded.id),
          },
          capabilities,
        );
        modHealth().run(loaded.id, "register()", () =>
          register.call(
            loaded.plugin,
            host,
            modPluginContext(loaded.id, flags.get(loaded.id) ?? {}, state, modOwnFiles(loaded.data), {
              newCharacter,
              capabilities,
            }),
          ),
        );
      } catch (error) {
        /* The fault is already counted; the page drops the mod's shared values too. */
        reportModFault(loaded.id, `register() failed: ${faultMessage(error)}`);
        retireSharedValues(loaded.id);
      }
    }
    /* A listener on every event, after every mod's: each emit must reach it. */
    for (const type of GAME_EVENT_TYPES) bus.on(type, () => void (events.delivered += 1));
    const emit = bus.emit.bind(bus);
    bus.emit = ((type, data) => {
      events.emitted += 1;
      try {
        emit(type, data);
      } catch (error) {
        events.broken.push({ type, owner: attribute(error), error });
        throw error;
      }
    }) as GameEvents["emit"];
    game.resolveInitialStoreDiscounts();
    game.announceArrival();
  };

  const play = (game: StartedGame, commands: readonly PlayerCommand[]): void => {
    game.state.nextCommand = queue(commands);
    runGameLoop(game.state, game.registry);
    if (game.state.isDead) throw new Error("the character died during the scripted session");
  };

  const teardown = (): string[] => {
    const result = teardownModPlugins({ plugins, controller: null, retireSharedValues });
    return [...result.failed];
  };

  /* Cast so the assignments inside the phase callbacks are not narrowed away. */
  let pack = null as GamePack | null;
  let game = null as StartedGame | null;
  let booted = false as boolean;
  phase("boot", () => {
    pack = loadGamePack();
    const hooks = activeModHooks();
    game = startGame(pack, { seed, depth: 1, modRules: activeModRules(), ...(hooks ? { modHooks: hooks } : {}) });
    game.sectionBirth = sectionBirthChoices();
    booted = true;
  });
  phase("register", () => {
    attach(game!, true);
    return plugins.length === 0 ? "No mod in the set runs in-process code." : undefined;
  });
  phase("turns", () => play(game!, [HOLD, HOLD, HOLD, HOLD, HOLD]));
  phase("level-change", () => {
    const g = game!;
    g.changeLevel(g.state.chunk.depth + 1);
    g.state.generateLevel = false;
    play(g, [HOLD, HOLD]);
  });
  phase("inventory", () => {
    const g = game!;
    const handle = g.state.gear.pack.find((h) => gearGet(g.state.gear, h)?.tval === TV.POTION);
    if (handle === undefined) return "The character carries no potion to drink.";
    play(g, [{ code: "quaff", args: { handle } }, HOLD]);
    return undefined;
  });
  phase("save-reload", () => {
    const failed = teardown();
    if (failed.length > 0) throw new Error(`uninstall() failed before the save for: ${failed.join(", ")}`);
    const bytes = encodeSavedGame(saveGame(game!));
    const decoded = decodeSavedGame(bytes);
    if (!decoded.save || !decoded.verified) throw new Error("the save did not read back intact");
    /* A reload is a fresh page: core's registries, the teardown latch and shared values start over. */
    resetCoreRegistries();
    resetModTeardown();
    resetSharedValues();
    const hooks = activeModHooks();
    game = loadGame(pack!, decoded.save, presentNamespaces(), {
      modRules: activeModRules(),
      ...(hooks ? { modHooks: hooks } : {}),
    });
    attach(game, false);
    play(game, [HOLD, HOLD, HOLD]);
  });
  let digest: string | null = null;
  if (!stopped && game) {
    try {
      digest = stateDigest(game);
    } catch (error) {
      failures.push({ phase: "parity", error });
    }
  }
  phase("teardown", () => {
    const failed = teardown();
    if (failed.length > 0) throw new Error(`uninstall() failed for: ${failed.join(", ")}`);
  });
  setCurrent(null);
  return { booted, phases, digest, failures, events };
}

/** Group faults by mod, rule and site so a fault that repeats each turn is one finding. */
function faultFindings(id: string, faults: readonly ModFault[]): ModFinding[] {
  const groups = new Map<string, { rule: string; site: string; first: ModFault; count: number }>();
  for (const fault of faults) {
    if (fault.id !== id) continue;
    const rule = isCapabilityRefusal(fault.error)
      ? "runner/capability-refused"
      : fault.rejected
        ? "runner/unhandled-rejection"
        : fault.site.endsWith(" listener")
          ? "runner/listener-fault"
          : fault.site.endsWith(" hook") || fault.site === "hooks()"
            ? "runner/hook-fault"
            : fault.site === "register()"
              ? "runner/register-fault"
              : fault.site === "uninstall()"
                ? "runner/teardown-fault"
                : "runner/fault";
    const key = `${rule}\u0000${fault.site}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { rule, site: fault.site, first: fault, count: 1 });
  }
  return [...groups.values()].map(({ rule, site, first, count }) => {
    const times = count === 1 ? "once" : `${count} times`;
    const why = faultMessage(first.error);
    if (rule === "runner/capability-refused") {
      return {
        rule,
        severity: "warning",
        kind: "functionality",
        outcome: "found",
        message: `Its ${site} was refused a capability ${times}: ${why}`,
        evidence: [{ file: "manifest.json", excerpt: why }],
        suggestedFix: "Declare the capability in the manifest's capabilities list, or stop using it.",
      };
    }
    return {
      rule,
      severity: "serious",
      kind: "functionality",
      outcome: "found",
      message: `Its ${site} ${first.rejected ? "returned a promise that rejected" : "threw"} ${times}, first on turn ${first.turn}: ${why}`,
      evidence: [{ excerpt: why }],
      reproduction: "Run the headless runner on this mod; the session is fixed by its seed.",
    };
  });
}

function healthFor(
  id: string,
  budgetMs: number,
  collected: Collected,
): HeadlessRunHealth {
  const stats = modHealth().stats().find((s) => s.id === id);
  const faults = collected.faults.filter((f) => f.id === id);
  return {
    id,
    budgetMs,
    calls: stats?.calls ?? 0,
    cpuMs: round(stats?.cpuMs ?? 0),
    worstMs: round(stats?.worstMs ?? 0),
    worstSite: stats?.worstSite ?? null,
    faults: stats?.faults ?? 0,
    overBudget: stats?.overBudget ?? 0,
    ceilingBreaches: stats?.ceilingBreaches ?? 0,
    switchedOff: stats?.switchedOff != null,
    refusedCapabilities: faults.filter((f) => isCapabilityRefusal(f.error)).length,
    rejections:
      faults.filter((f) => f.rejected).length + (collected.processRejections.get(id)?.length ?? 0),
  };
}

/**
 * Boot the game with the mods in `options.source`, play the fixed session with
 * them off and then on, and report. Never throws for a mod's fault; a source that
 * cannot be read is a `load` phase failure.
 */
export async function runHeadless(options: HeadlessRunOptions): Promise<HeadlessRunReport> {
  const seed = options.seed ?? DEFAULT_RUN_SEED;
  const collected: Collected = { faults: [], overBudget: [], unattributed: 0, processRejections: new Map() };
  let current: StartedGame | null = null;
  const setCurrent = (game: StartedGame | null): void => {
    current = game;
  };

  /* Read the folders once; both sessions see the same bytes. */
  let report: DiskPackReport = NO_DISK_PACKS;
  let readError: unknown = null;
  try {
    report = await readModDir(options.source);
  } catch (error) {
    readError = error;
  }
  const manifests = new Map<string, PackManifest>(report.packs.map((p) => [p.manifest.id, p.manifest]));
  const enabled = [...(options.enable ?? report.packs.map((p) => p.manifest.id))];
  const budgets = new Map(enabled.map((id) => [id, turnBudgetMs(manifests.has(id) ? declaredBudgetMs(manifests.get(id)!) : undefined)]));

  /* Each plugin's folder as a URL and as a path, to trace a stack back to the mod whose file it ran in. */
  const codeRoots = new Map<string, readonly string[]>();
  const attribute = (error: unknown): string | null => {
    const stack = stackOf(error);
    for (const [id, roots] of codeRoots) if (roots.some((root) => stack.includes(root))) return id;
    return null;
  };

  const configureHealth = (): void => {
    modHealth().reset({
      turn: () => current?.state.turn ?? 0,
      enforce: true,
      budgetFor: (id) => budgets.get(id) ?? turnBudgetMs(),
      onFault: (fault) => void collected.faults.push(fault),
      onOverBudget: (over) => void collected.overBudget.push(over),
    });
  };

  /* Session one: every mod off. */
  resetHost();
  configureHealth();
  const off = playSession(seed, null, attribute, setCurrent);

  /* Session two: the set on, through the page's loader. */
  resetHost();
  configureHealth();
  collected.faults.length = 0;
  collected.overBudget.length = 0;
  const loadPhase: HeadlessRunPhase[] = [];
  let code: ModCodeReport = { plugins: [], workers: [], problems: [], skipped: [] };
  const consent = (id: string): readonly string[] => manifests.get(id)?.capabilities ?? [];
  if (readError !== null) {
    loadPhase.push({ name: "load", outcome: "failed", detail: `The mods could not be read: ${faultMessage(readError)}` });
  } else {
    setDiskPacks(report);
    defaultModStore().setEnabled(enabled);
    code = await loadModCode({
      packs: report.packs,
      codeUrl: report.codeUrl,
      enabled: (id) => enabled.includes(id),
      /* The run grants what each manifest asks for; a refusal is then a capability the mod uses without declaring it. */
      consented: consent,
      ...(options.importer ? { importer: options.importer } : {}),
    });
    setModCode(code);
    loadPhase.push({ name: "load", outcome: "passed" });
  }
  for (const loaded of code.plugins) {
    const root = loaded.url.slice(0, loaded.url.lastIndexOf("/") + 1);
    codeRoots.set(loaded.id, [root, decodeURIComponent(root.replace(/^file:\/\/\/?/u, ""))]);
  }

  const proc = options.watchProcess === true
    ? (globalThis as { process?: { on(e: string, f: (r: unknown) => void): void; off(e: string, f: (r: unknown) => void): void } }).process
    : undefined;
  const onRejection = (reason: unknown): void => {
    const owner = attribute(reason);
    if (owner === null) collected.unattributed += 1;
    else collected.processRejections.set(owner, [...(collected.processRejections.get(owner) ?? []), reason]);
  };
  proc?.on("unhandledRejection", onRejection);
  const on = playSession(seed, readError === null ? code : null, attribute, setCurrent);
  /* Let promises a mod left running settle, so their rejections are counted. */
  await new Promise((settle) => setTimeout(settle, 0));
  proc?.off("unhandledRejection", onRejection);

  const status = diskPackStatus();
  const findings = new Map<string, ModFinding[]>(enabled.map((id) => [id, []]));
  const add = (id: string, finding: ModFinding): void => {
    const list = findings.get(id);
    if (list) list.push(finding);
    else findings.set(id, [finding]);
  };

  /* Loading. */
  for (const problem of [...report.problems, ...status.problems, ...code.problems]) {
    if (problem.id === null || !findings.has(problem.id)) continue;
    const list = findings.get(problem.id)!;
    if (list.some((f) => f.rule === "runner/load-problem" && f.message === problem.why)) continue;
    if (collected.faults.some((f) => f.id === problem.id && problem.why.includes(faultMessage(f.error)))) continue;
    add(problem.id, {
      rule: "runner/load-problem",
      severity: "serious",
      kind: "packaging",
      outcome: "found",
      message: `The loader reported: ${problem.why}`,
      evidence: [{ file: "manifest.json", excerpt: problem.why }],
    });
  }
  for (const id of enabled) {
    if (!manifests.has(id)) {
      add(id, {
        rule: "runner/not-found",
        severity: "block",
        kind: "packaging",
        outcome: "found",
        message: "No mod with this id was found in the folders given.",
        evidence: [],
      });
    }
  }

  /* Faults, budgets, switch-offs. */
  for (const id of enabled) {
    for (const finding of faultFindings(id, collected.faults)) add(id, finding);
    const over = collected.overBudget.filter((o) => o.id === id);
    if (over.length > 0) {
      const worst = over.reduce((a, b) => (b.ms > a.ms ? b : a));
      const ceiling = over.some((o) => o.ceiling);
      add(id, {
        rule: "runner/over-budget",
        severity: ceiling ? "serious" : "warning",
        kind: "functionality",
        outcome: "found",
        message: `It went over its ${worst.budgetMs} ms per-turn budget in ${over.length} turn${over.length === 1 ? "" : "s"}, ${round(worst.ms)} ms at worst${ceiling ? ", past the hard ceiling" : ""}.`,
        evidence: [{ excerpt: `${round(worst.ms)} ms on turn ${worst.turn}` }],
        suggestedFix: "Do less work per turn, or declare a larger budget.msPerTurn in the manifest (500 at most).",
      });
    }
    const switched = modHealth().stats().find((s) => s.id === id)?.switchedOff;
    if (switched) {
      add(id, {
        rule: "runner/switched-off",
        severity: "serious",
        kind: "functionality",
        outcome: "found",
        message: `The game switched it off for the session after repeated faults, the last in its ${switched.site}: ${switched.why}`,
        evidence: [{ excerpt: switched.why }],
      });
    }
    for (const reason of collected.processRejections.get(id) ?? []) {
      add(id, {
        rule: "runner/unhandled-rejection",
        severity: "serious",
        kind: "functionality",
        outcome: "found",
        message: `A promise it started rejected with nothing to handle it: ${faultMessage(reason)}`,
        evidence: [{ excerpt: faultMessage(reason) }],
      });
    }
  }

  /* Event isolation: every emit reaches the listener added after the mods'. */
  for (const broken of on.events.broken) {
    const owners = broken.owner !== null ? [broken.owner] : code.plugins.map((p) => p.id);
    for (const id of owners) {
      add(id, {
        rule: "runner/event-isolation",
        severity: "serious",
        kind: "functionality",
        outcome: "found",
        message: `A ${broken.type} event stopped before reaching every listener: ${faultMessage(broken.error)}`,
        evidence: [{ excerpt: faultMessage(broken.error) }],
        suggestedFix: "Subscribe through ctx.events rather than the raw event bus on ctx.state.",
      });
    }
  }

  /* A phase that threw in the mods-on session and not in the mods-off one. */
  for (const failure of on.failures) {
    if (off.failures.some((f) => f.phase === failure.phase)) continue;
    const owner = attribute(failure.error);
    const owners = owner !== null ? [owner] : enabled;
    for (const id of owners) {
      add(id, {
        rule: failure.phase === "boot" ? "runner/boot-failed" : "runner/session-failed",
        severity: failure.phase === "boot" ? "block" : "serious",
        kind: "functionality",
        outcome: "found",
        message: `The ${failure.phase} step failed with the mods on: ${faultMessage(failure.error)}`,
        evidence: [{ excerpt: faultMessage(failure.error) }],
        reproduction: "Run the headless runner on this mod; the session is fixed by its seed.",
      });
    }
  }

  /* Parity. */
  const declaresChange = enabled.filter((id) => manifests.get(id)?.affectsGameplay === true);
  const nondeterministic = enabled.filter((id) => manifests.get(id)?.nondeterministic === true);
  let parity: HeadlessRunParity;
  if (declaresChange.length > 0) {
    parity = {
      outcome: "not-applicable",
      offDigest: off.digest,
      onDigest: on.digest,
      detail: `${declaresChange.join(", ")} declares a gameplay change.`,
    };
  } else if (nondeterministic.length > 0) {
    parity = {
      outcome: "could-not-check",
      offDigest: off.digest,
      onDigest: on.digest,
      detail: `${nondeterministic.join(", ")} declares itself nondeterministic.`,
    };
    for (const id of nondeterministic) {
      add(id, {
        rule: "runner/parity-unchecked",
        severity: "note",
        kind: "functionality",
        outcome: "could-not-check",
        message: "The mod declares itself nondeterministic, so its effect on the game was not compared.",
        evidence: [{ file: "manifest.json", excerpt: "\"nondeterministic\": true" }],
      });
    }
  } else if (off.digest === null || on.digest === null) {
    parity = {
      outcome: "could-not-check",
      offDigest: off.digest,
      onDigest: on.digest,
      detail: "A session did not finish, so there was nothing to compare.",
    };
  } else if (off.digest === on.digest) {
    parity = { outcome: "match", offDigest: off.digest, onDigest: on.digest };
  } else {
    parity = {
      outcome: "drift",
      offDigest: off.digest,
      onDigest: on.digest,
      detail: "The save differs with the mods on, and no mod declares a gameplay change.",
    };
    for (const id of enabled.filter((m) => manifests.has(m))) {
      add(id, {
        rule: "runner/parity-drift",
        severity: "serious",
        kind: "packaging",
        outcome: "found",
        message: enabled.length === 1
          ? "The mod changes the game, but its manifest does not declare affectsGameplay."
          : "The mod set changes the game and no mod declares affectsGameplay; run each mod alone to find which one.",
        evidence: [{ file: "manifest.json", excerpt: `save digest ${off.digest} with mods off, ${on.digest} with mods on` }],
        reproduction: `Run the headless runner with seed ${seed}; the digests differ on every run.`,
        suggestedFix: "Add \"affectsGameplay\": true to the manifest if the change is intended.",
      });
    }
  }

  /* Worker-tier mods. */
  const workerPhase: HeadlessRunPhase[] = [];
  if (code.workers.length > 0) {
    if (options.workerHost) {
      try {
        const results = await options.workerHost.check(code.workers);
        for (const [id, list] of results) for (const finding of list) add(id, finding);
        workerPhase.push({ name: "worker", outcome: "passed" });
      } catch (error) {
        workerPhase.push({ name: "worker", outcome: "failed", detail: faultMessage(error) });
      }
    } else {
      workerPhase.push({ name: "worker", outcome: "could-not-check", detail: "Worker tier not supported headless yet." });
      for (const worker of code.workers) {
        add(worker.id, {
          rule: "runner/worker-unsupported",
          severity: "warning",
          kind: "functionality",
          outcome: "could-not-check",
          message: "Could not check: Worker tier not supported headless yet.",
          evidence: [{ file: "manifest.json", excerpt: "\"runtime\": \"worker\"" }],
        });
      }
    }
  }

  const loadedIds = new Set([...code.plugins.map((p) => p.id), ...code.workers.map((w) => w.id)]);
  const mods: HeadlessRunMod[] = enabled.map((id) => {
    const manifest = manifests.get(id);
    const runtime = manifest?.runtime ?? "data";
    const failedLoad = (findings.get(id) ?? []).some((f) => f.rule === "runner/load-problem" || f.rule === "runner/not-found");
    return {
      id,
      ...(manifest?.version ? { version: manifest.version } : {}),
      runtime,
      loaded: manifest !== undefined && (runtime === "data" ? !failedLoad : loadedIds.has(id)),
    };
  });

  const reports: ModFindingReport[] = enabled.map((id) => {
    const version = manifests.get(id)?.version;
    return {
      source: { tool: HEADLESS_RUNNER_TOOL, version: ENGINE_VERSION },
      mod: { id, ...(version ? { version } : {}) },
      findings: findings.get(id) ?? [],
    };
  });

  const parityPhase: HeadlessRunPhase = {
    name: "parity",
    outcome: parity.outcome === "drift"
      ? "failed"
      : parity.outcome === "match"
        ? "passed"
        : parity.outcome === "not-applicable" ? "skipped" : "could-not-check",
    ...(parity.detail ? { detail: parity.detail } : {}),
  };

  const all = reports.flatMap((r) => r.findings);
  const worst = worstSeverity(all.filter((f) => f.outcome === "found"));
  /* A check that could not run is not a pass, unless it is only a note. */
  const unchecked = all.some((f) => f.outcome === "could-not-check" && f.severity !== "note");
  return {
    passed: on.booted && worst !== "block" && worst !== "serious" && !unchecked,
    booted: on.booted,
    engine: ENGINE_VERSION,
    seed,
    mods,
    phases: [...loadPhase, ...on.phases, parityPhase, ...workerPhase],
    health: enabled.map((id) => healthFor(id, budgets.get(id) ?? turnBudgetMs(), collected)),
    parity,
    events: { emitted: on.events.emitted, delivered: on.events.delivered },
    unattributedRejections: collected.unattributed,
    reports,
  };
}
