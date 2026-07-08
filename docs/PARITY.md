# Parity Methodology

The port claims **feature parity with Angband 4.2.6, statistically verified**.
This document defines what that means and how it is enforced.

## The claim

Every rule, formula, table, and content record from the 4.2.6 baseline behaves
identically in the port, within statistical tolerance. The port is NOT
bit-exact: RNG draw order differs, so individual games diverge, but the
distributions - what gets generated, how often, how hard, how deep - match.

## Verification lanes

1. **Distribution diffs.** Upstream ships a Monte-Carlo stats front-end
   (`reference/src/main-stats.c`, SQLite output). The port's stats harness
   (in `@neo-angband/cli`) generates the same aggregate distributions
   (level-generation content, item and monster allocation by depth, randart
   power curves). CI compares the two within agreed tolerances.
2. **Golden scenarios.** Upstream's `-mtest` front-end pattern: scripted
   command sequences with expected outcomes, run through the port's command
   queue. Deterministic because RNG streams are seeded.
3. **Formula provenance.** Every ported formula cites its upstream source in
   the parity ledger (below), so a reviewer can diff intent line by line.

## The parity ledger (`parity/`)

A machine-readable map from port artifacts to upstream sources:

- every port module records which upstream files/functions it ports,
  pinned to the baseline tag;
- every core-pack record traces to its `lib/gamedata` origin;
- coverage is auditable: unported upstream modules are visible by absence.

The ledger serves two masters:

1. **Parity audit now** - "what does this port and where did it come from."
2. **AI-assisted rebasing later** - when upstream cuts a new release, diff
   upstream, map changed files/functions through the ledger to affected port
   modules, and generate a migration worklist. This is how the port stays
   mergeable with upstream instead of drifting.

## Tolerances

Statistical comparisons use fixed-seed batches large enough that agreed
per-metric tolerances (documented per check in the harness) distinguish real
behavioral drift from sampling noise. Any check that fails blocks merge.
