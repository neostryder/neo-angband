# Feature restoration

Cutting Room Floor (`feature-restoration`) brings back content that is or was in upstream Angband's code. That covers features a release shipped and a later release removed, and content upstream wrote and never switched on. The name comes from the Skyrim mod that restores that game's cut content. The base game tracks the latest official Angband release with nothing added. Every restoration is a separate switch, off until a player turns it on, and with every switch off the game is the unmodified release.

## What belongs here

A restoration needs an upstream source: either a release that shipped the feature, or upstream's repository and git history for content that was written and never enabled, such as an artifact record committed already commented out. Rebalances, house rules and ideas with no upstream code stay out.

Content that no release ever shipped gets its own switch, and the switch's title says so. The Amulet of Amandil is the current case. It was written in 2011, committed commented out, and has stayed commented out in every release since, so its switch is called "Add the Amulet of Amandil (never released)".

Anything the current game still has under another name is left alone. The Shadow Cloak is the Elven Cloak, and the Sleep Monster wand is Hold Monster. Selling to stores is still in the base game too: the `birth_no_selling` birth option turns it off by default, and a player can turn it back on at character creation with no mod. Content that depends on Charisma, such as the Potion of Ugliness, stays out because the current game has no Charisma stat.

## The rules

### 1. Research it. Never restore from memory.

A restoration comes from the upstream source that had it, read and cited. Remembered mechanics are wrong in their details, and the details are what a restoration reproduces. "Stores used to discount things sometimes" cannot be built. Angband 3.0.6's `mass_produce` in `store.c` can: it gave a 10 percent discount about one time in 25, down to 90 percent about one time in 500, checked in a fixed order and never on an item under 5 gold. The mod's store discounts use those odds in that order.

When the source is older than the vendored `reference/` tree, the restoration says where it came from so someone else can fetch it. The discount roll comes from `gh api repos/angband/angband/contents/src/store.c?ref=v3.0.6`.

### 2. Say which version or commit it comes from.

"Old Angband had this" cannot be checked, and "Angband 3.0.6's `mass_produce` rolled these odds" can. Each restored feature names the last release that carried it, so players can tell whether it comes from the era they remember and maintainers can go and read it. Content that never shipped names the commit that added it instead. Amandil cites `2744ef5a1`.

### 3. Quote the source, unless its units have since been repriced.

By default a restoration quotes. When the release that had the feature can still be read, its numbers go in unchanged. A change in the surrounding system is a reason to go and find the old number, never to invent a new one, because an invented number looks the same as a quoted one once it ships. Angband 4.1's class records are kept in this repository at `reference/lib/gamedata/old_class.txt`, next to the current `class.txt`, so spell comparisons need no network and no second checkout.

The exception is a repricing. An old number reproduces the old game only while its units mean what they meant. When the whole game has been repriced on the axis a value sits on, the quoted value becomes the one thing still charged at old rates, and converting it is how the restoration stays faithful.

Teleport Other is the worked example. Angband 4.1.3 priced the spell per class: 12 mana at 60 percent failure for a Mage, 20 at 80 for a Priest, 25 at 70 for a Rogue or a Ranger, and 25 at 80 for a Paladin. Angband 4.2 gave each spell the same price in every class that has it, and both surviving copies of Teleport Other cost 10 mana at 30 percent. A 4.1.3 Priest row in the current game would charge twice the mana and fail almost three times as often as the same spell in a Mage's book. The restored spell costs 10 mana at 30 percent.

An axis counts as repriced only when three things are in hand:

1. The old value, read from the old data.
2. The current value of the same thing wherever it survived. If nothing survived, there is no measured repricing and the value is quoted.
3. Evidence that the formula behind the number did not change, so the two versions' figures can be compared at all. For mana and failure that means the mana accrual formula and its lookup tables, which are the same in 4.1 and the current release.

A pair that the old version treated identically turns a judgement into arithmetic. In 4.1.3 the Rogue's and the Ranger's rows for Teleport Other were byte-identical. The Rogue kept the spell and the Ranger lost it, so the Rogue's current row shows what the repricing did to that row, and the restored Ranger matches it. The mod's tests compare the two against the published content pack, so a later core reprice fails a test instead of leaving the restoration out of date.

