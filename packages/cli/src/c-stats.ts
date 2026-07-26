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
 * Coverage. What is mapped:
 *   - monsters (total + per race index) from table `monsters(level,count,k_idx)`
 *     where k_idx is the monster race index (r_idx), aligned with the port ridx;
 *   - gold (total + per origin) from `gold(level,count,origin)`;
 *   - object / monster level-feeling histograms from `obj_feelings`/`mon_feelings`;
 *   - levels-per-depth derived as SUM(obj_feelings.count) at that depth, since
 *     each generated level contributes exactly one feeling sample;
 *   - objects (total + per kind + per tval) and artifacts, reassembled from the
 *     detail tables as described below.
 *
 * Objects: the C splits every logged object across two mutually exclusive
 * tables. `log_all_objects` (main-stats.c:633-657) sends an object to the
 * `wearables_*` family if `tval_has_variable_power`, and otherwise to
 * `consumables`; `wearables_count(level,count,k_idx,origin)` is the plain
 * per-kind count for the first bucket. So the object total is
 * `wearables_count + consumables`, and every object is counted exactly once.
 *
 * MONEY IS SUBTRACTED. The C's gold capture at :624-626 is additive and does
 * NOT `continue`, so a money object is accumulated into `gold[origin]` AND then
 * falls through to the `consumables` bucket at :656 -- it appears in both. The
 * port's `collectLevel` deliberately `continue`s on TV_GOLD before touching
 * objectTotal, so to compare like with like the money kinds are excluded here,
 * identified by `object_info.tval = 35` (TV_GOLD is last in list-tvals.h). On
 * the 1000-run oracle that is 2.82M of 7.03M consumable entries, so leaving it
 * in would inflate the C object total by ~40% and manufacture a divergence.
 *
 * Kind indices in these tables are REAL kind indices, not the compacted ones
 * used in memory: `stats_lookup_index` (main-stats.c:1359) inverts
 * `wearables_index` / `consumables_index` before the row is written.
 */

import { execFileSync } from "node:child_process";
import type { DepthMetrics, StatsReport } from "./stats";
import { emptyDepth } from "./stats";

/** Which StatsReport metrics the C import populates (for comparison scoping). */
export const C_SCALAR_METRICS = [
  "levels",
  "monsterTotal",
  "gold",
  "objectTotal",
  "artifacts",
  "egos",
] as const;
export const C_RECORD_METRICS = [
  "monsters",
  "goldByOrigin",
  "objFeeling",
  "monFeeling",
  "objectsByTval",
  "objectsByKind",
] as const;

/**
 * TV_GOLD. Last entry in `reference/src/list-tvals.h`, so its value is the tval
 * count; hard-coded rather than derived because the DB does not carry the tval
 * name list and this import must not depend on the port's own tables to read
 * the oracle. Asserted against the DB in the importer.
 */
const TV_GOLD = 35;

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

  /*
   * Objects. `wearables_count` and `consumables` partition every logged object
   * (main-stats.c:633-657), so the two summed give the total with no
   * double-count; money is dropped because it is ALSO in `consumables` and the
   * port excludes it from objectTotal (see the header). Both tables carry real
   * kind indices, and object_info supplies the tval for each.
   */
  const maxTval = query<{ t: number }>(
    sqlite3,
    dbPath,
    "SELECT MAX(tval) AS t FROM object_info;",
  )[0]?.t;
  if (maxTval !== TV_GOLD) {
    throw new Error(
      `c-stats: expected TV_GOLD=${TV_GOLD} to be the highest tval in ` +
        `object_info (list-tvals.h puts GOLD last) but found ${maxTval}. ` +
        "The tval numbering has moved; re-check the money exclusion before trusting objectTotal.",
    );
  }
  for (const table of ["wearables_count", "consumables"] as const) {
    for (const r of query<{ level: number; count: number; k_idx: number; tval: number }>(
      sqlite3,
      dbPath,
      `SELECT t.level, t.count, t.k_idx, oi.tval FROM ${table} t ` +
        `JOIN object_info oi ON oi.idx = t.k_idx ` +
        `WHERE t.level >= ${depthMin} AND t.level <= ${depthMax} ` +
        `AND oi.tval <> ${TV_GOLD};`,
    )) {
      const m = depths[String(r.level)];
      if (!m) continue;
      m.objectTotal += r.count;
      m.objectsByKind[String(r.k_idx)] =
        (m.objectsByKind[String(r.k_idx)] ?? 0) + r.count;
      m.objectsByTval[String(r.tval)] =
        (m.objectsByTval[String(r.tval)] ?? 0) + r.count;
    }
  }

  /*
   * Egos: `wearables_egos(level, count, k_idx, origin, e_idx)` has one row per
   * (kind, origin, ego) triple, so the per-level ego count is the sum over the
   * whole table at that depth (main-stats.c:644-645). Only objects satisfying
   * tval_has_variable_power reach that branch, which is exactly the set that can
   * carry an ego, so no money/consumable correction is needed here.
   */
  for (const r of query<{ level: number; count: number }>(
    sqlite3,
    dbPath,
    `SELECT level, count FROM wearables_egos WHERE ${range};`,
  )) {
    const m = depths[String(r.level)];
    if (m) m.egos += r.count;
  }

  /* Artifacts: one row per (level, a_idx, origin); mirrors L628-630. */
  for (const r of query<{ level: number; count: number }>(
    sqlite3,
    dbPath,
    `SELECT level, count FROM artifacts WHERE ${range};`,
  )) {
    const m = depths[String(r.level)];
    if (m) m.artifacts += r.count;
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
        "). Covers monster, gold, object (count/kind/tval), ego, artifact " +
        "and level-feeling generation distributions. Object counts are reassembled " +
        "from wearables_count + consumables with the money kinds removed, " +
        "because the C logs a money object into BOTH gold and consumables while " +
        "the port excludes it from objectTotal. Per-level squares are absent by " +
        "construction (the C stores per-depth aggregates, not per-run samples), " +
        "so any mean test estimates the shared variance from the port side.",
    },
    depths,
  };
}
