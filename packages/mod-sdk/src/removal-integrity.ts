/**
 * Removals that would leave the composed game broken (#372).
 *
 * A pack may remove a record it is allowed to touch, and most removals are
 * harmless. Two kinds are not, and both used to surface far from the mod that
 * caused them:
 *
 *  - A removal that leaves another record naming something that is no longer
 *    there. The worst case is a history chart: take away every phrase of a chart
 *    another chart leads to, and making a character throws "history entry
 *    references missing chart N" from the binder, with no mod named.
 *  - Removing the top of a history chart. A chart's phrases are cumulative
 *    thresholds over a roll of 1 to 100; without the roll-100 phrase a high roll
 *    has nowhere to land. The port falls back to the chart's last phrase where
 *    upstream's get_history would assert.
 *
 * THE BASELINE IS WHAT WAS ALREADY THERE. Core's own data has references that do
 * not resolve (references.ts lists them), so "nothing may dangle" would reject
 * Angband. What is refused here is narrower: a reference that dangles AND names a
 * record a removal took away. Before that removal it resolved, so the removal is
 * the cause, and the removal is what gets refused. A removal that takes a record
 * and everything that names it is fine, because nothing is left dangling.
 *
 * This only finds the removals. The loader refuses them, composes again without
 * them, and repeats until a pass finds none (composeContentPacks).
 */

import type { JsonRecord } from "./compose.js";
import { danglingReferences, normalizeRef, REFERENCE_EDGES, valuesAtPath } from "./references.js";

/** One removal that took effect in a composition. */
export interface LandedRemoval {
  /** The pack that asked for it. */
  readonly packId: string;
  /** The record file it applied to. */
  readonly file: string;
  /** The ref, exactly as the pack wrote it in `removes`. */
  readonly ref: string;
  /** The record as it stood when it was removed. */
  readonly record: JsonRecord;
}

/** A removal that has to be refused, and the reason in words a player can read. */
export interface BrokenRemoval {
  readonly removal: LandedRemoval;
  readonly why: string;
}

/** get_history rolls 1 to 100, so every chart needs a phrase at 100. */
const HISTORY_TOP_ROLL = 100;

/** A history record's chart number and roll, or undefined if it has none. */
function chartAndRoll(record: JsonRecord): { chart: number; roll: number } | undefined {
  const chart = record["chart"];
  if (chart === null || typeof chart !== "object" || Array.isArray(chart)) return undefined;
  const { chart: id, roll } = chart as JsonRecord;
  if (typeof id !== "number" || typeof roll !== "number") return undefined;
  return { chart: id, roll };
}

/**
 * The landed removals that leave `records` broken, each with its reason.
 *
 * `records` is the composed game after every removal in `removals` was applied.
 * A removal is listed at most once, with the first reason found.
 */
export function brokenRemovals(
  records: Readonly<Record<string, readonly JsonRecord[]>>,
  removals: readonly LandedRemoval[],
): BrokenRemoval[] {
  if (removals.length === 0) return [];
  const broken = new Map<LandedRemoval, string>();
  const blame = (removal: LandedRemoval, why: string): void => {
    if (!broken.has(removal)) broken.set(removal, why);
  };

  for (const dangling of danglingReferences(records)) {
    const edge = REFERENCE_EDGES.find((e) => e.file === dangling.file && e.path === dangling.path);
    if (edge === undefined) continue;
    for (const removal of removals) {
      if (removal.file !== edge.target) continue;
      const names = valuesAtPath(removal.record, edge.targetPath).map((v) =>
        normalizeRef(v, edge.normalize),
      );
      if (!names.includes(dangling.value)) continue;
      blame(removal, `${dangling.file} "${dangling.from}" still names it in ${dangling.path}`);
    }
  }

  const tops = new Map<number, number>();
  for (const record of records["history"] ?? []) {
    const at = chartAndRoll(record);
    if (at === undefined) continue;
    tops.set(at.chart, Math.max(tops.get(at.chart) ?? 0, at.roll));
  }
  for (const removal of removals) {
    if (removal.file !== "history") continue;
    const at = chartAndRoll(removal.record);
    if (at === undefined) continue;
    const top = tops.get(at.chart);
    /* A chart with no phrases left is only a problem if something leads to it,
     * and the reference check above has already caught that. */
    if (top === undefined || top >= HISTORY_TOP_ROLL || at.roll <= top) continue;
    blame(
      removal,
      `history chart ${String(at.chart)} would have no phrase for a roll above ${String(top)}`,
    );
  }

  return [...broken].map(([removal, why]) => ({ removal, why }));
}
