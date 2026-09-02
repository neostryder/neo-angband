# Tutorial 1: Change one thing

**What you will make:** daggers that hit harder and cost ten times as much.

**What you need:** a text editor. That is the whole list. No compiler, no
toolchain, no account, and no copy of the game's source code.

**Time:** about five minutes, most of it finding the Mods menu.

---

## Mod files

A mod is a folder. Make one anywhere you like, call it `my-first-mod`, and put
two files in it:

```
my-first-mod/
  manifest.json
  object.json
```

`manifest.json` says who the mod is. Copy this exactly:

```json
{
  "id": "my-first-mod",
  "name": "My First Mod",
  "version": "1.0.0",
  "shape": "content",
  "engine": ">=0.20.0",
  "author": "your name",
  "license": "GPL-2.0-only",
  "repository": "https://github.com/you/my-first-mod",
  "dependencies": { "core": "*" },
  "description": "Daggers hit harder and cost more."
}
```

`repository` is required even for a mod you never publish. It is the mod's
identity across every way of getting it: the game pins an installed mod to the
repository it came from and refuses a replacement from anywhere else, so a mod
that names nowhere can be overwritten by anything claiming its id. Point it
wherever you intend to publish, or wherever you would if you did.

`object.json` is the change:

```json
{
  "fieldPatches": {
    "core:sword--dagger": [
      { "op": "set", "path": "attack.hd", "value": "1d6" },
      { "op": "set", "path": "cost", "value": 300 }
    ]
  }
}
```

That is a complete, working mod. Two files, twenty lines.

## What those six lines are saying

**`object.json`** is the name of one of the game's data files. The base game
ships an `object.json` full of every item in Angband, and your file contributes
to *that* file. If you wanted to change a monster you would write `monster.json`
instead; the file name is how the game knows what you are talking about.

**`core:sword--dagger`** names the record you are changing. The `core:` half says
whose record it is: the base game's, as opposed to yours or another mod's. The
rest is the dagger's identity within its file - for an object, its `type` and
its `name` joined by `--`. You do not have to memorise these: type your best
guess, and if it is wrong the game tells you *which rule builds the ref*, so you
can work it out from the record you were aiming at. It does not hand you a list
of candidates, and there is no "did you mean" for refs.

A ref that resolves to nothing costs you that one contribution, not the whole
mod: the game skips it, reports it on your mod's row in the mod manager, and
loads everything else you wrote.

**`fieldPatches`** is a list of small edits, each naming a path into the record
and a new value. `attack.hd` is the damage dice; `cost` is the base price in
gold. Everything you do not mention is left exactly as the base game has it.
This is a change to two numbers, not a replacement of the dagger.

**`"dependencies": { "core": "*" }`** is you saying "I am modifying the base
game's stuff." Without it the game refuses the patch. That is deliberate: a mod
may only change records belonging to something it has declared, so a mod can
never quietly reach into another mod it never mentioned.

## Running it

**On the desktop build:** put your `my-first-mod` folder into the `mods/` folder
that sits beside the game, and start the game. Press `Escape`, choose **Mods**,
find *My First Mod*, turn it on, and choose **Apply changes and reload**.

**In a browser:** press `Escape`, choose **Mods**, choose **Choose a mods
folder...**, and point it at the folder *containing* `my-first-mod`. Then turn it
on and reload as above. The game remembers the folder, so editing a file and
reloading the page is your whole edit-and-test loop.

## Check the result

Buy a dagger in the **Weapon Smiths** (the `3` on the town map) - that is the
shop that stocks daggers, not the General Store. It now costs around 300 gold
rather than around 30. Inspect it with `I` and its damage reads `1d6`. Hit
something with it and it hurts more.

Turn the mod off and choose **Apply changes and reload**, and daggers are
ordinary again. That is the part worth pausing on: your change is a layer over
the base game, not an edit to it. Nothing on your machine was modified, and the
game underneath is still the vanilla one.

## Variations to try

- Make the dagger **lighter**: add `{ "op": "set", "path": "weight", "value": 4 }`.
- Change a **monster** instead. Add a `monster.json` with
  `{ "fieldPatches": { "core:soldier-ant": [ { "op": "set", "path": "hit-points", "value": 60 } ] } }`
  and meet a very unreasonable ant on level 1.
- Break it on purpose. Change `core:sword--dagger` to `core:sword--daggerr` and
  reload. Read the error: that message is your main debugging tool, and it is
  worth seeing once while you already know what is wrong.

## Sample mod

`samples/tutorials/tutorial-01-tweak-a-value/` in this repository is exactly this mod.
It is not a copy of the tutorial. It is a mod that gets loaded and checked
against the real game data on every test run, so if anything on this page ever
stops being true, the build fails.

---

**Next:** [Tutorial 2: Add an item](02-add-an-item.md), the same idea, but
creating something the game has never seen instead of adjusting something it
has.
