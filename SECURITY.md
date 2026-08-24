# Security Policy

## Reporting a vulnerability

Report security issues privately by email to **strider-angband (at) rpgm.tools** or through [GitHub private vulnerability reporting](https://github.com/neostryder/neo-angband/security/advisories/new).

Do not open a public issue before the report has been triaged and disclosure timing has been coordinated.

A useful report includes:

- The affected version, platform, and installation type.
- The relevant mod, save, preference file, URL, or other input.
- Reproduction steps or a minimal proof of concept.
- The security boundary crossed and the resulting impact.
- Any conditions required for exploitation.

Remove unrelated personal data from save files and logs before attaching them.

## Expected response

An acknowledgement normally arrives within a few days. Triage determines whether the report is reproducible, whether it crosses a security boundary, and which supported versions are affected. Actionable reports receive status updates when material facts change and receive coordinated disclosure timing when a fix is ready.

This project has no bug bounty and no response-time SLA. Public credit is available when requested and when disclosure does not expose another person or project without consent.

## Security boundary

Neo Angband is both the game engine and the host that installs, composes, and loads mods. Its security surface is broader than the surface of any single mod.

The following inputs are untrusted:

- Mod manifests, content records, patch operations, archives, assets, and plugin code.
- Imported character saves and user-editable preference files.
- Text, names, descriptions, URLs, and other values supplied by mods or players.
- Network responses used for mod discovery, mod installation, and desktop updates.

A content-only mod is intended to change declared game records. It is not intended to alter JavaScript prototypes, execute script, inject DOM markup, escape its storage namespace, or invoke desktop privileges.

An in-process `plugin.js` is trusted renderer code after the player enables it. Capability declarations describe the supported facade and inform consent, but they do not sandbox an in-process plugin from the live engine, browser APIs, or other ambient renderer facilities. The sandboxed Worker plugin tier is the containment boundary for code that must be technically restricted.

Even trusted renderer code is not intended to gain arbitrary Node.js or operating-system access, replace the application, escape path-confined host storage, bypass native update authority, or expose preload bridges to remote content. Those controls belong to the desktop main process and preload boundary.

## Issues that require private reporting

Private reports are appropriate for a reproducible way to:

- Make a content-only mod execute code, pollute prototypes, inject active markup, or write outside its intended records or storage namespace.
- Bypass mod installation consent, origin pinning, plugin facet checks, engine compatibility checks, or sandboxed Worker capability enforcement.
- Use mod code to cross the renderer and desktop main-process boundary in a way outside the documented in-process trust model.
- Make an archive write outside its destination, replace another mod without an allowed origin, reach an unintended network host, or exhaust unreasonable memory, CPU, or disk from a small crafted input.
- Make a crafted save or preference file execute code, access the network or filesystem outside its intended host operations, corrupt unrelated characters or host data, inject active content, or cause disproportionate resource exhaustion.
- Inject mod-supplied or player-supplied text as executable DOM content.
- Expose Electron, Node.js, IPC, updater, shell, or filesystem authority to remote or otherwise untrusted renderer content.
- Install a desktop update that is not authenticated as an expected release of this project.
- Disclose a committed credential or a dependency vulnerability with a demonstrated path to an affected Neo Angband component.

## Issues for the public tracker

Use a normal GitHub issue for:

- Gameplay bugs, crashes from ordinary play, balance concerns, and usability problems with no crafted-input security effect.
- Differences from upstream Angband behavior or parity ledger discrepancies.
- A mod changing gameplay or presentation within the scope the player enabled.
- Editing a local save, using wizard mode, or otherwise cheating in a single-player character.
- Mod compatibility, load order, validation messages, or authoring questions that do not bypass a security boundary.
- The known absence of release code signing by itself.

When uncertain, private reporting is appropriate. A private report can be moved to the public tracker after triage without exposing details prematurely.

## Supported versions

Before version 1.0, only the latest release is supported. There are no maintenance branches.
