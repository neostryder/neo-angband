/**
 * Baseline capture + tolerance comparison - the CI regression guard.
 *
 * The committed baseline (packages/cli/baseline/stats-baseline.json) is a
 * stats report captured FROM THE PORT ITSELF at a fixed seed and run count.
 * What it proves and what it does NOT:
 *
 *   PROVES  - self-consistency: any future change that shifts the port's
 *             generation / allocation distributions (a reordered RNG draw, a
 *             changed allocation table, a new monster) makes a fresh batch
 *             diverge from the baseline and fails CI. Because the port is
 *             bit-exact for a fixed seed, the default tolerance is ZERO: the
 *             fresh batch must reproduce the baseline integer-for-integer.
 *
 *   DOES NOT - prove parity with the C game. The baseline was produced by the
 *             port, so it cannot detect a bug the port and its baseline share.
 *             It is a self-regression guard, not a C-vs-TS distribution diff.
 *
 * Upgrading to a true cross-implementation parity check: run the C
 * `main-stats` tool (reference/, built with USE_STATS) to produce its SQLite
 * database, export the same metrics to this JSON shape with meta.generatedBy
 * = "c-main-stats", drop it in as the baseline, and compare with the
 * STATISTICAL tolerance preset + rate normalization (below) - the C and TS
 * RNG streams differ, so only the DISTRIBUTIONS can match, within tolerance,
 * not the exact integers. See packages/cli/baseline/README.md.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { DepthMetrics, StatsReport } from "./stats";

/** Per-metric tolerance: a value passes if within max(abs, rel*|baseline|). */
export interface Tolerance {
  /** Absolute slack. */
  abs: number;
  /** Relative slack (fraction of the baseline magnitude). */
  rel: number;
}

/** Comparison options. */
export interface CompareOptions {
  /** Tolerance applied to every compared number. Default EXACT (0, 0). */
  tolerance: Tolerance;
  /**
   * Compare per-level RATES (metric / that depth's `levels`) instead of raw
   * totals, so a baseline captured with a different run count still compares.
   * Required for a C-vs-TS diff (different run counts); off for the self-guard.
   */
  normalizeByLevels: boolean;
  /**
   * Restrict the scalar metrics compared (default: all of SCALAR_KEYS). A
   * C-vs-TS diff scopes this to the metrics the C baseline actually populates
   * (the C import omits object totals), so an unpopulated field is not a false
   * diff. Ignored keys are simply not checked.
   */
  scalarKeys?: readonly (keyof DepthMetrics)[];
  /** Restrict the record metrics compared (default: all of RECORD_KEYS). */
  recordKeys?: readonly (keyof DepthMetrics)[];
}

/** EXACT: the self-regression default - the port must reproduce every integer. */
export const EXACT_TOLERANCE: Tolerance = { abs: 0, rel: 0 };

/**
 * A starting point for a real C-vs-TS distribution diff: 5% relative slack with
 * a small absolute floor for rare events. Tune per metric as the C baseline is
 * brought in; this is a documented default, not a claim that 5% is "parity".
 */
export const STATISTICAL_TOLERANCE: Tolerance = { abs: 2, rel: 0.05 };

/** One out-of-tolerance difference. */
export interface Diff {
  /** Dotted path, e.g. "depths.3.monsterTotal" or "depths.3.monsters.42". */
  path: string;
  baseline: number;
  fresh: number;
  /** The allowed slack that was exceeded. */
  allowed: number;
}

/** The result of comparing a fresh report to a baseline. */
export interface CompareResult {
  ok: boolean;
  diffs: Diff[];
  /** Structural problems (shape mismatch) that make a numeric diff meaningless. */
  structural: string[];
}

const SCALAR_KEYS = [
  "levels",
  "monsterTotal",
  "objectTotal",
  "artifacts",
  "gold",
] as const satisfies readonly (keyof DepthMetrics)[];

const RECORD_KEYS = [
  "monsters",
  "objectsByTval",
  "objectsByKind",
  "goldByOrigin",
  "objFeeling",
  "monFeeling",
] as const satisfies readonly (keyof DepthMetrics)[];

function within(baseline: number, fresh: number, tol: Tolerance): boolean {
  const allowed = Math.max(tol.abs, tol.rel * Math.abs(baseline));
  return Math.abs(fresh - baseline) <= allowed + 1e-9;
}

function allowedSlack(baseline: number, tol: Tolerance): number {
  return Math.max(tol.abs, tol.rel * Math.abs(baseline));
}

