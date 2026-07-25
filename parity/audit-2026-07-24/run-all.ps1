#requires -Version 7
# Sequentially run a set of parity lanes for one engine (each lane -> its own per-lane
# findings file via run-lane.ps1). Intended to be launched as ONE background job per engine
# so grok and codex progress in parallel with minimal orchestration.
param(
  [Parameter(Mandatory)][ValidateSet('grok','codex','terra')][string]$Model,
  [Parameter(Mandatory)][string[]]$Lanes
)
$titles = @{
  L1_rng_util            = 'RNG/util/low-level (z-* modules)'
  L2_init_parse          = 'init.c / parser.c / datafile.c loaders'
  L3_data                = 'gamedata *.txt vs compiled content/pack *.json'
  L4_objects             = 'objects (obj-*)'
  L5_monsters            = 'monsters (mon-*)'
  L6_player              = 'player (player-*)'
  L7_combat              = 'combat (player-attack / mon-attack / mon-blows)'
  L8_effects             = 'effects & projection (effects / effect-handler / project)'
  L9_dungeon             = 'dungeon gen (gen-* / generate / cave* / trap)'
  L10_world_loop         = 'world/loop/commands (game-world/event/input, cmd-*, options)'
  L11_stores             = 'stores/shops (store.c)'
  L12_saveload           = 'save/load (save.c / load.c / savefile)'
  L13_score_death        = 'scoring/death/history (score / player-history)'
  L14_ui_frontend        = 'UI/display + Windows frontend (ui-* / main-win.c / win/*)'
  L15_tiles              = 'tiles/graphics (lib/tiles + linoleum)'
  L16_sounds             = 'sounds (lib/sounds + sound engine)'
  L17_fonts_screens_help = 'fonts / splash screens / help / pref (customize)'
}
$driver = Join-Path $PSScriptRoot 'run-lane.ps1'
foreach ($L in $Lanes) {
  $t = $titles[$L]; if (-not $t) { $t = $L }
  Write-Host "[run-all:$Model] === $L START $((Get-Date).ToString('HH:mm:ss')) ==="
  try { & $driver -Lane $L -Model $Model -LaneTitle $t }
  catch { Write-Host "[run-all:$Model] $L ERROR: $_" }
  $out = Join-Path $PSScriptRoot "findings/$Model/$L.md"
  $n = if (Test-Path $out) { (Select-String -Path $out -Pattern '^### ' -AllMatches).Count } else { 0 }
  Write-Host "[run-all:$Model] === $L DONE $((Get-Date).ToString('HH:mm:ss')) findings=$n ==="
}
Write-Host "[run-all:$Model] ALL LANES COMPLETE"
