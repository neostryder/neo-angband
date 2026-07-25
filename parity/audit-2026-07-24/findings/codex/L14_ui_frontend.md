### L14_ui_frontend-001  Native module header has no browser counterpart
sev: P3
concession: y
ref: reference/src/main.h:24
port: NONE
expected: Native frontend module declarations and platform initialization interfaces.
actual: Browser startup uses direct TypeScript imports without a module header equivalent.
why: Native module selection is unavailable in the browser frontend.
confidence: high

### L14_ui_frontend-002  Main Windows frontend does not decode C background attributes
sev: P2
concession: n
ref: reference/src/main-win.c:2131
port: packages/web/src/term.ts:399
expected: Decode MULT_BG attributes and render BG_SAME, BG_DARK, or BG_BLACK backgrounds.
actual: Generic text output stores only foreground color unless a caller explicitly supplies a CSS background.
why: Cells using C background attributes can render with the wrong background.
confidence: high

### L14_ui_frontend-003  Native Windows frontend is replaced by browser rendering
sev: P3
concession: y
ref: reference/src/main-win.c:1
port: packages/web/src/main.ts:1; packages/web/src/term.ts:1
expected: Win32 windows, menus, fonts, preferences, native input, and native drawing are initialized by the Windows frontend.
actual: A browser canvas, DOM keyboard events, local storage, and modal overlays provide the frontend.
why: The native Win32 window and input model has no browser equivalent.
confidence: high

### L14_ui_frontend-004  Browser startup omits native command-line bootstrap
sev: P3
concession: y
ref: reference/src/main.c:278
port: packages/web/src/main.ts:5977
expected: Parse native command-line module, savefile, graphics, path, and new-game options before starting the selected frontend.
actual: Browser startup uses URL parameters, roster storage, and browser boot menus instead of native command-line parsing.
why: Native process launch options cannot be reproduced in a browser tab.
confidence: high

### L14_ui_frontend-005  Birth random choices use an independent RNG
sev: P1
concession: n
ref: reference/src/ui-birth.c:678
port: packages/web/src/birth.ts:1207
expected: Random birth choices consume the shared game RNG stream.
actual: Random birth choices use a new Date.now-seeded RNG.
why: Random outcomes and RNG sequencing diverge from seeded C gameplay.
confidence: high

### L14_ui_frontend-006  Random birth name is missing
sev: P2
concession: n
ref: reference/src/ui-birth.c:725
port: packages/web/src/birth.ts:1652
expected: Random completion calls player_random_name() and accepts the generated name.
actual: Random completion leaves the name empty and defaults it to Adventurer.
why: Random character creation produces a different visible and saved name.
confidence: high

### L14_ui_frontend-007  Birth help key is a no-op
sev: P2
concession: n
ref: reference/src/ui-birth.c:859
port: packages/web/src/birth.ts:946
expected: The birth menu '?' key opens do_cmd_help().
actual: The birth menu recognizes '?' and returns without opening help.
why: Players cannot reach the reference help screen from birth menus.
confidence: high

### L14_ui_frontend-008  Screen dump format and contents differ
sev: P2
concession: n
ref: reference/src/ui-command.c:540
port: packages/web/src/main.ts:4315
expected: Prompt for HTML or forum text, optionally include the monster-list subwindow, reset visuals, and write the terminal grid dump.
actual: Always downloads a PNG of the current canvas.
why: Player-requested screen dumps are not equivalent to the C output.
confidence: high

### L14_ui_frontend-009  Player context menu omits Use
sev: P2
concession: n
ref: reference/src/ui-context.c:267
port: packages/web/src/context-menu.ts:63
expected: The player context menu includes the generic Use command.
actual: The player context menu starts with Cast and has no Use entry.
why: Right-clicking the player cannot invoke the normal generic item-use command.
confidence: high

### L14_ui_frontend-010  Player context availability rules differ
sev: P2
concession: n
ref: reference/src/ui-context.c:269
port: packages/web/src/context-menu.ts:63
expected: Cast, Go Up, Go Down, and Explore are added only when their C predicates permit them; Explore depends on autoexplore_commands.
actual: Cast and stair commands are always rendered disabled when unavailable, and Explore is always rendered.
why: Menu contents and selectable command layout visibly diverge.
confidence: high

