# Parity Methodology

The port targets **behavioral / distributional parity with Angband 4.2.6**
(decision D1 = B). This document defines exactly what that claim covers, what it
does not, and how it is enforced.

## The claim (D1 = B)

With no mod loaded, every rule, formula, table, message, screen layout, key, and
content record behaves as it does in Angband 4.2.6, including upstream quirks and
bugs. Odds and per-level distributions match.

The port is **not** bit-exact against a reference C binary and does not try to
be. It keeps its **own** consistent RNG draw order and named-stream design, so a
given seed produces a different specific dungeon than a stock GCC/MinGW build of
4.2.6 would. A player cannot tell the difference in normal play; only a
side-by-side same-seed replay against the C binary would diverge. What is
guaranteed is the *behavior and the distribution*, not the exact stream.

### Accepted: sibling argument-evaluation order (02 G01/G02)

Upstream C leaves the evaluation order of sibling function-argument draws
unspecified. A stock GCC/MinGW build (which official Windows Angband uses) tends
to evaluate them right-to-left; the port evaluates left-to-right. Under D1 = B
this is **accepted, not a defect**: it shifts which specific values a seed
produces but changes neither the rules nor the distribution of outcomes. We do
not flip argument order to chase a particular compiler's stream.

### RNG neutrality (the hard rule)

The port owns its seed lineage, but that lineage must be **stable and
mod-neutral**:

- With **no RNG-altering mod loaded**, no hook, seam, or guard may add, drop, or
  reorder a single draw versus the base path. A fixed seed run with the mod
  system present-but-empty draws exactly as it does with the mod system absent.
- **Mods may perturb the stream when enabled.** That is their job; it is opt-in
  and off by default. The default install enables zero mods (the faithful no-mod
  base game).

## Verification lanes

1. **Formula / algorithm provenance (primary, live today).** Every ported
   routine cites its upstream `file:line` and its unit tests assert values
   derived by hand from the C source. This is meaningful parity evidence at the
   algorithm level, bounded by the porter's reading of the C.
2. **Real upstream distribution diff (the parity gate).** Upstream ships a
   Monte-Carlo stats front-end (`reference/src/main-stats.c`, `USE_STATS`,
   SQLite output). The parity gate compiles that C, runs it headless, exports
   its aggregate per-level distributions into the harness `StatsReport` shape
   (`meta.generatedBy = "c-main-stats"`), and diffs the port against **those**
   within a statistical tolerance (distributions/rates, not integers, because
   the streams differ by design). See `packages/cli/README` and the parity
   harness.
3. **RNG-neutrality regression.** A fixed-seed draw-sequence test asserts that
   the no-mod path and the mod-system-absent path are identical (see the hard
   rule above).

### Honest status of the harness

Historically the committed statistical baseline was captured **from the port
itself** and compared to fresh port output with zero tolerance. That is a
*self-regression guard* - it catches drift from the port's own last-accepted
behavior - and it is **not** proof of parity with Angband 4.2.6 (a bug shared by
the port and its own baseline passes green). Any port-captured baseline or
golden is labeled as such and must never be cited as upstream-verified parity
evidence. The lane-2 C-vs-TS diff is the only artifact that proves distributional
parity; until a given metric is covered by it, that metric is verified only at
the algorithm level (lane 1).

## The parity ledger (`parity/`)

A machine-readable map from port artifacts to upstream sources:

- every port module records which upstream files/functions it ports, pinned to
  the baseline tag;
- every core-pack record traces to its `lib/gamedata` origin;
- coverage is auditable: unported upstream modules are visible by absence.

The ledger serves two masters:

1. **Parity audit now** - "what does this port and where did it come from."
2. **AI-assisted rebasing later** - when upstream cuts a new release, diff
   upstream, map changed files/functions through the ledger to affected port
   modules, and generate a migration worklist.

## Tolerances

Distribution comparisons (lane 2) use fixed-seed batches large enough that
agreed per-metric tolerances (documented per check in the harness) distinguish
real behavioral drift from sampling noise. Any check that fails blocks merge.

## Definition of "done"

There is no single "100% done" flag for parity - it is a standing property. A
finding is closed only with three things: the upstream C `file:line`, a
live-path trace proving the code runs in play (exported-and-unit-tested is not
proof it is wired), and a regression test that would fail if the fix were
reverted.
