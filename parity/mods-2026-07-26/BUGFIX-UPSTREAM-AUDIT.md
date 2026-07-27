# Bug-fixes catalogue re-verification — 2026-07-26

Scope: `4.2.6..upstream/master` (161 commits), inspected locally on this
branch.  `git merge-base --is-ancestor` confirms that `72aec110` and
`a7b24098` are reachable from `upstream/master`.  “Unverifiable” below means
the local checkout has no issue/PR discussion object; no web claim is implied.

## Catalogue verdicts and port readiness

| Entry | Cited refs | Upstream verdict | Current port status | Port site / evidence |
|---|---|---|---|---|
| 1 notes | #6665/#6656, `03e559c9` | **CHANGED**: #6665 was merged as `72aec1103ab8153911b503a10da5a1834c1e2b0a` (2026-07-14), not open. Its subject and diff are exactly the described delayed-expansion fix. | **READY** | `packages/web/src/main.ts:3445` stores user input; `packages/web/src/screens.ts:1053` displays history. Gate raw storage/display expansion across those paths. |
| 2 store charges | #6537/#6539, `4ce58ed0` | **WRONG**: cited SHA is an SDL2 commit, not this fix. Correct merged commit is `a7b240980f56a66ece0eb921dcfafcca5754d750`, whose message names #6537 and whose diff changes `src/load.c`, `src/store.c`, `src/store.h`. | **NOT APPLICABLE** | `packages/core/src/store/store.ts:365` has `storeCarry(..., maintain)` and live callers pass `true` (`:565`, `:585`); `packages/core/src/session/game.ts:2314` regenerates town stores, with no load-stock path. |
| 3 partial-stack charges | #6355/#6356, `e0af0e15` | **CONFIRMED** for the baseline merge; the residual proposed guard has no upstream commit/PR, so its alleged discussion is **UNVERIFIABLE** locally. | **READY** (brief’s “unused” claim is stale) | `packages/core/src/game/gear.ts:841-852` calls `objectAbsorbPartial`; add the full-destination guard before `:852`. |
| 4 object-list order | #4664/#4668 | **UNVERIFIABLE**: neither issue/PR state is represented by a post-tag commit; the document correctly does not pin a SHA. | implemented | `packages/core/src/game/obj-list.ts:216`. |
| 5 unique history | #4245/#6245, `11f68113` | **UNVERIFIABLE** for current issue state; `11f68113` exists locally and is pre-tag as the document says. | implemented | `packages/core/src/session/game.ts:801`. |
| 6 pile crash | #4225 | **UNVERIFIABLE** (open issue, no post-tag fixing commit). | no upstream fix | No live linked-pile representation; proposed assertion belongs with `packages/core/src/obj/object.ts:1075` when a reproducer exists. |
| 7 missing messages | #3987 | **UNVERIFIABLE** (no post-tag core fix). | no upstream fix | Main and recall already derive from the web log at `packages/web/src/main.ts:1333`; no demonstrated divergence. |
| 8 noise/scent | #4605 | **UNVERIFIABLE** (no post-tag fixing commit). | implemented | `packages/core/src/session/save.ts` / `packages/core/src/world/chunk.ts` (existing mod gate). |
| 9 load RNG | #6537 | **CONFIRMED**: `a7b24098` explicitly says it removes the immediate cause but loading may still have RNG side effects. | **READY** as an invariant audit, not a separate patch | `packages/core/src/session/save.ts` load path is the test/gate site; no evidence in the commit of another concrete upstream defect. |
| 10 bad effect | #6533 | **UNVERIFIABLE** (no reproducer/fix in local post-tag history). | no upstream fix | `packages/core/src/effects/interpreter.ts:427` is the dispatch point. |
| 11 quiver overflow | #4666/#6512 | **UNVERIFIABLE** for issue state (no post-tag fix). | **READY** — contrary to the document | The complete recompute exists at `packages/core/src/game/gear.ts:655`; inscription commands are live at `packages/web/src/main.ts:1997` and core overflow is `packages/core/src/game/obj-cmd.ts:264`. |
| 12 duplicate artifacts | #4510, `5c799b61` | **UNVERIFIABLE**: abbreviated historical SHA is not present in this local object database; no post-tag fix exists. | implemented | `packages/core/src/obj/make.ts:988`. |
| 13 stairs | reference source only | **CONFIRMED** as deliberately non-upstream: no issue/PR/SHA exists to reverify. This violates the document’s otherwise mandatory issue/PR/SHA rule, but its stated exception is honest. | implemented | `packages/core/src/gen/generate.ts:436`. |

