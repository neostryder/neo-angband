# Tutorial 5: Hook one piece of behaviour

**What you will make:** the game congratulating you when you gain a level.

**Before this:** [Tutorial 4](04-change-a-spell.md).

**Time:** ten minutes.

**New idea:** your mod runs code. Still no compiler, no build step, no
dependencies — one `.js` file beside the manifest.

---

## The whole mod

```
my-code-mod/
  manifest.json
  plugin.js
```

`manifest.json` gains two lines compared to the content mods:

```json
{
  "id": "my-code-mod",
  "name": "My Code Mod",
  "version": "1.0.0",
  "shape": "plugin",
  "modApi": 1,
  "engine": ">=0.20.0",
  "author": "your name",
  "license": "GPL-2.0-only",
  "description": "Congratulates you on gaining a level."
}
```

`shape` is `plugin` rather than `content`, and `modApi` says which version of the
plugin contract the file is written against. That is the whole difference.

`plugin.js`:

```js
export default {
  api: 1,

  hooks() {
    return {
      messageText: (raw) =>
        raw.startsWith("Welcome to level ") ? `Congratulations! ${raw}` : raw,
    };
  },
};
```

Eleven lines, and that is the entire mod.

## What is happening

A mod that runs code **default-exports one object**. The game looks at that
object and asks it questions.

`hooks()` returns a plain object whose keys are **behaviour points** — places
where the game will consult a mod before doing something. There are eight of
them. You supply the ones you care about and omit the rest; a key you do not
write is a place the game never asks you about, and it costs nothing.

`messageText` is the simplest one. Every player-visible message passes through
it on its way to the message line, and whatever you return is what is shown.

**Note what is *not* here.** There are no imports. `plugin.js` is a plain ES
module that the game loads from your folder; it does not import the engine,
because the engine is passed *in* to the functions that need it. That is what
keeps a mod from having to be built, bundled, or kept in step with the game's
internal module layout. If you want more than one file, you can `import
"./lib/whatever.js"` from your own folder — relative paths work on both the
desktop and browser builds.

## One rule about this hook

A message hook may **restate** a message. It must never change what a message
means.

"Congratulations!" in front of a level-up is a restatement — same fact, more
enthusiasm. Turning *"You are poisoned."* into *"You feel fine."* is not, and a
mod that does it has made the game lie to the player about their own character.

This is not the engine stopping you; the engine will happily return whatever you
write. It is the line between a mod that changes the game and a mod that breaks
it, and this hook is the easiest place in the whole system to cross it by
accident.

## The mistake to avoid

```js
messageText: (raw) => (raw.startsWith("Welcome to level ") ? `Congratulations! ${raw}` : raw),
//                                                                                     ^^^^
```

That trailing `: raw` matters enormously. Your function sees **every** message
the game prints, so one that forgets to return the original text for cases it
does not care about deletes the rest of the game's output. Whatever your hook
does, the default branch returns what it was given.

## Running it

Exactly as before — the `mods/` folder on the desktop build, or **Choose a mods
folder...** in a browser. A code mod is loaded from a folder the same way a data
mod is.

## What you should see

Gain a level. The message reads *"Congratulations! Welcome to level 2."*

Turn the mod off, reload, and it reads *"Welcome to level 2."* again.

## Try changing this

- Congratulate **loudly**: `` `*** ${raw.toUpperCase()} ***` ``.
- React to a **different** message. Find one you like in the game and match on
  it.
- Add a **second** hook. `saveNoiseScent` and `objectListTiebreak` are two of the
  other seven; see [MOD_SEAMS.md](../MOD_SEAMS.md) for what each one is asked and
  when.
- Print something to the console from inside the hook and watch how often it is
  called. It is a good way to get a feel for the game's message volume.

## The finished version

`samples/tutorials/05-hook-behaviour/`, which really is imported and really is
folded through the game's own hook composition on every test run — the test would
fail if this page's code stopped working.

---

**Next:** [Tutorial 6: Add an option](06-add-an-option.md) — the same mod, with a
switch the player controls.
