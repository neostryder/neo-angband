# W1 — Adjudicate one reference header's unmatched public functions

You are working in the worktree you were given. `reference/` is the **read-only
oracle** (original Angband 4.2.6). Never modify anything under `reference/`.

## Input

`parity/phase3-2026-07-25/c-api-allowlist.json` lists every function **declared
in a reference header** (so: public API — another translation unit calls it) for
which no port symbol of a matching name could be found. 1148 entries over ~60
headers.

**YOUR HEADER: `<HEADER>`** — adjudicate every entry whose `header` field is that
file. Nothing else.

Matching already tries `snake_case → camelCase` and, where the C's subject
becomes the receiver, the name with a leading `square_` / `mon_` / `obj_` /
`player_` / `do_cmd_` / `get_` / etc. stripped — so `square_isfloor` already
matches `Chunk.isFloor`. An entry reaching you means *that* did not find it.

`status: "unreviewed-mentioned"` means the identifier appears somewhere in the
port but not as a declaration — inlined, a method under another name, or only
named in a comment. `"unreviewed"` means it appears nowhere at all, which is
stronger evidence of a real gap.

## What to do with each entry

Read the C function. Then find its behaviour in the port and rule:

- **PORTED** — the behaviour exists under a different name or shape. Give
  `port: <path>:<line>` and one line on the mapping. This is the common case and
  is a perfectly good answer.
- **INLINED** — no separate port function; the logic is inline at the call
  site(s). Cite one call site.
- **N/A** — the port legitimately has no counterpart. Give the reason, and be
  specific: C memory management, POSIX file I/O, the binary savefile format (the
  port ships a ratified JSON save), Win32/curses terminal plumbing replaced by
  the browser glyph terminal, a C-only build or parser detail. "Different
  architecture" alone is not a reason.
- **MISSING** — the behaviour is absent from the port and should not be. **This
  is a finding.** Give the C citation, what is missing, the player-visible
  effect, and a severity (P0 breaks the game / P1 wrong behaviour in normal play /
  P2 wrong in an edge case or a secondary screen / P3 cosmetic).

Beware the trap this whole phase exists to catch: **a symbol existing is not the
same as the live path reaching it.** If you find the port's counterpart but
nothing calls it, that is `MISSING` with a note, not `PORTED`.

## Method

- **C is the oracle.** Cite `reference/...:line` for every ruling.
- **Verify by re-derivation.** Do not trust a name, a comment, or a test title.
- The generation path has its own helpers in `packages/core/src/gen/util.ts`,
  separate from the runtime ones in `packages/core/src/game/mon-place.ts`. Make
  sure you are reading the one that runs.
- Do not guess. If you cannot determine a ruling, say `UNSURE` with what you
  checked — that is more useful than a confident wrong answer.

## Deliverable

`parity/phase3-2026-07-25/findings/W1-<HEADER-BASENAME>.md`:

1. A table: `C function | C line | verdict | evidence`. **Every entry for your
   header must appear** — do not sample.
2. Then one block per `MISSING`:
   ```
   ### W1-<HEADER>-NNN  <c function>
   ref:      reference/src/<file>:<line>
   port:     <nearest counterpart, or "none">
   missing:  <what the port does not do>
   effect:   <player-visible consequence>
   severity: P0|P1|P2|P3
   confidence: high|medium|low
   ```
3. A closing count: how many PORTED / INLINED / N/A / MISSING / UNSURE.

Adjudication only — do not modify port source files, and do not edit the
allow-list JSON. Commit nothing.
