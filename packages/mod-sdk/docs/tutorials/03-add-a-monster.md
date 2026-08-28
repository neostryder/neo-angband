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
`dragon`, and fifty-odd others - the file is
`packages/content/pack/monster_base.json` and it holds 56 records in total, so it
is short enough to read.

Get it wrong and you get told twice, which is worth knowing before you go looking
for a subtler explanation. `base` is a declared reference, so composition reports
it by name: *base names the monster base "aunt", and no loaded pack defines it in
monster_base*, on your mod's row. And the monster binder then refuses to build the
record at all rather than building a monster with no template. So: copy the `base`
from a real monster of the kind you are making, and check it against
`monster_base.json` if you typed it from memory.

This is the single most common way a first monster mod fails, which is why the
tutorial's own test asserts the base exists rather than trusting it.

## Reading the rest

Same principle as items: find a monster close to what you want in
`packages/content/pack/monster.json` and copy its shape.

- **`speed`**: 110 is normal walking pace, the same as an unhasted player. 120
  is fast enough to be genuinely dangerous.
- **`depth`** and **`rarity`**: where it lives and how often it shows up there.
- **`experience`**: not a flat award. What the player actually gets is
  `experience * the monster's level / the player's level`, so the same monster is
  worth steadily less as the character grows.
- **`sleepiness`**: how likely it is to be asleep when you arrive. 0 means it is
  always awake and coming for you.
- **`blow`**: a list. Each entry is a `method` (how it attacks), an `effect`
  (what that does to you), and `damage` dice. Three blows means three attacks per
  turn. The available methods and effects are in `blow_methods.json` and
  `blow_effects.json` beside the monster file.
- **`color`**: a single letter, and the case matters. `u` is Umber (brown), `y`
  is Yellow, `w` is White - `W` is Light Slate, which is what the soldier ant
  actually is. `packages/core/src/color.ts` is the chart.

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

**In a tile set, your ant has no picture, and the game will not invent one.** A
tile set maps *named* monsters to pictures and has never heard of yours, so in
tile mode a player sees your brown `a` standing among pictures. The game used to
guess - it drew an added monster with the tile of a relative sharing its `base` -
and that guess was removed in 0.23.0, because Neo Angband is a faithful port of
4.2.6 and 4.2.6 has no opinion about what a creature it has never heard of should
look like. Deciding that on behalf of somebody's art is the tile set's call, not
the port's.

**So ship tiles with your content if you can, and say what happens if you do not.**
Two sentences in your mod's description are the difference between a player
thinking your mod is broken and a player knowing what they are looking at:

> Includes tiles for the carpenter ant.

or

> No tiles of its own: in tile mode the carpenter ant draws as a letter. Install
> [linoleum](https://github.com/neostryder/neo-angband-mod-linoleum) and it is
> drawn from its family instead.

That second one is a real fallback rather than a shrug. Linoleum, the loose-pack
tile mod, fills content nothing drew: an added monster is drawn from a relative
sharing its `base` with the colour turned, so your carpenter ant reads as an ant
without being pixel-identical to the base game's. It applies to Linoleum's own
packs only - under Angband's own tile sheets there is no spare cell for a variant,
so a letter is what an added creature gets - and your players turn it on
themselves. **It is not a dependency:** your mod is complete and correct in ASCII
with no tile set at all, so do not require it. Point at it, and let the player
choose.

This is also why `base` is worth choosing with care rather than filling in: it is
the single field that decides the letter, the template, and, for anyone running a
tile mod that fills blanks, the family it borrows from.

If you want a *specific* picture, a mod can say so. Both routes are past what this
tutorial covers, and they differ more than they look:

- **Point at a picture that already exists.** Ship a `.prf` as a `prefs`
  resource, and its `monster:carpenter ant:<attr>:<char>` line layers over the
  player's tile set and wins over anything a tile mod would have filled in. One
  line, no art, but the numbers are *atlas coordinates*, so they are correct for
  one pack and wrong for every other. Reach for this when your mod ships or
  requires a particular set.
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

A patched monster keeps its picture, because the tile set already knows it by
name. Only the ant you *added* has nothing drawn for it.

## The finished version

`samples/tutorials/tutorial-03-add-a-monster/` in this repository is exactly
this mod. It is not a copy of the tutorial. It is a mod that gets loaded and
checked against the real game data on every test run, so if anything on this
page ever stops being true, the build fails.

---

**Next:** [Tutorial 4: Change a spell](04-change-a-spell.md), reaching into a
class's spell list, and what a positional path costs you.
