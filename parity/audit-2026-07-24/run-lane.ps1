#requires -Version 7
# Drive one parity-audit lane on one engine. Blocking (run in background from caller).
param(
  [Parameter(Mandatory)][string]$Lane,          # e.g. L1_rng_util
  [Parameter(Mandatory)][ValidateSet('grok','codex','terra','m3')][string]$Model,
  [string]$LaneTitle = ''                        # human description of the lane
)
$ai   = 'C:\Repositories\_tools\ai-cli-toolkit\ai.ps1'
$repo = 'C:\Repositories\neo-angband'
$aud  = 'parity/audit-2026-07-24'
$manRel = "$aud/manifests/$Lane.ref.txt"
$manAbs = Join-Path $repo $manRel
if (-not (Test-Path $manAbs)) { Write-Error "manifest not found: $manAbs"; exit 2 }

# Per-lane hint: where the port implementation most likely lives.
$hints = @{
  L1_rng_util            = 'packages/core/src (game/, session/, and any rng/util/message/random modules)'
  L2_init_parse          = 'packages/content/src (parsers/specs), packages/core/src/generated, packages/core/src/game'
  L3_data                = 'packages/content/pack/*.json (compiled) and packages/content/src/specs; compare each gamedata .txt to its compiled JSON field-by-field'
  L4_objects             = 'packages/core/src/obj'
  L5_monsters            = 'packages/core/src/mon'
  L6_player              = 'packages/core/src/player'
  L7_combat              = 'packages/core/src/combat'
  L8_effects             = 'packages/core/src/effects'
  L9_dungeon             = 'packages/core/src/gen and packages/core/src/world (cave/map/square)'
  L10_world_loop         = 'packages/core/src/game (commands, world loop, options, messages) and packages/core/src/world'
  L11_stores             = 'packages/core/src/store and packages/web/src/shop.ts'
  L12_saveload           = 'packages/core/src/save'
  L13_score_death        = 'packages/core/src/score and death/history paths in packages/core/src/player'
  L14_ui_frontend        = 'packages/web/src (term.ts, ui-colors.ts, tiles.ts, screens.ts, wizard.ts) and packages/core/src/visuals; oracle is main-win.c + win/* + ui-*.c'
  L15_tiles              = 'packages/linoleum/src, packages/web/public/tiles, packages/web/src/tiles.ts + tile-mods.ts'
  L16_sounds             = 'packages/core/src/sound, packages/web/src/sound.ts, packages/web/public/sounds; verify the msgt->sound trigger mapping vs sound.cfg'
  L17_fonts_screens_help = 'packages/web/src/screens.ts, font assets, and any help/pref handling; oracle = lib/fonts, lib/screens, lib/help, lib/customize'
}
$hint = $hints[$Lane]; if (-not $hint) { $hint = 'search packages/ (exclude node_modules, dist, borg)' }
$files = (Get-Content $manAbs) -join "`n"
$route    = switch ($Model) { 'grok' { 'read' } 'codex' { 'codex-hard' } 'terra' { 'gpt' } default { 'bigcontext' } }
# Per-lane dedicated output file (avoids shared-file rewrite/collision; copilot rewrites
# whole files, so a growing shared file risks dropping earlier lanes). Concatenated per
# model at reconciliation.
$findDirAbs = Join-Path $repo "parity/audit-2026-07-24/findings/$Model"
New-Item -ItemType Directory -Force -Path $findDirAbs | Out-Null
$findings = "parity/audit-2026-07-24/findings/$Model/$Lane.md"

$prompt = @"
Read $aud/REVIEW_BRIEF.md and follow it EXACTLY. You are auditing lane $Lane ($LaneTitle).

Reference files in THIS lane (audit every one):
$files

Port implementation most likely lives in: $hint
But do not trust that hint or any pre-existing map -- SEARCH packages/ (exclude node_modules, dist, borg) to find the REAL implementation of each reference file.

For EACH reference file above:
1. Find the port file(s) that implement it (or NONE).
2. Verify behavior by re-derivation against the C -- values, formulas, strings, control flow, RNG draw order. The C wins every disagreement. Preserve faithful upstream bugs (do NOT report them).
3. Record each finding in the file $findings using the EXACT block format from the brief (### $Lane-NNN, sev, concession, ref, port, expected, actual, why, confidence).

CRITICAL WRITE DISCIPLINE (read carefully):
- Write ALL output to the dedicated file $findings using your file tools. This file is NEW and belongs to THIS lane only -- create it and write your findings there. Do NOT touch any other findings file.
- Findings placed only in your chat reply are DISCARDED -- only the file is kept.
- Even if this lane has FEW or ZERO findings, you MUST still create the file and write the MAP.
- Finish the file with a '## MAP $Lane' section: one line per reference file -> port file(s) or NONE.
ASCII only. Cover EVERY reference file; do not stop early. When the file is fully written, reply with only: DONE <count> findings.
"@

# Always capture stdout to a raw salvage log, so findings are never lost even if the
# agent replies instead of writing the file (observed with grok on sparse lanes).
$rawDirAbs = Join-Path $repo 'parity/audit-2026-07-24/raw'
New-Item -ItemType Directory -Force -Path $rawDirAbs | Out-Null
$rawLog = Join-Path $rawDirAbs "$Lane.$Model.log"
& $ai $route $prompt -Tools write -Cwd $repo 2>&1 | Tee-Object -FilePath $rawLog