When only part of a repricing can be measured, the restoration says which part is which. The mana and failure figures above are measured. The levels are not: 4.2 moved the Mage's level down by 8 and the Rogue's by 1, and nothing in the data says which of those a restored class should follow. The Priest moves down two levels and the Paladin and Ranger one each, and the mod's README marks those values as judgement calls.

Adaptation is the last resort, for an old value with nowhere left to go. Before 3.0.8, Angband wrote a discount onto a field of the item itself, and the current release has neither the roll nor the field. Restoring discounts took a new engine seam, the discount-roll hook in `registry:store`. The odds are still quoted from 3.0.6, and only the place they attach to is new.

Each restored value is documented as quoted, repriced or adapted. Those are different claims, and a value that does not say which one it makes cannot be checked.

### 4. One feature, one switch.

Each restoration is its own switch, never an "old Angband mode". Someone who misses store discounts may not want sticky curses, and few people remember any single version as a whole. Records and behaviour that only work together share one switch so they cannot get out of step. Door spiking's Iron Spike and its `spike` command sit behind one flag, and the bronze dragons come with their scale mail and the confusion element they breathe.

### 5. Everything off by default.

Enabling the mod changes nothing. Every switch defaults to off, the birth-locked ones included, and the player turns on the ones they want.

### 6. Lock at birth what a save depends on.

A section whose content sits at fixed positions inside a saved character declares `"lockedAtBirth": true`. Spells are the reason: a character's learned spells are saved by their index within the class, and swapping the class's spell list under an existing character would scramble what it knows. The game records a locked section's choice when the character is created and uses that choice every time the character loads, so changing the toggle later affects new characters only. The classic arcane books, the classic prayer books and the classic class chassis are all locked at birth. The field is described in [Renaming a section or turning a rule into a section](AUTHORING.md#renaming-a-section-or-turning-a-rule-into-a-section).

### 7. Use real art, and never scale a tile down.

In each tile pack, a restored item, monster or flavour draws the first of these that exists:

1. The pack's own historical tile, taken from upstream's sheet at the newest release whose pref files still mapped it.
2. A real historical tile from another pack at the same or a lower resolution, the highest one available. From lowest to highest the packs are Old (8x8), Nomad (8x16), Adam Bolt (16x16), Gervais (32x32) and Shockbolt (64x64).
3. Its glyph.