### L14_ui_frontend-011  Spellbook Browse is missing from object context menus
sev: P2
concession: n
ref: reference/src/ui-context.c:680
port: packages/web/src/context-menu.ts:257
expected: A browsable spellbook adds the Browse command and opens the spell menu.
actual: The object context menu omits Browse and offers only Cast and Study for books.
why: Right-clicking a spellbook cannot open the reference browse view.
confidence: high

### L14_ui_frontend-012  Single removable curse skips selection
sev: P2
concession: n
ref: reference/src/ui-curse.c:91
port: packages/web/src/main.ts:1683
expected: Any nonempty removable-curse list opens the curse menu, including one entry.
actual: The curse menu opens only when more than one removable curse exists.
why: The one-curse path does not preserve the C selection interaction or selected curse index.
confidence: high

### L14_ui_frontend-013  Retirement uses death artwork
sev: P2
concession: n
ref: reference/src/ui-death.c:75
port: packages/web/src/screens.ts:1294
expected: Retirement loads retire.txt while death loads dead.txt.
actual: The web tombstone always uses embedded dead artwork.
why: Retired characters display the wrong exit screen.
confidence: high

### L14_ui_frontend-014  Sidebar stats omit live equipment and timed modifiers
sev: P2
concession: n
ref: reference/src/ui-display.c:160
port: packages/core/src/game/display.ts:184
expected: Display player->state.stat_use, including equipment and timed effects.
actual: The live default derives statUse from only race and class adjustments.
why: Equipped or temporarily modified stats can display incorrectly.
confidence: high

### L14_ui_frontend-015  Moves indicator is never wired live
sev: P2
concession: n
ref: reference/src/ui-display.c:1147
port: packages/web/src/main.ts:4605
expected: Display player->state.num_moves as Moves +N or Moves -N when nonzero.
actual: displayDeps supplies no numMoves, so the model defaults to zero.
why: The live status line omits the C movement-speed indicator.
confidence: high

### L14_ui_frontend-016  Projectile animations are absent
sev: P2
concession: n
ref: reference/src/ui-display.c:1643
port: packages/web/src/main.ts:2259
expected: Bolt, beam, and missile event handlers draw transient glyphs with delay-factor timing.
actual: Fire and throw dispatch directly to core path processing with no transient UI animation.
why: Normal ranged and projection effects lose visible C frontend animation.
confidence: high

### L14_ui_frontend-017  Select effects fall back to random choice
sev: P1
concession: n
ref: reference/src/ui-effect.c:162
port: packages/core/src/effects/interpreter.ts:487
expected: EF_SELECT presents an effect menu, including the optional random entry, and returns the selected index.
actual: No live chooseEffect implementation is wired, so the interpreter selects randomly.
why: Player-controlled random-effect choices become automatic RNG choices.
confidence: high

### L14_ui_frontend-018  Object-list overflow summary is missing
sev: P2
concession: n
ref: reference/src/ui-obj-list.c:169
port: packages/web/src/screens.ts:962
expected: Limit the object-list section to available text-block height and emit ...and N others.
actual: Render every object row in a scrollable modal without the C overflow summary.
why: Crowded object lists show different information and interaction.
confidence: high

### L14_ui_frontend-019  Ability menu tags do not skip movement keys
sev: P2
concession: n
ref: reference/src/ui-player-properties.c:31
port: packages/web/src/overlay.ts:43
expected: Ability tags use all_letters_nohjkl, skipping h, j, k, and l.
actual: Menu tags use the contiguous alphabet including h, j, k, and l.
why: Letter selection addresses different abilities than the C UI.
confidence: high

### L14_ui_frontend-020  Spell menu tags do not skip movement keys
sev: P2
concession: n
ref: reference/src/ui-spell.c:249
port: packages/web/src/overlay.ts:43; packages/web/src/screens.ts:668
expected: Spell selection uses all_letters_nohjkl.
actual: Spell rows receive contiguous a-z menu tags.
why: Letter selection differs for spell cast, study, and browse menus.
confidence: high

