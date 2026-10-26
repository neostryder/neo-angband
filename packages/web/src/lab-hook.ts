/**
 * The read-only window a lab build gives a test harness (`window.__neoLab`).
 *
 * Built here, from accessors, so the shape can be tested without a game: main.ts
 * hands it the live pieces and registers the result only when `labBuild()` is
 * true. A release build never reaches that call, and the hook holds no state of
 * its own.
 *
 * It answers four kinds of question, cheapest first. `screen()` is the grid as
 * text. `turn()`, `modal()` and `size()` are one value each. `view()` is the same
 * world a mod holding every `state:*` grant reads (the input snapshot), cloned to
 * plain JSON so a harness can pick a path out of it, and `messages(n)` is the last
 * n lines of the message log, newest last. `seed()` is the master seed the page
 * started from, so a failing run can be replayed with `--lab-seed`. `wizard` is
 * the typed debug facade a `debug:wizard` mod holds, behind the same refusal until
 * the session is cut loose from its save.
 */

import type { ModWizard } from "./mod-plugin";

/** The history buffer, oldest first, as the web MessageLog hands it out. */
export interface LabMessageLog {
  all(): readonly { readonly text: string; readonly count: number }[];
}

export interface LabHookDeps {
  readonly screen: () => unknown;
  readonly size: () => unknown;
  readonly modal: () => boolean;
  readonly turn: () => number;
  readonly seed: () => number;
  readonly snapshot: () => unknown;
  readonly log: LabMessageLog;
  readonly wizard: ModWizard;
}

export interface LabMessage {
  readonly text: string;
  readonly count: number;
}

/** The last `n` messages, oldest first; a repeated line carries its count. */
export function lastMessages(log: LabMessageLog, n: number): readonly LabMessage[] {
  const lines = log.all();
  const take = Math.min(lines.length, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
  return lines.slice(lines.length - take).map((line) => ({ text: line.text, count: line.count }));
}

/** A value as plain JSON, or null when there is none (no game yet). */
export function plainJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v)));
}

export function createLabHook(deps: LabHookDeps) {
  return {
    screen: deps.screen,
    size: deps.size,
    modal: deps.modal,
    turn: deps.turn,
    seed: deps.seed,
    view: (): unknown => plainJson(deps.snapshot()),
    messages: (n = 10): readonly LabMessage[] => lastMessages(deps.log, n),
    wizard: deps.wizard,
  };
}
