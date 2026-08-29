/**
 * NOISE FLOOR PROBE: what can the distribution metrics actually resolve?
 *
 * `parity-c-stat.test.ts` compares the port's histograms against the C oracle
 * with a G-test. That answers "is the port different from C" only if it is known how
 * big G gets when NOTHING is different. This probe measures exactly that: it
 * runs the port against ITSELF at two different seeds, in the same sample shape
 * as the real comparison (1000 reference levels vs 400 observed levels), and
 * reports G for the identical-code case.
 *
 * Why this exists: the S-3 species finding was withdrawn because monster
 * placement is CLUSTERED -- one pit or nest drops 20-60 monsters of a single
 * theme onto one level, so the effective sample size is the number of LEVELS,
 * not the number of monsters. A G-test that counts monsters as independent is
 * overdispersed and reports huge G for samples that differ only by seed. This
 * probe quantifies that overdispersion instead of arguing about it, and it does
 * the same for the object/monster feeling histograms so it is known which of the
 * three metrics -- if any -- is a usable parity gate.
 *
 * READ THE NULL CORRECTLY. G_null here is what the same code produces against
 * ITSELF, and that is NOT the null for a port-vs-C comparison. Two runs of one
 * implementation share every structural quirk that implementation has -- the same
 * allocation tables walked in the same order, the same rounding, the same
 * tie-breaks -- and two independent samples do not. So this understates the null,
 * measurably: port-vs-itself pools objFeel to G/df = 0.95, while the null measured
 * between six 1000-run C databases (15 unordered pairs,
 * `parity/phase3-2026-07-25/tools/c-vs-c-all-pairs.mjs`) is 1.94, sd 0.31, range
 * 1.56-2.49. Roughly twice. Anything calibrating a C comparison must use the
 * C-vs-C null; see NOISE-FLOOR.md, "The null was mismeasured".
 *
 * What this probe IS sound for is the species result, which does not depend on the
 * calibration: port-vs-itself G came out LARGER than port-vs-C G (ratio 0.99), and
 * a metric that cannot distinguish a sample from itself is void under any null.
 * That is a verdict on the INSTRUMENT rather than on the metric, and the
 * instrument has since been replaced: the species gate now runs through
 * `clusteredDistributionTest`, which measures the pit/nest overdispersion off the
 * per-level vectors and divides it out. The last block below re-runs this same
 * self-null through it, because a correction that cannot pass a sample against
 * itself has not fixed anything.
 *
 * This is a diagnostic, not a gate -- it asserts only that it ran -- so it is
 * OPT-IN and excluded from the default `cli` glob. Its two `runStatsBatch` calls
 * used to sit at module scope, which put ~10 minutes of Monte Carlo into vitest
 * COLLECTION where no per-test timeout applies and nothing reports as slow; both
 * now run inside the test.
 *
 *   NEO_NOISE_PROBE=1 pnpm vitest run packages/cli/src/noise-floor.probe.test.ts
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack.js";
import { runStatsBatch, type StatsReport } from "./stats.js";
import { loadCBaseline } from "./baseline.js";
import { clusteredDistributionTest, distributionTest } from "./stat-test.js";

const cbase = loadCBaseline();

/* Match the real comparison's shape: the C oracle contributes 1000 levels per
 * depth as the reference, the port 400 as the observed sample. Using the same
 * counts here keeps G comparable, since G scales with n. */
const REF_RUNS = Number(process.env.NEO_NOISE_REF_RUNS ?? 1000);
const OBS_RUNS = Number(process.env.NEO_NOISE_OBS_RUNS ?? 400);
const DEPTH_MAX = 20;

/* Opt-in. 1400 level generations is ~10 minutes and the probe asserts only that
 * it ran, so it has no business in the default glob -- it was the reason the cli
 * suite hit the 590s harness cap. */
const ENABLED = process.env.NEO_NOISE_PROBE === "1";

