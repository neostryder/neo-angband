# W1 cluster — adjudicate a residue cluster, then fix what is really wrong

You are in your own git worktree of `C:\Repositories\neo-angband`. `reference/` is
the **read-only oracle** (Angband 4.2.6). **Never modify anything under
`reference/`.** Never run `prettier` (this repo has no local config and would
inherit the parent's and reformat everything). Never run bare `pnpm test` —
`packages/borg/src/{think,foundation}.test.ts` hang. Always target specific files
or packages, with a hard timeout, and check the exit code (124 = hang).

## The rule this brief exists for

**A reported divergence is a LEAD, not a spec.** Read the C yourself before
changing a line. Measured five for five on 2026-07-26, every lane told to verify
found its brief partly wrong, and the correction was the more valuable half. Two
worked examples:

- A brief said `inven_wield`'s object split inserts the remainder BEFORE the
  original. `obj-gear.c:961` puts it AFTER — and the port function being "fixed"
  was actually a faithful port of `wield_all`, whose split goes the OPPOSITE way.
  Following the brief would have broken birth outfitting.
- A `MON_HEAL_KIN` brief listed two divergences. Both were real, and reading the
  C turned up a **third the brief missed, pointing the other way**: the C computes
  the value BEFORE its null-monster guard, so a missing monster still consumes the
  dice draws. Core must KEEP that wart.

So: **look for adjacent divergences in the same function**, and be equally ready
to conclude the port is already right.

## Second rule: watch for over-shared helper bodies

The most productive divergence generator found so far is two upstream functions
that look near-identical, differ in three places, and were collapsed into one
port body — losing every difference at once. If your cluster's C functions share
a shape and the port has ONE function where the C has several, diff the C
siblings against each other line by line and check each difference survives.

## Your cluster

**CLUSTER: <CLUSTER>**

These are C symbols the mechanical W1 pass classified `AREA-WORKED-NO-CANDIDATE`:
the port has work in that area but no symbol whose collapsed name matches. That
is a name-matching result and nothing more.

## Verdicts

For each C symbol, read the C, then find its behaviour in the port and rule:

- **PORTED** — exists under another name/shape. Cite `port: <path>:<line>`.
- **INLINED** — no separate function; logic is inline at the call site(s). Cite one.
- **N/A** — the port legitimately has no counterpart. Be specific: C memory
  management (`*_free`, `*_cleanup`), a C-side singleton/`*_init` the port replaces
  with construction, POSIX file I/O, the binary savefile format (the port ships a
  ratified JSON save), native terminal/graphics/sound plumbing replaced by the
  browser glyph terminal. "Different architecture" alone is NOT a reason.
- **GAP** — the behaviour is absent, or present but **not reached by the live
  path**, and should not be. A symbol existing is not the same as something
  calling it: if you find a counterpart that nothing invokes, that is a GAP.

## Then fix the GAPs

The mandate is **exact parity, including wizard mode and cheat options.** Core
retains ALL warts of the reference C — if upstream has a bug, the port has that
bug. Any improvement belongs in a bundled mod, never in core. Web-UI necessity
and the mod system are the only licensed differences.

For every GAP you fix:

1. Add a comment citing the C: `<file>.c:<line>` and what it guarantees.
2. Add a test that **fails before your change and passes after** — verify this by
   actually reverting the production change, running the test, and recording the
   failure output. A test you did not see fail proves nothing.
3. Prefer a mutation the pre-existing suite does NOT catch, and say so.

If a GAP needs a restructure rather than an edit (a deferred subsystem, a
different data shape), **do not force it** — report it with the reason and leave
it. A fixed divergence traded for a new silent one is a loss.

## Deliverable

1. `parity/phase3-2026-07-25/findings/W1-FIX-<CLUSTER>.md`:
   - a table `C symbol | C line | verdict | evidence` with **every** symbol in
     your cluster, no sampling;
   - one block per GAP: `ref` / `port` / `missing` / `effect` / `severity`
     (P0 breaks the game, P1 wrong in normal play, P2 edge case or secondary
     screen, P3 cosmetic) / `fixed: yes|no|deferred` + reason;
   - a mutation table: for each production change, the mutation you introduced,
     which test caught it, and whether the pre-existing suite caught it too;
   - a closing count of PORTED / INLINED / N/A / GAP-fixed / GAP-deferred.
2. Where you confirmed a PORTED counterpart, **add a one-line citation comment**
   naming the C symbol at the port function, so the next mechanical run matches
   it and this slog is not repeated. That is a durable fix and is expected.
3. Commit on your branch. Run `pnpm build` and the test files you touched plus
   the package suites that own them. Report exact pass counts. Push nothing.
