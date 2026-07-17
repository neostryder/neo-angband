# Neo Angband parity closure record (Waves 1-4, 2026-07-17)

Single source of truth for the port's true parity state after the WP-1..WP-18
parity waves. Mandate: 100% exact parity with Angband 4.2.6 (reference/src the
oracle); only permitted differences are web-platform UI necessities and the
additive mod system. Wizard/debug mode and the cheat options page ARE in scope.

Read this first; the per-gap detail lives in parity/GAP_AUDIT.md (its "Wave 1-4
closure summary" section is the authoritative per-gap re-mark). This doc gives
the wave-level narrative, the WP -> gaps map, the verification evidence, and the
honest remaining-deferrals list.

## What each wave delivered

### Wave 1 - engine-side, parallel (WP-1..WP-8)

- WP-1 combat (39deb9af): energy_per_move, player melee/ranged fear+flee+
  message_pain, full melee side-effect suite (shield bash, vampiric, confusion
  brand, impact quake, bloodlust, shapechange blows), faithful ranged distance
  metric, powershot piercing, player_inc_check learning, temporary brands/slays.
- WP-2 monster (39deb9af): mimics lie in wait, terrain damage, best_range,
  near-permwall beeline, decoy targeting, full monster_desc grammar engine +
  spell-message system, injured-kin heal, group fear-save, generation-mimic
  objects.
- WP-3 effects/projections (9d4d2601): monster-cast + decoy sub-branches across
  the effect/projection families (6.1, 6.3, 6.5-6.11, 5.2-5.4); 5.1/5.3/5.D
  verified already faithful.
- WP-4 gear/quiver (39deb9af): real quiver subsystem, minus_ac armor damage,
  use-XP, combine_pack, birth_start_kit + eopts.
- WP-5 object-knowledge (39deb9af): obj->known twin machinery, curse TIMED_INC
  foils, known-twin pricing, unreadable-book rejection, ignore markers, pack
  totals.
- WP-6 gen/traps (e47f6ca9): verification pass - 9.2-9.8, 10.3-10.5 confirmed
  already faithful; one comment clarification.
- WP-7 birth (f8c6312c): standard-roller UI loop, history-edit stage, random/
  finish menu rows, 31-char names; generate_stats, roman suffix, quickstart
  verified faithful.
- WP-8 wizard-engine (0f23b7f2): wizard shells + spoiler/stats CLI verified
  field-for-field; noscore constants groundwork.

### Wave 2 - integration, sequential (WP-9, WP-10)

- WP-9 turn-loop + wiring (013fba8d): noise/scent in the live loop (10.1), full
  player_regen_hp/mana (2.1/2.2/10.2), and connection of every accumulated
  wave-1 seam (spell-cast hooks, minus_ac callback, nonplayer-hit deps, melee
  side-effects, inc-check queries, obj-command deps, birth accept-flow pieces,
  curse/foil make-deps).
- WP-10 save/load (60295f0a): store + Home persistence (12.1), owner (12.2),
  store_update/daycount (12.3), full_name (12.4), died_from (12.5), noscore
  persist + wizard-flag OR on load (15.3), optionsInitCheat ordering (1.12).

### Wave 3 - web shell, sequential (WP-11..WP-18)

- WP-11 commands (1dfac4e0): rest (11.1), steal (11.2), note (11.3), keyboard
  parity sweep (11.4/11.8/11.10) + core rest-regen wiring.
- WP-12 screens-A (869323f9): death tombstone + real killer + winner crown +
  full death menu (14.1-14.5), monster-list screen (11.5, 14.17-14.19), score
  gating, birth recall banner (1.11).
- WP-13 screens-B (28bdd07f): weight/fail% columns + spell-state labels
  (14.20-14.24), quantity/inscription prompts (14.25), context + keymap editor
  (14.26-14.30, 14.33), cheat options page (14.31), -more- pager (14.32),
  find_inven (12.10), locate banner (14.34).
- WP-14 wizard-mode UI (9c5ce991 + df617c46): wizard entry (15.1), noscore
  chain end-to-end, debug command menu fronting the WP-8 engine (15.2).
- WP-15 unported commands (e5f9f321): fire-at-nearest (11.6), CMD_JUMP (11.7),
  query-symbol, feeling, prev-message, repeat (11.9), retire, quiver listing
  (11.11).
- WP-16 knowledge browsers (2cfbb1b5): master menu + rune/feature/trap browsers
  (14.8, 14.10, 14.13), object_text_order grouping (13.1); monster membership/
  sort verified (14.16).
- WP-17 knowledge-engine state (85e66245 + 99916a49): everseen tracking
  (14.9/14.12), artifact exact gate (14.11), shape lore (14.14).
- WP-18 char dump / recall / pickers (05edbe40 + aa2e35e4): full char dump
  (14.6, 12.7), artifact fake-recall (14.11), interactive wizard pickers (15.2).

### Wave 4 - verification + documentation (this pass)

Full-suite verification, the authoritative per-gap re-mark in GAP_AUDIT.md, the
item-1 re-resolution of gap 7.6, and this closure record. No code edits.

## Verification evidence (Wave-4 gate, recorded)

- `npx tsc -b` across all packages: exit 0.
- `npx vitest run`: 3157 tests / 219 files pass.
- Vite production bundle + PWA generation: clean.
- Live browser smoke: boot -> faithful birth -> town -> movement advances turns,
  day/night cycle live.

## Honest remaining deferrals

These are genuinely open after Wave 4. Everything else is CLOSED or VERIFIED per
the GAP_AUDIT.md status table.

1. 7.6 monster drop origin - REAL DEVIATION, most material item. monCreateDrop
   (game/mon-death.ts:110) is a faithful port of mon_create_drop but has NO
   production caller (only tests). Neither the generation nor the live-placement
   path invokes it, so monsters drop NO generated loot (only stolen items).
   monsterDeath just empties an always-empty held pile. The wave-1 "drops
   rescinded/restored" claim is not borne out by the code; two docstrings
   (mon-death.ts:7-15, mon-place.ts:21-25) are stale/contradictory. FIX: call
   monCreateDrop at the placement seam with the correct origin (ORIGIN.DROP live;
   DROP_PIT/DROP_VAULT/DROP_SUMMON per generation context) and delete the stale
   docstrings.
2. 4.8 obj->known twin - PARTIAL. Core twin (objectSetBaseKnown /
   player_know_object) ported; progressive floor-item sensing (object_see/
   object_sense) and full update_player_object_knowledge re-sync deferred (shadow
   synthesised on demand); magical/cursed progressive feelings not modelled.
3. 6.12 inven_damage twin/ignore - display/knowledge-only; rides 4.8.
4. 8.5 smart-learn AI - unsetSpells read-filter is wired (mon-ranged.ts:232) but
   the update_smart_learn WRITE hook is never installed at the session level
   (player/timed.ts:219,244 hook empty). Default birth_ai_learn OFF is faithful;
   the option-on path (monsters learning player resists) is the gap.
5. 6.4 update_smart_learn in project_p - rides 8.5's write path
   (project-player.ts:146-148 confirms it is off/unported).
6. 3.8 remove_contradictory_activation - ported (randart-build.ts:1487) but its
   effect_summarize_properties injector is left unset (game.ts:2340-2341), so it
   stays a conservative no-op: redundant randart activations are not stripped.
7. 9.4 / 9.6 persistent-level stair joins - 9.6 sanitize is ported; the join
   round-trip is not. birth_levels_persist dungeons stay OFF by default;
   build_staircase / cavern joins are ported but dormant until Chunk.join is
   saved and threaded through changeLevel.
8. 12.6 minor persisted player fields (resting_turn, skip_cmd_coercion,
   unignoring, name_suffix, old_grid) - low; not explicitly closed by WP-10;
   verify against save.ts.
9. 12.8 running message-log persistence in the savefile - low; the char dump
   captures last-messages, but the live log is not round-tripped through
   SavedGame; verify.
10. Code hygiene (not a parity gap): getMonName/pluralAux still awaiting
    re-export from core index.ts (screens.ts replicates them locally, flagged by
    WP-12).

## Accepted deviations (maintainer-ratified 2026-07-16, unchanged)

- Subwindow setup, sidebar mode, redraw, toggle-windows: terminal-only mechanics
  with no canvas meaning; the web shell provides its own equivalents. N/A.
- Use auto-detect (U/X) deliberately split into per-type verbs.
- The mod system (registries/seams): additive, does not alter vanilla behaviour.
