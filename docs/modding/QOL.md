# The quality-of-life mod (`qol`)

> **Not bundled.** The game ships with no mods. This one lives in [neo-angband-mod-qol](https://github.com/neostryder/neo-angband-mod-qol) and installs through the mod manager's *Recommended mods...* row at a pinned tag. The pinned tag keeps the download from changing under you, and the install records a SHA-256 of the bytes that arrived so the game can later tell whether your copy has changed.
>
> The mod adds new conveniences that are not part of faithful Angband. With it disabled, or with a tweak turned off in its Fixes & tweaks submenu, core behaves exactly like faithful 4.2.6, and if the mod is not installed its code is not on your machine at all. This page also serves as the mod's public changelog.
## Why this mod exists

Core is a faithful reproduction of Angband 4.2.6: everything in official Angband is in core, with its upstream defaults. New content, fixes and conveniences ship as mods.

The `qol` mod is for new quality-of-life behaviour, things Angband cannot do at all. It does not change the defaults of Angband's built-in options.

Built-in Angband options (`show_damage`, `show_flavors`, `center_player`, `purple_uniques`, `effective_speed`, `notify_recharge`, `auto_more`, ...) are part of core, not this mod. They ship with their upstream defaults (seeded from `OPTION_ENTRIES.normal`, i.e. `option.c` / `list-options.h`), and you change them in the in-game options menu (`=`) as in upstream. An earlier build shipped them as a QoL "interface defaults" override; that override is gone (as of 2026-07-16) and the options are plain faithful core.

Subjective and convenience additions go here, not in the `bug-fixes` mod, which carries only fixes for upstream bugs. Balance and rules changes belong in neither; they would be a mod of their own.
## How it works (the mod's own code, reversible, faithful-when-off)

Every QoL tweak is a named patch flag (`qol.*`) that the mod declares in `neo-angband-mod-qol/manifest.json` under `rules` (flag / title / description / default). Only the host and the mod see the flag; core never does. Nothing in `packages/core/src` contains the string `qol.autoDig` or a dig-on-walk branch.

The tweak's behaviour is the mod's own code, in `neo-angband-mod-qol/plugin.ts`, which default-exports the entry point every behaviour mod exports:

```ts
export default function qolHooks(
  flags: Readonly<Record<string, boolean>>,
): ModHooks;
```

The host (`packages/web/src/mod-hooks.ts`) resolves each enabled mod's declared rules against the player's saved choices, gives each mod its own slice of the resulting flag map, calls this function once per enabled mod in load order, and folds the returned `ModHooks` objects into the single object core holds (`composeModHooks`, `packages/core/src/mod/hooks.ts`). That object is passed to `startGame` / `loadGame` as `opts.modHooks`. The **Fixes & tweaks** submenu on the mod's own screen (mod manager -> Quality of Life) lists each tweak with its description and lets the player toggle it. Toggling one during play rebuilds the composed hooks (`applyRuleLive`, `packages/web/src/main.ts`), because core never branches on a flag and writing one alone would do nothing.

A tweak that is switched off installs no hook at all, so core takes the faithful path after a single undefined check. See `docs/modding/MOD_SEAMS.md` for the full seam contract, including the per-hook fold rules.

While the mod is off, the host never calls its entry point, so it contributes no hooks, nothing appears in the menu, and core is faithful 4.2.6. Enabling the mod turns its whole tweak set on at once, and each tweak can then be switched off individually in that submenu. Disabling the mod again, or switching a tweak off, removes the hook and core returns to faithful behaviour. The mod is off on a fresh install, so a default game installs no hooks. `BUG_FIXES.md` describes the same mechanism in the bug-fix mod.
## Tweaks this mod ships

### `qol.autoDig` - Auto-dig on walk (on with the mod)

Ported from neostryder's Angband fork (the `do_cmd_movement_tunnel_test` / `move_player` change). Walking into a rubble pile or mineral vein you can currently tunnel through (a known, non-permanent, impassable, diggable grid with a positive dig chance given your weapon or the best digger in your pack) makes one dig attempt and spends a move, instead of the faithful no-energy "there is a wall in the way" bump. You never step onto the dug-out grid in the same move, and each walk is a single attempt (keep walking to keep digging), as in the source fork.

- The tweak's code: `neo-angband-mod-qol/plugin.ts`, installing the `walkBlockedByDiggable` hook (`packages/core/src/mod/hooks.ts`). It calls two public core functions instead of reimplementing the dig, since a reimplemented roll would drift from the tunnel command's. `movementTunnelTest` (`packages/core/src/game/cave-cmd.ts`) draws no random numbers, which lets the mod decline without moving the stream. `tunnelAux` makes one `do_cmd_tunnel_aux` attempt with the real roll, messages and payouts, and it does draw, so the mod calls it only after it has committed to handling the walk.
- Core's side of the seam: `walkAction` (`packages/core/src/game/player-turn.ts`) consults `state.autoDigStep`, which the session (`packages/core/src/session/game.ts`) points at `movementAutoDig` (`cave-cmd.ts`), whose whole body is the hook read plus `?? null`. With the tweak off, or no mod, the hook is absent, `movementAutoDig` returns `null` without drawing from the RNG, and `walkAction` bumps as in 4.2.6. Only `null` bumps: a returned `0` means a mod handled the walk at no energy cost, and core honours it.
- Tests: `packages/core/src/game/auto-dig.test.ts` (core's seam: a bump with no hook, and the returned energy honoured, zero included) and `neo-angband-mod-qol/plugin.test.ts` (the mod's own behaviour and its flag gate).
### `qol.rememberSettings` - Remember my settings (on with the mod, from v0.13.0)

Angband keeps a character's options inside that character's save and nowhere else, so they die with the character and every new life begins by setting them all again. Upstream's answer is the pref file (`s` / `r` in the options menu), which the player has to know about and remember to write. Core keeps that as it is, and the convenience lives here.

Change anything in `=`, and the next character you create starts with it. A character loaded from a save is never touched: a save keeps the settings it was saved with, so changing a setting on one character cannot reach another.

The work is split across two entry points:

- **Capture** is `hooks()` returning `optionsChanged`, which the host fires when the `=` menu closes after something changed. It gets no `state`, because the host composes hooks before the game exists, so the mod builds a throwaway `new ctx.core.OptionState()` just to classify option names. Classification depends only on the option table, so every instance gives the same answer.
- **Apply** is `register()`, which runs once the game is built, and only when `ctx.newCharacter` is true.
### `qol.rememberCheats` - Remember cheat options too (OFF by default)

Extends the above to the cheat options. It is off by default because turning a `cheat_` option on forces its `score_` twin, which permanently bars that character from the high score list, and inheriting that without being asked is the one case where remembering a setting does real damage. It is a toggle rather than a flat exclusion because players who run with cheat options on want them to carry forward like any other setting, while players who never touched them should not inherit an unscoreable character.

The filter runs both when settings are stored and when they are read back, so turning the toggle off also applies to settings already stored. Otherwise the only remedy would be to find and clear the stored data by hand.

**Birth options are excluded outright**, under either toggle. They are fixed into a character at creation and `OptionState.set` refuses them afterwards, so remembering one could never apply it. They already carry forward by the game's own route: the `=` birth-options editor is seeded from the previous character's choices (`main.ts`, `StoredBirth.birthOptions`).

### The three seams this needed, and why they are not about this mod

None of them names `qol`, and each is the general form of the thing:

| Seam | The general question it answers |
|---|---|
| `ModHooks.optionsChanged` | "tell me when the player changes their settings" |
| `ctx.prefs` | "where do I keep something that outlives a character?" |
| `ctx.newCharacter` | "was this character just created, or loaded?" |

`ctx.prefs` filled a real gap. A mod's save bag lives inside the character's save, so before it existed a mod could keep data about a character but had nowhere to keep data about the player.

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

- `packages/core/src/game/auto-dig.test.ts` - core's side of the seam: the bump with no hook, and the hook's returned energy being honoured.
- `neo-angband-mod-qol/plugin.test.ts` - the mod's own behaviour: one dig plus a move and no step with the tweak on, a decline with it off, and the known, permanent-rock and can't-dig gates.
- `packages/core/src/session/qol-defaults.test.ts` - faithful core option defaults with no QoL override, plus a check that an all-neutral `ModHooks` leaves the RNG state and the generated level bit-identical to no hooks at all.
- `packages/web/src/mod-canary.test.ts` (with `MOD_CANARY=1`) - runs the downloaded plugin.js at the pinned tag through the host's own chain: a setting changed on one character and picked up by the next. It is the only test that runs the bytes a player receives.
- (retired) `packages/web/src/qol-mod.test.ts` - checked that the manifest declared `qol.autoDig` (`default: true`, i.e. on once the mod is enabled) and no option overrides, through `pack.ts` discovery and `resolveModRules`.