A tile from a larger pack is never scaled down, and a tile from an unrelated thing is never borrowed. When a restored thing's old tile now belongs to its successor, as with a restored monster and the monster that replaced it, the Linoleum engine rotates the restored one's hue so the two can be told apart. Without Linoleum they draw the same tile. [Art for restored records](AUTHORING.md#art-for-restored-records) lists the manifest fields.

## What this pressure-tests

A restored feature has a fixed target. It works the way it did or it does not, and the mod cannot redefine the goal, so each restoration either lands on the seams that exist or shows one that is missing. A restoration that cannot be built with the current seams is a bug report against the seams.

Restorations have added these seams so far:

- The discount-roll hook in `registry:store`, for store discounts, because the current release has no discount field or roll left to patch.
- `lockedAtBirth` on manifest sections, for the classic spellbooks.
- `restoredMonsterArt` and `restoredFlavorArt` beside `restoredItemArt`, for restored monsters and flavours.
- A web loader fix that declares a mod's monster spells before binding them, for the bronze dragons' confusion breath ([#319](https://github.com/neostryder/neo-angband/issues/319)). The bronze dragons do not ship until a game release carries that fix.

## The mod

[neo-angband-mod-feature-restoration](https://github.com/neostryder/neo-angband-mod-feature-restoration) is the first-party restoration mod, listed in the mod manager as Cutting Room Floor. Each entry below is one switch, and every switch is off by default. The mod's README names the source of every restored value and marks which are measured and which are judgement calls, and its [settings reference](https://github.com/neostryder/neo-angband-mod-feature-restoration/blob/master/SETTINGS.md) lists every flag.

Spells and classes:

- Classic arcane books brings back Angband 4.1's nine arcane books for the Mage, Rogue and Ranger, with the Ranger casting from Intelligence again. Locked at birth.
- Classic prayer books brings back 4.1's nine prayer books for the Priest and Paladin. Locked at birth.
- Classic class chassis restores 4.1's experience penalties, skills and hit dice for those five classes, separately from the books. Locked at birth.
- Restore Teleport Other gives the spell back to the Priest, Paladin and Ranger, who had it in 4.1.3, at the price the Mage's and Rogue's copies have now.

Items and mechanics:

- Restore store discounts brings back 3.0.6's discount roll on restocked items, through a plugin.
- Restore door spiking brings back 3.4.1's Iron Spikes and the command that jams a door with one.
- Restore the "of Fury" weapon ego puts back the three weapon types upstream commented out in 2011. The ego was live from 3.0.6 through 3.2.0, and the rest of its record is still in the current release.
- Restore cut rods, wands and staffs brings back six devices last seen in 3.0.9, 4.0.5 and 4.1.3.
- Restore cut potions brings back seven potions from 3.0.9 and Lose Memories from 4.1.3.
- Restore cut weapons, armour and diggers brings back seven items from 3.0.9.
- Restore the deadly potions brings back Death, Ruination and Detonations from 3.0.9.
- Restore sticky curses brings back 4.0's rule that a cursed item stays on until its curse is removed. It also adds the cursed Rings of Woe, Weakness, Stupidity and Aggravate Monster, the Amulet of DOOM, the Staff of Slowness, and the Curse Weapon and Curse Armour scrolls with the (Shattered) and (Blasted) egos they create.
- Restore classic uncursing brings back 4.0's Remove Curse, which clears every eligible curse on worn equipment at once, and the chance for an enchant scroll to break a curse.
- Restore junk items brings back 14 kinds of 3.4.1 junk, ignored by default for new characters.
- Restore seven ring and amulet flavors brings back the seven looks that upstream gave to artifact rings and amulets in 2013, so an unknown Ruby ring can be Narya again.
- Add the Amulet of Amandil (never released) switches on the artifact upstream wrote in 2011 and never enabled.

Monsters:

- Restore the monsters cut in 4.2.0 brings back 54 of the 55 monsters 4.2.0 replaced, from 4.1.3, alongside their replacements. Where a replacement kept the old monster's depth, speed and hit points, each of the pair appears half as often.
- Restore the novices, swordsmen and angels brings back sixteen monsters from Angband 3.x.
- Restore the bronze dragons brings back the six bronze dragons and Bronze Dragon Scale Mail from 3.2.0, with confusion as a breath element. This section waits for the loader fix above.

Restored monsters and flavours carry their historical tiles under rule 7, and Linoleum is an optional dependency of the mod.

## Candidates people have asked for

These are not built. Each one starts with finding the version that had it and reading what it did, before any code.

- Haggling. It is a whole store interaction rather than a value, and a large piece of work.
- Bashing a door open. The current release has no command for it, which is why restored door spiking makes a door harder to pick instead of pick-proof.
- The Trap Detection and Door/Stair Location scrolls, last in 4.0.5. Both use detection effects the current game still has, so they would be data only.
- The Restore Item scroll, last in 3.5.1, which repaired disenchanted items.
- The Identify and *Identify* scrolls and the Identify rod and staff. They only fit alongside a restoration of identification from before runes.
- The name Pseudo-Dragon Scale Mail and its random light-or-dark breath. 4.2 renamed the armour Shining Dragon Scale Mail and lets the player choose the breath.
- The ruined chest that a smashed chest left behind, last in 4.0.5.
- Classic names for the monsters 4.2 re-themed, which would put the old name, glyph and description on the successor and leave the monster population unchanged. The current monster sections add the old monsters alongside instead.
- 4.0's rule that a light-cursed item gives off no light.

---

**Building one?** Start with [the tutorials](tutorials/README.md). A restoration mod is mostly Tutorial 4 (change a spell) and Tutorial 6 (put it behind a switch), plus research, and the mod's README has a checklist for adding another restored feature.