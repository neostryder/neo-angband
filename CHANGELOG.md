# Changelog

All notable changes to Neo Angband are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-1.0: the API, save format, and mod interfaces may still
change between minor versions. This file is maintained going forward - each
notable change lands in the Unreleased section and moves under a version
heading when that version is cut.

`0.x` is the pre-release line and `1.0.0` is reserved for the public release.
Semver on `0.x` means a feature release bumps the MINOR number, so `0.9.0` is
followed by `0.10.0` rather than by `1.0.0`. The first-party mods follow the same
scheme and reach `1.0.0` with the game rather than ahead of it - and a mod whose
released tag is iterated takes a MINOR bump, because a published tag is pinned by
digest in the game's catalogue and must never be moved.

## [Unreleased]

### Fixed

- **`EF_TELEPORT` and `EF_RECHARGE` no longer add a dice roll upstream never
  makes.** Both handlers computed `value.base + damroll(value.dice,
  value.sides)`; 4.2.6 uses `value.base` alone
  (`effect-handler-general.c:2508` and `:2129`). `effect_calculate_value`, the
  function that folds dice and sides in, is called explicitly by the handlers
  that want it, and neither of these is one of them. A comment in the port
  asserted the roll was an upstream local initialiser evaluated before the
  arena refusal; no such initialiser exists, so the comment had invented an
  upstream roll to justify a port addition — and **the port adds nothing.**

  Behaviourally inert on 4.2.6 gamedata, verified rather than assumed: every
  shipped `TELEPORT` and `RECHARGE` record spells its value as a bare base or
  an m_bonus (`10`, `30`, `40`, `100`, `6`, `M60`, `M80`, `M$M`, `$B`) and
  never as `XdY`, so `dice` and `sides` are `0`; `damroll` returns `0` without
  drawing when `sides <= 0`, so no RNG draw is lost either. The divergence was
  live only for a MOD contributing such a record with real dice — which is
  precisely the case the addition got wrong.

### Added

- **A renamed mod rule keeps the player's choice** (#280). Rule choices are
  player-persisted by FLAG NAME in the host's own store, so renaming a rule flag
  used to orphan the old key: the lookup missed, the rule fell back to its
  declared default, and a player who had deliberately turned a fix OFF got it
  back ON with no message. A manifest may now map retired flags to current ones
  with `renamedRuleFlags`, and the host rewrites its saved choices when it loads
  the enabled mod, before resolving defaults. Several old flags feeding one new
  rule fold with **OR** — silently turning off a fix a player had on would
  reintroduce a bug they had chosen to be rid of, which is the worse surprise.
  An explicit choice already recorded for the new flag wins outright, and
  consumed old keys are removed, so loading again changes nothing. A manifest
  cannot rename a flag to itself, nor retire a flag it still declares.

