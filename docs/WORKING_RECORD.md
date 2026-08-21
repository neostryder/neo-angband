# The working record, and why comments cite things you cannot open

Comments in this tree cite documents that are not in it. A few dozen of them,
looking like this:

```
// ... and the null was mismeasured (parity/phase3-2026-07-25/findings/NOISE-FLOOR.md).
// The joining step (MOD_INTEGRATION_PLAN.md Wave 1, W1.1) ...
```

Those files are real, they were real when the comment was written, and they are
not here. This page says where they went and why, so that a citation you cannot
follow is a known thing rather than a loose end.

## What moved

This port was built against the C source with a lot of machinery: dated audit
runs where several models reviewed the same lane independently, the raw logs
underneath them, census tools and their TSV output, briefs, build plans, and
correction punch lists. Together, roughly **220 files and 5.7 MB**, several
times the size of the game's own source.

None of it is secret. It is *construction*, and construction is not the
building. A reader who clones this repository to understand or change the port
is served by the conclusions, not by the transcript of six audit lanes arguing
their way to them. So the working record lives in a private repository, and what
it concluded lives here:

| You want | Read |
|---|---|
| What is deliberately different from 4.2.6, and why | [`parity/DIVERGENCES.md`](../parity/DIVERGENCES.md) |
| What is not ported, and what was judged unnecessary | [`parity/DEFERRALS.md`](../parity/DEFERRALS.md) |
| Every gap that was found and written down | [`parity/PORT_TODO.md`](../parity/PORT_TODO.md) |
| Which upstream C sources each module ports | [`parity/ledger/`](../parity/ledger/) |
| Why the desktop build is the parity bar | [`parity/PLATFORM.md`](../parity/PLATFORM.md) |
| What parity is claimed, and how it is measured | [`PARITY.md`](./PARITY.md) |
| The numbered project decisions | [`PORT_PLAN.md`](./PORT_PLAN.md) |

## What stayed, and why it is the part that matters

The **ledger** stayed. It is 102 machine-readable files naming, per module, the
upstream C files and functions that module ports. A parity claim whose evidence
is unpublished is a claim nobody can check, and that is the one thing this
project cannot afford to ship, so the evidence is here even though the audit
runs that produced it are not.

`PORT_TODO.md` and `DEFERRALS.md` stayed for a plainer reason as well: **112
files in this tree cite them.** A comment pointing at a document the reader has
is provenance; the same comment pointing at nothing is an excuse.

## The citations that are still dangling, and what they mean

A comment citing `parity/phase3-2026-07-25/...`, `parity/audit-2026-07-24/...`,
`docs/PARITY_CLOSURE.md`, `docs/REBASE_RUNBOOK.md`, or one of the
`*_BUILD_PLAN.md` / `*_PLAN.md` files is pointing into the private record. They
were left in place rather than stripped: the sentence around each one is the
finding, and the citation says where it was argued out. Deleting several dozen
of them would have made the tree tidier and each explanation slightly less
trustworthy, which is the wrong trade.

If you are reading such a comment and the sentence does not stand on its own,
that is a defect worth reporting: the citation is meant to be a footnote, not
the argument.
