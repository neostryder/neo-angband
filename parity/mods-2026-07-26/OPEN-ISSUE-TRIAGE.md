# Open upstream issue triage (bug-fixes mod candidates)

## Summary

- Examined all 200 of 200 entries in the supplied dump.
- Mutually exclusive disposition: 79 platform/presentation/input-interface issues; 40 build/tooling/refactor/C-hygiene/internal-consistency issues; 10 documentation/licensing/project-administration/localization/site issues; 45 feature/balance/design proposals; 5 Borg issues; 4 duplicates of already bundled patches; 11 initially plausible defect reports rejected after checking the 4.2.6 C or because the dump provides no confirmable cause; and 6 recommended candidates.
- The six recommendations are ordered below by gameplay impact multiplied by confidence. All six can preserve exact core parity: the changed path can be selected only when its `bugfix.*` flag is enabled.

## Recommended candidates

### #5167 Details of monster targeting a decoy

**Defect.** A monster is decoyed only when it has line of sight to the decoy (`reference/src/mon-predicate.c:308` and `reference/src/mon-predicate.c:315`). Several effect handlers do not test that predicate: for example, direct damage finds any decoy on the level and destroys it instead of damaging the player (`reference/src/effect-handler-attack.c:458`, `reference/src/effect-handler-attack.c:471`, and `reference/src/effect-handler-attack.c:484`). `TIMED_INC` has the same unconditional “a monster is acting and a decoy exists” shortcut (`reference/src/effect-handler-general.c:576` and `reference/src/effect-handler-general.c:584`). Consequently, a monster which is attacking the player and cannot see the decoy can consume the decoy and nullify the attack.

**C verification:** CONFIRMED. **Confidence:** HIGH. **Proposed flag:** `bugfix.decoyTargeting`. **Single-flag suitability:** Yes, though the same guarded decision must be applied to the finite set of affected handlers.

**Fix sketch.** Add one origin-aware helper which resolves whether the acting monster is actually decoyed, and use it in `TOUCH`, `DAMAGE`, `TIMED_INC`, `DRAIN_MANA`, and the relevant teleport/area handlers instead of treating `cave_find_decoy()` as proof of targeting. Under the flag, only redirect or destroy the decoy when `monster_is_decoyed(mon)` is true; otherwise retain the original player target. This is localized effect dispatch, requires no data or save-format change, and is a good mod patch despite touching several handlers.

### #4666 Thrown items in quiver: changing inscriptions can trigger pack overflow

**Defect.** Manual inscription changes the note and merely schedules pack combination (`reference/src/cmd-obj.c:209` and `reference/src/cmd-obj.c:211`); that command does not charge energy there. Quiver assignment is then recalculated from the preferred slot encoded by the inscription (`reference/src/player-calcs.c:1063` and `reference/src/player-calcs.c:1070`). The inventory model explicitly permits one overfull pack slot (`reference/src/player-calcs.c:1020`), and the later player-processing pass drops an overflow item (`reference/src/game-world.c:942` and `reference/src/game-world.c:946`). Thus removing `@v` from a thrown item in a full pack can evict it from the quiver and cause a no-turn overflow drop. The broader warning in the issue about several autoinscriptions causing more than one overflow is also structurally credible: `pack_overflow()` removes only one object per call (`reference/src/obj-gear.c:1343` and `reference/src/obj-gear.c:1378`), but the dump does not provide a concrete reproducer for that extension.

**C verification:** CONFIRMED for the manual-inscription case; the multi-autoinscription extension is not independently confirmed. **Confidence:** HIGH for the primary defect, MEDIUM for the extension. **Proposed flag:** `bugfix.quiverInscriptionOverflow`. **Single-flag suitability:** Borderline but acceptable if implemented through one shared post-inscription validator; scattering special cases across manual, automatic, and store paths would be a bad patch.

**Fix sketch.** Route note changes that can affect preferred quiver slots through a common transaction. With the flag enabled, calculate the proposed inventory/quiver assignment before committing the note; if it would exceed legal pack capacity, reject the note change (or skip that autoinscription) with a message. That prevents the free-drop exploit, is safe in stores, and avoids trying to teach the one-slot overflow mechanism to repair an arbitrarily invalid state. The flag should cover manual and automatic note changes through the same helper.