## Newly discovered post-tag bug fixes

These are the post-tag commits that fix in-scope game/core behaviour and are
not already represented above.  Frontend-only, Borg, build/CI, docs, data art,
translation, and the four explicitly excluded balance changes are not proposed.

| Severity | SHA | Subject / refs | What it fixes | Likely port site |
|---|---|---|---|---|
| P1 | `1e585edfddc275ef6719f940a4caeb2de51ca75e` | Alter binary searches to avoid the possibility of integer overflow; no issue in message | Overflow-safe midpoint calculations in core C searches (`gen-cave.c`, `obj-make.c`). JS numbers do not have C signed-overflow, so retain as a **not-applicable-by-runtime** catalogue note, not a toggle. | `packages/core/src/gen/`, `packages/core/src/obj/make.ts` if a binary search is later introduced. |
| P2 | `a34e3c74d482219258313789dc64531aa1e3f26e` | In classic level generation, reject level with fewer than two rooms; no issue in message | Prevents tunnelling-step crash under impossible/modified room data. This is malformed-data resilience, not a normal-play 4.2.6 repro. | `packages/core/src/gen/generate.ts` generation acceptance loop. |
| P2 | `28ccee172df1f2e7f0d27f6aa6081c251baeeae9` | Only set `character_saved` once new save file is in place; no issue in message | Avoids claiming a save succeeded before file replacement succeeds. The web save backend is different; assess atomics there, not in core. | `packages/core/src/session/save.ts` / web persistence adapter. |
| P3 | `cebb5ffc996a2301cfe07eae141839c43814b346` | Avoid infinite loop in `textui_check_break()`; regression from `dca08be2` | C text UI regression. Not portable to the web UI. | none (frontend exclusion). |

### Classification counts

All **161** commits were classified by subject and changed paths: **2** already
catalogued fixes (`72aec110`, `a7b24098`); **4** newly identified bug/resilience
fixes above; **155** excluded (frontend/platform/Borg, build/CI/docs,
data/tiles, refactors, cosmetic wording, or non-bug design/balance).  The
count intentionally includes `cebb5ffc` in the four so the sweep is auditable,
while marking it non-portable rather than proposing it for this mod.

## Document inaccuracies

- “The mod is enabled by default” is false: `packages/web/src/mod-store.ts:40`
  defines `DEFAULT_ENABLED_MODS` as `[]`.
- `MOD_SEAMS.md`’s “single reader” claim is false: alongside
  `modRuleEnabled()` at `packages/core/src/game/context.ts:900`, direct reads
  exist at `packages/core/src/gen/generate.ts:436` and
  `packages/core/src/obj/make.ts:988`.
- Entry 1’s “open/unmerged” status and its instruction to await a merge SHA are
  obsolete: the merge is `72aec110`.
- Entry 2’s claimed merge SHA is wrong; it names SDL2 error handling. The
  correct SHA is `a7b24098`.
- Entry 3’s “partial path is unused” is false: `gear.ts:852` invokes it.
- Entry 11’s “quiver + inscription commands not yet ported” is false; both are
  live at the sites cited in the table.

## Where this brief was wrong

The brief’s belief that #1 and #11 were blocked is wrong: both are READY.
The belief that #3 was structurally impossible is also wrong because its
partial-absorb path is live.  The brief correctly anticipated that #2 is not
applicable, but the document’s SHA for it is wrong.

## Recommendation

Implement #3 first (small, concrete live path), then #1 (now has the exact
upstream merged oracle), then #11 after reproducing the overflow condition.
Keep #9 as a save-load invariant/test rather than a player toggle.  Drop #2
from the toggle catalogue (retain a design note only); drop #6, #7, and #10
unless a port reproducer appears.  Do not add the four sweep items as normal
bug-fixes without a port-specific repro; only the malformed-data generator
guard merits a future resilience decision.
