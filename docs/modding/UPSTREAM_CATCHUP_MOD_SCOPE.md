# Scoping #237: a new mod for upstream gameplay additions since 4.2.6

> STATUS: scope decided (2026-08-15, ruling: C+B; see "What this means for
> #237" below). No repo, no code yet. This document is the answer to "what
> would #237 build", checked against the adjudication it is supposed to draw
> from.

## The headline finding

**Zero commits qualify.** The adjudication ticket #237 is supposed to draw
from, "All 161 post-4.2.6 upstream commits adjudicated", does not contain a
verdict category of "genuine gameplay addition, should exist as an opt-in
mod." Every one of the 161 commits was sorted into one of six other buckets,
and none of those buckets is a gameplay-addition backlog. #237 as titled has
no source material yet. See "What this means for #237" below before reading
the rest as a build plan.

## Where the adjudication lives, and how it was verified

The record is `POST_426_TRIAGE.md`, in the maintainer's private working
repository, titled "The 161 upstream commits after 4.2.6, every one adjudicated," measured
2026-08-08 over the range `f3082213b..upstream/master`. It is named as the
authoritative record in the private repo's own `README.md`: *"POST_426_TRIAGE.md
| All 161 post-4.2.6 upstream commits, adjudicated with citations."* No newer
file supersedes it: nothing in that directory is dated after 2026-08-08 except
`MOD_IDEAS.md` (13:49) and `README.md` (09:34), both read below and neither
re-triages the 161.

A second, independent pass exists: `parity/mods-2026-07-26/BUGFIX-UPSTREAM-AUDIT.md`
(2026-07-26, pre-dates POST_426_TRIAGE but covers the same 161-commit range from
a bug-fixes-mod angle). It also finds nothing beyond bug-fixes and
resilience-guard candidates, and its own classification count is explicit: *"2
already catalogued fixes... 4 newly identified bug/resilience fixes... 155
excluded (frontend/platform/Borg, build/CI/docs, data/tiles, refactors,
cosmetic wording, or non-bug design/balance)."* Two independent readings of the
same 161 commits, four months apart, both land on "no gameplay additions."

## The actual six verdicts, and their counts (sum = 161)

| Verdict | Count | What it is |
|---|---|---|
| 1: Already in core, and shouldn't be | 3 | Post-release drift that crept into core; one removed, one filed as #149 (stands), five tile commits move to Verdict 2 |
| 2: Was in core, now reverted; belongs to **bug-fixes** | 5 | Post-tag tile assignments for existing objects/monsters. Explicitly assigned to the bug-fixes mod, not a new mod. Blocked on a capability that does not exist yet: nothing lets a mod's `.prf` override the tile loader |
| 3: Real bug-fix candidates | 9 | Store-charge exploit, TELEPORT/RECHARGE dice, generation crash guard, etc., bug-fixes mod backlog |
| 4: Text and data corrections | 7 | Flavor text, vault edge tiles, room template door counts, bug-fixes mod backlog |
| 5: Deliberately not adopted | 1 | `588bf5589` (room-template dedup), rejected for core, would move every RNG-seeded parity vector |
| 6: No port impact | ~136 | 97 dismissed by class (C build/CI/SDL/Windows/macOS/DOS/Borg/hygiene) + 39 that survived the path filter but turned out to be comments, casts, signal handling, terminal plumbing, or docs |

None of the six is "genuine gameplay addition, ship as an opt-in mod." The
nearest thing (Verdict 2's tile assignments) is explicitly routed to
bug-fixes in the source document's own words, not to a new mod, and its
blocker (prf-override capability) is bug-fixes' problem to solve, not #237's.

## Checked for a hidden gameplay-addition list elsewhere

Searched both repos for "opt-in mod," "gameplay addition," "catch-up," and
`#237`: no hits anywhere except this new document. `MOD_IDEAS.md` (the
private backlog of un-built mod concepts: AI borgs, soft caps, reach weapons,
networking, AI-generated content, mod-manager integration) is the project's
actual list of gameplay-addition mod candidates, and it is explicitly
**not** upstream-commit-derived: every idea in it originated within the
project itself, dated by when it was raised, with zero SHA citations. It answers a different question
("what should this port add beyond Angband") than #237 asks ("what did real
upstream add that the port should adopt").

## What this means for #237

**Scope: C, combined with B**, and the scope rule that
makes the combination non-arbitrary rather than two options glued together:

> #237 owns anything in upstream master that isn't in the 4.2.6 tag,
> INCLUDING fixes master already carries; that's "master minus tag," full
> stop. The bug-fixes mod is for a different, narrower thing: bugs that are
> still outstanding in Angband and NOT yet addressed in master: real defects
> this port fixes proactively ahead of upstream.

Under that rule Verdict 2's five tile assignments belong in #237 **by
definition**, since master already carries them, not because the earlier
adjudication's own routing was wrong (it wasn't; POST_426_TRIAGE.md was
answering "which mod fixes this bug," and under the OLD two-mod split with no
upstream-catchup mod, bug-fixes was the only place a fix could go). The scope
rule is what changed, not the citation. And B still stands on its own terms:
upstream `master` keeps moving past this adjudication's 2026-08-08 cutoff, so
the repo skeleton is built now with an empty README table ready for whatever
a future re-triage finds, exactly as B described.

**The blocker does not move.** Folding Verdict 2 into #237 changes which
repo's README carries the row, not whether the row can ship: nothing yet
lets a mod's `.prf` override the tile loader (see "Core-seam prerequisite
check" below), so these five rows land in the table PRE-POPULATED and
flagged blocked-on-prf-override, not implemented.

Superseded by this ruling: options A (closing #237) is off the table since
C gives it real content; the "not recommended without a stated reason" note
against C above is resolved: the reason is the scope rule itself.

Everything below builds the repo per B, with Verdict 2's five rows seeded
into the README table per C.

## Proposed repo shape (skeleton only, per option B)

Following the pattern read from `neo-angband-mod-bug-fixes` (manifest +
`plugin.ts`/`plugin.js` + per-topic `.ts` files + README with an
issue-citation table) and the lighter `-borg`/`-qol`/`-linoleum` manifests:

```
neo-angband-mod-upstream-catchup/
├── .gitattributes          (LF everywhere, matches the other four repos, #254's fix)
├── .github/
├── .gitignore
├── LICENSE.md              (GPL-2.0-only, dual with Angband licence)
├── manifest.json
├── package.json
├── plugin.ts                (composes per-commit modules; empty stub to start)
├── plugin.js                 (built artifact, committed, SHA-256 catalogue source)
├── README.md                 (the "one row per SHA" table)
├── tsconfig.json
└── vitest.config.mjs
```

`manifest.json`, following the bug-fixes shape (`shape: "content"`,
`facets: ["content", "plugin"]`, `modApi: 1`) since gameplay additions are
overwhelmingly data + code, not tiles:

```json
{
  "id": "upstream-catchup",
  "name": "Upstream Catch-up (post-4.2.6 gameplay)",
  "version": "0.1.0",
  "shape": "content",
  "facets": ["content", "plugin"],
  "modApi": 1,
  "engine": ">=0.18.0",
  "saveSchema": 1,
  "dependencies": { "core": "*" },
  "author": "neostryder",
  "license": "GPL-2.0-only",
  "description": "Opt-in gameplay additions from real upstream Angband development after the 4.2.6 tag this port is pinned to. Each addition is a named toggle, cited to its upstream commit. With everything off, core stays exactly 4.2.6.",
  "rules": [],
  "repository": "https://github.com/neostryder/neo-angband-mod-upstream-catchup"
}
```

`rules: []` on purpose: there is nothing to gate yet. The bug-fixes mod's
own rule from its README applies here without modification: **one toggle per
CLASS of addition, never one per atomic commit**: e.g. if three unrelated
upstream SHAs all touch "monster AI," they get one `catchup.monsterAI` flag,
not three.

### README's "one row per SHA" table (the ticket's title, taken literally)

Modeled on bug-fixes' README table (`| Toggle | What it covers | What it
does |`, with upstream issue links), but keyed on commit rather than issue,
since this mod's citation unit is a SHA, not a GitHub issue:

| SHA | Date | One-line | Class / toggle | Port site | Status |
|---|---|---|---|---|---|
| `7e8b58325` | n/a¹ | Post-tag tile: Beorn, the Mountain Bear | `catchup.tiles` | `gervais/graf-dvg.prf` | Blocked: needs prf-override capability |
| `2e9703d42` | n/a¹ | Post-tag tile: Knight's Shield | `catchup.tiles` | `shockbolt/graf-shb-{dark,light}.prf` | Blocked: needs prf-override capability |
| `9b04b692d` | n/a¹ | Post-tag tiles: Sip of Miruvor, Draught of the Ents (nomad set) | `catchup.tiles` | `nomad/graf-nmd.prf` | Blocked: needs prf-override capability |
| `655812a54` | n/a¹ | Post-tag tiles: 8 adam-bolt monster/object assignments (old forest tree, witch, blackguard, Old Man Willow, red-hatted elf, Father Christmas, dúnadan of Angmar, Sip of Miruvor) | `catchup.tiles` | `adam-bolt/graf-new.prf` | Blocked: needs prf-override capability |
| `ab2d65386` | n/a¹ | Comment-only: removes a stale note about numeric SVALs | - | - | No port needed |

¹ Date not recorded in `POST_426_TRIAGE.md`; not fabricated here. Fill in
from `git log` against the private adjudication repo before this ships if
the README table is meant to carry it.

Columns match what POST_426_TRIAGE.md already records per commit (SHA,
one-line description, upstream framing) plus two new ones this mod needs:
which toggle class it falls under, and the file:line in `packages/core` where
it would land. These five rows are seeded from Verdict 2 (§ above) per
the C+B ruling above; every row after them is empty until a future re-triage
finds one.

## Core-seam prerequisite check, against `docs/modding/MOD_REACH.md`

Cross-referenced the reach document (measured 2026-08-15, the current state)
rather than assuming the #154/#152 precedent (core needed a prf-override seam
before the bug-fixes mod's tile work could ship) automatically repeats here:

- **`CANDIDATE` dispatch points a mod cannot reach: 0.** Every switch-based
  dispatch of 8+ cases in the tree either has a registry already
  (`registry:effect`, `:room`, `:profile`, `:blow`, `:store`, `:command`,
  `:monster`, `:projection`, `:vocab`, `:tval`, `:rune`, `:effect-info`,
  `:glyph`, `:menu`, `:ui-entry`, 15 capabilities total) or is UI/parser/host
  wiring a gameplay mod would not need.
- **Gamedata**: 41 of 44 record files accept a mod-added record without
  replacing the file; 43 of 44 are patchable per-record. A mod can add its own
  namespaced field to 15 bound record types.
- **Resource categories**: 7 of 7 (tiles, sounds, fonts, prefs, help pages,
  art, UI strings) are mod-suppliable.

**Conclusion: no core-seam prerequisite work is evident today**, unlike the
tile-prf case (Verdict 2), which explicitly needs new capability before
bug-fixes can carry it. This reads as good news but is conditional on there
being no candidate commits to test it against: MOD_REACH's caveat about its
own blind spots (closed TypeScript unions, reshaped-not-registered dispatch)
means a specific future commit could still land on one of the un-measured
gaps the document itself flags. Re-check against the specific commit once one
exists; do not treat "0 CANDIDATE today" as a guarantee for a commit not yet
identified.

## Size / complexity read

Small either way. The repo skeleton itself is the same size as `-borg`'s
scaffold before its first rule landed: a day, not a project. Verdict 2's
five rows add no new size: the .prf lines are already written out above
(§ Verdict 2 quoted verbatim from POST_426_TRIAGE.md), and all five are
blocked on the same one missing capability rather than needing five separate
solutions. The real size question re-opens only when a future re-triage of
`upstream/master` (which has moved past the 2026-08-08 cutoff) produces
another gameplay-addition verdict, or when the prf-override capability lands
and these five unblock.

## Row-by-row implementation checklist

Five rows, all blocked on the same capability (per the C+B ruling above,
folded in from Verdict 2, not newly found here):

- [ ] `7e8b58325`: Beorn, the Mountain Bear tile, blocked on prf-override
- [ ] `2e9703d42`: Knight's Shield tile, blocked on prf-override
- [ ] `9b04b692d`: nomad-set food tiles (2 assignments), blocked on prf-override
- [ ] `655812a54`: adam-bolt set (8 assignments), blocked on prf-override
- [ ] `ab2d65386`: comment-only, no port needed, close without a code change

The checklist to execute NOW, since none of the five can land before the
capability exists, is the repo skeleton itself:

- [ ] Create `neo-angband-mod-upstream-catchup` as a sibling repo, `.gitattributes`
      copied from `-bug-fixes` (LF enforcement, #254's fix)
- [ ] `manifest.json` as drafted above, `rules: []`
- [ ] Empty `plugin.ts` → built `plugin.js`, following bug-fixes' build/verify flow
- [ ] README with the SHA-table above (five rows seeded, all blocked) and the
      "one toggle per class" rule
      stated up front, same as bug-fixes' README does
- [ ] Register the (empty, disabled-by-default) mod in `mods/registry.json`
      only once it has at least one real rule: an empty mod in the registry
      is a support burden with no payoff
- [ ] Add a recurring step to whatever process re-triages `upstream/master`
      (the same method `POST_426_TRIAGE.md` used) to route any future
      "genuine gameplay addition" verdict into this repo's README table and
      open a per-commit ticket

## Sources read in full for this scoping pass

- `POST_426_TRIAGE.md`, `README.md`, `MOD_IDEAS.md`, and
  `parity/mods-2026-07-26/BUGFIX-UPSTREAM-AUDIT.md`, all from the
  maintainer's private working repository (not public, not linked here)
- `neo-angband-mod-bug-fixes`'s `README.md` and `manifest.json`
- `neo-angband-mod-borg`, `neo-angband-mod-linoleum`, and `neo-angband-mod-qol`'s
  `manifest.json` files
- `C:\Repositories\neo-angband\docs\modding\MOD_REACH.md` (headline table and
  the switch-census section)