### #5520 Monster spell exclusion for spells with multiple effects

**Defect.** `unset_spells()` walks every effect in a non-elemental monster spell (`reference/src/mon-spell.c:470` and `reference/src/mon-spell.c:495`). Finding one resisted timed effect breaks out of that walk (`reference/src/mon-spell.c:505` and `reference/src/mon-spell.c:544`), after which the entire spell is removed from consideration (`reference/src/mon-spell.c:557`). Therefore knowledge that one secondary effect is resisted can suppress a spell whose other effects, including direct damage, remain effective.

**C verification:** CONFIRMED. **Confidence:** HIGH. **Proposed flag:** `bugfix.multiEffectSpellPruning`. **Single-flag suitability:** Yes for a conservative correction; a fully data-annotated effect-chain redesign would be sweeping and is not recommended.

**Fix sketch.** Under the flag, scan the complete effect chain and prune the spell only when every consequential effect the monster can reason about is known ineffective. The minimal safe version treats an unconditional damage effect as sufficient reason to retain the spell and otherwise preserves the existing resistance tests. That fixes the demonstrated class without adding annotations to `monster_spell.txt`, changing saves, or redesigning spell selection.

### #5346 Monster will try a door instead of open space

**Defect.** When a monster considers a closed or secret door, the movement helper marks the turn as spent as soon as the race can open or bash it (`reference/src/mon-move.c:1202` and `reference/src/mon-move.c:1211`). For a locked door, the attempt may make no progress unless the strength roll succeeds (`reference/src/mon-move.c:1239` and `reference/src/mon-move.c:1243`). The outer movement loop tries alternative side directions only while `did_something` is false (`reference/src/mon-move.c:1577` and `reference/src/mon-move.c:1581`). That directly supports the report: once an equally good door direction is selected, the monster can repeatedly spend turns on it rather than choose an open alternative. The source itself calls out fixation on doors as an unresolved problem (`reference/src/mon-move.c:1493`).

**C verification:** CONFIRMED. **Confidence:** HIGH. **Proposed flag:** `bugfix.monsterDoorChoice`. **Single-flag suitability:** Yes, if the correction is kept in movement candidate selection.

**Fix sketch.** With the flag enabled, rank immediately traversable side directions ahead of a closed/locked-door action when they make equal progress toward the same target. Do not let a monster both fail at a lock and move in the same turn; choose the open alternative before attempting the door. This keeps action economy intact and confines the patch to `mon-move.c` without replacing Angband's pathfinder.

### #6666 Ignored items and the =g inscription

**Defect.** The automatic-pickup scan calls `auto_pickup_okay()` only when the floor object is not ignored (`reference/src/cmd-pickup.c:420` and `reference/src/cmd-pickup.c:425`). The `=g` and `=g<n>` rules are implemented inside that skipped function (`reference/src/cmd-pickup.c:143`, `reference/src/cmd-pickup.c:179`, and `reference/src/cmd-pickup.c:184`). An ignored kind therefore never gets the explicit pickup instruction evaluated, including an instruction on the matching carried stack.

**C verification:** CONFIRMED. **Confidence:** HIGH. **Proposed flag:** `bugfix.ignoredAutoPickup`. **Single-flag suitability:** Yes; this is a small, local ordering change.

**Fix sketch.** Under the flag, evaluate explicit auto-pickup inscriptions before applying the general ignore gate. Preserve the existing `!g` precedence and quantity cap logic in `auto_pickup_okay()`: a positive explicit result overrides display ignoring, while an ignored object with no positive pickup instruction remains untouched. No object or save representation changes are needed.

### #5984 Randarts: interaction between rescale_freqs() and try_supercharge()

