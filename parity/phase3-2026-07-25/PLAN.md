# Phase 3 — Exactness, Wiring, and Statistical Proof

Started 2026-07-25. Governs the work after the 2026-07-24 dual audit and its
nine merged fix batches (`ad1b2904a` … `7f494358b`).

## Why a third phase

The dual audit proved coverage at **file** granularity and found defects by
**reading**. Two blind spots followed directly from that, and both bit us:

1. **Wiring.** The dominant defect shape in the fix phase was *"the logic is
   correct in a helper the live path never calls"* — a decoy written to a dead
   local, a Free Action hook never supplied, an `EF_SELECT` chooser built and
   never wired. Every one of those passed its author's tests. A file-level map
   cannot see it.
2. **Behaviour.** `packages/cli/src/parity-c.test.ts` — the only harness that
   compares the port against **real compiled C output** — is red, and *all 462
   code-review findings missed it*. Statistical divergence is invisible to code
   reading.

neostryder's directive for this phase: every line of reference code and data
**accounted for, ported exactly, and fully wired up**, with **statistical /
Monte-Carlo tests** proving the game *behaves* the same — visual, statistical,
and data parity all at 100%.

So Phase 3 replaces "an expert read it" with **mechanical proof** wherever a
mechanical proof exists, and reserves human/agent judgement for the residue.

## The six workstreams

| ID | Workstream | Proves | Mechanism |
|----|-----------|--------|-----------|
| W1 | Symbol-level coverage | every C function is accounted for | `tools/census.mjs` → per-file adjudication |
| W2 | Wiring / reachability | every ported symbol is live | `tools/census.mjs` → suspect triage |
| W3 | Statistical oracle | the game *behaves* identically | compiled C oracle + Monte Carlo + ported upstream unit tests |
| W4 | Visual parity | every screen looks identical | screendump harness diffed against `ui-*.c` |
| W5 | Data exactness | every gamedata field is identical | independent re-parse of `reference/lib/gamedata` |
| W6 | P2/P3 close-out | the audit backlog is empty | stale-vs-open triage, then fix |

### W1 — Symbol-level coverage

`tools/census.mjs` extracts every function definition from the in-scope
reference `.c` files (4 493 of them) and every top-level value declaration from
the port, then matches by normalised name.

Buckets decide *how* a function is proven, not whether it counts:

- **engine** (2 541) and **zlib** (239) — symbol match plus behaviour review.
- **ui** (1 030) — proven against the port's terminal UI in W4.
- **frontend** (85, `main-win.c` + `win/*`) — proven in W4; a browser front end
  legitimately replaces the Win32 one, but every *behaviour* it hosts (window
  layout, fonts, sound, screenshot, prefs) must exist somewhere.
- **data-init** (535, `*-init.c`) — a per-parse-handler symbol match is
  meaningless; these are proven wholesale by W5's field-level re-parse.
- **oracle** (63, `main-stats.c` + `stats/*`) — deliberately *not* ported; it is
  the C we diff against.

Reports (`reports/`):

- `w1-c-symbol-coverage.tsv` — every C function with MATCH / INLINE? / UNMATCHED.
- `w1-unmatched-by-file.tsv` — the per-file worklist, worst first.
- `w1-adjudication-queue.tsv` — 1 793 unmatched names over 133 files
  (717 non-static). **Non-static first**: a non-static C function is public API
  that other translation units call, so a missing counterpart is a candidate
  real gap rather than an inlining artefact.

Each queue file gets one agent pass: read the C file and its port counterpart,
then rule on every unmatched name as `PORTED-ELSEWHERE` (cite port file:line),
`INLINED` (cite the call site that absorbed it), `N/A-CONCESSION` (browser, with
justification), or `MISSING` (a finding, with severity).

### W2 — Wiring / reachability

The same tool builds an import graph from the real entry points
(`packages/web/src/main.ts`, the CLI mains) and a token-level reference graph,
then classifies every port symbol:

