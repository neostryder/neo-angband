# Feature restoration

**Vanilla stays vanilla. Features that Angband has lost along the way can come
back as optional mods.**

It is also the clearest single answer to why this project exists.

Angband has been developed for over thirty years, and development means removal
as well as addition. Mechanics get dropped, sometimes because they were bad,
sometimes because they did not fit a redesign, sometimes because nobody was
maintaining them. Players remember them anyway, and every so often somebody says
*"I miss store discounts"* and there is nothing to be done about it short of
maintaining a fork.

That is the gap this fills. The base game here tracks the **latest official
Angband release**, faithfully and with nothing added. A dropped mechanic comes
back as a **mod with its own switch**, off until someone turns it on, and turning
it off gives back the unmodified game exactly.

## The rules this follows

These exist because the obvious way to do restoration is the wrong way.

### 1. Research it. Never restore from memory.

A mechanic you remember from twenty years ago is a mechanic you remember
*wrong*, in at least one detail, and the details are the whole thing. "Stores
used to discount stuff sometimes" is not a specification.

So a restoration is researched from **actual historical source**, and the
version it came from is recorded. The `feature-restoration` mod's store discounts
are transcribed from Angband v3.0.0's own `store.c`: the real odds (10% about
one time in 25, down to 90% about one time in 500), in the real order, with the
real "nothing under 5 gold" floor. Not approximated, not re-tuned, not invented.

Where the code the restoration came from is *older than this project's vendored
reference tree*, that is stated too, along with how it was obtained, because a
citation nobody can follow is not a citation.

### 2. Say which version you are restoring.

"Old Angband had this" is not a claim anybody can check. "Angband v3.0.0's
`mass_produce` rolled these odds" is. Every restored feature names its source
version, so a player can decide whether that is the era they miss, and a
maintainer can go and look.

### 3. Quote the source, unless its units have since been repriced.

This project has got this rule wrong twice, once in each direction.

**The default is to quote.** When the version that had the feature can still be
found and read, its numbers go into the restoration unchanged. That the
surrounding system moved is not by itself a reason to invent a different number;
it is a reason to go and find the actual old number. Restoring from a guess about
what the old value probably was is the first failure, and it is the worse one,
because the invented number is indistinguishable from a quoted one once it ships.
Angband 4.1.2's own records are preserved in this repository at
`reference/lib/gamedata/old_class.txt`, beside the current `class.txt`, so the
comparison needs no network and no second checkout.

**The exception is a repricing.** A quoted number only reproduces the old experience if its units still mean what they meant. Where the whole game has been repriced on the axis the value sits on, quoting the old value makes it the one thing in the game still charged at old rates, which penalises the player for having been away instead of restoring anything. Converting the value in that case is what faithful quoting requires once the source's units have moved.

The restored `Teleport Other` is the worked example. Angband 4.1.2 priced this
spell per class: a Mage paid 12 mana at 60 percent failure, a Priest 20 at 80, a
Rogue and a Ranger 25 at 70, a Paladin 25 at 80. Angband 4.2 repriced spells to
cost the same in every class that has them, and both surviving copies of this one
sit at 10 mana and 30 percent. So a 4.1.2 Priest row dropped into 4.2.6 would
charge twice the mana and fail nearly three times as often as the identical spell
in a Mage's book. The restoration carries 10 and 30.

**Decide it by measurement, not by argument.** Three things have to be in hand
before an axis may be treated as repriced:

1. The old value, read out of the old data rather than recalled.
2. The current value of the same thing wherever it survived. If nothing survived,
   there is no measured repricing and the default to quote stands.
3. Proof that the formula behind the number is unchanged, so the two versions'
   figures are comparable at all. For mana and failure that means the accrual
   formula and its lookup tables: all four are byte-identical between 4.1.2 and
   4.2.6, which is what makes the comparison above a measurement rather than two
   numbers from different worlds.

