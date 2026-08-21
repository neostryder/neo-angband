<!--
Thank you - genuinely. A short PR with a test is worth more than a long issue.

Delete any section that does not apply. None of this is a gate; it is the set
of things a reviewer would otherwise have to ask you.
-->

## What this changes

<!-- One or two sentences. -->

## Where the original says so

<!--
For a parity fix, the single most useful line in the whole PR: the file and
line in `reference/src` that this now matches. Ported code cites the C it came
from, and a fix that cannot cite one is usually a fix to the wrong thing.

    reference/src/obj-util.c:412
-->

## How it proves itself

<!--
- [ ] A test that fails without this change. Please check that it does - a test
      that passes either way is the most expensive kind to have written.
- [ ] `pnpm build && pnpm lint && pnpm test` are green.
-->

## Is this core, or a mod?

<!--
The core game is a port: it keeps upstream's warts on purpose. An improvement -
even an obviously good one - belongs in `bug-fixes` or `qol`, which are separate
repositories. If you are not sure, say so here and I will work it out; it is a
recurring and entirely reasonable question, not a mistake.
-->
