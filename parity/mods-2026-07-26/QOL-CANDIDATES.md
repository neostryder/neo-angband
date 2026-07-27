# QoL mod candidates (research pass, 2026-07-26)

> STATUS: PROPOSAL ONLY. Nothing here is built. This is a reviewable menu for
> the `qol` mod, produced against the constraints in `docs/modding/QOL.md` and
> `docs/modding/MOD_SEAMS.md`: core stays a byte-identical Angband 4.2.6
> reproduction with every tweak OFF; each candidate is an independently
> switchable `qol.*` flag declared in `packages/web/mods/qol/manifest.json`;
> nothing here re-defaults a built-in Angband option (those already ship in
> core at their upstream defaults and are the player's business in the `=`
> menu); nothing here is balance, difficulty, a bug fix, or save-scumming.

## How this was researched

- Read `docs/modding/QOL.md`, `docs/modding/MOD_SEAMS.md`, `docs/modding/BUG_FIXES.md` in full.
- Grepped and read the relevant parts of `packages/web/src/` (message log,
  knowledge/equipment screens, options, a11y, colors, shop, sidebar/status
  line, targeting, pathfinding) and the matching `reference/src/` C to check
  each candidate against both the port and vanilla 4.2.6 before writing it up.
- Searched the web for modern roguelike UX conventions, Angband-specific
  player/forum feedback, and accessibility guidance. Every external claim
  below has a URL.
- **The trap is real.** Several ideas that looked obvious turned out to
  already be faithful vanilla behavior once I read `reference/src` — most
  importantly, "always show the current level feeling" is not a new idea to
  propose, it's `prt_level_feeling` (`reference/src/ui-display.c:1053`), part
  of vanilla's own always-on status line, and it is already wired in the port
  (`packages/core/src/game/display.ts:813`, `packages/web/src/main.ts:4952`).
  See "Already present" below for the full list of near-misses like this.

## A note on scale

This pass ends at **13 candidates**, below the suggested 15-30. I would
rather hand over 13 I have actually verified against the port and cited
against real prior art than pad to 20+ with ideas I couldn't confirm are new,
in scope, or low-risk. The "Rejected candidates" and "Open questions"
sections below are correspondingly long, which I think is the more valuable
half of this document — several of the rejected ideas are things I initially
believed were good candidates until `reference/src` or `packages/web/src`
proved otherwise.

---

## Candidates, ranked

### 1. `qol.a11yLookAnnounce` — Screen reader: announce look/target descriptions

**Title / description (Fixes & tweaks menu):** "Announce look and target
descriptions to screen readers. What you see when examining a tile or picking
a target — the monster, object, or terrain and its direction and distance —
is read aloud, not just drawn on screen."

**What it changes:** The interactive look/target loop (`l`, `*`, and the aim
prompts) already computes a full description of the cursor's current grid
every time the cursor moves, including a direction-and-distance phrase in
vanilla's own format ("12 S, 35 W"). Today that string is drawn only to the
canvas. With the flag on, the same string is also pushed to the existing
screen-reader live region, so a blind or low-vision player using a screen
reader hears "You see a kobold (12 S, 35 W)" as they move the cursor, instead
of nothing.

