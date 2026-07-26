# W1 — the 26 CITED-NO-CANDIDATE symbols, adjudicated

Lane A, branch `p4/w1-cited`. Input: the 26 rows of
`reports/w1-triage.tsv` that the mechanical pass bucketed
`CITED-NO-CANDIDATE` (the port names the C symbol somewhere, but the
collapsed-name matcher found no identifier that plausibly implements it).

**Headline: there is no missing subsystem here. 0 of the 26 are absent
behaviour that ought to be present.** 22 have a port counterpart (renamed,
folded into a caller, or dissolved by a data-structure choice); 4 have none by
design and are now on an explicit scope-exclusion list.

**But the bucket itself was largely an artifact.** For 11 of the 26 the
"citation" was a substring of a LONGER C name — the triage used
`src.includes(name)`, so `cmdq_push` counted as a citation of `q_push`,
`file_putf` of `file_put`, `store_parser_new` of `parser_new`,
`chunk_find_adjacent` of `chunk_find`, `square_isprojectable` of
`square_isproject`, `update_statusline_aux` of `update_statusline`, and the
English word "al**read**y" of `lread`. So "somebody looked at this C function
and wrote its name down" was not true for those 11. The matcher is fixed (see
the last section); treat the sharpness of this bucket as retracted.

Two real divergences turned up while checking, both **reported not fixed**
(rule 8): the line editor behind every text prompt (§A) and the case
sensitivity of `lookupTrap` (§B). Neither is one of the 26 being absent; both
are the port counterpart behaving differently from the C.

## Verdicts

Legend: `PRESENT-RENAMED` = a port function/method does the job under another
name. `INLINED` = no separate port function; the behaviour is in the caller or
dissolved by a data-structure choice. `N/A-BY-SCOPE` = no counterpart by
design, rule named.

