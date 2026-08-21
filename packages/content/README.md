# @rpgm-tools/neo-angband-content

Angband 4.2.6's gamedata, compiled to the schema-validated pack format
[Neo Angband](https://github.com/neostryder/neo-angband) boots from, plus the
compiler that produced it.

```bash
npm install @rpgm-tools/neo-angband-content
```

`@rpgm-tools/neo-angband-core` is the rules and holds no content: it can roll dice, run
the effect interpreter and read a save, but it cannot generate a populated level
without a pack handed to it. This is that pack.

## The base game is pack zero

The gamedata is not special-cased anywhere. `monster.txt`, `object.txt`,
`terrain.txt` and the rest go through the **same pipeline any mod's content goes
through**, and come out as the same JSON records with the same schema. That is
what makes a total conversion possible by construction rather than by permission:
a mod that replaces every record is doing what the base game already does.

## What is in the tarball

| Path | What it holds |
| --- | --- |
| `pack/` | 45 compiled JSON files: the content itself, which is what most consumers want |
| `dist/` | The compiler: `compileGamedata`, the line parser, and the per-file specs |

```ts
import monsters from "@rpgm-tools/neo-angband-content/pack/monster.json" with { type: "json" };
```

To recompile from upstream's text files, which needs an Angband checkout, not
shipped here:

```ts
import { compileGamedata, gamedataSpecs } from "@rpgm-tools/neo-angband-content";
```

## Exactness is the whole point

The compiler is not a convenient reader. It is checked against upstream's own
parser (`reference/src/parser.c`) directive by directive, and the pack is checked
back against the text it came from: a field the compiler drops silently is the
failure mode that matters, because the game then plays subtly differently with
nothing to see. Those checks are `data-exactness.test.ts` and the
`*.upstream.test.ts` files in `src/`.

## Versioning

The pack moves with the engine and carries the game's version, not Angband's.
`PARITY_BASELINE` in `@rpgm-tools/neo-angband-core` is the upstream release this content
was compiled from and moves independently.

## Licence

Neo Angband keeps Angband's dual licence, as the Angband project asks of its
variants: **GNU GPL v2, or the Angband licence**, at your option. npm can only
carry one SPDX identifier, so the manifest says `GPL-2.0-only`, the more
restrictive of the two. The full text of both is in [LICENSE.md](LICENSE.md).

The gamedata in `pack/` is Angband's, by Ben Harrison, James E. Wilson, Robert A.
Koeneke and the Angband contributors. The compiler and the pack format are by
neostryder / RPGM Tools.
