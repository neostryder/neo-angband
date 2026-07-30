# Modern moddability: the three-model consensus, verified

> STATUS: consensus + plan, 2026-07-29. The brief asked one question — *what does a
> best-in-class, modern modding platform have that this one lacks?* — and put it to
> **three independent reviewers across two model families**: MiniMax M3, and
> gpt-5.6 twice under different harnesses (OpenAI's Codex CLI, and Copilot's).
> Each had repository access and no sight of the others' answers. Every claim below
> was then **verified against the code**, and the verdict column is that
> verification, not a vote. The raw reports are session artifacts, not repo files;
> what survived verification is here.

## Why three reviewers, and what it bought

One reviewer's highest-priority finding was **false**, and only the disagreement
exposed it. Copilot/gpt-5.6's #1 (cost L, "fix this before anything else") was:

> Only 24 of 44 record files support per-record patch/replace/remove. The other 20
> silently discard those operations; this includes objects, ego-items, vaults,
> traps, stores, brands, slays, projections, and constants.

Those nine files are exactly the ones `mod-sdk/src/record-key.ts` exists to key.
Its header describes the silent-drop as the state **before** that table was
written; two of the three reviewers read the problem statement as the status quo
and filed the same non-existent P1. The third, reading the same repository, did not.

**The split did not follow family lines, and that is the useful part.** The two
reviewers who got it wrong were from *different* families; the one that got it
right shares its model with one of them. Two instances of one model under
different harnesses disagreed with each other, while two different models agreed
on something false. So the thing worth buying is **independent reviewers**, not
specifically independent *architectures* — vary the harness, the context loaded
and the reasoning effort, and count a same-model split as fully as a cross-family
one. A panel picked to look diverse on paper can still be correlated where it
matters, and a panel that looks redundant can still disagree usefully.

Verified state: **44 of 45 record files are addressable per record** — 24 by a
unique `name`, 19 by explicit key specs, and `history` by nothing, because every
part of a history record is a value a mod would legitimately change. An op against
`history` is *reported*, naming the pack, file, verb and ref. Nothing is dropped in
silence. `record-key.test.ts` asserts the sets in both directions.

Two lessons kept: a report is a lead, not a spec — and a comment that inverts for
two of three careful readers is a defect in the comment. Its header now states the
current state first, and names the false bug so the next reader does not re-file it.

## Verdict table