### L14_ui_frontend-021  Subwindow setup is missing
sev: P2
concession: n
ref: reference/src/ui-options.c:2042
port: packages/web/src/options.ts:548
expected: The options menu exposes subwindow setup.
actual: The web options menu omits subwindow setup because no subwindows are modelled.
why: Users cannot configure the C frontend's simultaneous auxiliary windows.
confidence: high

### L14_ui_frontend-022  Advanced visual editing is missing
sev: P2
concession: n
ref: reference/src/ui-options.c:2059
port: packages/web/src/options.ts:507
expected: Save visuals opens per-entity visual editing and persistence.
actual: The web UI only selects a tile set or ASCII mode.
why: Individual glyph and color mappings cannot be edited from the UI.
confidence: high

### L14_ui_frontend-023  Preference commands are not parsed
sev: P2
concession: n
ref: reference/src/ui-prefs.c:1185
port: packages/web/src/main.ts:4343
expected: A typed preference directive is parsed and applied.
actual: Every preference-line command reports Pref command not recognized.
why: Valid C preference directives have no effect in the web frontend.
confidence: high

### L14_ui_frontend-024  Store flavor uses the wrong RNG and omits hints
sev: P1
concession: n
ref: reference/src/ui-store.c:139
port: packages/web/src/shop.ts:180
expected: Welcome and hint choices use the game RNG with the C one_in_ and randint0 draw order.
actual: Welcome text uses Math.random and omits the C hint branches.
why: Shop visits produce different flavor and advance no equivalent game RNG sequence.
confidence: high

### L14_ui_frontend-025  POSIX signal handling has no browser counterpart
sev: P3
concession: y
ref: reference/src/ui-signals.c:26
port: NONE
expected: Install SIGHUP, SIGTSTP, and SIGINT handlers for orderly save, suspend, and shutdown behavior.
actual: No browser implementation exists for these POSIX signal handlers.
why: Browser tabs do not expose the native POSIX signal model.
confidence: high

### L14_ui_frontend-026  Interactive spoilers are unavailable in the web UI
sev: P3
concession: n
ref: reference/src/ui-spoil.c:47
port: packages/web/src/wizard.ts:293; packages/cli/src/spoilers.ts:1
expected: The interactive UI exposes spoiler actions that generate the four spoiler files.
actual: Web wizard selection reports the feature as unavailable and generation exists only in CLI tooling.
why: Web users cannot invoke the reference spoiler workflow.
confidence: high

### L14_ui_frontend-027  Wizard graphics demo is not ported
sev: P3
concession: n
ref: reference/src/ui-wizard.c:78
port: packages/web/src/wizard.ts:273
expected: The wizard opens the projection graphics demonstration.
actual: The web action reports that the graphics demo is not ported.
why: The wizard lacks the reference projection-visual diagnostic.
confidence: high

### L14_ui_frontend-028  Wizard keylog is not ported
sev: P3
concession: n
ref: reference/src/ui-wizard.c:99
port: packages/web/src/wizard.ts:307
expected: Display recent keypresses with key codes and modifiers.
actual: The web shell does not record a keystroke log.
why: A browser KeyboardEvent stream could provide this debugging view.
confidence: high

### L14_ui_frontend-029  Native DIB frontend is replaced by browser decoding
sev: P3
concession: y
ref: reference/src/win/readdib.c:20
port: packages/web/src/tiles.ts:64
expected: Decode Windows DIB resources through the native Win32 DIB loader.
actual: Decode tile images through browser Image and canvas APIs.
why: This is an unavoidable platform-specific frontend substitution.
confidence: high

### L14_ui_frontend-030  Native PNG frontend is replaced by browser decoding
sev: P3
concession: y
ref: reference/src/win/readpng.c:20
port: packages/web/src/tiles.ts:64
expected: Decode PNG pixels, palettes, alpha, and masks through the native libpng path.
actual: Load PNG images through browser Image and canvas APIs.
why: Native libpng and Win32 bitmap ownership have no browser equivalent.
confidence: high

### L14_ui_frontend-031  Multi-window Win32 layout is not reproduced
sev: P3
concession: y
ref: reference/src/win/win-layout.c:41
port: packages/web/src/main.ts:4662
expected: Create and position distinct Win32 terminal, message, inventory, monster, object, and recall windows.
actual: Render a single fixed terminal canvas with modal overlays and a camera viewport.
why: The browser frontend has no native HWND layout model.
confidence: high

