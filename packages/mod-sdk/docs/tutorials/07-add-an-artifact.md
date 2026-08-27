# Tutorial 7: Add an artifact

**What you will make:** the Leather Shield of the Watchful Eye, a one-of-a-kind
shield that turns up somewhere around dungeon level 12 and never turns up twice.

**Before this:** [Tutorial 2](02-add-an-item.md). Tutorials 3 to 6 are not
required for this one, but 2 is: an artifact stands on top of an ordinary item,
so it helps to have added one first.

**Time:** ten minutes.

---

## What an artifact actually is

This is the whole tutorial, so it is worth getting straight before you type
anything.

An artifact is **not** a new kind of item. It is a set of adjustments to an item
the game already has. "The Leather Shield of the Watchful Eye" is a real leather
shield, out of the real leather shield entry in `object.json`, with a different
name, better numbers, and some flags bolted on. That is why the record has a
field called `base-object` and why almost every other field is a number: you are
describing the difference, not the thing.

Two consequences follow from that, and they are what makes artifacts feel
different from tutorial 2:

- **It is unique.** The game generates each artifact at most once per character.
  There is no `alloc` fight with a hundred other shields; there is one of these,
  or there is not one yet.
- **It inherits some things and not others.** The base object supplies the
  kind's flags, and its activation when your artifact declares none. It does NOT
  supply the numbers: `weight`, `ac`, `to-a`, `to-h`, `to-d` and the damage dice
  all come from the artifact record, and one you leave out binds to zero rather
  than to the base object's value. Say them. A
  leather shield's weight class, its material, how it reacts to acid: all of that
  arrives for free because you named the base.

## The whole mod

```
my-artifact-mod/
  manifest.json
  artifact.json
```

`manifest.json` is the same shape as every tutorial before this, with its own
`id` and `description`, and one difference worth noticing: its `engine` floor is
`>=0.22.0` rather than `>=0.20.0`, because that is the release the behaviour this
page relies on landed in. An `engine` range is a claim about which builds a mod
was written against, so it moves when what the mod depends on moves. The new file
is `artifact.json`:

```json
{
  "records": [
    {
      "name": "of the Watchful Eye",
      "base-object": {
        "tval": "shield",
        "sval": "Leather Shield"
      },
      "level": 12,
      "weight": 50,
      "cost": 14000,
      "alloc": {
        "common": 10,
        "minmax": "12 to 70"
      },
      "attack": {
        "hd": "0d0",
        "to-h": 0,
        "to-d": 0
      },
      "armor": {
        "ac": 8,
        "to-a": 10
      },
      "flags": ["SEE_INVIS", "PROT_FEAR"],
      "values": ["INFRA[2]", "RES_DARK[1]"],
      "desc": [
        "A round shield of boiled leather, its boss worked into a single open eye.",
        "  The eye does not blink, and neither, while you carry it, do you."
      ]
    }
  ]
}
```

Turn it on, roll a character, and go down. Somewhere between level 12 and level
70 you will find it, once.

## The name is not the name

Look at `name` again:

```json
"name": "of the Watchful Eye"
```

That is not a mistake and it is not shorthand. An artifact's name is the part
that goes **after** the base object's name, because the game assembles the full
name from both halves: `Leather Shield` plus `of the Watchful Eye` gives you *the
Leather Shield of the Watchful Eye* in the item list.

This is why artifact names in the base game read the way they do. Look in
`packages/content/pack/artifact.json` and you will find `of Galadriel`, which
becomes the Phial of Galadriel, alongside `'Angrist'`, in quotes, which is a
proper name that replaces the base name rather than following it. Pick whichever
reads correctly for what you are making, and remember that you are writing half
a name.

Also note what is **absent**: no `&`, no `~`. Tutorial 2's item was
`"Padded Jerkin~"`, with a `~` marking where the plural goes. An artifact is
unique, so it is never plural, and it never needs an article chosen for it. If
you carry tutorial 2's habits over you will end up with an item called *the
Leather Shield of the Watchful Eye~*.

## The one thing that will bite you

**`base-object`.**

Both halves of it have to name something real:

- **`tval`** is the item type, and it comes from `object_base.json`. `shield`,
  `sword`, `hard armor`, `light`, `ring`. Note the American spelling on the
  armour ones, which catches people, and note that these are the base game's
  own strings rather than anything you get to choose.
