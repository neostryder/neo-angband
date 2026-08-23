# Releasing the npm packages

Three packages go to the public npm registry:

| Package | What it is |
| --- | --- |
| [`@rpgm-tools/neo-angband-core`](https://www.npmjs.com/package/@rpgm-tools/neo-angband-core) | the headless engine |
| [`@rpgm-tools/neo-angband-mod-sdk`](https://www.npmjs.com/package/@rpgm-tools/neo-angband-mod-sdk) | manifest schema, load-order resolver, record composition |
| [`@rpgm-tools/neo-angband-content`](https://www.npmjs.com/package/@rpgm-tools/neo-angband-content) | Angband 4.2.6 gamedata compiled to the pack format |

Everything else in `packages/` stays private: `web`, `desktop`, `cli` and `mcp`
are applications, and `linoleum` is a build-time tool with no consumer outside
this repository.

**The list is derived, not written here.** A package is publishable exactly when
npm would publish it, which is when its manifest does not carry `private: true`.
`tools/publishable.mjs` is the one place that says so, and the release workflow,
`tools/check-npm-package.mjs` and `packages/core/src/npm-publish.test.ts` all read
it. Making the next package publishable is one deleted field, not four edits.

The scope is `@rpgm-tools` because Neo Angband is an RPGM Tools project, and the
package names carry the product as a prefix so that `rpgm-tools-forge` can publish
its own `core` one day without a collision.

## The one thing to understand about npm

**npm does not watch this repository.** A package sits at whatever version was last
*pushed* to the registry; `master` moving does not move it, and there is no setting
that makes npm follow a branch or a tag. Every update is a push, and it is
irreversible: `npm unpublish` is refused after 72 hours, and a version number can
never be reused even inside that window.

So the push is automated off a git tag, and nothing else does it:

```bash
git tag v0.28.1 && git push origin master v0.28.1
```

> ### `git push origin master` is NOT how this repository publishes
>
> That line is the npm trigger and it is written the way it would be in a normal
> repository. This one is not normal, and the difference matters before anybody
> types it:
>
> **The public `master` is rooted in a single squashed commit**, `ea5d5b3e4`,
> *"Squash: curated tree on top of angband/angband"*, whose parent is upstream
> Angband's own `dc40ec9e0` (`4.2.6-173`) and which `v0.20.0` points at. Public
> commits are stacked on top of it one at a time by `tools/publish.mjs` (see
> **Publishing** below), so the public history grows - but it begins there, and
> the pre-squash development history, over a thousand commits, has never been
> pushed and is not meant to be. What the public repository holds is a curated
> *tree* and the work replayed on top of it, never this repository's own
> *history*.
>
> **Git will stop you, once.** The two histories have diverged, so a plain
> `git push origin master` is rejected as a non-fast-forward. That rejection is
> the last line of defence, and the obvious next move, reaching for `--force`,
> is the one that publishes everything the squash was made to curate. Do not.
>
> Publishing therefore means building the next public commits and pushing
> *those*, not fast-forwarding this branch. `tools/publish.mjs` does it; the
> procedure is **Publishing**, immediately below.

## Publishing

**Changed 2026-08-20: the public history now takes one commit per local commit.**
Publishing used to squash everything since the last release into a single public
commit. It no longer does: each local commit is replayed as its own public
commit, in order, with its own message. A reader of the public repository sees an
ordinary git history of the work, in the steps it was actually done in, and a
push is no longer something that has to wait for a release.

What has *not* changed is the thing the squash was for: the pre-squash
development history, over a thousand commits, still never travels, because
nothing is ever fast-forwarded from this branch.

```bash
node tools/publish.mjs           # what would be published; builds nothing
node tools/publish.mjs --build   # build the commits, print the tip, push nothing
node tools/publish.mjs --push    # build and push to origin master
```

How it works, and why it is not `cherry-pick`:

- **Each local commit's TREE is republished verbatim**, with `git commit-tree`,
  parented on the public commit built before it. Nothing is checked out and no
  patch is applied, so there is no conflict to resolve and the published tree at
  every step is byte for byte the tree this repository had at that commit. A
  cherry-pick would have to touch the working tree and could conflict; this
  cannot.
- **The anchor is found by tree, not by message or date.** The newest local
  commit whose tree equals `origin/master`'s tree is the one already published;
  everything after it is what has not been. If no local commit has that tree the
  script refuses, because the two sides have drifted in a way it must not guess
  at. Resolve that by hand, and never with `--force`.
- **It is a fast-forward.** The first new commit's parent *is* `origin/master`,
  so the push needs no force. If git rejects it, something else moved: re-fetch,
  re-run, never `--force`.
- **It verifies every step**, not just the last: each built commit must carry its
  source commit's tree, and the built tip's tree must equal `master^{tree}`.
- **It authors as the pseudonym.** `git -c user.name=...` is *not* read by
  `commit-tree`, so the script sets `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME` and
  the emails in the environment. Author dates are carried across, so the public
  history keeps the spacing the work had.
- **A dirty tree is refused**, because the tree published would then not be the
  tree anybody tested.

### Tagging a release

A release is a tag on the public tip, and it is a separate step from publishing:

```bash
node tools/publish.mjs --push
git fetch origin
git tag v0.28.1 origin/master && git push origin v0.28.1
```

Tag `origin/master` after the push rather than a local commit: the local commit
is not in the public history, and a tag pointing at one would name an object the
public repository does not have.

### The changelog is the release notes

The public repository is read by people who cannot see this history, so
`CHANGELOG.md` is the only account of what changed. Every pushed tag carries a
curated section: what a player gets, what a mod author gets, what broke. Written
for someone who has never read this file.

### The `early` channel needs nothing

`edge.yml` already runs on every push to `master` and publishes a prerelease
tagged `v<next>-edge.<n>` (numbered by `github.run_number`, so a curated history
cannot confuse it), deleting the previous one. Pushing the release commit
therefore refreshes the early channel by itself: the `early` channel tracks the
newest commit on `master`, which is what it is for.

`.github/workflows/publish-npm.yml` then builds, verifies the tarballs, checks the
tag agrees with both `package.json` versions, and publishes. A version already on
the registry is skipped rather than retried, so re-running a job that
half-published finishes the rest.

## There is no token, and that is deliberate

Authentication is **trusted publishing**: npm is told, once per package, that this
repository's `publish-npm.yml` may publish it, and the npm CLI proves it is that
workflow using a short-lived OIDC identity token that GitHub mints for the job.
No secret is stored in this repository, so there is none to leak, none to rotate,
and none to discover has expired at the worst possible moment.

This replaces the granular-access-token setup this document used to describe.
npm's [2026-07-08 changelog](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)
stops 2FA-bypass tokens from bypassing 2FA for account changes in **early August
2026**, and stops them publishing at all in **January 2027**. A token-based
release pipeline set up today would have needed rebuilding within months.

## First-time setup

Once, by hand. Two accounts things and then one settings page per package.

1. **An npm account**, done: `neostryder`. The account name is public and appears
   as the publisher on every package page.
2. **Two-factor authentication.** Profile -> Account -> Two-Factor Authentication.
   Required to publish by hand, which step 4 needs.
3. **The organisation**, done: `rpgm-tools`. A scope that is not your username has
   to be an organisation, and it is **free** for public packages; the paid tier is
   only for private ones.
4. **Publish each package once, by hand.** This is the part that cannot be
   automated away, and it is worth knowing why: a trusted publisher is configured
   on a package's settings page, and a package that has never been published has no
   settings page. So version one goes up from your machine.

   **Done, all three.** `core` and `mod-sdk` went up at `0.10.0`;
   `content` at `0.11.0` on 2026-08-01. Nothing here is outstanding, and it only
   comes back if a fourth package becomes publishable.

   **Do it BEFORE tagging, not after.** `tools/publishable.mjs` returns the list
   sorted, so a new package early in the alphabet is the first one the publish job
   reaches, so it would hit the never-published guard and exit before publishing
   anything after it. A tag is not wasted (re-running the job skips whatever
   already went up), but the release would stop on its first step for no reason.

   ```bash
   pnpm build && pnpm check:npm
   ```

   ```bash
   npm login
   ```

   ```bash
   cd packages/content && npm publish --access public
   ```

   `npm publish` opens a browser for the 2FA prompt. A hand publish carries no
   provenance attestation: provenance can only be generated by CI, so the first
   version of each package shows no "Built and signed on GitHub Actions" badge and
   every later one does.

   Check it with `npm publish --dry-run --access public` first if you want to see
   the file list; on 2026-08-01 that was 113 files, 298.3 kB packed, 2.3 MB unpacked.

5. **Configure the trusted publisher, per package.** npmjs.com -> the package ->
   Settings -> Trusted Publisher -> GitHub Actions:

   | Field | Value |
   | --- | --- |
   | Organization or user | `neostryder` |
   | Repository | `neo-angband` |
   | Workflow filename | `publish-npm.yml` |
   | Environment | *(leave empty)* |
   | Allowed actions | `npm publish` |

   Same five values for every package: core and mod-sdk already carry them, so
   `content` is a copy of what is on their settings pages.

   The workflow filename is the **filename only**, not a path. npm does not verify
   any of this when you save it: a typo shows up as a failed publish months later,
   so re-read the row before saving.

6. **Prove it before trusting it.** Actions -> publish-npm -> Run workflow, with
   *Pack and check, publish nothing* left ticked. That packs, extracts and imports
   both tarballs and prints what it would publish, without needing the publisher to
   be configured at all. Then bump the version, tag, and push.

No author details are needed beyond what is already in the manifests: `author` is
`neostryder (RPGM Tools)`, with **no email address**, deliberately: npm shows the
publishing account and that is enough.

## Never `git push --tags`, and never `--follow-tags`

Push the one tag you just made, by name, and only the tag, since
`master` is published by `tools/publish.mjs` and not by this branch:

```bash
git push origin v0.28.1
```

This repository's history **descends from Angband's own**, so every upstream tag
- `2.0alpha`, `4.2.6`, and 1,400-odd `4.2.1-190-g5c16b9e7`-style development tags
- names a commit that really is an ancestor of `master`. They travelled to the
fork with the history, and they are on it now. Measured 2026-08-21: `origin`
carries 1,450 tags, of which 6 are this project's own. So the tag list is not the
release list, and the Releases page is the only place that is.

They were deleted from the remote on 2026-08-02 and the deletion did not hold.
Both `--tags` and `--follow-tags` put every one of them straight back, the second
silently, because "annotated tags reachable from the ref being pushed" is exactly
what they are - which is why neither is ever used here, and why a push names the
one tag it means. A tag-to-object-id list was taken before that deletion and is
kept outside this repository, and upstream Angband has every one of them
regardless, so clearing them again is undoable rather than irreversible.

## Give the version its own CHANGELOG heading

**Before tagging, move the Unreleased entries under a `## [x.y.z]` heading.** The
file's preamble has always said so; it had never once been done, and the cost
came due at 0.19.0.

A GitHub release body caps at **125,000 characters**, and the release notes are
cut from the changelog so that there is one account of a release rather than two
that drift. Every entry since 0.14.0 had accumulated in a single `## [Unreleased]`
section, so the body the release job composed grew with each release instead of
being one release's worth. At 0.19.0 it reached 126,288 characters. All three
desktop builds, the macOS bundle and the site zip were made, and then the last
step failed by 1,288 characters, 1% over.

Two things came out of that, and only the first is the fix:

- **The heading.** `## [0.19.0] - 2026-08-11`, with 0.18.0 and everything before
  it collected under `## [0.18.0 and earlier]` rather than being invented into
  sections nobody can now reconstruct. `release-notes.test.ts` fails when the
  section a release would cut is too long to send, so this cannot go unnoticed
  again at the one moment it is expensive.
- **The fallback.** `tools/changelog-section.mjs --max-chars=N` fits the section
  to a budget, cutting on a blank line and linking to the full file. The release
  workflow measures its own preamble and hands over what is left, so nothing here
  has a length written down that could go stale. A release should degrade rather
  than die after the artifacts are already built, the same argument the tool
  already made about a *missing* changelog entry, which had simply never been
  applied to a section that was too long.

## Bumping a version

One command, and it is the only supported way:

```bash
node tools/version.mjs set minor
```

Fourteen files state the project version: every `packages/*/package.json`, the
workspace root, `ENGINE_VERSION`, `LINOLEUM_TOOLS_VERSION`, an example output in
core's README, the CHANGELOG's Unreleased summary, and the example tag on this
very page. That last one was enforced by `version-sync.test.ts` long before the
tool maintained it, so every bump broke CI until somebody hand-edited the
runbook; a check whose subject the tool does not own is a chore wearing a test's
clothes. Editing them by hand is how
CHANGELOG.md came to greet every reader with `0.10.0` while every manifest said
`0.11.0`. Run `node tools/version.mjs` with no arguments to print all fourteen and
their values; it exits non-zero on any disagreement, and
`packages/core/src/version-sync.test.ts` runs the same check in CI.

The package manifests are **discovered** by scanning `packages/`, not listed, so a
new package is covered the day it is created. A test asserts the discovery still
finds every manifest on disk: a scan that quietly stopped working would report the
same clean green as one that worked.

### Which number

**Semver, and the tool refuses anything that is not one of the three successors.**
From `0.15.2` the only legal next versions are `0.15.3`, `0.16.0` and `1.0.0`;
a typo, a skipped minor or a number that goes backwards is rejected with the three
alternatives printed. There are **two consumers** and either one can force the
increment: somebody depending on the published packages, and somebody playing the
game on `beta`.

| Increment | When | Examples from this project |
| --- | --- | --- |
| **PATCH** | nothing either consumer can observe: a fix behind the same API that no tester would be told about | a build-config correction, a test-only fix, a typo in a comment |
| **MINOR** | anything a package consumer can observe: a new export, a removed one, a changed signature, new gamedata | adding the `./pack` subpath to `content`; a new `ModHooks` seam; renaming a core export |
| **MINOR** | **anything a beta tester should receive**: a fix or change worth telling somebody about | the ghost-residue renderer fix; the extractor naming the wrong `tar` |
| **MAJOR** | reserved | see below |

**The second MINOR row is a policy, not a workaround.** Patches do reach `beta`:
the channel filters on the pre-release *flag*, so a published `0.16.1` is
offered to a tester on `0.16.0` exactly like a `0.17.0` would be, and
`update.test.ts` asserts it. The rule exists because a version number is the only
thing a tester can quote back at you. "It happens on 0.17.0" identifies a build;
"it happens on 0.16.something" does not, and a run of patches turns a bug report
into an archaeology exercise. So the question to ask before bumping is *would I
tell a tester about this*, and if the answer is yes the number gets a new minor
whatever the diff looks like.

MINOR carries breaking changes on purpose. That is semver's own rule for a `0.x`
line: `0.x` makes no compatibility promise, and it is why this project can rename
an engine export in a minor release. `1.0.0` is reserved for the game's public
release, so nothing reaches it by routine bumping; the tool refuses `major` unless
you pass `--release`, which is a decision and not a version bump.

**Every package moves together, at the game's version**, including the ones that
did not change. A consumer resolving `@rpgm-tools/neo-angband-core@0.12.0` and
`@rpgm-tools/neo-angband-content@0.12.0` gets an engine and a pack that were built
and tested against each other; independent per-package versions would make that
something to look up rather than something to read.

A version already on the registry is skipped by the publish job, so a package that
happened to be published early (`content` went up at `0.11.0` by hand) simply has
no `0.12.0` gap to fill. Its next release is the next tag, like everything else.

Each mod carries its own version and moves on its own schedule. A mod whose
released tag is iterated takes a MINOR bump rather than a patch: a published tag
is what a player's install is pinned to, and moving it makes an installed copy
disagree with its own version number.

## CI plays the game, because a green suite does not mean a playable one

`node tools/play-smoke.mjs` boots the built desktop shell over the Chrome
DevTools Protocol and plays a player's first minute: title, (N)ew game, a random
character, the character sheet, the town, a staircase, the dungeon, the inventory
and knowledge screens. The `play` job in `ci.yml` runs it on every push, under
`xvfb-run`, against the **production** bundle.

It exists because of a specific failure. On 2026-08-06 the birth preview began
reading two `GameState` fields it was never given; the hand-built partial state is
cast with `as unknown as GameState`, so the compiler said nothing, and (N)ew game
threw on the first keypress **for five days on the early channel, past a green
suite and green CI**. All 46 birth tests omit `opts.deps`, and `buildPreview`
returns before constructing the state when deps are absent, so the one path that
builds a `GameState` was never executed by anything. No unit test could have
caught it; the suite was green *because* it did not go there.

**The assertion that matters is not "no exceptions".** A game that draws its title
screen and then ignores every keystroke throws nothing, and a smoke test watching
only for errors would pass it: a green light over a dead game. So the tool also
requires the framebuffer to CHANGE at each step. That guard is only meaningful
because the screen is otherwise static: measured, six consecutive frames on both
the title screen and the town are byte-identical with no input. Verified by
running it with input dispatch disabled, which fails at step 1 with
*"the game is running but not responding to input"*.

Run it locally before cutting a release, after `pnpm --dir packages/web bundle`
and the desktop build. Frames land in `smoke-shots/`; the CI job uploads them as
an artifact on success and failure alike, so a failing hash says which step
stopped and the PNG says what was on screen when it did.

## The GitHub Release is always a draft, and that never changes

Pushing the tag also starts `.github/workflows/release.yml`, which builds the
desktop apps and the web bundle and attaches them to a **draft** release. The
draft is not a pre-1.0 precaution and it does not go away at `1.0.0`: publishing
is deliberately the one step no workflow performs, because the artifacts are
downloadable from the draft, so the last gate before a release reaches anyone is
somebody actually running one. Download a build, play it, then press publish.

**Draft and pre-release are different claims and the workflow makes both.**

| | means | who sees it | ends at |
|---|---|---|---|
| Draft | nobody has pressed publish | maintainers only | when you publish |
| Pre-release | this is not the stable build | everybody | `1.0.0` |

`--prerelease` is passed for any tag matching `0.*`. Without it, publishing marks
the release *Latest*, which is what the repository sidebar, the releases API and
every "download the latest" link follow, so an alpha would present itself as the
stable build. The condition is on the version, so the flag stops applying by
itself at `1.0.0`; there is nothing to remember.

If the build is wrong, delete the draft and its assets, fix, and re-run the
workflow against the same tag: it updates a draft in place rather than failing
on "already exists". Once published, that stops being true: a published release
is a URL other people have.

### Publishing is what turns the in-game updater on

**The game's (U)pdate row cannot see a draft**, and that is the intended
behaviour rather than a limitation: a draft is a release nobody has approved, and
`packages/web/src/update.ts` filters `draft: true` even when an authenticated
token would have shown it. So a build sits inert until you press publish, and
then every existing install learns about it on its next launch.

Three properties of a release the updater depends on. All three are produced by
the normal path, so this is a list of things not to "tidy up":

| what | why |
|---|---|
| the `.zip` / `.tar.gz` artifacts | the updater swaps a folder, so it wants the archive that *is* the folder, never the dmg, the NSIS exe or the deb |
| the architecture in every macOS name | `pickAsset` matches `-arm64-mac.zip` / `-x64-mac.zip`; an unlabelled file is read as pre-0.17.0 Intel |
| GitHub's own `digest` field | the download is refused unless its SHA-256 matches. Nothing extra is published: the API reports this per asset, but an asset re-uploaded by hand gets a new digest, so re-run the workflow rather than dragging a file in |

`--prerelease` does **not** hide a release from the updater. Every 0.x is one, so
hiding them would mean the feature never worked before 1.0; the version
comparison is what decides, not the label.

### Publishing also announces it on Discord

`.github/workflows/discord-announce.yml` listens for the same `published`
event and posts to the RPGM Tools Discord's Neo Angband announcements forum,
via `.github/scripts/discord-announce.mjs`. It skips `early` channel tags the
same way `release.yml` excludes them from drafting, but every real release
gets announced regardless of version-bump size - patch, minor and major all
post. The post body is the matching `CHANGELOG.md` heading, so there is one account of
what changed rather than a second one written for Discord. Each first-party
mod repository carries the same script and workflow, triggered on its own tag
push instead, since a mod's tag has no separate draft/publish step.

### The three channels, and why `draft` is not one of them

The update screen offers `stable`, `beta` and `early`, and they are **inclusive
downward**: `beta` sees stable releases too, `early` sees everything. A player
on beta must still be offered `1.0.0` when it ships.

| channel | what it selects | produced by |
|---|---|---|
| `stable` | published, not flagged pre-release | you, pressing publish on a `1.x` tag |
| `beta` | the above, plus pre-releases, every `0.x` | you, pressing publish |
| `early` | the above, plus per-commit builds | `edge.yml`, automatically |

**A draft cannot be a channel.** GitHub hides drafts from unauthenticated
callers, so a player's game cannot see one at all; the only way to change that
would be to ship a credential inside the game. `beta` is the visible
"published but not final" state GitHub actually provides, and drafts stay what
they are: a staging area nobody else can reach.

While the engine is `0.x` **`stable` selects nothing**, because every release is
flagged pre-release. `defaultChannel()` therefore starts new installs on `beta`
and switches to `stable` on its own at `1.0.0`. A default of `stable` today
would mean a fresh install never offers an update and never explains why.

### A check that FAILED is not a check that found nothing

The game asks GitHub once at boot and again whenever the player opens the update
screen, and those two requests can end four ways: nothing newer, GitHub
unreachable, GitHub refusing, GitHub too slow. `checkForUpdate` returns
`UpdateCheck`: `{ ok: true, update }` or `{ ok: false, reason }`, precisely so
the screen can tell the first apart from the other three.

It used to return `AvailableUpdate | null`, and the screen read a null as
currency: **"This is the newest build on your channel"**, printed over a check
that had timed out or never left the machine. The check ran once, at boot, so a
transient failure at launch was a confident wrong answer for the whole session,
with no way to ask again short of restarting the game. When triaging "the
updater says there is nothing", that sentence is now a real claim: it means
GitHub answered.

The one to keep in mind when you touch either half:

- **The boot check races startup.** It is issued during page load, alongside mod
  loading and tile decoding, and its six-second abort runs on wall-clock time
  whether or not the main thread was free to read a response GitHub already
  sent. A big install can lose a check it won. Opening the update screen asks
  again for exactly this reason, and ENTER on a failed check asks a third time.
- **403 and 429 are the rate limit,** not a permissions problem. The game ships
  no credential on purpose, so it gets the unauthenticated sixty-an-hour budget
  shared with everything else on that address. The screen says so in those words,
  because "403" reads as something the player did wrong.
- **The title screen no longer waits for it.** The first `api.github.com` request
  a fresh process makes measured **6.1s** on the shipped Windows build; every
  later one in the same process took 2-5ms. The title used to await the answer
  outright, so that whole cold cost was dead air on the launch screen. It now
  waits `TITLE_CHECK_WAIT_MS` (400ms) and paints regardless, and the answer, if
  it arrives late, lights the shimmer on the `(U)pdate` row that is already
  there. This is safe under the desktop shell **only because** `canUpdate` reads
  `updateHow` rather than the answer, so no row moves. In a browser the row's
  presence really does depend on the answer, and there the probe asks the
  service worker, not the network, so it is not a wait worth bounding. If you
  ever make the desktop row conditional on the check, this bound has to go with
  it.

### `early`: a release per commit, and only ever one

`edge.yml` builds master on every push and publishes it as a pre-release tagged
`v<next-patch>-edge.<run>`, e.g. `v0.16.1-edge.42`. Three consequences worth
knowing before touching any of it:

- **It creates real tags.** The updater orders builds by semver and takes the
  version from the tag, so a fixed rolling tag would give it nothing to compare.
  `release.yml` and `publish-npm.yml` both exclude `!v*-edge.*` for that reason:
  without the exclusion every commit would draft a release *and* publish npm
  packages, and an npm version cannot be reused once published.
- **The patch is bumped before the suffix.** A prerelease sorts *below* its own
  triple, so `0.16.0-edge.1` would be older than the `0.16.0` already installed
  and would never be offered. `0.16.1-edge.1` sits above `0.16.0` and below both
  `0.16.1` and `0.17.0`, which is what an unreleased build off master is.
- **The previous edge release is deleted, tag and all**, after the new one
  exists. Keeping them would mean a release and a tag per commit forever, and
  there is nothing to roll back to: an edge build is not a version anyone
  promised to support.

Nothing about `early` touches the release path above. It stamps the version into
the working tree on the runner and throws it away; no commit, no changelog, no
npm.

## If the release changes the save format

`SAVE_VERSION` in `packages/core/src/session/save.ts` is not a version number you
bump: it is a **promise you take on.** Raising it obliges the same commit to add
the step that reads the version below it, in
`packages/core/src/session/save-migrate.ts`:

The current format is version 7, so raising it to 8 means writing `V7_TO_V8` and
appending it to the list. The shape is the same every time:

```ts
const V7_TO_V8: SaveMigration = {
  from: 7,
  to: 8,
  summary: "one line, present tense, for the changelog and the player's message",
  step(save, ids, notes) { /* ... */ save.version = 8; return save; },
};
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  V1_TO_V2, V2_TO_V3, V3_TO_V4, V4_TO_V5, V5_TO_V6, V6_TO_V7, V7_TO_V8,
];
```

Forget it and `save-migrate.test.ts` fails, naming the step it wants. That check
exists because the alternative shipped for three versions: `loadGame` threw, the
web boot caught it, and a player whose character was completely intact was told
*"Could not read the save; starting a new game"*: in a permadeath game, the
worst sentence the software can produce. It then autosaved over the slot.

Three rules for a step:

- **It may not throw.** An id the running pack cannot resolve costs that one
  entity and adds a line to `notes`, which the player is shown. Refusing the
  whole save to protect one item is the wrong trade.
- **It moves exactly one version.** Version 1 reaches version 5 by running four
  steps, each written against the format immediately before it, so nobody has to
  remember version 1 when designing version 5.
- **Add a round-trip case** to `save-migrate.test.ts`. The tests there work by
  walking a real save *backwards* into the old shape and migrating it forward
  again; that is what catches a step that converts objects in the pack but not
  the ones a monster is carrying.

## Why the tarball is checked and not just the source

`node tools/check-npm-package.mjs` packs each package, extracts it into a directory
that is a consumer: an empty project with the tarball as its only dependency, and
imports every declared subpath **by bare specifier**, with plain Node.

That is not ceremony. It has now caught two different ways a published package can
be broken while everything in the repository says it is fine.

**Extensionless specifiers.** On 2026-07-31, with all 6655 tests passing, the
engine's emitted JavaScript held **4612 extensionless relative import specifiers**,
`export * from "./rng"`, because tsc emits specifiers verbatim and the source was
written for `moduleResolution: "bundler"`. Vite resolves those. Node does not. The
published engine would have been unimportable by anyone not using a bundler, and
nothing in the repository could have noticed, because vitest runs through Vite too.
So: every relative import in a published package carries an explicit `.js`
(`packages/core/src/npm-publish.test.ts` fails if one loses it, and
`packages/core/scripts/codegen-lists.mjs` emits it).

**Shipped but unreachable.** `content@0.11.0` shipped `pack/`: 45 files, 2.0 of its
2.3 MB, and declared no `exports` subpath for it. An exports map *encapsulates* a
package: an undeclared subpath is refused, not merely undocumented. So the one thing
that package is published for threw `ERR_PACKAGE_PATH_NOT_EXPORTED` at every
consumer, and a green CI, a passing tarball check and a successful publish all
agreed it was fine. The tarball check missed it because it resolved each target path
itself and imported the file: **a file URL bypasses the exports map**, so it was
answering "does this file load" when the question is "can a consumer reach it". Two
things came out of that and both are permanent:

- resolution goes through a real `node_modules` by bare specifier, so the exports
  map is exercised rather than stepped around;
- any top-level directory in the tarball that no subpath reaches is a failure
  (`bin` counts as reached, `src` is exempt: it ships so the `.js.map` files
  resolve, and a debugger reads it by path).

## If a publish fails

- **`ENEEDAUTH`**: usually not a permissions problem at all. Either npm is older
  than 11.5.1 (it silently stops trying OIDC and looks for a token that does not
  exist; the workflow asserts the version to turn this into a clear failure), or
  the package has no trusted publisher configured yet.
- **`E403` on a package that does exist**: the trusted publisher's repository,
  workflow filename or environment does not match this job. npm never validated
  what was typed into that form; re-read it against the table in step 5.
- **"has never been published"**: the workflow's own error, not npm's. Step 4 has
  not been done for that package.
- **`E402 payment required`**: the scope is being treated as private. Every
  manifest sets `publishConfig.access: "public"`; if it still happens, the
  organisation was created as a paid private org.
- **A published package 404s to everyone else**: it went up as *restricted*, which
  reads exactly like "not published" from an anonymous `npm view` or a `curl` to
  `registry.npmjs.org`. Check with `npm access get status <package>` and fix with
  `npm access set status=public <package>`.
- **tag/version mismatch**: the job fails before publishing anything. Fix the
  version with `node tools/version.mjs set <v>`, delete the tag
  (`git tag -d v0.16.0 && git push --delete origin v0.16.0`), re-tag.

## The mod repositories are released separately

The game's tag publishes the npm packages. It does **not** touch the mods, and
they are not on npm at all: a mod is distributed as a FOLDER the game fetches, so npm
is not in that path. Releasing one is:

1. `npm run verify` in the mod repo: typecheck, tests, and a check that the committed
   `plugin.js` is a current build of its source.
2. Commit, then tag (the mod's own version, e.g. `v0.13.0`) and push the tag.
3. **Nothing to do in the game repository.** This step used to be "re-fetch every
   file at the tag, hash it, and put the digests in `RECOMMENDED_MODS`" - that
   catalogue shipped inside the build and is gone. The game discovers the mod from
   its own repository, so a released tag is reachable by every build already out
   there the moment it is pushed. `mods/registry.json` only needs touching when a
   NEW mod repository joins the curated list.
4. **Check it from outside**, because nothing in this repository can:
   `MOD_CANARY=1 pnpm --dir packages/web exec vitest run src/mod-canary.test.ts`
   fetches the curated list, discovers every mod in it, and confirms the payload is
   served with `Access-Control-Allow-Origin: *` (which is what makes an install
   from the static web build possible at all) and that the manifest admits this
   engine version and this mod API.
5. A published tag is still **never moved**. Iterating one takes a MINOR bump,
   because a player's installed copy records the tag it came from.

## How a mod repository gets the gamedata

A mod test that means anything runs the plugin's hooks against a **real level
generated from real Angband 4.2.6 gamedata**: a staircase-reachability fix proven
against a hand-built cave is a fix proven against a fixture. That data is the
content pack.

Before `content` was published, each mod repository carried a ~40-line `content.ts`
that located `packages/content/pack/` in a sibling checkout of this repository
(`NEO_ANGBAND_REPO`, or `../neo-angband`), and a third-party mod author had to clone
a repository with the whole C tree in it to test against real gamedata. From
`0.12.0` the package hands the pack over directly:

```ts
import { loadPackRecords, packFileNames } from "@rpgm-tools/neo-angband-content/pack";
```

`0.11.0` could not: it shipped the pack and declared no subpath for it, so every
path to it was refused. Use `0.12.0` or later.

There is a second subpath for bundlers, which want the file itself so they can
inline it:

```ts
import monsters from "@rpgm-tools/neo-angband-content/pack/monster.json" with { type: "json" };
```

## What is deliberately NOT published

- **A `create-neo-mod` scaffolder**: `docs/MODS.md` describes `neo-pack` as a
  planned validator/bundler CLI. It does not exist yet, and the name is not
  reserved on npm. Half its job now exists though: `@rpgm-tools/neo-angband-mod-sdk`
  ships a `neo-angband-mod-build` bin that compiles a mod's TypeScript into the
  `plugin.js` a mod folder distributes, and enforces the plugin ABI while doing it.
- **The mods themselves**: see above. Every mod repository's manifest is
  `private: true` - `neo-angband-mod-qol`, `-bug-fixes`, `-feature-restoration`,
  `-linoleum` and `-borg` - and stays that way. Publishing one would create a
  second way to obtain a mod that nothing in the game checks.
- **`@rpgm-tools/neo-angband-linoleum`**: the tile-pack build tools. Their output
  ships as a mod; the tools that produce it have no consumer outside this
  repository.
