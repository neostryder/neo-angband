# Make a mod

**Never made a mod before? That is fine.** These six tutorials assume you can
edit a text file and nothing else. The first one takes about five minutes and
changes the game.

You do not need to know TypeScript. You do not need a compiler, a build step, an
account, or a copy of Angband's source. A mod is a folder with a couple of files
in it.

---

## The six tutorials

Each one teaches exactly one idea and ends with something you can see on screen.

| | Tutorial | What you learn | Files |
| --- | --- | --- | --- |
| 1 | [Change one thing](01-tweak-a-value.md) | Editing a value the game already has | 2 |
| 2 | [Add an item](02-add-an-item.md) | Adding something the game has never seen | 2 |
| 3 | [Add a monster](03-add-a-monster.md) | The same move in another file, plus the one gotcha nothing warns you about | 2 |
| 4 | [Change a spell](04-change-a-spell.md) | Reaching into a class, and what a positional path costs | 2 |
| 5 | [Hook behaviour](05-hook-behaviour.md) | Your mod running code — eleven lines of it | 2 |
| 6 | [Add an option](06-add-an-option.md) | Letting the player switch your change on and off | 2 |

Do them in order if you are new. They build on each other, and each one is short
enough to read in full before you type anything.

**These are not snippets.** Every tutorial's finished mod is a real folder in
this repository under `samples/tutorials/`, loaded and checked against the actual
game data on every test run. If a tutorial ever stops working, the build fails
before you find out the hard way.

---

## Why not just edit Angband?

You absolutely can. Angband has been customisable from text files for decades,
and if editing them is working for you, nothing here is trying to talk you out of
it.

Neo Angband is for when you would rather your change be a **portable thing** than
an edit:

- **The base game stays untouched.** Your change is a layer over it, not a
  modification of it.
- **It has an off switch**, and turning it off gives back the unmodified game
  exactly.
- **You share a folder or a repository link**, not a fork and not a patch file.
- **Several mods combine**, from several people, without any of them having to
  know about each other.
- **You can expose settings** so the people using it can tune it without editing
  it.
- **The game can update underneath it** without you re-applying anything.
- **It scales all the way up.** The same system that changes one number can carry
  an entire variant.

That last point is the real one. The spectrum runs from:

> *"I miss this one feature."*

to:

> *"I want to build the next ZAngband."*

and both ends use the same mechanism. Tutorial 1 is the first end. Nothing
structural stands between it and the second — a total conversion is this same
system used at full throttle: depend on the base game, replace what you do not
want, add your own world.

---

## Vanilla stays vanilla

A fair worry about easy modding is that a community ends up with a thousand
personal versions of the game and no shared ground.

That is not what this is for, and the design says so:

- **The base game ships as the shared vanilla target** — the latest official
  Angband release, faithfully, with no mods enabled. That is what an untouched
  install gives you and what the project measures itself against.
- **This project bundles no mods at all.** Not even the author's. Every one of
  them installs the same way yours would.
- **Every mod is a layer you can name, list, and remove.** A game's enabled mods
  and versions are recorded in its diagnostics and written into the character
  dump, so any two people can tell whether they were playing the same thing.

Mods are how you experiment *without* fragmenting the baseline, not instead of
having one.

---

## What would I even mod?

If you want a starting point rather than a blank folder:

- Bring back a feature an older Angband had and a newer one dropped
- Add a monster, or a family of them
- Add an artifact worth descending for
- Write a new spell, or move one to a class that never got it
- Change what the stores stock, or how they price it
- Add a quality-of-life behaviour that has been annoying you for years
- Replace the graphics
- Automate something tedious
- Build a themed content pack — a whole dungeon's worth of one idea
- Try a mechanic nobody has tried, and find out why nobody has
- Rebalance a class you think has always been wrong
- Eventually: your own variant

The [feature restoration](../FEATURE_RESTORATION.md) idea in particular came
straight out of a player conversation, and it turned into a shipped mod.

---

## After the tutorials

Roughly in order of how much you need to know:

1. **[REQUIREMENTS.md](../REQUIREMENTS.md)** — exactly what a mod must provide to
   be installable. Generated from the rules the game actually enforces, so it
   cannot go stale. Run them against your own folder with
   `npx neo-angband-mod-check path/to/your-mod`.
2. **[AUTHORING.md](../AUTHORING.md)** — the shortcuts. `draftRecord` fills in a
   new record from the game's own comparable ones, `checkRecords` names every way
   your data will silently not work, and `ModProject` composes a whole mod through
   the real pipeline before you load it. Read this before writing much by hand.
3. **[The modding hub](../README.md)** — pack anatomy, record composition,
   namespaced fields of your own, and the honest table of what is built today
   versus what is still a design.
4. **[MOD_SEAMS.md](../MOD_SEAMS.md)** — the behaviour hooks in full, and how
   several mods' answers are combined.
5. **[PLUGINS.md](../PLUGINS.md)** — the plugin contract in depth: the capability
   registries, what a plugin can reach, and consent.
6. **[MOD_COMPATIBILITY.md](../MOD_COMPATIBILITY.md)** — what an engine release
   may and may not break, and what to write in `engine`. Read this before
   publishing.
7. **[MOD_REACH.md](../MOD_REACH.md)** — the measured answer to "can a mod
   actually do X". Long, and the place to check a capability claim before you
   build on it.

**Reference documents enumerate; tutorials teach.** If you are stuck on "how do I
start", you want a tutorial. If you are stuck on "what is this field called", you
want the reference.

---

## Read a real mod

The first-party mods are deliberately readable, and they get progressively more
involved:

| Mod | Read it for |
| --- | --- |
| [feature-restoration](https://github.com/neostryder/neo-angband-mod-feature-restoration) | A small mod that is both data and code, with every feature behind its own switch |
| [qol](https://github.com/neostryder/neo-angband-mod-qol) | Behaviour hooks in a shipped mod |
| [bug-fixes](https://github.com/neostryder/neo-angband-mod-bug-fixes) | Many small, independent, individually-switchable changes |
| [neo-linoleum](https://github.com/neostryder/neo-angband-mod-linoleum) | A whole alternative tile engine, and a mod that ships art |
| [borg](https://github.com/neostryder/neo-angband-mod-borg) | A mod that plays the game |

None of them is bundled with the game and none takes a private path in. They
install the way yours does, which is the only way to know that route works.

---

## Stuck?

**[The RPGM Tools Discord](https://discord.gg/YegtwbHTBQ)** — no GitHub account
needed, and "can a mod do X?" is exactly the question worth asking before you
build around a guess.
