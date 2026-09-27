# Keyboard command inventory for touch input (#145)

Baseline: Angband 4.2.6 at `reference/`, with the current web shell checked
separately. This inventory has **84 numbered entries**: 72 upstream command
table rows (including the conditional Borg row), two web commands, and ten
input and screen interaction families. Direction variants and submenu rows
are described within their family rather than counted as separate commands.
Debug subcommands are outside normal character play; their entry point remains
listed and their complete table remains in `reference/src/ui-game.c`.

Sources read: `reference/src/ui-game.c` (`cmds_all` and `cmd_lookup`),
`reference/src/ui-input.c` (command acquisition, counts, checks and directions),
`reference/src/ui-command.c`, `reference/src/ui-object.c`,
`reference/src/ui-target.c`, `reference/docs/command.rst`, and
`reference/lib/help/{commands.txt,r_comm.txt}`. Port sources:
`packages/web/src/main.ts` (`buildCommandTable`, `dispatchControlKey`, root
listener and command implementations), `keypress-command-registry.ts`,
`command-menu.ts`, `keymap.ts`, `keymap-store.ts`, `keymap-edit.ts`,
`input-door.ts`, `overlay.ts` and `packages/core/src/game/target-loop.ts`.

## Notation and prompt contracts

`S` is a single command key, possibly opening a screen or asking a confirmation.
`I` is a key followed by item/list selection. `D` is a key followed by a
direction. `T` is a key followed by interactive target selection. Combinations
are real sequences, not mutually exclusive classifications. `text`, `quantity`,
`check` and `glyph` name additional answers that cannot be represented by a
direction pad. Optional stages depend on the selected object, spell, player
state, options or inscriptions. The command implementation decides that order.
`same` means the original binding. `^X` means Control-X, also expressible as
caret then X at the command prompt. Key case matters.

## Upstream command table

