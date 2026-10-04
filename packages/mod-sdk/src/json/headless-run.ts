import { defineFormat, json } from "./index.js";
import type { ValidationIssue, Validator } from "./index.js";
import type { ModFindingReport } from "../mod-findings.js";

/**
 * What the headless runner reports after it boots the game under Node with a set
 * of mods, plays a fixed session, and plays it again with every mod off.
 *
 * The findings use the shared ModFindingReport shape, one report per mod. The
 * fields beside them (phases, per-mod health, the parity digests, the event
 * counts) belong to the runner alone.
 */

/** The steps of the scripted session, in the order they run. */
export type HeadlessRunPhaseName =
  | "load"
  | "boot"
  | "register"
  | "turns"
  | "level-change"
  | "inventory"
  | "save-reload"
  | "teardown"
  | "parity"
  | "worker";

export type HeadlessRunOutcome = "passed" | "failed" | "skipped" | "could-not-check";

export interface HeadlessRunPhase {
  readonly name: HeadlessRunPhaseName;
  readonly outcome: HeadlessRunOutcome;
  /** One plain sentence on what happened, when there is more to say than the outcome. */
  readonly detail?: string;
}

/** One mod the run was asked to load. */
export interface HeadlessRunMod {
  readonly id: string;
  readonly version?: string;
  readonly runtime: "data" | "in-process" | "worker";
  /** True when the loader accepted it (its content composed, or its code imported). */
  readonly loaded: boolean;
}

/** One mod's measurements from the run with mods on. Times are milliseconds. */
export interface HeadlessRunHealth {
  readonly id: string;
  /** The budget the run held it to: its manifest's `budget.msPerTurn`, or the default. */
  readonly budgetMs: number;
  readonly calls: number;
  readonly cpuMs: number;
  readonly worstMs: number;
  readonly worstSite: string | null;
  readonly faults: number;
  /** Turns in which it went over its budget. */
  readonly overBudget: number;
  /** Turns in which it went over the hard ceiling. */
  readonly ceilingBreaches: number;
  readonly switchedOff: boolean;
  /** Calls that failed because the mod used a capability its manifest does not grant. */
  readonly refusedCapabilities: number;
  /** Faults that arrived as a rejected promise. */
  readonly rejections: number;
}

/** The same session with the mods off and on, compared by a digest of the save. */
export interface HeadlessRunParity {
  /**
   * `match` and `drift` when the comparison ran; `not-applicable` when a mod in the
   * set declares a gameplay change; `could-not-check` when a mod declares itself
   * nondeterministic or a run did not finish.
   */
  readonly outcome: "match" | "drift" | "not-applicable" | "could-not-check";
  readonly offDigest: string | null;
  readonly onDigest: string | null;
  readonly detail?: string;
}

export interface HeadlessRunReport {
  /**
   * True when the game booted, no finding is serious or worse, and every check
   * above a note ran (a `could-not-check` warning is not a pass).
   */
  readonly passed: boolean;
  readonly booted: boolean;
  /** The engine version that ran the session. */
  readonly engine: string;
  readonly seed: number;
  readonly mods: readonly HeadlessRunMod[];
  readonly phases: readonly HeadlessRunPhase[];
  readonly health: readonly HeadlessRunHealth[];
  readonly parity: HeadlessRunParity;
  /** Events the game emitted while the mods were registered, and how many reached the end of the listener list. */
  readonly events: { readonly emitted: number; readonly delivered: number };
  /** Rejections outside any mod call that could not be traced to a mod. */
  readonly unattributedRejections: number;
  readonly reports: readonly ModFindingReport[];
}

const PHASES = [
  "load", "boot", "register", "turns", "level-change", "inventory", "save-reload", "teardown", "parity", "worker",
] as const;

const count = json.integer;
const ms = json.finiteNumber;

const evidence = json.object({
  file: json.optional(json.string),
  lines: json.optional(json.array(json.integer)),
  excerpt: json.optional(json.string),
});