**Defect.** Standard-artifact parsing counts melee super-dice and super-blows only on melee weapons (`reference/src/obj-randart.c:377` and `reference/src/obj-randart.c:395`) and counts super-shots and super-might only on bows (`reference/src/obj-randart.c:482` and `reference/src/obj-randart.c:491`). The type-specific rescaling arrays omit those four supercharge indices (`reference/src/obj-randart.c:52` and `reference/src/obj-randart.c:73`), even though `rescale_freqs()` rescales the ordinary bow and melee indices to the whole artifact-set denominator (`reference/src/obj-randart.c:1129` and `reference/src/obj-randart.c:1148`). `try_supercharge()` then compares the unscaled values against `z_info->a_max` (`reference/src/obj-randart.c:1627`, `reference/src/obj-randart.c:1634`, and `reference/src/obj-randart.c:1650`). Those supercharges are consequently sampled below the frequency implied by the standard set.

**C verification:** CONFIRMED for the omitted type-specific supercharge rescaling. **Confidence:** HIGH. **Proposed flag:** `bugfix.randartSuperchargeFrequencies`. **Single-flag suitability:** Yes. The issue's additional aggravation-calibration discussion is a balance/design question and should not be folded into this patch.

**Fix sketch.** When the flag is enabled during randart frequency parsing, rescale melee-only super-dice, super-blows, and super-AC by `melee_total`, and bow-only super-shots and super-might by `bow_total`, before the existing minimum-frequency adjustment. Keep the legacy calculation untouched when disabled. This is contained in randart generation; it intentionally changes seeded randart output only for games opting into the fix.

## Rejected, with reason

