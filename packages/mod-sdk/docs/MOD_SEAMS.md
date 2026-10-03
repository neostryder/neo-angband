# Core mod seams: how a mod changes the game

The first-party `qol` and `bug-fixes` mods change the game through a small set of core seams. Each seam is described below, along with why it stays byte-identical to faithful Angband 4.2.6 when no mod touches it.

Neither mod is bundled. Both live in their own repositories and install like any other mod, so the file paths cited below are paths in those repositories. The seams belong to core, and the code that plugs into them lives outside this tree. Every citation reaches core through `ctx.core`, because that is the only shape that resolves from a mod folder.

Core is a faithful reproduction of Angband 4.2.6: everything in official Angband is in core, at its upstream defaults, and every new fix, tweak or feature ships as a mod. The seams let a mod reach into core without core carrying the mod's behaviour by default.

## 0. Grid rendering is a surface contract

The web shell's 80x24 renderer is now consumed as `GridSurface`
(`packages/web/src/term.ts`), rather than as the canvas-specific `GlyphTerm`.
It carries the operations a text grid actually needs: drawing cells and strings,
clearing, cursor control, invalidation, and an explicit `flush()` progress fence.
`GlyphTerm` is the first implementation, not the contract.

`Glyph.tile` and `Glyph.bgTile` carry a renderer-neutral `RenderAssetRef`; their
values do not accept a canvas context. A canvas adapter in `GlyphTerm` resolves
the existing tile packs, while another grid renderer can resolve the same asset
meaning differently without inventing Canvas2D just to satisfy a type.

Input, hit testing, logical readback and resize notifications are separate capabilities (`GridPointerInput`, `GridHitTest`, `GridReadback` and `SurfaceSizeEvents`). Pointer listeners return disposers, client-space hit tests return `null` off-grid, and size observers run only after retained grid content has been synchronously repainted. This keeps the old queued-paint and resize ordering, and leaves non-grid front ends to the later front-end seam.

> For how much of the game these seams can reach, and the longer list of what they cannot, see `docs/modding/MOD_REACH.md`.

## 0a. Menu rows are front-end data

Every `selectFromMenu` caller declares a stable, non-localized id, such as `core:game-menu`, `core:ignore` or `core:knowledge-group`. Its rows reach the single menu choke point with stable row ids and semantic data: `kind` says whether the row is a command, item, category, toggle or other choice, and `ref`/`data` carry the target, so an alternative front end never has to parse a display label.

Trusted plugin code with `registry:menu` can register a transformer per menu id. `menus.handlerFor(id)` returns the transform installed at that point in load order, so a later mod wraps an earlier one instead of discarding it. If a transformer throws, or returns anything other than an array of valid rows, its result is refused and reported on that mod's row, and the original menu still opens. The seam covers screen data only. No graphical or 3D front end ships yet, and choosing a total front end is a later phase.

## 0b. The live world is a frame stream

`packages/web/src/world-view.ts` defines the renderer-neutral `WorldFrame`. The extracted `world-render-data.ts`, called from the real `render()` path, produces one per map repaint and passes it to a single `WorldFrameSink`. A frame holds the viewport geometry and every in-bounds grid in order, unknown grids included. Each cell has the player's knowledge of it (`seen`, `remembered` or `unknown`), a semantic terrain feature id, ordered trap/object/monster/path layers, and the look cursor. The player is a separate layer painted last, matching upstream's glyph paint order, and is still part of the stream.

`ModPlugin.frontend?(ctx)` selects that sink. The last enabled mod in load order that declares it wins, and lower candidates are not called. Return a `WorldFrameSink` (the public type is importable with `import type { WorldFrame, WorldFrameSink } from "@rpgm-tools/neo-angband-mod-sdk"`) or `undefined` to keep the glyph frontend. On each real repaint the plugin receives a frozen, structurally owned snapshot of the frame, so keeping it can neither retain nor mutate `state.actor.grid`. A frontend that throws falls back to the glyph sink and is reported on that mod's row.

The frame also carries `regions`, the named parts of the screen (`map`, `messages`, `sidebar`, `status`) in grid cells and in CSS pixels. `packages/web/src/regions.ts` computes them from the same `viewport()` numbers `render()` draws with and projects them through `GlyphTerm.metrics()`. `map` belongs to the selected front end and the others to core, which lets a replacement draw inside the map rectangle instead of over the whole window. The field is optional only because a host with no fitted surface has no regions to give; when it is absent, draw nothing. `PLUGINS.md` has the author-facing version.

At startup `main.ts` runs its boot `render()` before it installs a selected `ModPlugin.frontend`, so the first frame is always glyph-drawn, even when a disk-loaded mod frontend will own later renders. A frontend has to cope with its display starting on a later repaint instead of receiving the boot frame.

With no replacement selected, the current `GlyphTerm` is the sink. It consumes the frame's optional `visual` fallback, including upstream's terrain-under-foreground tile pass for visible path markers over otherwise bare seen terrain. A future isometric or 3D front end would read the registry ids and visibility instead of parsing glyphs or CSS. `WorldVisual.asset` is the same renderer-neutral asset reference the grid contract uses and has no Canvas2D dependency.

The frame stream is host infrastructure, and two tests cover it. One runs the extracted producer that `main.ts` calls, compares its unmodded glyph-sink output with the pre-frame `term.put` tuples across visible, remembered, unknown, path, cursor and player-last cases, and tees the same frame by reference to an independent host sink. A disk fixture loads two real plugin folders, checks that only the later one receives the production frame, and keeps an unmodded glyph control.

## 0c. `ctx.display` is geometry, not a zoom feature

`ModPluginContext.display` exists once the web shell has a live game surface and is absent during content composition. It gives a display-oriented mod a way to change geometry without reaching into private module variables:

- `snapshot()` reports the real terminal cell metrics, current play or map viewport, cave-space origin and size, level bounds, layout, and named screen regions.
- `setGrid()` switches `GlyphTerm`'s existing reflow mode at runtime. The supplied target cell height produces a different addressable grid, and the resulting `WorldFrame.viewport.size` comes from that grid on the next paint. Passing `null` restores the faithful fixed 80x24 term.
- `setCamera()` reads or replaces the normal play camera origin. A non-null value stays pinned until the mod releases it with `null`; level changes and the game's own center-panel command release it too.
- `setMapView()` selects an explicit cave-space window while the `M` overview is active. The existing overview producer rebuilds that window for ASCII or graphics and the existing modal repaints it.
- `setSidebarExtent({ columns, topRows })` sets the sidebar's size: 0 to 32 columns in the left layout, and 0 to 4 header rows in the top layout. 0 gives that space to the map, for a mod that draws the vitals in a pane of its own. `null` restores the game's own size. `setTileScaling()` selects the existing automatic sampler or crisp nearest-neighbour sampling.
- `onKey()` subscribes through the one input door at capture priority, before ordinary play and modal owners. It only delivers keys; the mod decides which combinations it owns and cancels only those events.

The seam has no key binding, wheel or gesture handler, zoom ladder, camera delta, animation, persistence key or feature flag. All of that is the mod's behavior. Without a call, every default is unchanged: fixed 80x24, the ordinary panel camera, the full-level overview, the classic 13-column or one-row sidebar, and automatic high-quality filtering only while a tile is downscaled. `ctx.display` is ungated for the same reason `ctx.core` and `ctx.state` are: an in-process plugin already runs in the page realm, so a permission check here would imply an isolation the host does not provide.

## 1. `GameState.modHooks` - the behaviour seam

`GameState.modHooks` (`packages/core/src/game/context.ts`) is the one seam behind both first-party behaviour mods. It holds an optional `ModHooks` (`packages/core/src/mod/hooks.ts`), a plain interface in which every member is an optional function. An absent member means no mod touches that point, and core takes its faithful path after a single undefined check:

```ts
/* game/obj-list.ts - the whole shape of a seam read */
if (result === 0 && tiebreak) {
  result = tiebreak({ dy: ea.dy, dx: ea.dx }, { dy: eb.dy, dx: eb.dx });
}
```

A patch is off when its hook is absent. With no mod loaded the field does not exist, the optional call is never made, and the faithful branch is the only branch there is. Core has no flag map to consult.

### The seam replaced a flag registry, and why

An earlier build used a string-keyed flag registry: `GameState.modRules` (a `Record<string, boolean>`) read through a core helper, `modRuleEnabled(state, name)`, so a ported core function looked like `if (modRuleEnabled(state, "bugfix.objectListOrder")) { corrected } else { faithful }`.

The registry was removed on 2026-07-29. A flag-gated fix is still in core: core shipped the fix body, core's tests ran against it, and core carried the mod's own flag name as a string literal. Deleting the mod folder would not have removed a line of it. `modRuleEnabled` was deleted outright instead of being left unused, so no future core function can reach for it; a tombstone comment in `packages/core/src/game/context.ts` marks where it was.

What core still has to contain is the seam itself: one named, documented extension point per behaviour a mod may override. Behaviour modding cannot work without that much. The difference is that a seam is generic and open to any mod, and it has no opinion about what plugs into it.

### The hooks, and the one core call site each serves

Each member of `ModHooks` documents its single call site. A hook with no written call site cannot be checked for still being wired, which is the failure the call-site census exists to catch.

The `Fold` column uses the code's own vocabulary. `MOD_HOOK_FOLDS` (`packages/core/src/mod/hooks.ts`) is keyed by `keyof ModHooks`, so a hook added to the interface without a fold does not compile, and the mod manager renders its conflict report from the same table. Call sites are named by file and by the symbol that reads the hook, not by line number, since a line number in a document has no test behind it and goes stale on the next commit.