| No. | Command | Original | Roguelike | Shape and subsequent interaction |
| --- | --- | --- | --- | --- |
| 1 | Inscribe an object | `{` | same | I, then text; pack/equipment/quiver/floor as offered |
| 2 | Uninscribe an object | `}` | same | I |
| 3 | Wear/wield an item | `w` | same | I; replacement slot, ring or quiver selection and checks when needed |
| 4 | Take off/unwield | `t` | `T` | I; equipment, with inscription confirmation |
| 5 | Examine an item | `I` | same | I, then scrollable inspection |
| 6 | Drop an item | `d` | same | I, then quantity for a stack and checks |
| 7 | Fire missile weapon | `f` | `t` | I (ammo, including quiver/floor), then D or T |
| 8 | Use staff | `u` | `Z` | I; effect may request another item, glyph, choice or direction |
| 9 | Aim wand | `a` | `z` | I, then D or T; effect-dependent further answers |
| 10 | Zap rod | `z` | `a` | I; D or T if aimed; effect-dependent further answers |
| 11 | Activate object | `A` | same | I (activatable equipment); D/T or effect item/choice/glyph as needed |
| 12 | Eat food | `E` | same | I; effect-dependent answers |
| 13 | Quaff potion | `q` | same | I; effect-dependent answers |
| 14 | Read scroll | `r` | same | I; target item, curse, glyph or effect choice when needed |
| 15 | Fuel light | `F` | same | I (fuel source) after light prerequisites |
| 16 | Use item | `U` | `X` | I; dispatch selected item's normal verb, including D/T and effect prompts |
| 17 | Disarm trap or chest | `D` | same | D if no unique adjacent candidate; self allowed for chest; also locks doors |
| 18 | Rest | `R` | same | S, then text: 1-9999, `!` HP or SP, `*` HP and SP, `&` complete recovery |
| 19 | Look around | `l` | `x` | T in look mode; recall and free cursor movement, optional target selection |
| 20 | Target monster/location | `*` | same | T; interesting targets or free cursor, explicit target acceptance |
| 21 | Target closest monster | `'` | same | S; target acquisition, no attack |
| 22 | Tunnel | `T` | `^T` | D; uses normal automatic digging-tool selection |
| 23 | Ascend stairs | `<` | same | S; autoexplore option can seek known upstairs |
| 24 | Descend stairs | `>` | same | S; autoexplore option can seek known downstairs |
| 25 | Open door/chest | `o` | same | D unless uniquely inferred; self allowed for chest |
| 26 | Close door | `c` | same | D unless uniquely inferred |
| 27 | Fire nearest | `h` | Tab | S; normal default ammo and nearest-target rules |
| 28 | Throw item | `v` | same | I (pack/equipment/quiver/floor), then D or T |
| 29 | Walk into trap | `W` | `-` | D; deliberately bypasses automatic disarm |
| 30 | Equipment listing | `e` | same | S; list interaction, toggle to inventory and follow-on command |
| 31 | Inventory listing | `i` | same | S; list interaction, toggle to equipment and follow-on command |
| 32 | Quiver listing | pipe | same | S; list interaction |
| 33 | Pick up objects | `g` | same | S when automatic, otherwise I and quantity |
| 34 | Ignore item | `k` | `^D` | I, then ignore choices/checks |
| 35 | Browse book | `b` | `P` | I (book), then spell list and description toggle |
| 36 | Gain spells | `G` | same | I (book), then spell selection for choosing classes; random study for others |
| 37 | View abilities | `S` | same | S; browse-only list with detail |
| 38 | Cast spell | `m` | same | I (book), I (spell), possible low-mana check, D/T, effect target item/curse/glyph/choice/direction |
| 39 | Full dungeon map | `M` | same | S; map view and dismissal |
| 40 | Toggle ignoring | `K` | `O` | S; normal ignore/drop processing may prompt |
| 41 | Visible items | `]` | same | S; scrolling list |
| 42 | Visible monsters | `[` | same | S; scrolling list/recall |
| 43 | Locate player | `L` | `W` | D repeatedly pans sectors; Escape returns |
| 44 | Help | `?` | same | S; topic selection, paging, links/search and dismissal |
| 45 | Identify symbol | `/` | same | S, then glyph; recall and next/previous matches |
| 46 | Character description | `C` | same | S; pages, rename text, dump/file prompts and history |
| 47 | Knowledge browser | `~` | same | S; categories, group/row navigation, recall, inscriptions and visual editing |
| 48 | Repeat level feeling | `^F` | same | S |
| 49 | Previous message | `^O` | same | S |
| 50 | Previous messages | `^P` | same | S; history scrolling/search where supported |
| 51 | Options | `=` | same | S; nested lists, booleans, numeric/text preferences, keymaps and display options |
| 52 | Save without quitting | `^S` | same | S |
| 53 | Save and quit | `^X` | same | S; port returns through session/roster flow |
| 54 | Retire and quit | `Q` | same | S, then check and literal `@` for non-winner retirement |
| 55 | Redraw | `^R` | same | S |
| 56 | Save screen dump | `)` | same | S; upstream format/file/check prompts; port download path |
| 57 | Take notes | `:` | same | S, then text |
| 58 | Version info | `V` | same | S |
| 59 | Single preference line | double quote | same | S, then text |
| 60 | Toggle inventory/equipment windows | `^E` | same | S; flips the implemented inventory panel to equipment; the flip control remains unimplemented |
| 61 | Alter grid | `+` | same | D; engine chooses applicable alter action |
| 62 | Steal from monster | `s` | same | D; normal rogue ability and energy rules |
| 63 | Walk | `;` | same | D; bump attacks, automatic door/trap handling and hazard checks |
| 64 | Run | `.` | `,` | D, then engine continuation until disturbed |
| 65 | Explore | `p` | same | S; depends on autoexplore_commands |
| 66 | Stand still | `,` | `.` | S; also keypad 5 in both modes; normal pickup |
| 67 | Center map | `^L` | `@` | S |
| 68 | Toggle wizard | `^W` | same | S, then normal warning/check and scoring consequences |
| 69 | Repeat previous command | `n` | `^V` | S; repeats saved command arguments, subject to validity and repeat rules |
| 70 | Autopickup | `^G` | same | S; engine's eligible automatic pickup, distinct from interactive Get |
| 71 | Debug commands | `^A` | same | S, then nested categories and command-specific I/D/T/text/checks |
| 72 | Borg commands (conditional) | `^Z` | same | S; port mod activation/check or hand-back; requires installed Borg |

## Port commands and interaction families

