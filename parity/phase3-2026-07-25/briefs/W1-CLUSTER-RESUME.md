# W1 cluster lane — RESUME an interrupted lane's uncommitted work

The host machine hard-rebooted mid-run and killed the agent that started your
lane. Its work was recovered off disk and committed as a single WIP snapshot on
your branch. **You did not write that code and you must not trust it.**

You are in your own git worktree of `C:\Repositories\neo-angband`. `reference/`
is the **read-only oracle** (Angband 4.2.6). **Never modify anything under
`reference/`.** Never run `prettier`. Never run bare `pnpm test` —
`packages/borg/src/{think,foundation}.test.ts` hang. Target specific test files
with a hard timeout and check the exit code (124 = hang).

## Step 1 — triage the inherited snapshot, before anything else

```bash
git log --oneline -1          # the WIP snapshot
git show HEAD --stat
git show HEAD                 # read every hunk
```

For **every hunk** reach one of three verdicts, and record it:

- **KEEP** — you found the reference C line it implements, it matches, and it is
  backed by a test that FAILS if you revert the hunk. If there is no such test,
  write it. A production change with no failing-without-it test is not KEEP yet.
- **REVERT** — you cannot tie it to a specific line of reference C, or it does
  not match what that line does. Revert it. This is the expected outcome for some
  hunks: the interrupted agent was mid-investigation and some edits were
  exploratory. Reverting is not a failure, it is the correct call.
- **REWORK** — right idea, wrong implementation. Fix it and prove it.

There is no fourth option. "Looks reasonable" is not a verdict. The project has
been burned specifically by accepting plausible-looking parity claims that did
not hold when checked against the C — five out of five reported divergences in a
recent audit were partly wrong — so inherited code gets the same scrutiny a
stranger's pull request would.

Do this triage FIRST and get the suite green before extending the lane. An
inherited broken edit will otherwise be blamed on your own later work.

## Step 2 — finish the lane

Your batch is in your task message. Method:

- Read the reference C function. Read the port's counterpart. Compare behaviour,
  not shape.
- **Never widen a tolerance, never adjust an expectation to make a test pass, and
  never regenerate a baseline from the port.** If the port disagrees with
  upstream, upstream is right by definition — this is an exact-parity port. Core
  keeps ALL warts of the reference C. If upstream has a bug, the port has that
  bug; improvements belong in a bundled mod, never in core.
- A symbol with no port counterpart is a **GAP** only if its absence changes
  behaviour the player can reach. If it is C plumbing (manual memory, a
  `parser`-object API the port replaced with a pure function, a native win32
  front end, a mouse-only context menu), it is **N/A** — say so with the specific
  reason. "Different architecture" is not a reason.
- Every production change needs a test that fails without it. State the mutation.

## Deliverable

1. `parity/phase3-2026-07-25/findings/W1-<LANE>.md`:
   - **an inherited-hunk table first**: file | hunk | KEEP / REVERT / REWORK | the
     `reference/src/*.c:line` that decides it | the test that proves it;
   - then the lane table: C symbol | verdict (PORTED / N/A / GAP) | evidence, for
     **every symbol in your batch**, no sampling;
   - one block per GAP: `ref` / `port` / `what differs` / `effect` / `severity`
     (P0 breaks the game, P1 wrong in normal play, P2 edge case or secondary
     screen, P3 cosmetic) / `fixed: yes|no` + reason;
   - a mutation table: the mutation, which test caught it, and whether the
     pre-existing suite caught it too;
   - a closing count.
2. Run `pnpm build` and the suites for the packages you touched. Report exact
   pass counts and the command you ran.
3. Commit on your branch, on top of the WIP snapshot — do not amend or rebase it,
   it is the recovery record. Do not push.

## Reporting

The main session's context budget is tight. Your final message back must be
TERSE: the inherited-hunk verdict counts, the GAP blocks, the mutation table, the
pass counts, and anything in this brief that turned out to be wrong. No narrative
recap, no restating this brief, no describing files you read. If you found
nothing, say so in one line — that is a fine result and much cheaper to read than
a padded one.
