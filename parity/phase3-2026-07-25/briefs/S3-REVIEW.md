# S-3 review — verify the root-cause diagnosis, then generalise it

You are reviewing another engine's work. `reference/` is the **read-only oracle**
(original Angband 4.2.6). Never modify anything under `reference/`.

Read `parity/phase3-2026-07-25/findings/S3-ROOTCAUSE.md` (in this worktree). It
claims four root causes for a measured divergence in which monsters the port
generates (G = 389–823 on df = 138–209 against a 1000-level compiled-C oracle,
p down to 4.8e-98 at depths 5–20; density and depths 1–4 are clean).

## Ground rules

Every previous stream in this project over-reported and needed two or three
review rounds. The recurring failure was **correct-looking logic that the live
path never reaches**, and the second most common was a claim about the C that
did not survive re-reading it. So:

- **Re-derive every claim from the C yourself.** Open the cited
  `reference/...:line` and check it says what the finding says. Report any
  citation that does not.
- **Trace the live path.** Note that generation has its own placement helpers in
  `packages/core/src/gen/util.ts`, separate from the runtime ones in
  `packages/core/src/game/mon-place.ts`. A claim about the wrong one is wrong.
- **Rule on each RC independently**: CONFIRMED / PARTLY-CONFIRMED (say which
  part) / REFUTED (say why). A refutation is as valuable as a confirmation.
- Judge the claimed **RNG draw-order** consequence of each proposed fix.
  The base game must reproduce the C's stream, so a fix that changes how many
  draws happen, or the order they happen in, is itself a divergence.

Already independently verified by the gate, so do not spend time re-doing them —
but do say if you disagree:

- RC2's C citations are correct: `reference/src/mon-init.c:1588-1589` is
  `f->next = r->friends; r->friends = f;` (head insertion), and `:1534-1535` is
  the same for drops. The C therefore walks these lists in **reverse file order**.
- `get_mon_num` (`packages/core/src/mon/make.ts:156`) is faithful to
  `reference/src/mon-make.c:221`.
- Index alignment, general out-of-depth generation, and unique recurrence *in the
  stats harness* are all cleared.

## The generalisation — this is the most valuable part of the task

RC2 says the port stores `friends`, `friends-base` and `drops` in file order
while the C prepends. If that is true for those three lists, **what else?**

Audit **every** linked-list field the C parsers build with head insertion —
the `x->next = owner->list; owner->list = x;` shape — across all of
`reference/src/init.c`, `obj-init.c`, `mon-init.c`, `p-init.c` and any other
`*-init.c`, then check the port's corresponding array order for each one.
Candidates to check explicitly (not an exhaustive list — find them all):

- monster `blow`, `spell`, `mimic`, `friends`, `friends-base`, `drop`,
  `drop-base`
- object `curse`, `slay`, `brand`, `activation`, `ego` item types and their
  `flags`/`values`
- class `spell`s and books, `magic` realms, `player-flags`
- artifact `slay`/`brand`/`curse`
- pit `flags-req`/`flags-ban`/`mon-base`/`mon-spell-req` and similar lists
- room templates, vaults, dungeon profile room lists
- store `normal`/`always`/`turnover` item lists

For each: does iteration order affect **behaviour** (which entry an RNG gate
applies to, which entry wins a first-match search, the order of appended
description text, the order of drops created)? If it does and the port's order
differs, that is a finding of the same class as RC2 — and it is invisible to the
field-level data test, because that test compares values within a shared ordering
assumption.

## Deliverable

`parity/phase3-2026-07-25/findings/S3-REVIEW.md`:

1. A verdict table: RC | verdict | what you re-derived | any correction.
2. For each confirmed RC, your independent judgement of the proposed fix and its
   RNG draw-order effect, and whether the fix is complete (does it cover every
   call site, including the generation-side helpers?).
3. **A prepend-order audit table**: C list field | C parser file:line | prepends?
   | port storage file:line | port order | order-sensitive behaviour? | verdict.
   Cover every list you found, including the ones that turn out to be fine.
4. Anything RC4 (pit/nest) should look at once RC1–RC3 are fixed, and whether you
   agree the pit logic itself re-derives as faithful.

Review only — do not modify port source files. Commit nothing.
