# Tutorial 2: Add an item

**What you will make:** one new piece of armour the base game has never heard
of, findable in the dungeon and buyable in town.

**Before this:** [Tutorial 1](01-tweak-a-value.md), which explains what a mod
folder is and how to load one.

**Time:** ten minutes.

---

## The whole mod

```
my-item-mod/
  manifest.json
  object.json
```

`manifest.json` — same shape as last time, different id:

```json
{
  "id": "my-item-mod",
  "name": "My Item Mod",
  "version": "1.0.0",
  "shape": "content",
  "engine": ">=0.20.0",
  "author": "your name",
  "license": "GPL-2.0-only",
  "dependencies": { "core": "*" },
  "description": "Adds a padded jerkin."
}
```

`object.json`:

```json
{
  "records": [
    {
      "name": "Padded Jerkin~",
      "type": "soft armor",
      "graphics": { "glyph": "(", "color": "U" },
      "level": 1,
      "weight": 60,
      "cost": 12,
      "alloc": { "common": 20, "minmax": "1 to 40" },
      "attack": { "hd": "0d0", "to-h": "0", "to-d": "0" },
      "armor": { "ac": 5, "to-a": "0" },
      "desc": ["A quilted jacket stuffed with wool. It is warm, and very slightly protective."]
    }
  ]
}
```

## What changed from Tutorial 1

One word: `records` instead of `fieldPatches`.

`fieldPatches` edits something that already exists. `records` **adds** something,
and your mod owns what it adds. Everything else you learned still applies — same
folder, same manifest, same way of loading it.

## Reading the record

Most of it is Angband's own vocabulary rather than anything this project
invented, which means the base game's own data is your reference manual. If you
want to know what a field does, find an item that already does it and copy how
it says so.

- **`name`** — the trailing `~` is where the plural goes. "Padded Jerkin~"
  displays as *a Padded Jerkin* and *2 Padded Jerkins*. An item whose name starts
  with `&` (`"& Dagger~"`) takes an article. These marks are the original game's
  convention, and they are why you should copy an existing name's punctuation
  rather than invent it.
- **`type`** — which kind of item this is. `soft armor` puts it in the body
  armour slot and in the armoury's stock. Use one the game already has;
  [Tutorial 4](04-change-a-spell.md)'s follow-on reading covers inventing a
  wholly new item class.
- **`level`** — the depth at which it starts appearing.
- **`alloc`** — how often, and between which depths. `common: 20` is roughly the
  frequency of ordinary early gear; `"1 to 40"` is the depth window.
- **`armor.ac`** — the armour it gives. Soft Leather Armour has 8 and costs 20,
  so 5 for 12 gold is a deliberately worse, cheaper option.
- **`desc`** — an array of lines, shown when the player inspects it.

**Where to get the numbers.** Open `packages/content/pack/object.json` in this
repository and find an item like the one you want. That file is the base game's
own data, in exactly the format your mod writes, so the nearest existing item is
always a working template. There is also a helper that does this for you —
`draftRecord` fills in a new record from the game's comparable records, including
a sensible price. See [AUTHORING.md](../AUTHORING.md).

## What you should see

Start a new character and walk into the General Store or the Armoury. Padded
Jerkins turn up in stock at that depth range. Wear one and your armour class
goes up by 5.

Your item is `my-item-mod:padded-jerkin` as far as the game is concerned — a name
in your own namespace, so it can never collide with the base game's items or with
another mod's, even if you both add a Padded Jerkin.

## Try changing this

- Make it **cursed-cheap and heavy**: `weight` 200, `cost` 2.
- Make it **rare and deep**: `level` 30, `alloc` `{ "common": 3, "minmax": "30 to 100" }`.
- Add a **second item** in the same `records` array. A mod can add as many as it
  likes; the array is a list.
- Give it an **ego** possibility, or a flag — find an item in the base game's
  `object.json` that has the property you want and copy the field across.

## The finished version

`samples/tutorials/02-add-an-item/`, which is loaded and composed against the
real game data on every test run.

---

**Next:** [Tutorial 3: Add a monster](03-add-a-monster.md) — the same move in a
different file, and the one gotcha that no error message will catch for you.
