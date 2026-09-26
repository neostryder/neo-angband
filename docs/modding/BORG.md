# Borg (first-party autoplayer mod)

Borg is Neo Angband's automatic player: a faithful TypeScript port of Angband 4.2.6's `borg` that plays the game on its own. It is a mod rather than part of core, and it shows the mod framework can carry a complete autoplayer: it drives the real game through the same frozen perceive/act agent API that any third-party or AI agent uses, with no privileged engine access.

## Borg's role

It lives in its own repository,
[neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg), with
its own release tags and its own test suite, and it installs through the mod
manager like any other mod. Nothing about it is compiled into the game.

Borg is the main program built on the agent interface (`AGENT_API_VERSION`, frozen at 1.x and add-only, defined in `packages/core/src/agent/types.ts`). It reads the world only through `AgentView`, a read-only, serializable view, and folds what it can see into its own remembered map, monster list and object list, so it plays under fog of war like a person does instead of reading the game's full state. It acts only through `AgentActions`, the semantic command builders, the same way a human's keypresses would. Every turn it runs the ported `borg_think_dungeon` priority ladder (avoid death, attack, gather, flow, explore, descend), which is the original's logic transcribed with its thresholds intact.

Borg is deterministic. Its dry-run combat simulations draw from a private random number generator, so it never disturbs the game's own RNG or trips the save's determinism check, and a Borg run can be replayed.

## Running Borg

Three steps, and the third is separate from the second on purpose.

1. **Install and enable it.** Escape menu -> **Mods** -> *Recommended mods...*,
   pick **Borg**, choose *Install and enable*, then choose the offered reload.
   The mod is now loaded and has done nothing to your character.
2. **Hand it the keyboard.** Press **Ctrl-Z** in play. The host warns twice,
   asks for confirmation, and the Borg takes over from the next turn.

No settings-screen switch hands over the keyboard. Installing a mod and giving it the keyboard are separate choices, and the second is a one-time action (Ctrl-Z) each time, never a standing toggle that a save could carry into an unrelated later session.

The Borg's own Fixes & tweaks screen has nine other toggles mapped to upstream's `borg_cfg[]` settings. They cover risk tolerance and the five gear-weighting priorities, among others, and each defaults to upstream's own value. The mod's README lists all nine and what each one changes.

Only one autoplayer can hold the keyboard at a time. If a second mod also declares a controller, the game refuses it by name and says which one is already playing.

While the Borg holds the keyboard, its Fixes & tweaks screen (Mods -> Borg) also has an **Autoplayer speed** row: Turbo, Fast, Normal or Slow. Fast, Normal and Slow match the speeds of the `?agent=` debug option described below; Turbo (10ms) has no named equivalent there. A change takes effect at once, with no reload.

It plays the same on every surface - browser, PWA, static self-host, desktop -
because it arrives by the same route on all of them.

### `?agent=` is a different thing

The URL parameter `?agent=<id>` runs an agent **compiled into the build**, and
the only one there is `demo-wanderer`, a few lines that walks in a circle. The
port ships no built-in autoplayer, so `?agent=borg` matches nothing. The
parameter is useful for exercising the controller seam without installing
anything, and `?speed=fast|normal|slow` or a raw interval in milliseconds (10 to
5000, default 120) sets its tick rate.

## Fidelity and current limitations

The decision logic - danger evaluation, the `borg_power` fitness function, BFS
pathfinding, the think ladder, combat/defense/escape, item and store decisions -
is ported behavior-faithfully from `reference/src/borg`, each subsystem carrying
golden-value tests derived from the C.

`AgentView` is kept minimal, so the game supplies a few engine internals to the Borg directly instead of through the view; the Borg runs trusted and in-process, so it can receive them. Where a piece of data is not yet wired, the Borg falls back to a faithful, conservative default rather than guessing. What is wired today:

