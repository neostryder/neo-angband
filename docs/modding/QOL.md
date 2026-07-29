# Bundled quality-of-life mod (`qol`)

> STATUS: DESIGN OF RECORD. This page is the source of truth and public
> changelog for the bundled quality-of-life mod. The mod adds NEW conveniences
> that are not part of faithful Angband; with it disabled (or a tweak turned off
> in its Fixes & tweaks submenu) core is byte-identical to faithful 4.2.6 behaviour.

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

## How it works (the mod's own code, reversible, faithful-when-off)

Every QoL tweak is a named **patch flag** (`qol.*`) that the mod DECLARES in
`packages/web/mods/qol/manifest.json` under `rules` (flag / title / description /
default). The flag is a conversation between the host and the mod - **core never
sees it.** Nothing in `packages/core/src` contains the string `qol.autoDig` or a
dig-on-walk branch.

The tweak's BEHAVIOUR is the mod's own code, in
`packages/web/mods/qol/hooks.ts`. That file default-exports the entry point every
behaviour mod exports:

```ts
export default function qolHooks(
  flags: Readonly<Record<string, boolean>>,
): ModHooks;
```

The host (`packages/web/src/mod-hooks.ts`) resolves each enabled mod's declared
rules against the player's saved choices, slices the resulting flag map PER MOD,
calls this function once per enabled mod in load order, and folds the returned
`ModHooks` objects into the single object core holds (`composeModHooks`,
`packages/core/src/mod/hooks.ts`). It is passed to `startGame` / `loadGame` as
`opts.modHooks`. The **Fixes & tweaks** submenu on this mod's own screen (mod
manager -> Quality of Life) lists each tweak with its description and lets the
player toggle it; a live toggle REBUILDS the composed hooks
(`applyRuleLive`, `packages/web/src/main.ts:4956`), because core does not branch
on a flag and so writing one alone would do nothing.

A tweak the player switched off does not install its hook at all - so it is not
merely inert, it is ABSENT, and core takes the faithful path with one undefined
check. See `docs/modding/MOD_SEAMS.md` for the full seam contract, including the
per-hook fold rules.

**While the mod is off, its tweaks do not exist** - the host never calls this
mod's entry point, so no hook is contributed, nothing appears in the menu, and
core is faithful 4.2.6. Enabling the mod turns its whole tweak set ON at once;
each tweak is then individually switchable in that submenu, so you can take the
set minus one. Disabling the mod again, or switching one tweak off, removes the
hook and core returns to faithful behaviour. The mod is off on a fresh install,
so a default game installs no hook at all. See `BUG_FIXES.md` for the same
mechanism in the bug-fix mod.

## Tweaks this mod ships

### `qol.autoDig` - Auto-dig on walk (on with the mod)

Ported from neostryder's Angband fork (`do_cmd_movement_tunnel_test` / `move_player` change).
Walking into a rubble pile or mineral vein you can currently tunnel through
(a known, non-permanent, impassable, diggable grid with a positive dig chance
given your weapon / best pack digger) starts one dig attempt and spends a move,
instead of the faithful no-energy "there is a wall in the way" bump. You never
step onto the dug-out grid in the same move, and each walk is a single attempt
(you keep walking to keep digging), matching the source fork.

- The tweak's code: `packages/web/mods/qol/hooks.ts:76`, installing the
  `walkBlockedByDiggable` hook (`packages/core/src/mod/hooks.ts:96`). It reuses
  two PUBLIC core primitives rather than reimplementing the dig - a reimplemented
  roll would drift from the tunnel command's: `movementTunnelTest`
  (`packages/core/src/game/cave-cmd.ts:662`, RNG-free, which is what lets the mod
  decline without moving the stream) and `tunnelAux` (one `do_cmd_tunnel_aux`
  attempt with the real roll, messages, and payouts, which DRAWS, so it is
  reached only after the decision to handle the walk is final).
- Core's side of the seam: `walkAction`
  (`packages/core/src/game/player-turn.ts:493`) consults `state.autoDigStep`,
  installed by the session (`packages/core/src/session/game.ts:1668`) pointing at
  `movementAutoDig` (`cave-cmd.ts:676`), whose whole body is the hook read plus
  `?? 0`. Off (or no mod) => the hook is absent, `movementAutoDig` returns 0
  having drawn no RNG, and `walkAction` bumps as in 4.2.6.
- Tests: `packages/core/src/game/auto-dig.test.ts` (core's seam: bump with no
  hook; the returned energy is honoured) and
  `packages/web/mods/qol/hooks.test.ts` (the mod's own behaviour and its flag
  gate).

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

- `packages/core/src/game/auto-dig.test.ts` - core's side of the seam: the bump
  with no hook, and the hook's returned energy being honoured.
- `packages/web/mods/qol/hooks.test.ts` - the mod's own behaviour: one dig + a
  move and no step with the tweak on, decline with it off, and the known /
  permanent-rock / can't-dig gates.
- `packages/core/src/session/qol-defaults.test.ts` - faithful core option
  defaults (no QoL override), plus the ratchet that an ALL-NEUTRAL `ModHooks`
  leaves the RNG state and the generated level bit-identical to no hooks at all.
- `packages/web/src/qol-mod.test.ts` - the manifest declares `qol.autoDig`
  (`default: true`, i.e. on once the mod is enabled) and no option overrides;
  `pack.ts` discovery + `resolveModRules`.
