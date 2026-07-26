# W1 triage tool

```
node parity/phase3-2026-07-25/tools/w1-triage.mjs [outputDir]
```

Reads `../reports/w1-adjudication-queue.tsv` (1793 C symbols the coverage ledger
could not match to the port) and writes `w1-triage.tsv` beside it.

## What it is for

The queue's "unmatched" verdict is a **name**-matching result, not a behavioural
one, and it badly understates coverage because the port renames on purpose. The
clearest example: `cave-square.c`'s `square_isfloor`, `square_iscloseddoor` and
`square_isstairs` are `Chunk` methods `isFloor`, `isClosedDoor` and `isStairs`
(`packages/core/src/world/chunk.ts:286, :354, :358`). A camelCase transform of
the C name finds none of them; a `square_`-stripped, case-folded,
punctuation-stripped comparison finds all three.

So this tool matches on the **collapsed** name — lowercased, non-alphanumerics
removed — trying the C name both whole and with a leading C namespace prefix
removed (`square_`, `player_`, `obj_`, `do_cmd_`, …), because in the port those
namespaces usually become the class or the module instead of part of the name.

## What it proves, and what it does not

It is a **candidate generator, not an adjudication.** A hit says "there is a
plausibly corresponding declaration, and here is the file" — which is the
evidence a reviewer needs to decide in seconds instead of minutes. It says
nothing about whether the port's version is *correct*.

Verdicts, strongest first:

| verdict | meaning |
|---|---|
| `PORTED-AND-CITED` | a collapsed-name match exists AND the C symbol is named somewhere in the port |
| `CANDIDATE-RENAMED` | a collapsed-name match exists but the C symbol is never named — likely ported, attribution missing |
| `CITED-NO-CANDIDATE` | the C symbol is named in a comment but nothing declares a counterpart — check whether it was deliberately inlined |
| `AREA-WORKED-NO-CANDIDATE` | the C *file* is cited so that area was ported, but this symbol has no candidate |
| `NO-TRACE` | no candidate and no mention of the C file at all |

Only production sources count; a symbol that exists solely in a `.test.ts` is
not ported. When several port files match a collapsed name, `core` is preferred
over `content`, `web` and `borg`, since a borg helper that happens to share a
name is a coincidence rather than the port of an engine symbol.

## Reading the current numbers

Of 1793 queued symbols, 117 get a mechanical candidate and **1676 do not**. That
residue is genuinely the adjudication backlog, and it is dominated by `static` C
helpers (530 engine, 438 ui) — file-local functions that a port is under no
obligation to reproduce one-for-one, and which should be judged as a group per
file rather than individually. The sharp end is **engine, non-static: 322**,
clustered in `effect-handler-general.c` (57), `cave-square.c` (24), `load.c` and
`save.c` (16 each), `datafile.c` (15) and `effect-handler-attack.c` (15).

The tool does not shrink that backlog by itself. What it does is stop a reviewer
from re-deriving, 1793 times, the question "is this just a rename?".

## A durable fix worth considering

Most `CANDIDATE-RENAMED` entries are ports with the C symbol name simply absent
from the docstring — and the codebase already cites C names heavily, just
inconsistently (`world/chunk.ts` cites `square_isrock` and `square_ismineral`
but not `square_isfloor`, three lines apart). Adding the C symbol name to each
port counterpart's docstring would make this queue mechanically resolvable from
then on, and would turn a one-off 1793-item slog into a re-runnable check.
