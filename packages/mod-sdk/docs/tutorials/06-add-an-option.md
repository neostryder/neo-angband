# Tutorial 6: Add an option

**What you will make:** Tutorial 5's mod, with a switch the player can turn on
and off, from the game, without editing anything.

**Before this:** [Tutorial 5](05-hook-behaviour.md).

**Time:** ten minutes.

---

## The whole mod

Same two files. `manifest.json` gains a `rules` block:

```json
{
  "id": "my-option-mod",
  "name": "My Option Mod",
  "version": "1.0.0",
  "shape": "plugin",
  "modApi": 1,
  "engine": ">=0.20.0",
  "author": "your name",
  "license": "GPL-2.0-only",
  "repository": "https://github.com/you/my-option-mod",
  "description": "Congratulates you on gaining a level, if you want it to.",
  "rules": [
    {
      "flag": "my-option-mod.congratulate",
      "title": "Congratulate me on gaining a level",
      "description": "Puts \"Congratulations!\" in front of the level-up message. Nothing else changes.",
      "default": false
    }
  ]
}
```

`plugin.js` gains one line:

```js
export default {
  api: 1,

  hooks(ctx) {
    if (ctx.flags["my-option-mod.congratulate"] !== true) return {};
    return {
      messageText: (raw) =>
        raw.startsWith("Welcome to level ") ? `Congratulations! ${raw}` : raw,
    };
  },
};
```

That is the entire feature. There is no settings API to learn, no storage to
manage, and no screen to build.

## How it works

You **declare** the switch in the manifest. The game builds the screen, shows
your `title` and `description`, remembers what the player chose, and puts the
answer in `ctx.flags` before your code runs.

So reading a setting is a plain property lookup. `title` and `description` are
what the player reads, so write them for a player: say what turning it on does,
not what it does internally.

The flag name is prefixed with your mod's id by convention, and that convention
is worth keeping. It is not because `ctx.flags` is shared - the host slices that
per mod, so you cannot see another mod's toggles and they cannot see yours. It is
because the player's SAVED choices all live in one flat map, keyed by flag name,
so two mods that both called a flag `congratulate` would be sharing one stored
setting.

## Where the check goes, and why it matters

Look at where the `if` is. It is in `hooks`, deciding **whether to supply the
hook at all**, not inside `messageText`, returning `raw` unchanged.

Both look identical to the player. They are not the same thing:

- **Checking inside the hook** means the game calls your function for every
  message it ever prints, forever, and your function decides to do nothing.
- **Checking around the hook** means that when the option is off, you supplied no
  hook, so the game runs its own untouched path and your mod is not in it at all.

The second is the shape to reach for. A disabled option should cost nothing and
should be indistinguishable from your mod not existing. That is not
micro-optimisation. It is what makes it *true* that turning something off gives
you the base game back.

## Default off

`"default": false`, and this is worth stating as a habit rather than a detail:
**a mod being enabled should not be the same as all of its features being on.**

Someone installs your mod because they want one thing in it. Shipping every
toggle on means they get five changes they did not ask for and now have to
discover a settings screen to undo. Ship them off, describe each one clearly, and
let them choose.

The first-party `feature-restoration` mod works exactly this way: enabling it
changes nothing at all until you pick a feature.

## What you should see

Enable the mod and reload. Nothing changes yet, and that is correct.

Press `Escape`, choose **Mods**, choose your mod, and you will find *Congratulate
me on gaining a level* on its own screen, off. Turn it on, choose **Apply changes
and reload**, and gain a level.

## Try changing this

- Add a **second** option, controlling something else, and see both appear.
- Make one **default on** and notice how differently the mod feels to install.
  Then decide whether you were right.
- Rename a rule flag or a section and read about `renamedRuleFlags` and
  `renamedSectionFlags` in [AUTHORING.md](../AUTHORING.md), since there is a
  supported way to do either without losing everyone's saved choice.

## The finished version

`samples/tutorials/tutorial-06-add-an-option/`. Its test asserts the interesting half:
that with the option off, the mod supplies **no hook at all**.

---

## You have finished the core six

Six mods, and between them they cover the shape of nearly everything else:
changing data, adding data, running code, and letting the player decide.

**One more, if you want it:** [Tutorial 7](07-add-an-artifact.md) adds an
artifact. It is the odd one out, because an artifact is a layer over an item
rather than an item, so it is worth doing once even though nothing new about the
mod system is in it.

Where to go after that depends on what you want to build. See
[the learning path](README.md#after-the-tutorials).