| Issue | Title | Exclusion class or C-based reason |
|---:|---|---|
| #6671 | SPOT effect triggering sanitizer | Debug-only malformed wizard-effect reproducer, not a normal gameplay defect. The risky radius growth requires a player-origin effect with a nonzero `other` parameter (`reference/src/effect-handler-attack.c:553`). |
| #6668 | Borg Should Use Oil | Borg issue. |
| #6640 | Audit for inconsistent types used to record the same type of information | C-type audit/refactor; no demonstrated gameplay failure. |
| #6608 | license clarification of Adam Bolt's tileset, fonts | Licensing/project administration. |
| #6599 | "cmake --build path-to-build -t clean" does not affect coverage byproducts | Build/coverage tooling. |
| #6586 | Asynchronous signal handling | Runtime/platform infrastructure and C signal-safety work. |
| #6585 | Additional room templates with books? | Explicit feature/design proposal. |
| #6564 | Autoexplore Autopickup | Explicit feature request. |
| #6555 | macOS - NSLog() as plog() backend is not very useful | macOS-specific interface. |
| #6549 | Shockbolt tiles:  label and icon for bookseller tile | Tileset/interface. |
| #6545 | Missing tile assignments: old set | Tileset/interface. |
| #6544 | Missing tile assignments: Adam Bolt's set | Tileset/interface. |
| #6542 | Missing tile assignments: Shockbolt's set | Tileset/interface. |
| #6541 | Missing tile assignments: Gervais's set | Tileset/interface. |
| #6540 | Missing tile assignments:  Nomad's set | Tileset/interface. |
| #6537 | Save, exit, and then reload can perturb the state of the random number generator | Stale for 4.2.6 as described: load calls `store_carry(..., false)` (`reference/src/load.c:1245`), while recharge RNG is guarded by `maintain` (`reference/src/store.c:949`). |
| #6533 | "Bad effect passed to effect_do()" | The C confirms only that an invalid effect emits this message (`reference/src/effects.c:398`); the dump has no reproducer or C path connecting that invalid effect to the reported kill. Unconfirmed, LOW confidence, and no patchable cause. |
| #6517 | Supercharging and data files | Data-driven refactor/enhancement, not a defect. |
| #6515 | Borg Died Failing to Zap a Rod of Healing with Numerous Potions Available | Borg issue. |
| #6512 | Separate tval  for throwing items | Feature/data-model proposal with save compatibility impact. |
| #6510 | Release workflow: user manual and Nintendo zip files | Port-specific release packaging. |
| #6480 | Other user interface layering violations in the debugging commands | UI architecture/refactor. |
| #6466 | Implement quit()'s quit_aux with a stack of hooks | Enhancement/refactor. |
| #6441 | Presentation of drain life melee attacks in monster lore | Presentation enhancement. |
| #6435 | Mouse limitations when targeting | Input/interface issue. |
| #6357 | Charge and timeout information on known version of object | Internal-model consistency question; the issue itself reports no player-visible failure. |
| #6340 | doxygen: misleading entries in references links | Documentation tooling. |
| #6323 | Multiple Desktops on Windows Behavior Wrong | Windows-specific interface. |
| #6313 | Change the colour of a parameter when it’s buffed | Presentation feature. |
| #6308 | modifier+numpad direction does nothing when numlock is on | Port/input-specific interface. |
| #6294 | Bounds of map displayed by 'M' | Map-presentation/information-policy proposal, not core game logic. |
| #6290 | I like this game very much. How can I translate it to make it support multiple languages? | Localization feature request. |
| #6246 | Show level feeling on finding artifact | Feature/presentation proposal. |
| #6210 | Curse level for intentionally bad randarts | Randart balance/design proposal. |
| #6203 | Activations for black and white dragon breaths | Data/balance proposal; the issue explicitly says intent is unclear. |
| #6197 | Freeze in Windows version | Windows-specific runtime report. |
| #6163 | Variable Not Define yet? | Borg issue. |
| #6157 | SIGABRT | Borg crash report. |
| #6124 | Direction of effect animations | Presentation enhancement. |
| #6122 | Borg Should Pursue Uniques More Aggressively | Borg issue. |
| #6089 | Feature Request:  When using debug mode to create monsters, ignore accent marks. | Debug UI feature request. |
| #6053 | SDL2: Sometimes clicking "Quit" menu item the first time does nothing | SDL2-specific interface. |
| #6050 | SDL2: Main window's Fullscreen toggle does nothing (Windows 11) | SDL2/Windows-specific interface. |
| #6022 | SIGSEGV when you die | Stale for 4.2.6's shown failure: `highscore_write()` checks a failed lock-file open and returns before `file_lock()` (`reference/src/score.c:130`). It is score-file I/O rather than gameplay logic in any event. |
| #5952 | Angband-4.2.5 sometimes doesn't start | Port/startup issue. |
| #5931 | macOS crash in map_info() | macOS-specific crash. |
| #5843 | SDL2: allow hiding of menu bar | SDL2 interface enhancement. |
| #5709 | Clarify how ODESC_PREFIX and ODESC_SINGULAR interact | API-semantics/documentation enhancement; no current gameplay failure. |
| #5629 | Flatpak Package, Seperate Repo or PR it Here? | Packaging/project administration. |
| #5592 | SDL2: Occasional crash setting Tiles to None (main-sdl2.c line 4023 "graphics.texture != NULL") | SDL2-specific interface. |
| #5591 | SDL2: Tile texture duplicated below status bar when switch from 16x16x to 12x24x font with Tile height 3+ | SDL2-specific rendering. |
| #5512 | MSYS2 & Cygwin/X SDL2: Game frozen when switch displays | SDL2/port-specific interface. |
| #5510 | Windows front end, Gervais tileset: Characters, items, tiles flicker black, out of position at 4x4 size | Windows/tiles-specific rendering. |
| #5501 | SDL2: Shockbolt Dark tiles display at their 64x64 resolution only with 8x8 or 16x16 font | SDL2/tiles-specific rendering. |
| #5500 | Windows Standard front end: "Enable nice graphics" makes tiles too small & narrow at font size 10x20 or smaller | Windows/tiles-specific rendering. |
| #5499 | Consider using UTF-32 (stored as uint32_t) rather than wchar_t as the format for converted text | C representation/refactor. |
| #5497 | MSYS2 SDL2: Game screen blank after Windows lock screen | SDL2/Windows-specific rendering. |
| #5496 | MSYS SDL2: Overall SFX volume a little low; some sound effects jarringly loud | SDL2 audio/balance. |
| #5438 | Rogue-like keyset control commands and inscription checking | Generic input/keybinding interface, outside core game logic. |
| #5417 | Should escaping from select spell return the player to cast from book? | UI workflow design proposal. |
| #5416 | Cast from book should allow cancel/confirm via movement keys | UI workflow feature. |
| #5414 | Updating the Ubuntu repositories? | Distribution packaging/project administration. |
| #5340 | Throwing shots vs shooting them with sling | Combat balance proposal, not evidence of an implementation defect. |
| #5297 | feature request: interrupt on light=>dark transition | Explicit feature request. |
| #5293 | Locked secret doors | Explicit generation/terrain feature proposal. |
| #5219 | In default builds, match "datapath" to layout of lib/ | Build/install path configuration. |
| #5206 | Salvage old documentation | Documentation/project administration. |
| #5194 | Osx 12.1 app always asks for permission to access Documents | macOS-specific interface/permissions. |
| #5141 | Angband's title and menu bars remain dark text on light ground when Windows is in Dark color mode | Windows-specific presentation. |
| #5095 | MOVES for monsters | Monster-system feature request. |
| #5063 | Crash while monster commanded | The assertion establishes a null `mon->race` reaches `mon_set_timed()` (`reference/src/mon-timed.c:133`), but the dump gives no sequence or backtrace. Normal lookup skips dead monster slots (`reference/src/mon-util.c:183`), so the responsible path cannot be confirmed. LOW confidence and no self-contained fix. |
| #4984 | Specific key codes shouldn't be hard-coded | Input architecture/refactor. |
| #4934 | Function chains and use of the player and cave globals | Architecture/refactor. |
| #4917 | Check monster hold from lack of escape behaviour | One-line, unreproducible AI report; the concrete locked-door form is covered by recommended #5346. |
| #4869 | Official Angband site (i.e. replacement for `rephial.org`) | Website/project administration. |
| #4860 | Magic inscriptions need replacing with something better | Input/inventory UI redesign proposal. |
| #4827 | monster hit/death code is fragmented | Refactor request; missing fear messaging is presentation. |
| #4803 | There's a lot of hard-coded constants in to-hit and critical calculations | Data-driven balance/refactor proposal. |
| #4723 | Bad interaction with confirmation inscriptions and keymaps | Input/keymap interface defect, not core game logic. |
| #4680 | Uniques not registered as known although killed | Stale/not supported by 4.2.6: death reverts a shapechanger before selecting its lore (`reference/src/mon-util.c:1026`), then counts every visible-or-unique kill against that race (`reference/src/mon-util.c:1117`). |
| #4664 | Object list is not always correctly ordered | Already covered by `bugfix.objectListOrder`. |
| #4605 | Noise and scent not saved so restarting from a save can change monster behavior | Already covered by `bugfix.noiseScentSave`. |
| #4586 | Use FAangband's quest system | Feature/system replacement. |
| #4580 | Visual Studio instructions - encoding | Port-specific build instructions/encoding. |
| #4510 | Duplicate artifacts | Already covered by `bugfix.duplicateArtifact`. |
| #4451 | Systematic Recognition of Temp Resists | Knowledge/identification consistency proposal. |
| #4444 | Monsters not attacking | Body contains only a dead external reference; no scenario can be checked. The general door-stall case is covered by #5346, but this issue itself is unconfirmed. |
| #4394 | Thank you..! | Not a defect report. |
| #4337 | Cosmetic:  background for rubble with David Gervais's or Shockbolt's tiles | Tileset cosmetic enhancement. |
| #4318 | Symbol lookup | Interface enhancement. |
| #4296 | Improve color-cycling | Interface enhancement. |
| #4261 | Auto-inscribe equipment items with summary of resistances, flags, and bonuses | Interface feature. |
| #4245 | Unique coming back to life? | Already covered by `bugfix.uniqueKillHistory`. |
| #4241 | Improve documentation | Documentation. |
| #4233 | More tiering of status effects | Gameplay design change. |
| #4225 | Pile integrity failure crash | The C still has integrity checks and fatal diagnostics (`reference/src/obj-pile.c:124` and `reference/src/obj-pile.c:145`), but the dump supplies neither diagnostics nor a reproducer identifying the corrupting operation. Unconfirmed and not patchable behind a focused flag. |
| #4207 | No Shockbolt tiles for new dwarves | Tileset/interface. |
| #4189 | Lore has some black spells | Lore display/presentation. |
| #4187 | SDL2 possible memory problems | SDL2-specific runtime report. |
| #4164 | Flicker on shapechange | Presentation change. |
| #4162 | Standardise order of lines in data files | Data/code-style cleanup. |
| #4154 | Careful check of monster movement AI vs 4GAI | AI enhancement/design audit. |
| #4105 | PowerWyrm's pathfinding improvements | Pathfinding enhancement. |
| #4101 | Randarts reported of wrong type in history | Not supported by current C: history derives the display name from the exact artifact passed (`reference/src/player-history.c:197`) and stores that artifact's index with the entry (`reference/src/player-history.c:223`). No 4.2.6 failure path is supplied. |
| #4052 | Strange door placement | Old screenshot-only report with no reproducible generator seed or sufficient body; no specific 4.2.6 C defect can be confirmed. |
| #4009 | OSX crash on moving monster list window | macOS-specific interface crash. |
| #3987 | Missing messages | Message/UI presentation issue. |
| #3896 | Restoring "highlight player with cursor" would improve accessibility | Interface/accessibility feature. |
| #3874 | Get rid of z-virt | Internal refactor. |
| #3857 | Rename potions of Intellect | Naming/content change. |
| #3809 | Make caverns have a better risk:reward ratio | Balance proposal. |
| #3788 | Add a buildbot builder to exercise the build system | Build/test infrastructure. |
| #3781 | Graphical touches to add to the ASCII interface | Interface enhancement. |
| #3633 | Add libtermkey to the GCU port | Curses/GCU port enhancement. |
| #3624 | Use new character glyphs | Presentation change. |
| #3599 | Fix curly braces, space indenting, line endings, and trailing whitespace | Code style. |
| #3598 | Improve package scripts | Packaging/build tooling. |
| #3593 | Remove the various huge *_info arrays, thus removing the need for maxima | Internal architecture refactor. |
| #3578 | Save entire message history | Feature/save-format change. |
| #3572 | Finish visual editing UI | Interface feature. |
| #3571 | Create a master message buffer | Internal/UI architecture enhancement. |
| #3568 | Replace indices in function calls with pointers | Internal refactor. |
| #3552 | Make chests more interesting | Gameplay feature/design. |
| #3545 | Improve stats collection for items | Statistics tooling/enhancement. |
| #3528 | Rework Banishment | Gameplay design change. |
| #3526 | Improve the run command | Gameplay/UI feature change. |
| #3522 | Document pref file syntax & fix in-game interfaces | Documentation and preference UI. |
| #3512 | Set bonuses for artifacts | Gameplay feature. |
| #3499 | [Proposal] Monster Recall Highlighting for Troublesome Monsters | Interface proposal. |
| #3481 | Smooth-scrolling tiles | Tiles/interface feature. |
| #3479 | Monster-specific ESP | Gameplay feature. |
| #3448 | Copyright notices are inconsistent. | Licensing/documentation cleanup. |
| #3403 | Add more mimic/lurker types | Content feature. |
| #3399 | Rewrite target.c so it's less hideous | Refactor. |
| #3374 | Create savefile loader testsuite | Test infrastructure. |
| #3367 | Remove 'b'rowse command | UI design change. |
| #3359 | Remove cheat options, move them to wizard mode | Debug/UI design change. |
| #3357 | SDL: better font selection | SDL-specific interface. |
| #3351 | Allow --with-varpath to override PRIVATE_USER_DIR | Build/configuration issue. |
| #3347 | Make status effects more interesting | Gameplay design change. |
| #3339 | Switch to ttf fonts in SDL port | SDL/font enhancement. |
| #3304 | Replace +blows with -epb | Combat design change. |
| #3303 | Improve -mgcu behaviour in 16-colour xterms | GCU/curses port interface. |
| #3246 | Suggestion for change to monster memory display format | Presentation proposal. |
| #3239 | Collect stats on randarts | Statistics tooling. |
| #3236 | Press a key to make @ flash briefly | Interface/accessibility feature. |
| #3192 | Use a more accurate distance function | Fundamental rules/design change. |
| #3188 | Use Sparkle for automatic game updates on OS X | macOS packaging/update feature. |
| #3089 | Granular ESP | Gameplay feature. |
| #3080 | Rewrite randart.c for fully comprehensive tracking of combinations | Internal/game-generation refactor. |
| #2999 | Accessibility: add a directional look command | Input/accessibility feature. |
| #2990 | Curses: Aggravate should aggravate less | Balance change. |
| #2950 | Check for format-string based security holes | C/security audit. |
| #2932 | Insribing objects Max=# | Inventory feature request. |
| #2881 | Savefile improvements | Save-format/architecture enhancement. |
| #2854 | Experiment with mana allocation & regen | Balance experiment. |
| #2849 | Assess distance of missile weapons and magics | Rules/balance proposal. |
| #2843 | Assertions | Development/C-hygiene enhancement. |
| #2839 | Document and improve debug commands | Debug tooling/documentation. |
| #2830 | More flexible windowing in the gcu-port | GCU/curses interface. |
| #2827 | Work out some better display for the disarming skill on 'C' screen | Presentation proposal. |
| #2798 | Rationalize damage/effects simultaneously applied | Architecture/design refactor. |
| #2746 | Use binary search instead of iteration in alloc tables | Performance refactor. |
| #2731 | Get valgrind reporting that all memory is properly freed at game exit | Test/C-memory hygiene. |
| #2708 | .ini file reading/writing on Windows is extremely inefficient | Windows-specific configuration. |
| #2690 | Using the Mouse to look around. | Mouse/interface feature. |
| #2672 | Improve monster drop functionality | Gameplay/data feature. |
| #2671 | Linearise the stat system | Fundamental rules redesign. |
| #2658 | Allow restriction of auto pickup to consumables | Feature request. |
| #2574 | Using the new flavours proposed on the forum? | Content/design proposal. |
| #2557 | Add new curses: pval-flipping curse | Gameplay feature. |
| #2512 | Add timed detections (i.e. non-monster ESP) | Gameplay feature. |
| #2508 | Import UnAngband's easy_more option | UI/gameplay option feature. |
| #2471 | Too many hacks? | Refactor/design audit. |
| #2466 | New panel change behaviour | Interface behavior proposal. |
| #2448 | Add keep_room_on_screen option | Interface option feature. |
| #2436 | Collect stats on player | Statistics tooling. |
| #2408 | Consider allowing user "notes" in various places in the game | Feature request. |
| #2394 | Remove monster AI options, replace with flag-controlled AI | AI design change. |
| #2392 | Add option to not autopickup with monsters in LOS | Gameplay/UI option feature. |
| #2371 | Mini-map overlay/seperate window | Interface feature. |
| #2324 | Automatic hiding of sidebar and statusbar | Interface feature. |
| #2317 | Add support for paragraphs to textblock | UI/text infrastructure enhancement. |
| #2277 | Full mouse playability | Mouse/interface feature. |
| #2230 | Don't use C reserved identifiers | C-language hygiene. |
| #2201 | Better keymap UI | Input/interface enhancement. |
| #2193 | Outstanding menus to fix | Interface enhancement. |
| #2179 | Always use numbers for the labels of spellbooks in the inventory | Interface labeling. |
| #2177 | Allow Angband to work on 16-row displays | Display/interface feature. |
| #2169 | Unify line of sight and projection paths | Architecture/rules refactor, not a demonstrated defect. |
| #2164 | Improve the scorefile format, and the method of scoring | Feature/format redesign. |
| #2160 | Add reference counting for inscriptions | Internal architecture enhancement. |
| #2149 | Allow keyset-agnostic keymaps | Input/interface enhancement. |
| #2141 | Minimise usage of standard string functions | C-language/internal refactor. |

## Where this brief was wrong

No material factual error was found in the brief. The dump does contain exactly 200 `=== #` entries, and the oracle identifies itself as Angband 4.2.6. One bookkeeping caveat: only four of the five already bundled fixes have a numbered matching entry in this dump; the unreachable-staircase fix has no corresponding open-issue entry here, so there was nothing to skip for it. Also, “open upstream” must not be read as “present in 4.2.6”: #6537, #6022, and #4680 are concrete examples where the 4.2.6 C does not support the reported defect as described.
