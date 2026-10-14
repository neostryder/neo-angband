/**
 * Worker mods in the game's hook folds.
 *
 * A hook runs inside a turn and answers at once, so a Worker mod never answers
 * one itself. The host holds what the mod declared: its policy tables, which
 * the host interprets synchronously (api2PoliciesToHooks), and the
 * notification hooks it asked to be told about, which the host forwards to
 * the Worker without waiting.
 *
 * The game composes its hooks when a game starts or loads, and the first game
 * of a session starts before the Worker mods have loaded. A Worker mod that
 * has not settled yet therefore contributes every hook it could fill, each
 * answering neutrally (the text unchanged, the entry kept, no opinion) until
 * it settles, and reading the settled tables from then on. A game composed
 * after it settled gets only the hooks it filled.
 */

import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import type { Api2Hooks } from "@rpgm-tools/neo-angband-mod-sdk";
import { api2ToModHooks } from "../mod-api2-shim";

/** What a settled Worker mod contributes. */
export interface SettledWorkerHooks {
  /** Its policy tables as hooks. */
  readonly policies: Api2Hooks;
  /** The notification hooks it declared. */
  readonly notify: readonly string[];
  /** Forward one notification to its Worker. */
  readonly send: (hook: string, args: readonly unknown[]) => void;
}

interface Entry {
  readonly hooks: ModHooks;
  readonly notify: ReadonlySet<string>;
  readonly send: (hook: string, args: readonly unknown[]) => void;
}

/* null: settled with nothing to contribute (it failed to load, or stopped). */
const settled = new Map<string, Entry | null>();

/** Record what a Worker mod contributes, or null for nothing. */
export function settleWorkerHooks(id: string, value: SettledWorkerHooks | null): void {
  settled.set(id, value === null ? null : {
    hooks: api2ToModHooks(value.policies),
    notify: new Set(value.notify),
    send: value.send,
  });
}

/** Forget every Worker mod's hooks (a reload, and tests). */
export function resetWorkerHooks(): void {
  settled.clear();
}

/** The notification hooks core calls. */
const NOTIFY = ["optionsChanged", "abilityGained", "monsterBecameVisible", "artifactIdentified"] as const;

function forward(entry: () => Entry | null | undefined, hook: (typeof NOTIFY)[number]) {
  return (arg: unknown): void => {
    const e = entry();
    if (e?.notify.has(hook)) e.send(hook, [arg]);
  };
}

/** The hooks a pending Worker mod contributes: each reads the settled tables when they exist, and answers neutrally until then. */
function pendingHooks(id: string): ModHooks {
  const entry = (): Entry | null | undefined => settled.get(id);
  const hooks = (): ModHooks | undefined => entry()?.hooks;
  return {
    messageText: (raw) => hooks()?.messageText?.(raw) ?? raw,
    screenText: (raw, site) => hooks()?.screenText?.(raw, site) ?? raw,
    characterBackground: (text) => hooks()?.characterBackground?.(text) ?? text,
    objectInfoText: (text, site) => hooks()?.objectInfoText?.(text, site) ?? text,
    effectIntro: (intro) => hooks()?.effectIntro?.(intro) ?? intro.text,
    historyAdd: (item) => hooks()?.historyAdd?.(item) ?? true,
    historyDisplay: (item, playerName) => hooks()?.historyDisplay?.(item, playerName) ?? item.what,
    objectListTiebreak: (a, b) => hooks()?.objectListTiebreak?.(a, b) ?? 0,
    saveNoiseScent: () => hooks()?.saveNoiseScent?.() ?? false,
    shapeLearnObviousFlagsDirectly: () => hooks()?.shapeLearnObviousFlagsDirectly?.() ?? false,
    optionsChanged: forward(entry, "optionsChanged"),
    abilityGained: forward(entry, "abilityGained"),
    monsterBecameVisible: forward(entry, "monsterBecameVisible"),
    artifactIdentified: forward(entry, "artifactIdentified"),
  };
}

/**
 * What Worker mod `id` contributes to the game's hooks right now: everything
 * it could fill while it is loading, exactly what it filled once it settled,
 * and nothing when it settled with nothing.
 */
export function workerModHooks(id: string): ModHooks | undefined {
  const entry = settled.get(id);
  if (entry === undefined) return pendingHooks(id);
  if (entry === null) return undefined;
  const out: ModHooks = { ...entry.hooks };
  const live = (): Entry | null | undefined => settled.get(id);
  for (const hook of NOTIFY) if (entry.notify.has(hook)) (out as Record<string, unknown>)[hook] = forward(live, hook);
  return Object.keys(out).length > 0 ? out : undefined;
}
