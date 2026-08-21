# Tutorial 3: Add a monster

**What you will make:** a carpenter ant, a slightly nastier cousin of the
soldier ant, living on dungeon level 2.

**Before this:** [Tutorial 2](02-add-an-item.md).

**Time:** ten minutes.

---

## The whole mod

```
my-monster-mod/
  manifest.json
  monster.json
```

`manifest.json` is the same as before with a new `id` and `description`. The new
file is `monster.json`:

```json
{
  "records": [
    {
      "name": "carpenter ant",
      "base": "ant",
      "color": "u",
      "speed": 110,
      "hit-points": 11,
      "hearing": 10,
      "smell": 20,
      "armor-class": 6,
      "sleepiness": 40,
      "depth": 2,
      "rarity": 1,
      "experience": 6,
      "blow": [{ "method": "BITE", "effect": "HURT", "damage": "1d4" }],
      "desc": ["A big brown ant with jaws that strip wood. It is not fussy about what else they strip."]
    }
  ]
}
```

## The one thing that will bite you

**`base`.**

Every monster inherits from a *monster base*, the template that decides its
symbol on the map, what it is made of, which attacks it can have, and a pile of
other defaults. `ant` is one the base game ships. So are `canine`, `orc`,
`dragon`, and about a hundred others, all listed in
`packages/content/pack/monster_base.json`.

Get it wrong and **nothing will tell you**. A ref that does not resolve is an
error the game reports; a `base` that names nothing is a monster with no
template, which is not a broken reference. It is a monster that simply does not
work when the dungeon tries to place it. So: copy the `base` from a real monster
of the kind you are making, and check it against `monster_base.json` if you typed
it from memory.

This is the single most common way a first monster mod fails, which is why the
tutorial's own test asserts the base exists rather than trusting it.

## Reading the rest

Same principle as items: find a monster close to what you want in
`packages/content/pack/monster.json` and copy its shape.

- **`speed`**: 110 is normal walking pace, the same as an unhasted player. 120
  is fast enough to be genuinely dangerous.
- **`depth`** and **`rarity`**: where it lives and how often it shows up there.
- **`experience`**: per player level, not a flat award.
- **`sleepiness`**: how likely it is to be asleep when you arrive. 0 means it is
  always awake and coming for you.
- **`blow`**: a list. Each entry is a `method` (how it attacks), an `effect`
  (what that does to you), and `damage` dice. Three blows means three attacks per
  turn. The available methods and effects are in `blow_methods.json` and
  `blow_effects.json` beside the monster file.
- **`color`**: a single letter. `u` is brown, `W` white, `y` yellow. The base
  game's own data is the colour chart.

## What you should see

Start a character, descend to level 2, and look for a brown `a`. Look it up with
`/` or recall it with `l` and the game will describe it using the text you wrote.

## Try changing this

- Make it a **unique**: add `"flags": ["UNIQUE"]`, give it a capitalised proper
  name and a lot more hit points.
- Give it a **second blow** by adding another entry to the `blow` array.
- Make it **fast and fragile**: `speed` 130, `hit-points` 4.
- Add a whole **family**: several records in one array, sharing a base.

## Try breaking it

Change `"base": "ant"` to `"base": "aunt"` and reload. Notice what does *and does
not* happen. That is the failure mode described above, and it is much easier to
recognise later if you have seen it once on purpose.

## What it looks like, and the one thing you have to ask for

Your ant already has an appearance, and you only wrote half of it:

- **`"color": "u"`** is yours: umber, so it draws as a brown `a` and reads as a
  different creature from the white `a` beside it.
- **The letter `a` is not yours.** It comes from `"base": "ant"`, along with
  everything else the template carries. Change the base and the letter changes.

In a tile set, `base` does more than pick the letter. A tile set maps *named*
monsters to pictures and has never heard of yours, so the game gives your ant
the tile of a monster that shares its `base`, whichever cell that pack happens to
draw ants in. Your carpenter ant is an ant in a tiled dungeon, in every tile set,
without you naming a picture.

This is why `base` is worth choosing with care rather than filling in: it is the
single field that decides the letter, the template, and the tile. A monster on
`"base": "ant"` is provided for; one on a base whose family the pack does not
draw falls back to the coloured letter, which is the honest answer rather than a
wrong picture.

If you want a *specific* picture instead of your family's, a mod can say so. Both
routes are past what this tutorial covers, and they differ more than they look:

- **Point at a picture that already exists.** Ship a `.prf` as a `prefs`
  resource, and its `monster:carpenter ant:<attr>:<char>` line layers over the
  player's tile set and wins over the family tile. One line, no art, but the
  numbers are *atlas coordinates*, so they are correct for one pack and wrong for
  every other. Reach for this when your mod ships or requires a particular set.
- **Ship a whole tile set.** A mod with the `tiles` facet contributes a graphics
  mode of its own (`tilePacks`), which is how the Linoleum sets are delivered.
  That is a set the player chooses from the Graphics menu, not one picture added
  to somebody else's set, which nothing supports today.

See [modding/README.md](../README.md) for both.

## Changing a monster that already exists

One file can both add records and patch them, and the finished mod does, so the
mirror of [Tutorial 1](01-tweak-a-value.md) is worth seeing on a monster:

```json
{
  "records": [ ... your carpenter ant ... ],
  "fieldPatches": {
    "core:giant-black-ant": [
      { "op": "add", "path": "hit-points", "value": 3 },
      { "op": "addFlag", "path": "flags", "flag": "GROUP_AI" }
    ]
  }
}
```

Giant black ants now have a little more health and hunt in groups. Two things
that section is teaching beyond the ops themselves:

- **`add` is not `set`.** `{"op": "add", "path": "hit-points", "value": 3}` means
  "three more than whatever it is", so it still does the right thing if the base
  game retunes the monster, and it still does the right thing if another mod
  changed it first. `set` would silently undo both.
- **`addFlag` composes.** Two mods adding different flags to the same monster both
  get their flag; neither is a conflict. That is true of `addFlag`, `removeFlag`
  and `append`, and not true of `set`, `merge`, `add` or `mul`. For those, two
  mods on the same field is a reported conflict and the one that loads last wins.

A patched monster keeps its picture, because the tile set already knows it. Only
the ant you *added* needed provisioning.

---

**Next:** [Tutorial 4: Change a spell](04-change-a-spell.md), reaching into a
class's spell list, and what a positional path costs you.
