/**
 * Import a REAL upstream Angband 4.2.6 statistics database into the port's
 * StatsReport shape, so the parity harness can diff the port against actual C
 * output instead of against itself (audit 07 AUX-2 / runbook Phase 0).
 *
 * The C `main-stats` front end (reference/src/main-stats.c, built with
 * USE_STATS) descends a fresh wizard character through every dungeon level,
 * `num_runs` times, and writes per-level aggregate distributions to a SQLite
 * database. This module reads that database and maps the cleanly-comparable
 * generation metrics into a StatsReport with meta.generatedBy = "c-main-stats".
 *
 * Reading SQLite: rather than add a native sqlite binding to the toolchain, we
 * shell out to the `sqlite3` CLI in `-json` mode. That binary is already part
 * of the environment that produced the database (the C build needs the sqlite3
 * dev library), and the COMMITTED artifact is the resulting JSON - the fast
 * vitest parity check consumes that JSON and never needs sqlite at test time.
 *
 * Coverage. The C schema splits floor objects across several detail tables
 * (consumables with a remapped index, plus wearables_* and artifacts), so the
 * object-kind distribution is a documented next increment. What IS mapped here
 * is the highest-signal, cleanly-keyed level-generation output:
 *   - monsters (total + per race index) from table `monsters(level,count,k_idx)`
 *     where k_idx is the monster race index (r_idx), aligned with the port ridx;
 *   - gold (total + per origin) from `gold(level,count,origin)`;
 *   - object / monster level-feeling histograms from `obj_feelings`/`mon_feelings`;
 *   - levels-per-depth derived as SUM(obj_feelings.count) at that depth, since
 *     each generated level contributes exactly one feeling sample.
 * Object fields (objectTotal/objectsByTval/objectsByKind/artifacts) are left at
 * zero and MUST be excluded from a C comparison (see compareReports `metrics`).
 */

import { execFileSync } from "node:child_process";
import type { DepthMetrics, StatsReport } from "./stats";
import { emptyDepth } from "./stats";

/** Which StatsReport metrics the C import populates (for comparison scoping). */
export const C_SCALAR_METRICS = ["levels", "monsterTotal", "gold"] as const;
export const C_RECORD_METRICS = [
  "monsters",
  "goldByOrigin",
  "objFeeling",
  "monFeeling",
] as const;

export interface ImportCStatsOptions {
  /** Path/name of the sqlite3 CLI. Default: $NEO_SQLITE3 or "sqlite3". */
  sqlite3?: string;
  /** Lowest dungeon level to import (inclusive). Default 1. */
  depthMin?: number;
  /** Highest dungeon level to import (inclusive). Default: max in the DB. */
  depthMax?: number;
}

/** Run one query in JSON mode and parse the result rows. */
function query<T>(sqlite3: string, db: string, sql: string): T[] {
  const out = execFileSync(sqlite3, [db, "-json", sql], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const trimmed = out.trim();
  return trimmed ? (JSON.parse(trimmed) as T[]) : [];
}

/** Read the metadata table into a plain map. */
function readMetadata(sqlite3: string, db: string): Record<string, string> {
  const rows = query<{ field: string; value: string }>(
    sqlite3,
    db,
    "SELECT field, value FROM metadata;",
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.field] = r.value;
  return out;
}

/**
 * Build a StatsReport from a C main-stats SQLite database.
 * `dbPath` is the .db file; the returned report carries generatedBy
 * "c-main-stats" and only the C-covered metrics populated.
 */
export function importCStats(
  dbPath: string,
  opts: ImportCStatsOptions = {},
): StatsReport {
  const sqlite3 = opts.sqlite3 ?? process.env.NEO_SQLITE3 ?? "sqlite3";
  const meta = readMetadata(sqlite3, dbPath);

  const levelRange = query<{ lo: number; hi: number }>(
    sqlite3,
    dbPath,
    "SELECT MIN(level) AS lo, MAX(level) AS hi FROM monsters;",
  )[0] ?? { lo: 1, hi: 1 };
  const depthMin = opts.depthMin ?? levelRange.lo;
  const depthMax = opts.depthMax ?? levelRange.hi;

  const depths: Record<string, DepthMetrics> = {};
  for (let d = depthMin; d <= depthMax; d++) {
    depths[String(d)] = emptyDepth();
  }

  const range = `level >= ${depthMin} AND level <= ${depthMax}`;

  // levels-per-depth = number of feeling samples recorded at that depth.
  for (const r of query<{ level: number; c: number }>(
    sqlite3,
    dbPath,
    `SELECT level, SUM(count) AS c FROM obj_feelings WHERE ${range} GROUP BY level;`,
  )) {
    const m = depths[String(r.level)];
    if (m) m.levels = r.c;
  }

  // monsters: total + per race index (r_idx, aligned with the port's ridx).
  for (const r of query<{ level: number; count: number; k_idx: number }>(
    sqlite3,
    dbPath,
    `SELECT level, count, k_idx FROM monsters WHERE ${range};`,
  )) {
    const m = depths[String(r.level)];
    if (!m) continue;
    m.monsters[String(r.k_idx)] = (m.monsters[String(r.k_idx)] ?? 0) + r.count;
    m.monsterTotal += r.count;
  }

  // gold: total + per origin (summed gold value, matching the port's pval sum).
  for (const r of query<{ level: number; count: number; origin: number }>(
    sqlite3,
    dbPath,
    `SELECT level, count, origin FROM gold WHERE ${range};`,
  )) {
    const m = depths[String(r.level)];
    if (!m) continue;
    m.goldByOrigin[String(r.origin)] =
      (m.goldByOrigin[String(r.origin)] ?? 0) + r.count;
    m.gold += r.count;
  }

  // level-feeling histograms.
  for (const r of query<{ level: number; count: number; feeling: number }>(
    sqlite3,
    dbPath,
    `SELECT level, count, feeling FROM obj_feelings WHERE ${range};`,
  )) {
    const m = depths[String(r.level)];
    if (m) m.objFeeling[String(r.feeling)] = (m.objFeeling[String(r.feeling)] ?? 0) + r.count;
  }
  for (const r of query<{ level: number; count: number; feeling: number }>(
    sqlite3,
    dbPath,
    `SELECT level, count, feeling FROM mon_feelings WHERE ${range};`,
  )) {
    const m = depths[String(r.level)];
    if (m) m.monFeeling[String(r.feeling)] = (m.monFeeling[String(r.feeling)] ?? 0) + r.count;
  }

  const anyLevels = Object.values(depths).find((m) => m.levels > 0)?.levels ?? 0;

  return {
    meta: {
      engineVersion: meta.version ?? "4.2.6",
      parityBaseline: meta.version ?? "4.2.6",
      generatedBy: "c-main-stats",
      runs: anyLevels,
      depthMin,
      depthMax,
      baseSeed: 0,
      race: "wizard-stats",
      class: "wizard-stats",
      randarts: meta.randarts === "1",
      note:
        "Imported from the C main-stats SQLite DB (Angband " +
        (meta.version ?? "4.2.6") +
        "). Covers monster/gold/feeling generation distributions; object-kind " +
        "distribution is not yet imported (C splits it across detail tables). " +
        "Compare with normalizeByLevels + STATISTICAL_TOLERANCE over the " +
        "C-covered metrics only.",
    },
    depths,
  };
}
