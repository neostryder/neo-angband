# L14_ui_frontend audit (UI/display + Windows frontend)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane: ui-* / main.c / main-win.c / grafmode / win/* (see manifest L14_ui_frontend.ref.txt).
Searched packages/ (excl. node_modules, dist, borg) for real implementors of each ref file.

Live path summary: web shell packages/web/src/{main,term,birth,charsheet,screens,overlay,
options,knowledge,shop,wizard,keymap*,context-menu,help,score,tiles,ui-colors,messages,...}.ts
plus core data models packages/core/src/{game/display,game/ui-entry,game/char-sheet,
game/mon-list,game/obj-list,game/equip-cmp,game/target*,game/wizard,visuals/*,score/*,
player/abilities,mon/lore-describe,mon/knowledge-groups,effects/effect-info}.ts.
Windows front-end (main-win.c, win/*) is replaced by the canvas GlyphTerm + Image/PNG path.

### L14_ui_frontend-001  Live sidebar stats omit equipment/timed stat_use (displayDeps underwires)
sev: P1
concession: n
ref: reference/src/ui-display.c:153-166 (prt_stat prints player->state.stat_use[stat] after calc_bonuses); reference/src/player-calcs.c (state.stat_use includes race+class+equip+shape+timed)
port: packages/web/src/main.ts:4605-4607 (displayDeps returns only timedEffects + unignoring); packages/core/src/game/display.ts:184-190,203,364 (defaultStatUse = race+class on statCur only; value = cnvStat(deps.statUse)); packages/web/src/screens.ts:416-438 (charSheetDeps DOES pass state.playerState.statUse)
expected: Sidebar STR/INT/WIS/DEX/CON show the full modified stat_use (rings of strength, etc.).
actual: Live HUD always falls back to race+class-only defaultStatUse. Character sheet ('C') is correct via charSheetDeps; the always-visible sidebar is not. state.playerState.statUse is computed every calcBonuses pass but never passed into displayDeps.
why: Default-path HUD lies about every worn/timed stat; immediately visible wrong vitals.
confidence: high

### L14_ui_frontend-002  Resting / repeat status line never receives isResting or nRepeats
sev: P1
concession: n
ref: reference/src/ui-display.c:957-1017 (prt_state: "Rest******" / "Repeat NNN" from player_is_resting + cmd_get_nrepeats)
port: packages/web/src/main.ts:4605-4607,4649-4658 (displayDeps omits isResting/restingCount/nRepeats; statusLineModel uses defaults false/0); packages/web/src/main.ts:3522,3411-3577 (rest sets state.resting live); packages/core/src/game/display.ts:661-707 (stateRuns only emits Rest/Repeat when deps set)
expected: While resting, status line shows Rest + count field (* / & / ! / digits); while a command repeats, "Repeat NNN".
actual: deps.isResting and deps.nRepeats always default false/0 on the live path, so prt_state is always the idle single-space reservation. Rest still runs and regens; the status chrome is blank.
why: Player cannot see rest/repeat state on the status line during the default R-rest path.
confidence: high

### L14_ui_frontend-003  EF_SELECT player choice UI missing; live path always randomizes
sev: P1
concession: n
ref: reference/src/ui-effect.c:34-180 (textui_get_effect_from_list: menu of effect_get_menu_name rows + "one of the following at random"); reference/src/effects-info.c:583 (effect_get_menu_name)
port: packages/core/src/effects/interpreter.ts:168-172,475-501 (chooseEffect optional; if absent choice=-2 then randint0); packages/content/pack/activation.json:2704+ and object.json SELECT chains (e.g. WAND_BREATH); packages/web/src (no textui_get_effect_from_list / chooseEffect injection anywhere)
expected: Activating a SELECT effect prompts Which effect? with named rows and optional random; choice is deterministic player input (RNG only if random picked).
actual: chooseEffect is never wired on the live effect env (only unit tests supply it). Player-origin SELECT with count>=2 falls through to random, drawing RNG and skipping the menu. effect_get_menu_name has no ported formatter (menuName strings sit unused in EFFECT_ENTRIES).
why: Wrong effect selection and extra RNG draws on stock SELECT activations/objects; player cannot choose breath element etc.
confidence: high

### L14_ui_frontend-004  Sidebar title ignores wizard mode and total_winner
sev: P2
concession: n
ref: reference/src/ui-display.c:173-187 (fmt_title: [=-WIZARD-=] if player->wizard; ***WINNER*** if total_winner or lev>PY_MAX_LEVEL)
port: packages/web/src/main.ts:4605-4607,3625,5428 (wizardMode lives in shell; never passed as displayDeps.wizard); packages/core/src/game/display.ts:138-142,210-211,253-255 (wizard/totalWinner default false; fmtTitle reads deps only, not Player.totalWinner)
expected: Wizard title and winner banner on the left sidebar when those flags are set.
actual: Title always uses class level title (or shape). player.totalWinner exists on Player and is used for tombstone/score, but displayDeps does not pass totalWinner: player.totalWinner or wizard: wizardMode.
why: Visible look-and-feel drift on wizard play and post-victory dungeon play.
confidence: high

### L14_ui_frontend-005  prt_moves never sees num_moves from calc_bonuses
sev: P2
concession: n
ref: reference/src/ui-display.c:1145 (prt_moves uses player->state.num_moves); player-calcs sets num_moves from OBJ_MOD_MOVES
port: packages/core/src/player/calcs.ts:382,1290-1291 (PlayerState.numMoves); packages/web/src/main.ts:4605-4607 (displayDeps omits numMoves); packages/core/src/game/display.ts:608-612
expected: Status line shows "Moves +N" / "Moves -N" when extra_moves nonzero.
actual: numMoves always defaults to 0 in resolveDeps; movement-bonus gear never lights the indicator (though player-turn energy math does read state.playerState.numMoves).
why: Status-line indicator missing for a real equipment bonus.
confidence: high

### L14_ui_frontend-006  Death menu omits Examine items (death_examine)
sev: P2
concession: n
ref: reference/src/ui-death.c:356-367 (death_actions includes { 'x', "Examine items", death_examine })
port: packages/web/src/game-menu.ts:11-16,134-160 (deathMenuEntries deliberately drops Examine items with comment "needs the get_item examine loop")
expected: After death, 'x' opens item examine over final gear.
actual: Row absent; player cannot inspect final inventory/equipment from the death menu (Information sheet is partial substitute only).
why: Missing death-flow action that is implementable with existing textui_get_item / inspect paths.
confidence: high

### L14_ui_frontend-007  history_display invents per-row colours not in the C
sev: P2
concession: n
ref: reference/src/ui-history.c:67-76 (prt(buf,...) default white for every row; only string " (LOST)" marks lost artifacts)
port: packages/web/src/screens.ts:1030-1055 (HIST_KNOWN_GOLD for ARTIFACT_KNOWN; DIM for ARTIFACT_LOST; comment admits "web-native enhancement")
expected: All history rows white; lost arts distinguished only by the " (LOST)" suffix text.
actual: Known artifacts render gold (COLOUR_YELLOW via UI_GOLD); lost arts render slate dim. Strings/layout match; colours do not.
why: Visible message/chrome drift on history and death history screens; faithful equivalent is plain white.
confidence: high

### L14_ui_frontend-008  Multi-term subwindows (PW_MESSAGE/INVEN/MONLIST/...) not modelled
sev: P2
concession: ?
ref: reference/src/ui-init.c:91-103 (default_window_flag[1..7] = PW_MESSAGE, PW_INVEN, PW_MONLIST, PW_ITEMLIST, PW_MONSTER|PW_OBJECT, PW_OVERHEAD, PW_PLAYER_2); ui-term.c multi-term; main-win.c multi-window
port: packages/web/src/term.ts:89-98 (single FIXED 80x24 GlyphTerm); packages/web/src/options.ts:11,35 (Subwindow setup row present but "no subwindows modelled")
expected: Optional auxiliary terminals mirror inventory, messages, mon list, overhead map, etc. while playing.
actual: One canvas term; those views only via modal keys (i/e/[/]/-P/M/...). Content exists; simultaneous subwindow furniture does not.
why: Layout/feel differs from multi-window native clients; browser can approximate with extra panels, so not purely unavoidable, but native multi-HWND is platform-specific.
confidence: high

### L14_ui_frontend-009  Screen dump is PNG download, not html_screenshot
sev: P3
concession: y
ref: reference/src/ui-command.c:295-560 (html_screenshot / do_cmd_save_screen: HTML or text term dump to path)
port: packages/web/src/main.ts:4310-4326 (canvas.toDataURL image/png download neo-angband-screen.png); packages/web/src/term.ts:354-362 (snapshotColored documents HTML-parity cell dump for tests only)
expected: ')' writes an HTML/text dump of attr/char cells.
actual: Browser downloads a PNG of the canvas. Cell-level HTML dump exists as snapshotColored for tests but is not the player command output.
why: No arbitrary filesystem write path; PNG is a reasonable browser substitute. Logged so dump interchange is not assumed.
confidence: high

### L14_ui_frontend-010  POSIX signal handlers (ui-signals) have no browser counterpart
sev: P3
concession: y
ref: reference/src/ui-signals.c:26-80+ (SIGHUP/SIGTSTP/SIGINT orderly save/suspend; signal_count)
port: NONE (packages/web has no signal install; pagehide/beforeunload may autosave separately in main.ts)
expected: HUP/INT/TSTP interrupt count and emergency save on native UNIX builds.
actual: No POSIX signals in the browser. Autosave on navigation is a different mechanism.
why: Unavoidable platform gap; not gameplay-visible on the web target.
confidence: high

### L14_ui_frontend-011  Windows native frontend (main-win / win/*) replaced by canvas stack
sev: P3
concession: y
ref: reference/src/main-win.c (WinMain, GDI terms, menus, DIB tiles); win/readdib.c, readpng.c, scrnshot.c, win-layout.c, win-menu.h, win-term.h; win/include png/zlib headers
port: packages/web/src/{main,term,tiles,font-16x24,options}.ts + packages/desktop (Electron shell only); browser Image/decode for PNG tiles (no readdib/GDI)
expected: Native Windows window chrome, .dib/.png loaders, screenshot GDI path, multi-window layout.
actual: Fixed 80x24 canvas, web font/tile atlases, Escape/localStorage prefs. win/include/* vendored third-party headers have no TS port (correct).
why: Target platform is browser (plus optional Electron); native Win32 is out of scope. Behavior of game UI is reimplemented; OS chrome is not.
confidence: high

### L14_ui_frontend-012  Death/in-game spoiler menu not on web (CLI only)
sev: P3
concession: n
ref: reference/src/ui-spoil.c:59-73 (do_cmd_spoilers menu); ui-death.c:363 (death_spoilers)
port: packages/cli/src/spoilers.ts + main-spoil.ts (spoiler generation); packages/web/src/game-menu.ts:14-16 (Spoilers row omitted)
expected: Death menu 's' / wizard spoilers create obj-desc.spo etc.
actual: Web death menu has no Spoilers row; CLI can generate spoilers. Content generators exist off the web live path.
why: Peripheral for normal play; still a missing death-menu action that could download text.
confidence: high

### L14_ui_frontend-013  do_cmd_pref (') always rejects the line
sev: P3
concession: n
ref: reference/src/ui-command.c / cmd-hidden do_cmd_pref: process a single pref-file directive into live prefs
port: packages/web/src/main.ts:4337-4346 (prefLineCmd prompts then always say "Pref command not recognized.")
expected: A valid pref line (keymap, color, etc.) is applied like process_pref_file one-liners.
actual: Key is live for shape but every non-empty line is rejected; options/keymaps use separate UI stores instead.
why: Cosmetic command surface without the C grammar backend; low impact if '=' menus cover prefs.
confidence: high

### L14_ui_frontend-014  Equippy chars use kind dAttr/dChar, not object_attr/object_char
sev: P2
concession: n
ref: reference/src/ui-display.c:269-294 (prt_equippy: object_attr(obj) / object_char(obj), including flavor when applicable)
port: packages/web/src/main.ts:4605-4607 (displayDeps omits objectAttr/objectChar); packages/core/src/game/display.ts:149-155,213-215,411-424 (default colorCharToAttr(kind.dAttr) + kind.dChar); map render in main.ts:4410-4422 DOES use flavor for floor/map objects
expected: Equipment row glyphs match map/inventory flavor-aware attr/char for unaware flavored wearables (rings/amulets).
actual: Equippy always uses base kind glyph/colour; map path is flavor-aware. Inconsistency on the same character view.
why: Visible wrong equippy colours for flavored worn items until identified.
confidence: med

### L14_ui_frontend-015  Study indicator colour ignores book carry check (default true)
sev: P3
concession: n
ref: reference/src/ui-display.c:1226-1245 (prt_study: COLOUR_WHITE if player_book_has_unlearned_spells else COLOUR_L_DARK)
port: packages/core/src/game/display.ts:144-147,212,715-719 (bookHasUnlearnedSpells defaults true); packages/web/src/main.ts:4605-4607 (never overrides)
expected: Study (N) is dark grey when the player has study slots but no book with unlearned spells in pack.
actual: Always white whenever newSpells > 0, even without a suitable book.
why: Minor status-line colour wrongness for casters mid-dungeon without books.
confidence: high

## MAP L14_ui_frontend
reference/src/grafmode.c -> packages/core/src/visuals/grafmode.ts; packages/core/src/visuals/grafmode-data.ts (codegen packages/core/scripts/gen-grafmode.mjs); packages/web/src/tiles.ts (mode select/load)
reference/src/grafmode.h -> packages/core/src/visuals/grafmode.ts (GraphicsMode, GRAPHICS_NONE, getGraphicsMode, isDhTile)
reference/src/list-ui-entry-renderers.h -> packages/core/src/generated/ui-entry-renderers.ts (codegen packages/core/scripts/codegen-lists.mjs)
reference/src/main.c -> packages/web/src/main.ts (browser entry/boot); packages/cli/src/main-*.ts (headless tools); packages/desktop/main.cjs (Electron host)
reference/src/main.h -> NONE (platform main prototypes; no shared TS header)
reference/src/main-win.c -> packages/web/src/main.ts + term.ts + tiles.ts + options.ts (canvas stand-in for Win32 GDI term/menus/graphics); packages/desktop/* (optional native shell)
reference/src/ui-birth.c -> packages/web/src/birth.ts; packages/core/src/player/birth.ts (roller/point-buy data)
reference/src/ui-birth.h -> packages/web/src/birth.ts (exports runBirth)
reference/src/ui-command.c -> packages/web/src/main.ts (redraw, retire, rest, screen dump, version, pref line, save/quit wiring)
reference/src/ui-command.h -> packages/web/src/main.ts
reference/src/ui-context.c -> packages/web/src/context-menu.ts; packages/web/src/main.ts (click routing)
reference/src/ui-context.h -> packages/web/src/context-menu.ts
reference/src/ui-curse.c -> packages/web/src/main.ts (curse_menu inclusion / remove-curse prompts ~L1620+)
reference/src/ui-curse.h -> packages/web/src/main.ts
reference/src/ui-death.c -> packages/web/src/main.ts (death flow/tombstone); packages/web/src/game-menu.ts (deathMenuEntries); packages/web/src/screens.ts (tombstoneLines); packages/web/src/charsheet.ts (death_file dump)
reference/src/ui-death.h -> packages/web/src/game-menu.ts; packages/web/src/main.ts
reference/src/ui-display.c -> packages/core/src/game/display.ts (sidebarModel/statusLineModel data); packages/web/src/main.ts (renderSidebar/renderStatusLine/map anim/see_floor)
reference/src/ui-display.h -> packages/core/src/game/display.ts (cnvStat, fmtTitle, exports)
reference/src/ui-effect.c -> NONE (chooseEffect seam in packages/core/src/effects/interpreter.ts only; no textui_get_effect_from_list UI)
reference/src/ui-effect.h -> NONE
reference/src/ui-entry.c -> packages/core/src/game/ui-entry.ts; packages/content/src/specs/ui-entry.ts + pack ui_entry*.json
reference/src/ui-entry.h -> packages/core/src/game/ui-entry.ts
reference/src/ui-entry-combiner.c -> packages/core/src/game/ui-entry.ts (combiners block)
reference/src/ui-entry-combiner.h -> packages/core/src/game/ui-entry.ts (UI_ENTRY_* special values)
reference/src/ui-entry-init.h -> packages/content/src/specs/ui-entry.ts; packages/core/src/game/ui-entry.ts (buildUiEntryConfig)
reference/src/ui-entry-renderers.c -> packages/core/src/game/ui-entry.ts (render half); packages/core/src/generated/ui-entry-renderers.ts
reference/src/ui-entry-renderers.h -> packages/core/src/generated/ui-entry-renderers.ts; packages/core/src/game/ui-entry.ts
reference/src/ui-equip-cmp.c -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-equip-cmp.h -> packages/core/src/game/equip-cmp.ts; packages/web/src/equip-cmp.ts
reference/src/ui-event.c -> NONE (browser KeyboardEvent / pointer; overlay key capture replaces ui_event queue)
reference/src/ui-event.h -> NONE
reference/src/ui-game.c -> packages/web/src/main.ts (command key tables / game loop commands); packages/web/src/wizard.ts (cmd_debug menus)
reference/src/ui-game.h -> packages/web/src/main.ts; packages/web/src/wizard.ts
reference/src/ui-help.c -> packages/web/src/help.ts
reference/src/ui-help.h -> packages/web/src/help.ts
reference/src/ui-history.c -> packages/web/src/screens.ts (historyLines); packages/web/src/main.ts / charsheet.ts (call sites)
reference/src/ui-history.h -> packages/web/src/screens.ts
reference/src/ui-init.c -> packages/web/src/main.ts (boot: prefs, knowledge, term size, single-term); packages/core/src/session/boot.ts / game.ts (engine init)
reference/src/ui-init.h -> packages/web/src/main.ts
reference/src/ui-input.c -> packages/web/src/overlay.ts (getCheck/getString/getRepDir/getAimDir); packages/web/src/messages.ts (paginateMessages/-more-); packages/web/src/input-queue.ts; packages/web/src/main.ts (inkey/command loop)
reference/src/ui-input.h -> packages/web/src/overlay.ts; packages/web/src/messages.ts
reference/src/ui-keymap.c -> packages/web/src/keymap-store.ts (add/find/remove/persist); packages/web/src/main.ts (keymap_find apply); packages/web/src/keymap-edit.ts (editor)
reference/src/ui-keymap.h -> packages/web/src/keymap-store.ts
reference/src/ui-knowledge.c -> packages/web/src/knowledge.ts; packages/web/src/main.ts (knowledge menu); packages/core/src/mon/knowledge-groups.ts; packages/content/src/specs/misc.ts (ui_knowledge parser)
reference/src/ui-knowledge.h -> packages/web/src/knowledge.ts
reference/src/ui-map.c -> packages/web/src/mapview.ts; packages/web/src/main.ts (map cell draw / graphics)
reference/src/ui-map.h -> packages/web/src/mapview.ts; packages/web/src/main.ts
reference/src/ui-menu.c -> packages/web/src/overlay.ts (selectFromMenu/menuNav); packages/web/src/birth.ts (all_letters_nohjkl); packages/web/src/ui-colors.ts (curs_attrs colours)
reference/src/ui-menu.h -> packages/web/src/overlay.ts
reference/src/ui-mon-list.c -> packages/web/src/screens.ts (monsterListScreenLines); packages/web/src/main.ts (showMonsterList); data half packages/core/src/game/mon-list.ts
reference/src/ui-mon-list.h -> packages/web/src/screens.ts; packages/core/src/game/mon-list.ts
reference/src/ui-mon-lore.c -> packages/core/src/mon/lore-describe.ts; packages/web/src/screens.ts / main.ts / knowledge.ts (display)
reference/src/ui-mon-lore.h -> packages/core/src/mon/lore-describe.ts
reference/src/ui-object.c -> packages/web/src/main.ts (get_item/inspect/ignore); packages/web/src/ignore-menu.ts; packages/web/src/overlay.ts (item menu); packages/web/src/screens.ts (inven/equip lines)
reference/src/ui-object.h -> packages/web/src/main.ts; packages/web/src/overlay.ts; packages/web/src/ignore-menu.ts
reference/src/ui-obj-list.c -> packages/web/src/screens.ts (objectListLines); packages/core/src/game/obj-list.ts; packages/web/src/main.ts (']' command)
reference/src/ui-obj-list.h -> packages/web/src/screens.ts; packages/core/src/game/obj-list.ts
reference/src/ui-options.c -> packages/web/src/options.ts; packages/web/src/keymap-edit.ts; packages/web/src/colors.ts; packages/web/src/ignore-menu.ts; packages/core/src/player/options.ts
reference/src/ui-options.h -> packages/web/src/options.ts
reference/src/ui-output.c -> packages/web/src/main.ts (verifyPanel/modify_panel camera); packages/web/src/overlay.ts (screen_save-style modals)
reference/src/ui-output.h -> packages/web/src/main.ts; packages/web/src/overlay.ts
reference/src/ui-player.c -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts; packages/web/src/screens.ts (characterSheetLines); packages/core/src/game/ui-entry.ts (flag panels)
reference/src/ui-player.h -> packages/core/src/game/char-sheet.ts; packages/web/src/charsheet.ts
reference/src/ui-player-properties.c -> packages/web/src/abilities.ts; packages/core/src/player/abilities.ts
reference/src/ui-player-properties.h -> packages/web/src/abilities.ts
reference/src/ui-prefs.c -> packages/core/src/visuals/tile-prefs.ts; packages/web/src/tiles.ts; packages/web/src/colors.ts (color prefs); packages/web/public/tiles/**/*.prf
reference/src/ui-prefs.h -> packages/core/src/visuals/tile-prefs.ts
reference/src/ui-score.c -> packages/core/src/score/display.ts; packages/web/src/score.ts
reference/src/ui-score.h -> packages/core/src/score/display.ts; packages/core/src/score/types.ts
reference/src/ui-signals.c -> NONE (browser has no POSIX signal handlers; autosave is separate)
reference/src/ui-signals.h -> NONE
reference/src/ui-spell.c -> packages/web/src/overlay.ts (spell menu); packages/web/src/main.ts (cast/study/browse); packages/core/src/effects/effect-info.ts (spell_menu_browser damage summary); packages/core/src/player/spell.ts; packages/core/src/game/spell-cmd.ts
reference/src/ui-spell.h -> packages/web/src/overlay.ts; packages/web/src/main.ts
reference/src/ui-spoil.c -> packages/cli/src/spoilers.ts + main-spoil.ts (CLI only; web death menu omits)
reference/src/ui-spoil.h -> packages/cli/src/spoilers.ts
reference/src/ui-store.c -> packages/web/src/shop.ts; packages/web/src/main.ts (enter store); packages/core/src/store/*
reference/src/ui-store.h -> packages/web/src/shop.ts
reference/src/ui-target.c -> packages/web/src/main.ts + overlay.ts (target/look loops); packages/core/src/game/target.ts; packages/core/src/game/target-loop.ts
reference/src/ui-target.h -> packages/web/src/main.ts; packages/core/src/game/target.ts
reference/src/ui-term.c -> packages/web/src/term.ts (GlyphTerm 80x24); packages/web/src/font-16x24.ts
reference/src/ui-term.h -> packages/web/src/term.ts
reference/src/ui-visuals.c -> packages/core/src/visuals/engine.ts; packages/content/src/specs/visuals.ts + pack visuals.json
reference/src/ui-visuals.h -> packages/core/src/visuals/engine.ts; packages/core/src/visuals/index.ts
reference/src/ui-wizard.c -> packages/web/src/wizard.ts (debug command menus); packages/core/src/game/wizard.ts (engine actions)
reference/src/ui-wizard.h -> packages/web/src/wizard.ts
reference/src/win/include/libpng12/png.h -> NONE (vendored C header; browser uses native PNG decode)
reference/src/win/include/libpng12/pngconf.h -> NONE
reference/src/win/include/png.h -> NONE
reference/src/win/include/pngconf.h -> NONE
reference/src/win/include/zconf.h -> NONE
reference/src/win/include/zlib.h -> NONE
reference/src/win/readdib.c -> NONE (DIB loader; web uses Image/canvas for tiles)
reference/src/win/readdib.h -> NONE
reference/src/win/readpng.c -> packages/web/src/tiles.ts (PNG tile atlas load via browser Image)
reference/src/win/scrnshot.c -> packages/web/src/main.ts (screenDumpCmd PNG); term.snapshotColored for cell dump tests
reference/src/win/scrnshot.h -> packages/web/src/main.ts
reference/src/win/win-layout.c -> NONE (native multi-window layout; web single GlyphTerm + optional sidebar modes in main.ts)
reference/src/win/win-menu.h -> packages/web/src/game-menu.ts + options.ts (Graphics/menu bar stand-ins)
reference/src/win/win-term.h -> packages/web/src/term.ts
