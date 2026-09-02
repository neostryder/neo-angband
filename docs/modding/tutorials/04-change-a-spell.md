# Tutorial 4: Change a spell

**What you will make:** a Priest whose Minor Healing costs 1 mana instead of 2
and almost never fails.

**Before this:** [Tutorial 3](03-add-a-monster.md).

**Time:** ten minutes.

---

## Mod files

```
my-spell-mod/
  manifest.json
  class.json
```

`class.json`:

```json
{
  "fieldPatches": {
    "core:priest": [
      { "op": "set", "path": "book.0.spell.2.mana", "value": 1 },
      { "op": "set", "path": "book.0.spell.2.fail", "value": 5 }
    ]
  }
}
```

This is Tutorial 1's `fieldPatches` again, pointed at a class instead of an item.
Nothing new is being introduced except *where you are pointing*.

## Reading the path

`book.0.spell.2.mana` walks down through the Priest's record:

- `book.0`: the Priest's first spell book.
- `spell.2`: the third spell in it (counting from zero). That is Minor Healing.
- `mana`: its cost.

`fail` is the percentage chance the spell fizzles, before your character's own
stats adjust it.

To find the spell you want, open `packages/content/pack/class.json`, find your
class, and count. Books and spells are in the order they appear in the game's own
spell menu, so you can count them on screen instead if that is easier.

## Positional paths can target the wrong spell

**A number in that path is a position, not a name.**

`spell.2` means "whatever is third", not "Minor Healing". If another mod inserts
a spell above it, or if a future release of the base game reorders that book,
your patch lands on a *different spell* and keeps working silently. Nothing is
broken, so nothing complains; you just quietly retuned the wrong thing.

There is no way around that today, and pretending otherwise would be worse than
saying it: positional paths are how the data is shaped. What you can do is know
it. If you publish a spell mod, say which release you built it against, and
re-check it when the game updates. (The tutorial's own test asserts that
`book.0.spell.2` is still called Minor Healing, precisely so this page cannot go
quietly wrong.)

## Adding a spell rather than changing one

Same mechanism, one extra step. `set` a whole spell object at the next free
index, then raise the book's `spells` count so the game knows the book got
longer:

```json
{
  "fieldPatches": {
    "core:priest": [
      { "op": "set", "path": "book.2.spell.6", "value": { "name": "Teleport Other", "level": 18, "mana": 10, "fail": 30, "exp": 20, "effect": [ { "eff": "BOLT_STATUS", "type": "AWAY_ALL", "dice": "$B", "expr": [ { "name": "B", "base": "PLAYER_LEVEL", "expr": "* 3" } ] } ], "desc": ["Produces a bolt that teleports away the first monster in its path."] } },
      { "op": "set", "path": "book.2.spells", "value": 7 }
    ]
  }
}
```

That is not an invented example. It is what the real `feature-restoration` mod
does to give the Priest back a spell a later version of Angband dropped, and the
four numbers are the ones it ships.

They are worth a moment, because they are not the numbers the old game used.
Angband 4.1.2 gave the Priest this spell as `Teleport Other:20:20:80:16`, in that
file's `name:level:mana:fail:exp` order, and those records are in this repository
at `reference/lib/gamedata/old_class.txt`. Angband 4.2 then repriced spells to
cost the same in every class that has them, so both classes that still have this
one pay 10 mana at 30 percent failure. Quoting 20 and 80 into the current game
would charge a Priest twice the mana of the identical spell in a Mage's book. Get
the old data and read it, then check whether the units it is written in still mean
what they meant: [Feature restoration](../FEATURE_RESTORATION.md) is the rule this
follows, and its worked example is this exact spell.

The `effect` block is the game's own effect vocabulary: `BOLT_STATUS`,
`PLAYER_LEVEL`, dice expressions. You are not limited to the effects the base
game ships, but inventing a new one is a code job rather than a data job; that
is [Tutorial 5](05-hook-behaviour.md) and the pages beyond it.

## Check the result

Roll a Priest, learn Minor Healing, and open the spell menu. Its mana cost reads
1 and its failure rate is far lower than an unmodded Priest's at the same level.

## Variations to try

- Retune a **different class**: `core:mage`, `core:ranger`, `core:paladin`.
- Move a spell **earlier**: set its `level` to 1 and get it at character
  creation.
- Make a class **worse** at something, which is often what makes a variant
  interesting rather than a cheat.

## Sample mod

`samples/tutorials/tutorial-04-change-a-spell/`.

---

**Next:** [Tutorial 5: Hook behaviour](05-hook-behaviour.md), the first tutorial
where your mod runs code instead of shipping data.
