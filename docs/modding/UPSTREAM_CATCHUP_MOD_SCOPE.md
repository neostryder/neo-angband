# The upstream catch-up mod: scope

> STATUS: BUILT AND RELEASED. The mod lives at
> [neostryder/neo-angband-mod-upstream-catchup](https://github.com/neostryder/neo-angband-mod-upstream-catchup),
> first released as `v0.1.0` on 2026-08-24 carrying the four tile-assignment
> rows below, and it is on the recommended list in `mods/registry.json`. This
> page stays the scope of record: it says what the mod contains and where its
> boundary against the `bug-fixes` mod runs.

Core is pinned to Angband's `4.2.6` tag and stays faithful to it, bugs included
(PORT_PLAN.md decision 24). Upstream keeps moving. Two mods carry what moves,
and the line between them is a single question.

## The two mods, and the one question that decides membership

**Does an accepted upstream commit exist for this change?**

- **Yes** - it belongs to the **upstream catch-up** mod, cited by SHA. This is
  finite, mechanical work that *expires*: the day core rebaselines onto a newer
  upstream tag, every row in it is redundant and the mod deletes itself.
- **No** - it belongs to **`bug-fixes`**, cited by issue or by measurement. That
  is open-ended and permanent, and it is what a player means by an unofficial
  patch.

Stated as scope rather than as a test: catch-up owns anything in upstream
`master` that is not in the `4.2.6` tag, INCLUDING fixes master already carries.
That is "master minus tag", full stop. `bug-fixes` is the narrower thing:
defects still outstanding in Angband and not yet addressed in master, which this
port fixes proactively ahead of upstream.

A fix that upstream later accepts MOVES from `bug-fixes` to catch-up at the next
release. That migration is the point of the split, not an inconvenience: merged,
the permanent patch set is buried under the finite one's churn and neither can be
reviewed on its own.

The citation requirement applies to both, and so does the rule that core keeps
the wart either way. A flag-gated fix compiled into core is still core shipping
the fix.

## What a triage of the post-4.2.6 range actually found

The 161 upstream commits in `f3082213b..upstream/master`, measured 2026-08-08,
were triaged one at a time. **Zero of them is a genuine gameplay addition.** A
second, independent pass over the same range from a bug-fixes angle, four months
earlier, reached the same conclusion. Both records live in the private working
record; [../WORKING_RECORD.md](../WORKING_RECORD.md) explains why construction
notes are kept out of this tree and what stayed in it.

The 161 sort into six buckets, and none of them is a gameplay-addition backlog:

| Verdict | Count | What it is |
|---|---|---|
| 1: In core, and should not be | 3 | Post-release drift that crept into core; one removed, one filed as #149 (stands), five tile commits moved to verdict 2 |
| 2: Was in core, reverted, belongs to a mod | 5 | Post-tag tile assignments for existing objects and monsters |
| 3: Real bug-fix candidates | 9 | Store-charge exploit, TELEPORT/RECHARGE dice, a generation crash guard, and similar; `bug-fixes` backlog |
| 4: Text and data corrections | 7 | Flavour text, vault edge tiles, room-template door counts; `bug-fixes` backlog |
| 5: Deliberately not adopted | 1 | `588bf5589`, room-template dedup: rejected for core because it would move every RNG-seeded parity vector |
| 6: No port impact | ~136 | 97 dismissed by class (C build/CI/SDL/Windows/macOS/DOS/Borg/hygiene) plus 39 that survived the path filter and turned out to be comments, casts, signal handling, terminal plumbing or docs |

So the mod has real content, and it is verdict 2's five rows: master carries
those tile assignments, which puts them inside "master minus tag" by definition.
Everything else in the 161 is somebody else's job or nobody's.

## The five rows

| SHA | Date | One-line | Class / toggle | Upstream site |
|---|---|---|---|---|
| `7e8b58325` | 2026-03-10 | Post-tag tile: Beorn, the Mountain Bear | `catchup.tiles` | `gervais/graf-dvg.prf` |
| `2e9703d42` | 2026-03-17 | Post-tag tile: Knight's Shield | `catchup.tiles` | `shockbolt/graf-shb-{dark,light}.prf` |
| `9b04b692d` | 2026-03-18 | Post-tag tiles: Sip of Miruvor, Draught of the Ents (nomad set) | `catchup.tiles` | `nomad/graf-nmd.prf` |
| `655812a54` | 2026-03-20 | Post-tag tiles: 8 adam-bolt monster and object assignments | `catchup.tiles` | `adam-bolt/graf-new.prf` |
| `ab2d65386` | 2026-03-24 | Comment-only: removes a stale note about numeric SVALs | - | none needed |

Dates read from `git log` against the upstream range; the triage itself did not
record them per commit.

The first four shipped in the mod's `v0.1.0`, all four behind the single
`catchup.tiles` flag. `ab2d65386` deletes two comment lines and changes no
assignment, so it is named in the mod's README table rather than stubbed: a stub
would be a row claiming work that does not exist.

### The seam they ride, and the one they do not

**A `prefs` resource is the wrong door for these four, and that was measured
rather than assumed.** `prefs` is one of the seven resource kinds a mod may
supply, `applyPrefText` runs a mod's `.prf` through the same grammar, the same
sink and the same deps a user's file goes through, `%:` includes are followed,
and the same text is replayed into every freshly built tile map (see the
pref-file section of [MOD_REACH.md](MOD_REACH.md)). That last property is the
problem. A mod's pref resource reaches EVERY tile map the game builds, whatever
tile set is loaded; the `prefs` kind sets `slot: "forbidden"`, so a declaration
cannot name one; and the pref grammar's `?:` expressions test `$SYS`, `$RACE`
and `$CLASS` and nothing else (`ui-prefs.c` L553-560), so no line can name one
either. There is no way to scope a pref file to a tile set.

These four commits are per-tile-set by nature, and the sheets overlap. David
Gervais' `graf-dvg.prf` already assigns the Knight's Shield, the Sip of Miruvor,
the Draught of the Ents and all seven of the creatures Adam Bolt's sheet was
missing; Shockbolt's already assigns Beorn's bear form, both drinks and the same
seven creatures. One pref resource carrying all four blocks would repaint ten
correct assignments in each of those two sheets with coordinates addressing
somebody else's atlas.

**`registry:tiles` is scoped the way the content is** (shipped 0.23.0, with
`ctx.registries`). A filler is told which pack is being built (`fill.pack`), so a
block reaches only the tile set upstream wrote it for, and `fillMonster` /
`fillObject` refuse any entry something else already assigned - which is exactly
what these commits do upstream, since every one of them fills a blank. Both
guarantees are mechanical rather than promised. The ported text is still
upstream's own `.prf` lines read by the engine's own port of the `ui-prefs.c`
grammar (`parseTilePrefs`), so names resolve exactly as they do for a pack's own
`graf-*.prf`; only the delivery differs.

## Repo shape

Following the `neo-angband-mod-bug-fixes` pattern - a manifest, `plugin.ts` and
its committed `plugin.js` build, per-topic `.ts` files, and a README whose table
carries one row per citation:

```
neo-angband-mod-upstream-catchup/
  .gitattributes          LF everywhere, matching the other mod repositories
  .github/
  .gitignore
  AI_USAGE_POLICY.md      the shared copy, identical across the mod repositories
  CHANGELOG.md            Keep a Changelog, one citation per entry
  CODE_OF_CONDUCT.md
  LICENSE.md              GPL-2.0-only, dual with the Angband licence
  manifest.json
  package.json
  plugin.ts               reads the flags, installs the filler
  plugin.js               the committed build, which is what a player runs
  README.md               the one-row-per-SHA table
  TERMS.md
  tiles.ts                the four commits' `.prf` text, and the filler
  tiles.test.ts
  tools/build.mjs
  tsconfig.json
  vitest.config.mjs
```

The manifest as shipped in `v0.1.0`:

```json
{
  "id": "upstream-catchup",
  "name": "Upstream Catch-up (post-4.2.6)",
  "version": "0.1.0",
  "shape": "plugin",
  "facets": ["plugin"],
  "modApi": 1,
  "affectsGameplay": false,
  "capabilities": ["registry:tiles"],
  "engine": ">=0.23.0",
  "dependencies": { "core": "*" },
  "author": "neostryder",
  "license": "GPL-2.0-only",
  "repository": "https://github.com/neostryder/neo-angband-mod-upstream-catchup",
  "description": "Opt-in changes from real upstream Angband development after the 4.2.6 tag this port is pinned to. ...",
  "rules": [{ "flag": "catchup.tiles", "title": "Post-4.2.6 tile assignments", "default": false }]
}
```

Three fields differ from what this page proposed before the mod was built, and
each difference is the shipped content rather than a preference:

- **`engine` is `>=0.23.0`, not the release that shipped the `prefs` resource
  kind.** That kind reached a release in `0.20.0` and is not what these rows
  ride; `registry:tiles` and `ctx.registries` shipped together in `0.23.0`, and
  those are what the filler needs. See the seam section above for why.
- **`shape` is `plugin`, not `content`.** The first slice ships no records, and a
  `content` declaration with no content files is a field an author fills in and
  believes. It moves to `content` + `facets: ["content", "plugin"]` on the day a
  data row lands, which is a manifest edit and nothing more.
- **`saveSchema` is absent.** The mod keeps nothing in the player's save, and a
  declared schema with no bag behind it is the same empty promise.

`affectsGameplay: false` because tile assignments change no rule, no die roll and
no level, so a character played with the mod is not marked outside the unmodified
score comparison. A future class of change that did alter gameplay would flip it.

**One toggle per CLASS of addition, never one per atomic commit.** All four tile
rows sit behind `catchup.tiles`. Three unrelated SHAs that all touch monster AI
would get one `catchup.monsterAI` flag, not three.

**Every toggle defaults to off**, which is where this mod differs from
`bug-fixes` and is deliberate: core is 4.2.6, and a change from after that tag
arriving switched on would be the port adding something.

`mods/registry.json` in the game's repository gains an entry only once the mod
has at least one real rule, because an empty mod on the recommended list is a
support burden with no payoff. `catchup.tiles` is that rule, so the entry is
there as of `v0.1.0`.

## What core has to grow first: nothing evident

Checked against [MOD_REACH.md](MOD_REACH.md)'s own measurements rather than
assumed from the tile-prf precedent:

- **Dispatch points a mod cannot reach: 0.** Every switch-based dispatch of eight
  or more cases in the tree either has a registry already or is UI, parser or
  host wiring a gameplay mod would not need.
- **Gamedata**: 41 of 44 record files accept a mod-added record without
  replacing the file; 43 of 44 are patchable per record; 15 bound record types
  carry a mod's own namespaced fields.
- **Resource categories**: 7 of 7 are mod-suppliable.

That reads as good news and is conditional on there being no candidate commits to
test it against. MOD_REACH names its own blind spots - closed TypeScript unions,
dispatch that was reshaped rather than registered - so a specific future commit
can still land on an unmeasured gap. Re-check against the commit once one exists.
"Zero unreachable dispatch points today" is not a guarantee for a commit nobody
has identified.

## Size

Small, as estimated, and measured now that it is built: the scaffold plus four
`.prf` blocks, one filler and 31 tests. The tile rows added no size of their own,
because the lines are already written out above and all four ride the same
capability rather than needing four separate solutions. The real size question
reopens only when a future re-triage of `upstream/master`, which has moved past
the 2026-08-08 cutoff, produces a verdict the six buckets above have no room for.

## Keeping it current

Whatever process re-triages `upstream/master` routes any future gameplay-addition
verdict into this mod's README table and opens a ticket per commit. Without that
step the triage above is a snapshot with no successor, and the mod's whole value
is being current with a moving target.
