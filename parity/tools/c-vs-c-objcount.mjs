/*
 * Measure the empirical null of the POOLED OBJECT-COUNT Stouffer Z from
 * independent C main-stats runs.  This is the sibling that task #150 step 1
 * asks for, and the reason it had to be written rather than reused:
 * `c-vs-c-all-pairs.mjs` next door computes the null for the FEELING
 * histograms via a G-test, which is a different statistic entirely.
 *
 * Usage:
 *   node c-vs-c-objcount.mjs run-a.db run-b.db [run-c.db ...]
 *   node c-vs-c-objcount.mjs --sd port-report.json run-a.db run-b.db ...
 *
 * WHAT IT COMPUTES, and why it has to match `parity-c-stat.test.ts` exactly.
 * The gated test forms, at each depth d, a two-sample z on per-level object
 * counts
 *
 *     z_d = (portMean_d - refMean_d) / (sd_d * sqrt(1/refN_d + 1/portN_d))
 *
 * and then pools with Stouffer, Z = sum(z_d) / sqrt(D) over D = 20 depths.
 * That pooled figure is PRINTED, NOT GATED, because its null has never been
 * measured: one run walks every depth on a single RNG stream, so the 20
 * deviates are plausibly correlated and the Stouffer denominator sqrt(D) is
 * then too small.  This tool replaces "plausibly" with a number, by running
 * the same instrument over pairs of runs KNOWN to come from the same
 * generator: the C oracle against itself.  Whatever width comes out is the
 * width the port's -4.29 has to be read against.
 *
 * THE OBJECT TOTAL IS REASSEMBLED THE WAY `c-stats.ts` DOES IT, and getting
 * this wrong is a ~40% error.  `log_all_objects` splits every logged object
 * across `wearables_count` and `consumables`, so the total is their sum; but
 * the C's gold capture is additive and does not `continue`, so a money object
 * lands in `gold[origin]` AND falls through into `consumables`.  The port
 * skips TV_GOLD before counting, so the money kinds are subtracted back out
 * here, identified by `object_info.tval = 35`.  The MAX(tval) guard below
 * fails loudly if the tval numbering ever moves.
 *
 * WHERE THE PER-LEVEL SD COMES FROM, which is the one genuinely awkward part.
 * The C stores per-depth aggregates, not per-run samples, so a C database
 * carries no per-level squares and cannot supply `sd_d` the way the port's
 * report does.  Two estimators, and they answer slightly different questions:
 *
 *   --sd <port-report.json>   Use the port's own per-depth per-level SD, the
 *                             exact number the gated test uses.  This is the
 *                             faithful replication of the instrument.  It
 *                             needs a port StatsReport that carries
 *                             `objectTotalSq`, i.e. one produced at a run
 *                             count worth trusting.
 *
 *   (default)                 Recover sd_d from the spread of the run means
 *                             themselves: sd_d = SD(run means) * sqrt(n).
 *                             No port data needed, and it isolates exactly the
 *                             question reading 1 asks -- whether the 20
 *                             deviates are correlated -- because it calibrates
 *                             each depth to unit variance by construction and
 *                             leaves only the pooling to be measured.
 *
 * The default estimator is reported two ways, and EACH IS DIVIDED BY ITS OWN
 * ANALYTIC WIDTH UNDER DEPTH-INDEPENDENCE before it is quoted, because the two
 * estimators do not share a null and comparing their raw RMS to 1 compares
 * different things:
 *
 *   IN-SAMPLE       sd_d from all m runs, including the two being differenced.
 *                   Write u_k = (mean_k - grand mean) / s_d.  The standardisation
 *                   forces sum_k u_k = 0 and sum_k u_k^2 = m-1, from which
 *                   E[(u_j - u_i)^2] = 2 over the pairs EXACTLY -- so the
 *                   per-depth z has variance exactly 1 by construction, for
 *                   every depth, with no estimation slack at all.  Its null RMS
 *                   under depth-independence is therefore exactly 1, and the
 *                   observed RMS IS the inflation factor.  This is the estimator
 *                   to quote.  (An earlier draft of this file called it "biased
 *                   narrow"; that was wrong.  The bounding of the studentised
 *                   difference is not a bias to correct, it is what makes the
 *                   diagonal exact.)
 *
 *   LEAVE-TWO-OUT   sd_d from the m-2 runs not in the pair, so numerator and
 *                   denominator are independent and the per-depth z is a t on
 *                   m-3 df.  That has variance (m-3)/(m-5), which for six runs
 *                   is 3 -- so its null RMS is sqrt(3) = 1.732, not 1.  Useful
 *                   only as an independent check that lands near the in-sample
 *                   factor; it carries far more estimation noise and should
 *                   never be quoted raw.
 *
 * Neither estimator can tell you whether the PORT's sd_d is right; that is a
 * separate question, and `--sd` is how you ask it.
 *
 * Pairs share runs, so SD / sqrt(pair count) understates the uncertainty of
 * the summary.  `jackknifeSe` supplies a run-level standard error by deleting
 * one run at a time, the same treatment `c-vs-c-all-pairs.mjs` gives its own
 * summary.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* The sqlite3 binary. Point NEO_SQLITE3 at it, or leave it unset and let PATH
 * resolve it -- an absolute path here would put a user account name into a
 * public repository. */
