#requires -Version 7
# M3 (MiniMax) parity lane via PRELOAD/BUNDLE mode: concatenate all reference + candidate
# port files for the lane into ONE bundle file, have M3 read it once (its 1M-context
# strength) and emit findings to stdout, which we append to parity_findings_m3.md.
# This avoids M3's many-turn agentic-navigation hang.
param(
  [Parameter(Mandatory)][string]$Lane,
  [string]$LaneTitle = ''
)
$ai   = 'C:\Repositories\_tools\ai-cli-toolkit\ai.ps1'
$repo = 'C:\Repositories\neo-angband'
$aud  = Join-Path $repo 'parity/audit-2026-07-24'
$manAbs = Join-Path $aud "manifests/$Lane.ref.txt"
if (-not (Test-Path $manAbs)) { Write-Error "manifest not found: $manAbs"; exit 2 }

# Candidate PORT globs per lane (same info grok gets via hints; independence preserved).
$portGlobs = @{
  L1_rng_util            = @('packages/core/src/*.ts','packages/core/src/obj/randname.ts')
  L2_init_parse          = @('packages/content/src/**/*.ts','packages/core/src/generated/*.ts')
  L3_data                = @('packages/content/pack/*.json','packages/content/src/specs/*.ts')
  L4_objects             = @('packages/core/src/obj/*.ts')
  L5_monsters            = @('packages/core/src/mon/*.ts')
  L6_player              = @('packages/core/src/player/*.ts')
  L7_combat              = @('packages/core/src/combat/*.ts')
  L8_effects             = @('packages/core/src/effects/*.ts')
  L9_dungeon             = @('packages/core/src/gen/*.ts','packages/core/src/world/*.ts')
  L10_world_loop         = @('packages/core/src/game/*.ts','packages/core/src/world/*.ts')
  L11_stores             = @('packages/core/src/store/*.ts','packages/web/src/shop.ts')
  L12_saveload           = @('packages/core/src/save/*.ts')
  L13_score_death        = @('packages/core/src/score/*.ts','packages/core/src/player/*.ts')
  L14_ui_frontend        = @('packages/web/src/*.ts','packages/core/src/visuals/*.ts')
  L15_tiles              = @('packages/linoleum/src/*.ts','packages/web/src/tiles.ts','packages/web/src/tile-mods.ts')
  L16_sounds             = @('packages/core/src/sound/*.ts','packages/web/src/sound.ts')
  L17_fonts_screens_help = @('packages/web/src/screens.ts','packages/web/src/*.ts')
}

$bundleDir = 'C:\Users\neost\AppData\Local\Temp\claude\C--Repositories\0ff2c8e0-d365-4fe6-95ff-4fdec8dcb774\scratchpad\bundles'
New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
$bundle = Join-Path $bundleDir "$Lane.bundle.txt"
$sb = [System.Text.StringBuilder]::new()

function Add-File([string]$rel) {
  $abs = Join-Path $repo $rel
  if (-not (Test-Path $abs -PathType Leaf)) { return }
  $n = (Get-Content $abs | Measure-Object -Line).Lines
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("=================== FILE: $rel ($n lines) ===================")
  [void]$sb.AppendLine((Get-Content $abs -Raw))
}

# Reference side
[void]$sb.AppendLine("########## REFERENCE C / DATA (the ORACLE) ##########")
Get-Content $manAbs | Where-Object { $_ } | ForEach-Object {
  Add-File ($_ -replace '\\','/')
}
# Port side
[void]$sb.AppendLine("")
[void]$sb.AppendLine("########## PORT TypeScript ##########")
$seen = @{}
foreach ($g in ($portGlobs[$Lane])) {
  Get-ChildItem -Path (Join-Path $repo $g) -File -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = ($_.FullName.Substring($repo.Length+1)) -replace '\\','/'
    if (-not $seen[$rel]) { $seen[$rel] = $true; Add-File $rel }
  }
}
Set-Content -Path $bundle -Value $sb.ToString() -Encoding UTF8
$bytes = (Get-Item $bundle).Length
Write-Host "[m3-lane] bundle=$bundle size=$([int]($bytes/1KB))KB"

$prompt = @"
Read parity/audit-2026-07-24/REVIEW_BRIEF.md, then read the SINGLE bundle file at:
$bundle
That bundle contains ALL reference C/data for lane $Lane ($LaneTitle) followed by the candidate port TypeScript, each section headed by '=================== FILE: <path> (<n> lines) ==================='. Do NOT read any other files; everything you need is in the bundle and the brief.

Audit EVERY reference file in the bundle against its port counterpart. The C is the ORACLE and wins every disagreement. Verify by re-derivation (values, formulas, strings, control flow, RNG draw order). Preserve faithful upstream bugs (do NOT report them). If a reference file has no port counterpart in the bundle, that is a finding (NONE), unless it is an unavoidable browser concession.

Output ONLY the findings, using the EXACT block format from the brief (### $Lane-NNN, sev, concession, ref, port, expected, actual, why, confidence), using real file:line on BOTH sides (line numbers are in the bundle via each file's content; cite the path and your best line). After all findings, output a '## MAP $Lane' section: one line per reference file -> port file(s) or NONE. ASCII only. Do not write any files; print everything to your response.
"@

$raw = & $ai bigcontext $prompt -Tools read -Cwd $repo 2>&1
$ans = ($raw | Where-Object { $_ -notmatch '^\[ai\]' -and $_ -notmatch '^\[m3-lane\]' }) -join "`n"
$findings = Join-Path $repo 'parity_findings_m3.md'
Add-Content -Path $findings -Value "`n## $Lane`n$ans`n" -Encoding UTF8
Write-Host "[m3-lane] appended $($ans.Length) chars to parity_findings_m3.md"