**Why it is worth doing:** A screen-reader user on itch.io, reporting his
experience with a different roguelike, asked for exactly this: instead of
having to laboriously examine each square, he wanted the game to report
relative position like "5 East 3 North" when looking around — the developer
implemented it as a configurable option in the very next release
([itch.io accessibility thread](https://itch.io/t/3031776/accessibility-suggestions-for-screen-reader-users)).
Vanilla Angband's own `coords_desc` already produces exactly this phrase
format; the port just isn't routing it to the one channel (the live region)
that would make it audible. The brief's framing that "this port already has
ARIA live regions, so accessibility is a live concern, not hypothetical"
applies directly here.

**Proof it does not already exist:**
- `packages/web/src/a11y.ts:1-142` — the whole module is message-log
  announcements (`announce`) plus an unused `alert`/`setStatus` (see
  candidates 5 and 6). Nothing in it is called from the look/target loop.
- `packages/web/src/main.ts:3153-3163` computes `describeLookGrid` every
  frame the look/target loop paints, but only feeds it to `render({desc:
  text, ...})`.
- `packages/web/src/main.ts:5267` — `term.print(0, 0, targeting.desc...)`:
  the description is drawn to the canvas (row 0) only. No call to
  `a11y.announce` or `a11y.alert` anywhere near this code path (checked with
  `grep -n "a11y\." packages/web/src/main.ts`, which returns only the single
  message-log site at line 1022).
- `packages/core/src/game/target.ts:307-312` (`coordsDesc`) and
  `packages/core/src/game/target-loop.ts:139-192` (`describeLookGrid`) are
  faithful ports of `reference/src/target.c` `coords_desc` (L370) and
  `ui-target.c` `target_set_interactive_aux` — confirming the text already
  exists and is already correct; it just never reaches the announcer.

**Suggested default:** ON. Purely additive (a second output channel for text
that's already computed and already shown to sighted players); no reason a
sighted player using assistive tech would want it off, and it does nothing
visible for players who don't use a screen reader.

**Faithfulness risk:** None. Reads already-computed, already-displayed state;
writes to a DOM live region outside `GameState`; draws no RNG; changes
nothing that is saved.

**Implementation sketch:** In `runTargetLoop`'s `paint()`
(`packages/web/src/main.ts:3144-3163`), when `modRuleEnabled(state,
"qol.a11yLookAnnounce")`, call `a11y.announce(text)` alongside the existing
`render({desc: text, ...})`. Should de-duplicate against the previous
announcement (store `lastMon`/`lastText` and skip if unchanged) so cycling
through the *same* grid twice doesn't double-announce. Size: **S**.

**Verdict on scope:** Genuine QoL / accessibility. Not balance (no new
information reaches sighted play or affects outcomes), not a bug fix (nothing
here corresponds to a vanilla defect).

---

### 2. `qol.travelAvoid` — Mark a tile to route around

**Title / description:** "Mark tiles the auto-explore and travel commands
should route around. Stand on (or target) a tile and use the new 'avoid'
command to flag it; auto-explore (`p`) and travel-to-stairs (`>`/`<` with
Autoexplore Commands on) will path around it instead of walking you back into
it."

**What it changes:** Adds a per-level set of "excluded" grids, populated by a
new player command. `pathNearestKnown` / `pathNearestUnknown` (the engines
behind explore and navigate-to-stairs) treat an excluded grid as impassable
for routing purposes only — it's still a real, walkable tile if the player
steps there manually.

**Why it is worth doing:** This is a well-established Dungeon Crawl Stone
Soup feature ("exclusions") that Angband has never had: DCSS lets you mark a
dangerous tile (an `x`-then-`e` command) so autoexplore and travel refuse to
walk you back into it, and will even prompt for confirmation before you walk
into one manually
([CrawlWiki: Exclusion](http://crawl.chaosforge.org/Exclusion),
[DCSS bug tracker #9460, "Show travel exclusions in terrain view"](https://crawl.develz.org/mantis/view.php?id=9460)).
Angband's autoexplore (`p`, `autoexplore_commands`) has the same failure mode
DCSS's exclusions were built to solve: it can walk you right back toward a
known hazard (a discovered vault entrance, a monster pit you noped out of,
etc.) with no way to tell it "not that way."

**Proof it does not already exist:**
- `packages/core/src/game/player-path.ts:970-1005` (`pathNearestKnown`) and
  the neighboring `pathNearestUnknown` take a `pred` callback and an
  `onlyKnown`/`forbidTraps` pair, but no "avoid set" of any kind —
  confirmed by reading the full function bodies; there is no third
  parameter and no per-grid exclusion lookup anywhere in the file (`grep -n
  "exclu\|avoid" packages/core/src/game/player-path.ts` returns nothing).
- `packages/core/src/game/cave-cmd.ts:981-1010` (the `descend`/`ascend`
  autoexplore fallback) and `player-path.ts:1310-1394` (`exploreAction`,
  `navigate-down`/`navigate-up` registration) confirm these are the only
  auto-routing entry points, and none reference an exclusion concept.

**Suggested default:** ON (the mod adds a new command; with no tiles ever
marked, behavior is identical to today).

**Faithfulness risk:** No RNG. This is new player-authored state that isn't
part of vanilla's save format at all (vanilla has nothing like it); it
should ride the save per-level (or per-character) the way the port's other
UI-only annotations do, but must be additive — an old save without the field
should simply load with an empty exclusion set. Flag explicitly for extra
scrutiny per the brief: **this does touch what gets saved** (a new,
non-upstream data field), even though it draws no RNG and changes no
gameplay math.

**Implementation sketch:** A new `Set<index>` (or per-level `Map<depth,
Set<index>>`) alongside existing per-level state (near where `Chunk`/level
data already lives, e.g. `packages/core/src/world/chunk.ts` neighbors), a new
command (e.g. bound near the existing `explore`/`navigate-*` commands in
`packages/core/src/game/player-path.ts:1388-1394`), and a `pred`-level check
threaded into `pathNearestKnown`/`pathNearestUnknown`'s candidate-selection
loop (`player-path.ts:970-1013`, `~1049` onward). Size: **M/L** — the
pathfinding change is small, but persistence (deciding whether this is
per-level or global, and adding a save-compatible field) and a discoverable
UI (marking/unmarking, showing what's marked) are real work.

**Verdict on scope:** Genuine QoL — pure routing convenience, no change to
what's dangerous or what you can reach on foot. Watch the faithfulness note
above; this is the one candidate in this list that adds a new save-format
field, so it deserves the most scrutiny of the group.

---

### 3. `qol.colorblindPalette` — Colorblind-safe palette preset

**Title / description:** "Switch to a colorblind-safe replacement palette
with one keystroke, instead of hand-editing all 16 colors. Reversible at any
time from the same screen."

**What it changes:** Adds a single keypress in the existing colour editor
(`=` → `c`) that swaps the entire live 16-color table for a curated,
colorblind-safe alternative (built from published-safe values), using the
color-table machinery that already exists. Turning the flag off (or pressing
the key again) restores the default table.

**Why it is worth doing:** Vanilla Angband's colour editor is a raw RGB
tweaker — useful, but it asks a colorblind player to redesign the whole
palette themselves, one channel at a time. Modern accessibility guidance is
explicit that games should offer curated colorblind presets rather than
expect players to build their own: "Offer preset color schemes optimized for
deuteranopia, protanopia, and tritanopia... along with a custom option" and
that these presets should come from research, not guesswork
([Chris Fairfield, "Unlocking Colorblind Friendly Game Design"](https://chrisfairfield.com/unlocking-colorblind-friendly-game-design/);
general guidance also at
[Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/ensure-no-essential-information-is-conveyed-by-a-fixed-colour-alone/)).
Angband leans heavily on color to distinguish monster/item danger at a
glance (e.g. `purple_uniques`), so this is a real accessibility gap, not a
cosmetic one.

**Proof it does not already exist:**
- `grep -rin "colorblind\|protanop\|deuteranop\|tritanop" packages/` (whole
  repo, excluding `node_modules`) returns **zero** hits.
- `packages/web/src/colors.ts:1-138` is the entire colour system: a manual
  per-channel RGB editor (`runColorsEditor`) faithfully mirroring
  `do_cmd_colors` / `colors_modify` (`ui-options.c` L876-979). There is no
  preset table and no alternate palette anywhere in it.

**Suggested default:** OFF. Unlike the other items here, this changes what
every color on screen looks like; a player should opt in rather than have
their default palette silently swapped. (This is the one candidate in the
list I'd default OFF even though the mod's general convention is ON — see
the open question below about whether that's the right call.)

**Faithfulness risk:** None on state/RNG/save — the color table is already a
user-global pref (`localStorage`, not the save file, per `colors.ts:9-11`),
exactly like the existing manual edits. No gameplay math changes; only pixel
colors.

**Implementation sketch:** Add a `COLORBLIND_PRESET: number[][]` table (16
rows matching `COLOR_TABLE`'s shape) and a new key (e.g. `b`) in
`runColorsEditor`'s `onKey` (`packages/web/src/colors.ts:115-133`) that calls
the existing `restoreColorTable` with the preset, gated by
`modRuleEnabled(state, "qol.colorblindPalette")`; persist via the existing
`saveColorPrefs`. Size: **S** (mechanism entirely exists; only the preset
data and one key handler are new). The real work is picking defensible
preset values, which should cite a colorblind-safe source rather than be
invented.

**Verdict on scope:** Genuine accessibility QoL. Not balance (same
information, different color mapping).

---

### 4. `qol.gearLoadouts` — Save and swap named equipment sets

**Title / description:** "Save your current worn equipment as a named
loadout, and swap back to it later with one command — each item still gets
worn/taken off exactly like doing it by hand, one at a time, at normal turn
cost."

**What it changes:** Adds a small player-side registry (a few named lists of
"item X in slot Y") and one new command that, given a saved loadout, issues
the same wear/take-off actions the player would issue manually, in sequence,
against present-day equipment. It does not change what wearing/removing an
item costs, nor whether an item is available — if a saved loadout's item is
missing (dropped, sold, destroyed), that slot is simply skipped.

**Why it is worth doing:** This is a widely-adopted convenience in modern
RPGs and roguelikes for exactly the tedium Angband players hit constantly —
swapping between a "kill things" set and a "read a scroll of X" or
"resist Y" set costs several turns of menu navigation each time, discouraging
useful tactical swaps the game otherwise rewards (e.g. swapping a
light-of-see-invisible on and off, or a ring of free action before a
paralysis-heavy fight). Tangledeep ships exactly this: "Pressing F1, F2, and
F3 will swap your loadouts quickly" ([Steam Community guide, "How To Quick
Swap Between Loadouts"](https://steamcommunity.com/sharedfiles/filedetails/?id=2868747735);
[Tangledeep Wiki, Key Bindings](https://tangledeep.fandom.com/wiki/Basics/Menus/Key_Bindings)).

**Proof it does not already exist:**
- `grep -rn "loadout" packages/` returns no hits.
- `packages/web/src/equip-cmp.ts` (the equipment-comparison screen) lets you
  *compare* worn/carried/floor/store items side by side, but has no
  save/recall-a-set feature (confirmed by reading the whole file,
  `equip-cmp.ts:1-305` — its commands are navigation, source filter,
  attribute view, reverse, and item-vs-item compare only).
- Vanilla Angband's keymap system (`reference/src/ui-options.c` L586-763,
  ported at `packages/web/src/keymap-edit.ts`) can bind a key to a fixed
  sequence of keystrokes, but a keymap's keystrokes are literal ("press w,
  then press the letter currently in slot c") — it breaks the moment
  inventory letters shift, which is exactly why a loadout needs to resolve
  "the item I saved," not "the letter I pressed," at swap time.

**Suggested default:** ON (inert until the player actually saves a loadout).

**Faithfulness risk:** Low. Each swap still issues normal wear/take-off
commands at normal energy cost — this cannot make a turn free or change what
is legal to wear. No RNG beyond whatever wearing/removing an item already
draws (nothing, faithfully). Does add new save-side state (the named
loadouts); should be additive/optional in the save format, same caution as
candidate 2.

**Implementation sketch:** A new small registry (e.g.
`Record<string, Array<{tval, sval-ish identity, slot}>>` — needs a stable
way to re-identify "the same kind of item" across inventory-letter churn,
likely by object identity/kind rather than letter) and a driver that, for a
chosen loadout, calls the existing wear/take-off command handlers
(`packages/core/src/game/gear.ts` / wherever `wear`/`takeoff` register) once
per differing slot. Size: **M** — the swap driver is straightforward; the
"what does 'the same item' mean across a played session" identity question
and the UI to name/manage loadouts are the real cost.

**Verdict on scope:** Genuine QoL. It changes keystrokes, not what is
possible or what anything costs.

---

### 5. `qol.a11yDeathAlert` — Wire the existing (unused) assistive-tech death alert

**Title / description:** "Announce death and other critical moments through
an assertive screen-reader alert that interrupts, in addition to the normal
message log."

**What it changes:** `a11y.ts` already builds an ARIA `role="alert"` region
specifically described as being "for the few things that must interrupt
(death, 'you die')" — but nothing in the app ever calls it. This wires the
existing `a11y.alert(text)` to the death path (and could extend to a small,
deliberately short list of similarly critical, rare moments) so a
screen-reader user gets an assertive interruption instead of relying on the
polite log queue, which can be buried under other messages in the same turn.

**Why it is worth doing:** This isn't proposing new design — it's finishing
a feature this codebase's own author already designed and half-built. Dying
without your screen reader noticing (because the death message got queued
behind other polite announcements) is about as bad an accessibility gap as a
roguelike can have.

**Proof it does not already exist:**
- `packages/web/src/a11y.ts:23-30` declares `alert(text: string): void` on
  the `A11y` interface with the doc comment "Announce something urgent
  (assertive: interrupts, e.g. death)"; the implementation is at
  `a11y.ts:132-137`.
- `grep -rn "a11y\.alert\|\.alert(" packages/web/src/*.ts` (excluding tests)
  returns **zero** call sites. The region is built, styled, and inserted
  into the DOM (`a11y.ts:111-118`) but never written to.

**Suggested default:** ON.

**Faithfulness risk:** None — pure DOM/announcer wiring, no game-state
reads or writes beyond the death event that already exists.

**Implementation sketch:** Find the death handling in `main.ts` (the same
place that triggers the score/Hall-of-Fame flow) and add
`a11y.alert("You die.")` (or the game's actual death message text) gated by
`modRuleEnabled(state, "qol.a11yDeathAlert")`. Size: **S**.

**Verdict on scope:** Accessibility QoL, but see the open question below —
this is arguably closer to "finish a shipped feature" than "add a new one,"
and it's not obvious it should be an opt-out toggle at all rather than
always-on infrastructure like `announce()` already is.

---

### 6. `qol.a11yStatusKey` — On-demand full status readout for screen readers

**Title / description:** "Press a key at any time to have your current HP,
SP, depth, and active status effects read aloud — useful when using a screen
reader, where the sidebar isn't otherwise announced."

**What it changes:** Wires the existing, also-unused `a11y.setStatus(text)`
hook to a new keybinding that builds a one-line summary of the sidebar's
current numbers (already-public information: HP/SP, depth, hunger/status
words) and announces it on demand.

**Why it is worth doing:** The sidebar is drawn to canvas only; a
screen-reader user currently learns their HP only when it changes and gets
announced as a combat message — there's no way to just ask "what's my status
right now" the way a sighted player glances at the sidebar. The itch.io
accessibility thread cited in candidate 1 makes the same general point about
wanting on-demand, non-visual access to information sighted players get for
free by glancing at the screen
([itch.io accessibility thread](https://itch.io/t/3031776/accessibility-suggestions-for-screen-reader-users)).

**Proof it does not already exist:**
- `packages/web/src/a11y.ts:28-30` declares `setStatus(text: string): void`
  ("Update the terse status summary (depth / HP), read on demand"),
  implemented at `a11y.ts:138-140`, building a `role="status"` live region
  (`a11y.ts:95-101`).
- `grep -rn "setStatus(" packages/web/src/*.ts` (excluding tests) returns
  **only the declaration and implementation** — no caller anywhere, and no
  keybinding of any kind reaches it.

**Suggested default:** ON.

**Faithfulness risk:** None — read-only summary of already-displayed sidebar
data, no state mutation.

**Implementation sketch:** Build the summary string from the same
`sidebarModel`/`statusLineModel` data the visible sidebar already uses
(`packages/core/src/game/display.ts:495-561, 806-824`), bind a free key (the
game's help screen — `packages/web/src/help.ts` — would need one documented
line added), call `a11y.setStatus(summary)` gated by
`modRuleEnabled(state, "qol.a11yStatusKey")`. Size: **S**.

**Verdict on scope:** Accessibility QoL; same "finishing existing scaffolding"
character as candidate 5.

---

### 7. `qol.lightFuelSidebar` — Always show remaining light-source fuel

**Title / description:** "Show your light source's remaining turns in the
sidebar, instead of having to inspect it to check."

**What it changes:** Adds one more row/segment to the sidebar showing the
current light source's remaining fuel (the same number already visible via
item inspection), updated live.

**Why it is worth doing:** This is exactly the "surfacing information the
player would otherwise track on paper" case from the brief: remaining torch
turns is fully known to the player (inspect the item any time, `I`), but
tracking it means periodically re-inspecting your own light source, which is
pure bookkeeping with no decision content — the decision ("should I swap
torches now") is only interesting once you know the number, and Angband
already lets you know the number for free, just not conveniently.

**Proof it does not already exist:**
- `packages/core/src/game/display.ts:495-521` (`sidebarModel`) lists every
  sidebar row: race, title, class, level, exp, gold, equippy, six stats, ac,
  hp, sp, health, speed, depth. No fuel/light-turns row.
- `packages/core/src/game/display.ts:806-824` (`statusLineModel`) lists the
  11 status-line indicators (level_feeling, light, moves, unignore, recall,
  descent, state, study, tmd, dtrap, terrain); the `light` entry here is a
  faithful port of `reference/src/ui-display.c`'s light-radius/lit-grid
  indicator, not a fuel countdown (confirmed by reading `lightRuns` in
  `display.ts` and cross-checking `reference/src/ui-display.c`'s
  corresponding handler) — so this is a different, already-faithful feature,
  not a near-miss of this candidate.

**Suggested default:** ON.

**Faithfulness risk:** None — same underlying number the player can already
see via inspect; only the display surface is new. No RNG, no save-format
change (it's a render of existing gear state).

**Implementation sketch:** Add a `fuel` field/row to `sidebarModel`
(`packages/core/src/game/display.ts:495-521`) reading the equipped light
source's `timeout`/fuel field (already tracked for the item itself), and a
matching render line in `renderSidebar` (`packages/web/src/main.ts:4909+`),
both gated by `modRuleEnabled`. Size: **S**.

**Verdict on scope:** Genuine QoL. Zero new information; only removes a
manual inspection step.

---

### 8. `qol.messageLogSearch` — Search within the message history screen

**Title / description:** "Search the message history (Ctrl-P) for text —
press `/` while viewing it to jump to the next matching line."

**What it changes:** Adds a `/`-triggered substring search inside the
existing Ctrl-P message-history screen only (not the live top line, not any
other text screen), letting the player jump forward/backward between lines
containing a typed substring (e.g. find the last time a specific monster
name or item name appeared).

**Why it is worth doing:** The message history can run to 2048 entries
(`MAX_MESSAGES`), all rendered as one long scrollable list with no way to
jump to a specific past event other than paging by eye. This is a standard
convenience in long-scrollback tools generally (log viewers "support text
searches and jumping from match to match"; MUD clients like Mudlet build
scrollback search into the base client
([Mudlet Manual: General Features](https://wiki.mudlet.org/w/Manual:General_Features))).
**I want to be upfront that this citation is weaker than the others in this
list** — I could not find a specific celebrated roguelike that does this
(Cogmind's message log, for instance, is deliberately kept small and does
not appear to have search —
[Grid Sage Games, "Message Log"](https://www.gridsagegames.com/blog/2014/02/message-log/)).
This is borrowed from adjacent tools (log viewers, MUD clients) rather than
established as roguelike genre convention; rank and confidence adjusted
accordingly.

**Proof it does not already exist:**
- `packages/web/src/messages.ts:47-99` (`MessageLog`) has no search/filter
  method — `push`, `latest`, `latestEntry`, `takeFresh`, `markSeen`, `all`
  only.
- `packages/web/src/screens.ts:1035-1038` (`messageHistoryLines`) is a
  straight map from the log to display lines, no filtering.
- `packages/web/src/overlay.ts:107-160` (`showTextScreen`, the generic
  scroll-and-ESC viewer Ctrl-P uses) supports only scrolling — reading the
  whole function shows no keyboard case beyond scroll/page/ESC.
- `packages/web/src/main.ts:5659-5665` — the Ctrl-P binding just calls
  `showTextScreen(term, "Message history", messageHistoryLines(msglog))`
  with no extra behavior layered on.

**Suggested default:** ON.

**Faithfulness risk:** None — a read-only navigation aid over an
already-faithful log; no state mutation, no RNG, nothing saved differently.

**Implementation sketch:** Either a Ctrl-P-specific variant of
`showTextScreen`, or a small optional `onKey` extension point added to it,
handling `/` (prompt for a substring inline on the header row, reusing
existing inline-prompt code already present elsewhere e.g. `shop.ts`'s
`getQuantity`) and `n`/`N` to repeat forward/backward. Size: **S/M**.

**Verdict on scope:** Genuine QoL, though the lowest-confidence prior-art
citation in this list — flagged honestly above rather than oversold.

---

### 9. `qol.levelNotes` — Player-authored notes pinned to a location

**Title / description:** "Leave yourself a short note at your current
location, viewable later from a notes list — e.g. 'good shop, come back with
more gold' or 'skip this vault, too risky'."

**What it changes:** A small, purely player-authored, free-text annotation
attached to a location (current level + grid, or just current level), viewed
from a new list screen. Does not affect gameplay, monsters, or generation in
any way — pure memory aid.

**Why it is worth doing:** Long, opaque roguelikes like Angband produce a
lot of "I should remember this for later" moments (an unexplored vault, a
shop with something you can't afford yet, a level you want to avoid on
return) that today only live in the player's head or an external text file.
Dungeon Crawl Stone Soup ships exactly this as a core feature — level
annotations settable from the dungeon overview screen, explicitly requested
and implemented as a genre convenience rather than a mechanic
([DCSS bug tracker #5484, "New sub-command in map-mode ('X') that allows to
annotate any level"](https://crawl.develz.org/mantis//bug_view_advanced_page.php?bug_id=5484);
[DCSS bug tracker #8714, "Change level annotations from Dungeon
Overview"](https://crawl.develz.org/mantis/view.php?id=8714)).

**Proof it does not already exist:**
- `grep -rn "annotation\|level.?note\|playerNote" packages/core/src/game
  packages/web/src` (excluding the unrelated `bugfix.*` player-history
  note-truncation entry in `docs/modding/BUG_FIXES.md`, which is about the
  *vanilla* `/say`/`/me` command and is explicitly **not yet ported** per
  that doc's entry 1) returns no hits.
- The port's character auto-history (`historyLines`,
  `packages/web/src/screens.ts:1044-1063`) is a faithful, game-generated
  event log (kills, level-ups, artifacts) — it is not player-editable and
  cannot hold a free-text note, so it does not already cover this.

**Suggested default:** ON.

**Faithfulness risk:** None on RNG. Adds new, non-upstream save-side state
(same caution as candidates 2 and 4) — must be additive so an old save
without any notes loads cleanly.

**Implementation sketch:** A `Record<levelKey, string[]>` (or similar) kept
alongside other per-character UI-only data, a small "add note"/"view notes"
pair of screens reusing existing list/prompt machinery
(`selectFromMenu`/`showTextScreen` in `overlay.ts`). Size: **S/M**.

**Verdict on scope:** Genuine QoL — it is inert data with no gameplay
reading of it anywhere; explicitly not a hint system (the player writes
their own notes, the game contributes nothing).

---

### 10. `qol.autosaveIndicator` — Visible confirmation when the game autosaves

**Title / description:** "Show a brief, unobtrusive 'saved' indicator each
time the game autosaves, so it's clear it's safe to close the tab."

**What it changes:** A small, self-clearing status-line note (reusing the
existing message/status line, not a modal) each time the throttled
background autosave actually writes, mirroring the message the *manual* save
command already shows.

**Why it is worth doing:** The port's autosave is already excellent
(throttled during play, forced on level change, forced on
`pagehide`/`visibilitychange`/`beforeunload` — see below) but it is
completely silent; only the explicit `S` "Save" key shows "Game saved."
Browser players closing a tab have a real, common anxiety about whether
their progress is safe that native/console games solve with a visible
save-indicator convention — "the autosave icon serves to remind you [it's
safe]... some games show a spinning hourglass... others display 'Saving
Game'" ([Auto-Save, TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/Autosave)).
Player feedback on the *opposite* problem (unclear/annoying save icons) is
just as strong — "games need to be more specific with what the 'autosave
icon' is actually saving" and indicators "should always be able to be
switched off" ([NeoGAF thread](https://www.neogaf.com/threads/games-need-to-be-more-specific-with-what-the-autosave-icon-is-actually-saving.749252/),
[NeoGAF thread](https://www.neogaf.com/threads/autosave-icons-destroy-immersion-and-surprises-and-should-always-be-able-to-be-switched-off.1589054/))
— which is exactly why this fits the mod's per-flag opt-out model rather than
being unconditional.

**Proof it does not already exist:**
- `packages/web/src/main.ts:3995-4001` (`autosave`): the throttled path
  calls `persistSave()` directly with **no** message/UI feedback of any
  kind.
- Contrast `packages/web/src/main.ts:6088`, the explicit Save action:
  `["Save", () => { autosave(true); message = "Game saved."; render(); }]`
  — confirming the port already has the exact convention (a status-line
  message) this candidate would extend to the silent автосave path.

**Suggested default:** ON, but this is the strongest candidate in the list
for "should default OFF instead" given the "should always be able to be
switched off" complaint above — see open questions.

**Faithfulness risk:** None — pure UI feedback on an event (a completed
autosave) that already happens every time, unconditionally, today.

**Implementation sketch:** In `autosave()` (`main.ts:3995-4001`), on the
throttled (non-`force`) path, after a successful `persistSave()`, briefly set
`message` to something like "(saved)" the way the manual path already does,
gated by `modRuleEnabled`. Size: **S**.

**Verdict on scope:** Genuine QoL. Purely informational; changes nothing
about when or how saving happens.

---

### 11. `qol.storeQuantityMemory` — Remember your last quantity in shops

**Title / description:** "Store buy/sell/take quantity prompts start
pre-filled with the amount you entered last time, instead of always starting
at 1."

**What it changes:** The store's "how many?" prompt (buying, selling, taking
from home) pre-fills with the last quantity the player actually entered in
that kind of prompt this session, instead of unconditionally starting at
`"1"`.

**Why it is worth doing:** This is a small one — flagged honestly as the
weakest-value candidate in this list — but it's a real, repeated keystroke
tax: buying the same stack size of a consumable (e.g. "5 potions of cure
light wounds") across multiple visits means retyping the quantity every
time, when the previous quantity is usually still what's wanted.

**Proof it does not already exist:**
- `packages/web/src/shop.ts:298-330` (`getQuantity`): `let buf = "1";` is
  unconditional — the prompt always starts at "1" regardless of session
  history (matching vanilla's `textui_get_quantity`, `ui-input.c` L1206,
  faithfully — this is not a bug, just a default with no memory).

**Suggested default:** ON.

**Faithfulness risk:** None — a UI-only default-value change to a prompt the
player can already freely edit or override (typing a different number, `*`
for all, or 0/Escape to cancel all work exactly as before).

**Implementation sketch:** A small module-level (or per-session) "last
quantity" variable in `shop.ts`, read as the initial `buf` in `getQuantity`
(`shop.ts:298-310`) instead of the literal `"1"`, gated by
`modRuleEnabled`. Size: **S**.

**Verdict on scope:** Genuine, if minor, QoL. Listed last among the
higher-confidence items because its value is modest — included for
completeness rather than because it's a standout.

---

### 12. `qol.sessionPlaytimeClock` — Show real-world elapsed session time

**Title / description:** "Show how long you've been playing this session
(real-world time, not game turns) on the character screen."

**What it changes:** A small, view-only real-world elapsed-time readout
(e.g. on the character sheet, `C`), tracking wall-clock time since the
current play session started (or since the character was created, whichever
is more useful — open question below).

**Why it is worth doing:** Angband tracks game-turns exhaustively but has no
concept of real-world time at all; a long, absorbing roguelike session is
exactly the kind of play where "respecting player time" (an explicit research
prompt in this brief) matters — a light, glanceable reminder of how long
you've actually been sitting there is a small nod to healthy pacing without
being preachy about it, similar in spirit to Extra Credits' point that
respecting player time means "offering... opportunities to put down the
controller when they feel they've reached a good stopping point"
([Extra Credits, "Exit Points"](https://www.thetvdb.com/series/extra-credits/episodes/5219354) — **I
was only able to confirm this via a secondary listing, not the original
video/article; treat this citation as weak** and the general point as more
important than the specific source).

**Proof it does not already exist:**
- `grep -rn "playtime\|sessionClock\|elapsed.*time\|wall.?clock" packages/`
  returns no hits related to a real-world timer; the port's `turn`/`moves`
  displays (`display.ts` `movesRuns`, sidebar's game-turn counters) are all
  in-game turn counts, faithfully mirroring vanilla, not wall-clock time.

**Suggested default:** OFF — this is the candidate I'm least sure players
actually want visible by default (see open question); easy to argue it
should default on too.

**Faithfulness risk:** None — purely additive display data with no
gameplay meaning; if saved at all, it's advisory only (a stale/missing value
on an old save should just show "unknown" or reset, never break anything).

**Implementation sketch:** A start-of-session timestamp captured once at
boot/resume, a small elapsed-time formatter, and one new line on the
character sheet (`packages/web/src/charsheet.ts`). Size: **S**.

**Verdict on scope:** Weakest-justified candidate in the list by prior-art
strength (see the citation caveat above) — kept in because the underlying
idea (session-time awareness, not in-game-turn awareness) is genuinely new
and genuinely not balance/bug-fix/rules, but I'd understand a reviewer
cutting it.

---

### 13. `qol.inputDebounce` — Minimum interval between accepted movement keys

**Title / description:** "Ignore a repeated movement key if it arrives
faster than a configurable minimum interval, to reduce accidental
double-moves from tremor or key-repeat."

**What it changes:** A short (e.g. tens-of-milliseconds), player-tunable
minimum gap enforced between two consecutive *accepted* movement keypresses,
so an accidental double-tap (tremor, a sticking key, OS key-repeat firing
before the player releases) doesn't spend an extra, unwanted turn.

**Why it is worth doing:** The brief specifically calls out motor
accessibility as a live research topic. I was **not able to find a specific
roguelike that ships this** — the closest analogues I found were general
platform-level accommodations (OS "Slow Keys"/"Bounce Keys," not
game-specific), which weakens the prior-art case considerably; I'm including
it because the underlying need (protecting a player with a motor impairment
from unintended repeated input) is well established in accessibility
practice generally, not because I found an example inside the genre.
**I am genuinely unsure whether this belongs in a game at all versus being
purely the OS/browser's job** (most operating systems already offer this at
the system level) — see the open question below.

**Proof it does not already exist:**
- `packages/web/src/input-queue.ts:1-81` — the entire pending-input queue
  module is about sequencing *synthesized* keymap output one keystroke per
  macrotask; it has nothing to do with debouncing *real* user keydown events,
  and there is no other debounce/throttle logic for raw input anywhere else
  in `packages/web/src` (checked via `grep -rn "debounce\|throttle" packages/web/src`,
  no hits outside unrelated throttled-autosave timing already covered by
  candidate 10).

**Suggested default:** OFF (a change to input timing should be opt-in, not
silently applied to everyone).

**Faithfulness risk:** None on RNG/save. Slight risk of *feeling* like a
balance change if the interval is too aggressive (dropping an intentional
fast keypress in a genuinely time-pressured moment) — this is a real design
risk to get the interval right, even though it's not a rules change.

**Implementation sketch:** A small guard in the movement-key handling path
(wherever raw `keydown` is turned into a `walk` command in `main.ts`),
comparing `performance.now()` against the last *accepted* movement key's
timestamp, gated by `modRuleEnabled` with a configurable interval. Size: **S**.

**Verdict on scope:** Honestly the shakiest candidate here on both prior-art
and "is this even this game's job" grounds — included transparently as a
low-confidence item rather than either oversold or silently dropped. See the
open question below.

---

## Rejected candidates

- **Always-visible level feeling in the sidebar.** Already faithful vanilla
  and already ported. `prt_level_feeling` (`reference/src/ui-display.c:1053`,
  part of the `status_handlers[]` table at `ui-display.c:1297`) is vanilla's
  own always-on status-line indicator; the port's `levelFeelingRuns`
  (`packages/core/src/game/display.ts:564-577`) and `statusLineModel`
  (`display.ts:806-824`, `key: "level_feeling"`) already implement it, and
  `packages/web/src/main.ts:4949-4959` (`renderStatusLine`) already draws it
  every frame. (I found an old, 2014-era Angband forum thread proposing this
  exact feature — [angband.live, "Showing level feelings at
  status"](https://angband.live/forums/forum/angband/development/6632-showing-level-feelings-at-status)
  — which is presumably how/why it was later adopted into mainline; a good
  reminder that "an old forum complaint" is not proof a gap is still open.)
- **Autoexplore / travel-to-stairs.** Already vanilla (`autoexplore_commands`
  option, `reference/src/list-options.h:16`) and already ported: `descend`/
  `ascend` fall through to `navigate-down`/`navigate-up`
  (`packages/core/src/game/cave-cmd.ts:981-1010`), and `p` (explore) is bound
  and working (`packages/web/src/main.ts:5915`, `4554-4556`,
  `packages/core/src/game/player-path.ts:1310-1394`). Note: I found one
  stale comment claiming otherwise —
  `packages/web/src/options.ts:58`, "autoexplore_commands - no autoexplore
  command exists in this port" — which is simply **incorrect** as of this
  reading; flagged as a documentation bug for the reviewer, not something I
  fixed (out of scope for this research task; see open questions).
- **Inscription-based quick item selection (`@q1`-style hotbar).** Investigated
  as a possible "quick-use hotbar" QoL idea. Vanilla's general `@`-inscription
  quick-select (used with `get_item` for any command) does not appear to be
  ported beyond the fire/throw-specific quiver-slot preference
  (`packages/core/src/game/gear.ts:265-284`, `preferredQuiverSlot`) — a
  broader search (`grep -rn "quickSelect\|@[a-z0-9]" packages/core/src/obj`)
  found nothing else. Because this is a **vanilla feature that may simply not
  be ported yet**, building a QoL "hotbar" here would risk re-implementing
  (badly) something that should instead be a core-parity fix. Rejected as
  out-of-scope for the QoL mod either way — flagged as an open question for
  the reviewer to confirm.
- **Pickup would-exceed-carry-capacity warning.** Rejected as **not
  implementable yet**, not as a bad idea. The port's own comment says the
  encumbrance/overweight formula is deferred:
  `packages/core/src/game/char-sheet.ts:104-105` ("the encumbrance formula is
  deferred (player/calcs.ts)"). There is nothing to warn against yet.
- **Danger preview before descending / before reading an unidentified
  scroll.** Rejected as balance, not QoL. Vanilla already faithfully confirms
  genuinely irreversible or costly actions (e.g. Deep Descent:
  `packages/core/src/game/effect-general.ts:658`, `confirm("Are you sure you
  want to descend? ")`, matching upstream `get_check`); going further and
  previewing hidden information (what a level or an unidentified item
  actually is) before the player commits would remove the risk/reward tension
  that is the point of the mechanic, not just the tedium around it.
- **Roll back to a recent autosave / save-corruption recovery.** Considered
  and rejected as too close to save-scumming to build confidently. A pure
  "protect against a corrupted save file" safety net is defensible in the
  abstract, but any implementation that lets a player return to an earlier
  point after a bad outcome (a lost fight, a bad potion) is exactly what
  decision 16 (no save-scumming, death terminal) forbids, and I don't trust
  myself to draw that line correctly from a research pass alone. Moved to
  open questions instead of proposed.
- **A command palette / fuzzy command search.** Considered (modern editors
  and some games offer "type to find a command"). Rejected for weak
  prior-art within the genre specifically — I could not find an established
  roguelike precedent (as opposed to general application UX) and the port
  already has a full, documented help/command-list screen
  (`packages/web/src/help.ts`), reducing the marginal value.
- **Persistent corner minimap overlay.** Considered (an always-visible
  miniature of the explored level, versus the existing on-demand `M` overview
  screen). Rejected/deferred rather than proposed: I could not confidently
  assess terminal-grid screen-real-estate feasibility without design work
  that's out of scope for a research pass, and it risks visual clutter
  concerns a reviewer should weigh directly. Raised as an open question
  instead.
- **Adjustable spell-fail-chance display, "always show full numeric hunger
  clock," monster health always numeric, etc.** All rejected as **already
  present**: spell fail% is already shown in the spellbook browser
  (`packages/web/src/screens.ts:315,678`); hunger/status words and the
  health bar are already faithful vanilla status-line/sidebar fields
  (`display.ts:806-824`, `495-521`).
- **Character/roster comparison screen.** Considered (compare stats across
  the port's own multi-character roster, `packages/web/src/roster.ts`).
  Rejected as low-confidence/niche — this is a port-native feature with no
  vanilla or genre precedent to anchor "is this table-stakes," and I did not
  have time to verify demand for it; would need the reviewer's judgment call
  rather than mine.

## Already present, for the record

Confirmed already faithful/ported while researching the candidates above —
listed so the same ground isn't re-covered by a future pass:

- **Level feeling always visible** (status line): see "Rejected" above.
- **Autoexplore / travel-to-known-stairs** (`p`, `>`/`<` with
  `autoexplore_commands`): see "Rejected" above.
- **Equipment side-by-side comparison**: `packages/web/src/equip-cmp.ts`
  (full resistance/ability grid, item-vs-item compare via `x`/`I`).
- **Spell fail% shown in the spellbook browser**:
  `packages/web/src/screens.ts:315,678`.
- **Sound cues per message type** (`use_sound`, faithful `sound.cfg`-style
  event table): `packages/web/src/sound.ts` (`SOUND_PREF_ENTRIES`).
- **Manual color editing** (not colorblind-specific, but the underlying
  mechanism): `packages/web/src/colors.ts`.
- **Robust, mostly-invisible autosave** on level change, throttled during
  play, and forced on tab hide/close: `packages/web/src/main.ts:3990-4001,
  6122-6132`, `packages/web/src/pwa.ts:18-19,47`.
- **Character dump / file download** (the file-based `f` dump command) and a
  **screenshot PNG download**: `packages/web/src/charsheet.ts:513-557`,
  `packages/web/src/main.ts:4588-4596`.
- **Message log / scrollback (Ctrl-P), searchable/filterable knowledge and
  object menus, item inspection (`I`), character sheet with history** — all
  already documented as present in `docs/modding/QOL.md:67-79`; independently
  re-confirmed while researching candidate 8 (message log has scroll but not
  *search*, which is the actual gap identified there).
- **Rest-until-full / rest-until-something-happens** (`&`, `*`, `!`):
  faithful `REST_COMPLETE`/`REST_ALL_POINTS`/`REST_SOME_POINTS`,
  `packages/web/src/main.ts:3651-3748`.
- **Confirmation prompts before risky/irreversible actions** (dropping worn
  gear, casting beyond available mana, descending via Deep Descent,
  retiring, starting a new character over an existing one): all faithful
  `get_check`-equivalents, e.g. `packages/web/src/main.ts:2100-2119,
  2313-2316, 3619-3628, 4147-4154`.

## Open questions for the reviewer

1. **Is the QoL/balance line drawn in the right place for "danger preview"
   ideas?** I rejected previewing hidden information (next level's danger,
   an unidentified item's true nature) as balance rather than QoL, on the
   theory that removing risk/reward tension is a rules change even when it's
   framed as "reducing friction." I believe this is right, but it's the
   single judgment call in this document I'd most want checked, because the
   brief explicitly invited me to push back if I thought the line was drawn
   wrong, and I could see an argument that *some* forms of legibility (e.g.
   "this looks dangerous, are you sure?") are meaningfully different from
   *others* (e.g. "here is exactly what's on the next level").
2. **`qol.colorblindPalette` default.** I suggested OFF, breaking the mod's
   general "QoL defaults ON" convention, because it changes every on-screen
   color rather than adding a channel. Is that the right call, or should it
   be ON like everything else (nothing stops a player from turning it back
   off if they don't want/need it)?
3. **`qol.autosaveIndicator` default**, similarly — general player feedback
   on autosave indicators is mixed (helpful for some, "should always be
   switchable off" for others, cited above); I defaulted it ON but flagged
   this as the shakiest ON default in the list.
4. **Are `qol.a11yDeathAlert` and `qol.a11yStatusKey` really "mod" material?**
   Both are finishing pre-existing, designed-but-never-wired accessibility
   scaffolding (`a11y.ts`'s `alert`/`setStatus`) rather than adding new
   behavior. `a11y.announce` (the one hook that *is* wired) is unconditional,
   not gated behind any flag at all, because it can only help and never
   hurts. Should these two follow the same "just ship it, no toggle needed"
   path instead of going through the Fixes & tweaks menu? I included them as
   flags to be safe (some player might specifically want the polite log but
   not assertive interruptions), but I'm not confident that's the right
   default posture for pure-accessibility infrastructure completion.
5. **`qol.inputDebounce`: game responsibility or OS responsibility?** Flagged
   in the candidate itself — I could not find a roguelike-specific precedent,
   and most motor-accessibility keyboard accommodations (debounce/bounce
   keys, slow keys) are traditionally an OS-level feature, not a per-game
   one. Worth a real accessibility-focused second opinion before building.
6. **The stale `options.ts:58` comment.** While verifying the autoexplore
   rejection, I found `packages/web/src/options.ts:58` still claims "no
   autoexplore command exists in this port," which is incorrect given
   `cave-cmd.ts` and `player-path.ts`. This is a one-line documentation fix,
   not a QoL item, and out of scope for me to change under this brief — but
   worth a ticket so a future reader doesn't take that comment at face value
   the way an earlier pass evidently did when writing it.
7. **The vanilla `@`-inscription quick-select gap.** Also surfaced while
   researching a hotbar idea (see "Rejected"): the general inscription-driven
   quick-item-select for arbitrary commands does not appear to be ported
   beyond the fire/throw quiver case. If that's confirmed as a genuine
   parity gap rather than something I simply didn't find, it belongs on the
   core-parity backlog, not this list — I did not chase it further because
   it's outside this brief's scope, but it seemed worth flagging rather than
   silently dropping.
8. **`qol.travelAvoid` and `qol.levelNotes` both add new save-format
   fields** — the only two candidates in this list that do. Both are
   designed to be strictly additive (an old save loads fine with the field
   simply absent/empty), but both deserve the "does this touch what is
   saved" scrutiny the brief calls for more than anything else here, and I'd
   want the save-system owner's sign-off specifically on those two before
   either is built, independent of the general QoL review.