const SQ = process.env.NEO_SQLITE3 ?? 'sqlite3';

/** Depths compared, matching DEPTH_MAX in parity-c-stat.test.ts. */
const DEPTH_MAX = 20;

/** TV_GOLD. Last entry in `reference/src/list-tvals.h`, so its value is the
 * tval count; the guard below refuses to run if that stops being true. */
const TV_GOLD = 35;

const argv = process.argv.slice(2);
let sdSource = null;
const dbs = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--sd') {
		sdSource = argv[++i];
		continue;
	}
	dbs.push(argv[i]);
}

if (dbs.length < 2) {
	console.error(
		'Usage: node c-vs-c-objcount.mjs [--sd port-report.json] run-a.db run-b.db [run-c.db ...]'
	);
	process.exit(1);
}

const q = (db, sql) =>
	JSON.parse(
		execFileSync(SQ, [db, '-json', sql], {
			encoding: 'utf8',
			maxBuffer: 1 << 28
		}) || '[]'
	);

/**
 * Per-depth {levels, objectTotal} for one C main-stats database, assembled the
 * way `packages/cli/src/c-stats.ts` assembles it.
 */
function readRun(db) {
	const maxTval = q(db, 'SELECT MAX(tval) AS m FROM object_info;')[0]?.m;
	if (maxTval !== TV_GOLD) {
		throw new Error(
			`${path.basename(db)}: expected TV_GOLD=${TV_GOLD} to be the highest tval in ` +
				`object_info but found ${maxTval}. The tval numbering has moved; re-check ` +
				'the money exclusion before trusting objectTotal.'
		);
	}

	const depths = {};
	/* Levels-per-depth = number of feeling samples, since each generated level
	 * contributes exactly one. Same derivation as the importer. */
	for (const r of q(
		db,
		`SELECT level, SUM(count) AS c FROM obj_feelings
     WHERE level BETWEEN 1 AND ${DEPTH_MAX} GROUP BY level;`
	)) {
		depths[r.level] = { levels: r.c, objectTotal: 0 };
	}
	for (const r of q(
		db,
		`SELECT t.level AS level, SUM(t.count) AS c FROM (
       SELECT level, count, k_idx FROM wearables_count
       UNION ALL
       SELECT level, count, k_idx FROM consumables
     ) t JOIN object_info oi ON oi.idx = t.k_idx
     WHERE t.level BETWEEN 1 AND ${DEPTH_MAX} AND oi.tval <> ${TV_GOLD}
     GROUP BY t.level;`
	)) {
		if (depths[r.level]) depths[r.level].objectTotal = r.c;
	}
	return depths;
}

/** Per-depth per-level SD of objectTotal from a port StatsReport, by the same
 * total/sum-of-squares recovery as `perLevelSd` in `stats.ts`. */