| Hook | Fold | Call site | Faithful answer when absent |
| --- | --- | --- | --- |
| `walkBlockedByDiggable(state, grid, deps)` | `last-answer` | `game/cave-cmd.ts` (`movementAutoDig`), reached from `walkAction` in `game/player-turn.ts` | `?? null` - bump the wall, spend nothing, draw no RNG |
| `objectListTiebreak(a, b)` | `last-answer` | `game/obj-list.ts` | `?? 0`, i.e. leave the entries equal (stable sort keeps collect order) |
| `projectionRadius(rad, maxRange)` | `chained` | `world/project.ts` (`computeProjection`, reached through `ProjectParams.resolveRadius`, which `game/project-cast.ts` fills from `state.modHooks`) | the radius as given, unchecked against `max_range` |
| `levelGenerated(gen, quest)` | `all-must-agree` | `gen/generate.ts` | accept the level as generated |
| `artifactCommit(aidx, alreadyCreated)` | `all-must-agree` | `obj/make.ts` | commit it unconditionally |
| `partialStackMerge(drained, receiving)` | `all-must-agree` | `game/gear.ts` (`combinePack`'s call to `objectAbsorbPartial`, non-quiver branch only) | proceed with the merge unconditionally |
| `packOverflowVictim(state, departedQuiver)` | `last-answer` | `game/obj-cmd.ts` (`packOverflow`'s `handle === 0` path, reached from `session/game.ts`'s `overflowPack`) | `?? null` - shed `state.gear.inven[length-1]`, the trailing entry |
| `historyAdd(entry)` | `all-must-agree` | `session/game.ts` (the `HIST.SLAY_UNIQUE` path) | `?? true` - write every entry, duplicates included |
| `historyDisplay(entry, playerName)` | `chained` | `packages/web/src/screens.ts` (the HOST's shared history rows, not core) | `?? entry.what` - show the stored text unchanged |
| `saveNoiseScent()` | `any-yes` | `session/save.ts` | `?? false` - omit the heatmaps, which is upstream's behaviour and upstream's bug |
| `shapeLearnObviousFlagsDirectly()` | `any-yes` | `obj/knowledge.ts` (`shapeLearnOnAssume`) | `?? false` - never learn a shape's obvious flag directly, the 4.2.6-era gap this hook exists to let a mod close |
| `levelRevisited(chunk, frozenAt, now)` | `all-observe` | `session/game.ts` (persistent-level and single-combat restore paths) | nothing: resume the frozen chunk unchanged |
| `messageText(raw)` | `chained` | `packages/web/src/main.ts` (the HOST's single message sink, not core) | `?? raw` - show what core was given, warts and all |
| `screenText(raw, site)` | `chained` | `packages/web/src/overlay.ts` (the HOST's `showTextScreen`, through `restateView` in `screen-view.ts`, and its row-0 prompt functions) | `?? raw` - show the screen text or prompt as built |
| `characterBackground(text)` | `chained` | `packages/web/src/screens.ts` (the HOST's `historyTextBlock`, which feeds the character sheet, the birth screen and the character dump) | `?? text` - show the background get_history stored |
| `objectInfoText(text, site)` | `chained` | `obj/object-info.ts` (`objectInfo`, once per fragment of the finished textblock) | `?? text` - write the fragment unchanged |
| `effectIntro(intro)` | `chained` | `obj/object-info.ts` (`describeEffect`, for the unknown-effect sentence and the known-effect lead-in) | `?? intro.text` - write 4.2.6's introduction |
| `optionsChanged(snapshot)` | `all-observe` | `packages/web/src/options.ts` (`notifyOptionsChanged`, at the end of `runOptionsMenu`) | nothing happens; core reads no answer |
| `monsterBecameVisible(mon)` | `all-observe` | `game/known.ts` (`updateMon`'s "it was previously unseen" branch, reached from `updateMonsters`, `monsterSwap`, and every other `updateMon` call site) | nothing: the visibility flag was already set with no mod loaded |
| `artifactIdentified(obj, artifact)` | `all-observe` | `obj/known-object.ts` (`objectTouch`'s ASSESSED transition, reached from `pickup.ts`'s `playerPickupAux`, `game/known.ts`'s `squareKnowPile`, and `wizard.ts`'s item-edit path) | nothing: the object was already assessed with no mod loaded |

`optionsChanged` and `levelRevisited` are notifications: core asks neither of them a question. Every other hook's return value changes what the engine does next, so its fold has to decide whose answer wins. A notification returns nothing and folds as **all-observe**: every listening mod is told, in load order, and none can overrule another. `levelRevisited` passes the live restored chunk plus unrounded turn endpoints, so a tracking mod can reproduce the engine's world-tick boundary exactly. `optionsChanged` is fired by the host and tells a mod that the player has finished changing settings.

`monsterBecameVisible` and `artifactIdentified` are notifications of the same kind, fired from inside core instead of the host. Each passes a live reference so a mod can identify the subject without a second lookup. `monsterBecameVisible` passes the `Monster` itself (its `race` and its grid), and `artifactIdentified` passes both the `GameObject` and its already-resolved `Artifact` record, where `artifactCommit` hands over an `aidx` that a mod has to look up in the artifact registry. Both fire only on the transition. `monsterBecameVisible` fires on the same "it was previously unseen" branch that increments the race's "sights" lore counter, so it fires once per fresh sighting and never on a turn where an already-visible monster stays visible. `artifactIdentified` fires when the object's `OBJ_NOTICE.ASSESSED` bit goes from unset to set, which happens once per object because the bit is never cleared.

Three parts of `optionsChanged`'s behaviour are contract, and a mod can rely on them:

- It fires only when something changed. A player who opened the `=` menu and pressed ESC has changed nothing, so the hook does not fire.
- Each mod gets its own copy of the snapshot. A mod that keeps the object it was handed, as a mod persisting settings will, never finds it edited later by the mod that ran after it.
- The host fires it from one chokepoint inside `runOptionsMenu`, not from that function's four callers. `OptionState` is the pure port of `option.c` and knows nothing about menus, and a hook wired at each call site would be missed by the next call site someone adds.

Two hooks are contractually RNG-free: `levelGenerated` and `artifactCommit`. They run inside the generation and object pipelines, where one extra draw desynchronises every draw after it and a seed stops reproducing its dungeon. Core passes them no `rng`. A mod can still break the contract by reaching for a global, so the test suite runs generation with a hook installed and asserts the level is bit-identical.

`partialStackMerge` and `packOverflowVictim` are RNG-free for the same reason. `partialStackMerge` runs on the main object stream inside `combinePack`, and `packOverflowVictim` receives only two already-computed facts (`state`, `departedQuiver`) and has no path back into the RNG.

`walkBlockedByDiggable` is RNG-free only on its decline path, which is a stricter requirement and easier to break: faithful core bumps the wall without drawing, so a hook that rolls a dig check and then declines has already moved the stream.

### The text hooks

Five hooks let a mod reword text that 4.2.6 writes: `messageText`, `screenText`, `characterBackground`, `objectInfoText` and `effectIntro`. A mod may fix spelling, spacing or wording, but must keep the meaning and pass any text it does not recognise through unchanged. The hooks run only when text is shown, so the save keeps upstream's text and turning the mod off brings it back.

`screenText` gets the text of any screen opened with `showTextScreen`, a help page for example, and the prompt drawn by `getString`, `getCheck` and the other row-0 prompt functions in `overlay.ts`. Each piece arrives once, when the screen opens or the prompt appears. The second argument is a `ScreenTextSite` with the screen id and the part; for a table cell it adds the column key and the rest of the row. A mod needs the row in `core:equip-cmp-select-help`, where two rows read "move selection one page up" and only the `"n, PgDn"` row is a typo. Prompts use the site `{ screen: "core:prompt", part: "prompt" }` and arrive before "[y/n] " is appended; the typing field then starts right after the reworded prompt.

`characterBackground` gets the background paragraph built from `history.txt` in one piece, before the 72-column wrap, so a phrase split across two screen lines still arrives whole. A content patch can correct a phrase too, through the history record's `core:<chart>--<roll>` ref. The two reach different characters: the patch changes the text a new character is born with, while `characterBackground` also rewords the background of a character that already exists.

`objectInfoText` gets an item description one fragment at a time, in the pieces `obj-info.c` appends, so `"Affects your stealth\n"` comes as one string. Its second argument, an `ObjectInfoTextSite`, says which section wrote the fragment, which item it describes and whether the player knows that item's kind. The section is `stats` for the "Affects your" lines, `effect` for everything describe_effect writes, `break` for the blank line between two sections, and so on through `ObjectInfoSection`. The item is given as its `tval`, spelled as in object.txt, and its `kind`, which holds only what the player knows. Once the player knows the kind, `kind` is its object.txt name, such as `"Cure Light Wounds"`, and `aware` is true. Until then `kind` is the flavour the player sees, such as `"Light Blue"` or a scroll's title, as the knowledge menu lists it. A section only ever arrives with a line the player can read, so a slay or curse whose rune is still unknown sends no `slays` or `curses` fragment. Item inspection, store examine, object recall, the character dump, spoiler files and a plugin's `inspectItem` all pass through it.

`effectIntro` gets the words that open an effect description, such as 4.2.6's "It can be aimed.\n" or "When activated, it ". The `EffectIntro` it receives also says whether the effect is known, the item class, whether it is aimed, and whether it comes from an activation. From those a mod can write the later upstream wording, "It requires a target." or "When used, it ". The item class is what tells a mod when to say "It may require a target.", because 4.2.6 marks every unknown wand and rod as aimed.

### The fold rule, which differs per hook

Two enabled mods may both want the same hook. Core holds exactly one `ModHooks` and knows nothing about mod identity, ordering or enablement. The host collects each enabled mod's contributions in load order and folds them with `composeModHooks` (`packages/core/src/mod/hooks.ts`). Content works the same way: core consumes a composed result, never the pack list.

One rule holds across every fold: no mod's answer is discarded in favour of an earlier mod's. Where a fold has to pick a single answer, the last mod in load order supplies it, which is what the mod manager's "Move later (loads last, wins conflicts)" row promises. Where a fold combines answers, nothing is discarded and load order has nothing to decide. Per fold:

- **`all-must-agree`** (`levelGenerated`, `artifactCommit`, `partialStackMerge`, `historyAdd`) is conjunctive: every contributor runs and the first refusal decides. This is the only safe fold here, since a mod that vetoes a duplicate artifact must not be overruled by a later mod that has no opinion. For `levelGenerated`, every contributor still runs after an earlier one has repaired the level, because the first mod's repair does not satisfy a second mod's invariant. Only a refusal short-circuits, since the level is being thrown away anyway.
- **`chained`** (`messageText`, `screenText`, `characterBackground`, `objectInfoText`, `effectIntro`, `projectionRadius`, `historyDisplay`) runs in load order with each contributor seeing the previous one's output, a `reduce` over the contributors. Two mods narrowing one blast for two unrelated reasons both get their narrowing, and the last one still speaks last.
- **`last-answer`** (`walkBlockedByDiggable`, `packOverflowVictim`) asks the contributors in reverse load order and stops at the first non-`null` answer. The last mod's handling wins, and two mods cannot double-spend one turn's energy (or, for `packOverflowVictim`, second-guess a redirect an earlier mod already chose). The reversal is the whole mechanism; reading the loop as forward inverts the rule.
- **`any-yes`** (`saveNoiseScent`, `shapeLearnObviousFlagsDirectly`) is disjunctive, a `some()`. One mod asking for the data is enough, because the data is additive and a second mod has nothing to object to.
- **`last-answer` for a comparator** (`objectListTiebreak`) is the same reversal read as a lexicographic chain: the last mod's ordering is the primary key, and earlier mods break only the ties it leaves. The result is still a total order, and later still wins.
- **`all-observe`** (`optionsChanged`, `levelRevisited`, `monsterBecameVisible`, `artifactIdentified`) runs every contributor in load order and reads no answer, so there is nothing to win.

`composeModHooks` returns `undefined` when nothing contributed, and the host then leaves the field absent instead of storing an empty object. From core's side, "no mod loaded" and "a mod loaded that touches nothing" look the same, which is the guarantee the seam exists to give.

### What happens when a hook throws

A hook is third-party code running inside a turn, so it can throw. The host wraps each mod's contribution with `guardModHooks` (`packages/core/src/mod/hooks.ts`) before folding it. Guarding per mod is what lets a fault be attributed, since the host holds the mod id and core does not.

A throw becomes that hook's neutral answer, which is per hook and matches what core would use with no mod loaded: `null` for `walkBlockedByDiggable` and `packOverflowVictim`, `0` for `objectListTiebreak`, `true` for the four vetoes (`levelGenerated`, `artifactCommit`, `partialStackMerge`, `historyAdd`), `false` for `saveNoiseScent` and `shapeLearnObviousFlagsDirectly`, the text as given for `messageText`, `screenText`, `characterBackground` and `objectInfoText`, the text core was about to write for `effectIntro`, the entry's stored text unchanged for `historyDisplay`, and the radius as given for `projectionRadius`. To the fold, a broken mod looks like a mod with no opinion at that point, and the other mods' answers stand. `levelGenerated` accepting on a throw matters most: rejecting would re-roll the level, throw again, and keep re-rolling until `cave_generate` gave up, so one broken hook would leave the game unable to reach any level.

The hook is then not called again for the rest of the session. This is tracked per (mod, hook), so the mod's other hooks keep working.

Letting the throw escape would be worse. It does not undo what the mod did before throwing, it abandons the rest of the turn's bookkeeping, and it reaches the shell as a bare exception from a function that did not know a mod was inside it, which shows up as a frozen screen with no mod named.

The host handles the rest. `packages/web/src/mod-taint.ts` treats a mid-turn fault as terminal for the session: it refuses every further save, puts the fault on the mod's row in the manager, and shows a modal that names the mod and offers a reload. The save gate is in `persistSave`, not `autosave`, because a level change, `S`, the options screen and `pagehide` all force a save too. Before this existed, the only protection for the save file was that the autosave sits at the end of the turn, so the exception unwound past it.

### Why `null` is the decline sentinel, and not `0` or `false`

For the `last-answer` fold, the decline sentinel cannot be a value the hook might legitimately return. `walkBlockedByDiggable` returns an energy cost, and `0` is a real energy cost; if `0` meant "decline", a mod could not say "I handled this action and it costs nothing". `null` keeps the two apart. The fold tests `energy !== null`, so a hook returning `0` handles the walk and stops the chain, while `null` passes it to the next mod.

Zero energy is honoured end to end. `movementAutoDig` returns the hook's answer with `?? null`, and `walkAction` tests `dug !== null`, so a mod may consume a blocked walk, charge nothing, and not fall through to core's faithful bump. This used to be `?? 0` against a `dug > 0` test, which made "handled for free" and "no mod answered" the same answer and silently discarded the first; the hook interface documented a case the engine could not express. If you are writing a mod that consumes a blocked walk without spending a turn, return `0`, not `null`.

`objectListTiebreak` uses `0` as its "no opinion" answer instead of `null`, because `0` is also the faithful answer there ("these two entries are equal"), so the two readings agree and no third value is needed.

## 2. How a patch is turned on - and where the patch's code lives

A mod does not run code to flip a flag, and core never sees a flag name. Flags still exist, but they are now purely between the host and the mod:

1. The mod declares its patches in `manifest.json` under `rules`, each an entry of `{ "flag": "qol.autoDig", "title": "...", "description": "...", "default": true }`. A rule that changes one-time plugin setup, such as code in `register()`, also declares `"requiresReload": true`, and its choice takes effect after the manager reloads the game instead of live.
2. `packages/web/src/pack.ts` `loadEnabledModRuleDecls()` gathers the `rules` of every enabled mod, in load order.
3. `packages/web/src/mod-store.ts` `resolveModRules(decls, choices)` computes the effective map: for each declared rule, `choices[flag] ?? rule.default`. The player's choices come from each mod's **Fixes & tweaks** submenu and persist in `localStorage`, in the `ruleChoices` field of the profile's `neo-angband/web/mod-state` document. They are a client setting, like the enabled-mod set, and are not part of the savefile.
4. `packages/web/src/mod-hooks.ts` `resolveModRuleFlagsByMod()` slices that map per mod. `activeModHooks()` then calls each enabled mod's entry point once, in load order, with only that mod's own flags, and folds the results with `composeModHooks`.
5. `packages/web/src/main.ts` passes the composed object to `startGame` / `loadGame` as `opts.modHooks`.

The entry point is the mod's `plugin.js` (`plugin.ts` before it is built), which default-exports a `ModPlugin`. Its `hooks` member is the behaviour half:

```ts
export default defineModPlugin({
  hooks(ctx) {
    // ctx.flags holds THIS mod's own rule flags, and nothing else.
    // ctx.state is deliberately absent here - see PLUGINS.md.
    return { /* ModHooks members */ };
  },
});
```

An earlier ABI had each mod default-export a bare `(flags) => ModHooks` from its own `hooks.ts`. That signature was removed outright, so there is one entry point to document and one to test. A mod compiled into the build is discovered by a glob over `packages/web/mods/*/plugin.ts`, and a mod installed from disk or from a repository has its `plugin.js` loaded from wherever its folder is. Both reach the same adapter and the same `composeModHooks`, so the host knows no mod's id and no mod's flag names. A mod with no behaviour, which includes every pure content mod, ships no `hooks` member or no plugin at all and is never called. (The linoleum tile mod was the standard example until its 0.15.0, which added a `plugin.js` holding the kin rule core handed over. It still contributes no turn hook, because a tile filler belongs in `register()`.)

Three rules make this work, and a third-party behaviour mod has to keep them (they are also spelled out in the header of `neo-angband-mod-bug-fixes/plugin.ts`):

1. **The mod reads only its own flags.** Its flag map is sliced per mod, so it cannot read or act on another mod's toggles, and its behaviour cannot silently depend on which other mods the player enabled.
2. **Never return a function that disables itself.** `historyAdd: (e) => flags.x ? !e.duplicate : true` behaves the same but is wrong. An installed hook tells core that something wants that point, and under `composeModHooks` a hook that is present but has no opinion still runs, and for the first-handler hooks it can shadow another mod's.
3. **A disabled mod is never called.** `enabledModIds()` drives the loop, so returning `{}` means "enabled, with every patch off".

Rules read by one-time plugin setup, such as `register(host, ctx)`, work differently. Registration installs live handlers once, after the game exists, so changing their flags cannot replace what is already registered. Declare `"requiresReload": true` on each such rule; the manager then saves the choice and shows its ordinary reload prompt. Do not set it on a hooks-side rule, because the host rebuilds `modHooks` live for those.

**The patch bodies are the mods' code.** Outside comments, `packages/core/src` has no `bugfix.*` or `qol.*` string, no staircase repair, no duplicate-artifact guard and no message rewriter. `ensureStairsReachable` lives at `neo-angband-mod-bug-fixes/stairs.ts`, `miscStringFix` at `neo-angband-mod-bug-fixes/strings.ts`, and the auto-dig at `neo-angband-mod-qol/plugin.ts`. Delete a mod folder and its behaviour goes with it.

**Defaults.** The player installs and switches whole mods; a patch is part of a mod and is never installed on its own. Defaults apply in this order:

- **A disabled mod's patches do not exist.** `enabledModIds()` drives hook discovery, so a disabled mod's entry point is never called and contributes no hook. `composeModHooks` returns `undefined` when nothing contributed, which leaves `GameState.modHooks` absent and every core call site on its faithful path. There is nothing to toggle, and nothing appears in the menu.
- **Enabling a mod turns its whole patch set on at once.** Enable `bug-fixes` and you get every fix in it; enable `qol` and you get every tweak in it. Each patch can then be switched individually in that mod's own Fixes & tweaks submenu, so a player can take the set minus one patch. That per-patch switch is the only reason the toggles exist.
- **Every mod is off on a fresh install**, the first-party ones included (`DEFAULT_ENABLED_MODS` is `[]`, `mod-store.ts`). An untouched install therefore has no mods and no patches, and plays faithful 4.2.6.

So `default: true` on a rule means "on once its own mod is enabled". It never means "on in a fresh install", and it never means a flag is sitting in core waiting to be switched; core has no flag to switch.

> An earlier build implemented rules with a trusted in-process plugin plus a `registry:rules` capability and a `RulesFacade`. The declarative manifest field above replaced it. `registry:*` capabilities remain for other trusted-plugin seams that carry code (effect, room, command, monster, vocab); `MOD_REACH.md` lists which of those have real, mod-reachable code today and which are still a design note.

## 3. `StartGameOptions` / `LoadGameOptions`: `modHooks`, and the now-opaque `modRules`

`startGame` and `loadGame` (`packages/core/src/session/game.ts`) each accept an optional `modHooks` and store it on `GameState`; when it is absent, core is faithful. The session threads the live `state.modHooks`, read fresh rather than captured, into the deps bags of the pure layers that need it, `GenDeps.hooks` (`gen/generate.ts`) and `MakeDeps.hooks` (`obj/make.ts`), because those layers have no `GameState` in scope.

`modRules` still exists on `GameState` and is still seeded at start and load, but core treats it as opaque: nothing in `packages/core/src` reads it. It records the player's choices, because the Fixes & tweaks menu is built from it and the host re-reads it. Since core does not branch on it, writing it alone does nothing. The live per-patch toggle (`applyRuleLive`, `packages/web/src/main.ts`) therefore has to rebuild the hooks. When nothing contributes, it has to `delete game.state.modHooks` instead of assigning `undefined`, so "no mod loaded" stays an absent field and never becomes an empty object core could detect.

Built-in Angband options are not set through any of this. They ship in core at their upstream defaults (`OPTION_ENTRIES.normal`) and are restored from the save on load. (The removed `interfaceDefaults` seam used to do this.)

## 4. `GameState.autoDigStep` - a plumbing indirection, not a mod seam

`walkAction` (`packages/core/src/game/player-turn.ts`) calls `state.autoDigStep?.(state, next)` when a walk is blocked. The session installs it (`session/game.ts`) pointing at `movementAutoDig` (`game/cave-cmd.ts`), whose entire body is the `walkBlockedByDiggable` hook read plus `?? null`, so it holds no mod's behaviour and is not a second seam. It exists so the movement code does not have to import the dig internals. With no hook installed it returns `null` without drawing from the RNG, and the walk falls through to the faithful bump.

Only `null` falls through. A number is honoured, including `0`, which means a mod handled the walk and charged nothing; [Why `null` is the decline sentinel](#why-null-is-the-decline-sentinel-and-not-0-or-false) has the history. If your mod consumes a blocked walk without spending a turn, return `0`, not `null`.

The two core primitives a digging mod needs are public and reused rather than
reimplemented: `movementTunnelTest` (`cave-cmd.ts`, RNG-free, which is what
lets the mod decline for free) and `tunnelAux` (one real `do_cmd_tunnel_aux`
attempt with the upstream roll, messages, and payouts).

## 4a. `simulateLoadout` - a loadout the character is not wearing

The seams above let a mod change the game. `simulateLoadout` lets a mod ask what a character would be like wearing something else, which the engine could not answer before.

`calc_bonuses` (`packages/core/src/player/calcs.ts`) derives that for the gear the character has on, and every read surface comes from it: `GameState.playerState`, `PlayerActor.combat`, `PlayerView`. There was no version for a loadout nobody is wearing. A caller that wanted one had to sum the candidate item's own bonuses, which is a second implementation of `calc_bonuses` that misses the interactions (a ring of strength changing the blow count, a cuirass costing a caster half their mana, weight costing speed) and can drift from the first with nothing to catch it.

```js
const sim = view.simulateLoadout({ wield: [{ from: "gear", handle }] });
if (sim) {
  sim.delta.ac;            // armour class difference
  sim.delta.maxSp;         // what it costs a caster
  sim.delta.resists;       // per element, ELEM order
  sim.after.player.blows;  // the frozen PlayerView for that loadout
  sim.after.stats;         // every field of upstream's player_state
}
```

- **It runs the real derive.** `state.derivedFor`, installed by `wireGame`, is `calc_bonuses` with `update: false` over the same options bag the live refresh uses, so the bound timed table and the curse registry come with it. That is the only source. A derive assembled by a caller would have to guess at both, and a hypothetical loadout measured with a thinner bag than the live one gives a wrong answer that looks like a right one. Where no session installed the accessor (the worldless harness), it is absent and the function returns `null`.
- **It writes nothing**: not the state, the player, the gear or any object. `update: false` keeps `calc_bonuses`' own two faithful side effects (zeroing `TMD_FASTCAST` on a stun grade, and the town-light redraw flag) out of it. A test asserts that the live `PlayerState` object is the same object afterwards, not just an equal one.
- **Changes are expressed as slots and gear references, not equipment arrays.** `wield` routes each item through the engine's own `wield_slot`, so the second of a pair of rings lands in the second ring slot as it would in play. `carry` takes something into the pack, `remove` empties a slot into the pack, and `release` gives a stack up entirely, emptying its slot when the handle names worn gear. A reference is a gear handle, a shop plus a stock index for a ware (which is not in the gear and so has no handle), a grid plus a pile index for an item on the floor, or a `GameObject` for a caller inside the engine. A reference that names nothing is skipped and listed in `unresolved`, so a decision ladder evaluating a hundred candidates does not fail on one stale handle.
- **The answer is every derived field, not a score.** An autoplayer reduces it to one number, while a player comparing two items wants to see which resist was traded for which. A scalar serves the first and not the second, and the two should never disagree about the underlying derive, so `before`, `after` and `delta` carry every field of `player_state` plus max hitpoints, max mana, the armour encumbrance and the carried weight. `neo-angband-mod-borg` uses a fraction of it today.

An item on the floor is named as `{ from: "floor", x, y, index }`: the grid it lies on and its index in the pile there, the same numbers `inspectItem`'s floor form takes and `floorItems()` reports as `floorIndex`. It resolves only when the player remembers that exact object on that grid. An object on a square the player has never seen, or one only sensed, lands in `unresolved` like a stale handle, and so does an index past the end of the pile or a grid off the map. Wearing a floor item adds its weight to the carried total, since the character has to pick it up first. A change that names a floor item needs `state:floor.read` as well as `state:player.read`, and `compareLoadoutSlots` takes the same reference (section 4k).

The accessor lives on `AgentView`, so the `ItemView`s in the answer are built with the same `AgentViewDeps` as the live view's. That matters for correctness: an object that carried `value` in one read and not the other would change what an agent decides about the same object depending on which read produced it. The exported `simulateLoadout(state, change, opts)` is the same function, for callers inside the engine.

## 4b. `ctx.ui.openPanel` - a piece of web page above the game

The earlier UI seams all draw onto the same character grid with the same seven methods. `ctx.ui.openPanel` hands a mod a shadow root instead. A grid cannot carry a form: fields with a caret, a list with a scrollbar, a table the player sorts by clicking a column. `RegionSurface` publishes `size`, `clear`, `print`, `prt`, `eraseToEol`, `setCursor` and `hideCursor`, and a text editor built from those would have to reimplement a caret, a tab order and a focus model inside a terminal, all of which every browser already has and this codebase does not.

```js
// register(host, ctx) - the context that carries `ui`
const panel = ctx.ui.openPanel({ id: "editor", modal: true, label: "Monster editor" });
panel.root.innerHTML = `<style>:host{all:initial}</style><input id="name">`;
panel.root.getElementById("name").focus();   // and it can actually be typed into
await panel.closed;                          // the player is done, however they finished
```

Six things to know, and the first two are the ones that surprise most authors:

- **Escape belongs to the player, and your panel cannot have it.** On a real Escape the input door closes the topmost panel before your panel is offered the key, and focus returns to the game, not to whatever your panel had focused. Use another key for your own "back". A modal panel also carries a close control that the host draws outside your shadow root, because the game is played on touch and a phone has no Escape key. That control gives the player a way out of a panel that has stopped responding. It is no defence against a mod that means harm; see the last bullet.
- **A non-modal panel's container takes no pointer events.** It is a full-viewport rectangle, so otherwise it would be an invisible layer eating every tap meant for the dungeon underneath. Style `pointer-events: auto` onto the elements you want clickable, as the game's own touch action bar does with its buttons. `modal: true` takes the pointer, takes focus on mount, and gets `role="dialog"`; a plain panel takes neither and gets `role="group"`.
- **The host fits the container to the visual viewport.** On a phone, opening the virtual keyboard can shrink the visible rectangle while the layout viewport keeps its old height. The host follows `visualViewport` for the panel and the canvas, offset included, so a modal panel does not extend behind the keyboard. A panel with fields near its lower edge should still call `element.scrollIntoView({ block: "center" })` when a field receives focus, because a browser may reserve more of the visible rectangle for its own input chrome.
- **Where the caret is decides who gets each keystroke.** The game's front end has one keydown registration (on `window`, capture phase, installed at import), and every modal handler behind it calls `stopImmediatePropagation`. A real field would be unusable unless the input door stands down, and it stands down for a key whose composed path runs through the top panel before reaching the game's canvas. Put the caret in your field and your field gets the keys; click back on the map and the game gets them. This is the one thing the capability grants that a mod could not already do.
- **It fails open, and the invariants are checked on each keystroke.** Holding the shadow root means holding `root.host`, so a mod can detach the container, move it, or make it a parent of the game's own canvas. Each of those is checked as the key arrives, not once at mount, and any of them closes the panel and gives the keyboard back. A panel that is not at the top of the stack is inert. Failing the other way would be worse: a suppression path that errs towards suppressing leaves a game that no longer responds to the keyboard, and a player cannot tell that from a crash.
- **When the player closes a panel, your mod is paused briefly.** Nothing stops a `closed` continuation from opening a replacement, and a mod doing that in a loop would turn the one key that gets the player out into a key that makes the panel flicker. Closing your own panel costs nothing, so an authoring tool's ordinary step-to-step navigation is unaffected. At most eight panels can be open at once for the same reason: Escape closes one, so the count is the number of presses back to the game.
- **The shadow root is for hygiene and is not a sandbox.** Styles do not cross it in either direction, so your `#title` cannot collide with anything and your stylesheet cannot accidentally restyle the accessibility live regions or the touch bar. It is closed, so another mod cannot read your panel's fields through `element.shadowRoot`. That is all it does. Your code and every other mod's run in the page's own realm, so none of this contains anybody. An iframe would not contain them either: it would fence off the half that draws a form while the half holding `ctx.core` sat outside it, it would turn one authoring tool into two programs and a message protocol, and it would put the keyboard somewhere the host can no longer offer a way out. Like every other capability in this system, the grant is a declaration the player reads (see `PLUGINS.md`, "What a capability gates").

A mod's open panels come down when the mod set changes, after every plugin's `uninstall()` and before the save. Your last moment on a live state can still read what the player typed into one, and nobody is left looking at a mod's interface over a game that is reloading. New panels are refused from the moment teardown begins. There is no other lifecycle: disabling a mod re-composes the page, as it does everywhere else in this system, and a panel that is not mounted again on the way back up stays gone.

## 4c. `ctx.installMod` - a mod handing the game a mod

`ModProject` has emitted a mod folder's exact bytes since it was written, and its own header names the caller it was waiting for: "a builder that returned paths and contents is equally usable from a CLI, from a test, and from an in-game mod editor." No in-game editor could exist, because nothing a mod could reach turned bytes into an installed mod. `HostDir` has no `MODS` entry, `RAW_FS_OPS` has no `mkdir`, the desktop shell's file handler has no write route into `mods/`, and an install lands in IndexedDB, not on a filesystem.

```js
if (!ctx.installMod) return;                      // no grant, or no door
const { files } = project.emit();                 // manifest.json + one file per record file
const bytes = zipSync(Object.fromEntries(files.map((f) => [f.path, enc(f.contents)])));
const outcome = await ctx.installMod(bytes);
if (!outcome.ok) show(outcome.problem);           // one whole sentence, always
show(outcome.lines.join("\n"));                   // the manager's own wording, either way
if (outcome.ok) await ctx.reloadGame?.();         // save, tear down, come back on the same character
```

Five things about it:

- **It accepts content only, which keeps the grant proportionate.** An archive that ships code (`.js`, `.mjs`, `.cjs`, `.ts` or `.wasm`, under any name, not only `plugin.js`) is refused, and so is one whose manifest asks for any capability. Without that rule, "may install a mod" would mean "may write a program, install it, and have the player enable something it authored", which is far more than the consent list says. With it, the grant means what it says: this mod may add records, patches and removals to your library.
- **Installing is not enabling, and you need to tell the player so.** What you install arrives switched off, because no mod is ever enabled by default in this game. The player finds it on the Mods screen, reads its capability list and turns it on, and enabling a mod takes effect on reload. The monster your builder just wrote is not in the dungeon this turn, and a tool that implies otherwise makes the player think it is broken.
- **The origin is pinned on first import and checked on every later install.** A zip is the one route where the game cannot go and ask where a mod came from, so the manifest's own claim is the only provenance available, and pinning it makes the first install the moment of trust. A builder should therefore persist the `repository` string with the draft and emit the same one every time; otherwise its second install of the same mod is refused. Do not invent a plausible GitHub URL the player does not own. That pins their work to somebody else's repository, and the update check will later ask that repository for tags.
- **The install is recorded as yours, not the player's.** A mod that arrives this way gets `InstalledModMeta.installedByModId` set to your mod's id, alongside the `repo`, `tag` and per-file digest that every install records. That is separate from the origin pin: the origin says where the bytes claim to come from, and this says which mod asked the game to fetch them. The mod manager's detail pane shows it as `Installed by: <your id>`, so a player who used a mod-building tool can tell which of their mods it wrote. A zip the player picked themselves never sets the field, so its absence means the player did it, not that the source is unknown.
- **A refusal is returned as a value and never thrown.** Every failure comes back as `{ok: false, problem}` with one whole sentence in it, including a failure inside IndexedDB, because the caller is a mod that will put the answer in front of a player. The bytes are copied before anything asynchronous runs, so what was inspected is what gets stored, even though you still hold the array you passed.
- **`lines` is the host's own wording, and printing it is the right default.** Every outcome carries the lines the Mods screen prints for the same install, built by the same functions: the headline, the closing note that nothing else was touched, and, for a standards refusal, one row per unmet requirement plus the advice under them. A mod that writes its own sentence teaches the player a second vocabulary for one concept, and a failure that reads differently depending on which route the archive came through is one the player cannot look up. `problem` is still there for a log or a one-line row.

To apply the install, call `ctx.reloadGame()`. It sits behind the same capability because installing and applying are one act. Content composes at load, so what you just installed is not in the game until the page comes back. `ctx.reloadGame()` runs the game's own mod-change sequence: every plugin's `uninstall()` runs, the autoplayer hands the keyboard back, the live character is written down, and the session resumes that character instead of landing on the title screen. Calling `location.reload()` yourself skips all four steps, and the third one is the player's progress. The capability is not what makes a reload possible, since a plugin reaches `location` with no grant at all; what it adds is the four steps a plugin cannot do for itself. What you installed is still switched off when the game comes back, so the reload applies a session load but only puts an install in front of the player rather than into their game. Tell the player which one they got.

Everything else belongs to `installModFromZip` and is not reimplemented here. The third-party consent switch is read at the moment of use, so a player who turns third-party mods off turns this off too. The archive is read under the same ceilings and the same zip-slip check. `checkMod` runs the same standards inspection as an author's own `neo-angband-mod-check`, so a mod your builder emitted fails for the same reasons, in the same words, as a mod somebody downloaded.

## 4d. `ctx.loadModForSession` - a mod handing the game a mod to try

This is the install route with the library step removed, behind its own capability, `mod:session`. The difference is where the archive is kept and for how long: session storage instead of IndexedDB, and it composes into the game on the next reload without being switched on first.

```js
if (!ctx.loadModForSession) return;               // no grant, or no door
const outcome = await ctx.loadModForSession(bytes);
if (!outcome.ok) show(outcome.problem);
else if (!outcome.survivesReload) show("this browser will not keep it across the reload");
else show(`${outcome.id} is loaded for this session - reload to try it`);
```

The first point below is the one to pass on to the player:

- **The mod is temporary; its effects are not.** The archive is forgotten when the game closes. Its records were as real as any other pack's while loaded, so a character that met them keeps whatever they did to it. On the next launch, with the pack gone, that character's mod-owned monsters and items belong to something that is not installed. The game quarantines them instead of resolving them wrongly, but values a player saw at save time can differ from the ones they see afterwards, because a pack's patches live in the composition and not in the save. Do not stage content under a character somebody is playing seriously, and tell the player that.

  Patches are the harder case, because they leave nothing for quarantine to catch. Quarantine notices an entity whose own namespace has gone missing. A session pack that only patches an existing record, such as re-pricing a core sword's damage, never gives that record a namespace of its own, so the sword still reads as core's and nothing is quarantined. The composed value from save time is simply gone on the next load, and nothing would say so if the save did not record it. The manifest records the content digest of every present session pack or permanently installed pack this host can measure at save time (`mismatchedNamespaces` / `reconcilePackManifest`, `packages/core/src/mod/save-blocks.ts`). A load that finds a namespace still present but with a digest that no longer matches says so, the same way a save updated across a format change does (`describePackMismatch`, `packages/web/src/save-recovery.ts`). Session packs carry the whole-archive digest made at staging. An installed pack's recorded per-file digests are prefetched from IndexedDB before the synchronous boot path and combined into its current pack digest (`presentPackDigests`, `packages/web/src/pack.ts`). This makes the change visible without preventing it. A patch that changed and a patch that is gone look the same to the digest, and the fix is the same for both: stage or install the pack again, or accept what is now composed.
- **It accepts content only, on exactly the same terms as `installMod`.** Code under any extension is refused, and so is an archive whose manifest asks for a capability. A mod may not hand the engine another mod's code to run, since the player consented to your mod and not to whatever it chose to execute. That refusal is permanent and is not waiting on an isolation tier. It stops the engine being the vehicle, but it does not fence in a plugin that means to load code some other way, because a plugin runs in the page. See PLUGINS.md, "What a capability gates".
- **A reload is still what applies it.** Content composes at load. Nothing you stage is in the game this turn, and the mod manager offers the reload on the way out.
- **`mod:session` and `mod:install` are separate grants, and neither covers the other.** The install grant is proportionate because what arrives waits to be switched on, and a session load does not wait. `grantCovers` compares the action, so the two consent sentences cannot be swapped.

Everything else is shared with the install route and not reimplemented: the third-party switch read at the moment of use, the zip ceilings, the zip-slip check, `checkMod`'s standards inspection, and the origin pin against an installed copy of the same id. A staged copy of an id you already have shadows the installed one for the session, and the collision appears on that mod's row.

**A session mod is always visible.** The mod manager lists it marked `SESSION ONLY`, and its detail screen offers `Drop it` instead of the ordinary on/off switch. It is on because it was staged, not because of a stored choice, and dropping the archive is the only thing that stops it.

## 4e. `ctx.debug` - conjuring a thing, and paying for it

`ctx.debug` adds almost no new ability. Every primitive behind it is already on `ctx.core` (`wizCreateObj`, `wizSummonNamed`, `wizDropObject`, and beneath those `makeObject`, `dropNear` and `placeNewMonsterLive`), and the gate they all check, `debugEnabled`, reads a `debug` boolean from a deps bag that the caller assembles. A mod could always pass `{ debug: true, ... }` and conjure whatever it liked, with no capability and no mark on the character.

```js
if (!ctx.debug) return;
const outcome = await ctx.debug.spawnMonster("Snarl, Farmer Maggot's other dog");
if (!outcome.ok) show(outcome.problem);
```

- **What the capability adds is the mark, since the power was already there.** The first use in a character asks the game's own debug question, with the same two warning lines and the same confirmation `^A` asks, through the same function. Accepting sets the same `NOSCORE.DEBUG` bit, which is permanent and invalidates the score. The confirmation runs before anything is placed, so nothing can arrive in a character whose player did not agree to the cost. That keeps "the debug commands mark your character" true for mods as well.
- **It also adds a line to the consent list.** `debug:spawn` is its own capability kind with no wildcard over it, so a player checking which of their mods can conjure things finds the answer on one line, and no broader grant can include it.
- **The question is asked on the game screen, which your own modal panel would be covering.** So the first spawn in a character is refused, by name, while one of your modal panels is up. A refusal the player can read is better than a prompt they cannot see, and the normal flow does not hit it, because a builder showing the player the dungeon has already closed its panel. Once the character is marked there is nothing to ask and the panel does not matter.
- **The game chooses placement, and there are no coordinates.** An item is dropped at the player's feet through `dropNear`; a creature is scattered near them using the engine's own ten attempts at a legal spot. A mod that could name a grid could put a monster inside a wall, and "does the thing I just wrote work" does not depend on where it lands. Ask by name rather than by index where you can, because an index is a fact about a registry, and the registry shifts when another mod is enabled.

## 4f. `ctx.wizard`: the whole debug set, on a session that is not being saved

`debug:wizard` gives a mod everything `^A` can do, driven from the mod's own screen instead of a text menu. It is priced differently from `debug:spawn`, and the difference is worth understanding before requesting either.

```js
if (!ctx.wizard) return;
const save = ctx.wizard.attached();   // who is about to stop being saved
if (!confirmWithThePlayer(save?.name)) return;
ctx.wizard.sandbox();                 // one way, and the gate on everything else
ctx.wizard.goToDepth(40);
ctx.wizard.spawnCreature("Bag Wraith", 3);
ctx.wizard.grantExperience(50000);
```

- **The commands are neither new nor reimplemented.** `game/wizard.ts` already holds the forty-odd `do_cmd_wiz_*` functions, ported faithfully, and until this seam existed their only front end was a text menu a mod cannot drive. Each method here is a name, an argument check and one call into the function the `^A` menu dispatches to, through the same live `WizardDeps`. The methods are thin because a second implementation of "give the player experience" would be a second set of levelling rules.
- **`sandbox()` is the price, and the host enforces it instead of trusting the mod.** Every command refuses until `sandbox()` has been called, and the call cannot be undone. It detaches the page from its save slot, which every write to a character consults: the turn-tail autosave, the level-change save, `S`, the options screen, `pagehide` and the death save all go through it. A page attached to no slot writes nowhere. The attachment lives in that page's own memory, so no other window can restore it.
- **This makes `debug:wizard` safer for the character on disk than `debug:spawn`.** Spawning acts on the character the player is actually playing and costs them that character's score for good. `debug:wizard` refuses to touch a character that is still being saved at all. The consent line therefore does not describe it as "more debug commands", which would get the risk backwards.
- **The cost is the session, and the mod has to tell the player.** The character on disk keeps whatever the last save wrote. The autosave runs at the end of a turn and is throttled to three seconds, so at most three seconds of turns are lost; time spent sitting in a menu takes no turns. Afterwards the session plays on in memory, and reloading the page lands on character select with the character waiting as it was. `attached()` exists so the question put to the player can name the character.
- **There is no re-attach.** Re-attaching would mean writing a cheated character over the save it was detached from, which is the outcome the mechanism exists to make unreachable.
- **Dropping the active id is not enough on its own**, because that key lives in storage every tab on the origin shares. A second tab that reaches character select and resumes someone writes a real slot id back into it, and a page that had given up its save, and has since been cheated freely, would silently be re-attached to a real character. The death path is worse: it destroys the slot's bytes rather than overwriting them, and records a death in a ledger that outlives the tombstone, so a monster killing the cheated character would delete a real one. Detaching therefore also sets a one-way latch in the page's own memory, which both routes into slot storage check and no other tab can see or clear.
- **The save is detached rather than forked into a branded copy.** A fork is a real, resumable second character in the roster, which this game does not have: death is terminal, a slot's bytes are destroyed when its character dies, and the death ledger outlives even the tombstone so that clearing a memorial cannot launder a resurrection. A branded fork made at dungeon level 40 and left in the roster is a restore point whatever the brand says, and a player can ignore the brand. A fork would also need sweeping up later, which means a purge at boot that could be missed. Detaching avoids all of that because it never writes anything.
- **`sandbox()` sets the debug mark itself and does not ask the game's own question.** `ctx.debug` asks because it acts on a character that is still being saved, where the mark is permanent. Here the character has already stopped being saved, so the question has no consequence left to warn about. It would also have to be asked on the character grid, underneath whatever the mod is drawing, which is the refusal `debug:spawn` has to carry. Detaching is the moment of consent: the mod asks for it in its own words on its own screen, and the bit is then set.
- **`catalogue()` is the one method readable before `sandbox()`.** Listing is only reading, and deciding what to test is how a player decides whether to detach at all; a browser that filled in only after they agreed would ask them to agree to something they cannot see. Each entry carries `from`, the pack that added the record, absent for the base game's own records. That lets a browser put a mod author's own content first without keeping its own list of what vanilla contains.
- **The game chooses placement and there are no coordinates**, on the same terms as `debug:spawn`.

## 4g. `ctx.snapshot()` and the input token - one wait, read whole

Every other read is its own call. A mod that draws the player from `view.player()`, the pack from `view.inventory()` and the map from the last frame cannot tell whether the three describe the same moment, and a mod that sends an action back cannot tell whether the game it chose against is still the game that will receive it. An interface that replaces the whole screen needs both answers.

```js
const snap = ctx.snapshot();          // null before a game exists
if (snap && snap.phase === "play") {
  drawHud(snap.core.player);          // every part is from the same wait
  drawPack(snap.core.inventory);
  drawMap(snap.frame);                // the frame the map was painted from
  remember(snap.token);               // hand this back with an action
}
```

- **The token moves only when the game does.** Core raises the revision when `runGameLoop` takes a command or advances the turn, when a level change completes, and when the target is set. A host that re-enters the loop while it waits for a key does not age a token it has given out. `tokenIsCurrent(state, token)` compares it with the game as it stands now; a token from a different game never matches, even after a load, because each game carries its own epoch.
- **Reading changes nothing.** `AgentView.capture()` and `ctx.snapshot()` write no game state, no knowledge and no RNG stream. `boundary.test.ts` saves the whole game with `saveGame` and records the RNG state, the turn and the command queue, reads five times, and checks that none of it moved.
- **Each part is gated like the read it comes from.** A part whose `state:<domain>.read` the mod was not granted is null rather than an error. The phase and the message pause need `state:interaction.read`; the frame needs `state:map.read`.
- **The phase says who owns input.** `pregame` (title, roster, birth), `play`, `store`, `more` (a "-more-" pause is holding input), `modal` (any other full-screen takeover) and `dead`. `messagePending` is true exactly while a "-more-" pause waits.
- **Everything is a copy.** The core parts are a structured clone, deep-frozen; the frame goes through `snapshotWorldFrame`, the same ownership cut the front-end seam makes. A mod can keep a snapshot as long as it likes without holding a live object.

The map cells and the agent's message buffer are not in the core capture. The map has its own bulk read, and `messages()` drains a per-decision buffer. The host snapshot adds `messages` under `state:messages.read` from the message history without draining that buffer. Its frozen entries and token can be kept across input waits. The open question is in `prompt` when `state:interaction.read` is granted.

The core capture adds `quiver`, `equipmentSlots`, and `floorHere`. The first two need `state:inventory.read`; the local floor pile needs `state:floor.read`. Each `ItemView` carries `kindKey` and `nameColor`, the colour the inventory draws its name in, given as a colour name such as `"light umber"`. `label` is the kind's raw name, such as `& Dagger~`. `name` is the name the inventory shows, such as `a Potion of Cure Light Wounds`, and `ignored` is true while the game ignores the object. A carried object's `itemKey` is `gear:<handle>`. A floor object has handle 0, a `floorIndex` for its place in the pile, and an `itemKey` of `floor:<x>,<y>:<index>`, which changes whenever the pile does. `equipmentSlots` follows body.txt slot order and names both slots of a pair. The player part reports `learnableSpells` from the current upkeep count. The spellbook rows report `studyEligible` and `infoLine` from the game's spell checks and menu info function.

## 4h. `ctx.knownLevel()` - the player's whole remembered level

`ctx.knownLevel()` returns the grids the player knows, ordered by row. Its token identifies the current input wait. Its level id changes when the game changes levels, while turns on one level leave the id alone. The result also gives the depth and map dimensions. Call it separately from `ctx.snapshot()`, which stays small.

```js
const level = ctx.knownLevel?.();
if (level) {
  for (const cell of level.cells) drawRememberedCell(cell.x, cell.y, cell.remembered);
}
```

Each cell has a `visible` flag and a `remembered` value. Terrain comes from `knownFeat`; the object list comes from `knownPile`. A sensed object tells the mod whether it is money, without identifying its kind. A seen object of a flavoured kind the player has not identified carries its item class and flavour (`aware: false`, `tval`, `flavorIndex`, `flavorText`) and no kind, the same way the map draws it with the flavour glyph; once the player is aware of the kind, it carries `aware: true` and `kindIndex`. The kind of a seen object stays in memory when the real floor changes. Trap knowledge in this port is the visible flag on a live trap record; removing that record also removes the trap from this read.

`state:map.read` grants this read. Without it, the core accessor throws `AgentCapabilityError` and the context call returns null. A mod with `state:map-actual.read` also gets `actual` on each cell: real terrain, traps, floor objects as `ItemView` values, and the monster index. Other mods receive no `actual` field. The `state:*.read` wildcard grants both domains. Trusted core code can call `captureKnownLevel` directly.

The read does not change the game or use the RNG, including while the character hallucinates. Its token matches `ctx.snapshot().token` when both calls occur at the same input wait.
## 4i. `ctx.intent.submit()` - act at the current input wait

A plugin that declares `input:intent` receives `ctx.intent`. The grant tells the player that the mod can act on the character's behalf with the same commands as the player's keys. `submit(token, intent)` returns `{ accepted: true }` or `{ accepted: false, reason }`. A rejected intent changes no game state, command queue, turn or RNG stream.

Pass the token from `ctx.snapshot()` with each intent. The host rejects an old token, an open prompt, a blocked phase, an unknown command code or malformed arguments before it takes an action. Ordinary commands require `play`; `shop-buy`, `shop-sell` and `shop-exit` require `store`. The prompt check reads the same open prompt `ctx.snapshot().prompt` reports (section 4j).

```js
const snap = ctx.snapshot?.();
if (snap?.phase === "play") {
  ctx.intent?.submit(snap.token, { kind: "command", command: { code: "walk", dir: 6 } });
  // Or: { kind: "travel", x: 12, y: 8 }
  // Or: { kind: "target", midx: 3 } / { kind: "target", x: 12, y: 8 }
}
```

The command arm accepts registered codes and passes their validated arguments through. Where core has an `AgentActions` builder, its command shape is the guide: `move(6)` gives `{ code: "walk", dir: 6 }`, and `drop(handle, 2)` gives `{ code: "drop", args: { handle, quantity: 2 } }`. Travel queues `pathfind` with `{ dest: { x, y } }`. Commands normally enter the host's keypress buffer and call `advance()`. Target intents use the existing target setters directly, change the token and pass no turn. This path does not install a controller or mark the character as autoplayed.

The `look` command accepts optional `{ x, y }` arguments and opens the host's look loop at that grid. A travel intent accepts optional `modifiers: { shift, ctrl }`. Ctrl targets its grid; Shift runs toward an adjacent grid through `run`; an ordinary travel intent still uses `pathfind`. Invalid modifiers and a nonadjacent Shift destination are refused. `{ kind: "stop-resting" }` is an intent kind, not a command code, and calls `disturb` while the game rests.

Most object commands also work on the floor: `quaff`, `read`, `eat`, `wield`, `aim-wand`, `zap-rod`, `use-staff`, `activate`, `throw`, `refill`, `inscribe` and `uninscribe`. Each takes `args.floor` in place of `args.handle`, giving the `floorIndex` of an object in the pile under the player. `pickup` takes the same optional `args.floor` to pick up that object rather than the first. An index past the end of the pile is refused.

`{ kind: "ignore", handle }` and `{ kind: "unignore", handle }` take a gear handle and run the item menu's own actions. The item's `ignored` field says which of the two applies. `{ kind: "item-rule", rule, index, value }` changes one row of `ctx.inspect.itemRules()`, using the same settings code as the knowledge menu:

- `kind-aware` and `kind-unaware`: `index` is the kind's `kidx`, and `value` is a boolean.
- `note-aware` and `note-unaware`: `index` is the `kidx`, and `value` is the inscription. An empty string clears it.
- `quality`: `index` is the row's `itype`, and `value` is a position in that row's `levels`. Rings and amulets have only "no ignore" and "bad", as in the game's quality menu.
- `ego`: `index` is the ego's `eidx`, `itype` names the row's item type, and `value` is a boolean.

These actions need the play phase, apart from `stop-resting`, which can interrupt the rest modal.

Compound actions belong to the mod. To walk to an item and pick it up, submit travel, wait for the next input wait, read a fresh snapshot, check the player's grid and item, then submit pickup with the new token. The same sequence works for walking beside a wall and sending `tunnel` with a direction.

```js
const first = ctx.snapshot();
const sent = ctx.intent.submit(first.token, { kind: "travel", x: itemX, y: itemY });
// At the next input wait, after the mod checks the item is still there:
const next = ctx.snapshot();
if (sent.accepted && next?.phase === "play" &&
    next.core.player?.grid.x === itemX && next.core.player.grid.y === itemY) {
  ctx.intent.submit(next.token, { kind: "command", command: { code: "pickup" } });
}
```

## 4j. Typed prompts and replies

`ctx.snapshot().prompt` reports the question currently holding input. Each descriptor has a session-unique `promptId`, a `kind`, and the game's own label. The kinds are `confirm`, `quantity`, `text`, `direction`, `item`, `spell`, `target`, and `ack`. Quantity and text carry their limits and defaults. Direction reports whether the current target is allowed. Item choices carry the item handle, label, and selection letter, with available floor, quiver, and equipment tabs. A negative item handle names a floor pile index for this prompt only: `-(index + 1)`. Spell choices carry the class-wide spell index, name, level, mana cost, failure chance, and current castability. Target reports the current grid, interesting candidates in browsing order, and the projection path to the cursor. The descriptor closes when the game's wait ends.

For a mod's `shop-buy` or `shop-sell`, the host selects the stock or gear item on the open store screen. That screen asks "Buy how many?" or "Quantity (0-N, *=all):" for a stack, then calls `storeConfirm` with the calculated price. The home keeps its free take or drop flow. A quantity descriptor includes `unitPrice`, `totalPrice`, `totals` and `gold`. `totalPrice` follows the digits typed at the game's own prompt. `totals[n]` is the game's price for `n` items, so a mod can show the total for whatever amount it offers. The store's price confirmation carries `price`. A numeric reply chooses the amount, and `{ action: "cancel" }` leaves gold and items alone. The confirmation takes the same cancel reply. Even when a mod supplies `quantity` in the intent, it must answer the prompts. Core `AgentActions.shopBuy` and `shopSell` keep their direct command path for Borg and MCP callers, including their explicit quantity.

When the `R` command asks for a rest duration, its text descriptor carries `tag: "rest"`. During a `-more-` pause, the pager opens an `ack` descriptor tagged `more`; `{ action: "acknowledge" }` closes that wait just as a keypress does. Under `state:interaction.read`, `ctx.snapshot().resting` reports `active` and `mode`. `mode` is `"turns"` for a timed rest. A rest that runs until a condition is met has `"complete"`, `"all-points"` or `"some-points"` instead. A timed rest also reports `turnsRequested` and `turnsRemaining`, and `turnsRested` counts the turns rested so far in either kind.

```js
const question = ctx.snapshot()?.prompt;
if (question?.kind === "confirm") {
  const result = ctx.prompt?.reply(question.promptId, true);
  if (!result?.accepted) showReason(result?.reason);
}
```

`ctx.prompt` exists only with `input:prompt.reply`. Replies use the same selection or finish handlers as the terminal. A stale ID, a value of the wrong type, or an unavailable choice returns `{ accepted: false, reason }` and leaves the wait open. Target replies accept `{ action: "move", x, y }` or `{ action: "next" }`, `{ action: "previous" }`, `{ action: "toggle" }`, `{ action: "select" }`, and `{ action: "cancel" }`. Text and spell prompts also take `{ action: "cancel" }`, which answers as Escape does. Each target cursor update gets a new ID, so a reply based on an earlier grid is stale. A reply does not consume a turn by itself; the resumed game command decides what happens next.

The seam covers the shared confirmation, quantity, text, direction, item, and spell waits, the store's confirmation, the pasted-text editor, and the main targeting loop. Other one-key waits, arbitrary menus, and custom modal loops still use their own input handlers and have no typed descriptor. A menu supplied by another mod's presenter is answered by that presenter, outside the host terminal wait.

## 4k. `ctx.inspect` - read the game's own inspection answers

`ctx.inspect` is present when a mod has at least one of `state:inventory.read`, `state:monsters.read`, `state:spells.read`, or `state:map.read`. Its methods also exist on core `AgentView`. Each result carries the current input token and is frozen. A method throws `AgentCapabilityError` when its own domain is not granted.

```js
const item = ctx.inspect?.inspectItem(handle);
const recall = ctx.inspect?.monsterRecall(raceIndex);
const spell = ctx.inspect?.spellInfo(spellIndex);
const choices = ctx.inspect?.itemTester("quaff");
const path = ctx.inspect?.projectionPath({ x: 20, y: 12 });
const blast = ctx.inspect?.blastArea({ x: 20, y: 12 }, 2);
const travel = ctx.inspect?.travelPath({ x: 20, y: 12 });
const actions = ctx.inspect?.tileActions({ x: 20, y: 12 });
const rules = ctx.inspect?.itemRules();
```

`inspectItem` accepts a carried or worn handle, `{ floor: { x, y, index } }`, or `{ store, index }` for a stock entry. Store stock also requires `state:stores.read`. It returns the existing title and text plus frozen `sections`: a title entry, the first object_info paragraph as a description entry, and later paragraphs as separate info entries. A store entry uses object_info's store mode, so a book on a shelf can be inspected. A floor object answers only when the player remembers that object; a grid the player has merely sensed returns null. Inspecting a floor object needs `state:inventory.read`, as a carried one does, while `floorHere` in the snapshot needs `state:floor.read`. `monsterRecall` returns existing lore under `state:monsters.read`, or null for a race the player has not seen. Neither read learns a kind or ego or creates lore.

An item result also carries `combat`, the numbers behind its Combat info lines, or null for an item that has none. `blows` is melee blows per round to the tenth the description shows. `damage` is the average damage per round for a melee weapon, or for ammunition the current launcher fires, and `thrownDamage` is the average per throw for a throwing weapon or a sling stone. Each holds `normal`, the damage against a creature no brand or slay affects; `vs`, one `{ kind, name, damage }` line per known brand or slay, highest first, in the order the description lists them; and `offWeapon`, true when other equipment or a timed effect adds a brand or slay. `multiplier` is the shooting power a launcher shows in its name, or the current launcher's for ammunition it fires. `range` is how far that ammunition reaches in feet, and `breakageChance` is the percent chance that fired ammunition breaks. `tooHeavy` is true when the character is too weak to wield the weapon well. Every value comes from the same calculation as the text and counts only what the character knows of the item. A monster recall has no `combat`. (neostryder/neo-angband#360)

`spellInfo` returns the spell's description, required level, mana cost, live failure chance, and `canCastNow` under `state:spells.read`. Low mana raises the failure chance but still permits the game's over-exertion cast path. `itemTester` lists carried, worn, quivered, and local floor references accepted by the named item command under `state:inventory.read`. Its command codes are `inspect`, `wield`, `takeoff`, `drop`, `inscribe`, `uninscribe`, `activate`, `use-staff`, `aim-wand`, `zap-rod`, `eat`, `quaff`, `read`, `refill`, `cast`, `study`, `browse`, `fire`, `throw`, `use`, and `ignore`.

`projectionPath` and `blastArea` return ordered grids under `state:map.read`. They use the game's projection geometry with remembered terrain and visible monsters. Unknown terrain is treated as open for the preview. `blastArea(to, radius, arc)` previews a ball, or the cone of a breath when `arc` gives its width in degrees. Without `arc`, it takes the arc of the effect being aimed. A blast also reports its requested `radius`, its `arc` (null for a ball), the active effect's `element` when one is being aimed, and `wallsStop`. It gives no damage estimate. While a ball or breath direction or targeting prompt is open, `ctx.snapshot().activeBlast` reports the pending effect's radius, element, and arc for a breath, under both `state:map.read` and `state:interaction.read`. Repeating these reads does not change the saved game, knowledge, turn, command queue, or RNG state.

`bookForItem(handle)` maps a carried spellbook to its class book index and spell indices under both `state:spells.read` and `state:inventory.read`. `compareLoadoutSlots` takes a gear, store or floor reference (section 4a) and returns one `simulateLoadout` comparison for each compatible body slot, including the second ring slot when that slot can hold the item. It needs `state:player.read` plus the domain the item lives in: `state:inventory.read` for gear, `state:stores.read` for a ware, `state:floor.read` for a floor item. A floor reference the player does not remember returns no slots. The result is token-stamped and frozen.

`travelPath` uses the travel command's `findPath` over remembered terrain and returns steps in walking order, excluding the player's grid. It returns null for an unknown or unreachable destination and while the player is confused. `tileActions` returns accepted command codes in `codes` for a remembered grid under `state:map.read`. Adjacent terrain may offer `tunnel`, `open`, `close`, `disarm`, or `walk`; the player's grid may offer `ascend`, `descend`, or `pickup`. The host accepts `ascend` and `descend` for stairs. Melee uses `walk` toward an adjacent monster because there is no separate `attack` command code. An action still needs the appropriate direction or other arguments when passed to `ctx.intent.submit()`.

`itemRules` reads the player's learned kind flags, quality thresholds, ego rules, and aware and unaware kind auto-inscriptions under `state:inventory.read`. Kind rows contain `kidx`, `name`, `ignoreAware`, `ignoreUnaware`, `noteAware`, and `noteUnaware`. Quality rows contain `itype`, `name`, `threshold`, `thresholdName`, and `levels`, the thresholds the game's quality menu offers for that type; ego rows contain `eidx`, `name`, `itype`, and `ignored`. Unseen kinds and egos are omitted. These reads return frozen results with the current input token and leave the saved game, knowledge, turn, command queue, and RNG unchanged.

## 4l. Resolved combat, healing, and movement events

`ctx.events` is present during a game when the mod declares at least one `event:<name>` grant. Subscribe with `ctx.events.on(name, handler)` and remove a handler with `ctx.events.off(name, handler)`. The game calls a handler as `handler(name, payload)`, event name first, so one function can listen to `combat-outcome` and `heal` and still tell them apart. Each subscription checks its own grant. The new names are `combat-outcome`, `heal`, and `motion`; the existing event names and payloads stay the same.

`combat-outcome` reports one resolved melee blow, ranged collision, projection, or damaging effect. Its payload has `attacker` and `target` as `"player"` or a monster index; `attacker` is null when no creature is identified as the source. `kind` is `melee`, `ranged`, `spell`, `effect`, or `trap`. `hit`, `damage`, `died`, and `grid` describe the result after damage is applied. A miss has zero damage. A killing event fires while the monster still occupies its index.

`heal` reports `who`, the hit points actually restored in `amount`, and `grid`. `motion` reports `who`, `from`, `to`, and `kind`. A normal step is `walk`; a teleport, blink, or level-internal displacement is `teleport`. A refused move produces no motion event. Each payload has `seen`, read from the same player field-of-view test as projectile events. Unseen results still fire with `seen: false`.

These events contain copied coordinates and scalar values. They do not carry a live player, monster, or grid object. Core emits them at the resolving code path and does not use a listener's return value. Mods can keep a payload for later animation without retaining game state.

`player-command` reports each command the player issues, whether it came from a key, a keymap, the mouse or a mod's `ctx.intent.submit()`. Declare `event:player-command` to receive it. The payload has the command's `code`, its `dir` and a copy of its `args`, `phase` (`play`, or `store` for an item command given inside a shop), and `token`, the input token of the wait the command answered. A `repeat` also carries `repeats`, the command it repeats. The event fires as the game loop takes the command and before it runs, so `ctx.snapshot()` in the handler still describes that wait, and a mod can compare its own choice with the player's. Commands from an installed controller, and the follow-up steps of a run or a repeat count, do not fire it. Buying and selling in a shop are store screen actions rather than commands, so they do not fire it either. A handler that throws is logged, and the command still runs. (neostryder/neo-angband#300)

`dungeonlevel` reports each arrival on a level, the town included. Declare `event:dungeonlevel` to receive it. It fires once for each level the character arrives on, by stairs, a trapdoor, Word of Recall, deep descent, teleport level or a debug jump, and on entering or leaving the single-combat arena, which Angband also handles as a level change. It also fires once for the level a session starts on, for a new character and for a loaded save alike, because Angband runs the same arrival steps for both. That first event waits until every mod's `register()` has run and the map is on screen, so a mod that subscribes in `register()` hears it. Walking, resting and redrawing the same level never fire it. The payload has `depth`, where 0 is the town; `levelId`, the value `ctx.knownLevel()` reports for that level, counting up from 0 in each session; `cause`, which is `new-game` or `load` for the session's first level and `change` after that; and `arena`, true in the arena. The event comes after the stair or recall message and before the level feeling. A handler that throws is logged, and the arrival still completes: the level feeling, the autosave and the redraw all go ahead. (neostryder/neo-angband#363)

## 4m. `ctx.saves` - the host character roster

A plugin with `saves:manage` receives `ctx.saves` at the title and during play. `list()` reads the character picker's roster in the same order. Its frozen entries contain the slot id, name, race, class, level, depth, death status and last-save time in epoch milliseconds. Every call returns `ok` or a refusal with a `reason`.

`load(id)` uses the character picker's resume route, including the other-window check and the reload that decodes the save and checks compatibility. `rename(id, name)` follows the character sheet's rules: it trims a nonblank name of at most 15 characters and refuses a name pinned by the host. Only the character in play can be renamed, through the character sheet's own rename. Any other slot returns a refusal, because the roster row is rebuilt from the loaded character each time it saves. `delete(id)` refuses the character attached to this page and opens the host's confirmation before deleting. A mod menu presenter cannot answer that confirmation.

The facade uses the roster's configured storage in the browser and Electron. Its consent description carries the power flag, because a deleted save cannot be restored.

`ctx.character.key()` is present with `state:player.read` while a character is attached. It returns the roster lineage, which survives saves and renames. Under `saves:manage`, `ctx.saves.onChange(listener)` receives frozen `rename` and `delete` events after the host writes the roster; each event carries the slot id and lineage key, and a rename also carries the new name. The subscription returns an unsubscribe function.

A plugin with `session:control` receives `ctx.session`, the game menu's Save, Save and exit, and Quit for a mod's own save dialog. `save()` writes the save and shows the game's "Saving game... done." message. `exitToTitle()` saves and then reloads to the title screen. `quit()` saves and then runs Ctrl-X: the game's "Press Return (or Escape)." pause, then the desktop app closes, while a browser tab goes to the title screen. Each one saves first and returns a refusal with a `reason` instead of leaving when no living character is in play or the save fails. None of them confirm, so ask the player in your own dialog first. `saves:manage` does not grant this seam. (#361)

## Player profiles and title actions

`ctx.profiles.list()` returns `ProfileResult<readonly ModProfile[]>`, where each profile has `id: string | null`, `name: string` and `active: boolean`. The default profile has a null id. `ProfileResult<T>` is `{ ok: true, value: T } | { ok: false, reason: string }`; calls without the capability throw a capability error.

`create(name, { copyFrom? })` returns `ProfileResult<ModProfile>`. Omit `copyFrom` for a fresh profile, pass a profile id to copy it, or pass `null` to copy the default. Copies include saved game options, mod loadout, rule choices, mod settings and per-mod preferences. They exclude save bytes, roster entries, death records, character exports and global settings. A new profile enables its creator. `setEnabledMods(id, mods)` replaces the enabled set in a profile the caller created, keeps the caller enabled and returns `ProfileResult`. Every named mod must be installed; code mods must already have the player's approval in the source or destination profile. The host records profile ownership so the creator can reuse this method after a reload.

`switchTo(id, action?)` returns `ProfileResult` and reloads through the host's mod teardown path. The optional `ModProfileAction` is `{ kind: "create-character", armController?: boolean }`. Character creation requires `saves:manage`; arming also requires the calling mod to supply a controller. The calling mod must be enabled in the destination profile. The host stores the destination id, calling mod id and action in a JSON document in reload storage. On the next boot it removes the document before validating the destination and calling mod, then starts creation there. A missing mod, mismatched destination or unreadable document produces a refusal report and the action is not retried.

`ctx.controllerArmed` is true for the calling mod during birth and on the first boot of its new character when controller arming was requested. A controller factory can use that fact to return its controller. The host carries the request through the existing birth reload and marks the character when the controller installs. A resumed character receives no arming request from this action. The mod owns its prompts and its decision to ask the player before arming.

Under `ui:title`, `ctx.title.registerRow(row)` accepts `ModTitleRow`, which has `label: string`, optional `key: string` and `run(): void | Promise<void>`. It returns an unregister function. The host draws mod rows below its own title options. `ctx.title.choose(title, choices)` takes a string and a readonly string array and returns `Promise<number | null>`. Escape returns null and the first choice is the default. The profile capability grants no title rows, and the title capability grants no profile access.

## 4n. Filtering the whole game viewport

`ctx.display.setVisualFilter(filter, { scope: "game" })` applies a CSS filter to the terminal canvas, tiled subwindow content, and every mod panel's content, including panels opened after the call. The call still requires `display:filter`. Omitting the options keeps the previous canvas-only behavior. Pass `null` to clear both scopes; mod teardown also clears the filter before a changed mod set reloads.

```js
ctx.display?.setVisualFilter("saturate(0.4) blur(1px)", { scope: "game" });
// Later:
ctx.display?.setVisualFilter(null);
```

The canvas uses its existing alpha-enabled overlay because a CSS filter on the opaque terminal canvas does not composite in Chromium. Panel content and tiled subwindow content use CSS filters on their DOM elements. This is the same host path in a browser and Electron. The filter does not cover the accessibility live regions, touch controls, panel close buttons, tiled subwindow controls, crash and safe-mode notices, or the mod manager's capability consent and fault screens. The host pauses canvas filtering while the mod manager is open, then restores the requested filter when it closes.

A filter on panel content also affects text fields, their caret, and their focus ring. Strong blur or low contrast can make them hard to read and edit; use a legible filter for panels that accept input. Escape and the host's close button remain available even when panel content is hard to read.

## 4o. Reserving a map margin

`ctx.display.setMapMargin({ edge, cells })` reserves up to four whole cells along the top, right, bottom, or left edge of the main map. The host shrinks the map viewport and reports its new rectangle through `ctx.display.snapshot().regions`, leaving the strip clear for a mod to draw controls. The strip is clamped further when the map is narrow so at least four cells remain on that axis. Pass `null` to restore the full map viewport. Mod teardown clears the margin before reload. The method uses the same ungated display geometry access as `setSidebarExtent`.

```js
ctx.display?.setMapMargin?.({ edge: "right", cells: 3 });
// Later:
ctx.display?.setMapMargin?.(null);
```

## 4p. `ctx.ui.registerPanelKind` - a mod panel in the tiled layout

`ctx.ui.registerPanelKind(spec)` adds a persistent panel kind to Subwindow setup under the existing `ui:panel.mount` grant. The host forms its layout ID from the mod ID and `spec.kind`, such as `sample:quickbar`. The spec supplies a label, an optional short tab label, minimum size and preferred dock or tab placement, an optional fit height in CSS pixels, and `mount(host)`. Registration returns an unregister function. `ctx.ui.openPanel` keeps its separate overlay and modal behavior.

```js
const unregister = ctx.ui.registerPanelKind({
  kind: "quickbar", label: "Quickbar", tab: "Bar", fitHeight: 48,
  preferredPlacement: { kind: "dock", target: "main", edge: "bottom" },
  mount(host) {
    const button = document.createElement("button");
    button.textContent = "Use item";
    host.root.appendChild(button);
    const stop = host.onStateChange(({ active }) => {
      button.hidden = !active;
    });
    return () => stop();
  },
});
```

The host owns the slot, tab strip, close control and saved position. `mount` runs when the panel first becomes visible and receives a closed shadow root inside the slot body. The host handle exposes `id`, `root`, `bounds`, `active`, `focused`, `onStateChange(listener)`, `requestFocus()`, `requestClose()` and `setFitHeight(px | null)`. An inactive tab stays mounted. Removing the panel, unregistering its kind or tearing down the page calls its cleanup. A saved panel whose mod is not loaded keeps its place as a named placeholder with a Remove button; registration in the same session fills that slot. When a kind is registered and its panel is not in the layout, the host opens it at its saved place or at `preferredPlacement`. A panel the player has closed stays closed when its kind is registered again. A panel docked against `main` joins the panels already on that edge, so the main view gives up space only for the first panel on each side. When the mod is loaded but no longer registers the kind, the host takes the panel off screen and keeps its place, and registering the kind again puts it back there. The placeholder names a missing mod by its manifest name.

Typing in a focused editable field inside the panel goes to that field through the single input door. A native display panel keeps game keys available. Escape closes the top overlay panel first, then leaves a focused tiled mod panel for the game. The layout editor and game modals keep their input while open.

## 4q. Controller ownership, public mods, and display requests

`ctx.snapshot().driver` and `ctx.driver()` read the host's current input owner without another capability. They return a frozen player value or a controller value with its owner id. A bundled core controller uses `core:<id>`; an installed mod controller uses its mod id. `ctx.controller` exists only while that mod owns the active controller. Its `setStatus({ label, reason })` publishes optional text about the current task. Its `release(reason?)` gives the keyboard back to the player and shows the optional reason in the message line. A retained context does nothing if another mod owns the controller slot. Returning `null` keeps the controller installed. The host emits `driver-changed` on the game event stream when ownership or status changes. A listener declares `event:driver-changed`. Both `ctx.intent.submit()` and `ctx.prompt.reply()` return `code: "controller-owned"` and a reason naming the owner when another controller holds input, even when the caller checked an earlier snapshot.

`ctx.mods()` returns a frozen list of enabled, loaded mods in enabled order. Each row contains the manifest id and version. A manifest may declare `publicFlags` as a list of its own declared rule or section flags; only those current boolean values appear in the optional frozen `flags` map. Private flags, save bags, and preferences never appear. The list changes after the host's mod-change reload applies the enabled set.

Each mod's display setters keep its own last request. The most recent live request controls the grid, camera, full map view, tile scaling, map overview, sidebar extent, map margin, or visual filter. Clearing a nullable request removes that mod's value; `setTileScaling(null)` restores the default automatic sampler and `setFullMapOverview(null)` restores the default overview when no earlier request remains. `getGrid()`, `getCamera()`, `getMapView()`, `getTileScaling()`, `getFullMapOverview()`, `getSidebarExtent()`, `getMapMargin()`, and `getVisualFilter()` report the value in force. Mod teardown removes every request from that mod and restores the next most recent request for each setter.

`controller()` may return `{ controller, nondeterministic, onDeath, onKey }` instead of a bare controller. `nondeterministic: true` marks the save nondeterministic when the controller installs, for a mod whose manifest is deterministic but whose controller this time draws on a model, a clock or the network. The manifest's own `nondeterministic` flag still marks the save when the mod is enabled. `ctx.controller.markNondeterministic()` does the same while the mod owns the keyboard, for a controller that switches to such a source after install. The mark is permanent and is saved at once. `onDeath` chooses what the character's death does while the controller holds the keyboard. The default, `reincarnate`, starts the next character in place, as the Borg does. `end` runs the ordinary death with its tombstone, score entry and `ctx.character.onRunEnd`, and leaves the controller installed until the page reloads. (neostryder/neo-angband#300)

The install can also carry `onKey(press)`, which the host calls for each key the player presses while the controller has the keyboard and the game window has focus. `press` carries the key's DOM name and its Ctrl, Alt, Shift, Meta and repeat flags. Return `{ kind: "keep", message }` to go on driving, with `message` shown on the message line if you give one, or `{ kind: "release", reason }` to give the keyboard back with `reason` shown in place of the usual line. The key never reaches the game either way. Escape and Ctrl-Z always give the keyboard back and are not passed to `onKey`. Alt-Tab, any key held with the Windows key, an input method's keys, and a modifier or lock key pressed alone are ignored and not passed either. Answer at once and do the key's work, such as starting a different errand, before returning: a promise, a throw or any other answer gives the keyboard back and is reported as a fault in the mod. Without `onKey`, any other key gives the keyboard back. Each hand-back writes an info line to the log naming its source. (neostryder/neo-angband#334)

## 4r. Floating panel positions and recovery

The host's Subwindow setup can move a registered panel into a floating window inside the game viewport. The panel keeps the same slot, shadow root, controls, minimum size and input behavior. Its title bar can move it onto the same dock, swap and tab drop zones as a docked panel. Closing and showing it again restores its floating rectangle; Dock returns it to its last docked place or `preferredPlacement` if that place is unavailable. A saved float whose mod is not loaded shows the same named placeholder as a docked panel. The Floating windows switch temporarily renders floats at their remembered docked places without erasing their saved rectangles. No new capability or `ctx.ui` field is required.

## 4ra. Saving and restoring the whole layout

`ctx.subwindows.layout()` returns the whole arrangement as text: which panels are open, the tiling, the floating panels and their remembered places, the map panel's graphics and every registered pref block. It is the same JSON document that Export subwindow layout writes. `ctx.subwindows.setLayout(text)` puts an arrangement back and saves it as the player's layout, as an import does. It returns false and changes nothing when the text is not a layout document. `ctx.subwindows.onLayoutChange(listener)` calls the listener with the new layout text after each change: a panel opened, closed, moved, resized, docked, floated or tabbed, or a `setLayout` call from any mod. A drag reports once, when it ends, and the saves from one action arrive as one call after it finishes. That covers undo and redo and named layouts. Keep the last text you saw, push it onto your undo stack when different text arrives, and skip a change whose text equals the one you just restored, since a layout reads back byte for byte. A panel whose mod is not loaded keeps its place and shows the usual placeholder. Like the rest of `ctx.subwindows`, these need no capability. (neostryder/neo-angband#287)

## 4s. Command catalogue and store panel status

`ctx.intent.catalogue()` is present with `input:intent`. It returns a frozen, token-stamped list of the action registry's command codes, plus the non-command intent kinds. Each command has its play or store phase, its argument shape, and `verb`, the game's own name for it. That is `"aim"` for `aim-wand`, for example. A mod's command has the verb it set with `commands.setVerb`, and a code with no verb has null. Registered mod command codes appear in the same list. The catalogue is a read; it takes no turn, consumes no RNG, and adds nothing to the command queue.

`ctx.snapshot().storeStatus` is present while a store is open when both `state:stores.read` and `state:inventory.read` are granted. It reports the store feature, whether the menu is ready for another action, the no-selling birth option, and a row for each item in the pack, the quiver and the equipment. Each row gives the handle, its `location` (`pack`, `quiver` or `equipment`), whether the store will buy it, and the one-item quote from `price_item`; an ineligible item has a null quote. The read calls the game's own `willBuy` and `price` closures and returns a frozen result with the input token.

Under `state:messages.read`, `ctx.snapshot().messages` carries the current input token. `entries` holds the texts of `msglog.all()`, oldest first, and `log` gives each message's `text`, its repeat `count` and its `color` when it has one. The log does not keep message types. The read leaves `AgentView.messages()`'s per-decision buffer untouched, so a panel can redraw its log without taking messages away from a controller. The pager's `ack` prompt from section 4j is available only while its `-more-` wait holds input. The host repaints its HUD sections when that pause opens, so a message ribbon can show its continue control.

## 4t. Reads for visual effects

`MonsterView` in `ctx.snapshot().core.monsters` carries `unique` (RF_UNIQUE), `questGuardian` and `finalGuardian`. A quest guardian is the race of one of the character's quests. The final guardian guards the last quest, the one whose kill wins the game, which is Morgoth in the shipped quest.txt. Both flags follow the quest table, so a mod that changes the quests moves them too. `id` is the level-local monster index an animation can key on. The list holds only the monsters the player perceives as monsters, the ones the game's own monster list shows. That includes monsters found by detection or telepathy, and leaves out any the player cannot see and any mimic still posing as an object.

`MonsterView.spellFlags` lists every spell flag of the race. `knownSpellFlags` lists only the ones the character has learned, the same set the monster recall names: flags it has seen the race use, or all of them once the race is fully known through probing or a cheat. Reading it creates no lore record. (neostryder/neo-angband#359)

The same rule covers cells and items in every view, a controller's included. `CellView.monster` names a square's occupant only when the player perceives it, and is 0 for an unseen creature or a mimic still posing as an object. `CellView.objectCount` counts the objects the player remembers there, and `floorItems(x, y)` lists only the ones the player has seen, each with its index in the live pile. `ItemView` describes an object as the player knows it, from its known twin: an unidentified ego has `ego: false` and a null `egoName`, an unassessed artifact has `artifact: false`, and bonuses, modifiers, flags, brands, slays, resists, curses and `value` count only what the player has learned. A controller's `monsters()` list holds only perceived monsters too.

`PlayerView` carries `hpWarning`, the low hit point threshold in hit points: `trunc(maxHp * hitpoint_warn / 10)`, or 0 when the warning is off. The warning applies while `hp` is below it. `recall` and `descent` are the turns left on Word of Recall and Deep Descent, and 0 when neither is active. `dead` turns true the moment the character dies, before the fatal message is acknowledged, so a death effect can start there instead of reading hit points, which bloodlust can take below zero.

`status.afraid` is the Fear timer alone. `status.fearful` is true whenever the character cannot fight in melee: timed fear, Terror, or fear from a curse, an item or a shape. `status.terror`, `status.amnesia` and `status.image` are the Terror, Amnesia and Hallucination timers. Amnesia stops the character reading scrolls.

A remembered object in `ctx.knownLevel()` may carry `aura`: `cursed` for a known curse, `artifact` for an object known to be an artifact, or `rune` for an assessed object with a rune the player has not learned. These match the `{cursed}` and `{??}` markers and the artifact name that the item list already shows. An object has at most one aura, taken in that order.

`ctx.inspect.terrainCatalogue()`, under `state:map.read`, returns every bound terrain feature with its index, code, name and terrain flag codes, plus `stairs` (`"up"`, `"down"` or null), `fiery` and `passable`. The index matches `CellView.feat` and the known level's `feat`.

The `bolt` and `explosion` events (`event:bolt` and `event:explosion`) name their projection in `element`, such as `FIRE` or `COLD`, beside the numeric `projType`. An explosion also reports `arc` for a breath or cone, and `radius`, the farthest affected distance from its centre. The `motion` event in section 4l already marks a blink or teleport with `kind: "teleport"`.

Use `view.knownFloorItems(x, y)` with `state:floor.read` to read the player's remembered floor pile, oldest memory first. Each entry has an opaque `ref`, its `grid`, and `visibility` (`"seen"` or `"remembered"`). An exact memory has `sensed: false` and `item`, whose `name` uses the game's player-facing object description. Unknown flavours and runes stay obscured; the details omit raw kind names, kind IDs and subtype indices. A sensed entry has `sensed: true`, `money`, and `item: null`, so it reveals neither the item kind nor its stack size. Unseen drops add no entries. Remembered properties survive unseen changes, removal and save/load. `cell(x, y).knownObjectCount` counts the same memory entries, sensed ones included, under `state:map.read`.

Pass an entry's `ref` to `view.inspectKnownFloorItem(ref)`, also under `state:floor.read`. The reference belongs to the view that returned it and follows object identity through pile reordering. The result has `status: "seen"` and the game's existing `inspection` text only while that object remains on the remembered grid and the player sees the grid. `"stale"` means the reference cannot be confirmed, including any out-of-sight grid; it does not tell you whether an unseen object has gone. `"sensed"` means the memory has no exact item details, and `"unavailable"` means the host supplied no inspection data. Those results have `inspection: null`. The reads learn nothing. Existing `floorItems()`, cell object counts and glyphs, and `capture().floorHere` keep their behavior.

## 4u. Character sheet, saves, options and keymaps

`ctx.character.sheet()`, under `state:player.read`, returns the character sheet as data: the five panels of the first page with each line's label, value and colour, one row per stat with the Self, race, class, equipment and Best columns, the background paragraph, and the second page's sustains, resistance, ability, hindrance and modifier grids. Each grid row has one cell per equipment slot and then the player's own column. Every colour comes as its COLOUR_* index and as a CSS colour. The sheet is built by the same functions as the character screen, so the two never disagree, and it is `null` for the grids when the game has no ui_entry packs.

`ctx.saves.rename(id, name)` renames any saved character, not only the one in play. For a character that is not loaded, the host changes the name inside its save and in the roster. The rename is refused for a save from a newer build of the game, for a save that failed its integrity check, and for a dead character, whose save no longer exists. A dead character cannot be replayed either, because death is final.

`ctx.options`, under `state:options.read`, lists every option on the interface, birth, cheat and score pages with its description and current value, plus the hit point warning, the delay factor and the movement delay. With `options:write` as well, `set()` changes user interface options and those three numbers. A change applies whole or not at all, fires the `optionsChanged` hook and saves the game, the same as closing the options menu. Birth options lock at character creation, and a cheat option takes the character off the score table for good, so `set()` refuses both.

`ctx.keybindings`, under `keymap:edit`, is the player's keymap editor for the current keyset. `list()` returns every binding with the mod that created it, if any; `set()` binds or replaces a trigger and `remove()` drops one, and both save at once. A binding set here belongs to the player even when it replaces one a mod made with `ctx.keymaps`, so that mod no longer removes it. `capture()` resolves with the next key the player presses that a keymap can use, or null for Escape, and the game never acts on that key. `keymap:write` does not cover `keymap:edit`.

Each call works on the keyset in use unless it names the other one: `list("roguelike")`, `set(trigger, action, "original")` and `remove(trigger, keyset)` edit either set, as upstream's keymap editor can. `commands()` lists the game's commands as its command menu shows them, after any mod's menu changes, each with its name, its menu group, its plain key in each keyset (null where it has none there) and the letter of any Ctrl chord that runs it. That is what a key does when no keymap is bound to it, so an editor can warn before a binding hides a command. `cancelCapture()` stops a waiting capture as Escape would: it resolves with null, the next key reaches the game, and it returns false when nothing was waiting. Call it when your form closes. (neostryder/neo-angband#362)

## 4v. Knowledge browser

`ctx.knowledge`, under `state:knowledge.read`, is the knowledge menu as data. `categories()` names the eight browsers (objects, runes, artifacts, egos, monsters, features, traps and shapes) with each one's title and how many entries it lists. `list(category)` returns the known members in the game's own groups and order, each with an `id`, its name, its colour and the extra fields the game prints beside it, such as a rune's note or a monster's symbol, kills and "Full" column. `recall(category, id)` returns that entry's recall page, the same `ScreenView` the game shows, or null for an entry the player does not know yet.

Every entry also has `known`. It is false only for an object flavour the player has seen but not identified, which the objects list shows under its flavour name, and true for everything else, since the lists hold nothing the player has not met. A known-only filter hides the entries where it is false. (neostryder/neo-angband#362)

Each call reads the live game, so a monster page gains lines as the character learns more about it. Read it again after the snapshot changes rather than keeping an old copy. An ego id includes its group, because an ego appears once for each kind of item it can be found on.

Reading a page changes nothing. The artifact recall builds its sample object from the game's random stream, as upstream's does, so opening that page in the game's own browser moves the stream. A mod's read puts the stream back exactly as it was, so drawing a knowledge tab cannot change the next level.

## 4w. Run journal and end-of-run report

`ctx.character.history()`, under `state:player.read`, is the character's history as data, oldest first: the same entries the character history screen and the character dump show. Each entry has a `kind` (`birth`, `level`, `unique`, `artifact`, `artifact-unknown`, `note`, `import` or `other`), its text, the turn, the dungeon level and character level it was recorded at, and `lost` for an artifact the character no longer has. Regaining a drained level adds another `level` entry, as it does in Angband, so a timeline that shows each level once keeps the first.

Angband's history has no entry for reaching a new dungeon level, and the port adds none, because that would change the character dump. A mod that wants depth milestones records them itself from the `dungeonlevel` event in section 4l, stored under `ctx.character.key()`. The event also fires with `cause: "load"` each time the game loads, so compare the depth with the milestones already stored before adding one.

`ctx.character.onRunEnd(listener)` calls the listener once when a character dies or retires, after every item has been identified and the score table written, and before the tombstone. The report says whether the run ended in death, victory or retirement, and names the cause. It carries the character's name, race, class and levels, the deepest and final dungeon level, gold, the final turn, the score and whether the score table accepted it. It also has the full history, the last 40 messages, the character sheet, and every item worn, carried or left in the home, with its location, quantity and inspect text. `ctx.character.runReport()` returns the same report to a mod that loads later. It lasts until the page reloads, and starting a new character reloads it, so a mod that keeps a graveyard of past runs stores each report when `onRunEnd` fires.

## 4x. Character creation

`birth(ctx)`, under `ui:birth.replace`, lets a mod run character creation in place of the game's birth screens. Each time the game is about to show them, the presenter's `show(session)` is offered a `ModBirthSession`. Returning true takes that creation, and anything else lets the game show its own screens. The session's `catalogue()` lists the races and classes with their stat adjustments, hit die, experience factor, infravision, skills, magic realms and abilities, plus the point budget, the name limit and the previous character. `draft()` is the character so far with a preview: the birth screen's stat rows and its five character panels.

The draft changes only through the game's rules. `chooseRace` and `chooseClass` reset the stats to that pair's suggested spread, as the birth menus do. `buy`, `sell`, `suggest` and `reset` are point-buy. `roll` and `previousRoll` are the standard roller. The draft also covers the name, a random name, the background, the birth options and `usePrevious`. Rolls, backgrounds and random names come from the same random stream the birth screens use. `accept()` starts the game with the same choice those screens return, and `cancel()` goes back to the title.

`draft().statCosts` gives point-buy per stat, STR to CON: `buyCost`, what the next point costs (null at 18); `sellRefund`, what lowering it gives back (null at 10); and `canBuy` and `canSell`, whether those calls would succeed now. With the roller every figure is null and both flags are false. `restoreHistory()` puts back the background the game generated and clears `historyEdited`, which resending the old text through `setHistory` does not. (neostryder/neo-angband#362)

`ctx.saves.create()` starts character creation from a mod, as the title screen's new character does, and the page reloads into it. `create({ like })` sets the previous character first, so `usePrevious` and the name default start from it. A run report's `birth` field has the shape `like` takes, which is how a graveyard offers a new character like a dead one. The dead character itself stays dead.

Pass `resumeAutoplayer: true` to `create()` to give the new character to your own autoplayer. This is for a roll-on setting the player turns on in your mod ahead of time: after a death, the mod calls `create({ like: report.birth, resumeAutoplayer: true })` and play carries on. The call is refused unless your controller holds the keyboard at that moment. The character born from the birth screens that follow gets your controller on its first boot, with no prompt, and is marked as autoplayed. If the player leaves the birth screens and loads a different character instead, that character is asked about as usual. Pair it with `onDeath: "end"` from section 4q, since a controller that reincarnates in place never reaches a death. (neostryder/neo-angband#300)

## 4y. Numeric settings

A mod can declare numbers the player sets on the Mods screen, such as an effect's strength or a delay. They go under a top-level `settings` key in `manifest.json`, not inside `rules`, so an engine from before this seam drops the key and shows the mod's switches as before. Each entry has an `id`, a `title` and a `description`, then `min`, `max`, `step` and `default`, and optionally `unit`, `parent` and `requiresReload`. The id must differ from every rule flag in the manifest. The default must lie on a step between `min` and `max`, and `parent` must name one of the manifest's rules.

On the Mods screen a setting is a row under its mod's switches, such as `CRT strength: < 60% >`. Left and Right move it one step and stop at either end. Enter, Space or a click raises it one step, and past `max` it goes back to `min`, so a mouse alone reaches every value. A setting with a `parent` shows only while that rule is on. The values are stored per profile in their own JSON document, `neo-angband/web/mod-settings`, and a value is kept when its mod is turned off.

`ctx.settings` is present for a mod whose manifest declares at least one setting. `get(id)` and `all()` return the values clamped to the declared range and rounded to the nearest step, whatever the stored value says, so a mod that narrows a range in a later version still reads a value inside it. `onChange(listener)` calls `listener(id, value)` when the player changes a setting, and returns a function that stops it. A setting marked `requiresReload` changes nothing until the game reloads, so it fires no change and the manager offers its reload prompt. `resolveSettingValue(setting, value)` in the SDK does the same clamping for a mod's own tests.

`set(id, value)` moves one of the mod's own settings, as the player would on the Mods screen: the value is clamped and snapped the same way, saved, and returned. Listeners hear it unless the setting is marked `requiresReload`, in which case it takes effect after the next reload. An id the manifest does not declare, or a value that is not a number, returns undefined and saves nothing. A mod can change only its own settings. (neostryder/neo-angband#362)

## 4v. `ctx.display.setChromeTheme` - the window chrome's look

`ctx.display.setChromeTheme(theme)` repaints the chrome around the panels: title bars, tabs, buttons, dividers and drop guides. It needs `display:filter`. Every key is optional: `font` (a family already loaded in the page, for example with the FontFace API), `fontSize` (8 to 24), the colours `page`, `titleBackground`, `text`, `textStrong`, `muted`, `border`, `divider`, `dividerHover`, `accent` and `floatBorder` (as #rgb, #rrggbb, #rrggbbaa or rgb()), `radius` (0 to 16) and `shadow` (true or false). An unknown key or a bad value throws. `null` puts back the game's own look: Angband's palette and its 8x13 dialog font. As with the other display setters, each mod's last request is kept, the most recent one is in force, and a mod's request goes away when the mod is torn down. `getChromeTheme()` reports the theme in force. It covers the chrome only; what a panel shows inside is up to whoever draws that panel.

`ctx.display.setTerminalGround({ color, scope })` sets the colour the text terminals clear to, so they match a mod's panels instead of showing the game's black. It needs `display:filter`. `color` takes the forms `setChromeTheme` accepts. `scope` is `subwindows`, the default, for every text subwindow such as Inventory or Messages, or `all` to include the main terminal and the dungeon map. The ground covers the full-canvas fill, the letterbox around the grid and every cell with no background of its own. Explicit cell backgrounds (a highlighted row, the cursor, inverse text) and all text colours stay the game's. Screen dumps and `snapshotColored()` read the grid rather than the canvas, so they keep reporting the game's colours. `null` restores the game's ground, and `getTerminalGround()` returns the `{ color, scope }` in force, or null. Ownership and teardown follow the same last-request-per-mod rule as the other display setters.

## 4z. `ctx.net` - HTTP requests through the host

`ctx.net` sends HTTP requests to the hosts a mod's manifest names. It is present when the manifest asks for at least one `network:` host. `network:api.example.com` covers that host on the default port of http or https, `network:localhost:8010` covers one port, and `network:local` covers this computer and the private address ranges of a home network on any port, for a server whose address the player types in. `network:local` judges IP literals and `localhost` only; a name such as `laya.lan` needs its own grant. The consent screen lists each host.

`request({ url, method, headers, body, timeoutMs })` never throws. When a response arrives it resolves to `{ ok: true, status, headers, body }`, whatever the status. When none does it resolves to `{ ok: false, code, problem }`, where `problem` is a sentence the mod can show the player and `code` is the `NetProblemCode` that names the reason, such as `not-declared` for a host the manifest does not list or `timeout`. Bodies are strings, up to 1 MiB going out and 4 MiB coming back. The timeout defaults to 30 seconds and can be set from 1 to 120. A mod cannot set cookies or the `Host`, `Origin` and `Referer` headers, and the page's own cookies are never sent.

In the desktop app the main process sends the request, so the server needs no CORS headers and an http server on the local network is reachable from the game's page. Redirects are followed up to three times, and each hop must land on a declared host. In a browser tab `request` is `fetch` from the page: CORS applies, a redirect is reported rather than followed, and a server on the local network has to allow the page's origin. `ctx.net.transport` is `relay` or `page`, so a mod can say which limits apply.

Secrets keep an API key out of the mod's own code and storage. `ctx.net.secrets.set(name, value, { hosts })` stores a value, and a header written as `Authorization: Bearer {secret:jev}` sends it. The host fills in the value only when the request goes to one of `hosts`, which must be hosts the manifest declares. `fromEnv(name, variables, { hosts })` takes the value from the first of the listed environment variables that is set, such as `["TYPESAFE_API_KEY", "JEV_API_KEY"]`. `has(name)` says whether a secret is set and where, and `delete(name)` removes it. No call returns a value. In the desktop app `set` encrypts the value with the operating system's key store, in a file the page cannot read, and `fromEnv` shows the player a dialog naming the variables and the servers before anything is read. The dialog comes back only when the variables or the servers change. In a browser tab secrets are kept in page storage, where any script on the page can read them, `fromEnv` is refused, and every response that used a secret carries `secretStorage: "page"`. Tell the player when a key is stored that way.

```js
const net = ctx.net;
if (net) {
  await net.secrets.fromEnv("jev", ["TYPESAFE_API_KEY", "JEV_API_KEY"], { hosts: ["api.typesafe.ai"] });
  const reply = await net.request({
    url: "https://api.typesafe.ai/v1/systemone",
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer {secret:jev}" },
    body: JSON.stringify(question),
  });
  if (!reply.ok) ctx.log(reply.problem);
}
```

Code running in the page can still reach the relay without `ctx.net`, because in-process mods share the page. The host checks on each request are consent checks against what the manifest declared. The secret rules hold even so: a value is sent only to the hosts it was stored for, it never comes back to the page, and an environment variable is read only after the player agrees. Mods in the Worker tier do not get `ctx.net`. (neostryder/neo-angband#300)

## 4za. `ctx.shared` - values one mod shares with others

A mod can publish named JSON values for other mods to read. A plugin that declares `shared:publish` calls `ctx.shared.publish(name, version, value)`, and one that declares `shared:read` calls `ctx.shared.read(modId, name)`. `ctx.shared` is present when the manifest declares either capability, and a method whose capability is missing throws a capability error. Both capabilities are listed on the Mods screen, so the player can see which mods share data and which mods read it.

A name is 1 to 64 characters of lower-case letters, digits, `.`, `-` and `_`. The version is a whole number the publisher picks for that name; raise it when the value's shape changes so a reader can tell the shapes apart. The value has to be plain JSON: objects, arrays, strings, finite numbers, booleans and null. A function, `undefined`, `NaN`, a `Date`, a `Map`, a class instance, an empty array slot or a value that contains itself throws a `TypeError` naming the path to the bad part. A value whose JSON text is over 256 KiB in UTF-8 throws a `RangeError`. Either way the previous value stays. The host copies the value at publish time, so editing your object afterwards changes nothing until you publish again, and each publish replaces the whole record. `withdraw(name)` removes it.

`read(modId, name)` returns `{ mod, name, version, value }`, frozen all the way down, or null when the publisher is not installed, is disabled, failed to load, or has not published that name. Values last until the page reloads. A mod whose `register()` throws loses its values at once, and so does every mod at teardown, after all the `uninstall()` calls have run. Load order does not matter, since a read returns what is published at the moment you call it, so read when you need the value instead of keeping a copy from load time. `onChange(modId, name, listener)` calls the listener after each publish or withdrawal of that name, with the new record or null, and returns a function that stops it. A listener that throws is reported against the mod that registered it.

Treat a shared value as untrusted input. Another mod wrote it, and the player may have any version of that mod installed, so check the version and the type of every field you use before drawing it or acting on it.

Two mods that both act on the same event run in an order you do not control. In the example below the recap listens with `onChange` rather than reading inside its own `onRunEnd`, which could run before the reporter has published. Worker-tier mods do not get `ctx.shared`. (#365)

```js
// The run reporter's plugin.js (manifest: "shared:publish")
ctx.character.onRunEnd((report) => {
  ctx.shared.publish("run-summary", 1, {
    name: report.name,
    cause: report.cause,
    maxDepth: report.maxDepth,
    notes: pickNotes(report), // an array of strings
  });
});

// The death recap's plugin.js (manifest: "shared:read")
function summaryLines() {
  const shared = ctx.shared.read("run-reporter", "run-summary");
  const notes = shared?.version === 1 ? shared.value?.notes : undefined;
  if (!Array.isArray(notes)) return ["The run reporter has no summary for this run."];
  return notes.filter((line) => typeof line === "string").slice(0, 20);
}
ctx.shared.onChange("run-reporter", "run-summary", () => recap.redraw(summaryLines()));
```

## 5. Doors that are exported but deliberately closed

An exported mutable table is an extension point whether or not anyone meant it to be one. Two were found this way and are now frozen at runtime, not just typed `readonly`, because a mod folder ships plain `plugin.js` and the type binds nothing there:

| Table | Where | Why it is closed |
| --- | --- | --- |
| `MONSTER_HANDLERS` (56 slots) | `core/src/mon/project-mon.ts` | Exported for the parity test that counts the slots. |
| `DEBUG_MENU` (9 categories) | `web/src/wizard.ts` | Upstream's own `cmd_debug_*` tables; the parity tests assert their letters. Frozen **deeply** - the rows anyone would want to add live in `commands`, one level down. |

A mod assigning into one of these tables would patch core from *outside* the mod system, so the patch:

- has no ordering against another mod's patch (nothing composed it);
- appears in no manifest, so no menu, save or report can name it;
- **survives disabling the mod that added it**, which contradicts the rule that a disabled mod's patches do not exist.

Both are covered by tests that assert the write throws, and both were mutation-proven by removing the freeze. If you need to change what one of these tables does, ask for a hook in `core/src/mod/hooks.ts`, where contributions compose, order and disable properly. That is a reasonable request.

## Why this is safe for a faithful port

Absence is the default at every level. With no mod enabled, no entry point is called, nothing is contributed, `composeModHooks` returns `undefined` and `GameState.modHooks` stays absent, so every call site is one `?.` away from the 4.2.6 line. There is no map to mis-key and no flag to leak. Core holds no mod's name and no mod's fix body: the seam is generic, and the patch is the mod's own module.

The generation and object hooks are RNG-free by contract, so a seed still means the same dungeon, and a level that needed no repair is bit-identical to one generated with no mod at all. Mod choices are a client setting and are not saved, so a save stays portable, does not bake in a mod's behaviour, and the same character plays faithfully if the mod is removed. Turning a patch off is a true revert, because the faithful path is the only path core ever compiled.

## Input-door groundwork

`packages/web/src/input-door.ts` owns the only browser `keydown` listener. It normalizes keyboard input and queued keymap output into `UiInput`, and a future gamepad or touch adapter would submit the same value. `UiDirection` includes a continuous `x`/`y` vector, a magnitude and a clockwise angle, so analog input can stay at, for example, 37 degrees until a legacy direction prompt chooses to quantize it. Before the player-keymap resolver runs, the host keeps its three existing ownership gates: score pages, modal depth and an active run-interrupt pump receive the literal key rather than a queued expansion. The input door is host infrastructure and is not yet a registry or plugin capability. The player's stored keymap is resolved before screen subscribers, so a later mod input consumer cannot silently take over a binding the player chose.

## Where to look

| Concern | File |
| --- | --- |
| The `ModHooks` interface + per-hook fold rules | `packages/core/src/mod/hooks.ts` |
| `GameState.modHooks` field, `modRuleEnabled` tombstone | `packages/core/src/game/context.ts` |
| Start/load seam + live-hook threading into deps | `packages/core/src/session/game.ts` |
| Deps-bag hook fields (no `GameState` in scope) | `packages/core/src/gen/generate.ts`, `packages/core/src/obj/make.ts` |
| Auto-dig indirection + public dig primitives | `packages/core/src/game/cave-cmd.ts`, `player-turn.ts` |
| Manifest `rules` type + validation | `packages/mod-sdk/src/manifest.ts` |
| Rule discovery | `packages/web/src/pack.ts` (`loadEnabledModRuleDecls`) |
| Choice persistence + resolver | `packages/web/src/mod-store.ts` |
| Per-mod hook discovery + fold | `packages/web/src/mod-hooks.ts` |
| The first-party mods' own hook code (their repositories, not this tree) | `neo-angband-mod-bug-fixes/plugin.ts`, `neo-angband-mod-qol/plugin.ts` |
| Per-mod Fixes & tweaks submenu | `packages/web/src/mods.ts` (`managePatches`) |
| DOM panels: the layer, the invariants, the way out | `packages/web/src/panel-runtime.ts` |
| The content-only install door, and its session sibling | `packages/web/src/install-runtime.ts` |
| The session tier: staging, the lifetime, and what it is worth | `packages/web/src/mod-session.ts` |
| Conjuring, and the debug mark that pays for it | `packages/web/src/spawn-runtime.ts` |
| The one keydown registration, and the door's stand-down | `packages/web/src/input-door.ts` |
| Host wiring + message sink | `packages/web/src/main.ts` |
| Per-mod design | `docs/modding/QOL.md`, `docs/modding/BUG_FIXES.md` |
| Measured reach + gap list | `docs/modding/MOD_REACH.md` |
