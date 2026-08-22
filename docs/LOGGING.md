# Logs and problem reports

Two things, and they are deliberately separate: a **log**, which the game writes
whether anyone asked or not, and a **report**, which a player makes on purpose
and decides who sees.

**Nothing is uploaded anywhere.** There is no server, no telemetry and no
consent prompt to get wrong. A report is a file on the player's computer. That is
a decision rather than an unfinished feature. See *If an uploader is ever added*
at the bottom, which is short because the bundle was built so it could be.

## How much a build logs, and why it is not a setting

| the build | level | what that means |
| --- | --- | --- |
| `1.2.3`, a finished release | `warn` | warnings and errors |
| `0.16.0`, any `0.x` pre-release | `info` | plus what the game is doing |
| `0.16.1-edge.2`, a per-commit build | `info` | as above |

The level comes from `ENGINE_VERSION`, not from the player's update channel.
Those look interchangeable and are not: the channel is a preference about which
builds to *accept next*, and somebody who installed a beta and then chose
`stable` is still running the beta. Asking the version means the answer cannot
drift from the thing it describes.

While the project is `0.x` this returns `info` for everything, which is correct
and temporary: `stable` selects nothing before `1.0.0` either. Both facts stop
being true on the same day, by themselves, and `update.test.ts` ties
`defaultLogLevel` to `defaultChannel` so one cannot move without the other.

**To override it:** add `?log=debug` to the address (the thing to say over a
support conversation: it beats a stored preference, so it works on a machine
whose settings say otherwise), or press `L` on the report screen, which
remembers the choice.

## Where the log goes

**Desktop:** `<game folder>/logs/neo-angband-<date>-<time>-<pid>.log`, one file
per launch, the last ten kept. `<game folder>` is the same place your saves are;
for the default folder install that is beside the executable. It is *not*
Electron's own `logs` directory, which lives under the user profile even for a
portable copy, so "send me the logs folder from your game folder" finds
something.

The pid is on the name because two launches can share a second, and the case
that does it is the one most worth reading: the updater starts the new copy the
moment the old one exits.

**Browser and PWA:** there is no filesystem. The last 2,000 lines are held in
memory and go into a report; the console has them too.

A session that writes more than 8 MB stops and says so on the last line, rather
than filling somebody's disk quietly.

## Making a report

Escape menu -> **Report a problem**. The screen lists everything the file will
contain *before* it writes one, then `D` to describe the problem in up to three
lines, `ENTER` to write it.

What goes in:

| | why it earned its place |
| --- | --- |
| version and build id | "it happens on 0.16.something" does not identify a build |
| platform, window size, **device pixel ratio** | a renderer bug existed that was invisible at a ratio of 1 or 2 |
| the shell (desktop / PWA / tab) | a portable launch cannot self-update and reports `manual` |
| enabled mods, with versions | a mod's patch and a core bug look identical on screen |
| character name, race, class, level, depth | |
| the last 500 log lines | |
| how many lines fell off the top | "the last 2,000 lines" and "the whole session" are the same file |

**The home directory is removed** from every path, in all three spellings it
appears in: raw, `file://` URL, and JSON-escaped. The third is the one that
matters: every path reaches the log through the value describer, which JSON-
encodes it, so on Windows they all arrive with doubled backslashes and a matcher
that only knew the first two caught none of them.

The log *file* keeps the full paths. It is on the player's own machine and it is
theirs; the report is the artefact handed to a stranger.

## Where to send it

Once the file is written the screen offers a tracker per project and opens the
chosen one in the player's real browser. `G` is Neo Angband, `C` is the RPGM
Tools Discord, and each enabled mod that has a recorded origin takes the next
digit. Nothing is uploaded: opening a page is not sending a report, and the file
is still attached by hand.

Two rules decide the addresses, and both exist because only one of these projects
is this one:

- **Neo Angband gets `/issues/new/choose`.** Its two templates are known to
  exist, and choosing between "something is broken" and "does not match Angband"
  is most of what makes a first report readable.
- **A mod gets `/issues`, the tracker root.** Whether somebody else's repository
  has issue templates, or has its tracker open at all, is not knowable from
  inside the game, so the address that means the same thing in every case is the
  one used.

A mod's origin is read from its **install record** - the repository
trust-on-first-use pinned when it was installed, which every later fetch for
that mod has had to match - and not from the copy of its manifest on disk. Where
that origin is not a repository the game can address, including a mod imported
from a file that declared none, the row says **no repository recorded** and
offers no key rather than guessing at a URL. Every address is printed on the
screen beneath its row, so nothing opens that the player has not read first.

## For contributors: writing a log line

```ts
import { log } from "./logging";

log.warn("mods", `"${id}" is enabled but its plugin is gone`);
log.error("save", "could not write the character", err);
```

The first argument is a short, stable **area** (`update`, `mods`, `save`,
`mod:<id>`). An `Error` passed as the third argument keeps its name, message and
stack: the generic object path would render every `Error` as `{}`, which is the
least useful thing a log can say about a failure.

`no-console` is an error in `packages/web/src` and `packages/desktop/src`. It is
deliberately **not** on in `cli`, `linoleum` or `content`: there, console output
is the program's output: a converter printing its license notes, upstream's own
`list_saves`, and routing it through a logger would timestamp a report and hide
it behind a level. The three files that legitimately reach for `console` carry a
per-site disable naming why.

## If an uploader is ever added

`reportText()` already produces the whole of what one would send, as a single
string, with the home directory removed. Wiring a destination is a function, not
a rewrite. Three things would have to be settled first, and none of them is
technical:

- where it goes, and who can read it;
- what the screen says about that, given it currently promises the opposite in
  two places: the menu row's hint and the screen's second line, both of which
  are asserted by tests that would have to be deleted deliberately;
- whether consent is per-report or a setting.
