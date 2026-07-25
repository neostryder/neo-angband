# L13_score_death audit (scoring / death / history types)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: reference/src/list-history-types.h, score.c, score.h, score-util.c.
Searched packages/ (excl. node_modules, dist, borg) for real implementors.

Live path: packages/core/src/score/{types,score,display}.ts (formula, table ops,
gating, row strings) + packages/web/src/score.ts (localStorage ScoreStore +
Hall of Fame screen) + packages/web/src/main.ts LOOP_STATUS.DEAD (enterScore
call site). History type enum: packages/core/src/generated/history-types.ts
(codegen from list-history-types.h); history runtime is player/history.ts
(player-history.c, not a lane ref file).

### L13_score_death-001  Winner retirement never stamps WINNING_HOW or death_knowledge bonuses before enter_score
sev: P1
concession: n
ref: reference/src/player-util.c:288-294 (death_knowledge: if total_winner then depth=0, died_from=WINNING_HOW, exp=max_exp, lev=max_lev, au+=10000000); reference/src/player-util.c:313 (enter_score after that prep); reference/src/score.h:37 (WINNING_HOW "Ripe Old Age"); reference/src/score.c:309 (build_score uses p->died_from); reference/src/score-util.c:59-63,284-307 (winners sort before non-winners via how==WINNING_HOW)
port: packages/web/src/main.ts:3371-3374 (retire sets diedFrom="Retiring" only); packages/web/src/main.ts:5260-5282 (DEAD path: historyUnmaskUnknown + enterScore with player.diedFrom as-is; no winner prep); packages/core/src/score/score.ts:77-93,264-284 (buildScore/enterScore faithfully use the how string they are given)
expected: A total_winner who retires is prepped by death_knowledge so the high-score record has how="Ripe Old Age", cur_dun=0, cur_lev=max_lev, gold includes +10000000, and highscore_where/cmp place that record ahead of every non-winner.
actual: Retire keeps diedFrom="Retiring" and totalWinner true (so the Retiring gate is bypassed and the score IS entered), but how stays "Retiring", depth/lev/au are not adjusted. Sorting treats the victory like any other death cause; gold and town-level display are wrong. WINNING_HOW exists only in types/sort helpers and is never written on the live path.
why: The canonical victory high-score path (retire after winning) produces wrong rank order and wrong Hall-of-Fame lines; total_points formula is unaffected (pts ignores gold) but winner precedence is how-based.
confidence: high

### L13_score_death-002  enter_score rejection messages are discarded on the live death path
sev: P2
concession: n
ref: reference/src/score.c:283-304 (msg "Score not registered for cheaters." / "for wizards." / "due to interruption." / "due to retiring." + EVENT_MESSAGE_FLUSH on each reject branch)
port: packages/core/src/score/score.ts:264-277 (enterScore returns {entered:false, reason} and never msgs); packages/web/src/main.ts:5272-5283 (const outcome = enterScore(...); void outcome;)
expected: A gated death shows the C rejection string and flushes messages before continuing the death UI.
actual: Core only returns a reason code; the shell throws the outcome away. Cheater/wizard/interrupt/retire non-winner deaths silently skip scoring with no player-visible notice.
why: Visible message drift on every non-scored death path; a faithful equivalent (msg from reason) is achievable in-browser.
confidence: high

### L13_score_death-003  High-score persistence is JSON localStorage, not scores.raw with lock files
sev: P3
concession: y
ref: reference/src/score.c:37-66 (highscore_read: ANGBAND_DIR_SCORES/scores.raw binary sizeof(high_score) records + regularize); reference/src/score.c:98-198 (highscore_write: scores.lok lock, scores.new, rename dance, setuid)
port: packages/core/src/score/types.ts:64-75 (ScoreStore seam); packages/web/src/score.ts:48-78 (createLocalStorageScoreStore: JSON array, regularize on read, no lock file)
expected: Fixed-width 128-byte ASCII records in scores.raw with atomic rewrite under scores.lok.
actual: Compact typed HighScore[] as JSON under localStorage key "neo-angband-scores". regularize-on-read and MAX_HISCORES cap match the defensive posture; locking/setuid/file rename cannot exist in the browser.
why: Unavoidable platform substitution; scoring math, order, and cap are ported in core. Logged so interchange with native scores.raw is not assumed.
confidence: high

### L13_score_death-004  build_score uid is always 0 (no OS player_uid)
sev: P3
concession: y
ref: reference/src/score.c:244 (strnfmt entry->uid "%7u", player_uid)
port: packages/core/src/score/score.ts:51-52,86 (uid: deps.uid ?? 0); packages/web/src/main.ts:3592-3602 (scoreBuildDeps never passes uid)
expected: Score records carry the host user id in the User column of the Hall of Fame.
actual: Every record uses uid 0. Display still prints "(User 0, ...)" faithfully for that value.
why: Browser has no getuid/player_uid; zero is the documented default. Cosmetic only.
confidence: high

### L13_score_death-005  highscore_valid accepts blank-what records with non-empty other fields
sev: P3
concession: n
ref: reference/src/score-util.c:166-186 (empty what[0]: valid only if pts/gold/turns/day/who/uid/p_r/p_c/cur_*/max_*/how are all empty); reference/src/tests/player/pscore.c:76-114
port: packages/core/src/score/score.ts:108-109 (if isEmpty(s) return true without scanning other fields)
expected: A record with what empty but e.g. pts set is invalid (and regularize zeros it).
actual: any HighScore with what=="" is treated as a valid empty regardless of leftover numeric/string fields. highscoreRegularize still drops isEmpty entries, so a clean compact list after regularize matches C's end state for typical corruption; the pure validity predicate does not.
why: Diverges from the C oracle API and the upstream unit tests; low live impact under typed JSON that rarely manufactures half-empty slots.
confidence: high

### L13_score_death-006  highscore_regularize sets irregular=true for every empty slot it drops
sev: P3
concession: n
ref: reference/src/score-util.c:218-220 (skip empty what without setting irregular); reference/src/score-util.c:211-215,225-237 (irregular only for invalid zeroing, gap-compacting copies, or out-of-order); reference/src/tests/player/pscore.c:425-436 (ordered non-empty + trailing empties => regularize returns false)
port: packages/core/src/score/score.ts:212-216 (if !valid || isEmpty: irregular=true; continue)
expected: A best-first list with only trailing empty padding is already regular; regularize returns false and leaves contents ordered.
actual: Any empty element in the input forces irregular=true even when non-empty prefix was already ordered. Compact live lists usually have no empties (flag stays correct); callers that pass padded arrays see a false positive irregular flag (web store discards the flag).
why: Return-value parity only; sort/drop results for non-empty records still match.
confidence: high

## MAP L13_score_death
reference/src/list-history-types.h -> packages/core/src/generated/history-types.ts (HISTORY_TYPE_ENTRIES + HIST enum; codegen scripts/codegen-lists.mjs)
reference/src/score.h -> packages/core/src/score/types.ts (MAX_HISCORES, WINNING_HOW, HighScore, ScoreStore, ScoreRow); packages/core/src/score/score.ts (API surface: buildScore, enterScore, highscore*)
reference/src/score.c -> packages/core/src/score/score.ts (totalPoints, buildScore, highscoreAdd, highscoreCount, enterScore, predictScore); packages/web/src/score.ts (highscore_read/write via ScoreStore + localStorage; display shell); packages/web/src/main.ts (enterScore on LOOP_STATUS.DEAD, scoreBuildDeps)
reference/src/score-util.c -> packages/core/src/score/score.ts (highscoreValid, highscoreCmp, highscoreRegularize, highscoreWhere)