- **A mod can reshape the web keypress command table** (#259 census row 23),
  through the `registry:menu` it already uses for other menus rather than a
  second input registry. `core:keypress-command-table` publishes each of the 63
  shell commands as a declarative row — label, category, original-keyset
  binding, roguelike binding, control binding — so a mod may retitle, regroup,
  reorder, re-tag or rebind any of them. **The runnable closure never crosses
  that boundary**, so an invented row has no shell action and cannot execute an
  ordinal neighbour's command by accident. The ENTER command browser now reaches
  the same registry while keeping its upstream-shaped scrolling boxes, via a
  `terminalPicker` seam on `selectFromMenu`.

- **Region pointer input follows the painted cells** (#276, gap 21 milestone 7).
  A region owns pointer input exactly where it drew, including the cells it
  erased with `clear()`, so sight and touch obey one rule; cells nobody painted
  still reach core. `RegionDeclaration.input` receives region-local `tap` and
  `context` pointers, and a region with no handler still consumes pointers on
  its painted cells — so a mod's own panel stops walking the player's character
  without the mod being changed at all. A handler that throws is reported once
  and that one region is removed for the session; the game session is not
  tainted, because pointer input runs before a turn can be advanced.

- **The last eight position-persisted tables record their meaning BY NAME**
  (#274, finishing what #269 and #273 started). `SAVE_VERSION` is now **7**.
  Monster flags and timers, trap flags, your stats, skills and timed effects,
  and the remembered state of every dungeon grid record their meaning by name
  instead of by position, so game data that adds any of them can no longer
  renumber a character that already exists.

  Version 6 had already shipped to Pages and the `early` channel, so this is a
  seventh version rather than a redefinition of the sixth — a document already
  written as v6 must keep meaning what it meant. One bump covers all of them.

  **`statMap` was the trap in the set.** It is a permutation, not a magnitude:
  `player_fix_scramble` does `newCur[statMap[i]] = statCur[i]`, so its VALUES
  are stat indices too. Naming only the keys would have left a scrambled
  character's strength re-pointing at their intelligence the moment the stat
  table moved. Both halves are names now, and an unresolvable map falls back
  WHOLE to the identity — half-applying it would leave two slots pointing at one
  stat and silently lose another's value.

  **The dungeon grids get a legend rather than names, and the reason is
  measured.** On a real level (63x188, 11,844 grids) a name list per grid costs
  76 KB freshly generated but **462 KB once explored — 4.7x the numeric form** —
  because an unexplored grid averages half a set flag and `[]` beats `[0,0,0]`.
  So `SavedGame.squareInfoLegend` carries this build's ordered SQUARE names
  **once** (214 bytes) and every grid indexes into it. No build-dependent
  position, because the legend travels inside the document. Upstream reached the
  same shape by accident and stopped one step short: `save.c` already writes
  `SQUARE_SIZE` into the file, describing its own encoding's LENGTH but not its
  ORDER.

  **An eighth field nobody had listed.** `SavedPlayer.objKnownModifiers`, the
  pre-#13 legacy rune block, is a dense `OBJ_MOD` array that every migration
  from 1 to 6 carried forward untouched through `...rest`, and #273 converted
  the modern block sitting beside it and walked past this one. It is names now
  too.

  Discard-vs-error was checked per field against `reference/src/`, not assumed
  uniform: upstream DISCARDS unsupported timed effects with a note, REFUSES a
  save with too many stats, and has no rule at all for `m_timed` — where its
  fixed-size read is itself an overrun waiting for a longer table.

  Every control drives a real document through the real `migrateSave`, and each
  was proven red by reverting exactly one table's conversion. Two did not go red
  on the first pass, and both were real gaps rather than probe noise: a
  normalise call no test could reach, and a field with no migration test at all.

- **`yieldTerminal` is on the published type now, and the last two prompts are
  announced** (#258, ABI half — the same defect #267 fixed one seam over).

  The mechanism shipped working and undiscoverable. `ScreenHost.invoke` hands a
  presenter a `yieldTerminal(request)` callback so the game can draw a prompt
  only after the presenter has animated out — and the callback was declared on a
  host-local `YieldingScreen`, on **neither** published copy of `ScreenShown`.
  It worked by coincidence: `tsc` accepts a handle with an extra member against
  a `ScreenShown | undefined` return, with no cast and no excess-property error.
  So the member was not unusable, it was invisible — an author had no way to
  learn it exists, and nothing checked the signature of the one they guessed.

  The member is on `ScreenShown` in **both** copies now, in the same words, with
  `PromptRequest` / `PromptExtent` published beside it. `YieldingScreen` is gone.

  **The tripwire was replaced, not deleted.** `screen-abi-agreement.test.ts`
  reads both FILES and holds them in agreement — member list, signature
  character for character, the sentence an author reads, and `PromptRequest`'s
  own field types. Reading files is the point: two structurally identical
  interfaces are ONE type to the compiler, which is exactly the blindness that
  let this ship. Proven by breaking each copy in turn.

  `core:report` and `core:update`'s mod page were the last prompts landing under
  a presenter's overlay; both go through the census now, and the per-file
  tripwire became a TOTALITY test, so a prompting screen in a file nobody
  thought of fails instead of passing in silence.

  **`occludersOf` / `regionsIntersect` stay unexported, and the reason is now
  written down.** Publishing them was considered and is not possible: a module
  fetched from a mod folder cannot resolve a package by name, so the mod builder
  marks every bare specifier external and fails on any that survive — a guard
  with its own fixture behind it. Types cross that line because the build erases
  them; functions do not.

- **Items, learned runes and monster memory record their properties BY NAME**
  (#273, the defect #269 left one table over). `SAVE_VERSION` was **6** here, and
  the `V5_TO_V6` step that reads a version-5 savefile ships with it — an
  existing character loads with exactly the items and exactly the monster
  memory it had.

  #269's own comment claimed the RSF bit position was the last POSITION a save
  held. It was not. Race lore still wrote `SavedLore.flags` as RF **bit
  positions**, and every object-property carrier in the document — `SavedObject`,
  `SavedPlayer.objKnown` (the learned runes) and `SavedMonster.knownPstate` (a
  monster's remembered view of the player) — wrote OF bit positions, `OBJ_MOD`
  indices and `ELEM` indices. Four generated tables, on exactly the terms row 22
  was on: remove or reorder one entry and every existing character's items and
  monster recall silently re-point at different properties.

  They are `flagsKnown`, `flagNames`, `modifierValues` and `elementInfo` now —
  `RF_` / `OF_` / `OBJ_MOD_` / `ELEM_` names, with the unset bits and the zeroes
  left out. A name cannot be renumbered, an unknown one (a mod's property,
  uninstalled) is dropped rather than landing on whatever occupies its old
  index, and a build whose table is larger, smaller or in a different order
  reads back exactly what was written. **This opens none of the four tables to
  mods**; it removes the thing that made opening them unsafe.

  **Verified in the installed build, not only in CI** (2026-08-14, portable
  0.19.0+#273 desktop, driven over CDP). A character born on this build,
  descended to 50' and saved, reloaded after a COLD process restart with its
  stats, gold and depth intact. Then the case that matters: `Negor the Dwarf
  Paladin, Lv 12, 300' (L6)` — a save written by an EARLIER engine — loaded
  with "Save updated to this version's format." and came back whole: nine
  equipment slots, AC 46, HP 106/106, a drained Con still showing drained, and
  the explored level map. Those are OF flags, `OBJ_MOD` modifiers and `ELEM`
  resistances on real gear, which is precisely the data a position-indexed save
  would have silently re-pointed.

  `session/save-flag-names.test.ts` is the control, four times over: it
  renumbers each table and reads the same pre-existing data under both schemes,
  so a +2 speed, +1 blows weapon reads as +2 tunnelling, +1 speed under the old
  scheme and is unmoved under the new. It also pins each name table at its OWN
  index base against its own generated tuple — `OBJECT_FLAG_ENTRIES` is offset
  by one, `OBJECT_MODIFIER_ENTRIES` by five, `MON_RACE_FLAG_ENTRIES` and
  `ELEMENT_ENTRIES` by nothing — because an off-by-one there writes every
  character's flags one slot over and round-trips perfectly.

- **A `.prf` file can carry `sound:` again, and a content pack can re-point a
  core message's samples** (#270, MOD_REACH rows 8 and 8a).

  `sound:` had no handler at all: `HANDLERS` held twelve directives and the
  unknown-directive branch dropped the line in silence. Upstream registers
  `parse_prefs_sound` into the same parser as the other fifteen
  (`reference/src/ui-prefs.c:1157`), so this was a MISSING PORT rather than a
  new capability - the port dropped it when it had no mixer, and the comment
  justifying that claimed the bundled prf files carried `sound:` lines. Measured:
  none of them do. The 447 such lines are in `reference/lib/customize/sound.prf`,
  a build input, parsed by nothing at runtime.

  Second half: a pack's `message_type` records registered their `sounds` only
  inside the branch that COINED a new type, so both branches a sound pack
  actually takes - naming one of upstream's 153, or naming a type an earlier
  pack coined - discarded the samples. A content-only pack could bind sounds to
  a message it had invented and to none of the game's. Samples now bind on all
  three outcomes, with module-scope `(owner, type)` idempotence so a reload
  cannot silently re-point a message at whichever pack bound last.

- **`ModPlugin.regions?` is published, so a mod whose only contribution is a
  region is no longer refused** (#267, MOD_REACH gap 21, milestone 6).

  The region runtime, the capability, the compositing and the fault isolation
  all shipped before this - but `regions()` was not a member of the ABI, so
  `validateModPlugin` and the SDK's builder both refused a plugin that declared
  nothing else as "would do nothing". The seam was therefore real only for a mod
  that ALSO did something else, which is a coincidence rather than a capability.

  The member had to move in four places at once, which is why it lagged: the
  interface, the host's validator, the builder script the SDK ships, and the
  author-facing sentence that `plugin-abi-agreement.test.ts` holds the two
  validators in agreement on. `region-runtime.ts` no longer carries its own
  structural stand-in for the type.

- **Regions can overlap, and they are ordered** (#253, MOD_REACH gap 21,
  milestone 6, commits 1-2).

  Until now a region was one of four tiles that divided the terminal between
  them, and the invariant was "no cell is claimed twice". A screen is COMPOSED
  of regions and does not cover them, so a floating window has to be able to sit
  over a map that is still being drawn — which breaks that invariant on purpose.

  The tiling rule is **kept**, scoped to the base layout where it is still true.
  What replaces it globally is the stronger claim: overlap is legal, but a cell
  claimed more than once has **exactly one visible owner, and it is the top of
  the stack**. The composite has to be a function of the region set, not of the
  order some `Map` happened to iterate in.

  Ordering is by BAND — `base`, `overlay`, `modal`, `system` — and within a band
  the later-declared region is on top, which for a mod is load order: the same
  last-load-wins rule that already decides the front end, the HUD, the screen
  presenter and the menu transform, wearing a different hat rather than being a
  second rule. A free numeric z-index was declined because it is a coordination
  problem with no coordinator: every mod picks a large number, and the first one
  to out-bid the mod manager takes away the player's way to turn it off. A mod
  cannot ask for the `system` band, so whatever the player uses to regain
  control can always be drawn above a mod — including above the one that has
  gone wrong.

  **Transparent means a cell that is not written** — not a per-region alpha, not
  a null-glyph sentinel. The grid already spells "nothing here" as `null` and a
  second spelling would be a second rule; a cell holds one glyph, so there is no
  blend of `k` and `#`, and alpha is a pixel concept already available at the
  pixel projection through CSS. The corollary is the whole implementation:
  `clipSurface` gives a region a surface whose `clear()` erases only its own
  rectangle and whose outside writes are **dropped, not clamped**. Clamping
  would put a mod's overflow onto somebody else's cell, turning an author's
  off-by-one into a corruption of a neighbour neither of them can trace.

  `GlyphTerm` gained `eraseSpan(x, y, len)`, which is not an invention:
  `eraseToEol`'s own comment already named `Term_erase(x, y, len)` as the
  bounded call upstream has and the port had not needed, citing `askfor_aux`
  editing a field mid-row. It is optional on the interface, like `GridReadback`
  and `GridGeometry`, because two dozen test doubles implement `GridSurface` by
  hand and every one of them is full-width — which is exactly the case that does
  not need it.

  No production consumer yet, and that is deliberate: these two commits are the
  model and the primitive, reviewable on their own.

- **A screen now declares a rectangle** (#253 gap 21, #261 commit 3). The
  rectangle is the whole terminal and **the picture is unchanged** — 4.2.6 shows
  a screen as `screen_save` / full repaint / `screen_load`, and the parity suite
  pins those pictures byte for byte. What is new is that a screen *has* a
  rectangle at all, so a front end can learn it is being covered instead of
  finding out when its window disappears. Shrinking any screen was declined: a
  mod that wants a panel declares its own region.

  `showViewOnTerminal`'s painting body did not change by one character — it is
  now a push/pop wrapper around the original, painting through a surface clipped
  to the region, which is the evidence that the clipped surface works.

  Also added a source guard: **`term.clear()` is now an enumerated allow-list of
  33 sites across 16 files.** One is the compositor and one is converted, so
  **31 screens remain to become regions** — work that was always there and had
  never been counted. The list may shrink freely; adding to it fails the build.
  The failure it prevents: a mod's window is drawn, the player presses `M` for
  the level map, and the window is gone with no error anywhere.

- **A mod's screen presenter is told when the game is about to use the terminal
  underneath it** (#258 — mechanism, all four call sites, and the published
  ABI). Four actions a presenter can run through `ScreenHost.invoke` open a
  prompt on the faithful terminal, and until now those were drawn *under* the
  mod's overlay: the player was asked a question they could not see. The
  character sheet's rename **writes the save at the end of it**.

  The game now announces the prompt, a presenter that can stand aside does, and
  one that cannot hands the screen back and is told once what to add. Prompts
  inside `invoke` remain allowed — forbidding them would make the actions a mod
  can offer a strict subset of the game's, which is the seam being given up.

  `SCREEN_PROMPTS` / `SCREEN_NO_PROMPT` enumerate, for every published screen
  action, whether running it takes the terminal, and a test makes the pair total
  and disjoint against the real view builders. **That table is the artefact
  whose absence caused the defect** — nothing enumerated which actions prompt,
  which is why two shipped broken and two more were added without anyone
  noticing the pattern. A fifth prompting site is now a build failure.

- **Mods can add message types, and choose the sounds for them** (#259 census
  rows 20 and 21, new `registry:message` capability).

  A `msgt:` naming a message type core had never heard of used to throw
  `PARSE_ERROR_INVALID_MESSAGE` and take the whole bind down — **a crash, not a
  missing feature.** A mod may now declare its own `MSG_` types, appended after
  the 153 compiled-in ones, bind sample names to them, or re-point a core
  message's samples. `MSG` is closed as a table and open as a lookup, the same
  split `PROJ` has, so all five consumers widen at once. An unregistered name
  still fails exactly as it did.

  Last writer wins per message, because `message_sound_define` clears a
  message's sample list before assigning — upstream's own behaviour for a second
  `sound:HIT:` line, and what lets a sound-pack mod re-point a core message.

  **No save impact, verified rather than asserted:** `checkMsgt` keeps the NAME
  as a string and resolves to a number only at message time, so nothing a save
  holds is renumbered and disabling the mod cannot corrupt one.

  One limitation is recorded rather than papered over (#266): a plugin's
  `register()` runs after `bootGame()`, so a mod cannot yet declare a message
  type early enough for its own records to bind against it.

- **A mod's own projection can now affect monsters** (#259 census row 7).
  `project_m` was the fourth projection side and the one left out: a mod adding a
  new projection could set the terrain alight, burn floor objects and hurt the
  player, and a monster in the blast got an untyped hit for exactly the dice.

  Not nothing, which is what the ticket claimed — the driver applies the damage
  whether or not a handler runs. What could not happen was everything
  type-specific: resistance, immunity, the scaled damage, fear, stun, confusion,
  polymorph, teleport, the "unaffected" line, and whether the player learns
  anything from watching. `host.projections.mon` completes the set under the
  existing `registry:projection` grant, composing per code like the other three.

- **A table row can carry a paragraph** (#263). `ScreenRow.detail` is prose that
  belongs to one record and is not a column of it — a refused requirement's
  explanation, a mod author's reason for declaring a conflict, the dependency
  cycle that forced a load-order suggestion to be dropped.

  Three screens were stuck rendering as flat text for want of it. Their data was
  already structured, but a row's own cells render as exactly one terminal row,
  so the only ways to draw them were to cut the paragraph into row fragments —
  which a presenter would still have to reassemble by counting, making them
  `lines` in a costume — or to lose the record.

  A detail introduces **no new wrapping rule**: it is a `ScreenProse`, factored
  out of `ScreenTextBlock` unchanged, so it goes through the same discriminator
  a text block does and declares which of the two transcribed algorithms it uses
  with the same `flow` field. That is deliberate — this file already owned two
  wrap algorithms and implementing one while citing the other was the defect
  fixed in #255. It is also not consulted when column widths are computed, so a
  long paragraph cannot widen a column or move the row above it.

  The rule for telling the halves apart, now written into the model: **structure
  is what has keys; prose is what has paragraphs.** A detail is deliberately not
  addressable — if you find yourself parsing one, the thing you are parsing is a
  column the screen has not declared yet.

- **The content layer's conflict rows carry their real record** (#262). The
  conflicts pane became a table three commits ago, but `modConflictLines` in
  `pack.ts` still did `computeConflictReport(contents).records.flatMap(r =>
  r.humanLines)` — the records existed and were field-granular, and the
  flattening was one line. The content layer now joins the same table with its
  own `RecordConflict` attached, and the `{ kind: "content-record" }` stopgap
  that marked those rows as recordless is retired.

  `ConflictRow.record` stays nullable, narrowed to one honest case: when
  `resolveLoadOrder` throws, composition never ran, so there is no record to
  attach and only a thrown message — "could not ask", not "found nothing". That
  arm is now named `unresolved-load-order` rather than reusing the old marker
  for a different meaning.

- **Sixteen more screens give up their models, and the screens a mod could not
  reach at all get a seam** (#253, MOD_REACH gap 21, step 5b-vi).

  `MODELLED_SCREENS` goes from twenty-one to **thirty-seven**: the four help
  pages, the equipment-comparison screen's two help overlays, the mod manager's
  four listings, the hall of fame, the knowledge menu's store view, the update
  and report pages, and wizard mode's two debug readouts.

  **Three of them were not unmodelled — they were unreachable.** `score.ts`,
  `drawWizItem` and the two shell pages painted `term.clear()` / `term.print()`
  directly and never called `showThroughPresenter` at all, so a mod could not
  reskin their frames, never mind rebuild them. The hall of fame is the worst
  of those to have lost, because a leaderboard is the first thing anybody
  rebuilds: `HighScore` already carried a field per column and `scoreRow` joined
  them into three prose strings, so a presenter got
  `"  1.   123456  Frodo the Half-Troll Warrior, level 20"` as one opaque string
  and could not sort by score or draw a class glyph without parsing a layout
  that a long name or a translation moves. The fix went into **core**, where one
  `ScoreRow.fields` extraction now feeds the three display lines, so the model
  and the rendering cannot part; publishing the fields as a second independent
  read beside the strings was the alternative, and that is the
  two-transcriptions failure whose losing copy is always the one nobody reads.

  **Two screens were prose only because a producer had destroyed their
  structure.** `mod-install.ts` flattened `checkMod`'s `{title, problem}[]` into
  one string with hand-typed bullets, and `mod-browse.ts` then split it back
  apart and re-wrapped the fragments — the process re-parsing a rendering it had
  produced two frames earlier. `mod-conflicts.ts` mapped every `ContestedSlot`
  through a describe function and handed the pane three `string[]`. Both
  producers now carry the records beside the sentences, with the sentences
  **derived** from the records rather than composed alongside them, and
  `core:mod-conflicts` is a table.

  **What stayed at `lines`, and why, is the other half of the work.** All 32
  `showTextScreen` call sites in the mod manager were read one at a time;
  twenty-four are genuinely prose and say so in the source. The install-refusal
  screens stay too, and their blocker **moved**: it is no longer the producer,
  it is that a `table` row is exactly one terminal row and cannot wrap, while
  four of five bullets the shipped requirement set can produce are longer than
  the width the screen wraps to. That is the first screen in this gap blocked by
  the block vocabulary rather than by its data, which is a different kind of gap
  and is counted separately.

  **Byte-identical rendering was the acceptance criterion throughout**, checked
  against output captured from the real producers before each change, asserting
  full `ScreenLine` objects rather than `.text` so that a coloured cell emitting
  a `runs` array where a plain coloured line used to go would show. One check
  was verified by **breaking it on purpose** — nudging a column's gap by one and
  confirming the test failed — because a snapshot test that has never failed is
  not a snapshot test. Two rows could not be reproduced and are reported rather
  than adjusted: the store view's header, and the symbols page's hand-wrapped
  intro, which stays on `lines` because upstream laid it out and reproducing its
  breaks from a paragraph needed a wrap clamp chosen to fit the answer.

  The playing guide and the community help page went the other way and now
  publish their prose **unwrapped**, so a presenter lays them out at its own
  width. Seven paragraphs re-break on the faithful terminal and no words change.
  That trade is available only because both are port additions with no upstream
  layout to be faithful to — the commands and symbols pages, which are
  near-verbatim from `lib/help/`, print exactly the bytes they printed before.

  A mod's own help page arrives under `core:text` rather than under the id of
  the page it replaced: a `.txt` split on newlines has no columns to address,
  and an id that does not predict its blocks is worse than no id at all.

- **The visible-monster list gives up its model, and a screen with a command
  gets a seam that can be driven** (#253, MOD_REACH gap 21, step 5b-vi).

  `core:monster-list` takes `MODELLED_SCREENS` from twenty to twenty-one. It is
  the screen where publishing numbers instead of text pays most obviously: a row
  carries `values.dy` / `values.dx`, so a presenter can draw an **arrow** at the
  monster on a minimap. There is no way to get an arrow out of `" 3 N 2 W"`
  without parsing a compass back into the vector it was made from.
  `values.asleep` is a count where the terminal has the sentence `"(2 asleep)"`,
  `semantic.ref` is the race a tileset mod looks a sprite up by, and
  `semantic.data.name` carries the game's own pluralisation (`get_mon_name`) so a
  card can say "3 kobolds" without a mod reimplementing English.

  **The layout question it had to answer.** Upstream pads the name with
  `"%-*s%s"` at a width computed per row —
  `full_width = max_width - 2 - len(location) - 1` (ui-mon-list.c L123). That
  looks per-row and is not: the total comes to `max_width - 1` on every row,
  because the width shrinks by exactly what the location adds. Upstream's own
  comment says what it is for — "the left-aligned and padded monster name which
  will align the location to the right" (L156). So the model is a fixed name
  column plus a **right-aligned location column**, which reproduces the C byte
  for byte while the name cell arrives unpadded.

  The one place the two part is clipping: the C clips at that row's own
  `full_width`, which is more generous on a row whose location is shorter than
  the section's longest. Measured rather than argued — the widest name-plus-tag
  the shipped pack can generate clears the narrowest 80-column name column by 14,
  and a test fails if a content mod ever closes that gap.

  **The seam moved out of `main.ts`.** This screen has an action — `sort-exp`,
  the `x` toggle (ui-mon-list.c L410, L456) — so it needs a `ScreenHost`, and a
  seam that exists only inside the game's entry point is a seam nothing can
  drive. `packages/web/src/monster-list.ts` now holds both ways of showing it.

  `samples/sprite-inventory` takes it and draws the list as cards with a compass
  arrow, and the check loads that folder by path, drives the real
  `showMonsterList` through the real seam against a real `GameState` with a real
  monster, and asserts `"↘ 3"` reached the canvas — a string the game never
  produces. Then it presses `x` and checks the footer changed, so the **game**
  re-sorted and handed back the new view.

- **The knowledge browser's seven recall pages give up their model — and two
  things the player could see are fixed on the way** (#253, MOD_REACH gap 21,
  step 5b-v).

  `core:rune-recall`, `core:feature-recall`, `core:trap-recall`,
  `core:shape-recall`, `core:artifact-recall`, `core:ego-recall` and
  `core:object-kind-recall` take `MODELLED_SCREENS` from thirteen to twenty.
  Seven ids rather than one because a mod that draws an artifact's page as a
  plaque and a trap's as a warning card has to be able to tell them apart.

  All seven end at the same upstream call — `textui_textblock_show`
  (ui-output.c L155) — and it does two things the port was not doing:

  - **It wraps.** `textblock_calculate_lines` (z-textblock.c L238) breaks the run
    stream at the region width. The port pushed each description as ONE line and
    `showTextScreen` slices a line at `cols - 1`, so **any description longer
    than the terminal had its tail cut off** — the end of the sentence simply did
    not exist. The rune, feature, trap and shape recalls all did this.
  - **It keeps colour.** `display_area` (ui-output.c L100) writes `attrs[]` per
    character. The artifact, ego and object-kind recalls flattened their textblock
    through `textblockToString` and painted the page one colour, which is why the
    browser's object recall was monochrome where the `I` inspect of the same
    object was not.

  A third, smaller correction comes out in the wash: the rune / feature / trap /
  shape lores pass `header = NULL` upstream and put the capitalised name in the
  BODY, but the port's overlay draws a title row on every screen AND kept the
  name as body line 0, so the player read it twice. The name is the title now,
  and only the title — one row shorter, and one row closer to upstream.

  `recallBodyLines` is gone; every one of the seven is `proseBlock` or
  `textParagraphs` through the one renderer. `samples/sprite-inventory` takes all
  seven, and **nothing in its prose panel changed to accept them** — adding them
  was seven strings in a list, which is what a model with a small vocabulary buys.

  Recorded and NOT changed here: upstream wraps at the region width (80) where
  the port's renderer wraps at `cols - 1` (79). That difference is pre-existing —
  `wrapRuns` has laid out the inspect and monster-recall pages that way since the
  port had them — so it belongs to its own measurement, not to a drive-by in this
  step. See `MOD_REACH.md` row 21.

- **The character sheet is offered to a presenter, and it publishes what the
  player can DO on it** (#253, MOD_REACH gap 21, step 5b-iv).

  `core:character` (the stat table, the five panels, the history) and
  `core:character-flags` (the four resist / ability / hindrance / modifier
  regions and the sustains block) are modelled, taking `MODELLED_SCREENS` from
  eleven to thirteen. Two parts of this were not a builder swap.

  **The seam.** `showCharacterSheet` is a hand-painted modal with two display
  modes and its own key handling that never reached `showTextScreen`, so no
  presenter had ever been offered the character sheet at all. It now offers its
  view directly and falls back to the terminal on a decline or a fault, exactly
  as `showTextScreen` does.

  **Actions.** Upstream's `do_cmd_change_name` offers renaming, a character dump
  and the page cycle from inside the same modal, so a presenter that took the
  sheet without being able to reach them would quietly take three commands away
  from the player. `ScreenView.actions` publishes them as data — a stable `id`,
  the key the *faithful terminal* listens for, the game's own label — and
  `show(view, host)` hands over a `ScreenHost` whose `invoke(id)` runs one and
  resolves with what the player should see next: the renamed sheet, the other
  page, or `undefined` for "the game has taken it back". An id this engine has
  not got is a no-op that returns the current view, so a presenter built against
  a later engine cannot close the player's character sheet by asking for a
  command that does not exist yet.

  Four model additions, each a layout fact published *beside* the data rather
  than baked into it: `ScreenColumn.glyph` (the flag grid's columns *are* the
  equipment slots, and upstream draws the worn item's glyph over each — a fact
  about the column, not a first row to skip), `ScreenTableBlock.headerColor`,
  `ScreenTableBlock.gapAfter`, and `ScreenTextBlock.wrap` (`text_out_wrap = 72`
  for the history, a clamp on the terminal's width and never a minimum).

  One renderer again: `characterSheetLines`, `characterGridLines`,
  `statHeaderLine`, `statRowLine`, `historyBlockLines` and the wide layout's
  per-panel blits are all now the model through `screenBodyLines` or the new
  `screenBlockLines`, and `wrapPlain` is deleted. The existing upstream-cited
  suite for the sheet passed unchanged, which is the evidence the picture did not
  move on the player's screen.

  `samples/sprite-inventory` takes both pages, drawing the equipment bonus as a
  bar whose length *is* `cells.eb.values.bonus` — a thing no re-reading of
  `"STR!  18/100  +1"` could have given — and the test asserts that not one
  composite row the faithful terminal would have produced reached the canvas,
  then presses `h` and checks the page moved *through the host*.

- **The tombstone publishes the epitaph apart from the stone** (#253, MOD_REACH
  gap 21, step 5b-iii).

  `core:tombstone` and `core:winner` are modelled, and the `art` block — declared
  since step 5 with no producer — gets its first one. The point is what the
  conversion had to separate. Upstream's tombstone is one picture with the
  character *burned into* it: the name, class, level, experience, gold and
  killing blow are overwritten into columns 8–39 of the ASCII stone by
  `put_str_centred` (ui-death.c L40–56). A mod handed the finished picture would
  have to know that band and those row numbers to get a name back.

  So an art block now carries `fields` beside `lines`: each with a stable `key`
  (`name`, `title`, `class`, `level`, `exp`, `gold`, `death`, `killer`, `date`),
  its text, `values` where the text is a formatted number, and the row and band
  the *faithful terminal* uses — published beside the data rather than baked into
  it, exactly as a table column publishes its width. A field with no band is
  centred on the full width, which is not a special case but literally what
  `display_winner` does for its banner.

  `samples/sprite-inventory/` now draws its own gravestone with the character
  written onto it, and the test asserts that **not one** of the ASCII rows it was
  also handed reached the canvas — compared against the block's own lines, so
  redrawing the art cannot quietly retire the check. `put_str_centred` moved into
  the one renderer, and both death screens' existing upstream-cited parity tests
  passed unchanged, which is the evidence the picture did not move.

- **The recall pages give up their models, and hand a mod the prose unwrapped**
  (#253, MOD_REACH gap 21, step 5b-ii).

  Three more screens are modelled: `core:object-recall` (the 'I' inspect, the
  context menu's Inspect, the store's Examine and one side of the equipment
  comparison — the same page of the same object seen from four places),
  `core:object-comparison` and `core:monster-recall`. They arrive as a `text`
  block: paragraphs of coloured runs, **unwrapped**, split where the core emitted
  a break and nowhere else.

  That is not a cosmetic difference from `lines`. A `lines` block is already
  broken into 79-character rows, so re-flowing it into a panel of another width —
  or into a proportional font, where "79 characters" is not a width at all —
  means undoing the game's wrap first and guessing which breaks were the game's
  and which were the sentence's. `samples/sprite-inventory/` now lays those
  pages out into a 360px panel by *measuring* them, and its test asserts the
  narrower panel produced more rows than the terminal's 80-column wrap of the
  same view — which a presenter quietly reusing the game's wrap could not.

  **Nine screens have models so far**, named in `MODELLED_SCREENS` and derived
  from the source by a test.

- **A mod can show the game's full screens — the inventory as sprites, if it
  likes** (#253, MOD_REACH gap 21, step 5).

  `ModPlugin.screen(ctx)` returns a presenter that is offered every full-screen
  view and takes the ones it has a better idea for, gated by one capability,
  `ui:screen.replace` (or `ui:*.replace`). This is the seam that reaches the
  *content* rather than the frame. Before it, the inventory arrived as
  `ScreenLine[]` — a row of characters and a colour — so a mod wanting item cards
  would have had to parse `"a) a Potion of Cure Light Wounds       4.0 lb"` back
  into a name and a weight, and would have broken the day a pref file changed a
  colour or a translation changed a width.

  A screen is now a document of blocks, and **a list is a `table`**: columns with
  stable keys, rows whose cells are addressed by those keys, so a presenter reads
  `row.cells.name.text` and never counts characters. A row carries the same
  `{kind, ref}` semantic and the same `core:gear:<handle>` id a menu choice does,
  because an inventory listing and an inventory picker are the same objects seen
  twice. Cells carry `values` under the HUD's convention unchanged, so a weight
  publishes `{each, total, number}` in tenths of a pound and the presenter
  formats it. Column widths are published *beside* the data instead of baked into
  it as padding, which is what lets the same model serve upstream's fixed column
  stops and a proportional font.

  **A screen is dismissed, not answered**, which is the one shape difference from
  the menu seam: `show` declines by returning `undefined` synchronously and takes
  the screen by returning `{ dismissed }`. A presenter that throws, returns no
  dismissal, or dies with the screen open loses the seam for the session *and*
  the game shows the screen itself — a player left staring at a dead overlay has
  no way out.

  Core's own painting goes through the same renderer: `inventoryLines` is now
  `screenBodyLines(inventoryScreen(state))`, so the model and the shipped rows
  cannot drift apart. `samples/sprite-inventory/` is the worked example, driven
  from disk through the real `showTextScreen` by
  `sample-inventory.node.test.ts`.

  Which screens have models is data rather than a claim: `MODELLED_SCREENS` names
  them and a test derives the list from the source, so adding an id without
  building it fails and building one without listing it fails too. Every screen
  not on that list arrives under the shared id `core:text` with pre-wrapped
  lines — enough to reskin a frame, not enough to reimagine a listing.

- **Every listing gives up its model, and a column publishes its whole layout**
  (#253, MOD_REACH gap 21, step 5b).

  Four more screens are modelled: the quiver, the object list, the message
  history and the player history. Reproducing upstream's layouts from a generic
  renderer needed two more published facts per column beside `width` — `gap`
  (columns of space before it; `history_display` writes `"%10ld%7d'  %s"`, none
  before the depth and two before the note) and `pad` (false where the game does
  not line the column up at all, as the object list's location simply follows the
  name). Without them the choice was to change the rendering or leave the screens
  unmodelled, and bending the rendering to suit the model would be the port
  adding something.

  **The model may carry more than the rendering, never less.** The quiver
  publishes its weight as row `values` although its listing has no weight column;
  the object list publishes its offset as `{dy, dx}` as well as `"2 N 0 W"`,
  because a compass string cannot be turned back into a map marker without
  parsing English; the player history publishes the character level it never
  prints. `samples/sprite-inventory/` now draws the quiver too, which is what
  proves the row-level path is reachable.

  Fixed on the way: a table's column **header** was emitted after the empty-rows
  check, so a character with no history lost the `Turn / Depth / Note` header
  that upstream prints unconditionally. Same lesson as the `tagged` regression —
  a table's columns are a fact about the table, not about the rows it holds
  today.

- **A mod can ask the game's questions its own way** (#253, MOD_REACH gap 21,
  step 4).

  `ModPlugin.menu(ctx)` returns a presenter, and every menu in the game is
  offered to it as a `MenuQuestion` — title, subtitle, footer, choices with their
  stable ids and semantics, the command keys the caller handles itself, the
  initial cursor, and a live `detail(index)` for the pane under the cursor. One
  capability covers all of them (`ui:menu.replace`, or `ui:*.replace`), because
  ~50 capability strings would be a consent list nobody could read; the fine
  choice is made per question, where returning `undefined` declines and the game
  asks that one its own way. Declining is the expected case, not a failure.

  A menu is **asked**, not drawn, so taking a question means taking its input,
  and an answer names a choice's stable `id` — never an index, which is a fact
  about a layout rather than about the game. A presenter that throws loses the
  seam for the session; an answer that cannot be honoured loses that menu only,
  and both are reported by name.

  `samples/command-dial/` presents the game menu as a radial dial, colours the
  quit wedge from `semantic.ref` rather than the English label, and declines
  every other menu — including the spell book, which its test asserts is still
  answered by the game's own lettered list.

- **HUD entries carry their numbers, not only their text** (#253, MOD_REACH gap
  21, step 3).

  The limit the vitals sample named in step 2 is closed: `SidebarField` and
  `StatusIndicator` publish `values` from core, carried unchanged to every entry
  and through the cross-plugin snapshot. It is one convention rather than a
  per-field API — **`current` and `max` together mean the field is a
  proportion**, every other key is a plain named quantity — so a mod can write
  `if (v.current !== undefined && v.max !== undefined) drawBar() else drawText()`
  once and still be right on a field a content pack adds later.

  Absent means the game does not know, never zero: the monster health bar
  publishes nothing while it reads `[----------]`, and `sp` is absent for a class
  with no mana rather than `0/0`. A stat publishes `use`/`cur`/`max` because 118
  is an encoding meaning 18/100 and `use / max` would report a maxed character as
  15%. `samples/vitals-panel/` now draws hit points and spell points as real
  bars, coloured from the engine's own attribute and clamped.

- **A mod can draw the HUD — one region at a time** (#253, MOD_REACH gap 21,
  step 2).

  `ModPlugin.hud(ctx)` returns a sink for each part of the HUD it is taking, and
  the parts it omits stay the game's and keep being drawn. That is the whole
  difference from the map seam: `frontend` has one owner because the dungeon is
  one thing, and the message line, the vitals and the status line are three, so a
  mod that redraws hit points as a bar does not have to take the message log with
  it. Each region is gated by its own capability — `ui:messages.replace`,
  `ui:sidebar.replace`, `ui:status.replace`, or `ui:*.replace` for all three —
  and the consent list names the part in words a player can picture ("Draw the
  vitals panel — your hit points, food, armour and depth"). It is a separate
  capability kind from `display:replace` in both directions: holding the dungeon
  does not let you draw the vitals, and holding the whole interface does not let
  you draw the dungeon.

  Selection is the same rule the map already uses — last enabled claimant in load
  order, with core's terminal as candidate zero for every region through the same
  call any mod makes — and it happens from the *manifests*, before anybody's
  `hud()` is invoked, so a losing candidate is never constructed and cannot mount
  UI it will never draw into. Two consequences are stated rather than discovered:
  a sink for a region the manifest never asked for is dropped and reported, and a
  region a mod won and then declined goes back to the game rather than on to the
  next claimant. A fault costs one region: a throwing status sink loses the
  status line for the session and leaves the vitals drawing.

  `samples/vitals-panel/` is the worked example, and it is loaded from disk by
  `sample-vitals.node.test.ts` through the real selection rather than being a
  folder nobody runs. It takes `sidebar` alone, draws on `section.region.pixels`,
  keys on the engine's own field names and resolves colour from `run.color`
  through `ctx.core.COLOUR_*` — asserted to never touch `run.css` or
  `entry.screen`, which are the terminal's own projection.

  One limit is named rather than worked around: an entry carries its text, not
  its numbers (`"HP 20/20"`, no `{current, max}`), so a HUD mod can restyle the
  vitals and cannot draw a proportional bar without parsing a rendering.

### Changed

- **A pref file stops at its first bad line again, and the forgiving behaviour
  is a `qol` toggle** (#272). Core carried a 20-error cap (`PARSE_ERROR_LIMIT`)
  with a `PARSE_ERROR_LIMIT` environment override. The #268 citation sweep found
  no such thing anywhere in Angband 4.2.6 — no cap, no `get_parser_error_limit`,
  no error COUNT — because `process_pref_file_named` `break`s out of the file on
  the FIRST bad line (`ui-prefs.c` L1225-1231) and `print_error` reports that one.
  The citations on the port's declarations pointed at the `PARSE_T_*` enum and at
  a range past the end of a 617-line file. So it was an improvement the port had
  added, and the port adds nothing.

  What a player sees change: a `.prf` with a typo on line 3 now applies lines 1
  and 2 and nothing else, and reports one error. Measured before removing the
  cap: all sixteen bundled `reference/lib/tiles/**.prf` parse with **zero**
  errors against this build's registries, so no shipped graphics pack is
  truncated by the stop — and a test now pins that, because the stop is only
  invisible while nothing trips it.

  `PARSE_ERROR_LIMIT`, `getParserErrorLimit`, `setParserErrorLimit` and
  `parseParserErrorLimitEnv` are gone from `ctx.core`, and
  `ProcessPrefOptions.errorLimit` is now `errorPolicy` — recorded in
  `docs/modding/MOD_COMPATIBILITY.md`. `setPrefErrorPolicy` replaces them as a
  real seam rather than a test hook, and `qol` 0.15.0's "Keep reading a pref file
  past a mistake" is what installs it. It is **better than the cap it replaces**:
  the old one threw away everything below the twentieth error, and the policy has
  two axes — whether the rest of the file is applied, and how many errors you are
  told about — because one number could not say both.

  A bad line inside a `%:` include still does not stop the including file, which
  is upstream's answer rather than a leftover: `parse_prefs_load` discards the
  nested result (`(void) process_pref_file(...)`, `ui-prefs.c` L428-440) and
  returns `PARSE_ERROR_NONE` regardless.

- **Monster memory records the spells you have seen BY NAME** (#269, MOD_REACH
  row 22). `SAVE_VERSION` is now **5**, and the step that reads a version-4
  savefile ships with it — an existing character loads and knows exactly the
  spells it knew.

  Row 22 was the one generated table that could never be opened by appending,
  and the reason was a single word in the save: `MON_SPELL_ENTRIES` is indexed
  by a **bit position**, and monster lore persisted the player's spell knowledge
  as those bits. `PROJ` and `MSG` could be opened precisely because nothing a
  save holds indexes them by position — a message type resolves to a number at
  message time — but adding an `RSF` slot renumbered what a saved character
  already held, and the symptom would have been a player's monster recall
  quietly describing other spells.

  `SavedLore.spellsKnown` is a list of `RSF_` names now, which `lore.txt` has
  always been. A name cannot be renumbered, an unknown one (a mod's spell,
  uninstalled) is dropped rather than landing on whatever occupies its old
  index, and a build whose table is larger or in a different order reads back
  exactly what was written. **This does not open `RSF` to mods**; it removes the
  thing that made opening it unsafe.

### Fixed

- **A mod can no longer move the id of a record it does not own** (#233,
  MOD_REACH gap 10). A content id's localid is derived from the record's own
  name or code, so a mod that patched the **name** of a record it did not own
  moved that record's id out from under every save written before the mod was
  installed. Install a mod that renames Grip, and a character who had met him
  reloaded to find `core:grip-farmer-maggot-s-dog` resolving to nothing.
  Provenance did not cause this; provenance is what made it visible.

  The rule now is that **a record's id is fixed by the pack that DEFINED it, and
  a patch cannot move it** — in whatever namespace, so a mod's records are
  protected from a later mod's rename exactly as core's are. The composer
  records the definer's value for every top-level field a patch overwrote, and
  the resolver mints from those.

  Ids that an engine between 0.19.0 and this fix minted for a renamed record
  **still resolve, as a separate fallback family**. Repairing the defect without
  that would have traded one unresolvable-save defect for another. It is kept
  apart from the pre-0.19.0 legacy map on purpose: that one reproduces the old
  algorithm *including its suffix sequence*, and mixing the two would let a
  moved id take a suffix from an id that has been in savefiles far longer. No
  `SAVE_VERSION` bump — the format did not change, only which spelling the
  writer chooses.

  The alternative design — deriving an alias from the composer's own record key
  — was rejected on measurement, not taste: **the composer's key and core's
  localid disagree for 446 of 1,377 id-bearing records** (object kinds differ on
  a separator, terrain uses `name` on one side and `code` on the other, traps
  use a composite), so that alias would have been a guard that could not fire
  for objects, traps or terrain at all. The two schemes were never meant to
  agree and nothing had ever checked.

- **Three refusal screens gained addressable rows** (#265). An install, update
  or zip-import refusal now lists each unmet requirement as a row readable by
  the finding's own id rather than parsed out of a sentence, with the reason as
  that row's `detail`; auto-sort's dropped suggestions carry the blocking
  cycle's mod ids as data instead of a second unaddressable line.

  One deliberate movement, disclosed rather than worked around: the old
  rendering flowed `title: problem` as one sentence and wrapped it wherever it
  landed, so three of five findings had part of their *reason* sitting on the
  title's line. A detail is prose belonging to a row and cannot be cut into row
  fragments, so five findings now render as ten rows instead of eight. This is
  the mod manager's own screen and nothing upstream pins it.

  **`confirmDeclaredConflicts` was measured against the same change and left
  alone.** It wraps an author's `because` with `wrapCssRuns`, and that algorithm
  disagrees with the block model's on two enumerable cases: a hard-split token
  immediately followed by more content, and a tail landing exactly on the wrap
  boundary with an internal space. It wraps at `cols - 1`, a width the player
  controls by resizing, so a boundary-exact tail is reachable with ordinary
  prose. The warning already in that file — that swapping the algorithms "would
  move the page under the player" — is correct and stands.

- **Port defect: the knowledge menu's store view drew its `Price` header two
  columns left of upstream** (#257). It sat at column 62; 4.2.6 draws it at
  `scr_places_x[LOC_PRICE] + 4` (`ui-store.c:368`), four columns into the same
  nine-wide field the price itself fills — so the label ends flush with the
  number's field, at column 64. The proof that this was a slip rather than a
  considered divergence is inside this repo: `shop.ts:564` draws the same header
  on the live shop screen and gets it right, so two screens showing the same
  data disagreed and only one of them agreed with the C.

  This is core's to correct rather than the `bug-fixes` mod's, because it is a
  place the PORT disagrees with 4.2.6 rather than a wart 4.2.6 has.

  The two screens still differ in absolute column — the shop computes from the
  live terminal width and the knowledge table uses fixed literals — for a
  different reason, which is filed as #264 rather than papered over by making
  the numbers match. Agreeing with each other is not the requirement; agreeing
  with 4.2.6 is.

- **The switch census could not see a dispatch that was reshaped instead of
  converted** (#260). `tools/switch-census.mjs` found `switch` statements, and
  the ratchet asserts that converted files are ABSENT from the manifest — which
  correctly catches a conversion that was claimed but never made, and cannot
  catch one that never happened. An if/else chain over an enum, or a lookup into
  a module-level const array, is exactly as shut to a mod as a switch and scored
  zero, so a file could leave the census by being **fixed** or by being
  **reshaped** and the two looked identical. The denominator was drifting
  downward for a reason nobody had written down.

  It now counts all three shapes, tagged `SWITCH`, `IF_CHAIN` and
  `ARRAY_LOOKUP`, and the ratchet asserts the difference rather than the
  absence: a real conversion has zero rows of any kind, a reshape has a row
  under a different kind.

  Five reshaped dispatches came back, each hand-verified — including
  `ui-entry.ts`'s `COMBINERS`, which is MOD_REACH row 18's 32-case switch and
  had no successor row at all. **Precision was the whole difficulty:** asking
  only "is this array indexed by a variable" fired on 122 rows of ordinary
  control flow, RNG tables and colour palettes. Requiring a search BY FIELD —
  a `.prop ===` comparison or a `.find`, which is the shape a dispatch table
  actually has — cut it to five, with seven negative-control fixtures pinning
  the shapes that must stay clean.

  One edge is now written down rather than left silently true: `applyRenderer`
  in the same file is a **six**-arm chain, below the threshold of eight, and
  dropping the threshold to catch it would reopen the flood. Row 18 is
  half-derived and half read by hand, and says so.

- **The reach table's own rows contradicted the corrections printed beneath
  them** (#259). The arithmetic was fixed on 2026-08-13 and the explanation
  written, and the table rows themselves were left saying the old thing — the
  same failure the document apologises for, committed again in the commit that
  apologised. Rows 7 and 25 still read "accidental only - exported mutable
  array" when both are frozen (`project-mon.ts:861` is `Object.freeze`,
  `wizard.ts:520` is `deepFreezeMenu`); row 23's blocker still described a
  closure that no longer exists; and row 24 read as "nothing reachable" when
  `registry:menu` ships and reaches all six sites. A stale "no" under-reports
  the work, but a stale "accidental" **advertises a seam that was deliberately
  shut**, and an author could have planned a mod against it.

- The comments above the update and report pages explained that they were
  painted directly because `showTextScreen` resolves on ESC, ENTER and SPACE
  alike, and stopped there — leaving a reader to conclude the pages could not
  reach a mod at all. They can now, through `ScreenAction`, and the comments
  say how.

- `MOD_REACH.md`'s reach tally read "17 yes, 2 accidental, 9 no" while the table
  three lines above it gave 18 yes: row 26 had been corrected in prose and never
  added back to the arithmetic. Two rows were also labelled "accidental only —
  exported mutable array" when both had been frozen under gap 15 five days
  earlier. A stale "no" under-reports the work; a stale "accidental"
  **advertises a seam that does not exist**, which an author could have planned
  against. Now **18 yes, 10 no**, re-counted against the code row by row.

- `problemBlock`'s doc comment gave the reason for its eight-row cap as "a text
  screen has one page and no scroll". `showViewOnTerminal` scrolls with arrows,
  the numpad, PageUp/PageDown and Home/End, and prints its own position footer.
  The cap is a deliberate editorial limit — a hundred problems buries the
  per-mod reasons a player can act on — and the comment now says that instead.

- `packages/web/zz-dump.txt`, an 8 KB debug capture of the command-category
  browser committed by accident in `f6676cc32`, is removed.

- **The prose renderer implemented one of Angband's two wrap algorithms while
  citing the other, and the character sheet's history is the page that needed
  the other one** (#255).

  4.2.6 wraps prose two different ways. `textblock_calculate_lines`
  (z-textblock.c L238) lays out every page shown by `textui_textblock_show` —
  the inspect pages, monster recall, object comparison, the knowledge browser's
  seven recalls. `text_out_to_screen` (ui-output.c L279) lays out exactly one
  modelled page: the character sheet's history, which
  `display_player_xtra_info` (ui-player.c L862-871) pushes through it with
  `text_out_wrap = 72` and `text_out_indent = 1`.

  `textBlockLines` implemented the first and named the second in its comment.
  That miscitation was invisible in the output — the two rules agree on every
  line that contains a space, and **1041 of the 1041 descriptions the pack ships
  render identically either way** — so it survived until someone tried to reason
  from the comment. Three things came out of measuring instead:

  - **The wrap width was one short.** The region is the terminal's full width
    (`region_calculate` on `{0,0,0,0}`), so the wrap is at `cols`, not
    `cols - 1`. The two agree unless a line has no space strictly inside it,
    where upstream packs `cols` characters and the port packed one fewer. The
    longest unbroken token in the pack is 18 characters, so no page a player
    reads at 80 columns could show it — but a mod re-rendering a view in a
    narrow panel can, and at 16 columns four of the pack's descriptions already
    differ.
  - **A paragraph ending exactly on a break lost its blank row.** Upstream opens
    the next line before it sees the paragraph end and emits it, trimming only
    the very last one. The port emitted nothing. An upstream wart, so it stays.
  - **The character sheet's history was two columns too wide and re-flowed.**
    `text_out_to_screen` writes a non-space only while `x < wrap - 1`, so its
    rightmost glyph sits at column 70; declaring `wrap: 72` and wrapping with
    the textblock rule put glyphs in columns 71 and 72 and fitted an extra word
    on a line. `ScreenTextBlock.flow` now names which rule laid a block out —
    absent for the textblock rule, `"text-out"` for the history — because the
    two also disagree about whether the second space of a sentence break
    survives at the head of the next line (5 of the pack's 1041 descriptions).

  `packages/web/src/prose-wrap.upstream.test.ts` transcribes **both** C
  functions independently of the renderer and requires the renderer to match the
  one it claims: over every description in the shipped pack, at seven terminal
  widths, and over random prose generated to contain the long tokens and double
  spaces the pack has none of. A comment saying two things agree does not keep
  them agreeing; the differential test does.

- **Prose wrapped one word early whenever a line ended exactly at the wrap
  column** — every recall page, object description and lore paragraph.

  Upstream wraps on `(x >= wrap - 1) && (ch != ' ')` (ui-output.c L301): a space
  landing *on* the boundary is written rather than wrapped on, and only the
  following non-space takes the break. The port scanned backwards from the
  character before the boundary and so never looked at that space, pushing a word
  that fit exactly onto the next line — "one two three four five" at width 10
  broke as "three" / "four five" where 4.2.6 gives "three four" / "five".

  Found by moving the wrapper into the screen model (step 5b-ii above) and
  finding it disagreed with the model's own renderer, then traced against 4.2.6
  rather than argued about. It had been invisible since the port had recall
  pages: the whole suite passed both before and after the fix, because no fixture
  had ever put a word on the boundary.

- **A faulting front end was re-entered on every repaint** (found while building
  the HUD's copy of the mechanism).

  `frontendWorldFrameSink` remembers that a replacement threw and stops calling
  it for the rest of the session — but it was built *inside* `render()`, so that
  memory was thrown away on the next frame. A persistently throwing mod was
  therefore re-entered, and re-reported to the player, once per repaint instead
  of once. Both display sinks are now built once per installed selection.

### Changed

- **Every text file is LF, and `.gitattributes` now enforces it** (#254).
  Repository hygiene; no effect on the game.

  "Every source file here is LF" had been written down as a fact for months.
  It was not one: 69 tracked files were CRLF, 12 were mixed, and three source
  files carried a byte that made git classify them as **binary** —
  `packages/web/src/main.ts` had two lone CRs left behind by a scripted edit,
  and `mod-sdk/src/resources.ts` and `parity/tools/ledger-deferred-items.mjs`
  each embedded a raw NUL as a compound-key separator (deliberate, and now
  written `\u0000`, which is the same character and says so).

  A file git calls binary is never diffed as text, never normalised, and never
  reviewed line by line, so the invisible byte survives every pass. That is the
  cost worth naming: the hazard is not the line ending, it is that a scripted
  edit meeting one of these files rewrites all of it and buries the real change.

  `* text=auto eol=lf`, with `reference/**` exempt because those are upstream
  Angband's own bytes at the 4.2.6 tag and seven of them ship CRLF. 79 files
  changed, of which 74 are line endings only — `git diff --ignore-cr-at-eol`
  over the commit shows exactly the five substantive ones. The suite is
  unchanged at 10,221 passing, which is the evidence that nothing depended on
  a carriage return.

- **The HUD is a frame now, not three closures** (#253, MOD_REACH gap 21,
  step 1).

  The vitals, the message line and the status line were drawn by
  `renderSidebar`, `renderCompactVitals` and `renderStatusLine` — functions
  inside `main.ts`'s module body, which boots a whole game against a canvas on
  import. They were correct and they were unreachable, in two ways that matter.
  A mod asking "what are the player's hit points, and where does this layout put
  them" had nowhere to ask, because the only thing that knew had already
  flattened the answer into coloured cells. And every rule they carried — which
  fields survive a short screen, where the compact header's separators fall, how
  far a run may reach, what the targeting loop takes over — could only be checked
  by a human looking at a screenshot.

  `packages/web/src/hud-view.ts` gives them the `WorldFrame` treatment: a frame
  of named sections, each a list of keyed entries whose runs carry the engine's
  own `COLOUR_*` attribute beside the css the terminal resolves it to. What is
  left in `main.ts` is an adapter that reads core's models and one sink that
  consumes the frame, so no HUD cell has a second draw path.

  Two things this bought. The layout rules are now pure functions over values,
  driven by `hud-view.test.ts` across three layouts and four sizes. And the
  region table published by #234 finally has something to check against: each
  section carries the region it plays the role of, so "core draws its own
  furniture inside the rectangles core publishes" is an assertion rather than an
  argument. The one deliberate exception is the targeting loop's `?` help
  overlay, which takes as many rows as it needs above the status row — upstream's
  behaviour, and now stated in the frame instead of being silently cropped.

  No pixel moved, and that was measured rather than assumed: the new path was
  diffed against the four deleted draw loops over 4000 randomized frames, and
  both negative controls failed it — widening the reserved last column, and
  dropping the separator column that a blank field still charges for.

  This does not yet let a mod replace the HUD; per-region ownership is the next
  step, and it was blocked on exactly this.

### Fixed

- **The loading screen's `@` no longer walks through solid rock** (#252).

  It was the digger. The animation had one moving thing — the tunneller that
  carves the dungeon out — and drew an `@` on it, so the glyph advertising the
  game was a character ignoring walls, on a screen whose entire subject is a
  dungeon.

  The two are separate now. The digger is generation and is never drawn; the `@`
  is an actor that moves only onto floor that already exists. Since it is
  obeying walls anyway it may as well play, so it does: wanderers that notice it
  give chase, it fights what it can reach and runs when it is hurt, and it does
  not die — there is no character to kill yet, so at zero hit points it escapes
  somewhere else on the floor rather than leaving a tombstone on a loading
  screen.

  Two notes from testing it, because both assertions were wrong first time. "The
  `@` is always standing on floor" **passes for the bug** — the digger carves the
  square it steps onto — so the real test freezes the map and compares the cells
  byte for byte: a walker changes nothing, a digger cannot help it. And "some
  monster ends up next to the `@`" passed with chasing switched off entirely,
  because the idle shuffle produces that on its own within a boot; the chase is
  now driven down a staged corridor where only a pursuer arrives on schedule.

### Added

- **The modding docs say which surfaces are finished, which are in progress, and
  which have no seam at all.**

  `docs/modding/README.md` opens with a status index: one row per thing an author
  might want to do, marked **Complete**, **WIP** or **Not yet**, each pointing at
  the row in `MOD_REACH.md` where it is measured. That directory has always held
  both built-today pages and design-of-record pages, and nothing on the way in
  told an author which was which — so "the design says X" and "X works" read the
  same.

  A summary table of statuses is the most rot-prone thing a docs directory can
  contain, because it is read first and edited last. This one is held to the
  measurement by `modding-status.test.ts`, which parses both files and fails if a
  status here stops matching the gap list there — in both directions, including
  the one that catches a NEW gap being opened without the index mentioning it.

- **A replacement front end is told where the map is, so it stops covering the
  rest of the game** (#234, MOD_REACH gap 9).

  Every `WorldFrame` now carries `regions` — the named parts of the screen
  (`messages`, `sidebar`, `map`, `status`), each with a rectangle in grid cells
  **and** in CSS pixels. `map` is the front end's; the others are core's and are
  published so a mod can stay off them, or cover them knowing what it covers.

  **What this fixes.** A front end draws with its own canvas, and cell size and
  the letterbox offset were private to the terminal — so `samples/blueprint-view`
  could only cover the whole window, and with it enabled you could not read your
  hit points, see a message, or open the Mods screen to turn it off again. The
  sample now positions itself on `regions.map.pixels` every frame. Photographed
  in the installed desktop build: its own label reads back `map region: 66x22
  cells at 13,1`, the sidebar and the status line are core's and readable, and
  the game menu opens with `j) Mods` legible.

  **The names are roles, not places.** `sidebar` is the 13-column left column in
  the classic layout, a one-line header under the messages in the compact one,
  and *absent* when the player has turned the vitals off — so a mod that asks
  for `sidebar` is right in all three, where one that had asked for "columns
  0–12" would have drawn over the map in two of them. Read them from the frame
  rather than caching them: they move on a resize and on a sidebar-mode change.

  `regions` being absent means **draw nothing**, not "fall back to the window" —
  a fallback puts the old defect back intermittently, which is worse than always.
  The sample hides its canvas instead, and a test asserts it.

  Adding an optional field is not an ABI bump, so plugins written against api 1
  are unaffected; a front end that ignores `regions` behaves exactly as before.

  **Still open, and it is the UI seam's** (gap 21, #253): a full-screen overlay
  — the game menu, inventory, the character sheet — is painted across the whole
  terminal, *including* the map region a front end holds, so those screens are
  clipped where its canvas sits. Usable, and wrong. Full screens have no region
  of their own yet.

- **A mod front end now needs the player's permission, and the game's own
  renderer competes for the slot on equal terms** (#140, the last phase of the
  front-end replacement seam).

  `ModPlugin.frontend` shipped able to take over everything the player sees of
  the dungeon while its manifest declared nothing at all. It now requires
  **`display:replace`** — a capability kind of its own, deliberately not a
  `registry:` domain and deliberately **not covered by `registry:*`**: an
  override wildcard grants every named game system, which is not the same thing
  as owning the screen. Declaring `frontend` without it is reported against that
  mod by name and the game keeps drawing, the same shape as `controller`
  requiring `command:add`. The consent prompt describes it in plain language and
  flags it as elevated.

  The second half is structural. Core's glyph renderer used to be a distinguished
  argument threaded through the render path — the special case every other front
  end worked around. It is now **candidate zero of the same list**, declaring
  `frontend` and `display:replace` exactly as a mod does, and it wins by the
  ordinary last-in-load-order rule when no mod outranks it. That deleted the
  null selection and the fallback parameter, and it is what makes the seam's
  claim checkable rather than aspirational: a seam that could not express the
  front end the game already ships would be a promise about a shape nobody had
  ever built through it. Core stays the recovery target — a replacement that
  faults hands the map back to it for the rest of the session — and that property
  now follows from core being first in the list rather than from a special
  argument.

  Measured with three plugin folders loaded from disk through the shipped
  loader. The third asks for `registry:*`, declares `frontend`, sorts **last**,
  and throws from its factory: under last-wins alone it would be holding the
  map, so a gate that silently stopped working fails there rather than passing
  quietly. The control got stronger too — it used to pass `null` for the
  selection, which cannot demonstrate anything about the default; it now runs
  core through selection and construction like any candidate and asserts the
  glyph output is unchanged.

  No shipped mod declares `frontend`, so nothing in the curated list goes dark.

- **CI plays the game now.** `tools/play-smoke.mjs` boots the built desktop shell
  over the DevTools protocol and plays a player's first minute — title, (N)ew
  game, a random character, the character sheet, town, a staircase, the dungeon,
  the item menus — and the new `play` job in `ci.yml` runs it on every push
  against the **production** bundle. It exists because the birth crash fixed in
  `0.19.0` shipped for five days past a green suite and green CI: all 46 birth
  tests omit `opts.deps`, so the one code path that builds a `GameState` was
  never executed by anything.

  It does not only watch for exceptions. A game that renders its title screen and
  then ignores every keystroke throws nothing, so the tool also requires the
  screen to change at each step. That guard is meaningful because the screen is
  otherwise static — six consecutive frames on both the title screen and the town
  are byte-identical with no input — and it was verified by running with input
  dispatch disabled, which fails at step 1 saying the game is not responding to
  input.

- **`tools/tall-tile-probe.mjs`**, a second CDP driver whose job is comparing two
  builds rather than smoking one. It plays to a fixed seed, optionally summons a
  named monster through the debug menu, screenshots, and diffs two frames by row
  band. It is run by hand — point it at the current bundle, then at a bundle
  built from another commit, and diff. `--diff` fails loudly when the two frames
  are identical, because "the images match" is the result that means the change
  under test never reached a running game.

  It carries one finding worth keeping: of the 252 entries in Shockbolt's
  overdraw band (rows 27-31), 247 have real art in the cell above them and
  **five do not** — and those five are the town's store entrances, the only tall
  tiles a new character can reach without wizard mode. A town-only comparison
  therefore photographs the one subject in the game that cannot show the
  difference, which is exactly what the first run of this tool did.

- **`tools/sound-probe.mjs`**, a third CDP driver, for the claims a screenshot
  cannot settle: it patches `HTMLMediaElement.play` through
  `Page.addScriptToEvaluateOnNewDocument` — before the bundle's first module
  evaluates — and reports every sample the game asked for, with the filename and
  whether the browser rejected the promise. That last part matters: Chromium's
  autoplay policy can refuse a `play()` the game correctly made, and "the engine
  never asked" is a different bug from "the browser said no".

  It always fires a **known-good sound first**, by a route that shares nothing
  with the subject: `MSG_DROP` comes straight from `obj-pile`'s drop with no
  message sink involved. A run whose control is silent reports INCONCLUSIVE
  rather than a result, because sound is off by default, the pack may be missing,
  and an option toggle driven blind may simply have missed.

  Two traps it cost a run each to learn, both recorded in the tool: `auto_more`
  has to be turned on before anything prints, or the first `-more-` pager
  swallows the next four keystrokes and the run ends somewhere else entirely;
  and `player_timed.txt`'s FOOD grades read like percentages but are scaled by
  `z_info->food_value` (`player-timed.c:263`), so Full is 10000, not 100.

### Added

- **A worked front-end mod you can copy** (`samples/blueprint-view/`, #234).

  The front-end seam's existing proofs are three test fixtures that push the
  frames they receive into a global so an assertion can read them back. That
  proves a frame *arrives*; it does not prove a mod can put anything on the
  screen with one. **Blueprint View** is a real mod folder — manifest,
  `plugin.js`, README — that takes the dungeon display and draws it as a
  drafting-table plan: walls as strokes, known floor as hatch, remembered grids
  dimmed, marks for monsters, objects and traps.

  Every decision it makes comes from `cell.visibility`, `cell.terrain.id` and
  `cell.overlays[].kind`. It never reads `cell.visual`, which is the terminal's
  own projection — reverse-parsing a `#` back into "wall" would have been
  shorter and would have demonstrated the opposite of the seam's claim. It
  resolves terrain by CODE through `ctx.core.FEAT`, because `FEAT` is generated
  from `list-terrain.h` and a content pack that adds terrain moves every index
  after its insertion point.

  `sample-blueprint.node.test.ts` loads **that folder by path**, puts it through
  the real front-end selection against core as candidate zero, and records every
  canvas call it makes for a `WorldFrame` built by the same producer `render()`
  uses — so the sample is checked code, not an illustration that rots.

  Writing it surfaced a real gap, recorded in `MOD_REACH.md` gap 9 rather than
  worked around quietly: **a front end is never told where the map's pixels
  are.** Cell size, the letterbox offset and the grid dimensions are private to
  the terminal and no `ModPluginContext` member exposes them, so a replacement
  that wants to draw *inside* the existing layout has to guess the rectangle.
  The seam's motivating cases — isometric, 3D — take the whole window and never
  noticed. The sample takes the window too.

  **Then it was run in the installed build**, which is the half a test cannot
  do: deployed to a real mods folder beside the desktop game, enabled through
  the manager's own consent prompt, applied by its own reload, and photographed
  drawing a loaded character's level — against an unmodded control of the same
  character, at the same position, in the same process. It drew. Its label reads
  the frame back (`66x22 from WorldFrame (1452 cells)`), and the four floor
  items the control shows as `? ? $ !` are its four object marks.

  Two things only that trip could find. **The sample would not load at all** —
  it shipped in a folder named `frontend-blueprint` while its manifest declared
  the id `blueprint-view`, and the game refuses a folder whose name and id
  disagree, because the enabled set, the load order and a save's provenance all
  key off the id. Every test passed the whole time, because they reach the
  plugin by *path* and the path is the entire subject of the rule. The folder is
  now `samples/blueprint-view/`, and the first thing its test asserts is that
  the two agree.

  And **a front end covers the window, so it covers everything else on it.**
  Core keeps its side of the bargain exactly — the map area of its canvas goes
  blank while the sidebar, the status line and every menu keep being drawn — but
  the mod has no way to stay inside the map, so it paints over all of them. With
  one enabled you cannot read your hit points, see a message, or open the Mods
  screen to switch it off again. So the remaining half of gap 9 is not polish:
  **until viewport geometry is published, a `display:replace` mod is a
  demonstration rather than a way to play**, and that is now said in
  `PLUGINS.md`, in the sample's README, and in gap 9 itself.

### Changed

- **Choosing a slower update channel no longer rolls the engine backwards**
  (#250, asked as "wouldn't moving to an earlier build potentially wreck a
  save?").

  It could, and that is why this changed. `decideUpdate` had one deliberate
  exception to its refuse-all-downgrades rule: an edge build was offered the
  chosen channel's newest release the moment somebody moved from `early` to
  `beta` or `stable`, on the reasoning that the channel they picked would
  otherwise report "nothing to install" forever. The reasoning was sound; the
  consequence was not. A character is written by the engine that made it,
  `SAVE_VERSION` only ever goes up, and migration runs forwards — so accepting
  that offer handed a save to an engine older than the format it was stored in,
  and the failure would not present as a refusal but as a corrupted character.

  The rule is now the one Windows Insider uses: **the channel decides where the
  game looks, not what it runs.** You keep the build you have until the channel
  you chose publishes something genuinely newer, and then you take it like any
  other update — no special case, just the version comparison. `AvailableUpdate`
  loses `older`, `UpdateView` loses `older`, and the "Moving back to 0.16.0" /
  "move back and restart" screen and footer are gone with them.

  The wait is explained rather than left blank, because silence here is
  indistinguishable from a broken check: the up-to-date screen now has two ways
  of saying "nothing to install", and the new one names the channel you are
  ahead of, says you will be offered its next build once it overtakes you, and
  says why the game will not put you back. `aheadOfChannel` is the predicate,
  and it is the same test `decideUpdate` retired — kept as a reason to explain
  standing still rather than a reason to move.

- **The customised-options reader is 4.2.6's again.** `options_restore_custom`
  hand-rolls its own read loop, and 4.2.6 says why in a comment of its own: "Could
  use `run_parser()`, but that exits the application if there are syntax errors"
  (option.c:284-287). Upstream *master* later replaced that loop with a
  `parser_reg("option sym name str yno")` grammar, and core shipped a careful port
  of THAT — `PARSE_ERROR` codes, column bookkeeping, and the `errmsg`-buffer wart
  included — under 4.2.6's name. #143 exposed it by moving `reference/` back to the
  4.2.6 tag; this replaces it.

  What a player sees change, on a `customized_birth_options.txt` or
  `customized_interface_options.txt` they have hand-edited:

  - the three `msg()` lines 4.2.6 prints are printed, where before there were
    none — "Line %d ... is not parseable.", "Unrecognized option at line %d ...",
    "Value at line %d ... is not yes or no." They named the page and the line all
    along; the port had a `Parse error in <path> line N column M` of a different
    lineage.
  - **no error cap.** The parser version stopped applying the file after its
    twentieth bad line, because `PARSE_ERROR_LIMIT` *breaks* the read loop. 4.2.6
    reads to the end, so a good line below twenty typos is now honoured.
  - `option:` is found anywhere on the line (`strstr`), and a `#` before it means
    the line is a comment rather than a directive — which is what makes the
    writer's own second header line, the one containing the words `"option:"`,
    safe to read back. `option::name:yes` is no longer accepted: `strtok`
    collapsed the double colon, this reader does not.

  The three messages leave `text-census.test.ts`'s `KNOWN_ABSENT` list by being
  ported, and the new tests check them against the C's own format strings with the
  arguments substituted in the C's order — which is the thing the census cannot
  do, because presence of a literal says nothing about filling `%d` and `%s` the
  right way round.

  **Mod authors:** `optionFileErrorMessage` is gone and `parseCustomOptionsText`
  returns `string[]` instead of `ParserState[]`. Both are recorded in
  `docs/modding/MOD_COMPATIBILITY.md`; `prefErrorMessage` was always the same
  formatter and remains.

### Fixed

- **(N)ew game never left the loading screen, so no character could be created**
  (#251, found while proving #234 on the desktop build).

  The loading screen added in #249 clears and repaints the whole terminal every
  90ms. It was taken down inside `maybeTitle`, one line above the title art —
  and that function has **four** returns, only one of which reached the stop.
  `?agent=`, `SKIP_TITLE` and `BIRTH_DONE` all answer `null` before it, and two
  of those three go on to paint a real screen. `newGame()` sets `SKIP_TITLE`
  before its reload, so (N)ew game took one of the exits that never stopped the
  animation: **birth was running the whole time** — mid-prompt, taking keys —
  and was erased eleven times a second. Switch character sets the same flag and
  lost the character roster the same way.

  Measured on the shipped Windows build, 2026-08-13, and confirmed by killing
  the interval from outside the game: the race menu appeared exactly where it
  should have been, with the quickstart prompt already answered. Nothing was
  hung, and nothing was slow — the screen was simply being painted over.

  The stop now happens **once, unconditionally, at the top of `bootMenus`** —
  the single entry to the pre-game menu stack, rather than one of `maybeTitle`'s
  exits. Everything the loading screen covers for has finished by then, and every
  route out of `bootMenus` hands the terminal to a screen, so there is no exit
  left for the stop to hide behind. `main-boot-order.test.ts` pins that shape:
  the call must be a direct, unconditional statement of `bootMenus` ahead of its
  menu loop, and must **not** be back inside `maybeTitle`, where a fifth exit
  added later would inherit the same bug.

  Both routes were then re-driven end to end on a portable built from the fix —
  title → (N)ew game → birth → a live level-1 Dwarf Paladin in the town, and
  Switch character → the roster with that character in it.

- **Putting on a Ring of Flames asked which way to point it** (#248, reported
  from a playtest as "I tried to equip a ring and it asked for a target").

  Upstream asks for a direction in exactly one place — `use_aux`
  (`cmd-obj.c:431`), reached from reading, quaffing, eating, staves, wands, rods
  and activations. `do_cmd_wield`, `do_cmd_takeoff` and `do_cmd_drop` never ask.
  The shell had the question a level too high: `dispatchItemVerb` and
  `dispatchItemRef` consulted `obj_needs_aim` for **whatever verb they were
  dispatching**, and `obj_needs_aim` is a question about the OBJECT — so an item
  whose effect happens to be aimed made every verb aim. Flames, Acid, Ice,
  Lightning, Open Wounds and Digging all carry an `effect:` line and no `act:`
  (`object.txt`), so wearing one opened the targeting prompt before the ring
  would go on a hand; taking it off or dropping it asked too.

  The aim question is now gated on `AIMED_VERBS`, the seven commands that reach
  `use_aux`. A verb added later is outside the set by default, which is the safe
  direction. The (A)ctivate screen keeps its unconditional ask — it *is*
  `do_cmd_activate` — and that asymmetry is now written down where someone would
  otherwise "fix" it.

- **Startup showed a town map for six seconds, and it belonged to nobody**
  (#249, reported from a playtest as "startup seemed to recently go from
  extremely snappy to very laggy… there seem to be two points at which it pauses
  for a few seconds", and "loading the game still paints a town map seemingly as
  a placeholder").

  Measured on the shipped Windows build rather than guessed at. From launch: a
  dark window until **6.9s**, a generated town from **6.9s to 12.7s**, the title
  screen at **13.1s**. Three separate things, only two of them the game's:

  1. `main.ts` painted the map at module scope. That map is a real, generated
     level belonging to the default character boot builds — it reads as "the game
     has started" when nothing has. `gameScreenLive` now gates every background
     repaint until boot settles on a game, and a **loading screen** fills the gap
     instead: a dungeon carving itself out, with the residents wandering the
     corridors it opens. An earlier attempt at this painted the title art first
     and still lost the screen, because a `ResizeObserver` settle came back
     through `renderBackground` a moment later and put the map straight back.
  2. The title screen awaited the update check before painting its menu row. The
     first `api.github.com` request a fresh process makes measured **6.1s**;
     every later one in the same process took **2–5ms**. It now waits 400ms and
     paints regardless — safe under the desktop shell because the `(U)pdate` row
     is drawn from `updateHow`, not from the answer, so nothing moves — and a
     late answer lights the shimmer on the row that is already there.
  3. The first ~6.2s is **not the game**: an AdGuard-injected content-script
     request (`local.adguard.org`) blocks the document before any of the game's
     own code runs. Confirmed by removal — blackholing that host on a cold launch
     took the game's first fetch from 6340ms to **136ms**. Nothing the game draws
     can cover a stall that happens before it is running; excluding the app in
     AdGuard is the fix, and it is the player's to make.

  Net on the same machine and the same measurement: title screen at **7.9s**
  instead of 13.1s, and no town map at any point.

- **An update check that failed said "This is the newest build on your channel",
  and there was no way to ask again** (#247, reported from a playtest as "my edge
  game is supposed to update to the latest pushed commit, but it doesn't see
  246").

  `checkForUpdate` returned `AvailableUpdate | null`, and `null` was four
  different answers wearing one value: nothing newer, GitHub unreachable, GitHub
  refusing, GitHub too slow. The update screen read all four as the first and
  printed a sentence it could not stand behind. Worse, the check ran **once**, at
  module load, and both the title-screen row and the update screen read that one
  memo — so a check that failed at launch was a confident wrong answer for the
  rest of the session, and the only retry was restarting the game.

  It now returns `UpdateCheck`: `{ ok: true, update }` or `{ ok: false, reason }`.
  The screen has a third phase, `unchecked`, which names what went wrong in the
  words the check reported, claims nothing about currency in either direction,
  and offers ENTER to ask again. Opening the screen after a failed boot check
  re-asks on its own, since pressing (U) is a player asking deliberately and boot
  is long over by then. 403 and 429 are called what they are — the
  sixty-an-hour unauthenticated rate limit, which clears by itself — because
  "GitHub answered 403" reads as a permissions problem nobody can fix.

  **This project had already fixed this exact bug on the other half of the same
  screen.** `mod-registry.ts` records a silence that "meant nothing newer shipped
  HERE and it said you are up to date", and `mod-refresh.test.ts` asserts the
  phrase is never used for mod updates. The lesson was never carried across to
  the game's own updater, so one screen shipped both the fix and the bug.

  Three tests in `update.test.ts` used to assert the collapse directly —
  `.resolves.toBeNull()` for a refused request, a thrown network and an abort,
  the same value the up-to-date case returns. They were not wrong about the code;
  they pinned it. Each now asserts that its own failure is distinguishable from
  currency. The phase mapping moved out of `main.ts` into `checkPhase` in
  `update-ui.ts` for a related reason: `main.ts` is the one file in the package no
  test runs, and three lines of untestable shell code under a screen whose every
  sentence is asserted is how this survived a release cycle.

  Verified in the shipped desktop build, both halves, driving it over CDP with
  `Network.setBlockedURLs` holding `api.github.com` shut: the screen reports "The
  check for a new version did not get an answer / GitHub could not be reached."
  with the retry in its footer, and pressing ENTER once the block is lifted
  produces "Neo Angband 0.19.1-edge.247 is available."

  A suspected contributor to the original report, recorded rather than claimed:
  the boot check is issued while the page is still loading mods and tile packs,
  and its six-second abort runs on wall-clock time whether or not the main thread
  was free to read a response GitHub had already sent. A large install can lose a
  check it won. That is now visible instead of silent, and retryable instead of
  terminal.

- **Repeating a shot at a monster that had walked out of view fired the arrow
  into the player's own grid** (#245, reported from a playtest as "firing an
  arrow when my target leaves my view should ask for another target or a
  direction, but instead, it just fires and misses").

  Upstream's aimed commands never read their direction argument directly. They
  read it through `cmd_get_target` (`cmd-core.c:955-969`), which re-validates a
  stored `DIR_TARGET` against `target_okay()` on **every** execution and
  re-opens `get_aim_dir` when the target has stopped being reachable. The port
  asked once, in the shell, and the repeat key replayed the answer — so a
  `DIR_TARGET` whose monster had gone reached `rangedHelper`'s non-target
  branch, where `DDX[5]` and `DDY[5]` are both 0: a zero-length path at the
  player's own feet. That branch's own comment named this hole and said the fix
  belonged in the caller; it does, and this is it.

  The re-validation now runs before a repeat is queued, for all three places a
  command keeps a direction — `dir` on the plain aimed commands, `args.dir` on
  the item verbs, `args.tgtdir` on a `get_aim_dir` a handler asks from inside an
  effect. Escaping the re-prompt abandons the repeat without spending a turn,
  which is upstream's `CMD_ARG_ABORTED`.

  This one was already **adjudicated, and adjudicated wrong**: `PORT_TODO.md`
  called the retry a "divergence by construction" because "repeat is a boolean
  gate, not a replayed argument". The boolean gate is `repeatPrevAllowed`; the
  replayed argument is the `commandBuffer.push({ ...lastRepeatCmd })` twenty
  lines below it in the same function. That row is corrected rather than
  deleted.

- **A pile of items you could SEE drew its top item; the same pile drew `&` as
  soon as it dimmed out of view** (#246, reported from a playtest).

  Upstream runs one loop and one draw whether a grid is lit or remembered
  (`cave-map.c:155-169`, `ui-map.c:200-224`). This port grew two arms — a live
  one over `state.floor` and a remembered one over `state.known` — and only the
  remembered arm ever computed `multiple_objects`, which is why the pile glyph
  appeared exactly when the pile stopped being in front of you. Both arms now
  go through one `floorDisplay`, which is `map_info`'s loop: it skips an ignored
  entry without consuming the `first_kind` slot (so one wanted item under one
  ignored item is still one item, not a pile) and breaks at the second
  displayable object, answering "more than one" and never "how many".

  The test that matters compares the two arms against **each other** over the
  same pile, rather than each against the rule written twice — the shape that
  let the halves drift for a release. Removing the mechanism fails it.

- **No neo-linoleum pack ever drew a double-height tile, so every tall Shockbolt
  monster was squashed into one cell** (#243, reported from a playtest as
  "Guardian Naga is squat").

  #241 taught both tile engines to draw a bottom-anchored double-height tile and
  taught the frame diff to repaint the cell above it. What it did not fix was
  who gets ASKED. The render call looked the answer up itself, in core's
  graphics-mode catalog, keyed by the live mode id — and a tile pack
  contributed by a mod claims an id of its own (neo-linoleum's Shockbolt packs
  are 105 and 106), which that catalog has never heard of. The lookup returned
  nothing and the test short-circuited to `false` for every tile in the game.

  It was worse than a missing entry. A loose pack's tile code is a synthetic
  SLOT number, not a tileset row, so the row-band test the tilesheet engine uses
  is not merely unavailable on that engine — it is meaningless. The
  authority was wrong, not absent.

  **`TileBlitter.isTall` is the fix**: the engine answers, because only the
  engine knows what a code means. The tilesheet tests its own mode's overdraw
  band (`is_dh_tile`, `grafmode.c` L241) exactly as before; a loose pack reads
  its own new **`maps/tall.txt`**, which the converter writes naming every asset
  it cropped two cells tall. Per asset rather than per row, because a loose pack
  addresses pictures by name and the source row does not survive conversion
  — which also means a hand-authored pack can declare a tall tile with no
  overdraw band and no source tilesheet at all.

  Sniffing the loaded image's shape instead would have been wrong, not merely
  unavailable: Nomad's cells are 8 wide by 16 high, so every ordinary asset in
  that pack is exactly twice as tall as it is wide.

  The population is now enumerated rather than asserted. Shockbolt is the only
  source mode with an overdraw band, and it holds **247 tall monsters in both
  packs, plus five shop entrances that are tall in the DARK pack only** —
  Light maps them a row outside the band. `linoleum-equivalence.test.ts` runs the
  real converter over all six shipped packs and requires both engines to call the
  same entities double-height, with the counts pinned; removing the mechanism
  fails it on exactly the two Shockbolt packs and nothing else. Shockbolt Light
  was missing from that test's pack list until now, which is also why the one
  pixel proof of #241 — it photographs those five shop entrances — was
  a proof about the dark pack and about the tilesheet engine, and nothing more.

  Reaching a player needs a neo-linoleum release: the truth lives in the pack
  bytes and the six shipped packs predate the file. Until then a linoleum pack
  behaves as it does today, which is exactly what an absent `maps/tall.txt`
  means.

- **A typed message never played its sound, so most of the sound pack was
  unreachable.** Upstream has two entry points: `msg()` logs and stops, `msgt()`
  logs *and* calls `sound(type)` (`message.c:405-445`). The port split that
  second half off into a separate `state.sound` seam, leaving every caller to
  remember both — and the ones that forgot were silent with nothing to notice
  them. All 27 `msgt:` types in `player_timed.txt` were in that set, so no timed
  effect in the game ever made a sound: not hunger, not poison, blindness,
  confusion, fear, stunning, cuts, speed or any resist.

  Reported from play as "I'm not sure I heard the full sound when I got full",
  and hedged, because "I did not hear it" and "it did not fire" are different
  claims. It is settled now by measurement rather than by listening: the new
  `tools/sound-probe.mjs` patches `HTMLMediaElement.play` before the bundle
  loads, drives the installed desktop build over CDP to both FOOD grade
  transitions, and reports every sample the game asked for. Before the fix the
  two transitions were silent while a control sound played in the same run; after
  it, both play `pls_man_sob.mp3` and the control is byte-identical.

  The fix is one line in the host's message sink, which *is* `msgt` — plus the
  deletion of thirteen hand-written `state.sound` calls that now duplicate it.
  Only a message carrying a type sounds, so `msg()` stays silent exactly as
  upstream, and the standalone `sound()` calls (the drop thud, the ambient
  timer, teleports, the bell) are untouched. Sound draws no RNG; no stream moves.

- **Hallucination had no visual effect at all.** `hallucinatory_monster` and
  `hallucinatory_object` (`ui-map.c:41-80`) were never ported, and neither was
  the `one_in_(128)` placeholder block `map_info` runs on an empty grid
  (`cave-map.c:179-188`). A hallucinating character got the "something strange"
  look descriptions and the replaced monster list — those were already there —
  but the map itself drew the dungeon exactly as it really was. Now a real
  monster or item is replaced by a random one, an empty non-permanent grid
  invents a monster at 1/128 or an item at 127/16384, a grid that hallucinates
  hides its trap, and the player's own `@` is replaced by a phantom monster on
  that same 1/128 — every arm upstream has, on the live map and on the `M` level
  overview both.

  Three details that are easy to get wrong and are pinned by tests: the two
  placeholder rolls are exclusive (upstream's second test is an `else if`); each
  `one_in_(128)` is evaluated *before* the permanent-wall check, so an empty
  outer wall consumes both draws and gets nothing; and a hallucinated object
  takes the unflavoured **kind** glyph, which upstream flags as deliberate
  ("HACK - without flavors").

  The draws come from a display-only RNG, never `state.rng`. Upstream rolls
  these at render time on the main stream, which is safe when only a game event
  can repaint; here a window resize, a closed menu or the animation timer all
  repaint, so binding them to the game stream would have made the dungeon depend
  on how often the screen was painted. Same odds, same rejection loops, a
  different stream — see `docs/PARITY.md`, which now states the general rule.

- **Dungeon spellbooks could not be found the way upstream finds them, and
  burned when upstream's do not.** `write_book_kind` (init.c L269-275) gives a
  book declared `dungeon` in `class.txt` two extra properties: `KF_GOOD`, and
  `EL_INFO_IGNORE` on the four base elements. The port applied neither.
  `KF_GOOD` is what decides whether a kind is in the GREAT allocation table at
  all, so no dungeon spellbook could ever come from a vault, a labyrinth or
  cavern `TYP_GOOD`, a `DROP_GOOD` monster's drop, or any `make_object` called
  with `good`; and without the ignore flags an acid or fire hit destroyed a book
  upstream would have spared. Measured against the compiled 4.2.6 oracle over
  20 000 generated levels, this alone moved the port's object count from −0.23%
  to −0.10% of upstream's, and brought three of the four spellbook tvals to
  within 2% of it. Note for anyone comparing fixed seeds across this release:
  putting twelve kinds into the GREAT allocation table moves the generation
  stream, so a given seed builds a different level than it did in 0.19.0. The
  two streams that must never move are unaffected — `randartSeed` and
  `seedFlavor` are stored in the save and re-derived from there.

- **Double-height tiles were squashed into one cell.** `isDoubleHeightTile`
  (the port of `is_dh_tile`, grafmode.c L241) was correct, exported, documented —
  and had no caller, so both tile engines cropped or scaled a two-cell-tall
  Shockbolt tile into a single cell. A tall tile is bottom-anchored: the cell it
  is queued at is its LOWER half, and the upper half overdraws the cell above,
  which is what the reference renderer does (main-sdl.c L5191-5193).
  Blitting it correctly is only half the fix — the terminal repaints only cells
  whose glyph changed, so it now grows the dirty set the way upstream's `pr_drw`
  does (ui-term.c L915-960), in both directions: a changed tall anchor drags in
  the cell above it, and a repainted cell drags in the tall anchor below it.
  Without the first, an upper half survives after the tile leaves; without the
  second, clearing the upper cell decapitates a tile that is still there. The
  level-map miniature deliberately does NOT overdraw — one cell per dungeon
  grid, matching the reference's one-by-one overview tilesheet. Frames with no
  tall tile in them pay nothing: the expansion adds no cells and the paint count
  is unchanged.

  **Verified in pixels**, not only in unit tests: `tools/tall-tile-probe.mjs`
  drives the built desktop shell over the DevTools protocol, summons a Fire
  giant (Shockbolt row 29) beside the player at a fixed seed, and photographs
  it. The same seed and the same key sequence were then run against a bundle
  built from the parent commit — the mechanism removed, not merely fed inert
  input — and the giant is drawn from the waist down, head and arms cropped off.
  Side by side it is unmistakable.

- **A revealed mimic went on being drawn as the item it was pretending to be.**
  `become_aware` (mon-util.c L777) calls `square_note_spot` on the monster's
  grid at the END of the function, outside its camouflage block; the port
  returned early instead, so the player's map memory kept the pile it held
  before the fake object was removed. Nothing re-synced the grid until an action
  that runs the field-of-view pass, and looking at a mimic to reveal it is not
  one. `square_note_spot` now has a single port definition, `noteSpot`, called
  both by the per-turn pass and out of band here. The upkeep half is ported too:
  revealing a monster that carries its own light recomputes the view, since it
  was contributing nothing to lighting while it was masked.

- **`Your & Leather Shield~ is damaged!`** — acid damaging a worn armour piece
  printed the raw `object.txt` template instead of a name. `minus_ac`'s naming
  hook defaulted to `obj.kind.name` when a caller forgot to supply one, and the
  live projection path (acid traps, acid balls) never supplied one; the
  venom-sting path did, so the same message was right or wrong depending on
  where the acid came from. The hook is now **required**, so a call site that
  forgets is a compile error rather than a sentence with the article and plural
  markers still in it. Reported from play.

- The `play` job failed on a `--no-sandbox` artifact rather than on the game.
  Disabling Chromium's sandbox is what leaves `binding.startupData` null, so
  Electron's own `sandbox_bundle` throws before the app has run a line — and the
  run that hit it had already played all ten steps and screenshotted a live
  character sheet. The filter now exempts those two exact lines, and **only when
  `--no-sandbox` was passed**, so a renderer that genuinely fails to boot still
  fails the job. Because narrowing that filter is precisely how a real error
  gets hidden, `tools/play-smoke.mjs --self-check` now asserts the predicate in
  both directions and CI runs it, with and without the flag, before Electron
  starts. Verified by deleting the flag guard: the no-flag self-check then
  reports both sandbox cases as failures.

- **Every detection and mapping effect in the game did nothing.** A scroll of
  Magic Mapping is `effect:MAP_AREA` plus `effect-yx:22:40`, and that second
  directive is the *area* — `effect_handler_MAP_AREA` reads it as
  `context->y`/`context->x`. Neither producer of a live effect chain carried it:
  `buildObjectEffectChain` (objects, activations, class spells, chest traps,
  curses) and `buildSpellEffectChain` (monster spells) both read `eff`, `type`,
  `radius`, `other`, `dice` and `expr`, and dropped `effect-yx` on the floor. The
  handlers then worked a zero-size box — the scroll was consumed, `ident` was
  set, no message was wrong, and nothing happened. **63 effect instances across
  `object`, `activation` and `class` were affected**: Magic Mapping, Detection,
  \*Enlightenment\*, Treasure Detection/Location, Detect Invisible, Detect Evil,
  and every class's detection spells for Mage, Druid, Priest, Necromancer,
  Paladin, Rogue, Ranger and Blackguard.

  It survived because `effect-detect.test.ts` passes `{y: 22, x: 40}` straight to
  `effectSimple`, which makes it an assertion about the *handler* and an unchecked
  assumption about the *producer*. The new test builds the chain from the real
  `Magic Mapping` record and asserts the y/x arrive.

- **Two more directives the same builder was dropping**, found by asking whether
  the one above was an instance or a class. It was a class: an effect directive
  the builder does not know is not an error, it is an effect that quietly does
  less.
  - `dice-xtra` is what a trap's `effect-xtra` chain calls its dice
    (`parse_trap_dice_xtra` sets `effect->dice` exactly as `dice` does on an
    `effect`). The builder read only `dice`, so **every extra effect of a pit
    rolled zero**: a spiked pit printed "You are impaled!" and dealt none of its
    2d6, and neither the spiked nor the poison pit ever cut or poisoned.
  - `effect-msg` is the killer string `EF_DAMAGE` uses for a `SRC_PLAYER` origin
    (effect-handler-attack.c:516), so the Necromancer's three self-damage spells
    killed you with "yourself" instead of "shadow shifting", "self sacrifice" or
    "performing a curse".

  Rather than a test per directive, a new census test asserts the builder's
  vocabulary covers **every key the shipped packs actually put on an effect
  record**. It found a fourth, `effect-dice`, which is genuinely consumed
  elsewhere (`player/bind.ts:809` folds it into the step's `dice`) — so that one
  is an explicit exemption carrying the line that handles it, and a second
  assertion fails if an exemption stops appearing in the data.

- **A phase door left the player unable to read.** `player_handle_post_move` ends
  with `update_view(cave, p)` (player-util.c:1635); the port's teleport wiring ran
  only the trap half. `no_light(p)` is `!square_isseen(cave, p->grid)`, so until
  the view is recomputed the player's own grid still reads as unseen at the grid
  they *left*, and reading is refused with "You have no light to read by." A walk
  hid this because the turn loop recomputes the view anyway. Fixed at both
  producers — teleport and `thrust_away`. Reported from play.

- **Ignoring (`k`) a floor item silently did nothing.** The picker offers floor
  rows (`USE_FLOOR`, ui-object.c:1833) and took the keypress, but the callback
  tested for the gear shape — `"handle" in ref` — and returned null for the
  `{floor}` shape, so every floor row was a no-op. It now resolves through
  `targetRefObject`, which handles both.

- **The level map ('M') was ASCII even with a tileset selected.** `display_map`
  queues every cell through `Term_queue_char(..., a, c, ta, tc)` (ui-map.c:849) —
  the same attr/char + terrain pair the live map queues — and scales by
  `tile_width`/`tile_height`, which exists for no other reason. The port's
  overview carried only `ch`/`css`. It now carries the foreground tile and the
  terrain tile beneath it, for terrain, traps, objects and monsters, and draws
  the player through the same cell the live map uses instead of a hard-coded
  white `@`.

- `docs/modding/MOD_REACH.md` reported a moddability backlog that no longer
  existed. Its class table still read `51 switches` and `22 CANDIDATE`, its gap-3
  row still named `18 CANDIDATE rows` as the remaining work, and its opening
  paragraph still closed by saying the problem that remained was behaviour living
  in `switch` statements with nothing to register into. Re-derived from
  `tools/switch-census.json`: **34 switches, 463 case labels, 0 `CANDIDATE`**. The
  document warns on the same page that a hand-written inventory quietly stops
  being a census while still reading like one, and that is exactly what had
  happened to its own numbers.
- Same file, the headline: `registry:*` capabilities read **14** and omitted
  `registry:menu`, which is real, wired and gated like the rest. The count is
  **15**, and the row now points at `REGISTRY_CAPABILITIES` in
  `mod/registry-host.ts` so the next reader re-derives it instead of trusting the
  prose. (`registry:player` is still not one - the only occurrence of that string
  in the tree is a test asserting it is rejected.)

- `parity/tools/c-vs-c-all-pairs.mjs` is back in this repository. It had been
  moved out with the working record, which left the pooled-object-count question
  unable to run its own first step from a clean checkout — a measurement
  instrument is not a record of past work. Its header now also states what it
  does **not** measure: it computes the null for the *feeling* histograms, not
  the object-count Stouffer Z, so running it as-is answers a different question
  than the one it was cited for.

Everything else through 2026-08-11 is in `0.19.0` below.

Current state of the project at version `0.19.0`. High level, what exists today:

- A TypeScript port of Angband 4.2.6, held faithful to the original, with the
  upstream C tree kept buildable in `reference/` as the golden-master oracle.
- A headless game engine (`@rpgm-tools/neo-angband-core`) with no UI dependencies, and
  the Angband 4.2.6 gamedata compiled to a schema-validated core content pack
  (`@rpgm-tools/neo-angband-content`).
- Front-end shells over the same core: a web + PWA app (`@rpgm-tools/neo-angband-web`),
  an installable offline experience, an optional Electron desktop wrapper
  (`@rpgm-tools/neo-angband-desktop`), and a terminal / developer harness
  (`@rpgm-tools/neo-angband-cli`).
- A mod framework (`@rpgm-tools/neo-angband-mod-sdk`): content packs, tile packs, and
  sandboxed scripted plugins, with the base game loaded as a pack itself.
- **No bundled mods.** A fresh install is Angband 4.2.6 and nothing else. Four
  first-party mods ride that framework, each in its own repository with its own
  release tags and tests, each installed through the mod manager's *Install a
  mod...* row at a pinned tag with every file checked against a SHA-256 that ships
  inside the game: `qol` (quality-of-life conveniences), `bug-fixes`,
  `neo-linoleum` (a second tile engine - loose packs of individually named PNGs with
  variant pools - plus the converter that builds one from any tilesheet, via
  `@rpgm-tools/neo-angband-linoleum`), and `borg` (the autoplayer). The game's own
  tile sets stay core content on the classic tilesheet engine.
- The Borg, in its own repository like every other mod: a faithful port of
  Angband's automatic player, driving the game through the same perceive/act agent
  API a third-party automation would use.

### Added

- **A front end is told when it is covered** (#261, commit 4).

  A replacement front end could learn **where** the map is (`frame.regions`,
  #234). It could not learn whether anything was **on top of** it — and that was
  a live defect rather than a missing nicety. Core's screens repaint the terminal
  *without producing a world frame*, because a screen redraws from its own key
  loop, so `samples/blueprint-view`'s canvas sat over the middle of every screen
  the player opened, showing a blueprint of the last dungeon it saw, with nothing
  in the picture to say which mod was responsible. Putting the canvas on the map
  region had moved the original cover-the-window defect inwards; it had not ended
  it.

  - `WorldFrame.stack` and `HudFrame.stack` now carry every region on screen,
    bottom to top, including the four base tiles `regions` names. A region later
    in the array is drawn over one earlier in it, so "is anything covering the
    map?" is finally a question with an answer.
  - **Absent is not empty.** `[]` means the host published a stack and nothing is
    over you; `undefined` means it published none. A front end that collapses the
    two decides it is uncovered on the word of a host that never answered.
  - `onStackChanged` re-presents a mod front end's **last** frame under the new
    stack, which is what makes a screen opening an *event* rather than something
    discoverable only on a repaint that was never coming. The dungeon is
    deliberately unchanged: nothing has run that could change it, and
    re-projecting the world from a shell that is not in a repaint would be
    inventing a frame. Core's own renderer is **never** restated — it repaints
    from `render()` and nowhere else — because restating it would paint the
    dungeon over the screen that had just opened, with core committing the defect
    instead of the mod.
  - The notification fires when the composite **changes**, not when it is
    recomputed. `relayoutStack` runs once per frame, and a listener on every
    recompose would double every repaint for news that had not changed.

  **What this closes, and what it does not — because the design brief claimed it
  "closes the live defect" and it does not.** The mechanism is complete and
  correct for every screen that *declares a region*, and today that is the
  text-screen path alone: `showTextScreen` routes through `showViewOnTerminal`
  (`overlay.ts`), which is **the only call site in the whole shell that pushes a
  region**. Every screen reached that way is covered — the Mods screen, the mod
  browser's listings, the knowledge browser's pages, the help pages, the
  equipment-comparison overlays, wizard mode's readouts.

  Everything else still erases the whole terminal without telling anyone.
  `main-regions.test.ts` enumerates 33 `term.clear()` sites across sixteen shell
  files; the compositor's own `render()` is the frame every region is composed
  on, and `paintViewOnTerminal` is the one that now sits in a region. The rest
  are marked pending, and they include the ones a player meets most: the item
  picker, the number and text prompts, the menu prompt, the level map, the
  character sheet's two pages, the four birth screens, the store, the options
  pages, the colour editor, the scores, the loading screen, and the monster list
  — which cannot use `showTextScreen` at all and says so in its own source, so it
  paints its own grid. Several files appear on both sides: `mod-browse.ts` and
  `equip-cmp.ts` reach `showTextScreen` for their listings and still clear the
  terminal directly elsewhere.

  So a front end reading `stack` gets a true answer about the screens that push
  regions, and "nothing is over me" about the rest. That is a real capability and
  a partial fix, and the ratchet is what will keep the remaining count honest as
  it comes down.

  The mod SDK mirrors `RegionLayer` and `LiveRegion`, and both frame types gained
  `stack`. `world-view.test.ts`'s mutual key-union guard is what holds the host
  and SDK frames together: an optional field added to one side alone fails
  `tsc -b`.

  Two corrections found while building it:

  - **The snapshot boundary is the only side worth asserting on.**
    `snapshotWorldFrame` and `snapshotHudFrame` enumerate their fields *by hand*,
    so a field added to the type is carried by the live frame and silently
    dropped from the snapshot a mod receives, with every live-frame test still
    green. Measured: deleting `stack` from the world snapshot leaves
    `world-view.test.ts`'s producer assertion passing and turns three
    `sample-blueprint.node.test.ts` assertions red. The sample's tests were
    re-routed through `frontendWorldFrameSink`, which is where the snapshot
    happens; they had been calling the adapter directly and would not have seen
    it.
  - `signatureOf` in `ui-stack.ts` first used raw NUL bytes as a delimiter, which
    made the file **binary to git** (`git ls-files --eol` reported `w/-text`) and
    so exempt from `.gitattributes`' `* text=auto eol=lf` normalisation
    entirely. It is `JSON.stringify` now: collision-proof for an arbitrary
    mod-chosen id, and plain text.

- **A pack can declare its own MESSAGE TYPES as data** (#266, MOD_REACH row 20's
  successor), so a mod's spell, blow method, summon or projection can carry its
  own `msgt:` and still bind. `registry:message` gave a plugin
  `messages.define(...)`, but the only door to that facade is the host a plugin's
  `register()` is handed — and `register()` runs **384 top-level statements after
  the bind that needs the name**. Measured, not read: `checkMsgt` resolves at
  `mon/bind.ts:609` under `bindCore`, under `startGame` (`session/game.ts:3042`),
  which is statement 182 of `main.ts`, while the earliest `register()` is
  statement 561. A content-only pack, which has no `register()` at all, could not
  reach the capability by any route — and that is most of the packs that want
  one, because a message type is what a spell or a sound pack ships, not what a
  systems mod ships.

  The answer is the one `bindProjections` already gives: a mod's new `PROJ` code
  works because `projection.json` is pack DATA that arrives through composition,
  so it exists before the binder asks. `declareModMessageTypes`
  (`packages/core/src/mod/message-declarations.ts`) appends a pack's
  `message_type` records — name, `sound.prf` key and sample list, because a
  content-only sound pack that could name a type and never bind a sample to it
  would be half a capability — after the 154 compiled slots and before
  `bindMonsters` and `bindProjections` run. `MESSAGE_ENTRIES` itself stays
  generated from upstream's `list-message.h`: **core adds nothing.** Declarations
  are additive, attributed to the pack that coined them from the composer's
  `$from` stamp, idempotent across the new-game and load paths, and never throw —
  a refused declaration loses one message type and reports it rather than taking
  the boot down. No capability gate, deliberately: these are records, and a pack
  can already add a projection, a monster, an artifact and an ego item ungated.

- **An installed mod now records the commit SHA its tag resolved to**, not just
  the tag's name (#134). A tag is a label its owner can move without the name
  ever changing, so "installed v1.2.0" and "v1.2.0" a month later could quietly
  be different code; the recorded SHA is what makes that detectable. An install
  from before this existed has no SHA on file, which is read as **unknown** —
  never as "confirmed unchanged" and never as "moved". A gap in old data is not
  evidence either way.

  `classifyModPin` (`mod-updates.ts`) is the comparison and `listTagRefs`
  (`mod-discover.ts`) is the fetch. **The "Update installed mods" screen does not
  use them yet**: `refreshOne` (`mod-refresh.ts`) still compares tag NAMES only,
  so the one standing a player most needs to see — *what you have is not what the
  name says* — is the one standing today's code cannot produce. Recorded here
  rather than left to be discovered, because every piece the fix needs is now in
  place and only the wiring is missing.

### Changed

- **76 raw `tval === TV.X` comparisons now go through the class predicates**
  (#229), so a mod that widens an item class through `registry:tval` is seen by
  the code that dispatches on it. The predicates were already a registry; these
  sites bypassed it and answered from a hard-coded tval, which meant a mod's item
  class could be a scroll to `desc.ts` and not to the map renderer at the same
  time. Converted across `obj/power.ts`, `visuals/object-glyph.ts`, `obj/make.ts`,
  `store/store.ts`, `obj/bind.ts`, `obj/randart-build.ts` and
  `obj/randart-data.ts` — 31 call sites once multi-line OR-groups collapse.

  Player-visible consequences that this fixed: an identified mod "scroll" kept
  drawing as its unreadable title; a mod launcher scored bow multiplier 1 and was
  undervalued in shops and mis-weighted in randart balance; a mod chest could be
  stocked by a store; a mod currency never joined the gold table; a mod special
  light lost its artifact activation; and a mod wearable class with
  `registry:randart` prep and census both registered still got only the generic
  randart ability menu, because `buildFreqTable` and `trySupercharge` were closed
  tval dispatches that `registry:randart` never opened.

  `obj/power.ts`'s header had documented the launcher checks as `tvalIsLauncher`
  since the port while `bowMultiplier` still compared `TV.BOW`. The comment was
  right and the code was the bug.

  **No behaviour change for an unmodded game**, and it was replayed rather than
  reasoned about: `tval-vectors.json`, `tval-kind-vectors.json`,
  `randart-vectors.json`, `desc-vectors.json` and `rune-vectors.json` are all
  byte-identical, RNG probes included. 32 sites deliberately keep the raw
  comparison and are **not** a backlog: 23 slot-specific or one-off cases with no
  class predicate (boots, gloves, shield, cloak, the One Ring's flavour, `TV.NULL`
  as a sentinel, priestly `BLESS_WEAPON`, WIS-blesses-edged), 6 fixtures and
  comments, the `GEN_LIGHT` ability arm (which a mod reaches by replacing the arm
  through `registry:randart`), and the two ammo-subtype lines in `power.ts` whose
  seam is an open design question — the entry gate uses `tvalIsAmmo` while the
  launcher path beside it uses `KF.SHOOTS_*` kind flags. New coverage:
  `obj/randart-build.test.ts`, plus mod-widening cases in `obj/power.test.ts` and
  `visuals/object-glyph.test.ts`.

- **The birth-screen character preview no longer lies to the type checker**
  (#235). `previewState` (`packages/web/src/birth.ts`) fabricated its throwaway
  `GameState` with `as unknown as GameState`, a cast that silenced **all** type
  checking on the fields it supplies. When core's `GameState` / `PlayerActor`
  gained fields the character-sheet renderers started reading (2026-08-06,
  `0b2c72530`), the preview did not get them, and **(N)ew game crashed at the
  crash reporter for five days on a green test suite**. `previewState` now
  mirrors the handful of fields it actually supplies from the real
  `GameState` / `PlayerActor` / `Chunk` interfaces via `Required<Pick<...>>`, and
  the object is declared with that named type before the single, now-honest
  `as GameState`. Renaming or removing any of `turn`, `playerState`, `runeEnv`,
  `chunk.depth` or `actor.{player,combat,knownCombat,speed,totalEnergy,weapon}`
  upstream is a compile error in `birth.ts` now, not a silent gap.

  One blind spot, stated rather than glossed: this does **not** catch a
  *brand-new* field added elsewhere on `GameState` that a sheet renderer starts
  reading — so it does not fully re-prove that the 2026-08-06 incident would be
  caught today. `birth.test.ts`'s "the sheet preview builds a usable GameState"
  case remains the actual backstop for that class of regression and was
  deliberately left in place. No user-visible behaviour change; 47/47 tests pass
  unchanged.

### Fixed

- **A mod's screen no longer hides the game's own prompt** (#258).
  `ScreenHost.invoke` runs the game's code for a screen's action while a
  presenter is drawing that screen, and two of the character sheet's actions
  PROMPT — `c` (rename) and `f` (dump to file) put a question on the faithful
  terminal and wait for an answer underneath the mod's overlay, while the input
  door goes on feeding them keystrokes. The rename was the worst of them: it
  reaches `persistSave()`, so **two keystrokes, `c` then Enter, wrote the save
  with nothing visible on the screen at all**, and Escape was the only key that
  got out without writing it.

  The fix is not a rule against prompting inside `invoke`; that would make the
  actions a mod can offer a strict subset of the game's, which is the whole point
  of the seam. The game now ANNOUNCES the prompt from the `SCREEN_PROMPTS` census
  before it lands: a presenter that can stand aside is told what is coming,
  awaited while it animates out, and given its screen back afterwards; one that
  cannot is named once in a fault report — with the member to add spelled out in
  the sentence — and has the prompt drawn over its overlay, which is ugly and
  enormously better than an invisible question.

  Both character-sheet call sites are wired. `core:report`'s `describe` and
  `core:update`'s `mods` are the two remaining prompts in the census and still
  land under an overlay; `screen-runtime.test.ts` carries a tripwire that goes
  red the moment `main.ts` announces them, so the gap can neither close silently
  nor stay open unnoticed. A second tripwire records that `yieldTerminal` is
  **not yet published on `ScreenShown`** in either `screen-view.ts` or the SDK's
  `screen.ts` — it works, and an author reading the SDK has no way to learn it
  exists.

- **The knowledge menu's store view put `Price` six columns left of the live shop
  screen** (#264), after #257 had already fixed the *header's* alignment to this
  screen's own data. #257's fix was self-consistent but not correct: it lined
  "Price" up with this screen's OWN price column and never checked that column
  against upstream's arithmetic. It did not match.

  `store_display_recalc` (`ui-store.c:208-233`) computes every column from the
  LIVE terminal (`Term_get_size`) on every repaint — `scr_places_x[LOC_WEIGHT]`
  is `wid - 14 - 10` for a store (the `-10` reserving room for the price column
  that follows) and `scr_places_x[LOC_PRICE]` is `wid - 14`. The live shop screen
  (`shop.ts`'s `geom()`) reproduces that formula every paint. The knowledge
  menu's store view cannot — its `ScreenColumn` widths are declared once, because
  the generic table renderer deliberately does not consult the terminal width for
  a declared column — so its name-column width needs upstream's formula evaluated
  at the one width this whole screen-model family commits to (80). `46` was never
  that: it was the number the pre-model code had always used, and nothing had
  checked it against the C. At `wid=80` the correct width is 52, which moves the
  price field from ending at column 68 to column 74 — matching the shop screen's
  own 74 exactly — and puts the header's "Price" at column 70 rather than 64.

  **Found alongside, same function, not itself named by #264:** the home's weight
  column shared the store's name width, but `store_display_recalc` gives the home
  a WIDER field — the `-10` applies only `if (store->feat != FEAT_HOME)`, so a
  home's weight sits at plain `wid - 14` (66 at `wid=80`), ten columns right of a
  store's. Reusing the store's width put the home's "Weight" header 16 columns
  left of upstream. `HOME_STOCK_COLUMNS` now has its own `HOME_NAME_WIDTH` (62),
  derived independently the same way rather than sliced from the store's array.
  Both are core's to fix: a PORT disagreement with 4.2.6, not a wart 4.2.6 has.

- **Nine source comments that asserted an absence which is false today** (#226,
  #227). A comment is what the next reader greps, so a stale one regenerates the
  error it describes — and two of these had already produced a work item apiece.
  `store/transact.ts` claimed a deferred "store-purchase history entry": upstream
  `do_cmd_buy` (`store.c:1646-1774`) makes no history call at all, and all four
  of `store.c`'s history calls (`:1087`, `:1303`, `:1924`, `:1988`) are wired.
  `player/shape-lore.ts` claimed nothing supplied the chain's last two sections:
  `makeShapeLoreEnv` supplies both (`game/shape-inspect.ts:163-164`) and the live
  browser uses it. `game/monster-turn.ts` called `react_to_slay` deferred (it is
  called at `:1347`) and the timed-effect message plumbing and lore deferred
  (sink at `:1723`, lore at `:1699-1705`). `game/ui-entry.ts` and
  `obj/object-info.ts` cited PORT_TODO items 3.9 and 3.20, both closed, next to
  the code that closed them. `gen/gen-monster.ts` said `spreadMonsters` was "not
  wired to a builder yet"; the cave builders call it. `game/wizard.ts` deferred
  the spoiler generators and Monte-Carlo collectors, which live in their own
  modules and are invoked by the wizard shell. And `obj/object.ts`'s
  equipped-check note was reclassified rather than deleted: no 4.2.6 caller can
  reach that guard with an equipped object, which is the third finished state,
  not a deferral. No executable code changed.

- **Two upstream citations in `game/equip-cmp.ts` pointed at dead code while
  naming the live functions.** `:214` cited "the six `sel_*` functions,
  L1643-1682" and `:333` cited "`sel_exclude_src` / `sel_only_src` (L1701-1712)".
  In 4.2.6 the live selectors are at `ui-equip-cmp.c:1657-1696`, `sel_exclude_src`
  is at `:1715` and `sel_only_src` at `:1722`; both cited ranges open inside `#if
  0` blocks — `:1648-1654` holds `sel_better_than` and `:1699-1712` holds
  `sel_exclude_slot` / `sel_only_slot`, the three selectors 4.2.6 compiles out.
  The port's code was correct throughout and implements only the four live
  categories; what was wrong was exactly the citation that would make the next
  upstream sweep conclude the port had lifted dead code. Comments only.

- Added test coverage for the mod manager's exit-reload prompt (#161). It fires
  only when a change was actually made during the visit, and declining it leaves
  the change recorded in the store without touching the running game until an
  explicit reload — rule toggles are correctly excluded, because they apply live.
  **No behaviour change: the mechanism already existed** (since the mod manager's
  first commit) and `packages/web/src/mods.ts` had no unit tests at all despite
  being 2,500 lines. Each of the four new tests was proven to fail without the
  mechanism it protects, by sabotaging `mods.ts` in place and reverting.

### Changed

- **Ten more screens declare the rectangle they erase** (#253, MOD_REACH gap
  21). All four birth screens, both of the character sheet's own painters, and
  all four of the mod browser's wait screens now push a `core:screen` region for
  as long as they are up and paint through a surface clipped to it. The
  `term.clear()` allow-list is **20 pending, down from 30**; 33 sites across 16
  files, one of them the compositor's own frame.

  Each follows `showViewOnTerminal` exactly and not one painter's body changed:
  a `show`/`paint` split where the wrapper pushes and pops and the painter takes
  the clipped surface. The pictures are byte-identical — the whole existing
  suite for all three files passed unchanged — and what changed is that
  everything else on the display can see the erase happen. A screen still covers
  the terminal while it is open; a 4.2.6 screen is screen_save / full repaint /
  screen_load, and shrinking core's tombstone was declined again.

  **Three of the ten needed a seam moved, and each move is the kind that hides a
  half-done conversion.** `drawBirthSheet` is a shared painter with four
  callers, so it converts only because all four now hand it a region's surface;
  the name stage became `nameStage`, because its picture is a sheet PLUS a
  prompt that outlives the paint and `runBirth`'s state machine had no boundary
  meaning "this stage" — written inline, the push and the pop would have sat in
  two arms of a switch inside a `for (;;)`, which is precisely the shape a later
  edit drops one half of.

  **This opens no seam and gap 21 stays open.** A converted screen gives a mod
  nothing it could not reach before; it removes a reason the screen could not
  coexist with one.

  **A region surface removes the shell's `?.` safety net**, which is worth
  knowing before the next conversion. `selectFromMenu` calls
  `term.setCursor?.(...)` for the hand-written doubles that omit it;
  `clipSurface` always DEFINES `setCursor` and forwards to a host that may not
  have one, so the optional call finds a function and throws. That surfaced as
  `?` quietly not opening the help browser — the TypeError was swallowed by
  `openBirthHelp`'s own `.catch`, which is exactly the silent class of failure
  this whole task is about.

  `main-regions.test.ts`'s census is three values instead of one commented list,
  so "how many are left" is derived rather than recounted by hand, and a file
  whose sites claim to be regions must actually call `pushRegion`. The
  behavioural half reads the live stack through the shipped path at each stage,
  including the control that matters: a character sheet a PRESENTER has taken
  pushes nothing. The mod browser's four have no such test — there is no
  `ModBrowseDeps` fake in the repository and all four sites are module-private —
  so only the source guard covers them.

### Fixed

- **A bad line in a `%:`-included pref file no longer fails the file that
  included it** (#275). Upstream's `parse_prefs_load` is
  `(void)process_pref_file(...); return PARSE_ERROR_NONE;` — the cast to `void`
  is the whole statement, and a failure inside an include neither stops nor
  fails the includer. The port was returning `errors.length === 0` over a list
  that included the nested file's errors, so one bad line four files deep failed
  everything above it.

  A nested error also named the wrong file. Upstream's `print_error(path, p)`
  runs inside the inner call, so it names the INCLUDED path; the port named the
  outer file with the inner file's line number — the worst of both. Measured,
  not reasoned: pre-fix it printed `user/outer.prf line 1` for a fault in
  `inc.prf`.

  `PrefError` carries a `fromInclude` marker now, applied at the innermost read
  so two deep names the innermost file rather than whichever include it last
  passed through, and `prefErrorMessage` prefers it so a caller that forgets
  cannot exist. **Nothing is discarded** — upstream still reports those errors,
  and so do we; only the failure PROPAGATION changed. The marker is type-only,
  because core's export ratchet fails on additions and an interface is erased.

  This is parity restoration, so it lands in core unflagged and unmodded, unlike
  #272's forgiveness limit which was an improvement and left for `qol`.

## [0.19.0] - 2026-08-11

### Added

- **A mod can replace the map frontend.** `ModPlugin.frontend?(ctx)` selects
  one `WorldFrameSink`, with the later enabled mod winning by load order and
  lower candidates never constructed. The winner receives a frozen,
  structurally owned live-world snapshot; it cannot retain the mutable player
  grid, and a display fault is reported before the faithful glyph sink resumes.
  The public `WorldFrame` / `WorldFrameSink` types are available type-only from
  the mod SDK, and the CI fixture loads two real folders from disk to prove the
  later one receives the production frame while an unmodded control keeps glyph
  paints unchanged.

- The actual map repaint now invokes an extracted live world-data producer
  that produces a renderer-neutral `WorldFrame` and sends it through a single host `WorldFrameSink`:
  viewport geometry, player knowledge, semantic terrain/object/trap/monster/path
  layers, cursor state, and player placement. The Phase-4 control executes the
  same producer `main.ts` calls, checks the unmodded `GlyphTerm` sink's pre-frame
  glyph tuples, and proves an independent host sink receives that exact frame in
  the same call. This proves the host producer and
  unmodded glyph fallback only; a plugin cannot select or receive a front end until
  Phase 5, but that future consumer can use world data for an isometric or 3D
  view without parsing terminal characters.

- Menu screens are declarative at the shared `selectFromMenu` door. Each game
  menu has a stable non-localized id and semantic rows, and trusted mods granted
  `registry:menu` can layer a transformer with `handlerFor(id)`. A bad transform
  is reported and falls back to the unchanged menu, so a plugin cannot trap a
  player behind a failed screen.

- The web front end has one input door. All former per-screen browser keydown
  registrations now subscribe to it; keyboard and keymap input are normalized
  as device-neutral values, including continuous direction vectors and angles
  for a future controller/radial UI. A player's saved keymap is resolved before
  later input consumers only while the root owns input, preserving the existing
  modal, score-screen, and run-interrupt literal-key behavior.

- The web grid now renders through the renderer-neutral `GridSurface` contract.
  `GlyphTerm` remains the faithful canvas implementation; tile values are asset
  references rather than Canvas2D callbacks, and pointer, hit-test, readback,
  and resize capabilities are explicitly separated for later front-end plugins.

- **A record now says which mod it came from, and a savefile stores it.** The
  composer has always known - every composed record carried `owner` and
  `modifiedBy` - and the host threw both away one line later, when it flattened
  the composed table into the per-file record arrays the binders want. The cost
  was not bookkeeping: `ContentIdResolver` namespaces every id it mints, every
  caller left it at the default, and so **a monster a mod added was written into
  the savefile as `core:frost-wyrm`** - a claim, embedded in a player's save,
  that the base game defines a record it has never heard of. Turn the mod off
  and the save asks core for something core cannot supply, with nothing in the
  id to say who should have. Provenance now rides on the record itself under a
  reserved key, is read by the one helper all fifteen binders already call, and
  reaches the id: a mod's monster is `demo-modtest:modberry-slime`. A plugin can
  read it as `race.from`.
- **The order-dependent `-2` suffix in content ids is gone**, and it dissolved
  rather than being fixed. A mod that added a monster called "kobold" used to
  collide with core's and take a numeric suffix decided by which other mods
  happened to load first - a load-order-dependent string, embedded in a save.
  With each pack in its own namespace there is no collision, so the suffix is
  confined to core's own duplicate names, which are frozen data.
- **No save-format change and no version bump for any of it.** An id written by
  an older engine still resolves, because the resolver reproduces the old
  algorithm and consults it only when the exact id misses. It is the old rule
  run forwards, not a fuzzy match - "the same localid in any namespace" would
  hand back the wrong record precisely when two packs share a name.
- Mod-supplied fields (`ext`) now also reach bound `brand` and `slay` records.
  They were the two record types a savefile writes ids for that the extension
  census did not cover, so provenance would have reached every id but those two.
- **Localization is a first-class seam, and a translation is a mod.** English
  ships in the game and is what runs with nothing installed; a language arrives
  as a `locale` resource in a mod folder, through the same door as a sound pack.
  **A string table would not have been enough, and the reason is specific to
  this game**: Angband does not store the words it prints, it assembles them. An
  object's name leaves the describer as a pattern - `"& Scroll~ titled #"` - and
  the rules that turn that into "3 Scrolls titled xyzzy" are English's: `~`
  appends an s (or es after s, h and x), `&` becomes a or an by the vowel that
  follows, and the count goes in front. A translator handed that pattern and
  asked to replace its words cannot express a Japanese counter, a German case
  ending, or Polish's three plural forms; one handed the finished English
  sentence has already lost the count. So the layer has two halves. **Messages**
  are ids with the English written at the call site, filled through an ICU
  subset - chosen rather than invented, so a catalogue for this game is a
  catalogue in the ordinary sense that ordinary translation tools already edit.
  Plural categories come from the platform's own rules, so a Polish catalogue
  writes `few` and `many` and an Arabic one gets all six, and the game never
  learns what those are - `n === 1 ? a : b`, the obvious shortcut, is wrong in
  most of the world's languages. **Forms** are named functions a locale replaces
  outright, for the text that is composed rather than written; English's own is
  handed back so a translation can wrap it and special-case a handful of nouns
  rather than reimplement the whole grammar. A missing entry falls back through
  the region to the language to English, so a half-finished translation reads as
  part English rather than as a screen of blanks - which is the normal state of
  every translation there has ever been. **The terminal is a fixed grid**, which
  is a localization problem that is not about words at all: an ideograph occupies
  two cells and a combining accent occupies none, so measuring, padding and
  truncating now count cells rather than characters. **Nothing about the English
  game changed**, and that is measured rather than asserted: the golden set of
  object descriptions over the whole shipped pack is untouched. The bundled demo
  mod ships a pseudo-locale - readable English with accented letters and
  bracketed strings - which is both the from-disk proof in CI and the tool for
  finding what is left: anything still in plain ASCII on a screen is a string the
  code has not routed through the translator yet. Those remaining literals are a
  mechanical follow-up, not a gap in the seam.

- **A mod folder can now supply sounds, a font, pref files, help pages and the
  title screen - and every one of them is checked when it loads.** MOD_REACH's
  resource census counted seven categories a total conversion needs and found
  ONE reachable by a mod that is not compiled into the app. Six of the seven are
  now open; the seventh is UI strings, which needs an i18n layer to be supplied
  into and is a separate piece of work. A mod declares them in one `resources`
  array with a `kind` rather than through seven separate manifest fields:
  seven fields would each need their own validator, discovery pass, merge rule
  and conflict wording, and the eighth category would arrive to find no shared
  shape to join. `tilePacks` stays exactly as it is - it ships, and it carries
  three fields no other kind has. **Each kind landed with the thing that reads
  it**, because a manifest field with no reader is a promise: the sound pack
  goes into the engine that already existed and could only be aimed with
  `?sounds=`; the font goes into a `GlyphTerm` option that had been there since
  the terminal was written **with zero callers**, and could not have had one,
  since the sole construction site is at module scope and a mod's font is a
  fetch away; a `.prf` goes through the SAME ui-prefs.c grammar a player's own
  file goes through; a help page replaces one of the game's by id or adds its
  own; and the title screen is text, as upstream's `news.txt` is. The credits
  are appended to a mod's art rather than woven at the game's own row indices,
  because a twelve-row splash would never have reached row 20 and the Angband
  credit would have vanished without a word. **And the resources are checked
  before they are used**, in three passes, cheapest first: the declaration (an
  unknown kind, a path leaving the mod folder, an extension the kind cannot be,
  a slot no screen paints - and a slot on a kind that has none is REFUSED rather
  than ignored, because an ignored key is an author's belief surviving to ship);
  the mod's own file list, which catches a mistyped filename with no request at
  all; and finally the machine itself, which is the only thing that can say this
  build plays neither `.mp3` nor `.ogg`, or that a JSON that parses is not
  structurally a font. **A failed check costs the resource and never the mod** -
  a splash that will not decode is no reason to take a mod's records away - and
  it is never silent: the sentence lands on that mod's own row in the manager,
  because a resource that falls back quietly is indistinguishable from a mod
  that does nothing, which is the bug report no author can reproduce. Proven
  from real files on disk, including the bundled `demo-resources` mod, whose
  pref file is parsed in CI by the real grammar against the real registries -
  which caught its first draft naming a feature the way a player would rather
  than the way the parser does, so every line of it would have failed silently.
  Two more defects came from the tests rather than from review: the version gate
  at this door was being handed `engine` without `modApi`, so a code pack out of
  range would have been waved through here while the other doors refused it; and
  manifest normalisation dropped `resources` entirely, which is the third time
  that particular census has caught that particular mistake.

- **A mod's records are now checked when the GAME loads them, not only when its
  author builds it.** The SDK has said since it was written that a content pack
  is schema-validated, and MOD_REACH gap 12 recorded that as a claim with no code
  behind it. Half of that was wrong, and the wrong half is the one worth keeping:
  the checker was fully built - 4,630 lines of field shapes, types, ranges and
  required-ness MEASURED from core's own 3,279 shipped records rather than
  hand-written - exported, and thoroughly tested. Its only caller was
  `ModProject.build`, **the mod builder**, a tool nobody but the author runs. A
  mod installed from a zip, hand-edited in the mods folder, or produced by any
  other tool had never been near it. So what a player got for a mistyped field
  was the failure this whole channel exists to prevent: the mod loads, the record
  composes, nothing complains, and the monster does not appear. The builder and
  the loader now call ONE function (`packages/mod-sdk/src/validate.ts`) and cannot
  disagree about what a mod is answerable for, and the lines land on that mod's
  own row in the manager. Four decisions carry it. A patch is checked as the
  record it PRODUCED, because a patch body is `{"speed": 120}` with none of the
  twenty fields every monster has, and checking patches as written would put a
  required-field error on every legitimate patch in existence. The base game is
  not reported on: core's own data raises 65 warnings against core's own
  blueprint - almost all upstream warts the port keeps on purpose - and putting
  those on a screen at every boot, with no mods installed, would bury every real
  line. Drafting advice stays in the builder, where the author is looking at the
  draft. And a finding **costs nothing** - not the record, not the mod: a
  blueprint is a measurement rather than a specification, and a mod coining a new
  tval or slay code is doing something legal, so taking the mod away over a
  statistic would punish exactly the experimentation the mod system exists to
  allow. Proven through `diskPackStatus()`, the reader the manager calls, with
  both silences measured as well as the noise: core alone says nothing, a
  well-formed mod says nothing, and deleting the one line that maps findings onto
  rows fails exactly the three assertions about reach. **Running it corrected one
  of our own tests**: a bare `{name: "Survivor Hound"}` had been standing in for
  "the forty records that ARE fine", and it drew four warnings of its own.
- **A broken mod cannot blank the screen at boot, and that is now RUN rather than
  claimed.** The mechanism has been in place for a while: `composition()`
  (`packages/web/src/pack.ts`) calls `composeDroppingBroken` and not
  `composeContentPacks`, with a comment at the call site naming this exact
  failure. What was missing was evidence about the BOOT. `composeDroppingBroken`
  having its own tests proves a function behaves; it says nothing about whether
  the host's chain - manifest normalisation, the engine gate, section resolution,
  the bundled globs, the composer - gets a player to a screen. The cost of being
  wrong is not a bad message: it is no canvas, so no mod manager to open and no
  way to turn the offending mod off short of clearing localStorage, which also
  destroys the player's saves. Twelve cases now drive the real readers
  `main.ts` calls: a mod with a missing dependency, two of them at once, and a
  hard cycle each leave the base game composed, the offender dropped and named,
  and its namespace absent from the present set - which matters beyond cosmetics,
  because that set is what `loadGame` reconciles a save's mod-lifecycle blocks
  against. A good mod loaded beside a broken one survives, which is the greedy
  fallback a coarser implementation would pass everything else with. **Two
  corrections came out of running it.** The gap row's own closing condition -
  "install a mod with a bad patch ref" - was stale: a patch whose target does not
  exist stopped throwing when the composer gained its `onRefuse` reporter, so it
  now costs the patch and gets a line. What still throws is `resolveLoadOrder`, a
  statement about the whole enabled SET, where dropping a pack is the only move
  that makes the rest loadable. And `discoverMods` reads `pack.manifest.id`
  unguarded one layer earlier than the composer - which cannot fire, because both
  producers of a pack report validate the manifest inside a `try` and drop the
  folder on a throw. **No guard was added there on purpose**: it could never fail,
  and a check that cannot fail reads as protection while being the reason nobody
  re-asks the question. The invariant is proven at the producer instead.
- **A mod can teach the game a whole new kind of RUNE: `registry:rune`, and the
  switch census is now at zero candidates.** A rune is the unit of object
  knowledge - what the player learns, what an item is found to carry, what the
  recall screen names and describes. Six places in `obj/knowledge.ts` decided all
  of it, and **five of them were a harder closure than any switch the census has
  recorded**: they dispatched on `rune.variety`, a **closed TypeScript union of
  seven string literals**. A switch has a `default` arm a mod's key reaches and
  fails at, which is at least somewhere to stand. A union refuses the key at the
  type level, so a mod could not coin a variety at all and no arm was ever
  reached. The census saw **one** row here - `modMessage`, 11 cases on OBJ_MOD,
  the only OBJ_MOD switch in a tree with 114 `OBJ_MOD.*` references, so a
  mod-coined modifier was learned in silence. The five `rune.variety` switches
  each sat under its eight-case threshold, and it counts neither a union type's
  existence nor its size at any threshold. Same lesson as `registry:tval` the
  same day, in a new shape: **the census measures syntax; a gap is about reach.**
  What each unregistered key cost: no description, never found on an item, never
  knowable, never learnable - and unknowable *and* unlearnable together is worse
  than either alone, because `objectRunesKnown` then held every object carrying
  one permanently un-assessed. `RuneRegistry` (`obj/rune-registry.ts`) is six
  tables plus a **producer**. The producer is not an extra: nothing in core ever
  asks about a rune that is not in `buildRuneList`, so six handler tables with no
  way into that list would have been a seam every caller walks past - the failure
  three of the five previous conversions each turned up somewhere different.
  Where a mod's rune KNOWLEDGE lives was the question that made this conversion
  unlike the four before it, and the answer is that core needed no new store:
  `knows` and `learn` are handed the player, and a mod keeps its own per-entity
  values in its own `VocabularyRegistry`, which already persists into that mod's
  save bag. One mechanism, not two. **99 golden runes** across all seven
  varieties and **both signs of all 16 modifiers**, recorded before the registry
  existed, replay identically; there is no RNG on these paths and that is
  measured rather than assumed. A caller hole fell out of the type change and is
  fixed: `runeGroupIndex` in the knowledge browser was exhaustive by construction
  over the closed union and needed no `default`, so a mod's rune would have been
  silently **dropped from that screen** - learnable, describable and invisible.
  It now lands in "Other", upstream's own catch-all group. The census is down to
  **34 switches, 463 case labels, and zero candidates**, from 47 / 723 / 18 on
  the morning of 2026-08-09. Zero candidates is the end of what that tool can
  see, not the end of closed dispatch in the tree - `docs/modding/MOD_REACH.md`
  says so in the same breath, and the 108 raw `tval === TV.X` comparisons are the
  standing example.
- **A mod's item class has a NAME now, instead of being called "(nothing)".**
  `obj_desc_get_basename` is a 34-case switch on tval holding the base-name
  template for every item in the game - `"& # Potion~"`, `"& Scroll~ titled #"`,
  `"& Book~ of Magic Spells #"` - and its default arm returns the **literal
  string `"(nothing)"`**. So a mod-coined item class was not merely unnamed:
  every message, menu row, shop line and object-recall header that mentioned it
  read *(nothing)*. It is now a fourth table on the same `registry:tval`
  capability, because naming is a property of the item class and splitting it
  out would make an author declare two capabilities to do one thing. **2,358
  golden descriptions** - 393 kinds across six axes, read out of the real
  `objectDesc` before the registry existed - replay identically, and a mod
  folder on disk now produces *"the Relic of Strength"*: the template is the
  mod's, the article and the `of <kind>` tail are `obj-desc.c`'s. Two findings
  while recording. The grid first reached only **31 of the 34 arms**: upstream
  4.2.6 defines no book in `object.txt` - `registerBookKinds` synthesises them
  from `class.txt` - so the five book templates were never exercised, and the
  fixture now calls that real producer. And `desc.ts:391` compared
  `obj.tval === TV.SCROLL` directly when `tvalIsScroll` already existed and was
  exported; that one line went around the class predicates the rest of the file
  uses. The wider version of that - 108 raw `tval === TV.X` sites across core
  and web - is now tracked separately. The census was down to **35 switches, 473
  case labels, and a single candidate** (`obj/knowledge.ts`) at this point; the
  entry above is that candidate closing.
- **A mod can teach the game a whole new KIND of item: `registry:tval`.**
  `object.json` has always accepted a new record, so a mod could always ship a
  new *item*. Making core recognise a new item **class** - a tval - was a
  different thing, and **the switch census could see almost none of it**. The
  census counts `switch` statements; `obj/object.ts` exports **34 class
  predicates** ported from `obj-tval.c`, and the 29 written as
  `tval === TV.STAFF` are exactly as closed to a mod as the 5 written as
  switches. **408 call sites** ask these questions and a mod-coined tval
  answered **no to all of them**: its items were not weapons, could not be worn,
  could not be flavoured, could not be browsed as a book, had no charges and no
  timeout. Two dispatches beyond the predicates: `kindIsGood`, so a new class
  could never be good on the strength of its own plusses, and `objectValueBase`,
  whose `default: return 0` means a shop shows an unidentified item of an
  unknown class as **worthless**. `TvalRegistry` (`obj/tval-registry.ts`) is
  three tables, and the class table is **keyed on the exported predicate's own
  name** - `handlerFor("tvalIsWeapon")` hands back core's arm so a mod ORs one
  tval into it rather than reimplementing the whole base game's answer.
  `tval-registry.test.ts` derives its expectations from the module's own
  exports, so a predicate added later and forgotten fails instead of silently
  answering `false` forever, which is exactly the failure this removes. **1,224
  golden answers** (36 tvals x 34 predicates - the complete cross product, not a
  sample, because these are pure functions of one small integer) and **389 real
  object kinds** through both dispatches, all recorded before the registry
  existed, replay identically. There is no RNG probe and that is measured:
  nothing on these paths draws. Also corrected here: those five census rows had
  been filed under "object naming / description" through four re-measurements -
  a verdict can have the right *class* and the wrong *subject*, which is why the
  census test stayed green over the whole error. The census is now **36
  switches, 507 case labels, 2 candidates** - down from 47 / 723 / 18 at the
  start of the day.
- **A mod can build a random artifact power core has never heard of:
  `registry:randart`.** `artifact.json` has always accepted a new record, so a
  mod could always ship a *fixed* artifact. The RANDOM artifact generator was
  closed: four switches decided every property a randart can have, and each
  failed silently in a different direction. The worst is `add_ability_aux`, 87
  cases and **the largest dispatch in the tree** - its default arm is a bare
  `break`, so a mod-coined ability index cost the design loop its power budget
  and gave the artifact nothing at all, with no error and no way to find out
  except generating a few hundred artifacts and staring at them. The other
  three: `artifact_prep` (15 tvals) gave an unlisted item class zero to-hit,
  to-dam and AC; the item-class census (14 tvals) dropped it into `otherTotal`,
  which skews the frequency table the design loop **spends** and so changes what
  every randart in the game becomes; and the redundancy test (9 `EFPROP` kinds)
  could not judge a new property kind. `RandartRegistry`
  (`obj/randart-registry.ts`) is four tables under three keys - the ability
  index, the tval, the `EFPROP` kind - with `handlerFor` so a mod WRAPS core's
  arm rather than reimplementing it, which matters more here than almost
  anywhere: an ability that draws a different *number* of random values moves
  every artifact generated after it. One change beyond the switches was needed
  to make any of it usable, and it is the same class of trap the effect-info
  seam nearly shipped with: `addFlag`, `addMod`, `addResist` and the dozen other
  primitives a handler body is written from were exported from
  `randart-build.ts`, but that module was never re-exported from core's index,
  so **none of them were in `ctx.core`** - a mod could register a handler and
  had no way to write it. All 834 randart vectors replay identically. The switch
  census fell from 42 rows to **38** (531 case labels, 9 candidates left), and
  `switch-census.test.ts` fails if any of the four comes back.
- **Random artifacts got the evidence a refactor needs, before the refactor.**
  The four switches that build every random artifact - the 87-case
  `add_ability_aux`, the item-class `artifact_prep`, the item-class census that
  feeds the frequency table, and the activation-redundancy test - are the
  largest dispatch left in the tree, and they are next to become registries
  (MOD_REACH gap 14). What defended them until now was a determinism test that
  runs `do_randart` twice in one process and compares, which is a real property
  and *cannot fail across a refactor*: a change that moves every artifact moves
  both runs identically. `randart-vectors.json` records **834 vectors** on disk
  instead - three whole artifact sets field by field, every `ART_IDX` ability at
  two seeds and two target powers, every item class through `artifact_prep`, and
  the frequency census - each per-arm vector carrying an **RNG probe**, because
  a changed draw count is invisible in the artifact and diverges everything
  after it. Two holes were found and closed while recording: the artifact
  fingerprint serialised the flag set as `"[object Object]"` in all 644 rows of
  the first take, so an ability that stopped granting its flag would have moved
  nothing; and the grid ran at one target power of 100, below the 300 threshold
  `WEAPON_AGGR` and `NONWEAPON_AGGR` need to do anything at all, so those two
  arms were recorded as no-ops indistinguishable from the indices that genuinely
  have no case. Control: adding a single throwaway `randint0` to one ability -
  changing no artifact field whatsoever - fails the replay and names
  `BOW_MIGHT` and its probe.
- **A mod's effect can finally SAY what it does: `registry:effect-info`.**
  `registry:effect` has always let a mod register a handler for a brand-new
  effect code and have it work. What no mod could do was let the game describe
  it, because five closed switches stood between an effect and every word the
  player reads about it - the menu-row builder and `effect_describe`'s body
  (both keyed on the `EFINFO_*` flag, 20 cases each), the activation-property
  summary walker (12), `effect_subtype`'s named-subtype decoding (9), and
  `requestForEffect`, which decides which item an effect prompts for (8). Sixty
  nine cases, and the failure was silent in all five directions: a **blank row**
  in the activate and cast menus, **nothing at all** in object recall, an
  activation that could never be recognised as duplicating an intrinsic
  property, an effect that accepted no named subtype (only a bare integer), and
  an item-consuming effect that could not ask for an item.
  `EffectInfoRegistry` (`effects/effect-info-registry.ts`) is four tables under
  three keys - the `EFINFO_*` flag, the effect code, the effect index - and
  `handlerFor` hands back what is installed right now, so a mod WRAPS core's
  description instead of reimplementing a sentence that is a projection name, a
  radius, a dice string and a device-skill damage tail. Two changes beyond the
  switches were needed to make any of it reachable: `describeEffect` used to
  skip a mod's effect on its `edesc === null` branch before the registry was
  ever consulted, and `itemTargetRequest` skipped a string effect code outright.
  A seam its own callers walk past is not a seam. **11,530 golden vectors**
  recorded from the code BEFORE the registry existed - every one of the 112
  effects across five subtypes, three dice shapes, two radius/other shapes and
  two device-skill boosts, every TMD name through six activation arms, and every
  effect index against 25 subtype names - all replay the exact same strings.
  There is no RNG probe here and that is measured, not forgotten: this path
  substitutes `Dice.randomValue()` for upstream's `dice_roll` at every site
  precisely so that rendering a menu row cannot perturb the stream, so there is
  no Rng to probe and the text is what is at risk. The switch census fell from
  47 rows to 42, and `switch-census.test.ts` now fails if any of the four files
  comes back.
- **A mod's vault can use a symbol core has never heard of: `registry:glyph`.**
  `vault.json` and `room_template.json` have always accepted a new record, so a
  mod could always ship a vault - but only one drawn with the symbols the two
  decoders already knew, because those were three closed switches
  (`gen-room.c` L1195, L1445, L1523; 16 + 13 + 23 cases). A symbol they did not
  know became plain floor: no error, no effect, and no way for an author to find
  out except by staring at the level. `GlyphRegistry` (`gen/glyph.ts`) is keyed
  by decoder and character, with the two passes upstream actually runs -
  `terrain`, then `populate` once the room's walls exist - and `handlerFor`
  hands back what is installed right now, so a mod WRAPS core's `%` (which also
  records an entrance) instead of reimplementing it. The two alphabets stay
  separate because upstream's are: `+` is a closed door in a room template and a
  SECRET door in a vault. The glyphs upstream accepts and ignores (`9` in a
  template's first pass, `/` and `;` in a vault) are registered as explicit
  no-ops, so listing the alphabet reports the real one.

  What proves it: **5,994 golden vectors** recorded from the code BEFORE the
  registry existed - every room template and every vault of the shipped pack,
  plus four synthetic ones spelling out the glyphs the pack does not use, at
  three seeds and three depths - replaying the whole chunk, every object,
  monster and trap placed, and a probe draw that catches a changed *number* of
  random values even when the level looks identical. The depth list carries a
  127 because the first control run broke a vault's `>` and PASSED: with only 5
  and 60 in the grid, the dungeon-bottom arm was never reached, so the control
  was measuring nothing. A separate assertion now fails if any glyph core
  registers is missing from every scenario. Reach is proven from disk
  (`mod-code.node.test.ts`) by a real mod folder shipping a vault with a `Q` in
  it, asserted on the chunk rather than on the registry - and the BEFORE picture
  is kept as a test beside it, so the seam's value is measured rather than
  claimed.

- **The moddability gap list has a denominator nobody maintains by hand.**
  `tools/switch-census.mjs` counts every `switch` of 8 or more cases in the
  source tree - **51 switches, 794 case labels** when it was written, **47 and
  723** now that the projection family and the glyph decoders have become
  registries - and records them in `tools/switch-census.json` with a
  hand-written verdict saying what a mod can do about each.
  `packages/web/src/switch-census.test.ts` fails when the tree and the manifest
  disagree, so a switch that is *added* can no longer slip past a list that only
  ever gets smaller as things are converted - and, since the glyph conversion,
  a switch that is *removed* is named too, so a conversion cannot be claimed
  without being made. It is deliberately
  syntactic and does not know what a switch dispatches on, because a tool clever
  enough to decide which switches "matter" is a tool that could decide a new one
  does not. Control run: dropping a new 8-case switch into the tree fails the
  census.
- **`project_p` is a registry, and the projection family is complete.** The
  21-case `switch (ctx.typ)` in `game/player-side.ts` was the last of the three
  - `project_f` (37) and `project_o` (11) went the day before - so a mod's
  projection reached terrain and objects but not the player, which is the half
  that matters. `PLAYER_SIDE_HANDLERS` is keyed by projection `code` exactly as
  the other two are. This one was a real refactor rather than a lift: the arms
  read ten helpers built per game and one, `incCheck`, reads a source monster
  stamped per projection, so `PlayerSideCtx` makes that toolkit explicit and the
  arms become ordinary top-level functions. **6,912 golden vectors** were
  recorded from the switch first and replay identically against the table -
  every message, both stat arrays, exp/mana/energy, where the player ended up,
  the pack, the worn gear, and one rng draw taken afterwards. That last field is
  not decoration: the control run added a single discarded `randint0(2)` to
  INERTIA, which changed no visible value at all, and only `rngProbe` caught it.
  A second control swapped FIRE and COLD in the table and failed four groups by
  name.
- **The vectors were unable to fail, twice, before they could.** The first
  recording ran 2,304 scenarios in which the pack was never damaged, worn gear
  never disenchanted, `minus_ac` never bit and every teleport reported failure -
  four whole handler arms captured as dead code. All four causes were in the
  fixture: `object_prep` ORs the object BASE's `el_info` in, so selecting kinds
  by the kind's own flags found nothing that hates acid; `minus_ac` and
  `disenchant_equipment` pick a slot BY TYPE, so a suit of armour in slot 0
  (WEAPON) was invisible to both; a 40x25 harness field has nowhere to put a
  200-grid teleport; and the harness builds at depth 0, the town, where
  `teleport_player_level` has no UP to choose. The second recording still had
  NEXUS's 1-in-4 teleport-level arm empty in all 96 of its rows, because NEXUS
  reads neither `dam` nor `power` - so the rest of the grid collapsed onto two
  rng streams. Six seeds, not two. Each of those arms now has an assertion that
  fails when the fixture stops reaching it.
- **The projection registries have a producer: `registry:projection`.** For a
  day, `project_f`, `project_o` and `project_p` were keyed registries whose
  override field - `env.featHandlers`, `env.objHandlers`, `deps.playerHandlers`
  - was READ by the engine and WRITTEN by nothing, and `MOD_REACH.md` recorded
  two of the three as reachable on the strength of the field existing. Now
  `wireGame` builds one `ProjectionHandlerRegistry` per game
  (`game/projection-handlers.ts`), seeds it with core's 69 handlers, publishes it
  on `GameState.projectionHandlers`, and hands the engine the LIVE Maps - so a
  handler installed by a plugin's `register()`, which runs after the wiring, is
  dispatched to on the next projection. Per game, never module-level, for the
  same reason as the blow and store registries.
- **Composition is per projection CODE, so one mod can extend another's.**
  `host.projections.feat` / `.obj` / `.player` each take one code at a time, and
  `handlerFor(code)` hands back whatever is installed at that moment - core's
  handler, or an earlier mod's - so mod B wraps mod A's WATER exactly as mod A
  wraps core's. A whole-table override cannot do that: the second mod to hand
  one over would discard the first, along with its brand-new projection, with no
  error anywhere. Proven twice, because "installed" and "consulted" are
  different claims - a mod folder on disk writes the table and the real
  `projectFeature` runs over it (`mod-code.node.test.ts`), and a real game fires
  a real projection through `wireGame`'s own `CastContext`, with a control run
  first that watches core's handler do core's job
  (`session/projection-registry-wiring.test.ts`).
- **Fixed: every `project_p` message was dropped in the live game.**
  `PlayerSideDeps.msg` is optional, and `wireGame` never supplied it - so "You
  resist the effect!", "The intense heat saps you.", "Your eyes fill with
  smoke!", all thirty-odd lines the 21 arms print, and every timed effect's own
  message with them, went nowhere. The outer "You are hit by fire!" comes from a
  different hook and arrived, which is what made the seam look wired. Every
  harness that exercised the arms supplied `msg`; the one caller that matters
  did not. Found by a mod handler calling `ctx.msg` into silence, and now
  guarded by a test that was watched to fail without the fix.
- **Fixed: `project_o` was dispatched without the bound projection table.**
  `castProjection` merged `cctx.projections` into the env it gave the terrain
  hook and handed the object hook the raw one, so a mod's own projection - whose
  code only the bound table can resolve - burned terrain and left floor items
  alone, silently. Both hooks now take the same env.
- **All 50 censused switches are adjudicated, and only 21 are moddability
  gaps.** The backlog started at 36 rows nobody had looked at. Each was read -
  discriminant and case labels - rather than guessed at, and classified into a
  **closed vocabulary**: 21 `CANDIDATE` (content dispatch a mod would want), 12
  `UI` (menu and keypress routing), 6 `PARSER`/`HOST` (the dice grammar, the
  `lore.txt` directives, CLI flags, the host RPC - deliberately closed, since a
  mod changing dice syntax would invalidate every record in every pack), 3
  `LOCALIZATION`, 3 `CONTROL FLOW`, 2 `INTERNAL`, 2 `DEBUG`, 1 already
  `REACHABLE`. The class counts are asserted in the test, not described in a
  document, because a typo'd class (`CANDIDTE - `) would otherwise drop a row
  out of the candidate count without failing anything - which is exactly what
  the control demonstrates. Reading them surfaced **three dispatch points
  `MOD_REACH.md` had never listed**, now rows 26-28: the three room/vault
  template glyph decoders (a mod can ship a vault, but only using glyphs core's
  decoder already knows), `project_p`'s 21-case player side effects (the one
  member of the `project_f`/`project_o`/`project_p` family still a switch, so a
  mod's projection reaches terrain and objects but not the player), and `tval`
  dispatch in object generation and pricing. The verdict gate is no longer a
  ratchet with slack in it - the backlog reached zero, so a new switch now has
  to be adjudicated before the build is green.
- **`project_o`'s 11-case switch is a registry too** (`PROJECT_OBJ_HANDLERS`,
  `ProjectWorldEnv.objHandlers`), so a mod's projection can destroy objects the
  way `FIRE` does. Proven by an **exhaustive** recording rather than a sampled
  one: `project_object_handler` is pure - `(typ, obj)` in, `{doKill, ignore,
  noteKill}` out, no rng - so every projection against every element/flag
  combination is a finite table. 56 codes x 208 objects = **11,648 rows**,
  recorded from the switch before it was touched and replayed after. Control
  run: swapping PLASMA's two `elemental` calls fails it. `KILL_TRAP` stays out
  of the table because `projectObject` handles the chest unlock ahead of the
  dispatch, and that exception is now asserted rather than implicit. The
  PROJ-value-to-code resolver is shared with `project_f` rather than copied,
  because two copies would be two things to keep in step and only one would get
  fixed.
- **`project_f`'s 37-case switch is a registry keyed by projection `code`.**
  `PROJECT_FEAT_HANDLERS` maps a code to a `ProjectFeatHandler`, and a caller
  passes its own table through `ProjectFeatEnv.featHandlers` - so a mod can give
  its projection a terrain effect, or replace `KILL_WALL`'s. **Keyed by code,
  not by the `PROJ` number**, which is the point: a `PROJ_` value is an index
  into a compiled-in enum and a mod's projection is appended past the end of it,
  so its number depends on what else is installed. Its `code` is the identity
  the record declares, and the same string composition keys `projection.json`
  by. `castProjection` now threads the bound table into the env once per cast so
  a new code resolves. Every code core ships is registered, **including the 24
  whose upstream arm is empty**, so the table states the whole switch rather
  than leaving arms to a catch-all - `project-feat-registry.test.ts` asserts
  that in both directions against the bound projection table, and asserts the 19
  that are deliberately absent. Proven unchanged by replaying the 6,552
  committed vectors in `project-feat-vectors.json`; control run, dropping
  `PLASMA` from the table fails both the vectors and the registry test.
- **A mod can ADD a projection, and adding one no longer takes the game down.**
  `bindProjections` resolved every record's `code` through the compiled-in `PROJ`
  enum and threw `projection: unknown code X` for anything else. Composition
  merges `projection.json` per record (keyed by `code`), so a mod's projection
  reached the bind intact and then killed it - the one content change that
  crashed rather than being ignored. Unknown codes are now appended after the 56
  compiled-in slots, in record order, which is the rule objects already get:
  core is pack zero, so every index below `CORE_PROJECTION_COUNT` is exactly
  where upstream's enum says it is. Asserted over the WHOLE table, not a sample -
  binding core with and without an added projection leaves all 56 slots
  identical by index and code. Two things are still refused because they would
  break core rather than extend it: a new `type: "element"` (the first 25 slots
  are `list-elements.h` and `el_info[]` is indexed by ELEM value, so a new
  element would be one the player could never resist), and a `code` that is not
  a plain own property of the enum - `code: "constructor"` used to resolve
  through `Object.prototype` and bind at index `function Object()`, which was
  unreachable until a mod could supply the code.
- **A mod can ADD an object, an ego item or a vault.** Those three files - 375,
  107 and 162 of the base game's records - merged whole-file only, so a mod that
  added one new weapon replaced every object in the game. The cause was one
  condition: composition keyed records by `slugify(name)`, and core's own names
  collide under it, because Angband's convention for a greater form is the same
  name with a mark (`Acquirement` / `*Acquirement*`) and `ego_item` ships 23
  names twice. Composition now keys by `recordRefKeys` - the per-file identity
  `record-key.ts` already declared, already spelled the marks out for, and
  already proved unique across the shipped pack. **41 of the 44 record files now
  merge per record, up from 24**, which also means a mod can add a store, a
  flavour, a brand, a slay, an object base, a trap or a random-name section.
  Measured against the real pack, not a fixture: `object` 375 -> 376. And
  measured through CORE's binder as well as composition's merge, because
  upstream's `sval` is a counter over file order rather than a field in the
  data: `mod-added-record.test.ts` binds the pack with and without one added
  object and asserts every one of core's kinds keeps its index, name, tval and
  sval, with the new one taking the next free sval of its own base.
- **`ProjectBuild.composed`** - the game as it comes out of composition, so an
  author can answer "did my record land, and did the base game survive it"
  without reading their own input back.

- **Authoring shortcuts, measured from core's own data.** `draftRecord("object",
  {name, type: "sword", level: 20}, core)` now returns a complete record - cost,
  weight, to-hit, `alloc` and graphics taken from core's own level-20 swords -
  together with the evidence for every number it chose and a list of what is
  still wrong with it. A price is not derivable from first principles, but it is
  derivable from precedent, and precedent is what core's 375 objects are. The
  shape is MODELLED on the nearest comparable record rather than assembled from
  file-wide field frequency, which produced a sword carrying an `armor` block
  because 59% of core's objects have one; a model never lends `flags`, `slay`,
  `brand`, `effect` or `values`, because a template that quietly grants powers
  hands an author an item that does things they never asked for. Every step is
  separately callable: `describeFile`, `requiredFields`, `fieldUsage`,
  `templateRecord`, `peersFor`, `suggestFields`. See `docs/modding/AUTHORING.md`.
- **`checkRecords`: every way a new record will silently do nothing, named.**
  A required field absent (`error`), a reference that names nothing, a field
  written as the wrong type, a missing `alloc` so the item never generates
  (`warn`), a misspelled field name with a "did you mean", a monster with
  nothing to attack with (`hint`). Plus the one nobody thinks of: Angband hands
  each object of a flavoured type its own flavour, and a mod that pushes a tval
  past its flavour supply makes some other item indistinguishable when
  unidentified - counted from the composed data, so a mod that adds flavours as
  well as objects gets the credit. Nothing here refuses anything; the refusals
  live where the rules are the engine's own.
- **A declared, measured reference graph.** `REFERENCE_EDGES` names 37 fields
  that point at another record - `object.type` into `object_base`,
  `monster.base` into `monster_base`, `ego_item.slay` into `slay`, and so on -
  and every edge is run over core's 3,279 records by its own test, so a wrong
  edge is a test failure rather than a false alarm in somebody's mod. References
  resolve against core PLUS the mod's own new records. An unresolved reference
  is a warning and never a refusal, because core's own data contains some:
  `artifact.txt` writes `soft armour` where `object_base.txt` and `list-tvals.h`
  write `soft armor`, and fourteen artifact base objects name svals `object.txt`
  never defines. Both are upstream 4.2.6's, reproduced exactly, and both are
  pinned by count so the exceptions cannot quietly grow.
- **`ModProject`: a whole mod assembled, composed and checked before it is
  written.** `modProject(manifest).declareField(...).add(...).patchFields(...)
  .build(corePack)` returns the mod folder's bytes, composition's own refusals,
  and the findings - measured on the COMPOSED result, because a patch that
  breaks a reference is invisible in the mod's own files. It touches no
  filesystem, so the same builder works from a CLI, a test, or an in-game
  editor, and it reports a missing dependency as a finding rather than throwing.
- **`RECORD_BLUEPRINTS`**, generated from the shipped pack: per record file, per
  field (nested fields and array elements included), how many of core's records
  carry it, which JSON shapes it takes, the range its numbers span, and the
  vocabulary its strings use where there is one. Derived rather than declared,
  for the same reason `CORE_RECORD_KEYS` is - and asserted to agree with it,
  file for file, since the day those two generated tables disagree is the day a
  field is an extension at one end and a core field at the other.

### Changed

- **"Genuinely not ported" said 36 things were missing; 3 were.** The section of
  `parity/DEFERRALS.md` that answers "so what does upstream do that we don't" was
  dated 2026-08-04 and had not been touched since tasks #114-#121, #131 and #132
  closed. Re-read against the code, item by item: **33 of 36 claims were already
  false.** Two were inverted rather than merely stale — the section's most
  alarming play-affecting row said `square_isempty` was weaker than upstream's at
  48 call sites and therefore moved RNG draws, and in fact the weak predicate had
  been *deleted* (`game/context.ts:1257`), the faithful `squareIsEmptyLive` in
  `game/mon-place.ts` had replaced it, and the generation-time pair in
  `gen/util.ts` was faithful all along, so the RNG claim was never true either.
  Another said `monSpellLoreDamage` returns 0 and omits upstream's `(N)` at every
  monster spell, where `mon/lore-describe.ts:440` computes the real
  `mon_spell_dam` by default: an unsupplied optional with a working default is
  not an unreachable feature. What survives is three items and one undecided
  question, now the whole of the section. The closed rows are struck through
  rather than deleted, each naming the call site or test that closed it, because
  a correction that leaves no trace invites the same claim to be re-derived — and
  the appendix below the section has NOT had this treatment yet, which the
  document now says in its own header.
- **The one stranded level that did not look like upstream's is upstream's, by
  a second mechanism.** d40 seed 400792 had been held apart since 2026-08-07 as
  the only stranding in 27,000 generated levels whose sealed staircases were not
  vault grids - the shape that would have meant the port, not Angband, failing
  to connect a dungeon. It is neither. `join_region` may *search* through a
  vault grid but refuses to *dig* one (`gen-cave.c:1925`, and the port's
  `joinRegion` line for line), so a crossing whose only route was through a
  vault wall is recorded as joined and left physically holed. Instrumenting the
  dig loop named the single refused grid, (94,38), on the boundary of the
  385-grid region that holds all three of that level's down staircases.
  `notUpstreamStranding` now recognises both routes from the finished level with
  no hook in the generator, the seed has moved into the pinned `STRANDED` set,
  and the classifier's new arm is held to a pair of synthetic levels identical
  but for one boundary grid's vault flag - so an arm that stopped
  discriminating, and started forgiving real connectivity defects, fails.
- **The three record files that still take a whole file, and why.** `constants`
  and `visuals` are config singletons: the file IS the identity, the host binds
  one, and shipping the file means "use mine". `history` has no per-record
  identity at all - a history record is `{chart:{chart,next,roll}, phrase}` and
  every part of it is a value a mod would legitimately change.
- **No ref that resolved stopped resolving.** The 19 files that moved out of
  whole-file merging keep the refs per-record ops already used
  (`core:sword--dagger`, `core:of-acid#shot-arrow`, `core:store-general`); for
  the 24 that already merged per record the key differs from the old
  `slugify(name)` only where a `*` or `+` appears in a name, and the old form is
  registered as an alias - dropped only where it would shadow a different
  record's real name, which is `*Healing*`'s legacy ref against plain `Healing`.
  That is **8 of the pack's 19 legacy aliases**, and it turns on core's data
  rather than on the mark: `*Acquirement*` loses its alias because a plain
  `Acquirement` exists, `*Destruction*` keeps both of its because no plain
  `Destruction` does. The census is asserted row by row over the shipped pack,
  and the shadow rule's own reachable case - a pack declaring the starred form
  first whose plain record is later removed - is tested with a fixture, its
  control run.

- **The working record left the public tree.** 218 files of construction notes,
  audit ledgers and planning material moved into a private repository. What
  public code *cites* stayed - the parity ledger behind the parity claim, the
  accounting those citations resolve to, and the machinery guards actually
  execute - because a comment citing a document the reader has is provenance,
  and the same comment citing nothing is an excuse. `docs/WORKING_RECORD.md`
  says which citations lead where and what they concluded.

- **`reference/` is the 4.2.6 tag, and something checks that it is.** The vendored
  upstream tree had drifted onto master; it is back on the official baseline with
  a guard, and four unowned Windows binaries are gone from the public tree.

- **The tiles the game serves are 4.2.6's, and are stored once.** The served tree
  had been built from upstream master, and twenty megabytes of tiles were
  committed twice; the served copy is now generated.


- **An imported mod zip is moved aside, not deleted.** It used to be unlinked once
  the mod was in storage, which is tidy and wrong: the zip is the player's copy of
  somebody else's work, and making the game's copy the only one leaves a player
  with nothing to go back to when a mod turns out to be broken. It now moves into
  `mods/imported/`, numbered rather than overwriting so importing v2 cannot destroy
  the archived v1, and the screen names where it went. The folder is skipped when
  the shell lists mod folders, so it never appears in the mod list as an empty pack.

- **Every mod is listed with its author: `Neo Linoleum (neostryder)`.** Who wrote a
  mod is the most useful single fact about a third-party one, and it used to be a
  line in a detail pane you had to open per row. It comes from the MANIFEST, never
  from the author register - the register is a standing this project has looked at,
  and the two must not be able to be read as each other. Where a row cannot fit
  both, the author is dropped whole rather than truncated: `Bug Fixes (neost...`
  attributes a mod to an account that does not exist.

- **A host directory is created on its first write, not at startup.** `save/`,
  `panic/` and `scores/` sat empty in every game folder for the life of an install,
  because the port creates all five `ANGBAND_DIR_*` at launch exactly as
  `init.c:411` does. Upstream carries the answer as its own comment - *"ToDo: Only
  create the directories when actually writing files"* - and that is now what
  happens. It is not a behaviour divergence: no caller can tell an absent directory
  from an empty one, since every reader already answers for a directory that is not
  there. The desktop shell's startup writability check is unaffected, so upstream's
  quit-rather-than-run-on behaviour is still in place.

### Fixed

- **(N)ew game crashed on the character-creation screen.** Choosing *New game*
  threw `Cannot read properties of undefined` and stopped at the crash reporter,
  so no new character could be created at all. Existing savefiles were never
  touched — the birth screen is the only path affected, and loading a character
  does not go through it.

  The birth screens preview a character sheet before the game exists, so they
  hand the sheet renderers a small hand-built `GameState`. On 2026-08-06 core
  gained its known-state twin and began reading two more fields from that state
  (`actor.knownCombat` and `runeEnv`); the preview object was not updated, and
  the `as unknown as GameState` cast it is built with meant the compiler had
  nothing to say. It went unnoticed because no test supplied the registry deps
  the preview needs, so the entire path was unexecuted on a green suite. The
  preview now supplies both fields, and `birth.test.ts` drives it against the
  real shipped pack so the next field a sheet renderer reads fails in CI.

- Restored the visible target-path tile projection while routing map paint
  through `WorldFrame`: a path marker once again receives the terrain tile
  beneath it even over otherwise bare seen terrain, matching the prior glyph
  renderer and upstream's two-pass tile paint.

- **Banishment did nothing.** `EF_BANISH` reads a chooser for the monster glyph
  to banish, and nothing in the shipped game ever supplied it, so the handler
  returned "cancelled" on every cast: the Banishment spell, the Scroll and Staff
  of Banishment, and the artifact activation all consumed nothing, killed
  nothing, and said nothing. The shell now asks upstream's own prompt - *Choose a
  monster race (by symbol) to banish:* - before the effect runs, so the effect
  still executes exactly once and the random-number order stays faithful.

- **Dimension Door did nothing**, for the same reason: the spell asks for a
  direction from inside the effect rather than from the command, and that prompt
  had no producer. It now asks, and teleports you where you point.

- **Eight more teleport behaviours that were silently switched off.** The
  teleport code reaches the rest of the game through one environment object, and
  nine of its sixteen members were never filled in - each one deferred, in a
  comment, on a subsystem that had since been built. As a result: a
  Teleportation-forbidding curse never blocked a teleport and its rune was never
  learned; a teleport could drop you into lava; nexus resistance never foiled a
  hostile teleport-level; *force descend* aimed at the level you were standing on
  instead of the deepest you had reached; the bottom of the dungeon was a
  hardcoded 128 rather than the value the content pack ships; and a monster
  teleporting the monster it was aiming at teleported itself instead.

- **A broken item said nothing.** Throw a flask and it shatters; drop something
  where there is no room for it and it is gone. Upstream tells you — *"The Potion
  of Death breaks."* — and this port did not, because the message hook had no
  supplier. Neither did the sound an item makes when it lands. Fixing it turned
  up a second gap on the same path: the fire and throw commands passed no drop
  environment at all, so a landing missile also skipped the ignore rules and the
  trap rules every other drop obeys.

- **A shop now tells you what its stock does.** Inspecting an unidentified
  potion or scroll on a shelf described nothing, because the "you are looking at
  this in a store" flag was never set. Upstream reveals a useable item's effect
  there, which is how you decide what to buy.

- **Spell failure rates and beam chances read only the class.** The real rule
  looks at race, class and current shape together. Nothing in the base game
  grants those particular abilities outside a class, so play is unchanged — but a
  mod that adds one would have been ignored.

- **A monster that survived a spell kept its old visibility** until something
  else moved it, because the refresh that follows a projection had no supplier.

- **An item could be destroyed by its own blast.** Aim a wand of fire while it is
  lying on the floor at your feet and the wand was inside the explosion. The rule
  that exempts the source of a projection from that projection was written down
  but never connected.

- **Adding a record to `object`, `ego_item` or `vault` silently deleted the base
  game's copy of that file.** See the first entry under **Added**: composition
  now keys by `recordRefKeys` and all three merge per record. Two things remain
  from the first pass at this, and both are still the right behaviour for the
  three files that genuinely can only be contributed whole (`constants`,
  `visuals`, `history`): the loader reports the whole-file replacement in
  `problems`, and `ModProject.build` promotes it to an `error`, because a line
  in a list is not proportionate to discarding the base game's copy of a file.

- **A mod's own vocabulary: namespaced, declared, and enforced.** A field a mod
  introduces is now written `"gore:bleed"` and declared in that mod's manifest
  under `fields`, with the record files it may appear on and an optional type.
  Namespaced because the alternative is a land grab - whoever ships first takes
  `bleed`, and every later mod either collides with it or works around it -
  and because qualifying by the declaring mod makes deliberate interop
  expressible in the same stroke. It is the rule the vocabulary registry
  already used for terms, so there is one rule rather than two. Declared
  because the declaration is what buys the error message: a namespaced key
  nothing declares, one written onto a file its declaration does not list, and
  one whose shape does not match its type are each stripped and reported by
  name. An *unqualified* key core does not know is no longer treated as a field
  at all - `atack` is a misspelling of `attack`, not a new attribute - and is
  reported with core's nearest real field named. That arm needs core's key
  table and so runs in the host; the namespace rule needs only the manifests
  and runs in the SDK. A dropped field costs the field, not the mod. The host's
  manifest allowlist was, as ever, the thing that would have quietly inverted
  the feature, and a test caught it.

- **A mod's added field survives on fifteen bound record types, not two.** Ego
  items, artifacts, terrain, traps, vaults, room templates, projections,
  stores, curses, object bases, monster bases, player races and player classes
  joined objects and monsters. One helper (`attachExt`) rather than the same
  three lines fifteen times, because `grep attachExt` is then a census of which
  record types carry mod fields - a type nobody wired up is visible as an
  absence instead of being indistinguishable from one with nothing to carry,
  which is precisely how the gap survived its first pass. The census is a test:
  it injects a sentinel into every record of each covered file and counts the
  survivors, since bound order is not record order and "record i becomes bound
  record i" would be a claim it was asserting by accident.

- **A mod can add a field core has never heard of, and read it at runtime.**
  Asked directly whether a mod could make a dagger `1d5` instead of `1d4` and
  give it a `bleed` key, the answer turned out to be two-thirds yes. Patching a
  value works end to end - the dagger really rolls 1d5 - and so does removing a
  key, which really takes THROWING off it. Adding one did not: it composed
  cleanly, reported no problem, landed in the composed record, and was then
  dropped by the binder. No error, no effect, which is the worst shape a gap
  can take. `ObjectKind.ext` and `MonsterRace.ext` now carry the keys core does
  not bind. `ext` is frozen, so one mod cannot rewrite what another reads, and
  absent entirely when nothing was added, so its presence means something. It
  holds ONLY the mod's keys - copying core's own fields in would invite a mod
  to read a pre-bind value that can disagree with the bound one forever without
  either being wrong. Which keys are core's is derived from core's own gamedata
  rather than declared, and re-derived by its test in both directions, so the
  boundary cannot drift as the pack grows. Core never reads `ext`: this is the
  DATA half of extending the game, and the behaviour half is already there in
  `registry:effect` and `registry:blow`. Objects and monsters are done and
  proven from disk; the remaining binders still drop an added key.

- **Every record of every gamedata file is now nameable by a mod.** Declaring a
  per-file key on 2026-07-29 stopped per-record patches being silently dropped,
  but a key per FILE is not every RECORD being addressable, and the difference
  was **73 records that no ref could name** - 61 of `ego_item`'s 107 among them,
  so a mod could not patch "of Acid" at all. Two unrelated causes, separated
  rather than papered over. The first was information the slug threw away:
  `slugify` collapses `*` and `+`, so `*Healing*` and `Healing` arrived as one
  key even though nothing about the data was ambiguous - the key now spells the
  marks out (`core:potion--star-healing-star`), which alone accounts for every
  collision in `object` and `vault` and 16 of `ego_item`'s. The second was names
  core genuinely repeats, which no care with the name can separate, so a file may
  now declare a DISCRIMINATOR: `ego_item` uses the item types an ego applies to,
  giving `core:of-acid#shot-arrow-bolt`. That is not an invented identity - it is
  upstream's own `lookup_ego_item(name, tval, sval)`.
  Nothing that resolved before stopped resolving: a record answers to several
  refs and the older slug is kept as an alias, dropped only where it would shadow
  another record's primary key - which is not hypothetical, since `*Healing*`'s
  legacy key is plain `Healing`'s real one. An ambiguous ref is refused with the
  refs that DO work listed, because "ambiguous" with no alternative is where an
  author gives up. Measured over the shipped pack: **0 unaddressable records**,
  asserted in both directions, with both controls run. Proven from disk by a real
  mod folder patching one "of Acid" out of the real `ego_item.json` and leaving
  the others untouched. `history` stays keyed by nothing on purpose - a history
  record is `{chart, phrase}` and every part of it is a value a mod would change
  - and an op against it is reported, never dropped.

- **`registry:store` — a mod can change what shops buy and what they stock.**
  A mod could already add a store record and its own object types; it could not
  make the shop deal in them, because "what will this shop buy" and "how many
  does it stock" were `switch` statements. Both are a registry now, keyed the
  way each decision is actually made — stack size by object type, the buy rule
  per shop with a wildcard for "every shop". Core's own rule is registered under
  that wildcard, so a mod layers a rule on top of 4.2.6's instead of rewriting
  it. Two refusals are deliberate: an emptied registry refuses rather than
  letting every shop buy anything, and the stack limit stays core's so a mod
  cannot break a pile. `mass_produce` had no test at all before this; it now has
  1,167 golden vectors recorded from the old switch. Along the way that turned up
  a measurement worth keeping — no book in the 4.2.6 data is cheap enough to
  reach the mass-production rule for books, so that rule is faithful and dead
  until a mod adds a cheap book.
- **`registry:blow` — a mod can change what monster attacks do, and add its own
  kinds of attack.** `blow_effects.json` has always accepted a 31st record, but
  until now that record was data with no behaviour: the behaviour lived in two
  26-case `switch` statements. They are now one `BlowEffectRegistry` that both
  of the paths resolving a blow consult, so a modded attack cannot behave one
  way in the engine's recording path and another in the live game. A mod writes
  ONE description and the engine derives both handlers from it, or takes the
  handler currently installed and wraps it — so core's poison can be extended
  rather than reimplemented. Core keeps every 4.2.6 behaviour exactly, including
  the places where the two paths disagree about the order they roll dice in;
  what proves that is a set of 480 golden vectors recorded from the code before
  the registry existed and replayed against it, covering all 30 effects on both
  paths under two environments, with a probe that catches a change in the number
  of random values drawn even when nothing else moves.
- **The last three systems the port was missing: quests, arena mode, and
  persistent levels.** Quests now exist as a system rather than as two hard-coded
  monsters - the quest list, its save block, the level feeling it changes, and
  the five holes that were still open when the row was written. Arena mode
  arrives through `prepare_next_level`'s own branch, not through the dungeon
  profile list, which is why it is deliberately *not* selectable as a profile.
  Persistent levels keep the dungeon you left, and bring full town store
  generation with them.

- **`lore.txt`: monster memory that outlives the character.** What you learned
  about a monster is written out and read back, so a new character in the same
  install starts with the knowledge you earned - as upstream does.

- **Monsters emit light and darkness.** No monster in the game had ever lit a
  corridor or darkened one; the light-source field existed on the record and
  nothing read it. It is now on the mod API surface too, so a mod can give a
  monster its own glow.

- **The monster message queue.** Upstream collects a turn's monster messages and
  prints them together - "you have slain 3 kobolds" rather than three separate
  lines. The port printed each one as it happened, which is the single biggest
  reason the message log did not *read* like Angband. It now goes on the same
  queue upstream uses.

- **`randart.log` and `randart.txt`.** The randart generator narrates its own
  design loop again: every `count_*`, `add_*`, and the whole power calculation,
  from 122 missing lines down to none. If you want to know why a random artifact
  came out the way it did, the answer is in the file.

- **Custom option sets that survive into your next character.**
  `options_save_custom` / `restore_custom` / `restore_maintainer` had nowhere to
  write; the options a player sets for their *next* character now persist.

- **The ENTER command browser**, the `purple_uniques` lore recolour, temporary
  brands and slays in object info, the launcher's contribution to the character
  sheet, and the timed-effect columns that had no supplier.

- **`registry:profile`: a mod can add its own kind of dungeon level.** A room
  builder makes a room; a dungeon *profile* decides which whole-cave builder runs
  at a depth. `ProfileFacade` opens the live `DungeonProfiles` registry to a
  trusted plugin, and `builder(key)` hands a core builder back so a mod can wrap
  core generation rather than reimplement it. Two refusals are deliberate: a
  profile naming an unregistered builder is rejected where the mistake is, not
  inside generation a level later; and profiles only append, because
  `choose_profile`'s weighted pass walks the list in order and inserting would
  change which profile the *base game* picks from the same seed. Proven by a
  sample mod written to a real folder and imported for real, asserting on the
  registry rather than on the mod's own report.

- **All six registry domains are now proven reachable from disk.** Effects,
  rooms, commands, monster AI, vocabulary and profiles each have a sample mod
  written to a folder and imported for real, asserting on the live registry.
  They had a bundled demo before, which proves the facade works but not that a
  mod a player installs can get to it.

- **`parity/DIVERGENCES.md`**: what this port deliberately does not match in
  4.2.6, and why - separate from what it has not got to yet.

- **"Where your characters live": the screen that says what would destroy a
  roster.** Everything this game saves is in browser storage - the roster in
  `localStorage`, the installed mods in IndexedDB - and on the desktop build that
  is just as true, because the shell serves the same bundle to a local origin. So a
  routine "clear browsing data", a disk cleaner, or a profile reset takes every
  character AND every mod at once, with no undo and, under a permanent-death rule,
  nothing to recover from. The new screen (Escape menu, or `Shift-W` on the
  character list) names the actual folder or origin, what is stored there now, the
  exact actions that would clear it, and how to export a backup.

  The character-select notice used to go SILENT once the origin was persistent,
  which is the normal desktop state - so the player with a full roster and the most
  to lose was told nothing. Persistence answers the browser's own eviction and
  nothing else; there is now always a line, and every version of it points here.

- **An exported character is not a restore point, and the game now enforces it.**
  Export/import exists so a character can move between surfaces, and the honest
  note in the format module said it could also be used to undo a death - which was
  true of a file and did not have to be true of the game. A character now carries a
  LINEAGE that survives the trip, so an import is refused when that character died
  in this roster (from a ledger that outlives the tombstone, since clearing a
  memorial is a legitimate thing to do), and refused when the copy already here has
  played at least as far. A file that IS further along takes its own slot back
  rather than becoming a second copy of itself. What this cannot police is a second
  install that never saw the death, or a hand-edited file - the same hole
  `cp save/Bilbo /tmp` has always opened in upstream Angband.

- **Installed mods are offered their updates, in both places you would look.**
  The catalogue row has said `[~] qol v0.11.0 -> v0.13.0  Enter to update` for as
  long as there have been two tags to compare - but the screen it lives on is
  called *Install a mod...*, which is not where anyone looks for something they
  already installed, and nothing else mentioned it. So a player updated the game,
  got a catalogue naming newer mods, and stayed on the old ones with no sign that
  anything had changed. The mod manager now carries the count on a row of its own
  (*Update installed mods... (3 available)*), the (U)pdate screen lists them
  beside the game update with `M` to take them, and the title-screen row shimmers
  for a waiting mod exactly as it does for a waiting build. `Update all` and the
  single-mod rows go through the same installer, digest check and summary as a
  first install.

  Which mods qualify is decided in one place (`classifyModTag`) that the
  catalogue row and the bulk action both read, because they must never disagree:
  a mod that is AHEAD of this build's catalogue - what a mod author testing their
  own release sees - is never offered as an update, since installing it would be
  a downgrade, and two tags that cannot be ordered are never guessed at.

  **Mod versions travel with the game build, and that is a deliberate limit.**
  The catalogue ships inside the build with a SHA-256 for every file, and that
  digest not having travelled over the same connection as the file is the whole
  reason downloading a mod is safe. So the check is local, instant and works
  offline - and it can never offer anything newer than the build knows. Updating
  the game is what brings newer mods within reach.

Six days of parity work against the 4.2.6 golden master turned up defects a
player could feel. The ones worth naming:

- **Free Action did not stop a paralysing breath.** The flag was checked on the
  melee path and not on the breath path.

- **A resisted breath said nothing, while the same flag resisted in melee said
  everything.** Two paths, one rule, and only one of them told you.

- **A Wand of Polymorph did nothing at all.**

- **Banishing a monster destroyed the artifact it was carrying**, and **a store
  could quietly destroy the artifact you sold it.** Both are unrecoverable in a
  permadeath game.

- **A decoy did not stop a bolt**, which is the one thing a decoy is for.

- **A cursed bow's to-hit penalty never reached the shot.**

- **A monster draining another monster drained the player instead.**

- **Streamers were destroying secret doors on every classic level.**

- **Word of Recall could send you to level 1 by accident.**

- **Phase Door worked inside single combat** - the one place it must not.

- **Persistent levels crashed roughly one descent in eight.**

- **Auto-ignore judged an item by stats the player could not see**, and the
  ignore menus listed every ego and kind in the game rather than the ones you
  had met.

- **Remove Curse read the curses you *had*, not the ones you knew about**, and a
  **store bought on runes the player had never learned.** Both leaked knowledge
  the character has not earned.

- **The look scan stopped on a grid holding nothing but ignored junk.**

- **The targeting preview drew walls the player had never seen.**

- **A mimic keeps its object now, and loses it when it dies.**

- **Eight things you could watch a monster do and learn nothing from**, and a
  bear that never taught you it hits harder: monster lore was not being recorded
  from what happened in front of you.

- **Every blow in the monster spoiler claimed a 0% chance to land**, and the
  spoiler files were generated with no player at all - so "how many have you
  killed" was always zero.

- **A short screen dropped the depth and kept the class**, and the birth screens
  advertised a help key they then ate.

- **"Killed by a kobold", not "Killed by kobold."**

- **A monster told to drop something had nothing to drop.**

- **A paragraph break in a mod's description painted as two solid blocks.** The
  word-wrap behind the detail pane broke on the space character and treated
  everything else as ordinary text, so a newline was carried into the output line
  and the terminal - which has no glyph for U+000A - drew it as a filled cell.
  `qol`'s manifest has a real blank line between its two paragraphs, so its row
  read "are not touched here." followed by two blocks and then "Enable it and you
  get...", and it has looked that way since **0.16.0**, when that description
  landed. A description is written by the MOD AUTHOR, so "do not put newlines in
  it" was never an answer available to the game. `wrapCssRuns` splits the run
  stream on newlines first now and wraps each paragraph on its own, emitting an
  empty line where the break was; `\r\n` and a lone `\r` are the same break, so a
  manifest written on Windows cannot leave a stray carriage return behind either.
  The store help legend is the only other caller and has no newlines in it at all,
  so nothing there changes.

## [0.18.0 and earlier]

### Added

- **Three mod seams, so a mod can remember something.** A mod could already keep
  data with a CHARACTER - its save bag - and had nowhere at all to keep data
  about the PLAYER, so anything it learned died with the character. `ctx.prefs`
  is that second place, one JSON value per mod, held outside every save and
  scoped to the mod's own id. `ModHooks.optionsChanged` tells a mod when the
  player has finished changing their settings in the `=` menu (a notification,
  the first hook core does not read an answer from - folded `all-observe`, so
  every listening mod is told and none of them can overrule another).
  `ctx.newCharacter` says whether this session's character was just created or
  loaded from a save, which is the one thing a mod cannot work out for itself:
  turn 0 is not the answer, because the game autosaves the moment a character is
  born. Together they are what the QoL mod's *Remember my settings* is built
  from, and none of them names it.
- **A log, with a level chosen by the build.** A finished release logs warnings
  and errors; a `0.x` pre-release and a per-commit `edge` build log what the game
  is doing as well. The level comes from `ENGINE_VERSION` rather than from the
  update channel, because a player who installed a beta and then set their
  channel to `stable` is still running the beta - and it starts answering `warn`
  by itself at `1.0.0`, the same way the default channel starts answering
  `stable`. On desktop each launch writes a file to `<game folder>/logs`, pruned
  to the last ten; in a browser the last 2,000 lines are held in memory. It can
  be overridden per launch with `?log=debug`, or from the report screen.
- **"Report a problem", in the Escape menu.** Writes a file naming the version
  and build, the platform, the size and pixel ratio of the window, the mods you
  have enabled, your character, and the last 500 log lines - after showing you
  that list, so the decision to send it is made having read what is in it.
  **Nothing is uploaded anywhere**: it lands in `<game folder>/logs` on desktop
  and downloads in a browser, and you choose who sees it. Your home directory is
  taken out of every path on the way in, including the JSON-escaped form that
  every logged Windows path actually arrives in.

### Changed

- **Updates unpack in-process, with no external program on Windows or Linux.**
  The updater used to hand the archive to `tar`, and PATH does not promise which
  tar that is - a POSIX-style shell (Git Bash, MSYS2, Cygwin) puts GNU tar first,
  which cannot read zip at all and treats any `C:\...` path as a remote host.
  Pinning System32's copy fixed that instance and left the shape of it: a game
  depending on a program it does not ship, resolved on a machine nobody here can
  inspect. It now reads zip and tar.gz itself using `node:zlib`, which is inside
  the runtime Electron already is - handling symlinks, unix mode bits, the ustar
  prefix, and refusing a path or a link that leaves the staging folder. Verified
  against the real 0.16.0 artifacts: the Windows `.zip` and the Linux `.tar.gz`
  each extract **byte-for-byte identically to bsdtar** across 77 entries,
  including a 215 MB member streamed through inflate without buffering.
  **macOS still uses `/usr/bin/ditto`** - part of the OS, not something a player
  installs - because nobody on this project has a Mac to confirm the resulting
  bundle still launches. The swap script still needs a shell to outlive the
  process it is replacing; `powershell.exe` is now named absolutely, since that
  was the same PATH lookup one function below the one that was fixed.
- **The web build knows whether it is stale, instead of guessing.** The
  `(U)pdate` row used to appear only when a service worker took control, which is
  a different question: a worker can claim a page without the build changing, and
  a build can change without a page that stays open ever hearing about it. Each
  build now stamps an id into the bundle and writes the same id to
  `build-id.json`, which the page fetches with `cache: "no-store"` - so "the code
  running here is not the code the site is serving" is a string comparison. The
  file is kept out of the service worker's precache, because a cached freshness
  check answers with the stale build's own id and reports up-to-date forever. The
  page re-asks on a timer, when the tab comes back, and when the network returns,
  and taking the update asks the worker to fetch and activate before reloading -
  a bare reload was served the old build out of the worker's own cache.

Everything below came out of one play session on the 0.15.3 build.

- **The terminal paints what changed, not the screen.** Every drawing call used
  to hit the canvas immediately, so one move of the player cost **1,469 cell
  paints** - a `fillRect` and a `drawImage` each - plus a full-canvas fill, for
  an 80x24 grid that had changed in about a dozen places. Angband is turn-based,
  so that landed on every keypress. The grid is now diffed against what is
  actually on the canvas and flushed once at the end of the task: the same twenty
  moves cost **140 cell paints** and no full-canvas fill, a **3.4 ms median with
  a 12.4 ms tail down to 1.7 ms and 2.2 ms** (measured in a browser through
  `__neo.paints()`; `term-overdraw.test.ts` gates it). The canvas also asks for
  `alpha: false` now, which lets the compositor skip blending it.
- **The knowledge browser is upstream's two-pane screen** - Group on the left,
  Name on the right, a `|` between them and a `=` rule above (`display_knowledge`,
  ui-knowledge.c L1050-1240). The port had been flattening every group into one
  lettered list, which for known objects is several hundred rows: the alphabet ran
  out at the fifty-second and the rest could not be picked at all. Upstream letters
  **nothing** on this screen - both its menus are built from iters whose `get_tag`
  is NULL - because choosing a group first is what keeps the member list short.
- **The book and spell pickers draw over the map** instead of blanking it, in the
  right-aligned box `item_menu` uses (ui-object.c L1198-1215) and the spell menu's
  own region (ui-spell.c:229). Casting a spell used to clear the terminal, so the
  monster you were casting at disappeared while you chose.
- **ESC goes back one level.** The game menu is a loop now: closing Mods, Options,
  Knowledge or any other screen it opened returns to the menu you opened it from
  rather than dropping you into the dungeon. Its cursor also stays where you left
  it, for the session.
- **Lists wrap at both ends.** Down on the last row lands on the first and up on
  the first lands on the last, which is what `menu_handle_keypress`'s
  `is_valid_row` loop does upstream and what the port had been missing - on a list
  taller than the screen the only way back to the top was to hold a key.
- **Space turns a mod on or off** from the list, on the row under the cursor, and
  the cursor follows the mod it just moved (the catalogue sorts enabled-first, so
  toggling one reorders the list under you). Space is the same shortcut in a mod's
  *Fixes & tweaks* and *Parts of this mod* screens.
- **Installing a mod offers to enable it** in the same action, with the consent
  prompt and the non-scoring warning still in the way. The mod also appears in the
  list immediately: the sources are re-read after a download, where before a
  freshly installed mod was invisible until a reload nobody had asked for yet.
- The four first-party mods' descriptions are rewritten as short paragraphs.
  neo-linoleum's was 1,625 characters in one block.
- The macOS instructions are the ones that work. *Right-click -> Open* was the
  standard answer for a decade and Apple removed the bypass in **macOS 15
  Sequoia**; the route is System Settings -> Privacy & Security -> **Open Anyway**,
  and it only appears after a blocked launch. Asserted in `packaging.test.ts`
  against all three places that carry it.

### Fixed

- **A ghost of the previous screen survived every full-screen change.** Cell
  metrics are whole CSS pixels and the canvas carries `setTransform(dpr, ...)`,
  so on a fractional device-pixel ratio a cell's edge landed part-way through a
  device pixel. Repainting the cell covered only part of that pixel and the
  renderer repaints only cells that changed, so the neighbour owning the other
  half was never touched and the stale half survived indefinitely. Title screen
  to update page and back left 118,452 differing pixels against a clean paint of
  the same screen - 1.43% of the canvas, in a lattice of cell outlines, with a
  measured seam pitch of 47.24 and 71.55 device pixels. Cell edges are now
  rounded to whole device pixels, which also makes neighbours tile exactly;
  snapping outward instead would have erased the residue by letting every cell
  overwrite a pixel of each neighbour. No extra cells are painted, so the
  overdraw budget is untouched. Invisible at a ratio of 1 or 2, which is why
  every earlier test missed it.
- **A missing extractor reported `spawn ditto ENOENT`.** The update screen prints
  that string verbatim, so it named nothing the player could act on. It now says
  which tool is missing and what it was needed for. Only macOS can still reach
  it - see *Updates unpack in-process* above.
- **A hybrid mod appeared twice in the manager.** `qol` and `bug-fixes` declare
  `facets: ["content", "plugin"]`, so each is listed once by the content discovery
  and once by the plugin discovery - both correct, neither aware of the other, and
  nothing joined them back up. Install all four mods and the list showed six rows.
  `buildCatalog` now merges by id, keeping the most privileged kind so a mod that
  runs code is not labelled "(content)".
- **A long mod description could take the whole screen.** The detail pane was
  sized from its own content with the list floored at ONE row, so neo-linoleum's
  own screen rendered as a title, *Disable*, and thirty lines of prose - with no
  way to reach *Move earlier*, *Move later* or *Back*, and no way to scroll the
  prose either. The pane is capped now, says so when it cuts, and a *Read the full
  description* row opens the whole thing in a viewer that scrolls.
- **The macOS bundle was never sealed.** With no Apple Developer identity,
  electron-builder skips signing and says so in its own log ("skipped macOS
  application code signing"). Measured against the artifacts rather than
  inferred: the **0.15.3** arm64 zip contains **zero `_CodeSignature` seals** - no
  `Contents/_CodeSignature/CodeResources` on the app, and none on any of its four
  helper executables (GPU, Renderer, Plugin, and the plain helper), each of which
  is a separate binary macOS wants signed. The 0.16.0 zip has nine. Apple Silicon
  refuses an arm64 binary that is not validly signed and reports it as *"is
  damaged and can't be opened"*. The bundle is ad-hoc signed and verified after
  packaging now (`codesign --deep --sign -`, confirmed in the release log for
  both architectures). **This is a launch defect, not the cause of the
  slow-on-an-M4 report.** It was first written up as one - an app that reads as a
  bad download pushes people onto the Intel build and Rosetta 2, so a signing
  fault surfaces as a speed complaint - and that chain needs Rosetta 2 to exist.
  It is being withdrawn: macOS 27 deletes it during installation and macOS 28
  keeps it only for a named set of old games. A Mac without Rosetta cannot run
  the Intel build slowly, so the slowness was the arm64 build running natively,
  and the overdraw fix above is what addresses it.
- **A macOS download says which Mac it is for.** The release page carried
  `Neo.Angband-0.16.0-arm64.dmg` and `Neo.Angband-0.16.0.dmg`, and the second one
  is the **Intel** build: electron-builder's default artifact name interpolates
  the architecture only when it is not x64, so the Intel file is the unlabelled
  one. Next to an explicitly-labelled arm64 file that reads as "the normal one",
  or as universal - there is no universal build - and with Rosetta 2 being
  withdrawn it is the file that will not launch. All four macOS artifacts now
  carry their architecture (`-arm64-mac` / `-x64-mac`), and `mac.artifactName`
  is asserted to contain `${arch}`.
- **An 0.x release is published as a pre-release.** The workflow has always
  created a draft, and that is a statement about who has pressed publish, not
  about the software. Publishing an 0.x tag without `--prerelease` marks it
  *Latest release*, which is what the repository sidebar, the API and every
  "download the latest" link follow - so an alpha would present as the stable
  build. The flag is conditional on a `0.` prefix and stops applying at 1.0.0.
- **`compareSemver` ordered numeric prerelease identifiers as text, so
  `1.0.0-edge.9` outranked `1.0.0-edge.10`.** It was a *documented* limitation -
  the header said pack authors needing exact prerelease ordering should not rely
  on it - and that was honest while nothing did. The `early` channel names builds
  `-edge.<n>`, so the tenth build of a day would never have been offered to
  anyone running the ninth: the game would have reported itself up to date
  indefinitely, and the symptom would have looked like a broken update check
  rather than a comparator. Implemented to the spec now (semver item 11.4):
  dot-separated identifiers, numeric compared numerically and ranking below
  alphanumeric, a longer list beating its own prefix. The spec's own example
  chain is asserted, and *sorted* as well as compared pairwise - a
  non-transitive comparator passes every adjacent pair.
- Toggling anything in the mod manager no longer throws the cursor back to the top
  of the list.

### Removed

- **1,442 tags.** This repository's history descends from Angband's, so every
  upstream tag - `2.0alpha`, `4.2.6`, and 1,400-odd `4.2.1-190-g5c16b9e7`
  development tags - was a real ancestor of `master` and had been pushed along
  with it, burying the release tags among fifteen hundred. The tag list is the
  release list now. They remain in upstream Angband and in a backup taken first;
  `docs/RELEASING.md` says why `git push --tags` must never be run here.

### Added

- **Three update channels, chosen with `C` on the update screen.** `stable` is
  finished releases, `beta` adds pre-releases - which is every `0.x` version
  this project has - and `early` is a build of every commit on master, published
  by CI within minutes of a push. They are inclusive downward, so a player on
  beta is still offered `1.0.0` when it ships.
  - **There is no `draft` channel, and there cannot be one.** GitHub hides draft
    releases from unauthenticated callers, so a player's game cannot see one at
    all; the only way to change that would be to ship a credential inside the
    game. A draft is a staging area, and `beta` is the published-but-not-final
    state GitHub actually provides.
  - While the engine is `0.x`, `stable` selects nothing - every release is
    flagged pre-release - so new installs start on `beta` and switch to
    `stable` on their own at `1.0.0`. A default of `stable` today would mean a
    fresh install never offers an update and never says why.
  - `early` builds are tagged `v<next-patch>-edge.<run>`, which sorts above the
    last release and below the next one. **The patch has to be bumped before the
    suffix**: a prerelease sorts *below* its own triple, so `0.16.0-edge.1`
    would be older than the `0.16.0` already installed and would never be
    offered. Only one edge release exists at a time; the previous one is deleted,
    tag and all, once its replacement is up.
  - Leaving `early` means going backwards to the slower channel's newest build.
    The screen calls that a move rather than an update, because "0.16.0 is
    available" shown to someone running `0.16.1-edge.9` reads as a bug.
  - The **(U)pdate row is now always present on the desktop**, and shimmers only
    when a build is actually waiting. It previously appeared only when there was
    something to install, reasoned as "a dead row would say an update might
    arrive at any moment". On the desktop both halves of that turned out false:
    an update can arrive at any moment, since the game asks at every launch, and
    the row is the only door to the channel setting - so hiding it left the
    setting reachable only in the moments changing it mattered least.
- **The game updates itself, from a shimmering row on the title screen.** When a
  newer version has been published, the title screen grows a **(U)pdate** row
  that cycles colour the way an `RF_ATTR_MULTI` monster does - the same
  `randint1(BASIC_COLORS - 1)` on the same 250 ms tick, from a display-only RNG
  so a splash left open cannot perturb the game's. Pressing `U` downloads the
  archive for this machine, checks its SHA-256 against the digest GitHub
  published for that asset, and swaps it in on restart.
  - **electron-builder's own updater could not have done this.** It has no
    support for the `portable` target and hands macOS to Squirrel.Mac, which
    validates the code signature - so the supported library would have covered
    NSIS and AppImage users and nobody else: not the folder install these docs
    recommend, and no Mac, since this project ad-hoc signs. Swapping a directory
    needs neither, and it is one path on all three platforms.
  - **The order is the safety property.** Outgoing files are moved aside, the new
    ones are moved in, and only then is the old copy deleted - by a script that
    outlives the app, because a program cannot replace its own running
    executable. `neo-angband-data` is never moved on any path. A real swap of
    real files, including the rollback, is asserted in
    `update-swap.integration.test.ts` rather than inferred from the script text.
  - **A single-file portable launch says so instead of lying.** `portable.exe`
    and an AppImage unpack to a temp folder, so swapping it would show a progress
    bar, restart, and change nothing. Those - and a read-only install - are
    offered the download instead.
  - Nothing is trusted: the download host must be this repository's own release
    assets, an archive with no digest is refused rather than installed, and the
    renderer names an operation, never a path to swap in.
- **The browser stops reloading itself out from under you.** A newly deployed
  build used to take over the moment it arrived, defended on the grounds that
  play is autosaved. That is true and beside the point: mid-fight it is a screen
  flash, a lost message log and a resumed turn nobody asked for. The reload still
  happens silently at the title screen, where it is invisible; anywhere else it
  waits behind the same (U)pdate row.
- **A save is converted forward, never rejected.** Every version of the save
  format below the current one now has a conversion step
  (`packages/core/src/session/save-migrate.ts`), and `saveMigrationsAreComplete()`
  fails the build if `SAVE_VERSION` is raised without one. This closes the
  highest-cost defect in the game: `loadGame` used to throw on any version
  mismatch, the web boot caught it with a bare `catch`, and a player whose
  character was completely intact was told *"Could not read the save; starting a
  new game"* - then the throwaway game it started autosaved over the slot it had
  just failed to read. A save from a **newer** build now says so and asks you to
  update (`SaveFromFutureError`), and a save that cannot be opened for any
  reason is left byte-for-byte alone. Proved by round trip: a real save is
  walked backwards into the version-1 and version-2 shapes and migrated forward
  again, and the result must equal what it started as.
- **Downloadable builds.** A tag now builds the desktop app for Windows, macOS
  and Linux and attaches them, plus the static site as a zip, to a draft GitHub
  Release with notes cut from this file (`.github/workflows/release.yml`,
  `tools/changelog-section.mjs`). Before this, a tag published three npm
  packages and nothing a player could run; the only install path was
  `git clone && pnpm install`, which is a developer preview rather than a public
  alpha. The builds are not code-signed and every release page says so.
- **A crash says what happened instead of going black.** `bootGame()` runs at
  module top level and the whole UI is `await`ed menus, so a throw during boot
  or a rejected promise in any menu left a canvas that never painted - with the
  explanation in a console the player does not have open. A DOM overlay
  (`packages/web/src/crash-screen.ts`) now catches `error` and
  `unhandledrejection`, leads with the fact that saved characters were not
  touched, and offers the stack as one copyable block with the version in it.
  The desktop shell covers the three cases the page cannot: a dead renderer
  process, a wedged one, and a failed load.
- **The engine is no longer exempt from its own containment rule.** A mod hook
  throwing mid-turn was caught, named and stopped the session saving; a *port
  bug* throwing mid-turn did none of that. What protected the save was the
  accident of the exception unwinding past the tail autosave - and `S`, a level
  change and pagehide all write too, so a player who hit a bug and pressed S to
  be safe wrote the half-finished turn over their character. `runGameLoop` is
  now wrapped, and a core fault taints the session exactly as a mod fault does,
  with a notice worded for a bug in the game rather than one in a mod.
- **Issue templates, and a way to reach a person.** Four forms (a parity
  difference, a bug, the mod system, an idea) that ask for the version, the
  surface and the enabled mods, so a report does not cost a round trip to
  become actionable. `config.yml` points at the RPGM Tools Discord for anything
  that is a question rather than a report, and at the right repository for a
  bug in a specific mod. Plus `SECURITY.md` and a PR template.
- **Mod authors can declare compatibility, and the engine resolves it.** A manifest
  gains `sections` (named parts of a mod, each independently switchable and each
  carrying a priority BAND rather than a numeric offset, so a part is placed
  absolutely instead of relative to whatever the list happens to hold), `group`
  (LOOT's idea, and the reason a mod can be sorted against mods that do not exist
  yet), and `compat` (prefer-mine / prefer-theirs, a `conflicts` warning that carries
  the author's required `because`, and `patches` for a section that exists only while
  the mod it patches is installed). One rule underneath all of it: an author has
  total authority over their own mod's contributions and none over the player's order
  or anyone else's mod - so a declared conflict warns and never refuses, which
  diverges from NeoForge and Factorio on purpose.
- **A sort that cannot fail.** `sortModOrder` proposes an order from four tiers -
  hard, player, author, group - and on a cycle drops the weakest edge and names it.
  It is deliberately separate from `resolveLoadOrder`, which enforces. `loadAfter` and
  `loadBefore` used to be hard constraints, so two mods each claiming priority
  refused to launch the whole set with neither author at fault.
- **A conflict report that sees more than content records.** Five composition layers
  can discard a contribution and the report covered one of them, which is worse than
  no report: an empty pane reads as "nothing conflicts". Claims are derived from what
  a mod actually contributes - refs in its files, keys its hooks factory returned,
  grafIDs claimed - rather than from a `touches` manifest field that would go stale.
- **A pinned surface for `ctx.core`** (`packages/core/mod-api-surface.json`,
  `tools/api-surface.mjs --update`, and a test that reads the same namespace object
  the host hands to a plugin). `MOD_API_VERSION` versions the plugin contract's
  *shape*, not the ~1700 engine exports an author spends all their time calling, so a
  rename could break every mod with no CI anywhere able to know. It fails in both
  directions on purpose: a baseline that tolerates additions goes stale, and then the
  removal check measures nothing. It is a ratchet, not a fence - it does not make the
  namespace stable, it makes a break visible to the person breaking it rather than to
  a player.
- **`docs/modding/MOD_COMPATIBILITY.md`** - the promise, stated: a data-only pack
  survives engine releases without being republished, and a pack that ships code gets
  a release's warning before an ABI bump strands it.

- **A plugin builder in the mod SDK** (`neo-angband-mod-build`, shipped as a bin by
  `@rpgm-tools/neo-angband-mod-sdk`). It compiles a mod's TypeScript into the single
  `plugin.js` a mod folder distributes, and enforces the plugin ABI: no non-relative
  import survives into the output, the mod's own modules are bundled in, the default
  export is a valid plugin, and a committed `plugin.js` must be a current build of its
  source. Any mod repository can now build itself; it used to require a checkout of
  this one.
- **A `demo-hooks` framework proof** under `packages/web/mods/`. It is the only mod in
  the build with a `plugin.ts`, and it exists so the ModHooks discovery path and its
  guards stay exercised now that the real mods are downloads. Dev builds only.

- **An upstream text census, gated in CI** (`packages/cli/src/text-census.ts`,
  `pnpm --filter @rpgm-tools/neo-angband-cli census`). It enumerates every string literal
  the C hands to a player-facing call and fails the build if the port does not
  contain one without a documented reason. This exists because code review kept
  passing a port that play sessions then found to be missing messages - a
  reviewer can confirm what is there but cannot see what was never written.
  Every remaining absence is listed with its reason in `KNOWN_ABSENT`.

### Fixed

Found by that census, each with a covering test:

- `calc_bonuses`' ten encumbrance notices (heavy weapon / heavy bow / weapon
  attunement / armour weight against maximum SP) never fired: the derive was
  ported and the state diff at the end of the same function was not. Behind
  them, `PlayerState.cumberArmor` was never written by anything, so the armour
  messages could not have fired even once they existed.
- "You re-arrange your pack." - the quiver half of `calc_inventory`'s reorder
  notice was ported, the pack half was not.
- The invisible-monster ranged hit ("The <missile> finds a mark."), and its gate
  corrected to `monster_is_obvious` so a camouflaged mimic is not named.
- Walking into UNKNOWN terrain used the known-grid wording and, more
  importantly, did not memorize the grid - upstream maps a wall you bump into
  blind, which is how a player feels along an unlit corridor. The known-grid
  branch now also reconciles stale map memory.
- Starting consumables read by flavour ("a Clear Flask") because
  `object_flavor_aware` was not applied to the class starting kit.

Documentation accuracy:

- Saves are in `localStorage`, not IndexedDB as the docs stated - a different
  quota and different browser controls.
- `docs/INSTALL.md` advertised in-app text/tile scaling that does not exist.

### Fixed

- **The Borg's decision ladder had never run.** Two of its test files hung
  indefinitely and were excluded from CI, so `think()` - the function that
  decides - was executed by nothing. The cause was in core, not the Borg: the
  per-think reseed went through `Rng.setState`, which is the SAVEFILE path and
  deliberately forces quick mode off to match load.c. That handed the generator
  an all-zero WELL table, which is a fixed point: every draw returned 0, and
  `borg_twitchy` retries on `dir == 0` without spending its counter (faithfully -
  the C does the same), so the first decision on a live level never returned.
  Core gains `Rng.reseed()`, which is the seed swap the C does by assigning
  `Rand_value`; the exclusions came off and the Borg's suite went from 138 tests
  to 161. The old RNG test asserted that two generators agree, which a generator
  stuck at zero satisfies - the new one asserts the spread.
- **The Borg never considered attacking with an artifact.** All 61 `BF_ACT_*`
  activation methods were missing from the attack dispatch. The enum carried
  every id, so `borg_attack` asked about each one, every one fell to
  `default: return 0`, and 0 is what "no such artifact" looks like. Transcribed
  from the C, including the five multi-element dragon activations and
  Holcolleth's sleep-II, which was not ported at all. A source census now fails
  if any `BF_*` id loses its case - a behavioural test cannot catch this, since
  without a host activation resolver every one of these branches legitimately
  returns 0.
- Two Borg "gaps" recorded in the last release were misreadings of the port, and
  the C settles both: neither `borg_decurse_any`'s command half nor
  `borg_test_stuff` computes a spell fail rate, so neither has any use for the
  `playerHas` seam. The unused parameters are gone and the reason is written
  where they were.
- `packages/web/src/mod-problems.ts` contained two literal NUL bytes as a dedup
  separator, which made ripgrep and git grep treat the file as binary and skip
  it. Same character, written as an escape.
- The monster death message is three whole sentences again, not one sentence with
  the verb interpolated. `You have killed/destroyed/slain %s.` is chosen correctly
  either way, but a spliced verb leaves no matchable literal, so the text census
  saw a missing message - and had been counting it present only because
  `packages/borg` carried the string in its message-PARSING table. Removing the
  Borg from the tree is what surfaced it. A whole sentence is also the unit
  translation needs.

### Fixed

- **The Linux build could not name its own executable.** The first run of the
  release workflow built Windows and macOS and failed on Linux with
  *"executableName contains characters that cannot be safely used in file
  paths: @rpgm-toolsneo-angband-desktop"* - electron-builder derives that name
  from the package `name`, and ours is scoped. Windows and macOS take theirs
  from `productName`, which is exactly why nobody found it: two thirds of the
  matrix went green and the draft release looked plausible until you counted the
  files in it. `linux.executableName` is set now.

  The fix for that shipped broken, and the second failure is the more
  instructive one. It used `desktopName` and `synchronizeDesktopName`, neither
  of which exists - the option is `syncDesktopName` - and `LinuxConfiguration`
  sets `additionalProperties: false`, so electron-builder rejected the whole
  configuration. It validates the entire object on **every** platform, so a bad
  key under `linux` failed Windows and macOS too: the first attempt built two
  platforms of three, the second built none.

  The test written to prevent exactly this asserted `linux.desktopName` was
  truthy, and passed - the config and the test were written in the same minute
  by the same hand with the same wrong key, so the test agreed with its author
  instead of with the tool. `packages/desktop/src/packaging.test.ts` now
  validates the config against **electron-builder's own `scheme.json`**, which
  ships inside the package being configured and moves when it moves.

  Then a third: with the schema satisfied, the Linux job reached
  `FpmTarget.checkOptions()` and stopped on *"Please specify project
  homepage"* - the `.deb` target wants packaging metadata no other target asks
  for. Three tags to find three problems in one config file, each one hidden
  behind the last, is what a build configuration costs when the only thing that
  exercises it is a release. The requirements are now read off
  `computeFpmMetaInfoOptions()` and checked together, and the whole thing was
  verified by running electron-builder locally until it got past every gate -
  which is what should have happened before the first tag.

### Changed

- **The game itself says where to get help.** A fourth page under `?`:
  the version you are running, the Discord, the issue tracker, the contact
  address, what makes a report useful, and the promise that saves survive an
  update. Every one of those lived only in a README that a player who
  downloaded a build has never opened, and `?` is where someone goes when they
  are stuck.
- **The mods screen speaks English, and fits.** The row for a mod was built by
  concatenation and then SLICED at column 80 by the menu, so a mod called "Bug
  Fixes (unofficial patch set)" with both save ratchets set built an 85-column
  row and what a player saw was the name, the version, the kind, and none of the
  three warnings. The name is elided now and every badge survives; `NOT WORKING`
  is the only badge on a broken row, because a mod that is not running is not
  affecting this game's determinism either. `mod-viewport.test.ts` measures this
  by painting the real manager at 80 columns and at 400 and requiring the rows to
  be identical, so the failure names the string and how much of it was lost -
  which is not something a `length <= 76` assertion in a test can do without
  every caller remembering the three columns the row tag takes.

  The wording went with it: "Requests 2 capability(ies)" is nobody's English,
  and "Non-deterministic: enabling this permanently marks the save
  non-reproducible" is three pieces of jargon about a decision the next keypress
  makes. They are now "Asks for 2 permissions" and "Permanent once on: the same
  seed stops giving the same game."
- **A mod you turned on and then uninstalled gets a row saying so.** It used to
  print `enabled mod "x" not found; skipping` to the console on every launch and
  show an empty mod list - reproducible by reinstalling the game over a profile
  that had mods enabled, which is what an updating alpha tester does. The row
  offers the one useful action.
- **The action rows on the mods screen stopped moving.** They were lettered
  positionally, so installing a mod shifted every one of them down and the key
  that meant *Install a mod...* yesterday meant *Auto-sort* today. They carry
  fixed digit tags now, the way upstream pins the rows that must stay put
  (`option_actions[]`, `ui-options.c`). *Install a mod...* is also the first
  action rather than the fourth: the list above it is empty on a fresh install,
  so the row under an empty list should be the one that ends the emptiness.
- **The parity claim is back, with its asterisk.** README states it again
  because it is now measured at full power: 1000 levels per depth from the port
  against 1000 from the real compiled C, depths 1-20, 82 hypothesis tests
  Bonferroni-corrected at alpha = 0.01 - and on both level-feeling metrics the
  port sits closer to the C than two runs of the C sit to each other. The
  asterisk is load-bearing and states three things: **with no mods enabled**, not
  bit-exact, and the monster species mix is measured and *not* gated because the
  G-test rejects the port against itself at p = 2e-97 on pit-clustered counts.
  `docs/PARITY.md` carries the table.
- **`pnpm c:parity` stopped reporting a verdict it cannot reach.** It compared
  means against a fixed band at 30 runs and printed `parity: FAIL` with 119
  diffs - a number that is an artefact of the instrument, on an instrument whose
  own replacement documents why it cannot separate a real divergence from an
  under-sampled one. It is now framed as the diagnostic it is, and names the
  command that actually decides.
- **`dist-desktop/` is emptied before it is filled**, so the folder holds the
  build you just made rather than every build you have ever made. A
  `Neo Angband-0.1.0-portable.exe` from July had been sitting beside the current
  one for a month, indistinguishable in a file listing except by a version
  number nobody reads before double-clicking.
- **The later mod wins, on every layer and every hook.** The mod manager ships a row
  reading *"Move later (loads last, wins conflicts)"*, and that sentence was false of
  two layers. Tiles resolved FIRST-wins, so moving a tile mod later made it lose; and
  two of the seven `ModHooks` - `walkBlockedByDiggable` and `objectListTiebreak` -
  stopped at the first contributor with an opinion, so the later mod's rule never ran
  at all and both its author and its player believed it worked. Both hooks are asked
  in reverse load order now, `first-answer` is gone from the fold vocabulary, and
  `contestedSlots` picks the last claim for every discarding fold. Two folds are still
  not last-wins and forcing them would have been worse: `true` from `historyAdd` means
  "I have nothing to say about this entry", not "I insist it be written", so last-wins
  there would let a later mod's silence cancel an earlier mod's rule and break both.
  The invariant that actually holds is sharper - **no mod's opinion is ever discarded
  in favour of an earlier one** - and a test now asserts a behaviour slot and a record
  slot resolve to the same winner.
- **A missing patch target costs the patch, not the mod.** `composePacks` threw and
  the caller answers a throw by removing the whole mod, so a pack patching forty
  monsters lost all forty - plus its code, its rules and its tiles - because one
  record had been renamed. It takes an `onRefuse` reporter now. This also ended an
  asymmetry nobody chose: 20 of core's 44 record files take a merge path that reported
  and carried on, and 24 take one that threw. Same author mistake, two outcomes,
  decided by the shape of core's own data.
- **An `engine` range labels data and gates only code.** An out-of-range manifest used
  to refuse the whole pack, which is the "the engine labels, it does not forbid"
  ruling applied backwards: the range says what the author *tested*, and nothing in a
  data pack's manifest can make its JSON unloadable. It now blocks a pack that ships
  code, with `modApi` as the signal - required of exactly the packs with a `plugin.js`
  and impossible to set to buy leniency. Tile packs follow the data rule, which
  reverses the old comment's argument and answers it: a stale mapping loses individual
  tiles to the ASCII fallback, which the player can see, and that beats a whole
  tileset going dark on a patch its author never saw.
- **The plugin ABI has a deprecation window.** `modApi` was matched with `!==`, so the
  day the ABI bumped, every mod in existence would stop loading at once. `MOD_API_MIN`
  opens a range, and the two-release rule is: ship the behaviour, keep honouring the
  old contract, warn - *then* raise the floor. `LoadedModPlugin.api` records what each
  plugin declared, which is the mechanism without which the window is a promise
  nothing can keep.
- **The Borg left this repository, and is now installable.** It is in the
  catalogue at `v0.1.0`, so for the first time a player can actually run it -
  install, enable, and switch on the mod's own *Let the Borg play* toggle, which
  is a separate act from enabling the mod. `packages/borg` is gone; the port lives in
  [neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg) at
  `v0.1.0`, where it is a mod a player installs and switches on rather than a
  package with no importer. Its six runtime engine symbols now arrive as ESM live
  bindings filled from `ctx.core`, so `plugin.js` carries the whole Borg and not
  one byte of the engine - which the builder enforces and the mod's own tests
  measure. Two guards travelled with it and one is new: no file in the bundle may
  value-import the engine, and nothing may read an engine value at module top
  level, which exactly one site did.
- The plugin builder learned about `controller`. `validateModPlugin` in the host
  and `pluginProblem` in the SDK's builder are two hand-written copies of the same
  ABI check - deliberately, since the builder cannot import the front end - and
  they had drifted: the host accepted a controller-only plugin and the builder
  refused it as "would do nothing", which is precisely the Borg. A mod author only
  ever sees the builder, so the ABI had effectively not grown at all.
  `plugin-abi-agreement.test.ts` now reads both files and fails when the member
  lists or the message disagree.
- **The first-party mods take their gamedata from npm.** `qol` (v0.11.0) and
  `bug-fixes` (v0.12.0) each carried a hand-written `content.ts` that read the
  compiled pack out of a sibling checkout of this repository, because
  `@rpgm-tools/neo-angband-content` was not published; both files said in their own
  headers that they would collapse to one import the day it was. They have. The
  sparse checkout, `NEO_ANGBAND_REPO` and the plugin builder's dependency on a
  neighbouring working tree are gone from both, so each mod's CI now proves it
  against exactly what a third-party author would install. Their catalogue entries
  are re-pinned; `plugin.js` is byte-identical in both, and only `manifest.json`
  moved.
- **A mod can be an autoplayer.** `ModPlugin` gains `controller?(ctx)`: return an
  AgentController and the host binds it as the game's command provider. The host
  owns a single slot rather than letting mods call `ctx.core.installController`
  themselves, because that call swaps `state.nextCommand` and returns an
  uninstall that restores whatever preceded it - two mods doing it both succeed,
  the second silently wins, and unwinding out of order restores the wrong one.
  That is now a test in core rather than an assertion in a design document. The
  second autoplayer is refused by name; `command:add` is required and its absence
  is reported as that mod's fault. Optional member, so the ABI version stays 1 -
  but a controller-only plugin used to be rejected as "would do nothing", which
  is exactly the shape the Borg has.
- **`@rpgm-tools/neo-angband-content` reaches its own pack.** `0.11.0` published
  the compiled gamedata — 45 files, 2.0 of its 2.3 MB — and declared no `exports`
  subpath for it, so the one thing that package exists to do threw
  `ERR_PACKAGE_PATH_NOT_EXPORTED` at every consumer. `0.12.0` adds `./pack` (a
  Node loader with the pack directory, load order from the manifest, and a
  missing-file error that names what IS there) and `./pack/*.json` for bundlers.
  The tarball check that should have caught it was resolving each target path
  itself and importing the file, which bypasses the exports map entirely; it now
  installs into a real `node_modules` and imports by bare specifier, and fails
  when any shipped directory is reached by no subpath.
- **The project version is checked everywhere it is written down.**
  `node tools/version.mjs` prints all fourteen sites and fails on drift — it found
  the CHANGELOG two releases behind on its first run. `set` refuses any number
  that is not one of the three semver successors of the current one, and refuses
  `1.0.0` without `--release`. The package manifests are discovered by scanning
  `packages/`, so a new package is covered the day it is created.
- **The lint backlog is zero and is now a gate.** 136 warnings, sorted by whether
  the rule was right about a faithful C port: `no-useless-assignment` (37 hits,
  all C-style default-init locals) and `no-dupe-else-if` (7 hits, 6 of them fresh
  RNG rolls the rule reads as duplicates) are off with the counts recorded; the
  rest were fixed and promoted to error. 51 dead imports gone, and
  `reportUnusedDisableDirectives` is on so a disable comment cannot rot into a
  false claim. Deliberate exceptions carry a per-site reason naming the C
  function — or the gap, which is how three unwired Borg paths became visible.
- **The Borg reaches the engine through one file.** Its destination is its own mod
  repository, where the plugin builder refuses a bundled copy of the engine, so
  every bare value import is a line that has to change on the way out. Measured:
  37 files mention the package and 28 are `import type`, which compiles to
  nothing. The real coupling was six symbols across eight files, and they now come
  through `core-api.ts`, with a census test that fails if a second file grows one.
- **The game bundles no mods.** `qol` and `bug-fixes` moved to their own
  repositories, joining `neo-linoleum`; `FIRST_PARTY_MOD_IDS` is empty and a release
  build's discovered mod set is empty with it. All three are in the catalogue and
  install the same way a third-party mod does. Bundling the author's own mods had been
  hiding every defect in the install path behind three mods that never used it.
- **The mods-folder screen stopped claiming a browser without a directory picker has
  a fixed mod list.** It said "every mod here is one bundled into the app - fully
  manageable, but a fixed set"; both halves are false. Downloading a mod needs only a
  network request and the browser's own storage, so Firefox and Safari install mods
  like anything else, and the screen now says so. The "N bundled with the game" clause
  is dropped when N is zero rather than sitting on screen as a permanent zero.

- README and `docs/INSTALL.md` are repositioned for an alpha that asks for
  testers: what is unfinished, how to report a difference from the original, and
  running your own build from source first, since a hosted build changes under
  you and cannot be pinned in a bug report. The "full feature parity,
  statistically verified" claim is gone - that framing kept being wrong.
- `docs/INSTALL.md` now carries a full inventory of upstream's display levers
  and where each one is here, including the three that are genuinely missing
  (window resize for a larger map, the tile width/height multiplier, and
  subwindows).
- The options menu follows upstream's own `option_actions[]` order.

[Unreleased]: https://github.com/neostryder/neo-angband