describe.skipIf(!cbase || !ENABLED)("noise floor of the generation distribution metrics", () => {
  const base = cbase as StatsReport;
  const depths = Object.keys(base.depths)
    .map(Number)
    .filter((d) => d <= DEPTH_MAX)
    .sort((a, b) => a - b);

  const pack = loadGamePack();
  const common = {
    depthMin: base.meta.depthMin,
    depthMax: DEPTH_MAX,
    randarts: false,
  } as const;

  it("reports G for identical code at two seeds, beside G against C", () => {
    /* Same code, same params, DIFFERENT seeds. Any difference between these two
     * samples is seed noise by construction.
     *
     * INSIDE the test deliberately. At module scope these two calls ran during
     * vitest COLLECTION, where no per-test timeout applies and no reporter marks
     * them slow -- so ~10 minutes of Monte Carlo was invisible until the suite hit
     * the harness cap with nothing to point at. */
    const portRef = runStatsBatch(pack, { ...common, runs: REF_RUNS, baseSeed: 1337 });
    const portObs = runStatsBatch(pack, { ...common, runs: OBS_RUNS, baseSeed: 7331 });

    const metrics = [
      ["species", "monsters"],
      ["objFeel", "objFeeling"],
      ["monFeel", "monFeeling"],
    ] as const;

    for (const [label, key] of metrics) {
      const lines: string[] = [];
      let nullMax = 0;
      let nullSum = 0;
      let realSum = 0;
      let n = 0;

      for (const d of depths) {
        const b = base.depths[String(d)];
        const pr = portRef.depths[String(d)];
        const po = portObs.depths[String(d)];
        if (!b || !pr || !po) continue;

        /* NULL: port vs port. Identical code, so this is pure noise. */
        const nul = distributionTest(
          po[key] as Record<string, number>,
          pr[key] as Record<string, number>,
        );
        /* REAL: port vs the C oracle, exactly as parity-c-stat does it. */
        const real = distributionTest(
          po[key] as Record<string, number>,
          b[key] as Record<string, number>,
        );

        nullMax = Math.max(nullMax, nul.g);
        nullSum += nul.g;
        realSum += real.g;
        n++;

        /* G/df > 1 means overdispersion: G is inflated relative to what the
         * chi-square reference distribution expects. */
        const ratio = nul.df > 0 ? nul.g / nul.df : 0;
        lines.push(
          `depth ${String(d).padStart(2)} ${label.padEnd(7)}` +
            ` G_null=${nul.g.toFixed(1).padStart(7)}/${String(nul.df).padStart(3)}` +
            ` (G/df=${ratio.toFixed(2).padStart(5)}, p=${nul.p.toExponential(2)})` +
            `  G_real=${real.g.toFixed(1).padStart(7)}/${String(real.df).padStart(3)}` +
            ` (p=${real.p.toExponential(2)})` +
            `  real/null=${nul.g > 0 ? (real.g / nul.g).toFixed(2) : "n/a"}`,
        );
      }

      console.log(
        `\n=== ${label}: identical code at two seeds (n=${OBS_RUNS} vs ${REF_RUNS} levels/depth) ===\n` +
          lines.join("\n") +
          `\n--- mean G_null=${(nullSum / n).toFixed(1)}  max G_null=${nullMax.toFixed(1)}` +
          `  mean G_real=${(realSum / n).toFixed(1)}` +
          `  mean real/null=${(realSum / nullSum).toFixed(2)}`,
      );
    }

    /*
     * The same self-null through the CORRECTED species instrument, which is what
     * the gate in parity-c-stat.test.ts now uses. This is the one reading that
     * settled whether species is measurable at all: identical code at two seeds
     * must NOT look different, and the plain row above shows it does. If a
     * corrected p here is extreme, the gate is not calibrated on real data
     * whatever the synthetic check in stat-test.test.ts says, and the right
     * response is to un-gate species again rather than to widen anything.
     */
    {
      const lines: string[] = [];
      for (const d of depths) {
        const pr = portRef.depths[String(d)];
        const po = portObs.depths[String(d)];
        if (!pr || !po) continue;
        const t = clusteredDistributionTest(
          {
            levels: po.levels,
            counts: po.speciesGroups,
            countsSq: po.speciesGroupsSq,
            countsXn: po.speciesGroupsXn,
            totalSq: po.monsterTotalSq,
          },
          pr.speciesGroups,
        );
        lines.push(
          `depth ${String(d).padStart(2)} species G=${t.g.toFixed(1)}` +
            ` deff=${t.deff.toFixed(2)} G/deff=${t.gAdj.toFixed(1)}/${t.df}` +
            ` p=${t.p.toExponential(2)} nEff=${t.effectiveN.toFixed(0)}`,
        );
      }
      console.log(
        `\n=== species, CORRECTED, identical code at two seeds ` +
          `(this is the gate's own instrument on a known null) ===\n` +
          lines.join("\n"),
      );
    }

    /* Deliberately weak: this is a probe whose product is the console output
     * above, not a verdict. It is opt-in for exactly that reason -- do not add a
     * threshold assertion here and call it a gate. The gate is
     * parity-c-stat.test.ts, and its calibration comes from the C-vs-C null, not
     * from anything measured in this file. */
    expect(depths.length).toBeGreaterThan(0);
  }, 1_800_000);
});
