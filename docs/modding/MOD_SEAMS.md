# Core mod seams: how the bundled mods change the game

This page explains, in one place, the small set of CORE seams the bundled `qol`
and `bug-fixes` mods use, and why each one is byte-identical to faithful Angband
4.2.6 when no mod touches it. It is the answer to "what are the new core seams
and how do they work?".

The guiding rule (PORT_PLAN.md decisions 2, 18, 23, 24): **core is a faithful
reproduction of Angband 4.2.6 - everything in official Angband is in core, at its
upstream defaults - and every new fix, tweak, or feature ships as a mod.** The
seams below are how a mod reaches into core WITHOUT core carrying the mod's
behaviour by default.

## 1. `GameState.modRules` - named, off-by-default rule flags

The one seam behind both bundled mods. `GameState.modRules` is an optional
`Record<string, boolean>` of named flags. Core reads it in exactly one place -
`modRuleEnabled(state, name)` (`packages/core/src/game/context.ts`), which
returns `true` only when the flag is explicitly set. A ported core function that
a mod can change is written as:

```ts
if (modRuleEnabled(state, "bugfix.objectListOrder")) {
  // corrected / new branch (only when a mod turned the flag on)
} else {
  // the faithful Angband 4.2.6 branch (the default)
}
```

Because `modRules` is absent by default and read only through `modRuleEnabled`,
core with no mod enabled never enters a modded branch and is byte-identical to
4.2.6. No RNG is drawn differently, nothing is saved differently.

### How a flag gets turned on (declarative - no mod code runs)

A mod does not execute code to flip a flag. It DECLARES the flags it offers in
its `manifest.json` under `rules`, each an entry of:

```json
{ "flag": "qol.autoDig", "title": "Auto-dig on walk",
  "description": "…", "default": true }
```

The host does the rest, entirely outside core:

1. `packages/web/src/pack.ts` `loadEnabledModRuleDecls()` gathers the `rules` of
   every ENABLED mod (in load order).
2. `packages/web/src/mod-store.ts` `resolveModRules(decls, choices)` computes the
   effective map: for each declared rule, `choices[flag] ?? rule.default`. The
   player's choices come from the **Fixes & tweaks** menu and persist in
   `localStorage` (`neo:modRuleChoices`) - a client setting, like the enabled-mod
   set, NOT part of the savefile.
3. `packages/web/src/main.ts` passes that map to `startGame` / `loadGame` as
   `opts.modRules`, which seeds `GameState.modRules` (a copy).
4. The Fixes & tweaks menu (`packages/web/src/mods.ts`) can also toggle a flag on
   the LIVE running state, so a change takes effect without a reload.

This means a "rules mod" is a plain `content` pack with **no plugin code and no
capabilities**. `qol` and `bug-fixes` are both content mods; disabling a mod (or
turning a rule off) drops its flags and restores faithful core. QoL tweaks
default ON; bug fixes default OFF.

> An earlier build implemented this with a trusted in-process plugin plus a
> `registry:rules` capability and a `RulesFacade`. That was removed in favour of
> the declarative manifest field above - it needs no capability, runs no mod
> code, and is what the menu reads. `registry:*` capabilities still exist for the
> other, genuinely code-carrying trusted-plugin seams (effect / room / command /
> monster / vocab); rules are not one of them.

## 2. `StartGameOptions.modRules` / `LoadGameOptions.modRules`

The birth/load entry point for the flags above. `startGame` and `loadGame`
(`packages/core/src/session/game.ts`) accept `modRules` and seed
`GameState.modRules` with a copy. Absent/empty => faithful core. This replaced
the removed `interfaceDefaults` seam: built-in Angband options are NOT set here;
they ship in core at their upstream defaults (`OPTION_ENTRIES.normal`) and are
restored from the save on load.

## 3. `GameState.autoDigStep` - the QoL auto-dig hook

A single optional hook on `GameState`, consulted by `walkAction`
(`packages/core/src/game/player-turn.ts`) when a walk is blocked by a wall,
before the faithful no-energy bump. The session installs it
(`movementAutoDig`, `packages/core/src/game/cave-cmd.ts`); it returns 0 WITHOUT
drawing RNG unless the `qol.autoDig` flag is on and the grid is one the player
can dig, in which case it performs one `do_cmd_tunnel_aux` attempt and returns a
move's energy. Absent hook or off flag => movement is byte-identical to 4.2.6.
This is a hook rather than an inline branch only so the movement code
(`player-turn.ts`) need not import the dig internals (`cave-cmd.ts`).

## Why this is safe for a faithful port

- Single reader (`modRuleEnabled`) enforces "absent = faithful" in one place.
- Flags are a client setting, not saved - a save is portable and does not bake in
  a mod's behaviour; the same character plays faithfully if the mod is removed.
- No mod code runs for rules; the host applies declared data. The capability
  surface did not grow (it shrank: `registry:rules` was removed).
- Each modded branch keeps the exact 4.2.6 branch as its default, so turning a
  flag off is a true revert, not an approximation.

## Where to look

| Concern | File |
| --- | --- |
| Flag reader + `modRules` field | `packages/core/src/game/context.ts` |
| Start/load seam | `packages/core/src/session/game.ts` |
| Auto-dig | `packages/core/src/game/cave-cmd.ts`, `player-turn.ts` |
| Manifest `rules` type + validation | `packages/mod-sdk/src/manifest.ts` |
| Rule discovery | `packages/web/src/pack.ts` (`loadEnabledModRuleDecls`) |
| Choice persistence + resolver | `packages/web/src/mod-store.ts` |
| Fixes & tweaks menu | `packages/web/src/mods.ts` |
| Host wiring | `packages/web/src/main.ts` |
| Per-mod design | `docs/modding/QOL.md`, `docs/modding/BUG_FIXES.md` |
