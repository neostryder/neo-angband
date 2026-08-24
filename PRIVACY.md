# Privacy Policy for Neo Angband

Effective date: 2026-08-23.

## Summary

Neo Angband does not provide accounts, registration, a project-operated player database, analytics, telemetry, crash reporting, advertising technology, or automatic problem-report upload. It does not send character saves, gameplay, local logs, or problem reports to the project through the game.

The game does store player-created data locally and makes limited network requests needed to deliver the hosted build, check for updates, and retrieve a mod when a player chooses to browse, install, verify, or update one.

## Data stored on the player's device

The browser and PWA build use browser storage for character saves, character metadata such as a chosen character name, score data, settings, selected update channel, enabled-mod choices, and similar game state. Browser session storage and caches support a session and offline operation. Installed mod files and local metadata, including repository origin, tag, hashes, and installation time, are stored in IndexedDB.

The desktop build uses the same browser storage for game data. It also writes logs on the player's device and can create a problem-report file when the player requests one. The report can contain build and device details, enabled mods, character details, and recent log lines. The game does not upload that file. A player decides whether to attach it to an external issue tracker, Discord message, or email.

The first-party Quality of Life mod can store remembered settings locally. The first-party ModForge mod can store unfinished local mod drafts when its draft-retention setting is enabled. These are local data stores operated through the game, not separate services.

Clearing browser storage, resetting a browser profile, deleting the desktop data folder, or using a cleanup tool can delete local game data. The game provides player-initiated character export and import, but does not guarantee recovery of locally deleted data.

## Network requests

The hosted build requests its static application files from its hosting origin. It also checks a same-origin build identifier so that a PWA or browser tab can recognize a newer deployment.

A desktop build with updater support requests public release information from GitHub. A release archive is downloaded only when the player uses the offered update flow.

The mod manager requests public GitHub registry, author, tag, tree, manifest, and selected mod-file information when a player uses mod browsing, installation, verification, or update features. The manager retains installed mod files locally so ordinary game startup does not require a mod download.

These requests can disclose ordinary technical request information to the relevant hosting or GitHub service, such as an IP address, browser or application request headers, and the requested public URL. The project source does not add a player account identifier, character name, save content, gameplay record, log content, or problem report to these requests. The relevant hosting and GitHub providers govern their own handling of request data.

The examined program source does not set or read cookies. This statement does not describe cookies or other practices of a browser, hosting provider, GitHub, Discord, or another external service.

## Mods and external services

The first-party mods covered by this policy do not declare network access and their examined shipped plugin code does not make network requests. A third-party mod is separate code from a separate author. A player should review a third-party mod's source, declarations, licence, and privacy information before installing it.

The core source includes a capability through which a mod can write files to a player-selected folder on supported devices. No first-party mod covered here currently declares or uses that capability. If a future mod writes to a folder monitored by a cloud-sync provider, that provider's terms and privacy practices apply to the copied file.

Opening a GitHub, Discord, release, or other external link transfers the player to that service. Any information supplied there is governed by that service's policies and the player's choices.

## Questions and future changes

The support and security contact routes published in the repository provide a way to raise questions about this policy. This policy requires review and update before adding accounts, analytics, telemetry, a report uploader, cloud backup, or another feature that sends player data to a new recipient.
