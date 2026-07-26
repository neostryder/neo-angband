# W2 batch integration

Base: `origin/master` `827adf23f`.  All verification was run in the isolated
`integration/w2-batch` worktree with `npx vitest run --exclude "**/borg/**"`.

## Merge ledger

| branch | result | verification |
|---|---|---|
| `fix/shatter-worldless` | clean | build; 288 files / 5190 tests pass, 1 skipped |
| `fix/parse-directives` | clean; corrected stale duplicate-directive expectation using `reference/src/init.c:1094-1107` (assignment and `PARSE_ERROR_NONE`) | build; 288 / 5191 pass, 1 skipped |
| `feat/pathfind-astar` | clean | build; 288 / 5192 pass, 1 skipped |
| `salvage/ut3-batches` | conflict only in `save-fields.test.ts` timeout (15 s versus integration's 20 s); retained 20 s and all UT3 coverage | build; 288 / 5192 pass, 1 skipped |
| `feat/pack-overflow-sort` | clean | build; 288 / 5194 pass, 1 skipped |
| `audit/effect-bodies-resume` | clean | build; 288 / 5194 pass, 1 skipped |

The final build passed.  Final full excluded suite: **288 passed, 1 skipped
(289 files); 5194 passed, 1 skipped (5195 tests)**.

`save-fields` hit the pre-existing 5-second per-test limit twice only under the
parallel full suite, while its targeted run completed in 1.85 seconds.  Its
timeout is now 20 seconds; no product assertion was relaxed.

## Findings sweep

Every `*.md` present at sweep time was reviewed.  “Historical/resolved” means
the document itself closes, retracts, or is superseded by current history.
“Deferred” items are recorded for the dedicated `findings/remaining-parity-gaps`
follow-up: they require a wider parser, UI, oracle, or gameplay pass and were
not safe small fixes in this integration.

| file | disposition |
|---|---|
| EFFECT-BODIES-CODEX.md | deferred: audit reports remaining body candidates; no small verified fix |
| NOISE-FLOOR.md | historical/diagnostic; retains only broader generation investigation |
| OBJFEEL.md | closed/retracted after corrected null measurement |
| S3-ADJUDICATE-FINAL.md | deferred: connectedness decision, `reference/src/generate.c` call-site parity |
| S3-ADJUDICATE.md | historical; fixes already represented in history |
| S3-BISECT.md | historical diagnostic |
| S3-FIX.md | historical; residual requires oracle work |
| S3-REVIEW.md | deferred: telemetry/oracle work |
| S3-ROOTCAUSE.md | superseded by later adjudication |
| SAVE-FIELDS-FLAKE.md | addressed by the 20-second test-only timeout |
| SHATTER-SUBPATHS.md | covered by `fix/shatter-worldless` |
| STAIRCASE-INVARIANT.md | deferred: policy/large generation behavior |
| UT-monclass.md | deferred: parser validation gaps need registry-aware pass |
| UT-objterr.md | mostly fixed; remaining scalar-last-wins covered by `fix/parse-directives`; other parser gaps deferred |
| UT-zlib2.md | deferred: blocked zlib/textblock/message coverage |
| UT3-SALVAGE.md | covered by `salvage/ut3-batches` |
| W1-CAVE-SAVE-DATA.md | historical/superseded by W1 track fixes |
| W1-cave.md | historical |
| W1-CITED.md | historical |
| W1-cmdwiz.md | historical |
| W1-EFFECT-HANDLERS.md | deferred only where later effect audit identifies candidates |
| W1-monbase.md | historical |
| W1-obj-util.md | historical |
| W1-objfilter.md | historical |
| W1-player-util.md | historical |
| W1-playercan.md | deferred P3 option-edge observation |
| W1-track.md | deferred persistent-level / secret-trap follow-up |
| W1-vault.md | closed: no gaps |
| W2-FIX-REVIEW.md | deferred: target-panel stairs and death-chain wiring are non-small |
| W2-FIX.md | historical ledger |
| W2-WIRING.md | deferred: remaining NOT-WIRED entries require separate live-entry work |
| W3-ORACLE.md | deferred: oracle/statistics work |
| W3-STATS-S2-S3.md | historical: S3 withdrawn; oracle schema limitation remains |
| W3-UNIT-TESTS-core.md | historical/blocked test coverage, no port defect |
| W3-UNIT-TESTS-parse.md | deferred: G1-G4 parser gaps |
| W3-UNIT-TESTS-player.md | covered by `feat/pack-overflow-sort`; remaining NULL ordering gap deferred |
| W3-UNIT-TESTS-timed.md | deferred: known-state/timed UI seam |
| W3-UNIT-TESTS-zlib-msg.md | deferred: blocked zlib/textblock/message work |
| W5-DATA-EXACTNESS.md | closed for shipped data; malformed-data edge noted only |

No additional product fix was safe and small enough to make directly.  The
deferred branch is documentation-only and starts at `origin/master`; it cites
the source citations already verified in these findings rather than claiming a
new implementation.
