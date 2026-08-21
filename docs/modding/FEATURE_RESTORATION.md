# Feature restoration

**Vanilla stays vanilla. Features that Angband has lost along the way can come
back as optional mods.**

This is the clearest single answer to "why does this project exist", so it is
worth stating on its own page.

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

### 3. Respect the game the feature is landing in.

This is the one that catches people, and it caught this project.

Restoring a historical behaviour is **not** the same as pasting a historical data
entry into a modern file. The surrounding system has moved. Classes have been
rebuilt, spell lists reordered, realms swapped, level curves redrawn. A spell
that sat at level 31 in an old class list does not belong at level 31 in a class
whose entire curriculum was rewritten since.

The `feature-restoration` mod's approach to this is worth copying: to place a
removed spell, find a spell that **survived under the same name** into the
current release, measure how far *that* spell moved, and apply the same shift.
Where a class has two such anchors that disagree, say so and give the number as a
range rather than pretending to a precision you do not have. Where a class's
whole realm changed (the Ranger went from arcane to nature), the anchor has to
come from the new realm, not the old one.

"Old level minus a constant" does not hold, and an adaptation that looks
arithmetic is usually the one that is wrong.

**Document the adaptation.** If you changed something to make it fit, that is
part of the restoration, and hiding it makes the mod's claim of faithfulness
false.

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

The store discounts found one. The current release does not merely lack the
discount *roll*: it dropped the `discount` field from the item model
entirely, so there was nothing for a data patch to attach to. That is not
something a content mod can work around; it needed a real engine seam, which is
now `registry:store`'s discount-roll hook, available to any mod. The feature
found the gap, and closing it made the engine more moddable for everybody.

That is the pattern worth repeating: **a restoration that cannot be built with
today's seams is a bug report about the seams.**

## The mod

[neo-angband-mod-feature-restoration](https://github.com/neostryder/neo-angband-mod-feature-restoration)
is the first-party one. Today it carries:

- **Teleport Other** for the Priest, Paladin and Ranger, a spell that older
  Angband gave to every caster and that the current release keeps only for the
  Mage and the Rogue. Content only; the placement research is in the mod's own
  README, worked class by class against the historical spell lists.
- **Store discounts**: the `mass_produce` discount roll, restored from v3.0.0
  source. Code, for the reason above.

Both off by default. Its README carries the full derivation for each, which is
the part actually worth reading if you are planning a restoration of your own.

## Candidates people have asked for

Not commitments, just a list of things worth researching:

- **Haggling.** Removed a long time ago and still missed. A large one: it is an
  entire store interaction, not a value.
- **Historical Teleport Other availability**: partly done, see above.
- **Store discounts**: done.

If you want one of these, the honest first step is not code. It is finding the
version that had it and reading what it actually did.

---

**Building one?** Start with [the tutorials](tutorials/README.md); restoration
mods are mostly Tutorial 4 (change a spell) and Tutorial 6 (put it behind a
switch), plus a lot of reading.
