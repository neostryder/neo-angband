# Bundled quality-of-life mod (`qol`)

> STATUS: DESIGN OF RECORD. This page is the source of truth and public
> changelog for the bundled quality-of-life mod. The mod is UI-LEVEL ONLY and
> makes ZERO rules changes; with it disabled, core is byte-identical to faithful
> 4.2.6 behavior.

## Why this mod exists

The port keeps core faithful to the Angband 4.2.6 tag, including its
conservative out-of-the-box option defaults (PORT_PLAN.md decisions 2, 18, 23,
24). Many of those defaults are off purely for historical reasons; a new player
gets a friendlier, more legible interface if a few pure-display options are on
from the start.

Rather than change the core option table (which must match `option.c` /
`list-options.h` exactly), those recommended defaults ship in this single
BUNDLED, default-on, fully-removable CONTENT mod, id `qol`, depending on
`core`. It is authored and maintained by neostryder (RPGM Tools).

This is the QoL home decision 18 refers to: subjective and convenience changes
live here, NOT in the `bug-fixes` mod (which carries only crash /
data-corruption / determinism / logic-error fixes). Balance and rules changes
belong in neither - they would be their own mod.

## Guarantees

- ZERO rules changes. The mod's entire substance is recommended INTERFACE-option
  defaults for NEW characters. It sets no BIRTH, CHEAT, SCORE, or SPECIAL
  option, adds/patches/removes no game record, and touches no monster, object,
  or dungeon data.
- INTERFACE-only, enforced defensively in core. The new-character seam runs the
  supplied defaults through `filterInterfaceOverrides`
  (`packages/core/src/player/options.ts`), which keeps ONLY options whose
  `OPTION_ENTRIES` type is `INTERFACE`. Even if this mod's data mistakenly
  listed a rules or scoring option, core would drop it - a mod can never change
  a rules/scoring option through this path.
- Reversible. Disabling the mod (mod manager, or omit it from `?mods=`) reverts
  new-character defaults to the stock `OPTION_ENTRIES.normal` table. Nothing is
  written to core.
- Existing saves unaffected. Options are RESTORED from the save on load
  (`OptionState.restore`), never reconstructed, so enabling or disabling this
  mod changes only characters created AFTER the change. In-play characters keep
  whatever they had, and every option remains freely toggleable in the in-game
  options menu (`=`).
- Byte-identical when absent. When no `interfaceDefaults` are supplied (mod
  disabled), the birth path passes no overrides and the option store is
  identical to the table.

## Options this mod sets (all to `true`)

Each is an `INTERFACE`-type option that ships `normal:false` in the table, and
each is a pure display/convenience change with no effect on game rules, RNG, or
scoring.

| Option | Rationale |
| --- | --- |
| `show_damage` | Show the damage the player deals to monsters. Pure feedback; makes combat legible without changing any roll. |
| `show_flavors` | Show flavors in object descriptions ("a Copper Wand"). Display only; does not reveal identity. |
| `center_player` | Keep the map centered on the player. Convenience/readability; no gameplay effect. |
| `purple_uniques` | Draw unique monsters in purple. Pure color cue that helps spot named threats. |
| `effective_speed` | Show effective speed as a multiplier rather than the raw +N. Clearer readout of the same value. |
| `notify_recharge` | Emit a message when a rechargeable item finishes recharging. Convenience notification; no rules change. |

`auto_more` is deliberately LEFT OFF: auto-clearing `-more-` prompts can hide
important messages, which is a legibility regression, not a QoL win.

## QoL features that already live in the base web shell

Several items originally imagined for a QoL mod are already part of the base
playable shell (verified in `packages/web/src`), so this mod does NOT
re-implement them:

- Message log / scrollback. The session keeps a full message log and recalls it
  with `Ctrl-P` ("Message history"): `main.ts` (`messageHistoryLines`, the
  `Ctrl-P` binding) and `screens.ts`.
- Searchable / filterable knowledge and object menus: `game-menu.ts`,
  `screens.ts` (filtered object-selection menus).
- Item inspection ("Inspect" action, wrapped property viewer): `context-menu.ts`,
  `screens.ts`, `equip-cmp.ts`.
- Character sheet / recap with the history block: `charsheet.ts`.

Because these already exist, this mod's scope is intentionally narrow:
recommended INTERFACE-option defaults only.

## Mechanism (data-driven, reversible)

- `packages/web/mods/qol/manifest.json` - the mod manifest (`shape:"content"`,
  `dependencies:{core:"*"}`, author `neostryder (RPGM Tools)`,
  `license:"GPL-2.0-only"`). Registered default-on in
  `packages/web/src/mod-store.ts` (`DEFAULT_ENABLED_MODS`).
- `packages/web/mods/qol/options.json` - `{ "records": [ { "interfaceDefaults":
  { ... } } ] }`. It flows through `composeContentPacks` like any other mod
  file.
- `packages/web/src/pack.ts` - `loadComposedInterfaceDefaults()` merges every
  enabled content mod's `options` records' `interfaceDefaults` (returns `{}`
  when none is enabled). The host threads this into `startGame`.
- `packages/core/src/session/game.ts` (`startGame`) - the core seam. It applies
  `interfaceDefaults` UNDER any explicit `optionOverrides`, after running them
  through `filterInterfaceOverrides` (INTERFACE-only). With no defaults supplied
  the option store is byte-identical to the table.

## Tests

- `packages/core/src/session/qol-defaults.test.ts` - the seam: (a) a new
  character with `interfaceDefaults` gets the QoL values; (b) without them, the
  stock table defaults; (c) the seam refuses BIRTH/CHEAT/SCORE options present
  in the data; plus unit coverage of `filterInterfaceOverrides`.
- `packages/web/src/qol-mod.test.ts` - the mod data: every preset option is a
  real `INTERFACE` option, the data survives the core filter unchanged, and
  `loadComposedInterfaceDefaults` surfaces the on-disk defaults.
