# Parity Ledger

Machine-readable provenance: which upstream sources each port module ports,
pinned to the parity baseline (tag `4.2.6`). Methodology in
[docs/PARITY.md](../docs/PARITY.md).

**Looking for what is missing? Read [DEFERRALS.md](DEFERRALS.md), not the `notes:`
and `deferred:` fields here.** Every "deferred" note in this repository - in these
files and in the source comments - has been adjudicated with evidence, and 141 of
the 367 turned out to describe a state of the code that no longer held. A
`deferred:` entry below is a lead, not a finding.

**Working the list? [PORT_TODO.md](PORT_TODO.md)** is the tiered checklist of the
95 citations that are genuinely owed.

## Format

One YAML file per port module under `ledger/`. Schema:

```yaml
module: packages/core/src/rng.ts        # port artifact
status: planned | partial | ported | verified
baseline: 4.2.6                         # upstream tag this entry is pinned to
upstream:
  - path: src/z-rand.c                  # relative to reference/
    items: [Rand_state_init, Rand_div, damroll]  # functions/tables ported
notes: >-
  Free text: intentional divergences, verification pointers, caveats.
verified-by:
  - stats:level-gen-distributions       # harness check IDs, when verified
```

Rules:

- Every `packages/**` module that ports upstream behavior gets an entry
  before its phase completes. New original code (UI, mod-sdk) needs no entry.
- `status: verified` requires at least one `verified-by` harness check.
- When rebasing to a future upstream release, entries are the triage map:
  upstream diff -> touched `upstream.path`/`items` -> affected port modules.