### L14_ui_frontend-032  Screenshot capture scope differs
sev: P3
concession: y
ref: reference/src/win/scrnshot.c:38
port: packages/web/src/main.ts:4315
expected: Capture the Win32 client area through GDI and write its pixels to PNG.
actual: Export the web canvas with canvas.toDataURL("image/png").
why: Browser capture covers the canvas only and cannot capture arbitrary native windows.
confidence: high

### L14_ui_frontend-033  Native libpng12 header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/libpng12/png.h:1
port: NONE
expected: Provide libpng12 declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no libpng12 header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-034  Native libpng12 configuration header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/libpng12/pngconf.h:1
port: NONE
expected: Provide libpng12 configuration declarations for the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no libpng12 configuration header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-035  Native PNG header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/png.h:1
port: NONE
expected: Provide libpng declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no PNG C header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-036  Native PNG configuration header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/pngconf.h:1
port: NONE
expected: Provide libpng configuration declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no PNG C header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-037  Native zconf header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/zconf.h:1
port: NONE
expected: Provide zlib configuration declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no zconf header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-038  Native zlib header has no browser counterpart
sev: P3
concession: y
ref: reference/src/win/include/zlib.h:1
port: NONE
expected: Provide zlib declarations required by the native PNG frontend.
actual: Browser image decoding uses platform APIs and has no zlib header.
why: The native dependency is replaced by the browser image stack.
confidence: high

### L14_ui_frontend-039  Native DIB header has no direct counterpart
sev: P3
concession: y
ref: reference/src/win/readdib.h:1
port: NONE
expected: Expose DIBINIT and ReadDIB/FreeDIB declarations to the Windows frontend.
actual: The browser tile loader exposes browser image objects instead of DIB declarations.
why: Win32 bitmap handles and DIB memory ownership do not exist in the browser.
confidence: high

### L14_ui_frontend-040  Equipment quick filters are not implemented
sev: P2
concession: n
ref: reference/src/ui-equip-cmp.c:511
port: packages/web/src/equip-cmp.ts:16
expected: q and ! prompt for and apply the normal or inverted quick attribute filter.
actual: The web equipment comparison screen has no q or ! action.
why: Players cannot reproduce the reference filtered comparison view.
confidence: high

### L14_ui_frontend-041  Equipment comparison dump is not implemented
sev: P3
concession: n
ref: reference/src/ui-equip-cmp.c:511
port: packages/web/src/equip-cmp.ts:16
expected: d prompts for a file and writes the current equipment comparison dump.
actual: The web equipment comparison screen has no d action or file dump.
why: The reference comparison export is unavailable.
confidence: high

### L14_ui_frontend-042  Target navigation shortcuts are missing
sev: P2
concession: n
ref: reference/src/ui-target.c:1488
port: packages/core/src/game/target-loop.ts:345
expected: g pathfinds, the ignore key updates tracked objects, and >, <, and x select nearest stairs or unexplored areas.
actual: The web target loop handles neither these branches nor their state updates; the keys fall through to direction or unknown-key handling.
why: Normal target-mode navigation and ignore shortcuts behave differently.
confidence: high

### L14_ui_frontend-043  Object and ego knowledge recall omits computed details
sev: P2
concession: n
ref: reference/src/ui-knowledge.c:1791
port: packages/web/src/knowledge.ts:745
expected: Fake object and ego recalls render object_info and object_info_ego computed flag, combat, and ability lines.
actual: The web recalls show only the name plus available flavor or lore text.
why: Knowledge screens omit visible mechanical information supplied by the C recall.
confidence: high