const finding = json.object({
  rule: json.string,
  severity: json.enum(["block", "serious", "warning", "note"] as const),
  kind: json.enum(["safety", "functionality", "content", "packaging"] as const),
  outcome: json.enum(["found", "could-not-check"] as const),
  message: json.string,
  evidence: json.array(evidence),
  reproduction: json.optional(json.string),
  suggestedFix: json.optional(json.string),
});

const shape = json.object({
  passed: json.boolean,
  booted: json.boolean,
  engine: json.string,
  seed: json.integer,
  mods: json.array(json.object({
    id: json.string,
    version: json.optional(json.string),
    runtime: json.enum(["data", "in-process", "worker"] as const),
    loaded: json.boolean,
  })),
  phases: json.array(json.object({
    name: json.enum(PHASES),
    outcome: json.enum(["passed", "failed", "skipped", "could-not-check"] as const),
    detail: json.optional(json.string),
  })),
  health: json.array(json.object({
    id: json.string,
    budgetMs: ms,
    calls: count,
    cpuMs: ms,
    worstMs: ms,
    worstSite: json.nullable(json.string),
    faults: count,
    overBudget: count,
    ceilingBreaches: count,
    switchedOff: json.boolean,
    refusedCapabilities: count,
    rejections: count,
  })),
  parity: json.object({
    outcome: json.enum(["match", "drift", "not-applicable", "could-not-check"] as const),
    offDigest: json.nullable(json.string),
    onDigest: json.nullable(json.string),
    detail: json.optional(json.string),
  }),
  events: json.object({ emitted: count, delivered: count }),
  unattributedRejections: count,
  reports: json.array(json.object({
    source: json.object({ tool: json.string, version: json.string }),
    mod: json.object({
      id: json.string,
      version: json.optional(json.string),
      commit: json.optional(json.string),
    }),
    findings: json.array(finding),
  })),
});

/** The shape above, plus the one rule it cannot say: a line range is two numbers. */
const validator: Validator<HeadlessRunReport> = {
  validate(value, path = "$") {
    const result = shape.validate(value, path);
    if (!result.ok) return result;
    const issues: ValidationIssue[] = [];
    for (const [r, report] of result.value.reports.entries()) {
      for (const [f, found] of report.findings.entries()) {
        for (const [e, item] of found.evidence.entries()) {
          if (item.lines !== undefined && item.lines.length !== 2) {
            issues.push({
              path: `${path}["reports"][${r}]["findings"][${f}]["evidence"][${e}]["lines"]`,
              message: "expected a [first, last] line range",
            });
          }
        }
      }
    }
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: result.value as unknown as HeadlessRunReport };
  },
};

export const headlessRunFormat = defineFormat({
  format: "neo-angband/mod/headless-run",
  schemaVersion: 1,
  validator,
  sample: {
    passed: false,
    booted: true,
    engine: "1.22.0",
    seed: 20260715,
    mods: [{ id: "example-mod", version: "1.0.0", runtime: "in-process", loaded: true }],
    phases: [
      { name: "boot", outcome: "passed" },
      { name: "parity", outcome: "failed", detail: "The save differs with the mods on." },
    ],
    health: [{
      id: "example-mod",
      budgetMs: 50,
      calls: 12,
      cpuMs: 1.5,
      worstMs: 0.5,
      worstSite: "dungeonlevel listener",
      faults: 0,
      overBudget: 0,
      ceilingBreaches: 0,
      switchedOff: false,
      refusedCapabilities: 0,
      rejections: 0,
    }],
    parity: { outcome: "drift", offDigest: "0123456789abcdef", onDigest: "fedcba9876543210" },
    events: { emitted: 40, delivered: 40 },
    unattributedRejections: 0,
    reports: [{
      source: { tool: "headless-runner", version: "1.22.0" },
      mod: { id: "example-mod", version: "1.0.0" },
      findings: [{
        rule: "runner/parity-drift",
        severity: "serious",
        kind: "packaging",
        outcome: "found",
        message: "The mod changes the game but its manifest does not declare affectsGameplay.",
        evidence: [{ file: "manifest.json", excerpt: "save digest 0123456789abcdef with mods off, fedcba9876543210 with mods on" }],
        suggestedFix: "Add \"affectsGameplay\": true to the manifest.",
      }],
    }],
  },
});
