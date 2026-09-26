# Logs and problem reports

The game keeps two separate things: a log, which it writes whether anyone asked for one or not, and a report, which you make on purpose and decide who sees.

Nothing is uploaded anywhere. There is no server, no telemetry and no consent prompt, and a report is a file on your own computer. The report bundle was built so that an uploader could be added later; [If an uploader is ever added](#if-an-uploader-is-ever-added), at the bottom, covers what that would involve.

## How much a build logs, and why it is not a setting

| the build | level | what that means |
| --- | --- | --- |
| `1.2.3`, a finished release | `warn` | warnings and errors |
| `0.16.0`, any `0.x` pre-release | `info` | plus what the game is doing |
| `0.16.1-edge.2`, a per-commit build | `info` | as above |

The level comes from the game's version (`ENGINE_VERSION`), not from your update channel. The channel only decides which builds to accept next: if you installed a beta and then switched to `stable`, you are still running the beta, so the version is the reliable answer.

While the project is `0.x`, every build logs at `info`. That is correct for now, because `stable` offers nothing before `1.0.0` either. Both change together on their own at `1.0.0`, and `update.test.ts` ties `defaultLogLevel` to `defaultChannel` so one cannot move without the other.

To override it, add `?log=debug` to the address, or press `L` on the report screen, which remembers the choice. The address option is the one to suggest in a support conversation: it beats a stored preference, so it works even on a machine whose settings say otherwise.

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

Open the Escape menu and choose **Report a problem**. The screen lists everything the file will contain before it writes anything. Press `D` to describe the problem in up to three lines, then `ENTER` to write the file.

What goes in:

| | why it is included |
| --- | --- |
| version and build id | "it happens on 0.16.something" does not identify a build |
| platform, window size, **device pixel ratio** | a renderer bug existed that was invisible at a ratio of 1 or 2 |
| the shell (desktop / PWA / tab) | a portable launch cannot self-update and reports `manual` |
| enabled mods, with versions | a mod's patch and a core bug look identical on screen |
| character name, race, class, level, depth | |
| the last 500 log lines | |
| how many lines fell off the top | "the last 2,000 lines" and "the whole session" are the same file |

The home directory is removed from every path, in all three forms it can take: raw, as a `file://` URL, and JSON-escaped. The JSON-escaped form is the one that matters, because every path is JSON-encoded on its way into the log. On Windows they all arrive with doubled backslashes, and a matcher that only knew the first two forms caught none of them.

The log file itself keeps the full paths. It stays on your own machine and belongs to you; the report is what you hand to someone else.

## Where to send it

Once the file is written, the screen offers a tracker for each project and opens the one you choose in your normal browser. `G` is Neo Angband, `C` is the RPGM Tools Discord, and each enabled mod that has a recorded origin gets the next digit. Nothing is uploaded: opening a page does not send the report, and you still attach the file yourself.

Neo Angband and the mods get different addresses, because only one of those projects is this one:

- Neo Angband gets `/issues/new/choose`. Its two templates are known to exist, and choosing between "something is broken" and "does not match Angband" goes a long way toward making a first report readable.
- A mod gets `/issues`, the tracker root. The game cannot tell from inside whether somebody else's repository has issue templates, or has its tracker open at all, and the root address means the same thing in every case.

A mod's origin comes from its install record, which holds the repository pinned (trust on first use) when the mod was installed, and which every later fetch for that mod has had to match. It does not come from the copy of the manifest on disk. If that origin is not a repository the game can address, including a mod imported from a file that declared none, the row says **no repository recorded** and offers no key instead of guessing at a URL. Every address is printed on the screen beneath its row, so nothing opens before you have seen where it goes.

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

`reportText()` already produces everything an uploader would send, as a single string with the home directory removed, so adding a destination means writing one function instead of reworking the report. Three questions would need answers first, and none of them is technical:

- where the report goes, and who can read it;
- what the screen says about that, since it currently promises the opposite in two places (the menu row's hint and the screen's second line), and tests assert both, so those tests would have to be removed on purpose;
- whether consent is asked per report or set once as a setting.