| Bucket | Count | Meaning |
|---|---|---|
| `MODULE-UNREACHABLE` | 97 | its whole module is unreachable from any entry |
| `TEST-ONLY` | 58 | exported, referenced only by tests — **the audit's dominant defect shape** |
| `ORPHAN` | 48 | exported, referenced nowhere at all |
| `DEAD-LOCAL` | 6 | module-local and never used |
| `REF-UNREACHABLE` | 3 | used only by modules that are themselves unreachable |

212 suspects, each adjudicated against the C: is the C counterpart reached
during normal play? Verdicts are `LIVE-VIA` (cite the live call path),
`BENIGN` (constant/table exported for completeness, mod seam, save-format
reader), or `NOT-WIRED` (a finding).

Known already from the first run, ahead of triage:

- `packages/mod-sdk/**` is unreachable from the running game. neostryder's rule is
  that the mod **framework ships with the port but stays unused**; "unused"
  means no mods are loaded, *not* that the loader is absent from boot. Candidate
  finding.
- `packages/content/**` is unreachable: gamedata is parsed at build time and the
  compiled pack is committed. That is a legitimate browser concession, and W5 is
  what keeps the committed pack honest.
- Wizard-mode commands (`wizCreateAllArtifact`, `wizTweakItem`, `wizTeleportTo`,
  `wizCheatDeath`) are orphaned or test-only, against the standing
  exact-parity mandate that wizard mode and cheat options are in scope.
- Ranged-attack rune learning (`equipLearnOnRangedAttack`,
  `learnBrandSlayFromLaunch`, `missileLearnOnRangedAttack`) is test-only.
- `packages/cli/src/wiz-stats.ts` has no live caller, though `wiz-stats.c` is a
  wizard command in the C.

### W3 — Statistical oracle (the behaviour proof)

The machine has the MSYS2 mingw64 toolchain, `cmake`, `ninja`, and `sqlite3`, so
the C oracle is reproducible here. Four increments:

1. **Rebuild and widen the C oracle.** Recipe in `packages/cli/baseline/README.md`.
   Regenerate at a sample size large enough that a 5% divergence is unambiguous,
   over the full depth range rather than 1–8.
2. **Close S-2.** The measured divergence, at 100 port runs against a 200-run C
   baseline:
   `depth 6 total 46.465→43.48`, `depth 6 race 63 2.855→5`,
   `depth 7 48.775→46.11`, `depth 8 47.805→51`.
   Two of those four are exact integers, which is suspicious for a 100-sample
   mean, so **the first job is to establish whether each delta is real or a
   sampling artefact** — then fix the generator. Not the tolerance, and not the
   baseline.
3. **Extend the import.** Object-kind distribution is a documented gap (the C
   splits it across `consumables`/`wearables_*`/`artifacts` with a remapped
   index) and gold-by-origin is a known real delta. Both become compared
   metrics.
4. **New Monte-Carlo dimensions.** Generation is only one subsystem. Add
   distribution harnesses — with a C oracle where one can be built, and against
   the C formula re-derived from source where one cannot — for: melee/ranged
   hit and damage, critical tiers, monster spell selection frequency, ego and
   artifact rates by depth, randart property distribution, birth stat rolls,
   disarm/steal/device-use rates, level feeling, and trap effects.
5. **Port the upstream C unit tests.** `reference/src/tests/**` is 86 files and
   ~35 k lines of upstream tests carrying **exact expected values** — the single
   densest oracle in the repository, and it was excluded from the last audit as
   "build tooling". Porting it to vitest converts upstream's own assertions into
   permanent port assertions.

### W4 — Visual parity

1. A port-side screendump harness emitting the 80×24 char+colour grid for every
   canonical screen and state (title, birth, main map, inventory/equipment,
   character sheet, stores, knowledge menus, death).
2. Each dump diffed against the C's printing code — exact row/column, exact
   string, exact colour — plus the literal `lib/screens/*.txt` where those are
   used verbatim.
3. Asset accounting: tiles, fonts, sounds, `*.prf` mappings — present, identical
   where copied, and correctly referenced.