| # | Finding | Raised by | Verdict |
|---|---|---|---|
| 1 | `shape` is exclusive: code gates on `"plugin"`, records on `"content"`, so a folder cannot ship both | gpt-5.6 (both) | **CONFIRMED — FIXED** (`994dfb5f8`) |
| 2 | Load order ties break lexicographically, discarding the player's order | all three | **CONFIRMED — FIXED** (`7ed88d05e`) |
| 3 | `modManifest` allowlist drops `optionalDependencies` / `loadAfter` / `loadBefore` | M3 (in passing) | **CONFIRMED — FIXED** (`994dfb5f8`) |
| 4 | Mod records are saved as `core:*`; a fresh game records `coreOnlyManifest()` | Codex/gpt-5.6, M3 | **CONFIRMED — OPEN (#131)** |
| 5 | No record-level schema validation (only manifests) | all three | **CONFIRMED — OPEN** |
| 6 | No public author SDK, `create-mod`, JSON Schema, or test harness | all three | **CONFIRMED — OPEN** |
| 7 | Consent is not a sandbox; `ctx.core` + live `state` is full in-process trust | all three | **CONFIRMED — by design, needs a second tier** |
| 8 | No i18n seam; mod strings cannot be localised | all three | **CONFIRMED — OPEN** |
| 9 | Behaviour reach is 7 hooks + 5 facades; most dispatch is closed `switch` | all three | **CONFIRMED — the real long pole** |
| 10 | `assetUrl` is byte access, not an asset system (no sounds/fonts/preload) | Codex/gpt-5.6, M3 | **CONFIRMED — OPEN** |
| 11 | "24 of 44 record files silently discard per-record ops" | Copilot/gpt-5.6, M3 | **FALSE** — see above |
| 12 | `loader.ts` re-sorts lexicographically after the resolver | M3 | **FALSE** — `orderPacks` preserves the resolver's output; the defect was one layer up (#2) |
| 13 | Rebuild dependency resolution / version ranges / cycle detection | *proposed as a gap by the brief* | **REJECTED by all three** — `resolve.ts` is complete; do not rebuild |
| 14 | Move `modApi` to semver now | *proposed as a gap by the brief* | **REJECTED by all three** — an exact integer is correct pre-1.0; revisit at 1.0 |
| 15 | Full state-preserving hot reload | *proposed as a gap by the brief* | **REJECTED by Codex/gpt-5.6 + M3** — content removal invalidates live entities; ship reload-the-fixture instead |

Two independently-found `FALSE` rows and three independently-rejected proposals is
the return on asking three reviewers instead of one. Next panel adds xAI Grok as a
genuinely third family, which this one did not have.

## What is genuinely ahead of the curve

Short, and only where all three agreed:

- **Field-level composition with provenance-aware conflict reporting.** Two mods
  touching the same field is a named conflict, not last-wins. Skyrim and RimWorld
  do not have this.
- **The base game is pack zero.** `core` loads through the same pipeline as any
  mod, with no privileged path — so a total conversion is a supported shape rather
  than a hack.
- **Every gate runs before the dynamic import.** All three noted that ESM
  top-level code *is* execution, and that checking the imported object is already
  too late.

## The plan, in order

Ordered by *risk to the player* first, then by what unblocks the most authors.
Costs are the reviewers' consensus.

1. **Content identity + save manifest (#131, L).** Carry `owner`/`modifiedBy`
   through binding into `ContentIdResolver`, and seed the session manifest from the
   resolved load plan. Until a saved `frost:frost-wyrm` round-trips as
   `frost:frost-wyrm`, the orphan/quarantine machinery cannot protect anything, and
   this project has no save-scumming — a mis-identified save is unrecoverable by
   design. This is the one open finding that can destroy a character.
2. **Bundled mods off `import.meta.glob` onto folder `plugin.js`.** The three
   shipped mods are the only proof that the folder path is the *real* path; while
   they take a private route, "non-bundled reach" is untested by anything that
   ships. Also the standing requirement that no mod's name appears in core.
3. **Record-level schema validation + published JSON Schemas.** Turns a malformed
   contribution from a late binder crash into a message naming file, pointer,
   expected type and fix — and gives authors editor autocomplete for free.
4. **The author platform: `@neo-angband/mod-api`, `create-mod`, `neo-pack
   validate|build|test`.** Today an author reverse-engineers a monorepo. This is
   the difference all three named between an architecture and an ecosystem.
5. **Registry-ify the largest closed dispatch families.** Monster blow effects,
   projections, stores, dungeon profiles, UI commands. Highest gameplay-moddability
   multiplier, and the item that makes total conversions possible rather than
   merely permitted.

Deliberately **not** before release, with the reasoning recorded so it is a choice
and not an oversight:

- **A registry/marketplace.** A service, not a feature. Install-from-URL plus
  integrity hashes is enough; every ecosystem cited got its gallery years later.
- **Package signing.** A tax that only pays once there is a marketplace to defend,
  and it does not make code safe.
- **Semver `modApi`.** Promising compatibility before a curated public API exists
  would be a lie with a version number on it.
- **A sandbox tier**, *for the alpha only*, and this one is a genuine risk
  accepted rather than dismissed: a folder plugin is fully trusted in-process code,
  and the consent prompt is an informed-risk acknowledgement, not a boundary. The
  agent API is already shaped for a Worker + structured-clone tier, and that is the
  intended landing place. Until it exists, "capability-gated" must not be described
  as a security property anywhere player-facing.

## Where localisation sits

All three flagged it; none ranked it top-five, and it is genuinely hard to retrofit
after a public release. The minimum that keeps the door open is cheap and should
land alongside item 3: core owns a stable `stringId` for every message it emits, and
mods carry their own catalogues. Deferring the *catalogues* is fine. Deferring the
*ids* is what makes it expensive later.
