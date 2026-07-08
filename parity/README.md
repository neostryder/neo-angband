# Parity Ledger

Machine-readable provenance: which upstream sources each port module ports,
pinned to the parity baseline (tag `4.2.6`). Methodology in
[docs/PARITY.md](../docs/PARITY.md).

## Format

One YAML file per port module under `ledger/`. Schema:

```yaml
module: packages/core/src/rng.ts        # port artifact
status: planned | in-progress | ported | verified
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