- **Monster race data** (blow dice, spell frequency, spell power) comes from the live monster registry through `makeCoreResolvers`, so danger sensing is exact, and a mod's monsters are read by the same lookup as core's.
- **Artifact activations** and **which shop it is in** are wired too. The Borg can tell whether a worn item grants a named activation and whether it is charged, by tracing the item's artifact, ego or kind back to the `Activation` record that grants it, in the same order of precedence `obj-make.c` uses. It can also tell which shop it is standing in, which is what lets the town-flow ladder's shop steps fire at all.
- **Power with a hypothetical loadout** is wired from 0.25.0. The wear, buy and sell decisions all compare `borg_power` now against `borg_power` with a candidate item worn, bought or sold, and none of them had a way to get the second number, because the frozen view describes only the gear the character has. The Borg now asks the engine through `view.simulateLoadout`, which re-runs `calc_bonuses` over a hypothetical set of worn objects, and then runs the ported `borg_notice` and `borg_power` over the answer, the same wield, recompute and revert approach upstream uses. A mod's items are scored on the same terms as core's, because the answer is ordinary `ItemView`s and the scoring reads their properties, not where they came from.
- **The attack-message table** comes from `registries.monsters.blowMethods`. Upstream builds its `suffix_hit_by` list from the same records at start-up and uses it to recognise that something just hit the borg. Without it, a blow from a monster the Borg cannot see raises no regional fear, and regional fear is the only thing upstream has that stops a borg resting through a beating. A mod's own blow methods are recognised the same way.
- **Object values and flavour awareness** come from `registries.objects` and `state.isAware`. Upstream prices every object it can see on the floor at its kind's shop value, or at 1 while the flavour is unidentified, and every rung that walks to an object skips anything priced at zero or less. Without prices, the Borg sees a floor of worthless things and collects none of them. A mod's own objects are priced by the same lookup.

The mod declares a supported engine range instead of degrading, because losing any of the above would break the Borg rather than switch off one feature. The mod ships on its own schedule, so its own `PLANNED.md` keeps this list current. It also names what has not been ported at all, of which the detection scheduler is the largest piece.

## The host answers blocking prompts for an autoplayer

An autoplayer's `AgentController` returns a `PlayerCommand`, and "dismiss this message" is not a command. The game, though, has places that wait for a keypress: the `-more-` pager between two screenfuls of messages, the forced `-more-` a level change puts in front of the stair message, the floor-item list on a pile of two or more, the shop screen, and yes/no confirmations. Each of these opens a modal prompt, and the autoplayer clock used to skip every tick while one was open, so taking the stairs needed a human to press a key and the run stopped until somebody did.

Now the game presses the key itself. While an autoplayer holds the keyboard and a modal prompt is open on a live game screen, the game feeds one ESCAPE through the same input path every real keystroke uses, and logs that it did. Upstream Angband's borg works the same way: it installs itself as the hook `inkey()` consults for every key the game reads, sees the `-more-` on the message line before it considers a move at all, and answers it with a space (`borg.c:371-388`). Upstream's borg never waited out a blocking prompt either.

If you write a controller, three consequences matter:

- The answer is always ESCAPE. Any key satisfies the pager, and ESCAPE closes an overlay and reads as "no" at a confirmation, which is also what upstream's borg answers to "Die?" (`borg-messages-react.c:133`). A controller cannot choose a different answer and has no need to: a decision the autoplayer should be making reaches it as a command it returns, never as a prompt it dismisses.
- Nothing is answered before there is a game. Character creation owns the terminal, and a mod's 120ms clock does not answer for the player rolling a character.
- The shop screen is dismissed. An autoplayer that steps onto a shop door has the screen closed, because that screen is a UI for a human. Trading goes through `shopBuy` / `shopSell` / `shopExit` on the act facade.

## For mod authors

Borg is the reference implementation for building your own agent: an `AgentController` is just `(view, act) => AgentCommand | null`, and a mod offers one from `ModPlugin.controller` (see `PLUGINS.md`). The `neo-angband-mod-borg` repository is the large worked example; `packages/web/src/agents/demo.ts` is the minimal one. A controller needs the `command:add` capability in the manifest, since it has to be able to act. Because the contract is frozen and capability-gated, the same shape runs in-process (like the Borg) or sandboxed in a Web Worker.