function sdFromPortReport(file) {
	const report = JSON.parse(readFileSync(file, 'utf8'));
	const out = {};
	for (const [d, m] of Object.entries(report.depths ?? {})) {
		const n = m.levels;
		const sq = m.objectTotalSq;
		if (!n || n < 2 || !sq) continue;
		const mean = m.objectTotal / n;
		const variance = (sq - n * mean * mean) / (n - 1);
		if (variance > 0) out[d] = Math.sqrt(variance);
	}
	return out;
}

/** Per-level SD recovered from the spread of run means: Var(mean) = sd^2 / n. */
function sdFromRunSpread(runs, depth, include) {
	const means = [];
	const ns = [];
	for (let k = 0; k < runs.length; k++) {
		if (include && !include(k)) continue;
		const m = runs[k][depth];
		if (!m || !m.levels) continue;
		means.push(m.objectTotal / m.levels);
		ns.push(m.levels);
	}
	if (means.length < 2) return 0;
	const mu = means.reduce((a, b) => a + b, 0) / means.length;
	const variance =
		means.reduce((a, b) => a + (b - mu) ** 2, 0) / (means.length - 1);
	const nBar = ns.reduce((a, b) => a + b, 0) / ns.length;
	return variance > 0 ? Math.sqrt(variance * nBar) : 0;
}

/** Stouffer Z for one ordered pair, given a per-depth SD lookup. */
function stouffer(runs, i, j, sdAt) {
	const zs = [];
	for (let d = 1; d <= DEPTH_MAX; d++) {
		const a = runs[i][d];
		const b = runs[j][d];
		if (!a?.levels || !b?.levels) continue;
		const sd = sdAt(d);
		if (!sd) continue;
		const se = sd * Math.sqrt(1 / a.levels + 1 / b.levels);
		if (!(se > 0)) continue;
		zs.push((b.objectTotal / b.levels - a.objectTotal / a.levels) / se);
	}
	const Z = zs.reduce((s, z) => s + z, 0) / Math.sqrt(Math.max(zs.length, 1));
	return { Z, depths: zs.length };
}

/**
 * Pairs share runs, so SD / sqrt(pair count) would understate uncertainty.
 * Delete-one-run jackknifing supplies a run-level standard error for the RMS.
 */
function jackknifeSe(pairs, runCount, statistic) {
	if (runCount < 3) return NaN;
	const leaveOneOut = [];
	for (let run = 0; run < runCount; run++) {
		const kept = pairs.filter(p => p.i !== run && p.j !== run);
		if (!kept.length) return NaN;
		leaveOneOut.push(statistic(kept.map(p => p.Z)));
	}
	const mean = leaveOneOut.reduce((a, b) => a + b, 0) / runCount;
	return Math.sqrt(
		((runCount - 1) / runCount) *
			leaveOneOut.reduce((a, b) => a + (b - mean) ** 2, 0)
	);
}

const rms = values =>
	Math.sqrt(values.reduce((a, v) => a + v * v, 0) / values.length);

function summarize(label, runs, sdFor, nullRms) {
	const pairs = [];
	for (let i = 0; i < runs.length; i++) {
		for (let j = i + 1; j < runs.length; j++) {
			const sdAt = sdFor(i, j);
			pairs.push({ i, j, ...stouffer(runs, i, j, sdAt) });
		}
	}
	console.log(`\n${label}`);
	for (const p of pairs) {
		console.log(
			`  ${path.basename(dbs[p.i])} vs ${path.basename(dbs[p.j])}: ` +
				`Z=${p.Z.toFixed(3)} over ${p.depths} depths`
		);
	}
	const values = pairs.map(p => p.Z);
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const sd = Math.sqrt(
		values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)
	);
	const width = rms(values);
	const se = jackknifeSe(pairs, runs.length, rms);
	console.log(
		`  summary (${pairs.length} pairs from ${runs.length} runs): ` +
			`mean=${mean.toFixed(3)} sampleSD=${sd.toFixed(3)} ` +
			`RMS=${width.toFixed(3)} (run-jackknife-se=${se.toFixed(3)}) ` +
			`max|Z|=${Math.max(...values.map(Math.abs)).toFixed(3)}`
	);
	/* The null mean is zero by exchangeability -- the pairing order i<j is the
	 * file order, which is arbitrary with respect to object count -- so RMS, not
	 * the sample SD around an estimated mean, is the width to divide by. Dividing
	 * again by this estimator's analytic width under depth-independence leaves
	 * the pooling inflation on its own, which is the whole question. */
	const inflation = width / nullRms;
	console.log(
		`  null RMS under depth-independence = ${nullRms.toFixed(3)} ` +
			`-> POOLING INFLATION = ${inflation.toFixed(3)} ` +
			`(+/- ${(se / nullRms).toFixed(3)})`
	);
	return {
		width,
		inflation,
		se: se / nullRms,
		maxAbs: Math.max(...values.map(Math.abs))
	};
}

