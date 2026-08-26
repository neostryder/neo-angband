# Terms of Use for Neo Angband

Effective date: 2026-08-23.

## Scope

These Terms describe use of the official hosted Neo Angband web build and project-provided release builds. Neo Angband is a single-player, open-source game. It has no player-account system and no project-operated service for storing player saves or profiles.

These Terms do not replace the licence for the software. Copying, modifying, and distributing Neo Angband source, code, and covered materials remain governed by `LICENSE.md`, which offers the GNU General Public License version 2 or the Angband licence. Asset licences can differ and are identified in the applicable credits files. If these Terms conflict with rights granted by an applicable software or asset licence, that licence controls for those rights. These Terms do not add a condition to exercising those licence rights.

GitHub, GitHub Pages, Discord, browser vendors, operating-system vendors, and other linked services operate under their own terms and policies.

## What the hosted build does

The hosted build runs the game in the player's browser or installed PWA. Character saves, settings, installed mods, and similar game data are stored on the player's device by the browser. The desktop build uses the same browser-storage model for game data and also writes local logs and player-created problem-report files. The project does not provide a game-save account, cloud-save account, or server-side character recovery service.

The game can make limited network requests. The hosted build obtains its static files and checks its own hosted build identifier for updates. A supported desktop build checks public GitHub release information and downloads a release archive only through the player-selected update flow. The mod manager can retrieve public GitHub information and files when a player browses, installs, verifies, or checks for updates to a mod. These requests do not upload character saves, gameplay, log contents, or a problem report to the project.

The software is provided as available. It can be changed, unavailable, incompatible with a device or browser, or removed from a hosting location. A player remains responsible for keeping any desired export or other backup of local game data.

## Mods and third-party material

Mods are separate folders that a player chooses to install into Neo Angband. The seven first-party mods addressed by the companion Terms documents are not bundled into the base game. A repository installation retrieves the selected mod from its public GitHub repository at a tag and stores the retrieved copy locally. The manager records the mod's origin and file hashes so it can report whether a local copy has changed since installation. This is not a guarantee that a first download is safe or that a tag cannot be changed by its repository owner.

Mods can change game content, behavior, graphics, sounds, fonts, or other game features. A mod can also include executable plugin code. The project does not review, endorse, warrant, or take responsibility for third-party mods, their accuracy, security, licences, content, or compatibility. A player should inspect a mod, its repository, its declared capabilities, and its applicable licence before installation.

The mod capability prompt communicates what a mod declares that it will use. It is not a complete technical sandbox for in-process plugin code. A player should not treat a declaration as a guarantee that mod code cannot act outside the listed capability.

Material supplied by a mod author or another rights holder remains subject to its own licence or permission. In particular, art can have terms separate from the Neo Angband code licence.

## Acceptable use

Use of the hosted build and project-provided release paths must comply with applicable law and applicable software, asset, and third-party service terms. The hosted build and mod system must not be used to interfere with the project's operation or security, bypass access or integrity controls, disrupt GitHub, GitHub Pages, Discord, or another service, or distribute material in violation of a right or licence.

Security concerns should use the private reporting routes stated in `SECURITY.md`, rather than a public issue. The game creates problem reports as local files. Any attachment or message sent to an issue tracker, Discord, email provider, or other recipient is a separate action chosen by the sender.

## Audience

Neo Angband is a fantasy dungeon-crawling game. The software has no account registration, age-confirmation flow, or adults-only content classification. These Terms do not impose a minimum age. A parent or guardian remains responsible for supervising a minor where appropriate.

## No warranty

The existing software licences contain their own warranty and liability terms. Consistent with those licences, the hosted build, release builds, and optional mods are offered without a promise of uninterrupted availability, data preservation, compatibility, security, accuracy, or fitness for a particular purpose, to the extent permitted by applicable law.

## Community spaces

Project participation in GitHub issues, pull requests, discussions, and Neo Angband discussions in the RPGM Tools Discord is subject to the shared Code of Conduct. That Code does not replace the rules of GitHub or Discord.
