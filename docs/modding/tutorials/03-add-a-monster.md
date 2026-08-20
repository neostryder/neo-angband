# Tutorial 3: Add a monster

**What you will make:** a carpenter ant — a slightly nastier cousin of the
soldier ant — living on dungeon level 2.

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

Every monster inherits from a *monster base* — the template that decides its
symbol on the map, what it is made of, which attacks it can have, and a pile of
other defaults. `ant` is one the base game ships. So are `canine`, `orc`,
`dragon`, and about a hundred others, all listed in
`packages/content/pack/monster_base.json`.

Get it wrong and **nothing will tell you**. A ref that does not resolve is an
error the game reports; a `base` that names nothing is a monster with no
template, which is not a broken reference — it is a monster that simply does not
work when the dungeon tries to place it. So: copy the `base` from a real monster
of the kind you are making, and check it against `monster_base.json` if you typed
it from memory.

This is the single most common way a first monster mod fails, which is why the
tutorial's own test asserts the base exists rather than trusting it.

## Reading the rest

Same principle as items — find a monster close to what you want in
`packages/content/pack/monster.json` and copy its shape.

- **`speed`** — 110 is normal walking pace, the same as an unhasted player. 120
  is fast enough to be genuinely dangerous.
- **`depth`** and **`rarity`** — where it lives and how often it shows up there.
- **`experience`** — per player level, not a flat award.
- **`sleepiness`** — how likely it is to be asleep when you arrive. 0 means it is
  always awake and coming for you.
- **`blow`** — a list. Each entry is a `method` (how it attacks), an `effect`
  (what that does to you), and `damage` dice. Three blows means three attacks per
  turn. The available methods and effects are in `blow_methods.json` and
  `blow_effects.json` beside the monster file.
- **`color`** — a single letter. `u` is brown, `W` white, `y` yellow. The base
  game's own data is the colour chart.

## What you should see

Start a character, descend to level 2, and look for a brown `a`. Look it up with
`/` or recall it with `l` and the game will describe it using the text you wrote.

## Try changing this

- Make it a **unique**: add `"flags": ["UNIQUE"]`, give it a capitalised proper
  name and a lot more hit points.
- Give it a **second blow** — add another entry to the `blow` array.
- Make it **fast and fragile**: `speed` 130, `hit-points` 4.
- Add a whole **family** — several records in one array, sharing a base.

## Try breaking it

Change `"base": "ant"` to `"base": "aunt"` and reload. Notice what does *and does
not* happen. That is the failure mode described above, and it is much easier to
recognise later if you have seen it once on purpose.

## What it looks like, and the one thing you have to ask for

Your ant already has an appearance, and you only wrote half of it:

- **`"color": "u"`** is yours — umber, so it draws as a brown `a` and reads as a
  different creature from the white `a` beside it.
- **The letter `a` is not yours.** It comes from `"base": "ant"`, along with
  everything else the template carries. Change the base and the letter changes.

That is the whole story in ASCII. **In a tile set it is not**, and this is the
part nobody warns you about: a tile set maps *named* monsters to pictures, and it
has never heard of yours. Your ant keeps drawing as a coloured letter while the
monsters around it are pictures — not a bug, and not something the game can guess
its way out of.

Two ways to fix it, and a mod can do either:

- **Point at a picture that already exists.** A mod can ship pref text that gets
  layered over the tile set the player is using, so `monster:carpenter ant` can
  borrow the soldier ant's tile — one line, no art.
- **Ship your own picture.** The `neo-linoleum` tile engine takes loose,
  individually named PNGs, so a mod can carry its own art for its own monsters.

Both are past what this tutorial covers — see
[modding/README.md](../README.md) for the pref and tile-pack routes. Worth
knowing now, though, so that a letter among the pictures reads as a thing you
have not done yet rather than a thing that is broken.

## The finished version

`samples/tutorials/tutorial-03-add-a-monster/`.

---

**Next:** [Tutorial 4: Change a spell](04-change-a-spell.md) — reaching into a
class's spell list, and what a positional path costs you.