| No. | Command or family | Original | Roguelike | Shape and contract |
| --- | --- | --- | --- | --- |
| 73 | Swap weapon | `x` | unbound | I/check as implementation needs; port affordance, not upstream command row |
| 74 | New character | `N` | menu only | S; roster preserves current character; rogue `N` runs southeast |
| 75 | Direct movement | keypad 1-9 except 5; arrows | same plus `h j k l y u b n` | S: eight directions SW S SE W E NW N NE; arrow keys are orthogonal; NumLock-off Home/End/PageUp/PageDown cover diagonals |
| 76 | Direct run/alter aliases | run prefix + direction | uppercase movement runs; Control-movement alters | S for translated aliases, D for prefix route; upstream pref keymaps implement aliases; port resolveKey/dispatchControlKey implement rogue aliases |
| 77 | Command browser | Enter | same | S, then category and command selection; inner Back returns one category level |
| 78 | Escape, disturb and message acknowledgement | Escape; Space/Enter for More; any key while running/resting | same | S: cancellation belongs to current input owner; interrupt key is consumed, never also a movement; port idle Escape opens game menu |
| 79 | Count prefix | `0`, digits, command (Space before numeric movement) | same | S plus numeric argument and command's own I/D/T; upstream behavior; count-prefix acquisition is absent from the current root shell |
| 80 | Bypass keymap and caret | backslash + command; caret + letter | same | S prefix; caret implemented; upstream literal backslash prefix absent from current root shell |
| 81 | Item/spell/menu navigation | arrows, Enter, Escape, PageUp/Down, tags | same; eligible menus also j/k | I: item source `/` pack/equipment, pipe quiver, `-` floor; @digit/@command-digit inscriptions; case-sensitive tags unless caller opts out; `?` spell detail |
| 82 | Target and locality navigation | directions; Space/`+` next, `-` previous, `o` free, `p` player, `m` interesting, `t`/5/0/`.` accept, `r` recall, `?` help | same plus rogue directions | T/D: aim prompt `*` opens target, apostrophe closest, 5/t/0/dot uses valid current target; Escape aborts; current use_old_target may skip aim prompt |
| 83 | Store/home and screen actions | walk into shop; arrows/Enter and displayed action keys | same | S/I: buy/get, sell/drop, examine, quantity, checks; home deposit/retrieve; screen-specific actions include dump, rename, recall, search, visual values, inscriptions and page/tab movement |
| 84 | Text, quantity, checks and keymap editor | printable text, Backspace/Delete, arrows, Home/End, Enter, Escape, Control-U where accepted | same | I/S adjunct: native typing, default replacement, limits and checks belong to existing prompt; keymap query/create/remove captures trigger, action tokens, `=` finish, Control-U reset and keep check |

## Important discrepancies and invariants

The command registry describes and transforms the real cached command table;
its closures are private. The Enter browser groups that table. Several control
commands and Help live outside it in root dispatch, so the existing browser
alone is not a complete command surface. Original `x` is the port's swap action;
roguelike `x` is Look. Original `S` is Abilities, not Save, despite an old inline
comment. Original `p` is Explore, not prayer. There is no separate search or
bash command in the 4.2.6 command table. Do not invent either from older versions.

Upstream is authoritative for the count and bypass prefixes and the `^E`
inventory/equipment subwindow flip, which the port currently lacks. Target-loop pathfinding (`g`/Alt-click)
is also explicitly absent in this shell. These are parity gaps, not permission
to emulate rules with a touch macro. Touch must expose available commands and
record unavailable upstream operations rather than silently assign substitutes.

Before this increment, keymaps were shared globally across original/rogue
keyset tables in `neo-angband:keymaps`, with ownership in
`neo-angband:keymap-owners`. Desktop retains those keys; Touch adds independent
`:touch` keys as described in the design. The editor
accepts printable triggers, Enter and F1-F12; actions encode named keys as
`[Enter]` or `[F5]`. Expansion enters the queue once without recursive keymap
expansion. Modal prompts, scores and the interrupt pump receive literal input.
Player replacement clears mod ownership, so mod removal must preserve it.

Selection is not execution. Fire and Throw select an item and then aim. Cast
selects a book and spell before any optional effect prompts. Recharge, enchant,
brand and curse removal can select a second item; curse removal then selects a
curse. Banishment asks for a glyph. Dimension Door asks for a direction from
inside its effect preparation even though the spell itself need not be aimed.
Cancellation is handled by the command: an unaware consumable can still spend
its normal turn on a cancelled effect prompt. Touch must never promise that
all Cancel actions are free, nor prequeue an assumed next stage.

Repeat and disturb are engine behavior. Normal run, rest, exploration and
automatic command repeats continue only until their existing stopping rules
apply. A stop control must always remain available, flush queued adapter input,
and be consumed as interruption. Repeating a command is distinct from holding
a direction button; no touch auto-repeat may bypass checks or turn boundaries.
