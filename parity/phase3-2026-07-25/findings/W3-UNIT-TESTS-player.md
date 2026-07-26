# W3-5 batch player — PARTIAL (stream died mid-run)

The stream was cut off by a Grok usage-balance exhaustion (HTTP 402) after
writing 12 test files, so this batch has no author's report. Salvaged and
verified by the gate instead: **12 files, 65 tests, 62 pass, 3 fail.**

The failures are candidate parity findings, not test bugs — the expected values
are transcribed from `reference/src/tests/player/`:

### UT-P-001  adjust_hp_precise does not clamp to int16
- ref: `reference/src/tests/player/util.c:37` (`test_adjust_hp_precise`)
- port: `packages/core/src/game/util.upstream.test.ts` "adjust_hp_precise"
- expected: `-32768` (the C stores `chp` as `int16_t`, so it saturates at
  `INT16_MIN`)
- actual: `-32770`
- severity: P3 in practice — it needs ~32k of overkill in one blow — but the
  clamp is real upstream behaviour and cheap to reproduce.
- confidence: high

### UT-P-002 / UT-P-003  calc_inventory equipped/pack/quiver, and oversubscribed quiver
- ref: `reference/src/tests/player/calc-inventory.c`
- port: `packages/core/src/game/calc-inventory.upstream.test.ts`
- Both fail on a bare `expected false to be true`, which does not by itself
  distinguish a real divergence from an unfinished fixture: the stream died
  partway, so these two may simply not have been completed.
- **Verify before treating as findings.** Re-derive the upstream fixture setup
  (`test-utils.c` + `unit-test-data.h`) and re-run.

The other 10 files pass against upstream's own expected values.
