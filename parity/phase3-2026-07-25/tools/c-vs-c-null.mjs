/*
 * The measured null that every pooled statistic in the gate needs.
 *
 * There are now TWO independent 1000-run C main-stats databases. Diffing them
 * against each other runs the gate's own instruments on data where the answer
 * is known to be "no difference", so the result IS the null distribution --
 * including whatever depth-to-depth correlation a single descent introduces,
 * which a port-vs-itself null cannot capture in the same way (the port shares
 * its generator with itself trivially; two C runs share only the generator, and
 * differ exactly as two real samples do).
 */
import { execFileSync } from "node:child_process";

const SQ =
  "C:/Users/neost/AppData/Local/Microsoft/WinGet/Packages/SQLite.SQLite_Microsoft.Winget.Source_8wekyb3d8bbwe/sqlite3.exe";
const A = "C:/Repositories/_c-oracle/build/game/lib/user/stats/2026-07-25T11-45.db";
const B = "C:/Repositories/_c-oracle/build/game/lib/user/stats/2026-07-25T22-31.db";

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

for (const table of ["obj_feelings", "mon_feelings"]) {
  const ha = hist(A, table);
  const hb = hist(B, table);
  let G = 0;
  let DF = 0;
  let k = 0;
  for (let d = 1; d <= 20; d++) {
    if (!ha[d] || !hb[d]) continue;
    const t = gTest(ha[d], hb[d]);
    G += t.g;
    DF += t.df;
    k++;
  }
  console.log(
    `${table.padEnd(13)} C-run-A vs C-run-B pooled: G=${G.toFixed(1)} df=${DF} ` +
      `G/df=${(G / DF).toFixed(2)} over ${k} depths`,
  );
}

/* Object count per level: the same two-sample mean test the gate applies. */
function objCount(db) {
  const lv = {};
  for (const r of q(db, "SELECT level, SUM(count) c FROM obj_feelings WHERE level BETWEEN 1 AND 20 GROUP BY level;"))
    lv[r.level] = r.c;
  const tot = {};
  for (const t of ["wearables_count", "consumables"]) {
    for (const r of q(
      db,
      `SELECT t.level lvl, SUM(t.count) c FROM ${t} t JOIN object_info oi ON oi.idx=t.k_idx ` +
        `WHERE t.level BETWEEN 1 AND 20 AND oi.tval<>35 GROUP BY t.level;`,
    ))
      tot[r.lvl] = (tot[r.lvl] ?? 0) + r.c;
  }
  const ego = {};
  for (const r of q(db, "SELECT level, SUM(count) c FROM wearables_egos WHERE level BETWEEN 1 AND 20 GROUP BY level;"))
    ego[r.level] = r.c;
  const art = {};
  for (const r of q(db, "SELECT level, SUM(count) c FROM artifacts WHERE level BETWEEN 1 AND 20 GROUP BY level;"))
    art[r.level] = r.c;
  return { lv, tot, ego, art };
}
const ca = objCount(A);
const cb = objCount(B);
console.log("\ndepth  objs/lvl A   objs/lvl B    egos A   egos B    arts A   arts B");
for (let d = 1; d <= 20; d++) {
  const f = (x, y) => (x[d] / y[d]).toFixed(3).padStart(9);
  console.log(
    String(d).padStart(4),
    f(ca.tot, ca.lv),
    f(cb.tot, cb.lv),
    f(ca.ego, ca.lv),
    f(cb.ego, cb.lv),
    f(ca.art, ca.lv),
    f(cb.art, cb.lv),
  );
}
const relDiff = (x, y) => {
  let s = 0;
  let n = 0;
  for (let d = 1; d <= 20; d++) {
    s += Math.abs(x.tot[d] / x.lv[d] - y.tot[d] / y.lv[d]) / (x.tot[d] / x.lv[d]);
    n++;
  }
  return ((100 * s) / n).toFixed(2);
};
console.log(`\nmean |relative difference| in objects/level between two C runs: ${relDiff(ca, cb)}%`);