/**
 * Compare a fresh report against a baseline with per-metric tolerances.
 * Returns every out-of-tolerance number plus any structural mismatch.
 */
export function compareReports(
  baseline: StatsReport,
  fresh: StatsReport,
  options: Partial<CompareOptions> = {},
): CompareResult {
  const tol = options.tolerance ?? EXACT_TOLERANCE;
  const normalize = options.normalizeByLevels ?? false;
  const scalarKeys = options.scalarKeys ?? SCALAR_KEYS;
  const recordKeys = options.recordKeys ?? RECORD_KEYS;
  const diffs: Diff[] = [];
  const structural: string[] = [];

  const baseDepths = Object.keys(baseline.depths).sort();
  const freshDepths = Object.keys(fresh.depths).sort();
  if (baseDepths.join(",") !== freshDepths.join(",")) {
    structural.push(
      `depth set differs: baseline [${baseDepths.join(",")}] vs fresh [${freshDepths.join(",")}]`,
    );
  }

  const rate = (m: DepthMetrics, v: number): number =>
    normalize ? (m.levels > 0 ? v / m.levels : 0) : v;

  for (const depth of baseDepths) {
    const b = baseline.depths[depth];
    const f = fresh.depths[depth];
    if (!b || !f) continue;

    for (const key of scalarKeys) {
      /* Under normalization `levels` is the divisor, so comparing it as a rate
       * is meaningless (always 1); compare it raw only when not normalizing. */
      if (key === "levels" && normalize) continue;
      const bv = rate(b, b[key] as number);
      const fv = rate(f, f[key] as number);
      if (!within(bv, fv, tol)) {
        diffs.push({
          path: `depths.${depth}.${key}`,
          baseline: bv,
          fresh: fv,
          allowed: allowedSlack(bv, tol),
        });
      }
    }

    for (const key of recordKeys) {
      const br = b[key] as Record<string, number>;
      const fr = f[key] as Record<string, number>;
      const allKeys = new Set([...Object.keys(br), ...Object.keys(fr)]);
      for (const k of allKeys) {
        const bv = rate(b, br[k] ?? 0);
        const fv = rate(f, fr[k] ?? 0);
        if (!within(bv, fv, tol)) {
          diffs.push({
            path: `depths.${depth}.${key}.${k}`,
            baseline: bv,
            fresh: fv,
            allowed: allowedSlack(bv, tol),
          });
        }
      }
    }
  }

  return { ok: diffs.length === 0 && structural.length === 0, diffs, structural };
}

/** The committed baseline path, resolved relative to this module (src or dist). */
export const BASELINE_URL = new URL(
  "../baseline/stats-baseline.json",
  import.meta.url,
);

/** Load and parse the committed baseline. */
export function loadBaseline(): StatsReport {
  return JSON.parse(readFileSync(BASELINE_URL, "utf8")) as StatsReport;
}

/**
 * The committed REAL upstream baseline, imported from the C main-stats tool
 * (meta.generatedBy = "c-main-stats"). This - unlike stats-baseline.json - is
 * ground truth from Angband 4.2.6, so the port is diffed AGAINST it. Produced
 * by main-cimport.ts; see baseline/README.md.
 */
export const C_BASELINE_URL = new URL(
  "../baseline/c-stats-baseline.json",
  import.meta.url,
);

/** Load the committed C baseline, or null if it has not been generated. */
export function loadCBaseline(): StatsReport | null {
  try {
    return JSON.parse(readFileSync(C_BASELINE_URL, "utf8")) as StatsReport;
  } catch {
    return null;
  }
}

/** Overwrite the committed baseline with `content` (used by the regen script). */
export function writeBaseline(content: string): void {
  writeFileSync(BASELINE_URL, content);
}

/** Render a compare result as a short human-readable report. */
export function formatCompareResult(result: CompareResult): string {
  if (result.ok) return "parity: OK (fresh batch matches baseline within tolerance)";
  const lines: string[] = ["parity: FAIL"];
  for (const s of result.structural) lines.push(`  structural: ${s}`);
  const shown = result.diffs.slice(0, 40);
  for (const d of shown) {
    lines.push(
      `  ${d.path}: baseline=${d.baseline} fresh=${d.fresh} (allowed +/-${d.allowed})`,
    );
  }
  if (result.diffs.length > shown.length) {
    lines.push(`  ... and ${result.diffs.length - shown.length} more`);
  }
  return lines.join("\n");
}