const runs = dbs.map(readRun);

/* Refuse to compare runs of different sample sizes without saying so: the
 * per-depth z absorbs unequal n correctly, but a 20-level smoke run next to a
 * 1000-level run contributes almost nothing and would quietly dominate the
 * jackknife. */
for (let k = 0; k < runs.length; k++) {
	const levels = Object.values(runs[k]).map(m => m.levels);
	const lo = Math.min(...levels);
	const hi = Math.max(...levels);
	console.log(
		`${path.basename(dbs[k])}: ${Object.keys(runs[k]).length} depths, ` +
			`levels/depth ${lo === hi ? lo : `${lo}-${hi}`}`
	);
}

const widths = {};

if (sdSource) {
	const sd = sdFromPortReport(sdSource);
	const covered = Object.keys(sd).filter(d => Number(d) <= DEPTH_MAX).length;
	if (covered < DEPTH_MAX) {
		console.log(
			`\nWARNING: ${path.basename(sdSource)} supplies a per-level SD for only ` +
				`${covered} of ${DEPTH_MAX} depths. The port-SD estimator below pools ` +
				"over those depths only, so its Z is NOT comparable to the gated test's."
		);
	}
	/* A known sd_d makes the per-depth z exactly unit-variance, so the null RMS
	 * is 1 -- the same as the in-sample case, for a different reason. */
	widths.portSd = summarize(
		`port-SD estimator (sd from ${path.basename(sdSource)}) -- faithful replication of the gated instrument`,
		runs,
		() => d => sd[d] ?? 0,
		1
	);
}

const m = runs.length;

widths.inSample = summarize(
	'run-spread SD, IN-SAMPLE -- exact on the diagonal, THIS IS THE LINE TO QUOTE',
	runs,
	() => d => sdFromRunSpread(runs, d, null),
	1
);

/* Per-depth z is a t on m-3 df, whose variance is (m-3)/(m-5). Undefined at
 * five runs or fewer, which is why the check is reported and not relied on. */
const t2Var = m > 5 ? (m - 3) / (m - 5) : NaN;
widths.leaveTwoOut = summarize(
	`run-spread SD, LEAVE-TWO-OUT -- independent check, t on ${m - 3} df`,
	runs,
	(i, j) => d => sdFromRunSpread(runs, d, k => k !== i && k !== j),
	Math.sqrt(t2Var)
);

