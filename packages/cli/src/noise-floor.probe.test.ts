/**
 * NOISE FLOOR PROBE — what can the distribution metrics actually resolve?
 *
 * `parity-c-stat.test.ts` compares the port's histograms against the C oracle
 * with a G-test. That answers "is the port different from C" only if we know how
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
 * the same for the object/monster feeling histograms so we know which of the
 * three metrics -- if any -- is a usable parity gate.
 *
 * Read it as: G_null is what the same code produces against itself. Any G_real
 * inside the G_null range is not evidence of a divergence.
 *
 * This is a diagnostic, not a gate: it asserts only that it ran.
 *   pnpm vitest run packages/cli/src/noise-floor.probe.test.ts --testTimeout=1800000
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import { runStatsBatch, type StatsReport } from "./stats";
import { loadCBaseline } from "./baseline";
import { distributionTest } from "./stat-test";

const cbase = loadCBaseline();

/* Match the real comparison's shape: the C oracle contributes 1000 levels per
 * depth as the reference, the port 400 as the observed sample. Using the same
 * counts here keeps G comparable, since G scales with n. */
const REF_RUNS = Number(process.env.NEO_NOISE_REF_RUNS ?? 1000);
const OBS_RUNS = Number(process.env.NEO_NOISE_OBS_RUNS ?? 400);
const DEPTH_MAX = 20;

describe.skipIf(!cbase)("noise floor of the generation distribution metrics", () => {
  const base = cbase as StatsReport;
  const depths = Object.keys(base.depths)
    .map(Number)
    .filter((d) => d <= DEPTH_MAX)
    .sort((a, b) => a - b);

  const pack = loadGamePack();
  const common = {
    depthMin: base.meta.depthMin,
    depthMax: DEPTH_MAX,
    race: "Human",
    class: "Warrior",
    randarts: false,
  } as const;

  /* Same code, same params, DIFFERENT seeds. Any difference between these two
   * samples is seed noise by construction. */
  const portRef = runStatsBatch(pack, { ...common, runs: REF_RUNS, baseSeed: 1337 });
  const portObs = runStatsBatch(pack, { ...common, runs: OBS_RUNS, baseSeed: 7331 });

  it("reports G for identical code at two seeds, beside G against C", () => {
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

    expect(depths.length).toBeGreaterThan(0);
  });
});