**Look for a pair the old version treated identically.** In 4.1.2 the Rogue's and the Ranger's rows for this spell were byte-identical. The Rogue kept the spell and the Ranger lost it, so the Rogue's current row shows directly what the repricing would have done to the Ranger's, and a correctly restored Ranger has to match it, which this one does. A pair like that turns a judgement into arithmetic. The mod's suite asserts the equality against the published content pack, so a future core reprice fails a test instead of leaving the restoration stale.

**Where a repricing is only partly measurable, say which half is which.** The mana and failure figures above are measured, but the levels are not: 4.2 moved the Mage's level by 8 and the Rogue's by 1, and no rule says which of those a restored class should follow. Each restored class therefore moves in the same direction by a reasonable amount (the Priest by two levels, the Paladin and the Ranger by one, matching the Rogue), and the mod's README marks those values as judgement calls next to the measured ones.

**Adaptation proper is the last resort**, for when the old value cannot be quoted because the surrounding system no longer has anywhere to put it. Store discounts are this mod's example. A pre-4.2.6 Angband rolled its discount percentages onto an item's own `discount` field, and 4.2.6 removed that field along with the roll, so there is nothing left to write a quoted number into. Restoring the feature took an addition to the engine, the `registry:store` discount-roll hook, rather than a reinterpreted value. The odds are still quoted exactly from Angband v3.0.0; only the place they attach to is new.

**Document whichever of the three applied.** A quoted value, a repriced value and
an adapted value are three different claims, and a restoration that does not say
which one it is making cannot be checked by anybody else.

### 4. One feature, one switch.

Not an "old Angband mode".

Someone who misses store discounts does not necessarily miss anything else, and
bundling five restorations behind one toggle makes them take four changes they
did not ask for. Independent options let people build the game they actually
remember, which is rarely any single historical version.

### 5. Everything off by default.

Enabling the mod changes nothing at all. The player picks features one at a time.

This matters more for restoration than for anything else: a restoration mod is
attractive to exactly the people who are most particular about what the game
should feel like.

## What this pressure-tests

Restoration is also the best available test of whether the mod system is real.

A restored feature cannot be negotiated down. It either works the way it did or
it does not, and the mod cannot cheat by redefining the goal. So each one either
lands, or it finds a missing seam.

The store discounts found one. The current release dropped the `discount` field from the item model along with the discount roll, so a data patch had nothing to attach to and no content mod could work around it. It took a new engine seam, `registry:store`'s discount-roll hook, which any mod can now use.

When a restoration cannot be built with the seams that exist, treat that as a bug report about the seams.

## The mod

[neo-angband-mod-feature-restoration](https://github.com/neostryder/neo-angband-mod-feature-restoration) is the first-party one. Today it carries:

- **Teleport Other** for the Priest, Paladin and Ranger. Older Angband gave this spell to every caster, and the current release keeps it only for the Mage and the Rogue. The restoration is content only: its shape comes from Angband 4.1.2's own `lib/gamedata/class.txt` and its price from the two surviving copies in the current game, which is rule 3 above applied to a repriced axis. The mod's README gives the measurement value by value.
- **Store discounts**: the `mass_produce` discount roll, restored from v3.0.0 source. This one needs code, for the reason above.

Both are off by default. The mod's README names the source of every restored value and says which are measured and which are judgement calls, which makes it a useful reference if you are planning a restoration of your own.

## Candidates people have asked for

Not commitments, just a list of things worth researching:

- **Haggling.** Removed a long time ago and still missed. A large one: it is an
  entire store interaction, not a value.
- **Historical Teleport Other availability**: partly done, see above.
- **Store discounts**: done.

If you want one of these, start by finding the version that had it and reading what it did, before writing any code.

---

**Building one?** Start with [the tutorials](tutorials/README.md); restoration
mods are mostly Tutorial 4 (change a spell) and Tutorial 6 (put it behind a
switch), plus a lot of reading.
