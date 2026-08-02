# Security

## Reporting

Email **strider-angband (at) rpgm.tools**, or use GitHub's
[private vulnerability reporting](https://github.com/neostryder/neo-angband/security/advisories/new)
if you would rather it stay on GitHub. Please do not open a public issue for a
vulnerability first.

Expect an acknowledgement within a few days. This is a small project run by one
person, so there is no bounty and no SLA - but there is a real person reading,
and a real fix.

## What is worth reporting

Neo Angband is a single-player game with no server, no accounts and no network
calls at runtime, so the interesting surface is narrower than most projects.
The parts worth looking at:

- **The mod install path.** A mod is downloaded from its own repository at a
  pinned tag and every file is checked against a SHA-256 that ships inside the
  build (`packages/web/src/mod-registry.ts`). A way to get an unverified file
  installed, or to make the check pass on content it should not, is a real
  finding.
- **Scripted plugins.** A mod may ship one `plugin.js`, evaluated with the
  engine handed to it rather than imported. A way for a plugin to reach past
  the surface it is given - the filesystem, the network, another mod's
  internals - is a real finding.
- **Save handling.** Saves are player data, but an import path that can be made
  to do something other than restore a game is worth knowing about.
- **The desktop app.** Anything that escapes the renderer, or that lets a
  crafted file reach Node through the preload bridge.

## What is not a vulnerability

- **Cheating.** The save is local, editable, and yours. Editing your own save
  or turning on wizard mode is not an exploit; the game marks a wizard-mode
  character as unscoreable and that is the whole of the defence, deliberately.
- **A mod doing what it says.** Mods change the game. That is their job.
- **The unsigned builds.** Releases are not code-signed - see the note on any
  release page. That is a known gap with a stated reason, not a report.

## Supported versions

Pre-1.0, only the latest release. There are no maintenance branches.
