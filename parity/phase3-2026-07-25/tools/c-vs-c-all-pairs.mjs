/*
 * Estimate the dispersion of the pooled feeling G-test from independent C
 * main-stats runs.  The G-test below is intentionally identical to
 * c-vs-c-null.mjs / distributionTest, including its expected-count pooling.
 *
 * Usage:
 *   node c-vs-c-all-pairs.mjs run-a.db run-b.db [run-c.db ...]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/* The sqlite3 binary. This used to be an absolute path, which put the machine's
 * user account name into a public repository. Point NEO_SQLITE3 at the binary,
 * or leave it unset and let PATH resolve it. */
const SQ = process.env.NEO_SQLITE3 ?? "sqlite3";

const dbs = process.argv.slice(2);
if (dbs.length < 2) {
  console.error("Usage: node c-vs-c-all-pairs.mjs run-a.db run-b.db [run-c.db ...]");
  process.exit(1);
}

const q = (db, sql) =>
  JSON.parse(execFileSync(SQ, [db, "-json", sql], { encoding: "utf8", maxBuffer: 1 << 28 }) || "[]");

function hist(db, table) {
  const out = {};
  for (const r of q(db, `SELECT level, feeling, count FROM ${table} WHERE level BETWEEN 1 AND 20;`)) {
    (out[r.level] ??= {})[r.feeling] = r.count;
  }
  return out;
}

/* G-test of one histogram against another, rescaled to the observed total.
 * Mirrors distributionTest in packages/cli/src/stat-test.ts: pool categories
 * whose expected count would fall below 5, since G is unreliable there. */
function gTest(obs, ref) {
  const keys = new Set([...Object.keys(obs), ...Object.keys(ref)]);
  const nObs = [...keys].reduce((a, k) => a + (obs[k] ?? 0), 0);
  const nRef = [...keys].reduce((a, k) => a + (ref[k] ?? 0), 0);
  if (!nObs || !nRef) return { g: 0, df: 0 };
  const scale = nObs / nRef;
  let g = 0;
  let df = -1;
  let poolObs = 0;
  let poolExp = 0;
  for (const k of keys) {
    const o = obs[k] ?? 0;
    const e = (ref[k] ?? 0) * scale;
    if (e < 5) {
      poolObs += o;
      poolExp += e;
      continue;
    }
    if (o > 0) g += 2 * o * Math.log(o / e);
    df++;
  }
  if (poolExp >= 5) {
    if (poolObs > 0) g += 2 * poolObs * Math.log(poolObs / poolExp);
    df++;
  }
  return { g, df: Math.max(df, 0) };
}

function pooled(a, b) {
  let g = 0;
  let df = 0;
  let depths = 0;
  for (let d = 1; d <= 20; d++) {
    if (!a[d] || !b[d]) continue;
    const t = gTest(a[d], b[d]);
    g += t.g;
    df += t.df;
    depths++;
  }
  return { g, df, ratio: g / df, depths };
}

function summary(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return { mean, sd: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) };
}

/* Pairs share runs, so SD / sqrt(pair count) would understate uncertainty.
 * Delete-one-run jackknifing supplies a run-level standard error for the mean. */
function jackknifeSe(pairs, runCount) {
  if (runCount < 2) return 0;
  const leaveOneOut = [];
  for (let run = 0; run < runCount; run++) {
    const values = pairs
      .filter((pair) => pair.i !== run && pair.j !== run)
      .map((pair) => pair.ratio);
    leaveOneOut.push(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  const mean = leaveOneOut.reduce((sum, value) => sum + value, 0) / runCount;
  return Math.sqrt(((runCount - 1) / runCount) * leaveOneOut.reduce((sum, value) => sum + (value - mean) ** 2, 0));
}

for (const table of ["obj_feelings", "mon_feelings"]) {
  const hists = dbs.map((db) => hist(db, table));
  const pairs = [];
  for (let i = 0; i < dbs.length; i++) {
    for (let j = i + 1; j < dbs.length; j++) {
      pairs.push({ i, j, ...pooled(hists[i], hists[j]) });
    }
  }
  console.log(`\\n${table}`);
  for (const pair of pairs) {
    console.log(
      `${path.basename(dbs[pair.i])} vs ${path.basename(dbs[pair.j])}: ` +
        `G=${pair.g.toFixed(3)} df=${pair.df} G/df=${pair.ratio.toFixed(6)} over ${pair.depths} depths`,
    );
  }
  const s = summary(pairs.map((pair) => pair.ratio));
  const se = jackknifeSe(pairs, dbs.length);
  console.log(
    `summary (${pairs.length} pairs; sample SD): mean=${s.mean.toFixed(6)} ` +
      `sd=${s.sd.toFixed(6)} min=${s.min.toFixed(6)} max=${s.max.toFixed(6)} ` +
      `run-jackknife-se=${se.toFixed(6)}`,
  );
}
