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
- `setSidebarExtent()` reserves whole terminal columns or rows for a mod-owned sidebar, and `setTileScaling()` selects the existing automatic sampler or crisp nearest-neighbour sampling.
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
| `objectInfoText(text)` | `chained` | `obj/object-info.ts` (`objectInfo`, once per fragment of the finished textblock) | `?? text` - write the fragment unchanged |
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

`characterBackground` gets the background paragraph built from `history.txt` in one piece, before the 72-column wrap, so a phrase split across two screen lines still arrives whole. Content patches cannot reach these phrases because history records have no record key.

`objectInfoText` gets an item description one fragment at a time, in the pieces `obj-info.c` appends, so `"Affects your stealth\n"` comes as one string. Item inspection, object recall, the character dump and spoiler files all pass through it.

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
3. `packages/web/src/mod-store.ts` `resolveModRules(decls, choices)` computes the effective map: for each declared rule, `choices[flag] ?? rule.default`. The player's choices come from each mod's **Fixes & tweaks** submenu and persist in `localStorage` (`neo:modRuleChoices`). They are a client setting, like the enabled-mod set, and are not part of the savefile.
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
- **Changes are expressed as slots and gear references, not equipment arrays.** `wield` routes each item through the engine's own `wield_slot`, so the second of a pair of rings lands in the second ring slot as it would in play. `carry` takes something into the pack, `remove` empties a slot into the pack, and `release` gives a stack up entirely, emptying its slot when the handle names worn gear. A reference is a gear handle, a shop plus a stock index for a ware (which is not in the gear and so has no handle), or a `GameObject` for a caller inside the engine. A reference that names nothing is skipped and listed in `unresolved`, so a decision ladder evaluating a hundred candidates does not fail on one stale handle.
- **The answer is every derived field, not a score.** An autoplayer reduces it to one number, while a player comparing two items wants to see which resist was traded for which. A scalar serves the first and not the second, and the two should never disagree about the underlying derive, so `before`, `after` and `delta` carry every field of `player_state` plus max hitpoints, max mana, the armour encumbrance and the carried weight. `neo-angband-mod-borg` uses a fraction of it today.

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

`ModProject` has emitted a mod folder's exact bytes since it was written, and its own header names the caller it was waiting for: "a builder that returned paths and contents is equally usable from a CLI, from a test, and from an in-game mod editor." No in-game editor could exist, because nothing a mod could reach turned bytes into an installed mod. `HostDir` has no `MODS` entry, `RAW_FS_OPS` has no `mkdir`, the desktop shell's loopback server has no write route into `mods/`, and an install lands in IndexedDB, not on a filesystem.

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
