# Bundled quality-of-life mod (`qol`)

> STATUS: DESIGN OF RECORD. This page is the source of truth and public
> changelog for the bundled quality-of-life mod. The mod adds NEW conveniences
> that are not part of faithful Angband; with it disabled (or a tweak turned off
> in the Fixes & tweaks menu) core is byte-identical to faithful 4.2.6 behaviour.

## Why this mod exists

The port keeps core a faithful reproduction of Angband 4.2.6 - EVERYTHING that
is in official Angband is in core, with its upstream defaults (PORT_PLAN.md
decisions 2, 18, 23, 24). New content, fixes, and conveniences ship as mods.

The `qol` mod is the home for genuinely NEW quality-of-life behaviour - things
Angband cannot do at all - not for re-defaulting built-in Angband options.

> IMPORTANT (scope correction, 2026-07-16): built-in Angband options
> (`show_damage`, `show_flavors`, `center_player`, `purple_uniques`,
> `effective_speed`, `notify_recharge`, `auto_more`, ...) are NOT QoL-mod items.
> They ship in CORE with their exact upstream defaults (seeded from
> `OPTION_ENTRIES.normal`, i.e. `option.c` / `list-options.h`) and the player
> changes them in the in-game options menu (`=`) exactly as in upstream. An
> earlier build wrongly shipped those as a QoL "interface defaults" override;
> that seam has been removed and the options are plain faithful core.

This is the QoL home decision 18 refers to: subjective and convenience additions
live here, NOT in the `bug-fixes` mod (which carries only fixes for upstream
bugs). Balance and rules changes belong in neither - they would be their own mod.

## How it works (declarative, reversible, faithful-when-off)

Every QoL tweak is a named **core rule flag** (`qol.*`) that ships in ported core
as an OFF-by-default branch guarded by `modRuleEnabled(state, "<flag>")`. The mod
does not run code: `packages/web/mods/qol/manifest.json` simply DECLARES its
tweaks under `rules` (flag / title / description / default). The host
(`packages/web/src/main.ts`) resolves every enabled mod's declared rules against
the player's saved choices and seeds `GameState.modRules` at `startGame` /
`loadGame`; the in-app **Fixes & tweaks** menu (in the mod manager) lists each
tweak with its description and lets the player toggle it (applied live).

QoL tweaks default **ON**; disabling the mod, or turning a tweak off, drops the
flag and core returns to faithful behaviour. See `docs/modding/MOD_SEAMS.md` for
the full seam contract, and `BUG_FIXES.md` for the same mechanism used (default
OFF) by the bug-fix mod.

## Tweaks this mod ships

### `qol.autoDig` - Auto-dig on walk (default ON)

Ported from AIngband's `do_cmd_movement_tunnel_test` / `move_player` change.
Walking into a rubble pile or mineral vein you can currently tunnel through
(a known, non-permanent, impassable, diggable grid with a positive dig chance
given your weapon / best pack digger) starts one dig attempt and spends a move,
instead of the faithful no-energy "there is a wall in the way" bump. You never
step onto the dug-out grid in the same move, and each walk is a single attempt
(you keep walking to keep digging), matching AIngband.

- Core: `packages/core/src/game/cave-cmd.ts` (`movementTunnelTest`,
  `movementAutoDig`, reusing the ported `do_cmd_tunnel_aux` dig roll and
  payouts), consulted by `walkAction` (`packages/core/src/game/player-turn.ts`)
  through the `state.autoDigStep` seam, installed by the session
  (`packages/core/src/session/game.ts`). Off => `walkAction` bumps as in 4.2.6,
  drawing no RNG.
- Tests: `packages/core/src/game/auto-dig.test.ts` (bump when off; one dig +
  move, no step when on; the known / permanent-rock / can't-dig gates).

## QoL ideas that are ALREADY faithful core (not this mod)

Several conveniences imagined for a QoL mod are part of base Angband and so ship
in core / the base shell (verified in `packages/web/src`); this mod does not
re-implement them:

- Message log / scrollback (`Ctrl-P`): `main.ts`, `screens.ts`.
- Searchable / filterable knowledge and object menus: `game-menu.ts`,
  `screens.ts`.
- Item inspection (`I` / Inspect): `context-menu.ts`, `screens.ts`,
  `equip-cmp.ts`.
- Character sheet with history: `charsheet.ts`.
- All the upstream INTERFACE options above (options menu, `=`).

## Tests

- `packages/core/src/game/auto-dig.test.ts` - the auto-dig behaviour + gates.
- `packages/core/src/session/qol-defaults.test.ts` - faithful core option
  defaults (no QoL override) and the `modRules` start/load seam.
- `packages/web/src/qol-mod.test.ts` - the manifest declares `qol.autoDig`
  (default on) and no option overrides; `pack.ts` discovery + `resolveModRules`.