| # | C symbol | C site | verdict | port site |
|---|---|---|---|---|
| 1 | `square_isproject` | cave-square.c:562 | INLINED | `core/src/world/project.ts:637` — `if (!c.sqinfoHas(g, SQUARE.PROJECT)) continue;` inside `project`. The predicate has exactly ONE upstream call site (project.c:940) and the port inlines the flag test there. |
| 2 | `square_set_trap` | cave-square.c:1299 | INLINED | `core/src/game/trap.ts:391` `installTrap` (unshift), `:224` `squareRemoveTrap` (splice), `:240` `squareRemoveAllTraps` (delete). Upstream keeps a singly-linked trap list per square and this setter writes its HEAD pointer; the port stores an array per grid in `state.traps`, so there is no head pointer to set. |
| 3 | `do_cmd_navigate_down` | cmd-cave.c:1408 | PRESENT-RENAMED | `core/src/game/player-path.ts:990` `navigateDownAction`, registered as `"navigate-down"` at `:1015`. Already carried the C citation; the matcher missed it because the port appends `Action`. |
| 4 | `do_cmd_navigate_up` | cmd-cave.c:1454 | PRESENT-RENAMED | `core/src/game/player-path.ts:1002` `navigateUpAction`, registered at `:1016`. Same. |
| 5 | `do_cmd_study` | cmd-obj.c:1245 | PRESENT-RENAMED | `core/src/game/spell-cmd.ts:297` — the `"study"` command handler, with `do_cmd_study`'s `PF_CHOOSE_SPELLS` dispatch as its inner branch at `:326` (`do_cmd_study_spell`) / `:330` (`do_cmd_study_book`, reservoir sample). `player_get_resume_normal_shape` gate present at `:298`. |
| 6 | `event_signal_message` | game-event.c:172 | PRESENT-RENAMED | `core/src/events.ts:301` `EventBus.emit`. The C union payload becomes a typed payload map, so all four typed `event_signal_*` helpers collapse into one `emit` with a different payload type. `MessageEventData` (`:15`) preserves the NULL-vs-"" distinction the C relies on. |
| 7 | `view_ability_menu` | game-input.c:334 | PRESENT-RENAMED | `web/src/abilities.ts:50` `showAbilities`. The C function is only a hook trampoline (`view_abilities_hook` → `textui_view_ability_menu`); the port drops the hook indirection, so the trampoline itself has no counterpart and the UI function does. |
| 8 | `chunk_find` | gen-chunk.c:130 | N/A-BY-SCOPE (dead C API) | none. **Zero callers in the whole C tree** — defined in gen-chunk.c, prototyped in generate.h, called nowhere. A pointer-identity membership test over `chunk_list`; the port keys stored levels by depth (`core/src/game/context.ts:692` `levelCache`), so identity search is meaningless. No player-visible behaviour. |
| 9 | `dump_level` | gen-util.c:987 | INLINED (data half) + N/A-BY-SCOPE (file half) | `core/src/game/wizard.ts:1579` `wizDumpLevelMap` returns the feature grid; `web/src/wizard.ts:609` renders it. `dump_level` is a three-line convenience over `dump_level_header`/`_body`/`_footer` writing HTML to an `ang_file`; the port has no `ang_file` layer, so the HTML/file half is out of scope. Wizard-mode only. |
| 10 | `parser_new` | parser.c:99 | INLINED | `content/src/parser.ts:344` `parseLine` + `:73` `parseSignature`. Upstream allocates a mutable `struct parser` that `parser_reg` fills with hooks and `parser_setpriv` threads state through; here the directive table is the caller's `lookup` argument and parsing is a pure function, so there is nothing to allocate (`parser_destroy` likewise has no counterpart). |
| 11 | `askfor_aux` | ui-input.c:860 | PRESENT-RENAMED, **with a real divergence — see §A** | `web/src/overlay.ts:424` `promptText`. |
| 12 | `menu_new` | ui-menu.c:980 | INLINED (UI) | `web/src/overlay.ts:638` `selectFromMenu`. `menu_new` allocates a `struct menu` (skin + iterator + priv). A menu in the port is one call with its rows, so there is no struct to allocate. Object selection keeps its own shape at `:883` `itemSelect` (upstream's item menu). |
| 13 | `file_put` | z-file.c:1208 | N/A-BY-SCOPE (no `ang_file` layer) | `web/src/charsheet.ts:534` `downloadDump` (Blob), `cli/src/main-spoil.ts:76` (`writeFileSync`). `file_put` appends one line to an open handle; the port builds a whole dump as a string and hands it over once. 86 upstream call sites, all of them "write text out". |
| 14 | `q_push` | z-queue.c:93 | PRESENT-RENAMED | `core/src/gen/cave.ts:706` `IntQueue.push`. |
| 15 | `q_pop` | z-queue.c:99 | PRESENT-RENAMED | `core/src/gen/cave.ts:710` `IntQueue.pop`. Upstream's queue is a fixed-size ring that `abort()`s on overflow; the port's is a growing array with a read cursor — same FIFO order, no capacity. (Structurally unmatchable by the old matcher: `pop` is 3 chars and the index dropped identifiers under 4.) |
| 16 | `my_stristr` | z-util.c:441 | PRESENT-RENAMED (borg) + INLINED (engine), **with a divergence — see §B** | `borg/src/perceive-facts.ts:34` `stristr` is the direct port (for borg-flow-kill.c:2800). The three engine call sites inline it: `core/src/mon/bind.ts:645` (`lookup_monster`, correct), `core/src/world/trap.ts:142` (`lookup_trap`, **case-sensitive — §B**), and `lookup_artifact_name` (obj-util.c:534) which has no port counterpart at all — out of my scope, noted below. |
| 17 | `init_parse_grafmode` | grafmode.c:92 (static) | INLINED | `core/scripts/gen-grafmode.mjs:37-78` (loop) — the build-time generator parses `lib/tiles/list.txt` in one loop instead of building a parser and registering five directive handlers into it. The five directives were already documented at `:13-18`. |
| 18 | `rd_monster` | load.c:259 (static) | PRESENT-RENAMED | `core/src/session/save.ts:395` `deserializeMonster` (JSON, not the binary block; the port's save format is its own by decision 9, but WHAT is read follows upstream). Named `known_pstate` restore is at `:420`. |
| 19 | `rd_trap` | load.c:359 (static) | PRESENT-RENAMED | `core/src/session/save.ts:1459` `deserializeTraps` — `rd_trap` plus its caller `rd_traps_aux` (load.c:1473), because traps are stored per grid rather than as a linked list off the square. |
| 20 | `display_help` | main-win.c:3473 (static) | N/A-BY-SCOPE (native front end) | none. Shells out to the Windows help viewer for the win32 front end. There is no win32 front end. |
| 21 | `project_player_handler_DARK` | project-player.c:268 (static) | INLINED | `core/src/game/player-side.ts:328` — `case PROJ.DARK` in the side-effect switch. Checked line by line against the C: `player_resists` early return with "You resist the effect!", `TMD_BLIND 2 + randint1(5)`, and the `power >= 70` block's three `randint0(dam) >` gates (100 life drain via `drainLife`'s HOLD_LIFE arm, 200 SLOW, 300 AMNESIA) in the same order, so the RNG draw sequence matches. |
| 22 | `parse_store` | store.c:132 (static) | PRESENT-RENAMED (split) | grammar: `content/src/specs/misc.ts:99` `storeSpec`; semantics: `core/src/store/bind.ts:87` `bindStore`. Two upstream parse-time behaviours are absent — see §C. |
| 23 | `update_statusline` | ui-display.c:1316 (static) | PRESENT-RENAMED, **with a divergence — see §D** | `web/src/main.ts:4839` `renderStatusLine`, called at `:5169`. |
| 24 | `textui_get_com` | ui-input.c:1407 (static) | PRESENT-RENAMED | `web/src/overlay.ts:388` `getKeyInline`. `textui_get_com` is `get_com_ex` narrowed to an ASCII char, so only the general form has a counterpart. The C returns false on ESCAPE; the port resolves the key string and callers compare it. |
| 25 | `context_menu_store` | ui-store.c:902 (static) | N/A-BY-SCOPE (mouse-only UI) | none. The right-click popup inside a store. Every action it offers — Inspect inventory / Sell-or-Stash / Exit — is on the store's keyboard legend (`web/src/shop.ts:524` `helpRuns`), so nothing becomes unreachable. The port has no mouse context menus anywhere. |
| 26 | `lread` | win/readdib.c:47 (static) | N/A-BY-SCOPE (native front end) | none. A byte reader inside the win32 BMP/DIB loader. The port loads tiles as browser images. |

`do_cmd_navigate_up` / `_down` got the extra care the brief asked for: they are
**game behaviour, not UI convenience** — they consume energy, refuse while
confused, clear a web at the cost of a turn, refuse with "Something is here."
when a monster is in view, then walk a `path_nearest_known` route through the
run machinery. The port has all of it (`navigateStairAction`,
`core/src/game/player-path.ts:957`, with `playerHasMonsterInView` at `:942`).
Nothing is missing and no player action is impossible. Note that upstream does
**not** gate navigate on `OPT(autoexplore_commands)` even though it gates the
neighbouring `do_cmd_explore` (cmd-cave.c:1502) — if the port were to add that
gate to navigate it would be a divergence; it does not (`cave-cmd.ts:984`,
`:1003` dispatch unconditionally).

## Divergences found — REPORTED, NOT FIXED

### §A `promptText` is not `askfor_aux` — the line editor loses the `firsttime` rule and the cursor

**C:** `askfor_aux` (ui-input.c:860) drives `askfor_aux_keypress`
(ui-input.c:662). Three behaviours:

1. **First printable key clears the whole default** (L765-771: `if (firsttime)
   { buf[0] = '\0'; *curs = 0; *len = 0; atnull = 1; }`).
2. **First Backspace/Delete deletes all of it** (L706-712, "If this is the
   first time round, backspace means *delete all*").
3. `ARROW_LEFT` / `ARROW_RIGHT` move a cursor (L681-699) and insert/delete
   happen at the cursor, mid-buffer (L714-745, L775-800).

**Port:** `web/src/overlay.ts:424` `promptText` has none of the three. A
printable key does `buf += ev.key` — it **appends to the default**. Backspace
does `buf.slice(0, -1)` — it only ever drops the last character. There is no
cursor.

**Player-visible consequence**, at every caller that passes a non-empty
`initial`:

- `web/src/birth.ts:1624` "Enter your character's name", default = current
  name. Upstream: default `Gandalf`, type `Bob`, get `Bob`. Port: get
  `GandalfBob`.
- `web/src/charsheet.ts:733` the character-sheet rename ('c'): same.
- `web/src/birth.ts:1020` "Edit your character's background", default = the
  240-char generated history. Upstream: the first key wipes it and you type a
  fresh history; the first Backspace wipes it. Port: you can only append, and
  clearing it costs ~240 Backspaces.
- `web/src/wizard.ts:759`/`:764` default `"0"`: typing `1d6` yields `01d6`.
- `web/src/mods.ts:347` default `"https://"`.

**To implement:** give `promptText` a `firsttime` flag that starts true and
goes false after the first key that is not Enter; while true, a printable key
resets `buf` to that key and a Backspace resets `buf` to `""`. That alone
fixes every case above. Cursor editing (item 3) is a second, larger piece:
carry a `curs` index, render it in `paint`, move it on ArrowLeft/ArrowRight,
and splice at `curs` instead of appending. Note `ARROW_LEFT`/`RIGHT` under
`firsttime` do NOT clear — they jump the cursor to 0 / to the end.

Not a core-vs-mod question: this is faithful-UI behaviour that belongs in the
port, not an improvement over upstream.

### §B `lookupTrap` matches case-sensitively where the C uses `my_stristr`

`core/src/world/trap.ts:142`:

```ts
if (!closest && kind.desc.includes(desc)) closest = kind;
```

C, trap.c:57: `if (!closest && my_stristr(kind->desc, desc)) closest = kind;`
— `my_stristr` compares `toupper()` per character, i.e. case-INSENSITIVELY.
`core/src/mon/bind.ts:646` gets the same idiom right
(`race.name.toLowerCase().includes(query)`); this one does not.

**Currently unobservable**, which is why it is a low-severity report and not a
GAP: every `desc` in `lib/gamedata/trap.txt` is lower case, and all four port
call sites pass lower-case literals (`"web"`, `"decoy"`, `"door lock"`,
`"glyph of warding"` — effect-general.ts:186/215/530, project-feat.ts:252/291,
trap.ts:623). It becomes observable the moment a mod ships a trap whose `desc`
has a capital, or a caller passes mixed case. Fix is one line
(`kind.desc.toLowerCase().includes(desc.toLowerCase())`); I have deliberately
not made it.

### §C `bindStore` drops two of `parse_store`'s parse-time behaviours

C, store.c:132-142:

1. `if (feat < 0 || !tf_has(f_info[feat].flags, TF_SHOP)) return
   PARSE_ERROR_INVALID_VALUE;` — the entrance feature must carry `TF_SHOP`.
   `bindStore` (`core/src/store/bind.ts:87`) only resolves the `FEAT_*` name
   and throws on an unknown one; a valid-but-not-a-shop feature would be
   accepted.
2. `s = &stores[f_info[feat].shopnum - 1];` — the store array is ordered by the
   feature's `shopnum` (assigned in init.c:2287 by terrain.txt order among
   SHOP-flagged features). `StoreRegistry` (`:129`) keeps store.txt order and
   looks up by feature (`byFeat`, upstream's `store_at`).

Both are latent, not live: terrain.txt's SHOP order (STORE_GENERAL, ARMOR,
WEAPON, BOOK, ALCHEMY, MAGIC, BLACK, HOME) is identical to store.txt's record
order, so index-by-position and index-by-shopnum agree for the shipped data,
and `byFeat` is index-independent anyway. Worth knowing because upstream also
uses `shopnum` as a savefile key (store.c:1357, :1415) and `square_shopnum`
(cave-square.c:1512) returns `shopnum - 1` as a store index — anything that
starts indexing `StoreRegistry.stores` positionally inherits the assumption.

### §D the status line does not move for `SIDEBAR_TOP`

C, ui-display.c:1316-1325: `update_statusline` picks `row = Term->hgt - 1`,
**except** `if (Term->sidebar_mode == SIDEBAR_TOP) row = 3;`.

Port: `web/src/main.ts:5169` is the only call site and always passes
`rows - 1`, including when the layout is `"top"` (`:5147`
`if (layout === "top") renderCompactVitals(1, cols)`). The port does have the
three sidebar modes (`SIDEBAR_MODES`, default left), so the "top" mode renders
the status line at the bottom where upstream puts it at row 3. Pure layout;
no information is lost or gained.

## Out of scope, noticed in passing (rule 8 — reported, not fixed)

`lookup_artifact_name` (obj-util.c:520) has **no port counterpart**: the only
`packages` hits are test helpers (`core/src/game/history.test.ts:37`). It is
the by-name artifact lookup (exact `streq`, then a `my_stristr` fallback
requiring `strlen(name) >= 3`, plus the `a_idx > 0` quirk that makes artifact
index 0 unfindable via the fallback). Not in my 26; I did not chase its
callers or decide whether it matters. Belongs to whoever owns obj-util.c.

## Regression guards

Deliverable 2. Each port counterpart above now carries the C symbol name in a
citation comment, in the surrounding comment idiom, so the mechanical run
matches it and this slog is not repeated. Comments only — **no production
behaviour changed by this lane.** Files touched:

`core/src/world/project.ts`, `core/src/game/trap.ts`,
`core/src/game/spell-cmd.ts`, `core/src/events.ts`,
`core/src/game/wizard.ts`, `core/src/gen/cave.ts`, `core/src/mon/bind.ts`,
`core/src/session/save.ts` (×2), `core/src/game/player-side.ts`,
`core/src/store/bind.ts`, `core/scripts/gen-grafmode.mjs`,
`content/src/parser.ts`, `content/src/specs/misc.ts`,
`web/src/abilities.ts`, `web/src/overlay.ts` (×3), `web/src/charsheet.ts`,
`web/src/main.ts`.

`do_cmd_navigate_up`/`_down` needed no comment — `player-path.ts` already
cited them; the matcher was the problem.

The four `N/A-BY-SCOPE` symbols have no port site to comment, so they are
listed in `reports/w1-scope-excluded.tsv` (name, rule, reasoning), which
`w1-triage.mjs` now reads. That file is the audit trail: adding a row to it is
a claim that a human decided the symbol has no counterpart by design.

## Matcher fixes (`tools/w1-triage.mjs`)

Five changes, in decreasing order of how much they matter:

1. **Word-boundary citations.** `src.includes(name)` counted a citation of any
   LONGER C symbol as a citation of this one. That is what put 11 of my 26 in
   this bucket. Now `(?<![A-Za-z0-9_])name(?![A-Za-z0-9_])`. This makes the
   residue BIGGER and more honest.
2. **Suffix-tolerant identifier index.** The port appends `Action` / `Handler`
   / `Aux` / a plural `s`; the C never does. `do_cmd_navigate_down` is
   `navigateDownAction`, `rd_trap` is `deserializeTraps`. Each indexed
   identifier is now also registered with such a suffix stripped.
3. **Prefix ALIASES for renamed namespaces.** `rd_` → `deserialize`, `wr_` →
   `serialize`, `init_parse_`/`finish_parse_` → `parse`. Stripping `rd_` alone
   yields `monster`, which collides with `interface Monster` and points a
   reviewer at the wrong file.
4. **Citation-anchored verdicts.** A word-boundary citation followed within 25
   lines by a declaration is `PORTED-AND-CITED`, `matched_as` = `cite:<id>`.
   This is what makes the citation comments above load-bearing rather than
   decorative, and it is the only path by which a comment can produce a
   verdict — which is why it is labelled.
5. **`DECL` no longer treats JSDoc lines as declarations.** The old regex had a
   `\*\s*` alternative on its method branch, so ` * some_c_name (file:line)`
   registered `some_c_name` as a DECLARATION. A citation comment therefore
   scored as an implementation, unlabelled, via the ordinary `hit` path.
   Removed.

Also: `port_file` is now populated for citation-only rows (previously blank),
so a reviewer does not have to grep for where the name was mentioned.

### Before / after

    verdict                     before   after
    AREA-WORKED-NO-CANDIDATE      1550    1578
    NO-TRACE                       126      81
    CANDIDATE-RENAMED               81      88
    PORTED-AND-CITED                10      42
    CITED-NO-CANDIDATE              26       0
    SCOPE-EXCLUDED                   -       4

    residue needing human adjudication   1676 -> 1659

`CITED-NO-CANDIDATE` is empty: 22 of the 26 became `PORTED-AND-CITED` and 4
`SCOPE-EXCLUDED`. `PORTED-AND-CITED` gained 32, only 22 of which are mine —
the other ~16 are siblings retired for free by the same edits and rules
(`event_signal_point`/`_string`/`_birthpoints`, `dump_level_header`/`_body`/
`_footer`, `parser_setpriv`/`parser_destroy`, `q_new`, `parse_slots`/
`_turnover`/`_normal`/`_buy`, `rd_traps_aux`, …). `AREA-WORKED-NO-CANDIDATE`
grew by 28 because fix 1 correctly demoted rows whose citation was fake; that
is the residue being told the truth, not a regression.

### Known weakness of the anchored rule

`matched_as` sometimes reports a junk identifier — `cite:if`, `cite:here`,
`cite:MENU_OPTIONS` — because `DECL`'s bare-method branch matches things like
`if (` and `for (`. The FILE attribution is right in every case (all 26 were
verified by hand against the C), and the file is what a reviewer needs, but
do not read `matched_as` as "the name of the port function". A `cite:` prefix
means the evidence is a citation comment, adjudicated by a human, not an
independent name match.