### W5 — Data exactness

A committed test that re-parses **every** `reference/lib/gamedata/*.txt` with an
independent reader and diffs field-by-field against the compiled pack the game
actually loads. Grok's audit-time one-off diff reported `missing=0`; this makes
that permanent, extends it from presence to *value*, and is what licenses the
`packages/content` build-time concession.

### W6 — P2/P3 close-out

~335 raw P2/P3 findings from the dual audit. Triage stale-vs-open first — Stream
D's five "already correct" claims were independently verified, so the real
backlog is smaller than the raw count — then fix what survives.

## Method (unchanged from the audit, because it worked)

- **C is the oracle.** Every claim cites `reference/...:line`.
- **Verify by re-derivation**, never by reading a comment or a test name.
- **Trace the live path.** A fix in a helper is not a fix.
- **Preserve upstream bugs.** Faithful means faithful.
- **One engine writes, the other reviews, Opus gates, neostryder approves.**
- **Chunked tests with hard timeouts** — never a monolithic `pnpm test`
  (`packages/borg/src/{think,foundation}.test.ts` hang; pre-existing, Borg phase).

## Status, 2026-07-25

Merged to master and pushed:

- **W3 statistical oracle.** C rebuilt at 1000 descents over depths 1–20.
  Hypothesis tests replace the tolerance gate (`stat-test.ts`,
  `parity-c-stat.test.ts`). **S-2 closed** as a sampling artefact — density is
  green at every depth, pooled Stouffer Z = −1.22. **S-3 opened**: the species mix
  diverges at depths 5–20, G = 389–823, p to 4.8e-98. `parity-c-stat.test.ts` is
  red on purpose until it closes.
- **Registry proof.** `codegen-lists.mjs --check` + `codegen-drift.test.ts`:
  1174 entries across 31 `list-*.h` headers, mutation-verified.
- **Dispatch proof.** `effect-coverage.test.ts`: all 112 upstream effects have a
  handler, each in exactly one registry, PARTIAL set pinned. Consumes the nine
  `*_HANDLER_CODES` arrays the census found orphaned.
- **Census + worklists.** `tools/census.mjs` (212 wiring suspects),
  `tools/c-api.mjs` + `c-api-allowlist.json` (1148 unmatched public C functions,
  per-header).
- Two stale self-pins cleared: `stats-baseline.json` and the descend scenario
  count — neither was a parity claim.

On branches, awaiting review or merge:

| Branch | Work | State |
|---|---|---|
| `p3/w2-fix` | all 22 `NOT-WIRED` fixes | suite green (1503/1504); under adversarial review; one gate finding open (`state.confirmDie` declared and never assigned) |
| `p3/data` | W5 independent gamedata re-parse | 3194 records / ~57k fields, zero diffs, mutation-verified; needs the directive-coverage guard |
| `p3/ut-core` | 19 upstream unit tests (effects/object/monster/cave/game/artifact/command) | 75 tests green; spot-verified faithful |
| `p3/ut-zlib` | 4 upstream unit tests | under-delivered — the z-textblock N/A is wrong, the port has a Textblock analogue; found 2 real divergences |
| `p3/s3`, `p3/s3-review` | S-3 diagnosis + prepend-order audit | RC2 verified: the C prepends `friends`/`drops`, the port stores file order |

Open findings not yet fixed: S-3 (species mix), the 22 wiring fixes pending
review, W1 adjudication (1148 entries, gameplay headers first), the batch-1
redo, and the W5 directive guard.

## Exit criteria

1. `w1-adjudication-queue.tsv` fully adjudicated; every `MISSING` fixed.
2. Zero `NOT-WIRED` verdicts in W2.
3. `parity-c.test.ts` green at a wide sample over the full depth range, with the
   object and gold-origin metrics compared rather than excluded.
4. Every ported upstream unit test green.
5. Every canonical screen byte-identical to the C's layout, or an explicitly
   ratified concession.
6. W5 field diff empty.
7. P2/P3 backlog empty.