- **`sval`** is the base object's name inside that type, from `object.json`, with
  the `&` and `~` decoration stripped off. The entry reads
  `"& Leather Shield~"`; you write `"Leather Shield"`.

Get the `tval` wrong and your artifact is dropped, with a line in the mod
manager saying which record and why. That is a real answer and you can act on it.

Get the **`sval`** wrong and something sneakier happens: the game does not
refuse. It creates an invisible placeholder base object for you and builds your
artifact on that instead, because that is exactly how the base game's own
Phial, Star and Arkenstone work: those three have no ordinary version anywhere in
`object.json`. The behaviour is correct and it is load-bearing. It is also
distinguishable from a misspelling, though, and that is the part worth knowing:
`base-object.sval` is a declared reference, so a typo is reported by name on your
mod's row - *base-object.sval names the base object the artifact is built on
"lether shield", and no loaded pack defines it in object*.
The symptom is an artifact that generates and equips but whose base is a blank:
no weight class, none of the base's own behaviour, an item that is somehow not
really a shield.

So: **copy the `sval` out of `object.json`.** Do not type it from memory. This is
the one field in this file where a typo produces a working game and a wrong
item.

## Patching an artifact the game already has

The same file can change an existing artifact, the same way tutorial 3 changed an
existing monster. Add this beside your `records`:

```json
  "fieldPatches": {
    "core:angrist": [
      { "op": "add", "path": "armor.to-a", "value": 3 }
    ]
  }
```

`add` is relative: three more points of armour than Angrist already had, whatever
that is. Use `add` rather than `set` for anything you are adjusting rather than
deciding, and your mod will survive the base game retuning the number underneath
you.

The ref is `core:` plus the artifact's name in lower case with the punctuation
dropped, so `'Angrist'` is `core:angrist`. If a ref does not resolve, the loader
tells you so by name; that is the friendly failure, and it is what
`npx neo-angband-mod-check` is for.

## What to fiddle with

Everything below `base-object` is the fun part.

- **`level`** is how deep the game considers the artifact to be, which feeds
  into how it is priced and how good it is allowed to be.
- **`alloc`** is `common`, the weighting against everything else eligible, and
  `minmax`, the depth band it can appear in. `"12 to 70"` means it will not be
  generated shallower than 12 or deeper than 70.
- **`armor.ac`** replaces the base object's armour class, and **`armor.to-a`** is
  the bonus on top. On a weapon you would be reaching for `attack.hd`, `to-h` and
  `to-d` instead.
- **`flags`** are the yes-or-no properties: `SEE_INVIS`, `PROT_FEAR`,
  `FREE_ACT`, `REGEN`, and a long list more.
- **`values`** are the ones that carry a number, written with the number in
  square brackets: `INFRA[2]`, `RES_DARK[1]`, `STR[2]`, `SPEED[5]`.

Both lists are in `packages/content/pack/object_property.json`. One catch when
you go looking: a resistance's `code` there is the bare element
(`resistance:DARK`), and the token you write in `values` is `RES_` plus that
element, assembled when the record binds. Grepping the file for `RES_DARK` finds
nothing. Flags and modifiers are spelled out
under `code`, which is the file to have open while you write this rather than the
one to guess at. A flag or a value the game does not recognise is refused when
your mod loads, which is the good outcome; you get told, before you play.

If you want an artifact that does something when you activate it, that is `act`
plus `time`, and the names come from `activation.json`. Copy a base-game artifact
that already activates and change the numbers before writing one from scratch.

## What you learned

- An artifact is a **layer over an existing item**, not a new item, which is why
  `base-object` exists and why the rest is mostly numbers.
- Its `name` is only **half a name**, and it takes none of the `&` and `~`
  decoration an ordinary item's name needs.
- A wrong `tval` gets reported. A wrong `sval` **silently invents a base object**,
  because the base game needs that behaviour for the Phial. Copy the sval.
- `add` beats `set` when you are adjusting a number the base game owns.

## The finished version

`samples/tutorials/tutorial-07-add-an-artifact/` in this repository is exactly
this mod. It is not a copy of the tutorial. It is a mod that gets loaded and
checked against the real game data on every test run, so if anything on this
page ever stops being true, the build fails.

**Next:** nothing, this is the last one. What is worth reading after these is
listed at the end of the [tutorial index](README.md), and
[REQUIREMENTS.md](../REQUIREMENTS.md) is the one to read first if you are about
to share a mod with somebody.
