# Remaining low-priority parity gaps — follow-up required

Created from `origin/master` `827adf23f` by W2 integration.  This branch is
documentation only: none of these is a small, isolated change that can safely
be merged without a dedicated behavioral pass.

| area | verified upstream anchor | why it needs its own pass |
|---|---|---|
| target-panel nearest stairs | `reference/src/target.c` nearest-stair target loop (see `W2-FIX-REVIEW.md`, W2-003) | requires wiring through both core target selection and web input, plus turn/RNG regression coverage |
| pending death effect chain | `reference/src/effects.c` handler return/ident chain (see `W2-FIX-REVIEW.md`) | requires an async pending-death seam, not a local handler edit |
| generation connectedness | `reference/src/generate.c` `ensure_connectedness` call sites (see `S3-ADJUDICATE-FINAL.md:143-154`) | policy-sensitive behavior affects generated levels and oracle streams |
| parser registry validation | `reference/src/init.c:3714-3716`, `reference/src/mon-init.c` parser handlers (see `UT-monclass.md` G11-G19) | correct errors depend on tval/sval, options, and record registries unavailable to the generic compiler |
| timed known-state UI | `reference/src/player-timed.c` timed-effect knowledge paths (see `W3-UNIT-TESTS-timed.md:128-152`) | requires a known-state presentation model, not a timed arithmetic patch |
| textblock/zlib/message coverage | `reference/src/z-textblock/textblock.c`, `reference/src/z-util/meanvar.c`, `reference/src/z-util/rational.c` | port analogues are partial or absent; this is coverage/API design work |
| pack NULL victim ordering | `reference/src/obj-gear.c:1345-1390` (see `W3-UNIT-TESTS-player.md:433-443`) | must establish the exact list-order invariant across all combine/wield callers |

These are intentionally not fixes.  They remain visible to the owner without
turning unverified speculative changes into the integration batch.