## MAP L14_ui_frontend
reference/src/grafmode.c -> packages/core/src/visuals/grafmode.ts; packages/core/src/visuals/grafmode-data.ts
reference/src/grafmode.h -> packages/core/src/visuals/grafmode.ts
reference/src/list-ui-entry-renderers.h -> packages/core/src/generated/ui-entry-renderers.ts; packages/core/src/game/ui-entry.ts
reference/src/main.c -> packages/web/src/main.ts; packages/core/src/session/game.ts
reference/src/main.h -> NONE
reference/src/main-win.c -> packages/web/src/main.ts; packages/web/src/term.ts; packages/web/src/tiles.ts; packages/web/src/options.ts; packages/web/src/ui-colors.ts
reference/src/ui-birth.c -> packages/web/src/birth.ts; packages/web/src/main.ts
reference/src/ui-birth.h -> packages/web/src/birth.ts
reference/src/ui-command.c -> packages/web/src/main.ts; packages/web/src/term.ts
reference/src/ui-command.h -> packages/web/src/main.ts
reference/src/ui-context.c -> packages/web/src/context-menu.ts; packages/web/src/main.ts
reference/src/ui-context.h -> packages/web/src/context-menu.ts
reference/src/ui-curse.c -> packages/web/src/main.ts; packages/core/src/game/effect-item.ts
reference/src/ui-curse.h -> packages/web/src/main.ts
reference/src/ui-death.c -> packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-death.h -> packages/web/src/screens.ts
reference/src/ui-display.c -> packages/core/src/game/display.ts; packages/web/src/main.ts
reference/src/ui-display.h -> packages/core/src/game/display.ts
reference/src/ui-effect.c -> packages/core/src/effects/interpreter.ts
reference/src/ui-effect.h -> packages/core/src/effects/interpreter.ts
reference/src/ui-entry.c -> packages/core/src/game/ui-entry.ts; packages/content/src/specs/ui-entry.ts
reference/src/ui-entry.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-combiner.c -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-combiner.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-init.h -> packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts
reference/src/ui-entry-renderers.c -> packages/core/src/game/ui-entry.ts; packages/core/src/generated/ui-entry-renderers.ts
reference/src/ui-entry-renderers.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-equip-cmp.c -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-equip-cmp.h -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-event.c -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-event.h -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-game.c -> packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/ui-game.h -> packages/core/src/session/game.ts; packages/web/src/main.ts
reference/src/ui-help.c -> packages/web/src/help.ts; packages/web/src/main.ts
reference/src/ui-help.h -> packages/web/src/help.ts
reference/src/ui-history.c -> packages/core/src/player/history.ts; packages/web/src/screens.ts
reference/src/ui-history.h -> packages/core/src/player/history.ts; packages/web/src/charsheet.ts
reference/src/ui-init.c -> packages/web/src/main.ts
reference/src/ui-init.h -> packages/web/src/main.ts
reference/src/ui-input.c -> packages/web/src/main.ts; packages/web/src/overlay.ts; packages/web/src/input-queue.ts
reference/src/ui-input.h -> packages/web/src/main.ts; packages/web/src/input-queue.ts
reference/src/ui-keymap.c -> packages/web/src/keymap-store.ts; packages/web/src/keymap-edit.ts
reference/src/ui-keymap.h -> packages/web/src/keymap-store.ts
reference/src/ui-knowledge.c -> packages/web/src/knowledge.ts; packages/web/src/main.ts; packages/core/src/obj/knowledge.ts; packages/core/src/mon/lore-describe.ts
reference/src/ui-knowledge.h -> packages/web/src/knowledge.ts; packages/web/src/main.ts
reference/src/ui-map.c -> packages/web/src/mapview.ts; packages/web/src/main.ts
reference/src/ui-map.h -> packages/web/src/mapview.ts
reference/src/ui-menu.c -> packages/web/src/overlay.ts
reference/src/ui-menu.h -> packages/web/src/overlay.ts
reference/src/ui-mon-list.c -> packages/core/src/game/mon-list.ts; packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-mon-list.h -> packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-mon-lore.c -> packages/core/src/mon/lore-describe.ts; packages/web/src/screens.ts
reference/src/ui-mon-lore.h -> packages/core/src/mon/lore-describe.ts
reference/src/ui-object.c -> packages/core/src/obj/object-info.ts; packages/web/src/main.ts; packages/web/src/screens.ts; packages/web/src/ignore-menu.ts
reference/src/ui-object.h -> packages/web/src/main.ts; packages/web/src/ignore-menu.ts
reference/src/ui-obj-list.c -> packages/core/src/game/obj-list.ts; packages/web/src/screens.ts; packages/web/src/main.ts
reference/src/ui-obj-list.h -> packages/core/src/game/obj-list.ts; packages/web/src/screens.ts
reference/src/ui-options.c -> packages/web/src/options.ts; packages/web/src/keymap-edit.ts; packages/web/src/colors.ts; packages/web/src/ignore-menu.ts; packages/core/src/player/options.ts
reference/src/ui-options.h -> packages/web/src/options.ts; packages/core/src/player/options.ts
reference/src/ui-output.c -> packages/web/src/main.ts; packages/web/src/overlay.ts; packages/web/src/mapview.ts
reference/src/ui-output.h -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-player.c -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts; packages/web/src/screens.ts
reference/src/ui-player.h -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts
reference/src/ui-player-properties.c -> packages/core/src/player/abilities.ts; packages/web/src/abilities.ts
reference/src/ui-player-properties.h -> packages/core/src/player/abilities.ts; packages/web/src/abilities.ts
reference/src/ui-prefs.c -> packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts; packages/web/src/colors.ts; packages/web/src/keymap-store.ts; packages/web/src/main.ts
reference/src/ui-prefs.h -> packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts
reference/src/ui-score.c -> packages/core/src/score/display.ts; packages/core/src/score/score.ts; packages/web/src/score.ts
reference/src/ui-score.h -> packages/core/src/score/display.ts; packages/web/src/score.ts
reference/src/ui-signals.c -> NONE
reference/src/ui-signals.h -> NONE
reference/src/ui-spell.c -> packages/core/src/effects/effect-info.ts; packages/core/src/player/spell.ts; packages/web/src/screens.ts; packages/web/src/overlay.ts; packages/web/src/main.ts
reference/src/ui-spell.h -> packages/web/src/screens.ts; packages/web/src/overlay.ts; packages/web/src/main.ts
reference/src/ui-spoil.c -> packages/cli/src/spoilers.ts; packages/cli/src/main-spoil.ts; packages/web/src/wizard.ts
reference/src/ui-spoil.h -> packages/cli/src/spoilers.ts
reference/src/ui-store.c -> packages/core/src/store/store.ts; packages/core/src/store/price.ts; packages/core/src/store/transact.ts; packages/web/src/shop.ts
reference/src/ui-store.h -> packages/core/src/store/types.ts; packages/web/src/shop.ts
reference/src/ui-target.c -> packages/core/src/game/target.ts; packages/core/src/game/target-loop.ts; packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-target.h -> packages/core/src/game/target.ts; packages/core/src/game/target-loop.ts
reference/src/ui-term.c -> packages/web/src/term.ts; packages/web/src/font-16x24.ts
reference/src/ui-term.h -> packages/web/src/term.ts
reference/src/ui-visuals.c -> packages/core/src/visuals/engine.ts; packages/content/src/specs/visuals.ts; packages/web/src/main.ts; packages/web/src/tiles.ts
reference/src/ui-visuals.h -> packages/core/src/visuals/engine.ts; packages/core/src/visuals/index.ts
reference/src/ui-wizard.c -> packages/core/src/game/wizard.ts; packages/web/src/wizard.ts
reference/src/ui-wizard.h -> packages/core/src/game/wizard.ts; packages/web/src/wizard.ts
reference/src/win/include/libpng12/png.h -> NONE
reference/src/win/include/libpng12/pngconf.h -> NONE
reference/src/win/include/png.h -> NONE
reference/src/win/include/pngconf.h -> NONE
reference/src/win/include/zconf.h -> NONE
reference/src/win/include/zlib.h -> NONE
reference/src/win/readdib.c -> packages/web/src/tiles.ts
reference/src/win/readdib.h -> NONE
reference/src/win/readpng.c -> packages/web/src/tiles.ts
reference/src/win/scrnshot.c -> packages/web/src/main.ts
reference/src/win/scrnshot.h -> packages/web/src/main.ts
reference/src/win/win-layout.c -> packages/web/src/main.ts; packages/web/src/term.ts
reference/src/win/win-menu.h -> packages/web/src/game-menu.ts; packages/web/src/options.ts
reference/src/win/win-term.h -> packages/web/src/term.ts