/*
 * NEGATIVE CONTROL, and it is the reason to believe any of the above.
 *
 * The claim is that the inflation comes from cross-depth CORRELATION: one run
 * walks all 20 depths on a single RNG stream.  A control that merely passes
 * would prove nothing, so this one REMOVES THE MECHANISM rather than supplying
 * input assumed to be inert: permute which run supplies each depth,
 * independently per depth.  That destroys any correlation between depths while
 * leaving every marginal distribution, every sample size and the estimator
 * itself exactly as they were.  If the inflation is real, the permuted
 * inflation must fall to 1.0.  If it does not, the 1.404 above is an artefact
 * of this file and not a fact about the generator.
 *
 * Deterministic permutations from a seeded LCG so the control is reproducible;
 * `Math.random` would make the number unrepeatable and therefore unquotable.
 */
{
	let seed = 20260812;
	const rnd = () =>
		(seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
	const depthKeys = [];
	for (let d = 1; d <= DEPTH_MAX; d++)
		if (runs.every(r => r[d]?.levels)) depthKeys.push(d);

	const trials = [];
	for (let t = 0; t < 200; t++) {
		const shuffled = runs.map(() => ({}));
		for (const d of depthKeys) {
			const order = runs.map((_, k) => k);
			for (let i = order.length - 1; i > 0; i--) {
				const j = Math.floor(rnd() * (i + 1));
				[order[i], order[j]] = [order[j], order[i]];
			}
			order.forEach((src, dst) => {
				shuffled[dst][d] = runs[src][d];
			});
		}
		const values = [];
		for (let i = 0; i < shuffled.length; i++) {
			for (let j = i + 1; j < shuffled.length; j++) {
				values.push(
					stouffer(shuffled, i, j, d =>
						sdFromRunSpread(shuffled, d, null)
					).Z
				);
			}
		}
		trials.push(rms(values));
	}
	trials.sort((a, b) => a - b);
	const q = p =>
		trials[Math.min(trials.length - 1, Math.floor(p * trials.length))];
	console.log(
		`\nNEGATIVE CONTROL (depth labels permuted per depth, 200 trials, ` +
			`mechanism removed):\n` +
			`  in-sample inflation under decorrelated data: median=${q(0.5).toFixed(3)} ` +
			`p05=${q(0.05).toFixed(3)} p95=${q(0.95).toFixed(3)}\n` +
			`  observed (correlated) = ${widths.inSample.inflation.toFixed(3)}; the control ` +
			`must sit at 1.0 for that to mean what it says.`
	);
}

/* The two readings #150 has to separate, stated against the measured
 * inflation, so the output cannot be read as a verdict it did not earn. */
const OBSERVED = -4.29;
const primary = widths.portSd ?? widths.inSample;
const { inflation, se } = primary;

/* State the resolving power, because the house rule for this harness is that
 * every comparison says what it could and could not have detected. The
 * inflation is a ratio estimated from m runs; a +/-2SE band on it maps to a
 * band on the calibrated sigma, and if BOTH ends of that band agree, the
 * conclusion does not depend on pinning the inflation down. */
const lo = Math.max(inflation - 2 * se, 1);
const hi = inflation + 2 * se;
/* SE shrinks roughly as 1/sqrt(runs), so the run count that would separate the
 * observed inflation from 1.0 at 2SE follows directly. */
const needed =
	inflation > 1 ? Math.ceil(m * (se / ((inflation - 1) / 2)) ** 2) : Infinity;

console.log(
	`\nThe port's pooled objcount Stouffer Z under the 4.2.6 gamedata is ` +
		`${OBSERVED} (1000 runs, base seed 1337).\n` +
		`Measured pooling inflation ${inflation.toFixed(3)} +/- ${se.toFixed(3)} ` +
		`(run-level jackknife), so the null SD of that Z is NOT 1 and the nominal ` +
		`p was overstated.\n` +
		`Calibrated: ${(OBSERVED / inflation).toFixed(2)} empirical sigma, versus ` +
		`${OBSERVED} nominal.\n` +
		`RESOLVING POWER: across the +/-2SE band on the inflation ` +
		`[${lo.toFixed(2)}, ${hi.toFixed(2)}] the calibrated sigma runs ` +
		`[${(OBSERVED / lo).toFixed(2)}, ${(OBSERVED / hi).toFixed(2)}]. ` +
		`${m} C runs cannot separate an inflation of ${inflation.toFixed(2)} from ` +
		`1.0; that needs about ${needed} runs.\n` +
		'Reading 1 (pooling artefact) is real but partial: it accounts for the ' +
		'inflation, not for what is left. Reading 2 is excluded only if BOTH ends ' +
		'of that sigma band are unremarkable -- one end is not enough.'
);
