# The upstream catch-up mod: scope

> STATUS: SCOPE OF RECORD. No repository, no code. This page says what an
> upstream catch-up mod would contain and where its boundary against the
> `bug-fixes` mod runs. It is not a claim that any of it is built.

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

| SHA | One-line | Class / toggle | Port site |
|---|---|---|---|
| `7e8b58325` | Post-tag tile: Beorn, the Mountain Bear | `catchup.tiles` | `gervais/graf-dvg.prf` |
| `2e9703d42` | Post-tag tile: Knight's Shield | `catchup.tiles` | `shockbolt/graf-shb-{dark,light}.prf` |
| `9b04b692d` | Post-tag tiles: Sip of Miruvor, Draught of the Ents (nomad set) | `catchup.tiles` | `nomad/graf-nmd.prf` |
| `655812a54` | Post-tag tiles: 8 adam-bolt monster and object assignments | `catchup.tiles` | `adam-bolt/graf-new.prf` |
| `ab2d65386` | Comment-only: removes a stale note about numeric SVALs | - | none needed |

Dates are not recorded here because the triage did not record them per commit;
fill them from `git log` against the upstream range rather than inventing them.

**The capability these five needed now exists.** They were blocked for a while
on the same thing the `bug-fixes` mod's tile work was blocked on: nothing let a
mod's `.prf` override the tile loader. That closed on 2026-08-09. `prefs` is one
of the seven resource kinds a mod may supply, `applyPrefText` runs a mod's `.prf`
through the same grammar, the same sink and the same deps a user's file goes
through, `%:` includes are followed, and the same text is replayed into every
freshly built tile map. See the pref-file section of
[MOD_REACH.md](MOD_REACH.md). So these five rows are implementable work rather
than a waiting list, and the first of them to be written is also the first real
test of that capability from outside the repository.

## Repo shape

Following the `neo-angband-mod-bug-fixes` pattern - a manifest, `plugin.ts` and
its committed `plugin.js` build, per-topic `.ts` files, and a README whose table
carries one row per citation:

```
neo-angband-mod-upstream-catchup/
  .gitattributes          LF everywhere, matching the other mod repositories
  .github/
  .gitignore
  LICENSE.md              GPL-2.0-only, dual with the Angband licence
  manifest.json
  package.json
  plugin.ts               composes per-commit modules
  plugin.js               the committed build, which is what a player runs
  README.md               the one-row-per-SHA table
  tsconfig.json
  vitest.config.mjs
```

The manifest follows the `bug-fixes` shape, since upstream gameplay work is
overwhelmingly data plus code rather than tiles:

```json
{
  "id": "upstream-catchup",
  "name": "Upstream Catch-up (post-4.2.6 gameplay)",
  "version": "0.1.0",
  "shape": "content",
  "facets": ["content", "plugin"],
  "modApi": 1,
  "engine": ">=<the release that shipped the prefs resource kind>",
  "saveSchema": 1,
  "dependencies": { "core": "*" },
  "author": "neostryder",
  "license": "GPL-2.0-only",
  "repository": "https://github.com/neostryder/neo-angband-mod-upstream-catchup",
  "description": "Opt-in gameplay additions from real upstream Angband development after the 4.2.6 tag this port is pinned to. Each addition is a named toggle, cited to its upstream commit. With everything off, core stays exactly 4.2.6.",
  "rules": []
}
```

The `engine` floor is deliberately left as a placeholder above rather than
guessed: it is whichever release shipped the `prefs` resource kind, since the
five rows above cannot work without it, and a range copied out of a document is
the wrong way to arrive at one. `node tools/version.mjs` and the changelog are
where to read it from.

`rules: []` because there is nothing to gate until a row lands. When rows do
land, the `bug-fixes` rule applies here without modification: **one toggle per
CLASS of addition, never one per atomic commit.** Three unrelated SHAs that all
touch monster AI get one `catchup.monsterAI` flag, not three.

`mods/registry.json` in the game's repository gains an entry only once the mod
has at least one real rule. An empty mod on the recommended list is a support
burden with no payoff.

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

Small either way. The skeleton is the same size as the `-borg` scaffold before
its first rule landed: a day, not a project. The five tile rows add no new size
of their own - the `.prf` lines are already written out above, and all five ride
the same capability rather than needing five separate solutions. The real size
question reopens only when a future re-triage of `upstream/master`, which has
moved past the 2026-08-08 cutoff, produces a verdict the six buckets above have
no room for.

## Keeping it current

Whatever process re-triages `upstream/master` routes any future gameplay-addition
verdict into this mod's README table and opens a ticket per commit. Without that
step the triage above is a snapshot with no successor, and the mod's whole value
is being current with a moving target.
