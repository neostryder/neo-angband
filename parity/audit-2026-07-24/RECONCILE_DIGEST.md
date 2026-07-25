# Reconciliation digest (auto-generated)

Total findings ingested: 462

## Counts by model
- grok: 191
- codex: 227
- terra: 44

## Counts by severity
- P0: 6
- P1: 121
- P2: 158
- P3: 177
- P?: 0

---
## L10_world_loop  (grok=20 codex=0 terra=0)

- **[P0] L10_world_loop-001** (grok, conc:n, conf:high)  Paralyzed / Knocked Out players can still take turns
  - ref: `reference/src/game-world.c:965-968 (process_player: TMD_PARALYZED or Stun "Knocked Out" pushes CMD_SLEEP so the turn is spent doing nothing)`  port: `packages/core/src/game/player-turn.ts:583-637 (processPlayer never injects sleep; waits on nextCommand); packages/core/src/game/player-turn.ts:538-548 (createDefaultRegistry never registers "sleep")`
  - exp: While paralyzed or Knocked Out, process_player forces a full-energy sleep turn; the player cannot issue other commands until the status ends.
  - act: The loop returns INPUT and the shell can push walk/cast/etc. while timed PARALYZED or Knocked Out is still >0. "sleep" is listed in COMMAND_INFO but has no action handler.

- **[P1] L10_world_loop-002** (grok, conc:n, conf:high)  Detection MARK/SHOW fade runs every 10 game turns, not every player turn
  - ref: `reference/src/game-world.c:882-908 (process_player_cleanup after energy-using commands: clear MFLAG_NICE, drop MARK if !SHOW, always clear SHOW)`  port: `packages/core/src/game/loop.ts:357-358,582-583 (tickMonsterMarks only inside processWorld, gated by turn % 10); packages/core/src/game/player-turn.ts:583-637 (processPlayer never calls tickMonsterMarks); packages/core/src/game/known.ts:721-738`
  - exp: Detection markers (MARK/SHOW) and NICE clear once per player energy turn after cleanup.
  - act: Fade runs at most once every ten game turns with process_world, so monster detection from detect spells lasts much longer than upstream.

- **[P1] L10_world_loop-003** (grok, conc:n, conf:high)  Standing in a web does not clear the web on walk/run/jump
  - ref: `reference/src/cmd-cave.c:1287-1297,1328-1336,1369-1377 (do_cmd_walk/jump/run: if square_iswebbed on player grid, msg "You clear the web.", remove web traps, spend move_energy, no move)`  port: `packages/core/src/game/player-turn.ts:382-469 (walkAction never checks web on current grid); packages/core/src/game/player-path.ts:831-855 (runStep goes straight to walkAction); packages/core/src/game/cave-cmd.ts:615-617 (documents web clear still on base action)`
  - exp: Any walk/jump/run while standing on a web spends the turn clearing the web and does not move.
  - act: Player can walk out of webs freely; web only matters if terrain/trap code elsewhere treats it as impassable (it is not).

- **[P1] L10_world_loop-004** (grok, conc:n, conf:high)  Walk onto known disarmable traps always triggers (no disarm-on-walk)
  - ref: `reference/src/cmd-cave.c:1311-1312 (do_cmd_walk: move_player(dir, !(disarmable && trapsafe))); reference/src/cmd-cave.c:1079-1083 (move_player: known disarmable trap + disarm true -> do_cmd_alter_aux, not step)`  port: `packages/core/src/game/player-turn.ts:457-481 (walk/jump share body; documents disarm-on-walk deferred; onPlayerMoved -> hit_trap on any step); packages/core/src/game/cave-cmd.ts:615-618`
  - exp: Default walk into a known, enabled player trap auto-disarms (alter) unless trapsafe/jump; jump deliberately steps on.
  - act: Every walk onto a trap triggers it; jump is identical to walk.

- **[P1] L10_world_loop-005** (grok, conc:n, conf:high)  Stair depth uses +/-1; ignores stair_skip and dungeon_get_next_level
  - ref: `reference/src/cmd-cave.c:76,103 (ascend_to/descend_to = dungeon_get_next_level(player, depth, +/-1)); reference/src/player-util.c:54-73 (target = dlev + added * stair_skip, quest intermediate check, clamp)`  port: `packages/core/src/game/cave-cmd.ts:817-849 (targetDepth = depth + 1 / depth - 1 only)`
  - exp: One stair hop advances by z_info->stair_skip levels (default 1) and stops early on quest levels between.
  - act: Always changes depth by exactly 1; no quest intermediate stop, no stair_skip scaling.

- **[P1] L10_world_loop-006** (grok, conc:n, conf:high)  Stair commands omit force_descend and max-depth guards
  - ref: `reference/src/cmd-cave.c:70-74 (birth_force_descend: "Nothing happens!" on go_up); reference/src/cmd-cave.c:115-128 (max_depth-1 refuse; force_descend recalculates descend_to from max_depth and quest confirm); reference/src/cmd-cave.c:78-80 (cannot ascend when next level == current)`  port: `packages/core/src/game/cave-cmd.ts:817-849 (only feature-underfoot and depth===0 up checks)`
  - exp: Force-descend blocks up stairs; deepest level blocks down; force-descend from shallower than max uses max_depth path with quest warning.
  - act: Up works from any non-zero depth with an up stair; down works at max_depth-1; force_descend birth option is ignored on stairs.

- **[P1] L10_world_loop-007** (grok, conc:n, conf:high)  Deep Descent failure never runs EF_DESTRUCTION
  - ref: `reference/src/game-world.c:815-830 (deep_descent hits 0: if target not deeper, msg explosion then effect_simple(EF_DESTRUCTION, ... "0", radius 5))`  port: `packages/core/src/game/loop.ts:476-493 (else branch only state.msg "You are thrown back in an explosion!"; comment says destruction "rides that handler" but nothing invokes it)`
  - exp: At deepest reachable depth, deep descent explodes with *destruction* effects (terrain/monsters/objects).
  - act: Message only; no destruction effect, no RNG for the effect chain.

- **[P1] L10_world_loop-008** (grok, conc:n, conf:high)  Deep Descent target omits stair_skip multiply and quest intermediates
  - ref: `reference/src/game-world.c:817-819 (target_increment = (4/stair_skip)+1; target_depth = dungeon_get_next_level(player, max_depth, target_increment) => max_depth + increment*stair_skip with quest scan)`  port: `packages/core/src/game/loop.ts:480-484 (targetDepth = min(maxDepth + increment, maxDepth-1) without * stair_skip); packages/core/src/game/effect-general.ts:646-648 (same formula when arming)`
  - exp: Destination = dungeon_get_next_level(max_depth, (4/stair_skip)+1), including stair_skip multiply and intermediate quest levels.
  - act: Adds the increment once with no * stair_skip and no quest stop. Default stair_skip=1 makes hop size match but still skips quest intermediate logic.

- **[P1] L10_world_loop-009** (grok, conc:n, conf:high)  Word of Recall from town skips player_set_recall_depth
  - ref: `reference/src/game-world.c:801-804 (from town: player_set_recall_depth then change to recall_depth); reference/src/player-util.c:79-92 (force_descend may bump recall to next below max; always MAX(recall, 1))`  port: `packages/core/src/game/loop.ts:466-470 (always p.recallDepth = p.maxDepth; targetDepth = that)`
  - exp: Recall depth respects force_descend next-level bump and minimum depth 1 via player_set_recall_depth.
  - act: Always maxDepth only; force_descend never advances one more level; no quest-aware next-level helper.

- **[P1] L10_world_loop-010** (grok, conc:n, conf:high)  on_new_level does not announce feeling or run search
  - ref: `reference/src/game-world.c:1047-1052 (on_new_level: if depth, display_feeling(false); then search(player))`  port: `packages/core/src/session/game.ts:2066-2073 (changeLevel end: updateBonuses + updateFov only); packages/web/src/main.ts:5291-5296 (LEVEL_CHANGE only changeLevel; no displayFeeling); packages/web/src/main.ts:3311-3316 (^F only)`
  - exp: Every dungeon level entry auto-prints the feeling line and runs incidental search on the landing square.
  - act: Feeling only on manual ^F; search() has no port; arrival is silent on both.

- **[P1] L10_world_loop-012** (grok, conc:n, conf:high)  do_cmd_alter missing trap, chest, and close-door branches
  - ref: `reference/src/cmd-cave.c:974-999 (alter_aux: mon / diggable / closed door / disarmable trap / trapped chest / open chest / open door close / else spin)`  port: `packages/core/src/game/cave-cmd.ts:797-814 (alter: mon / diggable / closed door / else "You spin around." only)`
  - exp: '+' alter disarms traps, opens/disarms chests, and closes open doors on the target grid.
  - act: Those targets only spin; dedicated open/disarm commands still work, but alter is incomplete vs C (and walk uses alter_aux for doors/traps upstream).

- **[P1] L10_world_loop-013** (grok, conc:n, conf:high)  PF_SEE_ORE free detect-every-turn missing from process_player
  - ref: `reference/src/game-world.c:952-962 (process_player each turn: if PF_SEE_ORE and not image/confused/amnesia/stun/paralyzed/terror/afraid, effect_simple(EF_DETECT_ORE, ... range 3,3))`  port: `packages/core/src/game/player-turn.ts:583-637 (no SEE_ORE / DETECT_ORE call); packages/core/src/game/effect-detect.ts:291-292 (handler exists but not driven from the loop)`
  - exp: Dwarves (and other SEE_ORE races) get a free ore detect pulse every player turn while clear-headed.
  - act: SEE_ORE never fires on the live turn path; ore sense only if some other effect invokes DETECT_ORE.

- **[P1] L10_world_loop-014** (grok, conc:n, conf:high)  Running first step into an adjacent known trap is not stopped
  - ref: `reference/src/cmd-cave.c:1084-1088 (move_player: trap && running && !trapsafe -> disturb, energy_use=0, no step)`  port: `packages/core/src/game/player-path.ts:853-855 (runStep always walkAction); packages/core/src/game/player-turn.ts:457-465 (walkAction always moves then onPlayerMoved)`
  - exp: Running toward a known trap stops before entering the grid and spends no energy.
  - act: The first run step onto a visible trap walks in and triggers it; run_test only inspects after successful steps.

- **[P1] L10_world_loop-016** (grok, conc:n, conf:high)  Core rest command is a single hold turn; sleep unregistered
  - ref: `reference/src/cmd-cave.c:1619-1668 (do_cmd_rest multi-turn with special REST_* counts and cmdq re-push); reference/src/cmd-cave.c:1675-1678 (do_cmd_sleep spends move_energy)`  port: `packages/core/src/game/player-turn.ts:487-548 (rest -> holdAction one move_energy; sleep not registered); packages/web/src/main.ts:3506+ (driveRest implements rest only in the web shell)`
  - exp: Engine rest is multi-turn with REST_COMPLETE/ALL_POINTS/SOME_POINTS; sleep is a real energy command for paralysis path.
  - act: Core registry rest is one idle turn; full rest lives only in web driveRest outside processPlayer; sleep has no handler (see also -001).

- **[P2] L10_world_loop-011** (grok, conc:n, conf:high)  Deeper level does not update recall_depth with max_depth
  - ref: `reference/src/game-world.c:1023-1025 (if max_depth < depth then max_depth = recall_depth = depth)`  port: `packages/core/src/session/game.ts:1859-1862 (only maxDepth = depth; no recallDepth assignment anywhere in game.ts)`
  - exp: Reaching a new deepest depth sets both max_depth and recall_depth.
  - act: Only maxDepth updates; recallDepth stays at prior value until some other path overwrites it.

- **[P2] L10_world_loop-015** (grok, conc:n, conf:high)  Leaving a DTRAP region while running does not abort the step
  - ref: `reference/src/cmd-cave.c:1146-1153 (move_player: running && !firststep && old_dtrap && !new_dtrap -> disturb, energy 0, return)`  port: `packages/core/src/game/player-turn.ts:382-469 (no SQUARE.DTRAP edge check); packages/core/src/game/player-path.ts (firstStep tracked but never used for dtrap)`
  - exp: Runs stop at the edge of a detect-traps region without spending the exit step.
  - act: Runs freely leave DTRAP areas; only the status display shows DTRAP.

- **[P2] L10_world_loop-017** (grok, conc:n, conf:med)  Word of Recall / Deep Descent fire without disturb or command-queue flush
  - ref: `reference/src/game-world.c:794-795,820 (disturb + cmdq_flush on recall; disturb on deep descent)`  port: `packages/core/src/game/loop.ts:460-493 (sets generateLevel/targetDepth and messages only)`
  - exp: Pending rest/run/repeats cancel and queue flushes so no extra action is lost or applied on the new level.
  - act: generateLevel is set without disturb()/cmdq_flush equivalents on this path (web may clear some state later).

- **[P2] L10_world_loop-019** (grok, conc:n, conf:high)  pack_overflow not run in process_player
  - ref: `reference/src/game-world.c:946-947 (process_player: pack_overflow(NULL) every command cycle)`  port: `packages/core/src/game/player-turn.ts:583-637 (no pack overflow); packages/core/src/game/gear.ts:20,387 (pack_overflow DEFERRED)`
  - exp: Overfull pack auto-drops to floor before each command with the upstream messages/energy rules.
  - act: Pack can remain over capacity until some other path forces it; no process_player overflow.

- **[P3] L10_world_loop-018** (grok, conc:n, conf:high)  Tunnel success/fail messages drop "with your weapon/swap digger" clause
  - ref: `reference/src/cmd-cave.c:595-638 (messages include with_clause: hands / weapon / swap digger)`  port: `packages/core/src/game/cave-cmd.ts:418-459 (fixed strings without with_clause)`
  - exp: "You have finished the tunnel with your weapon." (etc.)
  - act: "You have finished the tunnel." / "You dig in the rubble." without digger phrase.

- **[P3] L10_world_loop-020** (grok, conc:n, conf:med)  hint.h store-hint list has no runtime port counterpart
  - ref: `reference/src/hint.h (struct hint; extern hints); store.c uses hints`  port: `packages/content/src/specs/init.ts:261 (hintsSpec parses data only); no packages/core consumer of a live hints linked list`
  - exp: Runtime hint chain available for store/UI random tips as upstream.
  - act: Data may be parsed into content packs but no core/source equivalent of the hint list API is used in play.

---
## L11_stores  (grok=10 codex=6 terra=0)
_cross-model overlap on: store.c_

- **[P0] L11_stores-001** (grok, conc:n, conf:high)  Home retrieve is routed through storeBuy and charges gold
  - ref: `reference/src/ui-store.c:729-733 (store_purchase pushes CMD_RETRIEVE for FEAT_HOME); reference/src/store.c:1783-1852 (do_cmd_retrieve: no price_item, no au change)`  port: `packages/core/src/session/game.ts:2525-2528 (buy always calls storeBuy); packages/core/src/store/transact.ts:120-186 (storeBuy always priceItem + player.au -= price); packages/web/src/shop.ts:732-749 (Home Take uses game.buy, then "You bought ... for N gold")`
  - exp: Retrieving from the Home copies the stack into the pack for free (do_cmd_retrieve); no gold, no ORIGIN_STORE stamp, no empty-store restock/shuffle.
  - act: Live Home "Take/Buy" calls storeBuy: charges full shop sell price, can refuse with cannot-afford, stamps ORIGIN_STORE, and on emptying the home may one_in_(store_shuffle) + store_maint x10 (maint is a no-op for home but still draws RNG for the shuffle chance). homeRetrieve exists and is unit-tested but is not wired into StartedGame.buy.

- **[P0] L11_stores-002** (grok, conc:n, conf:high)  Home stash is routed through storeSell/storeCarry, not home_carry
  - ref: `reference/src/ui-store.c:577-581 (Home pushes CMD_STASH); reference/src/store.c:2009-2074 (do_cmd_stash -> home_carry); reference/src/store.c:870-894 (home_carry: OSTACK_PACK merge, accept any object, no value gate, no fuel/timeout rewrite)`  port: `packages/core/src/session/game.ts:2530-2543 (sell always storeSell); packages/core/src/store/transact.ts:297-353 (sellObject -> storeCarry(..., true)); packages/core/src/store/store.ts:346-399 (storeCarry: object_value_real gate, erase note, reset light fuel / timeouts, OSTACK_STORE merge); packages/web/src/shop.ts:795-811 (Home drop uses game.sell)`
  - exp: Stashing uses home_carry: free, accepts worthless gear, pack-style stacking, no shop maintenance rewrites of fuel/charges.
  - act: Live Home drop uses do_cmd_sell economics/path: store_carry rejects value_real <= 0 after gear_object_for_use already detached the stack (item is lost), wipes inscriptions, refills torches/lamps, clears rod timeouts, merges with OSTACK_STORE. homeStash/homeCarry are implemented and tested but not used by StartedGame.sell.

- **[P1] L11_stores-003** (grok, conc:n, conf:high)  Town store init burns an extra owner RNG draw per store
  - ref: `reference/src/store.c:340-357 (store_reset: owner starts NULL from store_init zalloc; store_shuffle does one store_choose_owner because while (o == store->owner) with o non-NULL exits); reference/src/store.c:1478-1501`  port: `packages/core/src/store/store.ts:140-170 (bindStoreRuntime always storeChooseOwner); packages/core/src/store/store.ts:665-671 (storeReset always storeShuffle again until owner identity differs); packages/core/src/store/store.ts:679-690 (createTownStores = bind all + storeReset); packages/core/src/session/game.ts:2133-2142 (live first town visit)`
  - exp: First owner selection is a single randint0(n_owners) per store, then store_maint x10 consumes the same stream for stock.
  - act: Each store draws owner once at bind, then store_shuffle draws again until a different owner object is chosen (always at least one more draw; expected ~n/(n-1) with n=4). All subsequent mass_produce / create_random / delete_random draws for initial stock are offset vs C for the same seed.

- **[P1] L11_stores-004** (grok, conc:n, conf:high)  Shop flavor comments use display Math.random, not the game RNG
  - ref: `reference/src/store.c:1717 (do_cmd_buy: one_in_(3) then ONE_OF(comment_accept) on the main RNG before empty-store restock); reference/src/store.c:491-508,1972 (purchase_analyze ONE_OF on main RNG); reference/src/ui-store.c:139-177 (prt_welcome one_in_ / randint draws on main RNG)`  port: `packages/web/src/shop.ts:180-190 (flavorPick/flavorOneIn = Math.random); packages/web/src/shop.ts:201-217 (prtWelcome); packages/web/src/shop.ts:745-748 (comment_accept after game.buy returns); packages/web/src/shop.ts:818-822 (sale reaction comments)`
  - exp: Welcome, accept, and purchase_analyze lines advance z-rand; comment_accept is drawn inside do_cmd_buy before any empty-store shuffle/maint.
  - act: All three use Math.random (zero game-RNG cost). comment_accept is emitted in the shell after storeBuy returns, so when a purchase empties the shop the C order is accept-draw then shuffle/maint, while the port runs shuffle/maint first with no accept draws on state.rng.

- **[P1] L11_stores-006** (grok, conc:n, conf:high)  Live store_will_buy always treats runes as unknown
  - ref: `reference/src/store.c:531-536 (store_will_buy: worthless OK under birth_no_selling only when tval_has_variable_power && !object_runes_known(obj))`  port: `packages/core/src/session/game.ts:2511-2523 (txnKnow never sets runesKnown); packages/core/src/session/game.ts:2577-2580 (willBuy passes runesKnown=false); packages/core/src/store/transact.ts:312 (storeSell uses know.runesKnown ?? false)`
  - exp: After runes are known, a worthless variable-power item is refused even with birth_no_selling.
  - act: Live filter and sell path always pass runesKnown=false, so the no-selling exception stays open forever for those tvals.

- **[P1] L11_stores-007** (grok, conc:n, conf:high)  Buy/sell omit the full rune-learn loop
  - ref: `reference/src/store.c:1737-1742 (do_cmd_buy: object_flavor_aware then while (!object_fully_known) learn_unknown_rune + player_know_object); reference/src/store.c:1948-1953 (do_cmd_sell: same on the sold stack before gear_object_for_use)`  port: `packages/core/src/store/transact.ts:166-170,331-335 (only optional objectFlavorAware; comments mark rune loop DEFERRED)`
  - exp: Transacting an item fully teaches every unknown rune on that object (and buy fully IDs the purchased copy).
  - act: Flavor may become known; runes are not force-learned on the transaction path.

- **[P1] L11_stores-008** (grok, conc:n, conf:high)  Maintenance deletes of store artifacts skip history_lose_artifact
  - ref: `reference/src/store.c:1090-1092 (store_delete_random: if obj->artifact history_lose_artifact); reference/src/store.c:1306-1310 (black-market cull of non-ok stock: same)`  port: `packages/core/src/store/store.ts:424-447 (storeDeleteRandom: no history hook); packages/core/src/store/store.ts:580-586 (black market cull: storeDelete only)`
  - exp: When turnover or BM cleanup destroys an artifact the player previously sold into stock, character history records the loss.
  - act: Artifact is removed from stock with no onArtifactLost / history_lose_artifact call (sell-reject path does fire onArtifactLost; maintenance does not).

- **[P1] L11_stores-001** (codex, conc:n, conf:high)  Home take/drop uses commercial buy/sell transactions
  - ref: `reference/src/store.c:1783-1852, 2009-2075`  port: `packages/web/src/shop.ts:732-800; packages/core/src/session/game.ts:2525-2535`
  - exp: At HOME, taking an item runs do_cmd_retrieve with no gold change and dropping an item runs do_cmd_stash with no gold change, using home stock and home_carry.
  - act: runStore calls game.buy for a HOME take and game.sell for a HOME drop; those facades route to storeBuy/storeSell, which price the item and debit or credit gold before using commercial store behavior.

- **[P1] L11_stores-002** (codex, conc:n, conf:high)  Store flavor messages use the wrong RNG stream
  - ref: `reference/src/store.c:453-460, 491-507, 1717-1718`  port: `packages/web/src/shop.ts:189-190, 748, 818-822`
  - exp: The accept roll and purchase_analyze ONE_OF selections consume the game randint stream in the C statement order.
  - act: flavorOneIn and flavorPick use Math.random, so the game RNG is not advanced and the chosen comments are not reproducible from the game seed.

- **[P1] L11_stores-003** (codex, conc:n, conf:high)  Shop transactions omit known-object and rune-learning updates
  - ref: `reference/src/store.c:1731-1742, 1823-1838, 1947-1953`  port: `packages/core/src/store/transact.ts:159-170, 331-335, 384-396; packages/core/src/store/store.ts:14-16`
  - exp: Buying and selling copy the known object, propagate effects, make flavor aware, and repeatedly learn unknown runes until the object is fully known; home retrieval also copies and charge-splits the known twin.
  - act: The port has no obj->known twin, only marks flavor awareness when supplied, and omits the effect propagation and rune-learning loops; home retrieval copies only the live object.

- **[P1] L11_stores-004** (codex, conc:n, conf:high)  No-selling buy test hardcodes runes as unknown
  - ref: `reference/src/store.c:524-556`  port: `packages/core/src/session/game.ts:2577-2580; packages/core/src/store/store.ts:222-239`
  - exp: With birth_no_selling, a worthless variable-power item is accepted only when object_runes_known(obj) is false.
  - act: The live willBuy path always passes false for runesKnown, so the port accepts the worthless variable-power item even after all of its runes are known.

- **[P1] L11_stores-006** (codex, conc:n, conf:high)  Maintenance drops artifacts without the C history-loss side effect
  - ref: `reference/src/store.c:1040-1095, 1300-1313`  port: `packages/core/src/store/store.ts:425-456, 574-582`
  - exp: store_delete_random and black-market cleanup call history_lose_artifact before deleting an artifact from store stock.
  - act: The port deletes the stock object without invoking any artifact-loss callback; only player sale wiring handles artifact found/lost callbacks.

- **[P2] L11_stores-005** (grok, conc:n, conf:high)  Empty-store restock omits shopkeeper retire / new-stock messages
  - ref: `reference/src/store.c:1756-1771 (if stock_num==0 after a reducing sale: one_in_(store_shuffle) -> "The shopkeeper retires." + shuffle, else "The shopkeeper brings out some new stock."; then maint x10)`  port: `packages/core/src/store/transact.ts:176-183 (shuffle chance + maint x10, no messages); packages/web/src/shop.ts:732-750 (only "You bought ... for N gold")`
  - exp: Player sees the retire or new-stock line when a real shop is cleaned out.
  - act: Restock still runs; messages are missing.

- **[P2] L11_stores-005** (codex, conc:n, conf:high)  Store display sorting uses sale price instead of object_value
  - ref: `reference/src/store.c:779-807; reference/src/player-calcs.c:939-1003`  port: `packages/web/src/shop.ts:88-107`
  - exp: store_stock_list repeatedly uses earlier_object with object_value(obj, 1) as the value tiebreaker, including the player's known-state rules for variable-power items.
  - act: sortStoreStock supplies game.price(store, obj, false, 1), which uses objectValueReal for the purchase price and can include bonuses the player does not know.

- **[P3] L11_stores-009** (grok, conc:n, conf:high)  store_will_buy flag-qualified buy rules skip object_flag_is_known
  - ref: `reference/src/store.c:549-552 (buy->flag set: require of_has && object_flag_is_known(player, obj, flag))`  port: `packages/core/src/store/store.ts:234-238 (if buy.flag and obj.flags.has(flag) return true; object_flag_is_known deferred)`
  - exp: Flag-qualified buy entries only accept items the player already knows have that flag.
  - act: Any object that merely carries the flag is accepted, even if the flag is unknown to the player.

- **[P3] L11_stores-010** (grok, conc:n, conf:med)  store_carry always uses object_value_real (drops carried-object branch)
  - ref: `reference/src/store.c:921-925 (if object_is_carried(player, obj) value = object_value; else object_value_real)`  port: `packages/core/src/store/store.ts:356-360 (always objectValueReal)`
  - exp: A still-carried object would be valued by apparent object_value when offered to store_carry.
  - act: Always real value. Live do_cmd_sell detaches via gear_object_for_use before store_carry, so the carried branch is unused on the normal sell path (same as C in practice for sells).

---
## L12_saveload  (grok=8 codex=29 terra=0)
_cross-model overlap on: save.c, savefile.c, savefile.h, save-charoutput.c_

- **[P1] L12_saveload-001** (grok, conc:n, conf:high)  Monster known_pstate (AI learn memory) is not persisted
  - ref: `reference/src/save.c:231-235 (wr_monster writes known_pstate.flags[OF_SIZE] and known_pstate.el_info[ELEM_MAX].res_level); reference/src/load.c:301-305 (rd_monster restores both); reference/src/list-options.h:94-95 (birth_ai_learn default true)`  port: `packages/core/src/session/save.ts:319-368 (SavedMonster / serializeMonster omit knownPstate); packages/core/src/session/save.ts:371-408 (deserializeMonster leaves blankMonster empty knownPstate); packages/core/src/mon/monster.ts:47-54,118-122`
  - exp: On save/load, each live monster retains the OF flags and elemental resist levels it has learned about the player (birth_ai_learn ON by default). C does not persist known_pstate.pflags (upstream gap; port matching that omission for pflags alone is correct).
  - act: serializeMonster never writes flags/elInfo; deserializeMonster rebuilds from blankMonster, so every reload wipes smart-learn memory. remove_bad_spells / mon-ranged then treats the player as fully unknown again until re-learning draws resume.

- **[P1] L12_saveload-003** (codex, conc:n, conf:high)  Live save path does not use the C block savefile
  - ref: `reference/src/savefile.c:29-39,384-447,554-584`  port: `packages/core/src/session/save.ts:1575-1606; packages/core/src/session/game.ts:2683-2733; packages/web/src/main.ts:3709-3718; packages/core/src/save/buffer.ts:207-230`
  - exp: Normal save/load uses the C byte stream: Save plus VNLA header, 28-byte block headers, the named saver/loader tables, payloads, and x padding; savefile_save and savefile_load operate on that stream.
  - act: The live web path JSON-stringifies SavedGame, appends an FNV trailer, base64-encodes it, and stores it in localStorage; loadGame consumes that JSON object. The binary buffer helper is exported but has no live save/load caller.

- **[P1] L12_saveload-004** (codex, conc:n, conf:high)  Savefile variant header is replaced by an arbitrary numeric version
  - ref: `reference/src/savefile.c:79-82,404-407`  port: `packages/core/src/save/buffer.ts:203-210,254-260`
  - exp: Every file starts with bytes 83,97,118,101 followed by the exact four bytes V,N,L,A.
  - act: writeSavefile writes the caller-supplied numeric version as little-endian bytes after Save, and readSavefile only checks the first four magic bytes.

- **[P1] L12_saveload-005** (codex, conc:n, conf:high)  Block header validation is weaker than the C parser
  - ref: `reference/src/savefile.c:460-500`  port: `packages/core/src/save/buffer.ts:254-285`
  - exp: check_header requires all eight file-header bytes; next_blockheader requires an exact 28-byte read and savefile_head[15] == 0 before reconstructing the name, version, and size.
  - act: readSavefile checks only the four-byte Save magic, does not validate the VNLA bytes, does not reject a short block header before indexed reads, and accepts a 16-byte name with no terminating zero.

- **[P1] L12_saveload-006** (codex, conc:n, conf:high)  Port rejects checksum mismatches that the C loader ignores
  - ref: `reference/src/savefile.c:525-540`  port: `packages/core/src/save/buffer.ts:249-281`
  - exp: C load_block reads exactly b->size bytes and calls the loader; although the header carries a checksum, this upstream code does not compare buffer_check with it.
  - act: readSavefile recomputes the payload sum and throws when it differs from the header check value.

- **[P1] L12_saveload-007** (codex, conc:n, conf:high)  C saver and loader registries are not ported
  - ref: `reference/src/savefile.c:102-155,506-519,554-576; reference/src/savefile.h:85-133`  port: `packages/core/src/save/buffer.ts:188-196,254-286; packages/core/src/session/save.ts:984-1015`
  - exp: The savefile owns the ordered description/rng/options/messages/.../history block saver and loader tables, selects a loader by exact name and version, and invokes each loader while reading the file.
  - act: The port exposes generic SaveBlock and BlockLoader types and only splits bytes into blocks; it supplies no C block registry, no exact named loader dispatch, and the live serializer is one JSON object.

- **[P1] L12_saveload-009** (codex, conc:n, conf:high)  Truncated payload sizes are not rejected before checksum parsing
  - ref: `reference/src/savefile.c:525-537`  port: `packages/core/src/save/buffer.ts:264-285`
  - exp: file_read must return exactly b->size before the loader can run; a short payload makes load_block fail.
  - act: readSavefile takes subarray(pos, pos + size) without checking its length, sums the shorter result, and can accept a header whose declared payload extends past the input when the resulting sum matches.

- **[P1] L12_saveload-010** (codex, conc:?, conf:high)  C savefile public API and save status are unmapped
  - ref: `reference/src/savefile.h:31-53; reference/src/savefile.c:384-447,631-657`  port: `packages/core/src/session/game.ts:2683-2733; packages/web/src/main.ts:3709-3718; packages/web/src/roster.ts:103-112; NONE for character_saved/savefile_save/savefile_load signatures`
  - exp: character_saved is a global status flag; savefile_save(path) and savefile_load(path, cheat_death) return bool and perform the C file operations, while load completes the character state and applies cheat death.
  - act: saveGame returns a SavedGame object, persistSave returns void and swallows storage exceptions, and loadGame takes an in-memory pack plus SavedGame and throws on unsupported versions. No character_saved flag or path-based C API exists.

- **[P1] L12_saveload-013** (codex, conc:n, conf:high)  C binary save/load format is replaced by an incompatible JSON format
  - ref: `reference/src/save.c:49-1071; reference/src/load.c:99-1761`  port: `packages/core/src/session/save.ts:2-7,1575-1614; packages/core/src/session/game.ts:2682-2700,2728-3009; packages/web/src/main.ts:549-565,3709-3719`
  - exp: The save path writes the C block records and the load path reads those records, including the C item, player, dungeon, object, monster, trap, store, and history fields.
  - act: The port writes JSON.stringify(SavedGame) plus an FNV trailer and stores it as base64 in localStorage; loadGame accepts only SAVE_VERSION 2 and no port reader consumes the C block stream.

- **[P1] L12_saveload-015** (codex, conc:n, conf:high)  RNG quick/fixed state and state-index normalization diverge
  - ref: `reference/src/save.c:286-307; reference/src/load.c:388-415`  port: `packages/core/src/rng.ts:61-68,387-412`
  - exp: C saves Rand_value, state_i, the 32-word WELL state, and padding; load reduces state_i modulo RAND_DEG and forces Rand_quick=false.
  - act: RngState persists quick, fixed, and fixval, restores stateI directly without modulo, and loadGame restores that state unchanged at packages/core/src/session/game.ts:2810-2811.

- **[P1] L12_saveload-016** (codex, conc:n, conf:high)  Monster known player-state memory is not saved
  - ref: `reference/src/save.c:204-256; reference/src/load.c:259-352`  port: `packages/core/src/session/save.ts:319-340,342-368,371-408`
  - exp: wr_monster writes known_pstate.flags and known_pstate.el_info for every monster, and rd_monster restores them before the monster becomes live.
  - act: SavedMonster contains mflag but no knownPstate flags or elemental memory; deserializeMonster starts from blankMonster and never restores those fields.

- **[P1] L12_saveload-017** (codex, conc:n, conf:high)  Object activation and effect presence are not round-tripped
  - ref: `reference/src/save.c:113-118,184-192; reference/src/load.c:153-155,223-232,247-250`  port: `packages/core/src/session/save.ts:76-114,116-151,202-252`
  - exp: C persists the per-object effect-present byte and activation index, then restores activation by that saved index and sets effect only when the saved byte is nonzero.
  - act: SavedObject has no effect-present or activation field; deserializeObject always takes kind.effect and chooses artifact.activation or kind.activation.

- **[P1] L12_saveload-019** (codex, conc:n, conf:high)  Known object copies are omitted from gear and store saves
  - ref: `reference/src/save.c:715-741,744-764; reference/src/load.c:1122-1189,1196-1261`  port: `packages/core/src/session/save.ts:685-709,1037-1044,1343-1404; packages/core/src/session/game.ts:2797-2799,2838-2842`
  - exp: C writes real gear and a separate known gear list, and writes a known-object followed by a real-object pair for every store item; load reconnects each known object to its real object.
  - act: The port serializes one SavedObject per gear handle, floor pile, held object, and store item, with no known-object counterpart or known link.

- **[P1] L12_saveload-020** (codex, conc:n, conf:high)  Artifact seen and everseen flags are not persisted
  - ref: `reference/src/save.c:674-688; reference/src/load.c:1036-1059`  port: `packages/core/src/obj/make.ts:730-765; packages/core/src/session/save.ts:805-816,972-981,1406-1418; packages/core/src/session/game.ts:2782-2793`
  - exp: C saves and loads created, seen, and everseen for every artifact, plus the reserved byte.
  - act: ArtifactState contains only created flags and SavedGame carries only an artifactsCreated id list; seen and artifact-everseen have no serialized or restored representation.

- **[P1] L12_saveload-021** (codex, conc:n, conf:high)  Current decoy marker is lost on load
  - ref: `reference/src/load.c:1473-1505`  port: `packages/core/src/session/save.ts:676-683,1308-1337; packages/core/src/session/game.ts:2838-2842`
  - exp: rd_traps sets the active cave decoy grid when it reads a decoy trap, so cave_find_decoy and monster targeting still see the decoy after reload.
  - act: deserializeTraps rebuilds only the trap map and loadGame assigns it without setting GameState.decoy; SavedGame has no current-level decoy field.

- **[P1] L12_saveload-022** (codex, conc:n, conf:high)  Dead saves include live dungeon state that C deliberately omits
  - ref: `reference/src/save.c:873-910,915-957,959-976,1001-1045; reference/src/load.c:1394-1427,1432-1471,1473-1505,1623-1697`  port: `packages/core/src/session/save.ts:1003-1057; packages/core/src/session/game.ts:2827-2842`
  - exp: For a dead player, C skips dungeon objects, monsters, traps, and chunk-list payloads; the load functions likewise return without restoring those live collections.
  - act: serializeGame always serializes chunk, floor, traps, monsters, groups, and level data, and loadGame always reconstructs them even when isDead is true.

- **[P1] L12_saveload-023** (codex, conc:n, conf:high)  Persistent-level connector metadata is truncated and not remapped
  - ref: `reference/src/save.c:845-867,1027-1043; reference/src/load.c:1366-1383,1653-1678`  port: `packages/core/src/session/save.ts:852-856,1071-1080,1455-1458,1512-1514,1562-1565; packages/core/src/session/game.ts:2892-2900`
  - exp: C persists each connector's x, y, feature, and every SQUARE_SIZE info byte, then restores all of those fields when birth_levels_persist is enabled.
  - act: The port persists only x, y, and numeric feat for currentJoins and cached joins, drops connector info bytes, and restores feat directly without a feature-id remap.

- **[P1] L12_saveload-025** (codex, conc:n, conf:high)  History artifact references use unstable numeric indices
  - ref: `reference/src/save.c:1048-1069; reference/src/load.c:1715-1758`  port: `packages/core/src/player/history.ts:29-42; packages/core/src/session/save.ts:451-474,561-562`
  - exp: C writes the artifact name for each history entry and rd_history resolves that name against the current artifact registry before storing a_idx.
  - act: HistoryInfo stores aIdx as a raw number and serializePlayer copies it directly; load copies the number without resolving an artifact identity.

- **[P1] L12_saveload-026** (codex, conc:n, conf:high)  Player load validation and repair rules are missing
  - ref: `reference/src/load.c:766-839`  port: `packages/core/src/session/save.ts:587-669; packages/core/src/session/game.ts:2734-2736`
  - exp: C rejects player levels outside 1..PY_MAX_LEVEL, repairs max_lev/max_depth/recall_depth, resets the death cause for a nonnegative HP, bounds timed-effect counts, and skips unsupported timed entries.
  - act: deserializePlayer assigns the saved values directly, copies arrays without count checks, and loadGame validates only the top-level SAVE_VERSION.

- **[P1] L12_saveload-027** (codex, conc:n, conf:high)  Remapped chunk data is mutated in place during load
  - ref: `reference/src/load.c:1307-1355`  port: `packages/core/src/session/save.ts:1426-1437`
  - exp: C decodes each save stream into a new chunk, so reading the same source again applies the same source values and does not rewrite the saved input.
  - act: deserializeChunk calls remapFeats(data.feats, featRemap) directly before restoreSquares, mutating the SavedGame payload's feature array.

- **[P1] L12_saveload-028** (codex, conc:n, conf:high)  Missing artifact or ego references silently degrade instead of failing the item read
  - ref: `reference/src/load.c:137-151,238-245`  port: `packages/core/src/session/save.ts:210-215,217-252`
  - exp: C treats an absent artifact or ego lookup as an item-read failure, and rejects an item whose kind cannot be found.
  - act: deserializeObject maps an unknown artifact or ego id to null and continues; only an unknown kind throws.

- **[P2] L12_saveload-002** (grok, conc:n, conf:high)  SIDEBAR_MODE is a global pref, not a per-character save field
  - ref: `reference/src/save.c:322-323 (wr_options: wr_byte SIDEBAR_MODE); reference/src/load.c:442-449 (rd_options restores SIDEBAR_MODE into the term when present)`  port: `packages/web/src/main.ts:856-881 (SIDEBAR_MODE_KEY in localStorage, not encodeSavedGame); packages/core/src/player/options.ts:204-212 (OptionState.snapshot has hitpointWarn/delayFactor/lazymoveDelay but no sidebar)`
  - exp: Sidebar layout (Left/Top/None) is part of the character options block and round-trips with that savefile.
  - act: Sidebar mode is a host-global localStorage key shared by every roster slot. Switching characters inherits the last character's sidebar; a transferred save does not carry it.

- **[P2] L12_saveload-008** (codex, conc:n, conf:med)  String writer changes C byte and terminator behavior
  - ref: `reference/src/savefile.c:252-260`  port: `packages/core/src/save/buffer.ts:79-85`
  - exp: wr_string writes bytes until the first C NUL in str, then writes one terminating zero; the bytes are the supplied char sequence.
  - act: putString iterates over every JavaScript code unit, masks each to its low byte, writes embedded NULs and later characters, then adds another zero.

- **[P2] L12_saveload-011** (codex, conc:n, conf:high)  Description and panic-name APIs have no port counterpart
  - ref: `reference/src/savefile.h:45-53; reference/src/savefile.c:595-624,661-680`  port: `packages/web/src/roster.ts:15-30,61-112; NONE for savefile_get_description/savefile_get_panic_name`
  - exp: savefile_get_description reads the description block and returns Invalid savefile for a bad header; savefile_get_panic_name builds the panic path and clears the result when it cannot fit or validate.
  - act: The roster stores separate JSON metadata and base64 save bytes but exposes neither a description-block reader nor a panic-save-name builder.

- **[P2] L12_saveload-014** (codex, conc:n, conf:high)  Save description string is not reproduced by the live save path
  - ref: `reference/src/save.c:49-66`  port: `packages/web/src/main.ts:3686-3701`
  - exp: wr_description writes either "%s, dead (%s)" or "%s, L%d %s %s, at DL%d" using the player full name, death cause, level, race, class, and depth.
  - act: The port stores separate roster metadata fields and does not construct or persist the C description string; it uses the shell playerName and has no death-cause field in CharMeta.

- **[P2] L12_saveload-018** (codex, conc:n, conf:med)  Zero-power curse timeout data is dropped
  - ref: `reference/src/save.c:163-172; reference/src/load.c:201-211`  port: `packages/core/src/session/save.ts:176-189,285-298`
  - exp: When curses exists, C writes every curse entry's power and uint16 timeout, including entries whose power is zero.
  - act: serializeCurseList emits only entries with power greater than zero, and deserializeCurseList recreates omitted entries with timeout zero.

- **[P2] L12_saveload-024** (codex, conc:n, conf:high)  Full monster lore is saved although C save.c persists only kills and thefts
  - ref: `reference/src/save.c:356-373; reference/src/load.c:498-544`  port: `packages/core/src/session/save.ts:735-740,1120-1145,1150-1183`
  - exp: The save block contains only each race's pkills and thefts; rd_monster_memory restores those two counters and leaves the other lore fields to the normal lore source/defaults.
  - act: The port serializes and restores every MonsterLore counter, blow memory, flags, spell flags, and knowledge booleans.

- **[P3] L12_saveload-003** (grok, conc:y, conf:high)  save_charoutput / CharOutput.txt has no port
  - ref: `reference/src/save-charoutput.c:25-48 (save_charoutput writes ANGBAND_DIR_USER/CharOutput.txt with race/class/mapName/dLvl/cLvl/isDead/killedBy); reference/src/savefile.c:391-392 (savefile_save always calls save_charoutput)`  port: `NONE`
  - exp: Every successful save also refreshes CharOutput.txt (angband.live synopsis).
  - act: No CharOutput writer, no equivalent export on persistSave. Roster meta (web/src/roster.ts / metaFromState) carries name/race/class/level/depth/alive for the in-app picker only.

- **[P3] L12_saveload-004** (grok, conc:y, conf:high)  Live save format is JSON, not C block binary (by design)
  - ref: `reference/src/savefile.c:79-155,325-379 (magic "Save" + variant "VNLA" + named blocks with 28-byte headers, additive checksum, 'x' pad); reference/src/save.c / load.c (wr_*/rd_* payload bodies)`  port: `packages/core/src/session/save.ts:1-18,70,985-1146,1576-1582 (SAVE_VERSION JSON + stampSavefile); packages/web/src/main.ts:3714 (encodeSavedGame into localStorage)`
  - exp: On-disk save is the 4.2.x block binary; old Angband saves would load (parity baseline does not require import of old files per PORT_PLAN decision 2/9).
  - act: Live path writes versioned JSON (entity graph + namespaced ids) stamped with an FNV-1a trailer. Binary framing in packages/core/src/save/buffer.ts is implemented and unit-tested but not wired to serializeGame/saveGame. Upstream savefiles cannot load (explicit decision 9).

- **[P3] L12_saveload-005** (grok, conc:n, conf:high)  Binary writeSavefile stamp is a numeric version, not variant "VNLA"
  - ref: `reference/src/savefile.c:81-82,405-406 (savefile_name = {'V','N','L','A'}; written as the second 4 bytes after magic)`  port: `packages/core/src/save/buffer.ts:207-209 (writeSavefile writes writeU32LE(out, version) after magic)`
  - exp: Bytes 4..7 of a framed save are always ASCII "VNLA" (variant id). Versioning is per-block, not in the file header.
  - act: writeSavefile puts a little-endian integer version (tests use 7, 1). readSavefile accepts any u32 and does not require "VNLA". Dead for the live path, but the module claims a faithful savefile.c framing port.

- **[P3] L12_saveload-006** (grok, conc:y, conf:high)  No panic-save path (savefile_get_panic_name)
  - ref: `reference/src/savefile.h:53; reference/src/savefile.c:671-679 (savefile_get_panic_name builds ANGBAND_DIR_PANIC path)`  port: `NONE (web uses pagehide/visibilitychange autosave to the same roster slot: packages/web/src/main.ts:3722-3733,5799-5802)`
  - exp: Crash / panic path can write a distinct panic save under the panic directory without clobbering the main savefile name resolution.
  - act: No panic directory or alternate panic filename. Tab close / hide force-autosaves into the active slot (best-effort localStorage).

- **[P3] L12_saveload-007** (grok, conc:n, conf:high)  deserializeObject activation ignores ego.activation
  - ref: `reference/src/save.c:185-188 (wr_item writes obj->activation->index or 0); reference/src/load.c:223-227 (rd_item restores &activations[tmp16u]); reference/src/obj-make.c ego path (ego activation trumps object)`  port: `packages/core/src/session/save.ts:239-241 (activation: (artifact ? artifact.activation : null) ?? kind.activation); packages/core/src/obj/make.ts:625-629 (egoApplyMagic sets obj.activation = ego.activation)`
  - exp: Load restores the activation pointer that was on the object (artifact, ego, or kind), matching the saved index.
  - act: Re-derive is artifact.activation ?? kind.activation only; ego.activation is never consulted. Base 4.2.6 ego_item.txt has zero act: lines (impact is latent), but any mod ego or future data with activations would lose *activate* after reload while time still round-trips.

- **[P3] L12_saveload-008** (grok, conc:n, conf:high)  History aIdx is a raw numeric index, not an artifact name
  - ref: `reference/src/save.c:1063-1067 (wr_history: artifact name string or ""); reference/src/load.c history loader (lookup by name)`  port: `packages/core/src/session/save.ts:562 (hist: p.hist.map spread, aIdx as number); packages/core/src/player/history.ts:37 (aIdx: number)`
  - exp: History artifact references survive pack reorder via stable name (C) or namespaced id (port's SAVE_VERSION 2 rule for other content).
  - act: hist[].aIdx is the runtime aidx integer with no ContentIdResolver remap. Same-pack reloads match; reordered/extended artifact tables can retarget LOST/FOUND lines.

- **[P3] L12_saveload-001** (codex, conc:n, conf:high)  save-charoutput.c has no port implementation
  - ref: `reference/src/save-charoutput.c:25`  port: `NONE`
  - exp: save_charoutput() writes ANGBAND_DIR_USER/CharOutput.txt as {, race, class, mapName "Angband", dLvl, cLvl, isDead, killedBy, and }, returns false on any write/open/close failure, and is invoked by savefile_save() before the binary save.
  - act: No packages/ implementation defines save_charoutput(), writes the CharOutput.txt schema, or invokes an equivalent short synopsis export during saving; packages/web/src/charsheet.ts only offers a different full character-dump download.

- **[P3] L12_saveload-002** (codex, conc:n, conf:high)  save-charoutput.h has no port interface
  - ref: `reference/src/save-charoutput.h:10`  port: `NONE`
  - exp: The save-charoutput interface exposes bool save_charoutput(void) so savefile_save() can generate the short CharOutput.txt synopsis.
  - act: No packages/ module exposes a corresponding save_charoutput interface or callable equivalent for the C short-output contract.

- **[P3] L12_saveload-012** (codex, conc:n, conf:high)  Savefile header constants are not mapped
  - ref: `reference/src/savefile.h:21-23`  port: `packages/core/src/save/buffer.ts:23-30; packages/core/src/session/save.ts:62-70; NONE for FINISHED_CODE/ITEM_VERSION/EGO_ART_KNOWN`
  - exp: The header exports FINISHED_CODE 255, ITEM_VERSION 5, and EGO_ART_KNOWN 0xffffffff for the save/load implementation.
  - act: The port defines SAVEFILE_MAGIC, SAVEFILE_HEAD_SIZE, PAD_BYTE, and an unrelated JSON SAVE_VERSION 2, but no counterparts for those three C constants.

- **[P3] L12_saveload-029** (codex, conc:n, conf:high)  Port-only manifest, mod bags, and orphan blocks have no C save basis
  - ref: `reference/src/save.c:418-1070`  port: `packages/core/src/session/save.ts:818-842; packages/core/src/session/game.ts:2693-2700; packages/core/src/mod/save-blocks.ts:1-32`
  - exp: The C save contains only the player/world blocks implemented by save.c and no pack manifest, opaque mod bag, or orphan quarantine record.
  - act: The port adds manifest, mods, orphans, and orphan acknowledgement fields and mutates them during load reconciliation.

---
## L13_score_death  (grok=6 codex=0 terra=0)

- **[P1] L13_score_death-001** (grok, conc:n, conf:high)  Winner retirement never stamps WINNING_HOW or death_knowledge bonuses before enter_score
  - ref: `reference/src/player-util.c:288-294 (death_knowledge: if total_winner then depth=0, died_from=WINNING_HOW, exp=max_exp, lev=max_lev, au+=10000000); reference/src/player-util.c:313 (enter_score after that prep); reference/src/score.h:37 (WINNING_HOW "Ripe Old Age"); reference/src/score.c:309 (build_score uses p->died_from); reference/src/score-util.c:59-63,284-307 (winners sort before non-winners via how==WINNING_HOW)`  port: `packages/web/src/main.ts:3371-3374 (retire sets diedFrom="Retiring" only); packages/web/src/main.ts:5260-5282 (DEAD path: historyUnmaskUnknown + enterScore with player.diedFrom as-is; no winner prep); packages/core/src/score/score.ts:77-93,264-284 (buildScore/enterScore faithfully use the how string they are given)`
  - exp: A total_winner who retires is prepped by death_knowledge so the high-score record has how="Ripe Old Age", cur_dun=0, cur_lev=max_lev, gold includes +10000000, and highscore_where/cmp place that record ahead of every non-winner.
  - act: Retire keeps diedFrom="Retiring" and totalWinner true (so the Retiring gate is bypassed and the score IS entered), but how stays "Retiring", depth/lev/au are not adjusted. Sorting treats the victory like any other death cause; gold and town-level display are wrong. WINNING_HOW exists only in types/sort helpers and is never written on the live path.

- **[P2] L13_score_death-002** (grok, conc:n, conf:high)  enter_score rejection messages are discarded on the live death path
  - ref: `reference/src/score.c:283-304 (msg "Score not registered for cheaters." / "for wizards." / "due to interruption." / "due to retiring." + EVENT_MESSAGE_FLUSH on each reject branch)`  port: `packages/core/src/score/score.ts:264-277 (enterScore returns {entered:false, reason} and never msgs); packages/web/src/main.ts:5272-5283 (const outcome = enterScore(...); void outcome;)`
  - exp: A gated death shows the C rejection string and flushes messages before continuing the death UI.
  - act: Core only returns a reason code; the shell throws the outcome away. Cheater/wizard/interrupt/retire non-winner deaths silently skip scoring with no player-visible notice.

- **[P3] L13_score_death-003** (grok, conc:y, conf:high)  High-score persistence is JSON localStorage, not scores.raw with lock files
  - ref: `reference/src/score.c:37-66 (highscore_read: ANGBAND_DIR_SCORES/scores.raw binary sizeof(high_score) records + regularize); reference/src/score.c:98-198 (highscore_write: scores.lok lock, scores.new, rename dance, setuid)`  port: `packages/core/src/score/types.ts:64-75 (ScoreStore seam); packages/web/src/score.ts:48-78 (createLocalStorageScoreStore: JSON array, regularize on read, no lock file)`
  - exp: Fixed-width 128-byte ASCII records in scores.raw with atomic rewrite under scores.lok.
  - act: Compact typed HighScore[] as JSON under localStorage key "neo-angband-scores". regularize-on-read and MAX_HISCORES cap match the defensive posture; locking/setuid/file rename cannot exist in the browser.

- **[P3] L13_score_death-004** (grok, conc:y, conf:high)  build_score uid is always 0 (no OS player_uid)
  - ref: `reference/src/score.c:244 (strnfmt entry->uid "%7u", player_uid)`  port: `packages/core/src/score/score.ts:51-52,86 (uid: deps.uid ?? 0); packages/web/src/main.ts:3592-3602 (scoreBuildDeps never passes uid)`
  - exp: Score records carry the host user id in the User column of the Hall of Fame.
  - act: Every record uses uid 0. Display still prints "(User 0, ...)" faithfully for that value.

- **[P3] L13_score_death-005** (grok, conc:n, conf:high)  highscore_valid accepts blank-what records with non-empty other fields
  - ref: `reference/src/score-util.c:166-186 (empty what[0]: valid only if pts/gold/turns/day/who/uid/p_r/p_c/cur_*/max_*/how are all empty); reference/src/tests/player/pscore.c:76-114`  port: `packages/core/src/score/score.ts:108-109 (if isEmpty(s) return true without scanning other fields)`
  - exp: A record with what empty but e.g. pts set is invalid (and regularize zeros it).
  - act: any HighScore with what=="" is treated as a valid empty regardless of leftover numeric/string fields. highscoreRegularize still drops isEmpty entries, so a clean compact list after regularize matches C's end state for typical corruption; the pure validity predicate does not.

- **[P3] L13_score_death-006** (grok, conc:n, conf:high)  highscore_regularize sets irregular=true for every empty slot it drops
  - ref: `reference/src/score-util.c:218-220 (skip empty what without setting irregular); reference/src/score-util.c:211-215,225-237 (irregular only for invalid zeroing, gap-compacting copies, or out-of-order); reference/src/tests/player/pscore.c:425-436 (ordered non-empty + trailing empties => regularize returns false)`  port: `packages/core/src/score/score.ts:212-216 (if !valid || isEmpty: irregular=true; continue)`
  - exp: A best-first list with only trailing empty padding is already regular; regularize returns false and leaves contents ordered.
  - act: Any empty element in the input forces irregular=true even when non-empty prefix was already ordered. Compact live lists usually have no empties (flag stays correct); callers that pass padded arrays see a false positive irregular flag (web store discards the flag).

---
## L14_ui_frontend  (grok=15 codex=43 terra=0)
_cross-model overlap on: ui-display.c, ui-effect.c, ui-death.c, main-win.c, ui-command.c, ui-signals.c, ui-spoil.c_

- **[P1] L14_ui_frontend-001** (grok, conc:n, conf:high)  Live sidebar stats omit equipment/timed stat_use (displayDeps underwires)
  - ref: `reference/src/ui-display.c:153-166 (prt_stat prints player->state.stat_use[stat] after calc_bonuses); reference/src/player-calcs.c (state.stat_use includes race+class+equip+shape+timed)`  port: `packages/web/src/main.ts:4605-4607 (displayDeps returns only timedEffects + unignoring); packages/core/src/game/display.ts:184-190,203,364 (defaultStatUse = race+class on statCur only; value = cnvStat(deps.statUse)); packages/web/src/screens.ts:416-438 (charSheetDeps DOES pass state.playerState.statUse)`
  - exp: Sidebar STR/INT/WIS/DEX/CON show the full modified stat_use (rings of strength, etc.).
  - act: Live HUD always falls back to race+class-only defaultStatUse. Character sheet ('C') is correct via charSheetDeps; the always-visible sidebar is not. state.playerState.statUse is computed every calcBonuses pass but never passed into displayDeps.

- **[P1] L14_ui_frontend-002** (grok, conc:n, conf:high)  Resting / repeat status line never receives isResting or nRepeats
  - ref: `reference/src/ui-display.c:957-1017 (prt_state: "Rest******" / "Repeat NNN" from player_is_resting + cmd_get_nrepeats)`  port: `packages/web/src/main.ts:4605-4607,4649-4658 (displayDeps omits isResting/restingCount/nRepeats; statusLineModel uses defaults false/0); packages/web/src/main.ts:3522,3411-3577 (rest sets state.resting live); packages/core/src/game/display.ts:661-707 (stateRuns only emits Rest/Repeat when deps set)`
  - exp: While resting, status line shows Rest + count field (* / & / ! / digits); while a command repeats, "Repeat NNN".
  - act: deps.isResting and deps.nRepeats always default false/0 on the live path, so prt_state is always the idle single-space reservation. Rest still runs and regens; the status chrome is blank.

- **[P1] L14_ui_frontend-003** (grok, conc:n, conf:high)  EF_SELECT player choice UI missing; live path always randomizes
  - ref: `reference/src/ui-effect.c:34-180 (textui_get_effect_from_list: menu of effect_get_menu_name rows + "one of the following at random"); reference/src/effects-info.c:583 (effect_get_menu_name)`  port: `packages/core/src/effects/interpreter.ts:168-172,475-501 (chooseEffect optional; if absent choice=-2 then randint0); packages/content/pack/activation.json:2704+ and object.json SELECT chains (e.g. WAND_BREATH); packages/web/src (no textui_get_effect_from_list / chooseEffect injection anywhere)`
  - exp: Activating a SELECT effect prompts Which effect? with named rows and optional random; choice is deterministic player input (RNG only if random picked).
  - act: chooseEffect is never wired on the live effect env (only unit tests supply it). Player-origin SELECT with count>=2 falls through to random, drawing RNG and skipping the menu. effect_get_menu_name has no ported formatter (menuName strings sit unused in EFFECT_ENTRIES).

- **[P1] L14_ui_frontend-005** (codex, conc:n, conf:high)  Birth random choices use an independent RNG
  - ref: `reference/src/ui-birth.c:678`  port: `packages/web/src/birth.ts:1207`
  - exp: Random birth choices consume the shared game RNG stream.
  - act: Random birth choices use a new Date.now-seeded RNG.

- **[P1] L14_ui_frontend-017** (codex, conc:n, conf:high)  Select effects fall back to random choice
  - ref: `reference/src/ui-effect.c:162`  port: `packages/core/src/effects/interpreter.ts:487`
  - exp: EF_SELECT presents an effect menu, including the optional random entry, and returns the selected index.
  - act: No live chooseEffect implementation is wired, so the interpreter selects randomly.

- **[P1] L14_ui_frontend-024** (codex, conc:n, conf:high)  Store flavor uses the wrong RNG and omits hints
  - ref: `reference/src/ui-store.c:139`  port: `packages/web/src/shop.ts:180`
  - exp: Welcome and hint choices use the game RNG with the C one_in_ and randint0 draw order.
  - act: Welcome text uses Math.random and omits the C hint branches.

- **[P2] L14_ui_frontend-004** (grok, conc:n, conf:high)  Sidebar title ignores wizard mode and total_winner
  - ref: `reference/src/ui-display.c:173-187 (fmt_title: [=-WIZARD-=] if player->wizard; ***WINNER*** if total_winner or lev>PY_MAX_LEVEL)`  port: `packages/web/src/main.ts:4605-4607,3625,5428 (wizardMode lives in shell; never passed as displayDeps.wizard); packages/core/src/game/display.ts:138-142,210-211,253-255 (wizard/totalWinner default false; fmtTitle reads deps only, not Player.totalWinner)`
  - exp: Wizard title and winner banner on the left sidebar when those flags are set.
  - act: Title always uses class level title (or shape). player.totalWinner exists on Player and is used for tombstone/score, but displayDeps does not pass totalWinner: player.totalWinner or wizard: wizardMode.

- **[P2] L14_ui_frontend-005** (grok, conc:n, conf:high)  prt_moves never sees num_moves from calc_bonuses
  - ref: `reference/src/ui-display.c:1145 (prt_moves uses player->state.num_moves); player-calcs sets num_moves from OBJ_MOD_MOVES`  port: `packages/core/src/player/calcs.ts:382,1290-1291 (PlayerState.numMoves); packages/web/src/main.ts:4605-4607 (displayDeps omits numMoves); packages/core/src/game/display.ts:608-612`
  - exp: Status line shows "Moves +N" / "Moves -N" when extra_moves nonzero.
  - act: numMoves always defaults to 0 in resolveDeps; movement-bonus gear never lights the indicator (though player-turn energy math does read state.playerState.numMoves).

- **[P2] L14_ui_frontend-006** (grok, conc:n, conf:high)  Death menu omits Examine items (death_examine)
  - ref: `reference/src/ui-death.c:356-367 (death_actions includes { 'x', "Examine items", death_examine })`  port: `packages/web/src/game-menu.ts:11-16,134-160 (deathMenuEntries deliberately drops Examine items with comment "needs the get_item examine loop")`
  - exp: After death, 'x' opens item examine over final gear.
  - act: Row absent; player cannot inspect final inventory/equipment from the death menu (Information sheet is partial substitute only).

- **[P2] L14_ui_frontend-007** (grok, conc:n, conf:high)  history_display invents per-row colours not in the C
  - ref: `reference/src/ui-history.c:67-76 (prt(buf,...) default white for every row; only string " (LOST)" marks lost artifacts)`  port: `packages/web/src/screens.ts:1030-1055 (HIST_KNOWN_GOLD for ARTIFACT_KNOWN; DIM for ARTIFACT_LOST; comment admits "web-native enhancement")`
  - exp: All history rows white; lost arts distinguished only by the " (LOST)" suffix text.
  - act: Known artifacts render gold (COLOUR_YELLOW via UI_GOLD); lost arts render slate dim. Strings/layout match; colours do not.

- **[P2] L14_ui_frontend-008** (grok, conc:?, conf:high)  Multi-term subwindows (PW_MESSAGE/INVEN/MONLIST/...) not modelled
  - ref: `reference/src/ui-init.c:91-103 (default_window_flag[1..7] = PW_MESSAGE, PW_INVEN, PW_MONLIST, PW_ITEMLIST, PW_MONSTER|PW_OBJECT, PW_OVERHEAD, PW_PLAYER_2); ui-term.c multi-term; main-win.c multi-window`  port: `packages/web/src/term.ts:89-98 (single FIXED 80x24 GlyphTerm); packages/web/src/options.ts:11,35 (Subwindow setup row present but "no subwindows modelled")`
  - exp: Optional auxiliary terminals mirror inventory, messages, mon list, overhead map, etc. while playing.
  - act: One canvas term; those views only via modal keys (i/e/[/]/-P/M/...). Content exists; simultaneous subwindow furniture does not.

- **[P2] L14_ui_frontend-014** (grok, conc:n, conf:med)  Equippy chars use kind dAttr/dChar, not object_attr/object_char
  - ref: `reference/src/ui-display.c:269-294 (prt_equippy: object_attr(obj) / object_char(obj), including flavor when applicable)`  port: `packages/web/src/main.ts:4605-4607 (displayDeps omits objectAttr/objectChar); packages/core/src/game/display.ts:149-155,213-215,411-424 (default colorCharToAttr(kind.dAttr) + kind.dChar); map render in main.ts:4410-4422 DOES use flavor for floor/map objects`
  - exp: Equipment row glyphs match map/inventory flavor-aware attr/char for unaware flavored wearables (rings/amulets).
  - act: Equippy always uses base kind glyph/colour; map path is flavor-aware. Inconsistency on the same character view.

- **[P2] L14_ui_frontend-002** (codex, conc:n, conf:high)  Main Windows frontend does not decode C background attributes
  - ref: `reference/src/main-win.c:2131`  port: `packages/web/src/term.ts:399`
  - exp: Decode MULT_BG attributes and render BG_SAME, BG_DARK, or BG_BLACK backgrounds.
  - act: Generic text output stores only foreground color unless a caller explicitly supplies a CSS background.

- **[P2] L14_ui_frontend-006** (codex, conc:n, conf:high)  Random birth name is missing
  - ref: `reference/src/ui-birth.c:725`  port: `packages/web/src/birth.ts:1652`
  - exp: Random completion calls player_random_name() and accepts the generated name.
  - act: Random completion leaves the name empty and defaults it to Adventurer.

- **[P2] L14_ui_frontend-007** (codex, conc:n, conf:high)  Birth help key is a no-op
  - ref: `reference/src/ui-birth.c:859`  port: `packages/web/src/birth.ts:946`
  - exp: The birth menu '?' key opens do_cmd_help().
  - act: The birth menu recognizes '?' and returns without opening help.

- **[P2] L14_ui_frontend-008** (codex, conc:n, conf:high)  Screen dump format and contents differ
  - ref: `reference/src/ui-command.c:540`  port: `packages/web/src/main.ts:4315`
  - exp: Prompt for HTML or forum text, optionally include the monster-list subwindow, reset visuals, and write the terminal grid dump.
  - act: Always downloads a PNG of the current canvas.

- **[P2] L14_ui_frontend-009** (codex, conc:n, conf:high)  Player context menu omits Use
  - ref: `reference/src/ui-context.c:267`  port: `packages/web/src/context-menu.ts:63`
  - exp: The player context menu includes the generic Use command.
  - act: The player context menu starts with Cast and has no Use entry.

- **[P2] L14_ui_frontend-010** (codex, conc:n, conf:high)  Player context availability rules differ
  - ref: `reference/src/ui-context.c:269`  port: `packages/web/src/context-menu.ts:63`
  - exp: Cast, Go Up, Go Down, and Explore are added only when their C predicates permit them; Explore depends on autoexplore_commands.
  - act: Cast and stair commands are always rendered disabled when unavailable, and Explore is always rendered.

- **[P2] L14_ui_frontend-011** (codex, conc:n, conf:high)  Spellbook Browse is missing from object context menus
  - ref: `reference/src/ui-context.c:680`  port: `packages/web/src/context-menu.ts:257`
  - exp: A browsable spellbook adds the Browse command and opens the spell menu.
  - act: The object context menu omits Browse and offers only Cast and Study for books.

- **[P2] L14_ui_frontend-012** (codex, conc:n, conf:high)  Single removable curse skips selection
  - ref: `reference/src/ui-curse.c:91`  port: `packages/web/src/main.ts:1683`
  - exp: Any nonempty removable-curse list opens the curse menu, including one entry.
  - act: The curse menu opens only when more than one removable curse exists.

- **[P2] L14_ui_frontend-013** (codex, conc:n, conf:high)  Retirement uses death artwork
  - ref: `reference/src/ui-death.c:75`  port: `packages/web/src/screens.ts:1294`
  - exp: Retirement loads retire.txt while death loads dead.txt.
  - act: The web tombstone always uses embedded dead artwork.

- **[P2] L14_ui_frontend-014** (codex, conc:n, conf:high)  Sidebar stats omit live equipment and timed modifiers
  - ref: `reference/src/ui-display.c:160`  port: `packages/core/src/game/display.ts:184`
  - exp: Display player->state.stat_use, including equipment and timed effects.
  - act: The live default derives statUse from only race and class adjustments.

- **[P2] L14_ui_frontend-015** (codex, conc:n, conf:high)  Moves indicator is never wired live
  - ref: `reference/src/ui-display.c:1147`  port: `packages/web/src/main.ts:4605`
  - exp: Display player->state.num_moves as Moves +N or Moves -N when nonzero.
  - act: displayDeps supplies no numMoves, so the model defaults to zero.

- **[P2] L14_ui_frontend-016** (codex, conc:n, conf:high)  Projectile animations are absent
  - ref: `reference/src/ui-display.c:1643`  port: `packages/web/src/main.ts:2259`
  - exp: Bolt, beam, and missile event handlers draw transient glyphs with delay-factor timing.
  - act: Fire and throw dispatch directly to core path processing with no transient UI animation.

- **[P2] L14_ui_frontend-018** (codex, conc:n, conf:high)  Object-list overflow summary is missing
  - ref: `reference/src/ui-obj-list.c:169`  port: `packages/web/src/screens.ts:962`
  - exp: Limit the object-list section to available text-block height and emit ...and N others.
  - act: Render every object row in a scrollable modal without the C overflow summary.

- **[P2] L14_ui_frontend-019** (codex, conc:n, conf:high)  Ability menu tags do not skip movement keys
  - ref: `reference/src/ui-player-properties.c:31`  port: `packages/web/src/overlay.ts:43`
  - exp: Ability tags use all_letters_nohjkl, skipping h, j, k, and l.
  - act: Menu tags use the contiguous alphabet including h, j, k, and l.

- **[P2] L14_ui_frontend-020** (codex, conc:n, conf:high)  Spell menu tags do not skip movement keys
  - ref: `reference/src/ui-spell.c:249`  port: `packages/web/src/overlay.ts:43; packages/web/src/screens.ts:668`
  - exp: Spell selection uses all_letters_nohjkl.
  - act: Spell rows receive contiguous a-z menu tags.

- **[P2] L14_ui_frontend-021** (codex, conc:n, conf:high)  Subwindow setup is missing
  - ref: `reference/src/ui-options.c:2042`  port: `packages/web/src/options.ts:548`
  - exp: The options menu exposes subwindow setup.
  - act: The web options menu omits subwindow setup because no subwindows are modelled.

- **[P2] L14_ui_frontend-022** (codex, conc:n, conf:high)  Advanced visual editing is missing
  - ref: `reference/src/ui-options.c:2059`  port: `packages/web/src/options.ts:507`
  - exp: Save visuals opens per-entity visual editing and persistence.
  - act: The web UI only selects a tile set or ASCII mode.

- **[P2] L14_ui_frontend-023** (codex, conc:n, conf:high)  Preference commands are not parsed
  - ref: `reference/src/ui-prefs.c:1185`  port: `packages/web/src/main.ts:4343`
  - exp: A typed preference directive is parsed and applied.
  - act: Every preference-line command reports Pref command not recognized.

- **[P2] L14_ui_frontend-040** (codex, conc:n, conf:high)  Equipment quick filters are not implemented
  - ref: `reference/src/ui-equip-cmp.c:511`  port: `packages/web/src/equip-cmp.ts:16`
  - exp: q and ! prompt for and apply the normal or inverted quick attribute filter.
  - act: The web equipment comparison screen has no q or ! action.

- **[P2] L14_ui_frontend-042** (codex, conc:n, conf:high)  Target navigation shortcuts are missing
  - ref: `reference/src/ui-target.c:1488`  port: `packages/core/src/game/target-loop.ts:345`
  - exp: g pathfinds, the ignore key updates tracked objects, and >, <, and x select nearest stairs or unexplored areas.
  - act: The web target loop handles neither these branches nor their state updates; the keys fall through to direction or unknown-key handling.

- **[P2] L14_ui_frontend-043** (codex, conc:n, conf:high)  Object and ego knowledge recall omits computed details
  - ref: `reference/src/ui-knowledge.c:1791`  port: `packages/web/src/knowledge.ts:745`
  - exp: Fake object and ego recalls render object_info and object_info_ego computed flag, combat, and ability lines.
  - act: The web recalls show only the name plus available flavor or lore text.

- **[P3] L14_ui_frontend-009** (grok, conc:y, conf:high)  Screen dump is PNG download, not html_screenshot
  - ref: `reference/src/ui-command.c:295-560 (html_screenshot / do_cmd_save_screen: HTML or text term dump to path)`  port: `packages/web/src/main.ts:4310-4326 (canvas.toDataURL image/png download neo-angband-screen.png); packages/web/src/term.ts:354-362 (snapshotColored documents HTML-parity cell dump for tests only)`
  - exp: ')' writes an HTML/text dump of attr/char cells.
  - act: Browser downloads a PNG of the canvas. Cell-level HTML dump exists as snapshotColored for tests but is not the player command output.

- **[P3] L14_ui_frontend-010** (grok, conc:y, conf:high)  POSIX signal handlers (ui-signals) have no browser counterpart
  - ref: `reference/src/ui-signals.c:26-80+ (SIGHUP/SIGTSTP/SIGINT orderly save/suspend; signal_count)`  port: `NONE (packages/web has no signal install; pagehide/beforeunload may autosave separately in main.ts)`
  - exp: HUP/INT/TSTP interrupt count and emergency save on native UNIX builds.
  - act: No POSIX signals in the browser. Autosave on navigation is a different mechanism.

- **[P3] L14_ui_frontend-011** (grok, conc:y, conf:high)  Windows native frontend (main-win / win/*) replaced by canvas stack
  - ref: `reference/src/main-win.c (WinMain, GDI terms, menus, DIB tiles); win/readdib.c, readpng.c, scrnshot.c, win-layout.c, win-menu.h, win-term.h; win/include png/zlib headers`  port: `packages/web/src/{main,term,tiles,font-16x24,options}.ts + packages/desktop (Electron shell only); browser Image/decode for PNG tiles (no readdib/GDI)`
  - exp: Native Windows window chrome, .dib/.png loaders, screenshot GDI path, multi-window layout.
  - act: Fixed 80x24 canvas, web font/tile atlases, Escape/localStorage prefs. win/include/* vendored third-party headers have no TS port (correct).

- **[P3] L14_ui_frontend-012** (grok, conc:n, conf:high)  Death/in-game spoiler menu not on web (CLI only)
  - ref: `reference/src/ui-spoil.c:59-73 (do_cmd_spoilers menu); ui-death.c:363 (death_spoilers)`  port: `packages/cli/src/spoilers.ts + main-spoil.ts (spoiler generation); packages/web/src/game-menu.ts:14-16 (Spoilers row omitted)`
  - exp: Death menu 's' / wizard spoilers create obj-desc.spo etc.
  - act: Web death menu has no Spoilers row; CLI can generate spoilers. Content generators exist off the web live path.

- **[P3] L14_ui_frontend-013** (grok, conc:n, conf:high)  do_cmd_pref (') always rejects the line
  - ref: `reference/src/ui-command.c / cmd-hidden do_cmd_pref: process a single pref-file directive into live prefs`  port: `packages/web/src/main.ts:4337-4346 (prefLineCmd prompts then always say "Pref command not recognized.")`
  - exp: A valid pref line (keymap, color, etc.) is applied like process_pref_file one-liners.
  - act: Key is live for shape but every non-empty line is rejected; options/keymaps use separate UI stores instead.

- **[P3] L14_ui_frontend-015** (grok, conc:n, conf:high)  Study indicator colour ignores book carry check (default true)
  - ref: `reference/src/ui-display.c:1226-1245 (prt_study: COLOUR_WHITE if player_book_has_unlearned_spells else COLOUR_L_DARK)`  port: `packages/core/src/game/display.ts:144-147,212,715-719 (bookHasUnlearnedSpells defaults true); packages/web/src/main.ts:4605-4607 (never overrides)`
  - exp: Study (N) is dark grey when the player has study slots but no book with unlearned spells in pack.
  - act: Always white whenever newSpells > 0, even without a suitable book.

- **[P3] L14_ui_frontend-001** (codex, conc:y, conf:high)  Native module header has no browser counterpart
  - ref: `reference/src/main.h:24`  port: `NONE`
  - exp: Native frontend module declarations and platform initialization interfaces.
  - act: Browser startup uses direct TypeScript imports without a module header equivalent.

- **[P3] L14_ui_frontend-003** (codex, conc:y, conf:high)  Native Windows frontend is replaced by browser rendering
  - ref: `reference/src/main-win.c:1`  port: `packages/web/src/main.ts:1; packages/web/src/term.ts:1`
  - exp: Win32 windows, menus, fonts, preferences, native input, and native drawing are initialized by the Windows frontend.
  - act: A browser canvas, DOM keyboard events, local storage, and modal overlays provide the frontend.

- **[P3] L14_ui_frontend-004** (codex, conc:y, conf:high)  Browser startup omits native command-line bootstrap
  - ref: `reference/src/main.c:278`  port: `packages/web/src/main.ts:5977`
  - exp: Parse native command-line module, savefile, graphics, path, and new-game options before starting the selected frontend.
  - act: Browser startup uses URL parameters, roster storage, and browser boot menus instead of native command-line parsing.

- **[P3] L14_ui_frontend-025** (codex, conc:y, conf:high)  POSIX signal handling has no browser counterpart
  - ref: `reference/src/ui-signals.c:26`  port: `NONE`
  - exp: Install SIGHUP, SIGTSTP, and SIGINT handlers for orderly save, suspend, and shutdown behavior.
  - act: No browser implementation exists for these POSIX signal handlers.

- **[P3] L14_ui_frontend-026** (codex, conc:n, conf:high)  Interactive spoilers are unavailable in the web UI
  - ref: `reference/src/ui-spoil.c:47`  port: `packages/web/src/wizard.ts:293; packages/cli/src/spoilers.ts:1`
  - exp: The interactive UI exposes spoiler actions that generate the four spoiler files.
  - act: Web wizard selection reports the feature as unavailable and generation exists only in CLI tooling.

- **[P3] L14_ui_frontend-027** (codex, conc:n, conf:high)  Wizard graphics demo is not ported
  - ref: `reference/src/ui-wizard.c:78`  port: `packages/web/src/wizard.ts:273`
  - exp: The wizard opens the projection graphics demonstration.
  - act: The web action reports that the graphics demo is not ported.

- **[P3] L14_ui_frontend-028** (codex, conc:n, conf:high)  Wizard keylog is not ported
  - ref: `reference/src/ui-wizard.c:99`  port: `packages/web/src/wizard.ts:307`
  - exp: Display recent keypresses with key codes and modifiers.
  - act: The web shell does not record a keystroke log.

- **[P3] L14_ui_frontend-029** (codex, conc:y, conf:high)  Native DIB frontend is replaced by browser decoding
  - ref: `reference/src/win/readdib.c:20`  port: `packages/web/src/tiles.ts:64`
  - exp: Decode Windows DIB resources through the native Win32 DIB loader.
  - act: Decode tile images through browser Image and canvas APIs.

- **[P3] L14_ui_frontend-030** (codex, conc:y, conf:high)  Native PNG frontend is replaced by browser decoding
  - ref: `reference/src/win/readpng.c:20`  port: `packages/web/src/tiles.ts:64`
  - exp: Decode PNG pixels, palettes, alpha, and masks through the native libpng path.
  - act: Load PNG images through browser Image and canvas APIs.

- **[P3] L14_ui_frontend-031** (codex, conc:y, conf:high)  Multi-window Win32 layout is not reproduced
  - ref: `reference/src/win/win-layout.c:41`  port: `packages/web/src/main.ts:4662`
  - exp: Create and position distinct Win32 terminal, message, inventory, monster, object, and recall windows.
  - act: Render a single fixed terminal canvas with modal overlays and a camera viewport.

- **[P3] L14_ui_frontend-032** (codex, conc:y, conf:high)  Screenshot capture scope differs
  - ref: `reference/src/win/scrnshot.c:38`  port: `packages/web/src/main.ts:4315`
  - exp: Capture the Win32 client area through GDI and write its pixels to PNG.
  - act: Export the web canvas with canvas.toDataURL("image/png").

- **[P3] L14_ui_frontend-033** (codex, conc:y, conf:high)  Native libpng12 header has no browser counterpart
  - ref: `reference/src/win/include/libpng12/png.h:1`  port: `NONE`
  - exp: Provide libpng12 declarations required by the native PNG frontend.
  - act: Browser image decoding uses platform APIs and has no libpng12 header.

- **[P3] L14_ui_frontend-034** (codex, conc:y, conf:high)  Native libpng12 configuration header has no browser counterpart
  - ref: `reference/src/win/include/libpng12/pngconf.h:1`  port: `NONE`
  - exp: Provide libpng12 configuration declarations for the native PNG frontend.
  - act: Browser image decoding uses platform APIs and has no libpng12 configuration header.

- **[P3] L14_ui_frontend-035** (codex, conc:y, conf:high)  Native PNG header has no browser counterpart
  - ref: `reference/src/win/include/png.h:1`  port: `NONE`
  - exp: Provide libpng declarations required by the native PNG frontend.
  - act: Browser image decoding uses platform APIs and has no PNG C header.

- **[P3] L14_ui_frontend-036** (codex, conc:y, conf:high)  Native PNG configuration header has no browser counterpart
  - ref: `reference/src/win/include/pngconf.h:1`  port: `NONE`
  - exp: Provide libpng configuration declarations required by the native PNG frontend.
  - act: Browser image decoding uses platform APIs and has no PNG C header.

- **[P3] L14_ui_frontend-037** (codex, conc:y, conf:high)  Native zconf header has no browser counterpart
  - ref: `reference/src/win/include/zconf.h:1`  port: `NONE`
  - exp: Provide zlib configuration declarations required by the native PNG frontend.
  - act: Browser image decoding uses platform APIs and has no zconf header.

- **[P3] L14_ui_frontend-038** (codex, conc:y, conf:high)  Native zlib header has no browser counterpart
  - ref: `reference/src/win/include/zlib.h:1`  port: `NONE`
  - exp: Provide zlib declarations required by the native PNG frontend.
  - act: Browser image decoding uses platform APIs and has no zlib header.

- **[P3] L14_ui_frontend-039** (codex, conc:y, conf:high)  Native DIB header has no direct counterpart
  - ref: `reference/src/win/readdib.h:1`  port: `NONE`
  - exp: Expose DIBINIT and ReadDIB/FreeDIB declarations to the Windows frontend.
  - act: The browser tile loader exposes browser image objects instead of DIB declarations.

- **[P3] L14_ui_frontend-041** (codex, conc:n, conf:high)  Equipment comparison dump is not implemented
  - ref: `reference/src/ui-equip-cmp.c:511`  port: `packages/web/src/equip-cmp.ts:16`
  - exp: d prompts for a file and writes the current equipment comparison dump.
  - act: The web equipment comparison screen has no d action or file dump.

---
## L15_tiles  (grok=11 codex=0 terra=0)

- **[P1] L15_tiles-001** (grok, conc:n, conf:high)  Player map cell never uses graphics tile (always ASCII @)
  - ref: `reference/src/ui-map.c:282-330 (g->is_player: a/c from monster_x_attr/char of r_info[0] aka "<player>"; hp_changes_color only when !(a & 0x80)); reference/lib/tiles/*/graf-*.prf (monster:<player>:...) + %:xtra-*.prf race/class remaps`  port: `packages/web/src/main.ts:4943-4954 (player put always ch:"@" + playerMapAttr, no tileDrawFor / no tileForMonster); packages/core/src/visuals/tile-prefs.ts:441-444 (tileForMonster exists but unused for player)`
  - exp: In graphics mode the player cell blits the <player> atlas tile (race/class-selected via xtra). ASCII @ + hp color only when the attr lacks the tile high bit.
  - act: With any tile pack active the whole map can be tiles while the player remains a coloured "@". The TileMap entry for ridx 0 is never consulted for the player cell.

- **[P1] L15_tiles-002** (grok, conc:n, conf:high)  Pref ?: expressions not implemented; xtra player race/class mapping discarded / last-wins
  - ref: `reference/src/ui-prefs.c:453-600 (process_pref_file_expr + parse_prefs_expr sets d->bypass from ?: lines; $RACE/$CLASS/$SYS); reference/src/ui-prefs.c:682-690 (parse_prefs_monster respects bypass); reference/lib/tiles/old/xtra-xxx.prf (66 conditioned monster:<player> lines) and peers`  port: `packages/core/src/visuals/tile-prefs.ts:367-407 (switch has no "?" / expr case; ?: lines fall to default skip); packages/web/src/tiles.ts:174-207 (loadTilePrefs loads %:xtra via loadFile into the same map)`
  - exp: Only the monster:<player> line whose preceding ?: expression matches the live race/class is applied; others are bypassed. Graf default applies until a match overwrites.
  - act: All ?: lines are ignored. Every monster:<player> in xtra is applied in file order, so the last line wins unconditionally (old pack: Paladin+Kobold 0xA9:0x91). Even if L15_tiles-001 were fixed, every class/race would share one wrong portrait. (Linoleum's offline prf.ts *does* capture conditions as :when: metadata for conversion only.)

- **[P1] L15_tiles-003** (grok, conc:n, conf:high)  Object map tiles ignore flavor_x (always kind tile)
  - ref: `reference/src/ui-object.c:87-111 (use_flavor_glyph then object_kind_attr/char -> flavor_x_attr/char[fidx] else kind_x_*); reference/src/ui-map.c:218-223 (floor objects use object_kind_attr/char); reference/lib/tiles/*/flvr-*.prf (flavor:N:attr:char, included from graf via %:flvr-*.prf)`  port: `packages/web/src/main.ts:4407-4424 (tile = tileForObject(tileMap, o.kind) only; flavor used for ASCII ch/css only); packages/core/src/visuals/tile-prefs.ts:447-461 (tileForFlavor exists, never called from main map path)`
  - exp: Unidentified potions/mushrooms/rings/wands/etc. blit the assigned flavor tile; identified (or scroll-aware) kinds use kind tile.
  - act: Graphics mode always blits the kind atlas cell. Flavor PRFs are parsed into TileMap.flavor but never read for floor objects, so many flavoured items show the wrong/generic kind tile while ASCII colour correctly uses the flavor.

- **[P2] L15_tiles-004** (grok, conc:n, conf:high)  Visible terrain tiles always LIGHTING.LOS (map_info lighting ignored)
  - ref: `reference/src/cave-map.c:93-129 (g->lighting = LIT default; in-view CLOSE_PLAYER + view_yellow_light -> TORCH; unlit UNLIGHT cases -> DARK; else LOS/LIT); reference/src/ui-map.c:180-181 (feat_x_attr[g->lighting][fidx]); reference/lib/tiles/*/graf-*.prf (per-feat torch/los/lit/dark rows; e.g. old FLOOR lit 0xA1 vs los 0xA2)`  port: `packages/web/src/main.ts:4911 (terrainGlyph(..., LIGHTING.LOS) for all seen grids); packages/web/src/main.ts:4877 (remembered-only correctly uses LIGHTING.LIT)`
  - exp: Seen grids pick the feat tile for map_info's lighting (TORCH/LOS/LIT/DARK). All four free packs differentiate lit vs los (and dark vs los) for multiple feats.
  - act: Every in-view cell forces LOS tiles. Torch-yellow mode never selects TORCH rows; dark/unlit in-view cases never select DARK. Remembered out-of-view path is correct (LIT).

- **[P2] L15_tiles-005** (grok, conc:n, conf:high)  Trap tiles always LIGHTING.LOS
  - ref: `reference/src/ui-map.c:98-99 (trap_x_attr[g->lighting][tidx]); reference/lib/tiles/old/graf-xxx.prf trap:glyph of warding:dark/lit/los/torch distinct cells`  port: `packages/web/src/main.ts:4387 (tileForTrap(..., LIGHTING.LOS) only)`
  - exp: Trap graphic follows the same lighting index as the grid.
  - act: Trap lighting variants are parsed but the live path always samples LOS.

- **[P2] L15_tiles-006** (grok, conc:n, conf:high)  GF bolt / missile / explosion tiles never drawn on live path
  - ref: `reference/src/ui-display.c:1524-1553 (bolt_pict uses proj_to_attr/char when use_graphics != NONE); reference/src/ui-display.c:1559-1696,2760-2763 (EVENT_BOLT / EVENT_EXPLOSION / EVENT_MISSILE handlers); reference/lib/tiles/*/graf-*.prf (GF:* and per-element GF lines)`  port: `packages/core/src/visuals/tile-prefs.ts:292-345,463-470 (parse + tileForProjection); packages/web/src (no tileForProjection / no EVENT_BOLT|MISSILE animation blit in main.ts)`
  - exp: Projectiles, breath bolts, and explosions animate with the pack's GF atlas cells (direction-sensitive).
  - act: GF mappings are loaded into TileMap.gf but nothing in the web shell blits them. Combat projectiles have no graphics overlay (ASCII-only or instant resolution).

- **[P2] L15_tiles-007** (grok, conc:n, conf:high)  Tile blit stretches atlas cells into font cell size (ignores mode cellWidth/Height as term metrics)
  - ref: `reference/lib/tiles/list.txt size lines + reference/src/grafmode.c:61-68 (cell_width/cell_height from size); native front ends size the term cell to the mode's tile pixel size so 1 map grid = 1 tile at native aspect`  port: `packages/web/src/tiles.ts:108-130 (drawTile scales source cellWidth x cellHeight into caller dw x dh); packages/web/src/term.ts:454-465 (paintCell always passes GlyphTerm cellW/cellH from the 80x24 letterboxed font grid)`
  - exp: A 16x16 (or 32x32/8x8) pack paints square tile pixels; a 64x64 pack likewise. Map cell aspect matches the tileset.
  - act: Tiles are always non-uniformly scaled into the current bitmap-font cell (e.g. 16x24-ish). Catalog cellWidth/cellHeight only crop the atlas source rectangle; they never drive terminal metrics.

- **[P2] L15_tiles-008** (grok, conc:n, conf:high)  Double-height overdraw (Shockbolt rows 27-31) not applied on blit
  - ref: `reference/lib/tiles/list.txt:58-68 (extra:1:27:31 for Shockbolt Dark/Light); reference/src/grafmode.c:241-258 (is_dh_tile); native term dblh_hook draws tall tiles spanning two rows`  port: `packages/core/src/visuals/grafmode.ts:114-123 (isDoubleHeightTile faithful); packages/web/src/tiles.ts:20-21 (comments only); packages/web/src/main.ts tileDrawFor / term paintCell (single cell blit only, never calls isDoubleHeightTile)`
  - exp: Tiles whose attr row is in [overdrawRow, overdrawMax] overdraw the cell above (double height).
  - act: Helper exists and is unit-tested but the live renderer never uses it. URL-loaded Shockbolt (graf 5/6) would clip tall monsters/terrain to one cell.

- **[P2] L15_tiles-009** (grok, conc:y, conf:high)  Shockbolt pack assets not shipped (license); catalog + URL path only
  - ref: `reference/lib/tiles/shockbolt/{64x64.png,graf-shb-dark.prf,graf-shb-light.prf,flvr-shb.prf,xtra-shb.prf}; reference/lib/tiles/list.txt name 5/6`  port: `packages/core/src/visuals/grafmode-data.ts:67-89 (metadata present); packages/web/public/tiles/ (no shockbolt/); packages/web/mods/linoleum/manifest.json:11-16 (tilePacks 1-4 only); packages/web/src/tile-mods.ts:73 (filters directory==="shockbolt"); packages/web/public/tiles/CREDITS.md:38-46`
  - exp: Upstream ships Shockbolt Dark/Light as selectable modes with on-disk assets.
  - act: Metadata and linoleum converter config still know Shockbolt, but assets are absent and the Options menu never offers graf 5/6. Documented escape: ?tiles=<url>&graf=5|6 with a user-owned copy.

- **[P3] L15_tiles-010** (grok, conc:n, conf:high)  Linoleum converter nomad tileWidth 8 disagrees with list.txt / game catalog 16x16
  - ref: `reference/lib/tiles/list.txt:52-56 (Nomad size:16:16:8x16.png); packages/core/src/visuals/grafmode-data.ts:55-65 (cellWidth/Height 16)`  port: `packages/linoleum/src/packs.ts:74-84 (tileWidth: 8, tileHeight: 16, resolution: 16)`
  - exp: Converter that claims fidelity to legacy packs should extract with the same cell size the game uses (16x16). Atlas is 512x960 = 32x60 tiles at 16px (pref tile cols use 0..31 with high bit).
  - act: Offline linoleum export for nomad uses 8x16 source rectangles, splitting each game tile. Live web path is unaffected (uses grafmode 16x16).

- **[P3] L15_tiles-011** (grok, conc:y, conf:high)  Install Makefiles have no runtime port counterpart
  - ref: `reference/lib/tiles/Makefile; reference/lib/tiles/*/Makefile (buildsys DATA install lists)`  port: `NONE`
  - exp: Native install copies PNG/PRF into the tiles package tree.
  - act: Browser ships static files under packages/web/public/tiles/ (and Vite public copy). No Makefile consumer.

---
## L16_sounds  (grok=10 codex=4 terra=0)
_cross-model overlap on: sound-core.c, snd-sdl.c_

- **[P2] L16_sounds-001** (grok, conc:n, conf:high)  Web load marks LOADED without file_exists; blocks multi-extension fallback
  - ref: `reference/src/sound-core.c:145-164 (for each supported ext: only if file_exists set ERROR then load_sound_hook; continue until load_success); reference/src/snd-sdl.c:54-56 (try .mp3 then .ogg)`  port: `packages/core/src/sound/engine.ts:120-127 (calls loadSound(name, type) until true); packages/web/src/sound.ts:74-98 (always new Audio()+src, status=LOADED, return true; error only async)`
  - exp: Missing .mp3 is skipped; existing .ogg is loaded on the next supported_files entry. A failed Mix_Load* on an existing file leaves room to try the next extension in the same load_sound call.
  - act: The web hook returns true and sets LOADED for the first format (.mp3) without existence/decode proof. The core loop never tries .ogg. A 404 .mp3 may briefly be LOADED until the error event flips ERROR; .ogg is never attempted.

- **[P2] L16_sounds-005** (grok, conc:y, conf:high)  Browser autoplay policy can swallow play() until a user gesture
  - ref: `reference/src/snd-sdl.c:177-198 (Mix_Play* plays immediately when the mixer is open); reference/src/message.c:368-374 (sound() only gated by use_sound)`  port: `packages/web/src/sound.ts:108-110 (void plat.audio.play().catch(() => {}))`
  - exp: With use_sound on and a loaded sample, play_sound produces audible output without an extra unlock step.
  - act: Browsers may reject HTMLMediaElement.play() before a user gesture; the rejection is swallowed and the game stays silent. Toggling use_sound or any prior key/click usually unlocks later plays.

- **[P2] L16_sounds-001** (codex, conc:y, conf:high)  SDL mixer backend is replaced by HTMLAudio
  - ref: `reference/src/snd-sdl.c:65-80,177-198`  port: `packages/web/src/sound.ts:64-126`
  - exp: Initialize SDL_mixer at 22050 Hz, S16, stereo, buffer 4096; load MP3 as music and OGG as chunks; play through SDL mixer.
  - act: Use one HTMLAudioElement per sample with browser-controlled rate, channels, buffering, and playback behavior.

- **[P2] L16_sounds-002** (codex, conc:n, conf:high)  First-format load prevents C-style fallback
  - ref: `reference/src/sound-core.c:127-167`  port: `packages/core/src/sound/engine.ts:120-130; packages/web/src/sound.ts:74-94`
  - exp: Build the full sound path, check each extension with file_exists, call the platform hook only for existing files, and continue to the next extension after failure.
  - act: Call the hook for every format without existence checks. The web hook returns true optimistically for the first format and only marks ERROR asynchronously after an audio error.

- **[P3] L16_sounds-002** (grok, conc:?, conf:high)  Default .mp3 pack is exclusive under SDL Mix_PlayMusic; web overlaps samples
  - ref: `reference/src/snd-sdl.c:54-56,188-190 (.mp3 => SDL_MUSIC; Mix_PlayMusic single stream, loops=1); reference/src/main-win.c:1281-1287 (per-sample MCI device can overlap for WIN_MP3)`  port: `packages/web/src/sound.ts:101-114 (each sample owns an HTMLAudioElement; play does not halt peers)`
  - exp: Under the SDL backend every shipped sample is music: starting a new sound stops the previous. Under the Win MP3 path samples may overlap. Upstream backends already disagree.
  - act: Web allows concurrent playback of distinct samples (hit+kill, ambient+action). Same sample restarts via currentTime=0 (closer to restart-music than multi-channel chunk).

- **[P3] L16_sounds-003** (grok, conc:n, conf:high)  messageLookupByName is case-sensitive and ignores numeric MSG indices
  - ref: `reference/src/message.c:295-316 (strtoul numeric form when pe!=name; else my_stricmp against message_names)`  port: `packages/core/src/sound/engine.ts:37-41 (strict === against MESSAGE_ENTRIES[i].name only)`
  - exp: "hit", "HIT", and "2" all resolve to MSG_HIT when loading sound prefs.
  - act: Only exact-case names match. Lowercase or numeric type tokens are skipped (loadPrefs continues on idx<0).

- **[P3] L16_sounds-004** (grok, conc:n, conf:high)  Pref tokenizer drops empty tokens; C keeps them as empty sample names
  - ref: `reference/src/sound-core.c:195-266 (strchr space walk; consecutive spaces yield a zero-length cur_token that still enters the pool/map)`  port: `packages/core/src/sound/engine.ts:149 (split(" ").filter(t => t.length > 0)); engine.test.ts:91-95 (asserts collapse to ["a","b"])`
  - exp: "a  b" defines three entries: "a", "", "b" (empty name still gets a sound id if under the per-message cap).
  - act: Port drops empties; double spaces never create a blank sample. Unit test documents the divergence as if it matched C.

- **[P3] L16_sounds-006** (grok, conc:y, conf:high)  No open_audio equivalent of Mix_OpenAudio(22050, S16, stereo, 4096)
  - ref: `reference/src/snd-sdl.c:65-83 (open_audio_sdl: SDL_Init audio + Mix_OpenAudio 22050/AUDIO_S16/2/4096); reference/src/sound-core.c:376-380 (init_sound fails without successful open_audio_hook)`  port: `packages/web/src/sound.ts:71-126 (no openAudio/closeAudio hooks); packages/core/src/sound/engine.ts:230-236 (openAudio optional; missing hook still inits)`
  - exp: Platform opens a 22050 Hz S16 stereo mixer before EVENT_SOUND is hooked; failure aborts sound init.
  - act: Browser uses the UA default audio pipeline (typically 44.1/48 kHz). No open failure path; hooks always "succeed". Subtle resampling/latency differences only.

- **[P3] L16_sounds-007** (grok, conc:y, conf:high)  print_sound_help / sound module registry not ported
  - ref: `reference/src/sound-core.c:60-72,356-370,431-437 (sound_modules[] sdl/win/cocoa; init_sound name select; print_sound_help)`  port: `NONE (web always uses createWebSoundHooks; no -s module CLI)`
  - exp: CLI lists and selects platform sound modules by name.
  - act: Single browser backend, installed from main.ts. No help text or module switch.

- **[P3] L16_sounds-008** (grok, conc:y, conf:high)  lib/sounds Makefile install rules have no make consumer
  - ref: `reference/lib/sounds/Makefile (DATA list of all 213 mp3; PACKAGE=sounds buildsys install)`  port: `NONE (assets shipped as packages/web/public/sounds/* via Vite static public/)`
  - exp: Native install copies the sound pack into the game lib tree.
  - act: Browser static hosting + optional ?sounds= base URL. No Makefile path.

- **[P3] L16_sounds-009** (grok, conc:n, conf:high)  Runtime user sound.prf overrides not loadable (compile-time map only)
  - ref: `reference/src/sound-core.c:273-304 (register_sound_pref_parser + parse_prefs_sound during pref load; user customize can replace sound: lines); reference/lib/customize/sound.prf`  port: `packages/core/src/sound/sound-prefs-data.ts (generated SOUND_PREF_ENTRIES); packages/web/src/sound.ts:149 (engine.loadPrefs(SOUND_PREF_ENTRIES) only)`
  - exp: A user/custom sound.prf can redefine message->sample lists at pref-load time without rebuilding the game.
  - act: Only the baked 149-entry table is loaded. Sample *files* can be swapped via ?sounds=/baseUrl, but message mapping cannot be overridden at runtime.

- **[P3] L16_sounds-010** (grok, conc:y, conf:high)  snd-win.h Windows MCI module has no native port (web substitute only)
  - ref: `reference/src/snd-win.h:31 (init_sound_win); reference/src/main-win.c play_sound_win / load paths`  port: `NONE as Win MCI; substitute packages/web/src/sound.ts (HTMLAudio SoundHooks)`
  - exp: Windows builds can use the win sound module when SDL is off.
  - act: Browser port never loads MCI/PlaySound. HTMLAudio covers the platform half.

- **[P3] L16_sounds-003** (codex, conc:y, conf:high)  Initialization succeeds without the C-required open hook
  - ref: `reference/src/sound-core.c:356-386`  port: `packages/core/src/sound/engine.ts:230-236; packages/web/src/sound.ts:138-150`
  - exp: Select a sound module, require open_audio_hook, fail initialization if opening the platform audio system fails.
  - act: SoundEngine.init succeeds when no openAudio hook exists; the web installer supplies no open hook.

- **[P3] L16_sounds-004** (codex, conc:n, conf:high)  C tokenizer preserves empty tokens but port filters them
  - ref: `reference/src/sound-core.c:195-210,250-266`  port: `packages/core/src/sound/engine.ts:146-150`
  - exp: Split only at literal spaces; leading, repeated, or trailing spaces can produce empty sample names.
  - act: Split on spaces and discard empty tokens.

---
## L17_fonts_screens_help  (grok=17 codex=44 terra=0)
_cross-model overlap on: pref.prf, ui-death.c, commands.txt, symbols.txt, r_index.txt, message.prf, ui-display.c, index.txt, font.prf, 16x16xw.woff, user.prf_

- **[P1] L17_fonts_screens_help-008** (grok, conc:n, conf:high)  pref.prf Shift+numpad run keymaps not implemented (original keyset)
  - ref: `reference/lib/customize/pref.prf:123-203 (keymap-act:.N with {S}/{SK} numpad and arrows for original keyset mode 0 = run); reference/src/ui-init.c:50 process_pref_file("pref.prf")`  port: `packages/web/src/keymap.ts:53-70 (DIRS_ORIGINAL always kind "walk"; shiftKey only used for roguelike letter run); packages/web/src/main.ts:5611-5632 (resolveKey walk -> queueWalk; run only from "." runDirCmd prompt or roguelike Shift+letter)`
  - exp: Holding Shift with numpad/arrow directions runs (.1-.9) in the original keyset, as shipped in pref.prf.
  - act: Shift+numpad still walks one step. Original-keyset run requires the "." direction prompt (or a user keymap). Roguelike Shift+hjkl run works; original does not get the pref.prf run maps.

- **[P2] L17_fonts_screens_help-001** (grok, conc:n, conf:high)  Retire death screen draws dead.txt art, never retire.txt
  - ref: `reference/src/ui-death.c:74-76 (path_build retire.txt when died_from=="Retiring", else dead.txt); reference/lib/screens/retire.txt (20-line retirement art); reference/lib/screens/dead.txt (tombstone)`  port: `packages/web/src/screens.ts:1294-1419 (tombstoneLines always seeds DEAD_TOMB_ART; retired only changes epitaph text); packages/web/src/main.ts:3354,3907-3918 (comments claim retire branch; no retire art constant anywhere under packages/web/src)`
  - exp: On retirement, display_exit_screen opens retire.txt as the background (a distinct ASCII piece), then centres the same epitaph fields including "Retired on Level N".
  - act: retired=true still paints the RIP tombstone from dead.txt; only the "Killed"/"by" lines swap to "Retired on Level N". No retire art is embedded or selected.

- **[P2] L17_fonts_screens_help-002** (grok, conc:n, conf:high)  help.ts labels S as Save and V as hall of fame; live keys differ
  - ref: `reference/lib/help/commands.txt:37,39 (S See abilities; V Display version info); reference/src/ui-game.c cmd tables (S abilities, ^s save, V version)`  port: `packages/web/src/help.ts:116-118 (S "Save the game"; V "Display the hall of fame"); packages/web/src/main.ts:5415-5421 (^S autosave), 5559 (o:"S" -> showAbilitiesScreen), 5575 (o:"V" -> versionCmd)`
  - exp: In-game help for the original keyset must match both commands.txt and the live keytable: S = See abilities, V = version, save is ^s (and Escape menu).
  - act: helpCommandLines claims S saves and V opens the hall of fame. Both are wrong for this shell: plain S opens abilities; V is version; hall of fame is under knowledge (~); save is Ctrl-S / Escape menu.

- **[P2] L17_fonts_screens_help-003** (grok, conc:n, conf:high)  symbols help assigns Xorn to lowercase x; drops X and N blanks
  - ref: `reference/lib/help/symbols.txt:78,88 (n Naga / N - ; x - / X Xorn/Xaren)`  port: `packages/web/src/help.ts:213-236 (MONSTERS: n Naga only; x "Xorn/Xaren"; no X entry, no N blank)`
  - exp: symbols.txt two-column monster table: lowercase x is blank ("-"), uppercase X is Xorn/Xaren; uppercase N is blank ("-").
  - act: Port has 52 monster rows vs 54 ref pairs; maps x -> Xorn/Xaren and omits X and N. A player looking up map glyph X cannot find it; x is wrong.

- **[P2] L17_fonts_screens_help-004** (grok, conc:n, conf:high)  Command help is a curated subset that omits many live keys listed in commands.txt
  - ref: `reference/lib/help/commands.txt:18-73 (full original keyset: R rest, Q retire, ~ knowledge, / identify symbol, [ mon list, : notes, ) screen dump, . run, etc.); reference/src/ui-help.c:470 (do_cmd_help opens index.txt -> commands.txt verbatim via show_file)`  port: `packages/web/src/help.ts:16-27,65-125 (curated list); packages/web/src/help.test.ts:37-44 (explicitly forbids "Rest for", "Retire character", "Check knowledge", "Take notes", "Dump screen" in help text); packages/web/src/main.ts:5530,5566-5578,5571 (R, /, ~, :, ), Q all wired live)`
  - exp: ? shows the stock commands.txt summary for the active keyset (or a faithful subset that still documents every implemented command with correct names).
  - act: helpCommandLines omits rest, retire, knowledge, symbol query, monster list, notes, screen dump, run/hold, steal, alter, and more even though main.ts implements them. Unit tests lock in the omissions.

- **[P2] L17_fonts_screens_help-005** (grok, conc:n, conf:high)  No roguelike help tree (r_index.txt / r_comm.txt unused)
  - ref: `reference/lib/help/r_index.txt:21 (.. menu:: [a] r_comm.txt); reference/lib/help/r_comm.txt (full roguelike keyset summary); C loads r_index when rogue_like_commands is set (ui-help path)`  port: `packages/web/src/help.ts:298-302 (HELP_INDEX always Commands / Symbols / Playing guide; no roguelike branch); no r_comm content in packages/`
  - exp: With rogue_like_commands on, do_cmd_help opens the roguelike index and r_comm.txt (hjkl movement, swapped fire/look/ignore keys, etc.).
  - act: ? always shows the original-keyset curated list regardless of the option. Roguelike players never see r_comm.txt bindings (t fire, x look, O ignore, z aim, Z staff, ...).

- **[P2] L17_fonts_screens_help-006** (grok, conc:n, conf:high)  symbols help drops the slash-identify and user-pref notes though / is live
  - ref: `reference/lib/help/symbols.txt:14-19 (slash '/' identifies symbols; user pref file can remap symbols)`  port: `packages/web/src/help.ts:25-27,243-261 (explicitly strips those lines); packages/web/src/main.ts:3216-3222,5566 (querySymbolCmd wired to /)`
  - exp: symbols page tells the player that / identifies any map character (commands.txt / symbols.txt).
  - act: helpSymbolLines omits both the slash paragraph and the pref remapping note. / works in the shell but help never mentions it.

- **[P2] L17_fonts_screens_help-007** (grok, conc:n, conf:high)  message.prf default colors never applied (BELL / HITPOINT_WARN / AFRAID stay white)
  - ref: `reference/lib/customize/message.prf (150 message: lines; non-white: BELL:o, HITPOINT_WARN:o, AFRAID:o); reference/src/ui-init.c process_pref_file("pref.prf") includes %:message.prf; message_color_define`  port: `packages/core/src/msg.ts:77-86 (colorDefine / typeColor exist); no loader of message.prf under packages/ (only msg.test.ts calls colorDefine); packages/web/src/main.ts:901-917 (say/msglog.push with no MSG type color)`
  - exp: After boot prefs, MSG_BELL / MSG_HITPOINT_WARN / MSG_AFRAID render orange; other types white per message.prf.
  - act: MessageLog colors map is empty at runtime. Low-HP warning, bell, and fear messages use the default white/UI color path. The three non-white stock overrides never load.

- **[P2] L17_fonts_screens_help-009** (grok, conc:n, conf:high)  pref.prf not loaded; Ctrl+direction alter and full keymap table absent
  - ref: `reference/lib/customize/pref.prf:206-356 (keymap-act:+N Ctrl+numpad alter; roguelike letter run/alter; stay-still 5/,; w0 on x); reference/src/ui-prefs.c process_pref_file`  port: `packages/web/src/main.ts:5532-5535,5577,5583-5588 (hardcoded x->swapWeapon, +->alter prompt, ./, hold, 5 hold); packages/web/src/keymap.ts (movement only); packages/web/src/main.ts:4338-4346 (prefLineCmd always "Pref command not recognized.")`
  - exp: Boot loads pref.prf into the keymap tables; " opens a live pref-command parser; Ctrl+direction alters, etc.
  - act: No process_pref_file of pref.prf. A subset is hand-wired; Ctrl+numpad alter and most of the file's input aliases are missing. The " pref line command is a stub that never parses.

- **[P2] L17_fonts_screens_help-014** (grok, conc:y, conf:high)  Title screen wait prompt is web-native, not File menu
  - ref: `reference/src/main-win.c (news then "[Choose 'New' or 'Open' from the 'File' menu]"); ui-display.c show_splashscreen dumps news.txt then returns to the frontend menu`  port: `packages/web/src/news.ts:103-106 ("[ Press any key to begin ]"); packages/web/src/main.ts:5954-5974 (maybeTitle)`
  - exp: After news art, the desktop GUI waits on a File/New/Open style instruction (no auto-dungeon entry).
  - act: Port shows a press-any-key (or tap) prompt, then continues into roster/birth. There is no File menu in a browser tab.

- **[P2] L17_fonts_screens_help-016** (codex, conc:n, conf:high)  Missing 8x12 default bitmap font
  - ref: `reference/lib/fonts/8x12x.fon`  port: `packages/web/src/term.ts:113`
  - exp: main-win.c selects 8X12x.FON as DEFAULT_FONT and renders its 8x12 glyph cells.
  - act: The reference asset has no port counterpart and GlyphTerm hardwires FONT_16X24.

- **[P2] L17_fonts_screens_help-025** (codex, conc:n, conf:high)  News version marker is not padded
  - ref: `reference/src/ui-display.c:2463`  port: `packages/web/src/news.ts:94`
  - exp: The C replaces $VERSION with a left-justified 8-character field using %-8s.
  - act: The port replaces $VERSION with the bare string 4.2.6 and emits no padding.

- **[P2] L17_fonts_screens_help-026** (codex, conc:?, conf:high)  News screen adds a non-C wait prompt
  - ref: `reference/src/ui-display.c:2425`  port: `packages/web/src/news.ts:103`
  - exp: show_splashscreen draws news.txt and returns to the normal event-driven UI without adding a prompt line.
  - act: The port adds [ Press any key to begin ] and blocks boot until a key or pointer event.

- **[P2] L17_fonts_screens_help-027** (codex, conc:n, conf:high)  Retirement uses the death tombstone art
  - ref: `reference/src/ui-death.c:75`  port: `packages/web/src/screens.ts:1401`
  - exp: display_exit_screen loads retire.txt when died_from is Retiring and dead.txt otherwise.
  - act: tombstoneLines always starts from DEAD_TOMB_ART; retired only changes the epitaph text.

- **[P2] L17_fonts_screens_help-028** (codex, conc:n, conf:high)  Commands help is curated and has wrong live labels
  - ref: `reference/lib/help/commands.txt`  port: `packages/web/src/help.ts:65`
  - exp: The commands page reproduces the full original keyset table, including the C meanings for S as See abilities and V as Display version info.
  - act: The port omits many table entries and labels S as Save the game and V as Display the hall of fame.

- **[P2] L17_fonts_screens_help-029** (codex, conc:n, conf:high)  Help index is not the reference index
  - ref: `reference/lib/help/index.txt`  port: `packages/web/src/help.ts:298`
  - exp: The index shows the reference introduction, browser commands, and exactly the commands and symbols menu entries.
  - act: The port uses a generated menu, omits the index text and browser controls, and adds a Playing guide entry.

- **[P2] L17_fonts_screens_help-030** (codex, conc:n, conf:high)  Roguelike command help is not selected
  - ref: `reference/lib/help/r_comm.txt`  port: `packages/web/src/help.ts:298`
  - exp: With rogue_like_commands enabled, do_cmd_help opens the roguelike command summary from r_index.txt.
  - act: runHelp always offers the same Original keyset curated page and never selects r_comm.txt.

- **[P2] L17_fonts_screens_help-031** (codex, conc:n, conf:high)  Roguelike help index is not implemented
  - ref: `reference/lib/help/r_index.txt`  port: `packages/web/src/help.ts:298`
  - exp: The roguelike help index links to r_comm.txt and symbols.txt.
  - act: No roguelike index or mode-dependent menu exists.

- **[P2] L17_fonts_screens_help-032** (codex, conc:n, conf:high)  Symbols help is paraphrased and reordered
  - ref: `reference/lib/help/symbols.txt`  port: `packages/web/src/help.ts:244`
  - exp: The symbols page preserves the reference introduction, table order, slash-identification note, and user-pref-file note.
  - act: The port paraphrases the introduction, reorders feature rows, and omits the slash and user-pref notes.

- **[P2] L17_fonts_screens_help-033** (codex, conc:n, conf:high)  Font preference dispatcher is missing
  - ref: `reference/lib/customize/font.prf`  port: `NONE`
  - exp: reset_visuals loads font.prf and conditionally includes the system-specific font remapping file.
  - act: No pref-file dispatcher or conditional $SYS include path exists in the web port.

- **[P2] L17_fonts_screens_help-038** (codex, conc:n, conf:high)  Windows font remapping is missing
  - ref: `reference/lib/customize/font-win.prf`  port: `packages/web/src/main.ts:4452`
  - exp: Windows text mode remaps the open floor to attr 1 and char 8 after font.prf is loaded.
  - act: terrainGlyph uses the feature dAttr and dChar directly and has no font-win remap.

- **[P2] L17_fonts_screens_help-040** (codex, conc:n, conf:high)  Message preference colors are not loaded
  - ref: `reference/lib/customize/message.prf`  port: `packages/web/src/main.ts:908`
  - exp: The message pref parser defines each MSG type color, including orange BELL and HITPOINT_WARN and white defaults.
  - act: state.msg records every message as type 0 and the web log renders without loading message.prf type colors.

- **[P2] L17_fonts_screens_help-041** (codex, conc:n, conf:high)  Default pref grammar is not implemented
  - ref: `reference/lib/customize/pref.prf`  port: `packages/web/src/main.ts:4338`
  - exp: The default pref file loads movement, running, tunneling, stay-still, swap-equipment, message, sound, and system-specific mappings through the C parser.
  - act: The port hardcodes selected command branches and reports every entered pref line as not recognized; it does not parse or load the file.

- **[P2] L17_fonts_screens_help-042** (codex, conc:n, conf:high)  Sound selection is off the game RNG stream
  - ref: `reference/lib/customize/sound.prf`  port: `packages/web/src/main.ts:5828`
  - exp: SoundEngine play_sound calls the game's randint0 for each mapped sound choice, as sound-core.c:320 does.
  - act: installWebSound omits randint0, so SoundEngine uses its Math.random default.

- **[P2] L17_fonts_screens_help-043** (codex, conc:n, conf:high)  Web sound loading does not try the next format
  - ref: `reference/lib/customize/sound.prf`  port: `packages/web/src/sound.ts:74`
  - exp: C checks each supported extension in order and only stops after a load hook succeeds.
  - act: The web hook marks the first candidate LOADED optimistically and an error marks the sample failed without trying the next format.

- **[P3] L17_fonts_screens_help-010** (grok, conc:?, conf:high)  Alternate .fon fonts and font picker not ported (only 16x24x)
  - ref: `reference/lib/fonts/*.fon (24 .fon + 16x16xw.woff); reference/lib/fonts/Makefile DATA list; reference/src/main-sdl.c:184 default_term_font "6x10x.fon"; main-sdl2.c DEFAULT_FONT "10x20x.fon"; font browser in main-sdl.c`  port: `packages/web/src/font-16x24.ts + term.ts FONT_16X24 only; packages/web/scripts/extract-fon.py can regenerate other sizes but no other font-*.ts ships; no font-selection UI`
  - exp: Front ends ship the full font set and let the player pick a preset .fon (size/bold variants).
  - act: Web hardcodes the 16x24 bitmap (faithful extract of 16x24x.fon). Other 23 .fon files and the .woff have no package counterparts and cannot be selected.

- **[P3] L17_fonts_screens_help-011** (grok, conc:y, conf:high)  font-*.prf platform attr/char remaps not applied
  - ref: `reference/lib/customize/font.prf (includes font-win/sdl/x11/gcu/ibm by $SYS); font-win.prf feat:open floor:*:1:8 (centered-dot floors) and further feat remaps; loaded via process_pref_file`  port: `NONE for font*.prf content; ASCII map glyphs come from content pack / tile prefs, not font.prf`
  - exp: Text-mode front ends apply system-specific feat attr/char overrides from font-*.prf.
  - act: No font.prf include chain. Web never remaps floors to CP437 centered-dot via font-win.prf etc.

- **[P3] L17_fonts_screens_help-012** (grok, conc:n, conf:high)  user.prf race/class include chain not processed
  - ref: `reference/lib/customize/user.prf:13-79 (?:[EQU $RACE ... ] %:Race.prf and class includes); reference/src/ui-display.c:2669 process_pref_file("user.prf")`  port: `NONE (no user.prf loader under packages/)`
  - exp: After birth, user.prf may load optional per-race/class pref overrides when those files exist in the user dir.
  - act: user.prf is never read. Race/class-conditioned pref includes cannot apply.

- **[P3] L17_fonts_screens_help-013** (grok, conc:n, conf:high)  news.txt $VERSION not left-padded to 8 columns
  - ref: `reference/src/ui-display.c:2460-2463 (strnfmt version_marker "%-8s", buildver)`  port: `packages/web/src/news.ts:23-24,94 (BASELINE_VERSION "4.2.6" substituted with bare replace, no width pad)`
  - exp: $VERSION expands to an 8-character left-justified field so the mountain art after the version keeps column alignment.
  - act: "4.2.6" is 5 characters; the remainder of that news line shifts left by three columns vs C.

- **[P3] L17_fonts_screens_help-015** (grok, conc:n, conf:high)  Help index is not index.txt (invented Playing guide; no show_file browser chrome)
  - ref: `reference/lib/help/index.txt:9-10,15-19,21-23 ((a) commands (b) symbols only; browser keys # % ? SPACE - / etc.; .. menu:: directives)`  port: `packages/web/src/help.ts:265-321 (three entries including "Playing guide"; selectFromMenu + showTextScreen without #/%/search)`
  - exp: do_cmd_help runs show_file on index.txt with the full help-browser command set and only the two stock menus.
  - act: Index is a hard-coded three-row menu; "Playing guide" is port-authored prose; no line/file search, half-page, or case-toggle commands from index.txt.

- **[P3] L17_fonts_screens_help-016** (grok, conc:y, conf:high)  16x16xw.woff has no web counterpart
  - ref: `reference/lib/fonts/16x16xw.woff (web/CSS font form of 16x16xw)`  port: `NONE under packages/`
  - exp: Any HTML/CSS path that used the woff would ship it next to the .fon set.
  - act: Canvas blit uses FONT_16X24 bitmaps only; the woff is unused and unshipped.

- **[P3] L17_fonts_screens_help-017** (grok, conc:?, conf:high)  fonts Makefile install set not mirrored as multi-font package data
  - ref: `reference/lib/fonts/Makefile (DATA = full .fon + woff list, PACKAGE = fonts)`  port: `packages/web/scripts/extract-fon.py (dev-time single-file regenerator); only font-16x24.ts is committed`
  - exp: Install/package step ships every font in DATA for front ends.
  - act: No package-level fonts/ tree; Makefile role reduced to a one-font extract script.

- **[P3] L17_fonts_screens_help-001** (codex, conc:n, conf:high)  Missing 10x14x bitmap font
  - ref: `reference/lib/fonts/10x14x.fon`  port: `NONE`
  - exp: The 10x14x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-002** (codex, conc:n, conf:high)  Missing 10x14xb bitmap font
  - ref: `reference/lib/fonts/10x14xb.fon`  port: `NONE`
  - exp: The 10x14xb Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-003** (codex, conc:n, conf:high)  Missing 10x20x bitmap font
  - ref: `reference/lib/fonts/10x20x.fon`  port: `NONE`
  - exp: The 10x20x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-004** (codex, conc:n, conf:high)  Missing 12x18x bitmap font
  - ref: `reference/lib/fonts/12x18x.fon`  port: `NONE`
  - exp: The 12x18x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-005** (codex, conc:n, conf:high)  Missing 12x24x bitmap font
  - ref: `reference/lib/fonts/12x24x.fon`  port: `NONE`
  - exp: The 12x24x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-006** (codex, conc:n, conf:high)  Missing 16x16x bitmap font
  - ref: `reference/lib/fonts/16x16x.fon`  port: `NONE`
  - exp: The 16x16x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-007** (codex, conc:n, conf:high)  Missing 16x16xw bitmap font
  - ref: `reference/lib/fonts/16x16xw.fon`  port: `NONE`
  - exp: The 16x16xw Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-008** (codex, conc:n, conf:high)  Missing 16x16xw web font
  - ref: `reference/lib/fonts/16x16xw.woff`  port: `NONE`
  - exp: The 16x16xw webfont asset is available for the wide 16x16 font variant.
  - act: No WOFF asset, CSS face, or font selection path exists.

- **[P3] L17_fonts_screens_help-009** (codex, conc:n, conf:high)  Missing 5x8 bitmap font
  - ref: `reference/lib/fonts/5x8x.fon`  port: `NONE`
  - exp: The 5x8x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-010** (codex, conc:n, conf:high)  Missing 6x10 bitmap font
  - ref: `reference/lib/fonts/6x10x.fon`  port: `NONE`
  - exp: The 6x10x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-011** (codex, conc:n, conf:high)  Missing 6x12 bitmap font
  - ref: `reference/lib/fonts/6x12x.fon`  port: `NONE`
  - exp: The 6x12x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-012** (codex, conc:n, conf:high)  Missing 6x13 bitmap font
  - ref: `reference/lib/fonts/6x13x.fon`  port: `NONE`
  - exp: The 6x13x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-013** (codex, conc:n, conf:high)  Missing 6x13xb bitmap font
  - ref: `reference/lib/fonts/6x13xb.fon`  port: `NONE`
  - exp: The 6x13xb Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-014** (codex, conc:n, conf:high)  Missing 7x13 bitmap font
  - ref: `reference/lib/fonts/7x13x.fon`  port: `NONE`
  - exp: The 7x13x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-015** (codex, conc:n, conf:high)  Missing 7x13xb bitmap font
  - ref: `reference/lib/fonts/7x13xb.fon`  port: `NONE`
  - exp: The 7x13xb Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-017** (codex, conc:n, conf:high)  Missing 8x12xb bitmap font
  - ref: `reference/lib/fonts/8x12xb.fon`  port: `NONE`
  - exp: The 8x12xb Windows FNT bitmap glyph asset is available as a selectable bold font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-018** (codex, conc:n, conf:high)  Missing 8x13 bitmap font
  - ref: `reference/lib/fonts/8x13x.fon`  port: `NONE`
  - exp: The 8x13x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-019** (codex, conc:n, conf:high)  Missing 8x16 bitmap font
  - ref: `reference/lib/fonts/8x16x.fon`  port: `NONE`
  - exp: The 8x16x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-020** (codex, conc:n, conf:high)  Missing 8x8 bitmap font
  - ref: `reference/lib/fonts/8x8x.fon`  port: `NONE`
  - exp: The 8x8x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-021** (codex, conc:n, conf:high)  Missing 8x8xb bitmap font
  - ref: `reference/lib/fonts/8x8xb.fon`  port: `NONE`
  - exp: The 8x8xb Windows FNT bitmap glyph asset is available as a selectable bold font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-022** (codex, conc:n, conf:high)  Missing 9x15 bitmap font
  - ref: `reference/lib/fonts/9x15x.fon`  port: `NONE`
  - exp: The 9x15x Windows FNT bitmap glyph asset is available as a selectable Angband font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-023** (codex, conc:n, conf:high)  Missing 9x15xb bitmap font
  - ref: `reference/lib/fonts/9x15xb.fon`  port: `NONE`
  - exp: The 9x15xb Windows FNT bitmap glyph asset is available as a selectable bold font.
  - act: No port asset or loader counterpart exists.

- **[P3] L17_fonts_screens_help-024** (codex, conc:n, conf:high)  Missing font packaging manifest
  - ref: `reference/lib/fonts/Makefile`  port: `NONE`
  - exp: The font package DATA list includes every reference font and the package build installs them.
  - act: No port-side font package manifest or equivalent build asset list exists.

- **[P3] L17_fonts_screens_help-034** (codex, conc:n, conf:high)  GCU font remapping is missing
  - ref: `reference/lib/customize/font-gcu.prf`  port: `NONE`
  - exp: GCU text mode remaps open floor to attr 0x01 and char 0xb7.
  - act: No GCU pref counterpart or equivalent remapping exists.

- **[P3] L17_fonts_screens_help-035** (codex, conc:n, conf:high)  IBM font remapping is missing
  - ref: `reference/lib/customize/font-ibm.prf`  port: `NONE`
  - exp: IBM mode applies the listed pseudo-graphic attr/char mappings for floors, walls, veins, rubble, and lava.
  - act: No IBM pref counterpart or equivalent remapping exists.

- **[P3] L17_fonts_screens_help-036** (codex, conc:n, conf:high)  SDL font remapping is missing
  - ref: `reference/lib/customize/font-sdl.prf`  port: `NONE`
  - exp: SDL mode provides the reference centered-dot floor remapping options for the bundled FNT or Unicode font.
  - act: No SDL pref counterpart or equivalent remapping exists.

- **[P3] L17_fonts_screens_help-037** (codex, conc:n, conf:high)  SDL2 font remapping is missing
  - ref: `reference/lib/customize/font-sdl2.prf`  port: `NONE`
  - exp: SDL2 mode remaps the open floor to attr 1 and char 7 for the bundled font.
  - act: No SDL2 pref counterpart or equivalent remapping exists.

- **[P3] L17_fonts_screens_help-039** (codex, conc:n, conf:high)  X11 font remapping is missing
  - ref: `reference/lib/customize/font-x11.prf`  port: `NONE`
  - exp: X11 mode applies the open-floor and treasure-vein attr/char remappings.
  - act: No X11 pref counterpart or equivalent remapping exists.

- **[P3] L17_fonts_screens_help-044** (codex, conc:n, conf:high)  User pref include dispatcher is missing
  - ref: `reference/lib/customize/user.prf`  port: `NONE`
  - exp: The user pref loader conditionally includes race and class files, including the Half-Troll and short Necro/BG fallbacks.
  - act: No user pref-file loader or conditional include implementation exists.

---
## L1_rng_util  (grok=22 codex=31 terra=30)
_cross-model overlap on: z-color.c, z-file.h, z-file.c, z-util.c, buildid.c, z-bitflag.c, z-color.h, z-quark.c, z-textblock.h, z-rand.c, alloc.h, config.h, guid.c, h-basic.h, z-bitflag.h, z-debug.h, z-queue.c, z-type.c, z-form.c_

- **[P1] L1_rng_util-015** (codex, conc:n, conf:high)  Color lookup defaults differ
  - ref: `reference/src/z-color.c:165-202`  port: `packages/core/src/color.ts:140-155`
  - exp: NUL and space map to COLOUR_DARK; unknown character and text names map to COLOUR_WHITE.
  - act: Space maps to synthetic Shade index 28; unknown character and text names return -1; Shade also matches as a named color.

- **[P1] L1_rng_util-020** (codex, conc:y, conf:high)  Native file API is absent
  - ref: `reference/src/z-file.h:65-350`  port: `NONE`
  - exp: Path building/normalization, file handles, locking, line and byte I/O, directory creation, and directory iteration are available.
  - act: No port implementation exposes path_build, file_open, file_lock, file_getl, directory, or equivalent APIs. SaveWriter/SaveReader and browser storage are separate substitutes.

- **[P1] L1_rng_util-021** (codex, conc:y, conf:high)  Native file behavior is not reproduced
  - ref: `reference/src/z-file.c:176-1505`  port: `packages/core/src/save/buffer.ts:41-279; packages/core/src/session/save.ts:1575-1613; packages/web/src/score.ts:43-73`
  - exp: C path normalization, temporary/save filename generation, file locking, newline/tab normalization, binary reads/writes, and directory scanning execute in the native filesystem.
  - act: The cited port files serialize bytes or JSON and persist selected records in localStorage; they do not implement the C filesystem control flow.

- **[P1] L1_rng_util-001** (grok, conc:n, conf:high)  color_char_to_attr: space/empty/unknown defaults wrong
  - ref: `reference/src/z-color.c:174-184`  port: `packages/core/src/color.ts:139-146`
  - exp: color_char_to_attr('\0' or ' ') returns COLOUR_DARK (0); unknown char returns COLOUR_WHITE (1)
  - act: colorCharToAttr(' ') returns COLOUR_SHADE (28) because Shade row invents char " "; empty/unknown return -1

- **[P1] L1_rng_util-002** (grok, conc:n, conf:high)  color_text_to_attr: unknown name returns -1 not white
  - ref: `reference/src/z-color.c:191-201`  port: `packages/core/src/color.ts:148-156`
  - exp: unknown colour name returns COLOUR_WHITE (1)
  - act: colorTextToAttr returns -1; mon/bind.ts throws on dAttr < 0 instead of accepting white

- **[P1] L1_rng_util-017** (terra, conc:n, conf:high)  Randart variance omits C saturation and exact arithmetic
  - ref: `reference/src/z-util.c:1625`  port: `packages/core/src/obj/randart-data.ts:248`
  - exp: The calculation uses exact multiprecision intermediate values and clamps the result to INT_MAX.
  - act: JavaScript-number arithmetic can lose integer precision and returns an unclamped value.

- **[P2] L1_rng_util-002** (codex, conc:n, conf:high)  Live build identity differs from C
  - ref: `reference/src/buildid.c:37-38`  port: `packages/core/src/score/score.ts:25,79; packages/web/src/main.ts:4354`
  - exp: buildid is "Angband 4.2.6" and buildver is "4.2.6".
  - act: Scores default to "0.1.0"; the version screen displays "Neo Angband 0.1.0".

- **[P2] L1_rng_util-003** (codex, conc:n, conf:high)  Copyright notice is omitted from version information
  - ref: `reference/src/buildid.c:43-55`  port: `packages/web/src/main.ts:4351-4358`
  - exp: Version information includes the full upstream copyright and license notice.
  - act: The port displays short credits and no copyright/license text.

- **[P2] L1_rng_util-010** (codex, conc:n, conf:high)  flagNext uses the wrong exhaustion sentinel
  - ref: `reference/src/z-bitflag.c:62-82`  port: `packages/core/src/bitflag.ts:41-42,94-105`
  - exp: flag_next returns FLAG_END, which is 0, when no flag remains.
  - act: flagNext returns NO_FLAG, which is -1.

- **[P2] L1_rng_util-014** (codex, conc:n, conf:high)  Color domain and background constants
  - ref: `reference/src/z-color.h:77-90`  port: `packages/core/src/color.ts:40`
  - exp: MAX_COLORS is 32, BASIC_COLORS is 29, and MULT_BG/BG_BLACK/BG_SAME/BG_DARK/BG_MAX are available.
  - act: MAX_COLORS is 29 and the background encoding constants are absent.

- **[P2] L1_rng_util-016** (codex, conc:y, conf:high)  Gamma correction is absent
  - ref: `reference/src/z-color.c:283-378`  port: `packages/core/src/color.ts:159-220`
  - exp: build_gamma_table populates gamma_table[256] for terminal color conversion.
  - act: No gamma table or build_gamma_table equivalent exists; CSS uses raw RGB values.

- **[P2] L1_rng_util-022** (codex, conc:n, conf:high)  Bounded formatter is unmapped
  - ref: `reference/src/z-form.h:39-78`  port: `packages/core/src/obj/object-info.ts:269-273`
  - exp: vstrnfmt/strnfmt/vformat/strnfcat/format/plog_fmt/quit_fmt support bounded C formatting and the documented extended sequences.
  - act: Only a local sprintfS helper replacing %s exists; there is no reusable bounded formatter or equivalent format-sequence implementation.

- **[P2] L1_rng_util-023** (codex, conc:n, conf:high)  Quark interning is absent and empty-note behavior differs
  - ref: `reference/src/z-quark.c:31-53`  port: `packages/core/src/game/obj-cmd.ts:1161-1167`
  - exp: quark_add("") returns a nonzero interned ID and quark_str retrieves the stored string.
  - act: The port intentionally maps an empty inscription to null; no quark table or quark_str API exists.

- **[P2] L1_rng_util-025** (codex, conc:y, conf:high)  Textblock API is only partially modeled
  - ref: `reference/src/z-textblock.h:38-68`  port: `packages/core/src/obj/object-info.ts:110-142; packages/core/src/mon/lore-describe.ts:81-94; packages/web/src/screens.ts:155-195`
  - exp: A textblock stores text and per-character attributes and provides pict append, textblock concatenation, line calculation, file output, and text_out hooks.
  - act: The port uses colored string runs and UI wrapping; textblock_calculate_lines, textblock_to_file, and text_out_* are not provided.

- **[P2] L1_rng_util-026** (codex, conc:y, conf:high)  Rand_simple is missing
  - ref: `reference/src/z-rand.h:153; reference/src/z-rand.c:576-592`  port: `packages/core/src/rng.ts:119-468`
  - exp: Rand_simple produces a time/process-derived value without disturbing the game RNG state.
  - act: Rng exposes only instance streams and no Rand_simple equivalent.

- **[P2] L1_rng_util-027** (codex, conc:y, conf:high)  Global Rand_init contract is replaced
  - ref: `reference/src/z-rand.c:131-152`  port: `packages/core/src/rng.ts:119-154; packages/core/src/rng.ts:428-468`
  - exp: Rand_init seeds the global RNG from time and process identity, switches Rand_quick to complex mode, and initializes global state.
  - act: Rng requires an explicit seed; RngStreams provides named instances, with no global Rand_init or process-derived seed path.

- **[P2] L1_rng_util-028** (codex, conc:n, conf:high)  point_set API is absent
  - ref: `reference/src/z-type.h:48-60; reference/src/z-type.c:78-119`  port: `packages/core/src/loc.ts:13-55; packages/core/src/game/target.ts:355-380`
  - exp: point_set_new, add_to_point_set, point_set_size, and point_set_contains provide a dynamically growing deduplicatable point-set abstraction.
  - act: Loc helpers exist, but no point-set type or shared API exists; consumers use raw Loc arrays.

- **[P2] L1_rng_util-029** (codex, conc:n, conf:high)  UTF-8 and bounded string utility APIs are missing
  - ref: `reference/src/z-util.h:73-183`  port: `packages/core/src/guard.ts:24-54; packages/core/src/obj/randname.ts:38-42; packages/core/src/obj/object-info.ts:259-260`
  - exp: UTF-8 cursor/clip/conversion helpers, case-insensitive comparisons, bounded copy/concat, escaping, vowel tests, and related utility functions are available.
  - act: Only selected guard and vowel logic is distributed through unrelated modules; the UTF-8 and bounded string API surface is absent.

- **[P2] L1_rng_util-030** (codex, conc:n, conf:high)  djb2 hash differs for non-ASCII strings
  - ref: `reference/src/z-util.c:2043-2054`  port: `packages/core/src/sound/engine.ts:26-33`
  - exp: djb2_hash hashes the sequence of C char bytes until NUL.
  - act: djb2Hash iterates JavaScript UTF-16 code units with charCodeAt.

- **[P2] L1_rng_util-009** (grok, conc:n, conf:high)  buildid/score what stamps port version not Angband buildid
  - ref: `reference/src/buildid.c:37-38; reference/src/score.c (build_score uses buildid)`  port: `packages/core/src/score/score.ts:26,79; packages/core/src/index.ts:28`
  - exp: buildid = "Angband 4.2.6"; score what[] keeps first 7 chars ("Angband")
  - act: DEFAULT_BUILDID / ENGINE_VERSION = "0.1.0" stamped into score what

- **[P2] L1_rng_util-010** (grok, conc:n, conf:high)  do_cmd_version omits buildver header and copyright block
  - ref: `reference/src/ui-command.c:143-157; reference/src/buildid.c:37-55`  port: `packages/web/src/main.ts:4349-4360`
  - exp: Header "You are playing 4.2.6. Type '?' for more info." plus full copyright textblock
  - act: Modal shows "Neo Angband 0.1.0", port credit lines; no copyright string from buildid.c

- **[P2] L1_rng_util-015** (grok, conc:y, conf:high)  z-file filesystem layer not ported (browser store seam)
  - ref: `reference/src/z-file.h / z-file.c (path_build, ang_file, setuid, dirs)`  port: `packages/web/src/roster.ts; packages/web/src/score.ts; packages/core/src/session/save.ts (buffer + inject)`
  - exp: Native paths, ang_file I/O, scores/saves under lib/user paths
  - act: localStorage / injected ScoreStore / save buffers; no path_build/file_open

- **[P2] L1_rng_util-017** (grok, conc:n, conf:high)  z-textblock incomplete (no shared wrap/to_file/text_out)
  - ref: `reference/src/z-textblock.h:38-72`  port: `packages/core/src/obj/object-info.ts:110-144; mon/lore-describe.ts; packages/web/src/charsheet.ts:294+`
  - exp: textblock_append(_c), calculate_lines, to_file, text_out_* hooks
  - act: Ad-hoc Textblock/LoreTextBuilder run lists; wrapping only in some UI; no text_out_e

- **[P2] L1_rng_util-018** (grok, conc:n, conf:med)  z-util largely partial (only guards + local helpers)
  - ref: `reference/src/z-util.c / z-util.h (utf8_*, my_str*, streq, strunescape, plog/quit, ...)`  port: `packages/core/src/guard.ts; scattered isAVowel/myStrcap/containsOnlySpaces`
  - exp: Shared string/util API used game-wide
  - act: Overflow guards only as module; string ops reimplemented locally and inconsistently

- **[P2] L1_rng_util-021** (grok, conc:n, conf:high)  Shade color_table row invents index_char and name
  - ref: `reference/src/z-color.c:154-155 (color_table rest zero-init); L61 angband_color_table shade RGB`  port: `packages/core/src/color.ts:135-136`
  - exp: color_table[28] zero-filled (no index_char/name); RGB only in angband_color_table
  - act: COLOR_TABLE[28] = char " ", name "Shade", rgb 0x28...

- **[P2] L1_rng_util-005** (terra, conc:n, conf:high)  Color capacity is 29 rather than 32
  - ref: `reference/src/z-color.h:77`  port: `packages/core/src/color.ts:40`
  - exp: MAX_COLORS is 32, including three zero-initialized trailing rows.
  - act: MAX_COLORS is 29 and the live web color editor cycles only 0 through 28.

- **[P2] L1_rng_util-006** (terra, conc:n, conf:high)  Color character conversion has different space and unknown fallbacks
  - ref: `reference/src/z-color.c:165`  port: `packages/core/src/color.ts:139`
  - exp: NUL and space map to dark (0), and any unknown character maps to white (1).
  - act: Space maps to shade (28) and an unknown character maps to -1.

- **[P2] L1_rng_util-007** (terra, conc:n, conf:high)  Color-name conversion lacks the C white fallback
  - ref: `reference/src/z-color.c:191`  port: `packages/core/src/color.ts:148`
  - exp: Unknown names return white (1), while an empty name matches the zero-initialized trailing entry.
  - act: Unknown and empty names return -1.

- **[P2] L1_rng_util-008** (terra, conc:n, conf:high)  Shade has incorrect textual color metadata
  - ref: `reference/src/z-color.c:60`  port: `packages/core/src/color.ts:135`
  - exp: Palette entry 28 has shade RGB but its color-table name and character remain zero-initialized.
  - act: Entry 28 is named Shade with a space character.

- **[P2] L1_rng_util-014** (terra, conc:n, conf:high)  Empty inscriptions are not interned
  - ref: `reference/src/z-quark.c:31`  port: `packages/core/src/game/obj-cmd.ts:1161`
  - exp: quark_add("") returns a nonzero interned empty-string handle.
  - act: An empty inscription is normalized to null.

- **[P2] L1_rng_util-016** (terra, conc:n, conf:high)  Trailing textblock newlines add a blank rendered line
  - ref: `reference/src/z-textblock.c:311`  port: `packages/web/src/screens.ts:167`
  - exp: textblock_calculate_lines drops the final zero-length line.
  - act: wrapRuns emits an empty ScreenLine for a trailing newline.

- **[P3] L1_rng_util-001** (codex, conc:n, conf:high)  Ego allocation entry omits prob1
  - ref: `reference/src/alloc.h:34`  port: `packages/core/src/obj/make.ts:193-199`
  - exp: alloc_entry includes index, level, prob1, prob2, and prob3.
  - act: EgoAllocEntry omits prob1, although C initializes it.

- **[P3] L1_rng_util-004** (codex, conc:n, conf:high)  Build identity header API is not preserved
  - ref: `reference/src/buildid.h:22-26`  port: `packages/core/src/index.ts:25-28`
  - exp: Public VERSION_NAME, buildid, buildver, and copyright symbols are declared.
  - act: The port exports PARITY_BASELINE and ENGINE_VERSION instead; build identity values are scattered or private.

- **[P3] L1_rng_util-005** (codex, conc:y, conf:high)  Native configuration paths have no faithful runtime counterpart
  - ref: `reference/src/config.h:51-70`  port: `packages/content/src/compile.ts:25-39; packages/web/src/score.ts:48-78`
  - exp: Default config, library, and data paths are "./lib/" and private user data defaults to "~/.angband".
  - act: Build-time content uses repository-relative paths and browser persistence uses localStorage, with no equivalent path configuration.

- **[P3] L1_rng_util-006** (codex, conc:n, conf:high)  guid_eq has no port counterpart
  - ref: `reference/src/guid.c:22-25`  port: `NONE`
  - exp: guid_eq compares two unsigned guid values and returns equality.
  - act: No generic guid_eq implementation exists; callers use numeric indices or registry lookups directly.

- **[P3] L1_rng_util-007** (codex, conc:n, conf:high)  GUID type and declarations are not ported
  - ref: `reference/src/guid.h:22-24`  port: `NONE`
  - exp: guid is an unsigned int type with a public guid_eq declaration.
  - act: No guid type or equivalent public declaration exists.

- **[P3] L1_rng_util-008** (codex, conc:y, conf:high)  h-basic portability and macro layer is not represented centrally
  - ref: `reference/src/h-basic.h:39-197`  port: `NONE`
  - exp: The header defines platform flags, path separators, C types, debugging macros, math macros, N_ELEMENTS, and ASCII conversion macros.
  - act: TypeScript relies on the JavaScript runtime, standard library, and distributed helpers rather than a central portability header.

- **[P3] L1_rng_util-009** (codex, conc:y, conf:high)  randname_make buffer contract is not preserved
  - ref: `reference/src/randname.c:77-89`  port: `packages/core/src/obj/randname.ts:80-85`
  - exp: randname_make receives a destination buffer and asserts buflen > max.
  - act: randnameMake returns a dynamically sized string and has no buffer-length argument or assertion.

- **[P3] L1_rng_util-011** (codex, conc:n, conf:high)  Port invents complement bitflag operations
  - ref: `reference/src/z-bitflag.c:28-588`  port: `packages/core/src/bitflag.ts:267-320`
  - exp: The C implementation provides only flag_union, flag_inter, and flag_diff; no complement-operation API exists.
  - act: The port adds flagCompUnion, flagCompInter, and flagCompDiff with new behavior.

- **[P3] L1_rng_util-012** (codex, conc:n, conf:high)  Invalid bitflag inputs throw where C asserts or has undefined behavior
  - ref: `reference/src/z-bitflag.c:198-207`  port: `packages/core/src/bitflag.ts:64-73,172-179`
  - exp: flag_on checks only the C assertion that the computed offset is within size; flag 0 is not explicitly rejected.
  - act: flagOn rejects flag 0 and invalid offsets with RangeError.

- **[P3] L1_rng_util-013** (codex, conc:n, conf:high)  Debug bitflag API is missing
  - ref: `reference/src/z-bitflag.h:90-97`  port: `packages/core/src/bitflag.ts:83-91,168-179`
  - exp: flag_has_dbg and flag_on_dbg are available in debug builds and forward to the normal operations in NDEBUG builds.
  - act: No flagHasDbg or flagOnDbg equivalents are exported.

- **[P3] L1_rng_util-017** (codex, conc:n, conf:high)  Debug helpers are unmapped
  - ref: `reference/src/z-debug.h:22-23`  port: `NONE`
  - exp: notreached expands to assert(0), and testonly is available as an annotation macro.
  - act: No shared port helper or annotation maps these definitions.

- **[P3] L1_rng_util-018** (codex, conc:y, conf:high)  Dice lifecycle API is replaced by GC
  - ref: `reference/src/z-dice.h:29-30`  port: `packages/core/src/dice.ts:148-206`
  - exp: dice_new allocates a dice object and dice_free releases it.
  - act: Dice is a garbage-collected class with no explicit new/free API.

- **[P3] L1_rng_util-019** (codex, conc:y, conf:high)  Expression lifecycle API is replaced by GC
  - ref: `reference/src/z-expression.h:37-42`  port: `packages/core/src/expression.ts:193-216`
  - exp: expression_new, expression_free, expression_copy, base-value binding, and evaluation are exposed as C APIs.
  - act: Construction, copying, and evaluation are class methods; there is no expression_free API.

- **[P3] L1_rng_util-024** (codex, conc:n, conf:high)  Generic FIFO and priority queues are unmapped
  - ref: `reference/src/z-queue.h:24-94`  port: `packages/web/src/input-queue.ts:36-80; packages/core/src/game/player-path.ts:80-102`
  - exp: q_* implements a bounded uintptr FIFO and qp_* implements a resizable priority heap with push/pop/peek/pushpop semantics.
  - act: The port has a DOM key queue and ad hoc JavaScript arrays, but no generic FIFO or priority-queue implementation matching the C API.

- **[P3] L1_rng_util-031** (codex, conc:y, conf:high)  Custom allocation and string ownership wrappers are absent
  - ref: `reference/src/z-virt.h:21-47; reference/src/z-virt.c:30-109`  port: `NONE`
  - exp: mem_alloc/mem_zalloc/mem_realloc fail through quit, preserve zero-length behavior, and string_make/string_append manage explicit ownership.
  - act: No port wrapper exists; JavaScript objects and strings use garbage collection and native allocation.

- **[P3] L1_rng_util-003** (grok, conc:n, conf:high)  MAX_COLORS constant is 29; C is 32
  - ref: `reference/src/z-color.h:77-78`  port: `packages/core/src/color.ts:40`
  - exp: MAX_COLORS 32, BASIC_COLORS 29 (arrays sized 32 with trailing slots)
  - act: MAX_COLORS exported as 29; VISUALS_MAX_COLORS=32 lives only in visuals/engine.ts

- **[P3] L1_rng_util-004** (grok, conc:n, conf:high)  attr_to_text not in core color module
  - ref: `reference/src/z-color.c:208-214`  port: `packages/cli/src/spoilers.ts:453-457 (local only); packages/core/src/color.ts:NONE`
  - exp: attr_to_text(a) returns color_table[a].name for a < BASIC_COLORS else "Icky"
  - act: Core exports no attrToText; only CLI spoilers reimplement locally

- **[P3] L1_rng_util-005** (grok, conc:?, conf:med)  build_gamma_table / gamma_table absent
  - ref: `reference/src/z-color.c:283-320`  port: `NONE`
  - exp: build_gamma_table(gamma) fills gamma_table[256] for phosphor correction
  - act: No gamma table; web uses angband_color_table RGB bytes directly

- **[P3] L1_rng_util-006** (grok, conc:?, conf:med)  MULT_BG / BG_* background attr encoding missing
  - ref: `reference/src/z-color.h:87-90`  port: `NONE (web term uses separate bg CSS, not MULT_BG packing)`
  - exp: glyph attrs encode background via a + MULT_BG * BG_{BLACK,SAME,DARK}
  - act: No MULT_BG constants or packing; map cells use optional separate bg field

- **[P3] L1_rng_util-007** (grok, conc:n, conf:high)  flag_next sentinel is -1 not FLAG_END (0)
  - ref: `reference/src/z-bitflag.c:70-82`  port: `packages/core/src/bitflag.ts:10-15,100-106`
  - exp: flag_next returns FLAG_END (0) when exhausted
  - act: flagNext returns NO_FLAG (-1); callers must use NO_FLAG

- **[P3] L1_rng_util-008** (grok, conc:n, conf:high)  flag_comp_* helpers invented without C symbols
  - ref: `reference/src/z-bitflag.h (no flag_comp_* declarations)`  port: `packages/core/src/bitflag.ts:267-321`
  - exp: No flag_comp_union/inter/diff in 4.2.6 z-bitflag
  - act: Port defines flagCompUnion/Inter/Diff as complement ops

- **[P3] L1_rng_util-011** (grok, conc:n, conf:high)  z-quark not ported; notes are plain strings
  - ref: `reference/src/z-quark.c:31-54`  port: `NONE (obj.note / AutoinscriptionRegistry use string | null)`
  - exp: quark_add/quark_str intern inscriptions as size_t indices
  - act: Inscriptions stored and saved as full strings

- **[P3] L1_rng_util-012** (grok, conc:n, conf:high)  z-queue module absent; gen uses unbounded IntQueue
  - ref: `reference/src/z-queue.c:32-97`  port: `packages/core/src/gen/cave.ts:689-701`
  - exp: Fixed-capacity circular queue; q_push aborts if full
  - act: Private growing array IntQueue for flood-fill only; no shared q_*/qp_* API

- **[P3] L1_rng_util-013** (grok, conc:n, conf:high)  z-type point_set API not ported as shared type
  - ref: `reference/src/z-type.c:78-119`  port: `packages/core/src/loc.ts (loc helpers only); packages/core/src/game/target.ts:362-378 (Loc[])`
  - exp: point_set_new/add/contains/size/dispose
  - act: Targeting builds Loc[] inline; room light etc. reimplemented without point_set

- **[P3] L1_rng_util-014** (grok, conc:y, conf:high)  Rand_simple not ported
  - ref: `reference/src/z-rand.c:579-592`  port: `packages/core/src/rng.ts:NONE`
  - exp: Separate LCRNG for non-gameplay (temp filenames in z-file.c)
  - act: No Rand_simple; browser uses other entropy for temps/storage keys

- **[P3] L1_rng_util-016** (grok, conc:y, conf:high)  z-form / z-virt not ported as modules
  - ref: `reference/src/z-form.c (vstrnfmt/strnfmt); reference/src/z-virt.c (mem_*/string_*)`  port: `NONE (JS strings + GC + template literals at call sites)`
  - exp: Bounded format buffers and die-on-OOM allocators
  - act: Language-native strings/arrays; format parity depends on each call site

- **[P3] L1_rng_util-019** (grok, conc:n, conf:high)  z-debug.h not mapped
  - ref: `reference/src/z-debug.h:22-23`  port: `NONE`
  - exp: notreached assert(0); testonly annotation
  - act: No equivalent macros; TS throws/asserts ad hoc

- **[P3] L1_rng_util-020** (grok, conc:n, conf:high)  guid module not mapped (only trivial eq)
  - ref: `reference/src/guid.c:22-25; guid.h:22-24`  port: `NONE`
  - exp: guid type + guid_eq
  - act: No guid type; equality is plain === where IDs exist

- **[P3] L1_rng_util-022** (grok, conc:n, conf:high)  alloc_entry type not centralized from alloc.h
  - ref: `reference/src/alloc.h:29-37`  port: `packages/core/src/mon/make.ts:41-50; packages/core/src/obj/make.ts:192-198`
  - exp: Shared alloc_entry {index,level,prob1,prob2,prob3}
  - act: Separate MonAllocEntry / EgoAllocEntry interfaces (fields present, no single type)

- **[P3] L1_rng_util-001** (terra, conc:n, conf:high)  flag_next uses a different exhaustion sentinel
  - ref: `reference/src/z-bitflag.c:70`  port: `packages/core/src/bitflag.ts:100`
  - exp: Exhaustion returns FLAG_END (0).
  - act: Exhaustion returns NO_FLAG (-1).

- **[P3] L1_rng_util-002** (terra, conc:n, conf:high)  Variadic bitflag helpers do not honor FLAG_END termination
  - ref: `reference/src/z-bitflag.c:394`  port: `packages/core/src/bitflag.ts:328`
  - exp: A zero argument terminates the list and later flags are ignored.
  - act: Zero is processed or rejected and later rest arguments remain processed.

- **[P3] L1_rng_util-003** (terra, conc:n, conf:high)  FlagSet rejects valid zero-byte flag sets
  - ref: `reference/src/z-bitflag.c:114`  port: `packages/core/src/bitflag.ts:389`
  - exp: A size-zero set is valid; empty and full tests return true and wipes are no-ops.
  - act: new FlagSet(0) throws.

- **[P3] L1_rng_util-004** (terra, conc:n, conf:high)  Debug bitflag APIs are absent
  - ref: `reference/src/z-bitflag.h:90`  port: `NONE`
  - exp: Debug builds expose flag_has_dbg and flag_on_dbg with out-of-range diagnostics.
  - act: No equivalent debug entry points exist.

- **[P3] L1_rng_util-009** (terra, conc:n, conf:high)  Gamma-table API is missing
  - ref: `reference/src/z-color.c:283`  port: `NONE`
  - exp: A mutable 256-byte gamma_table and build_gamma_table(gamma) implement C's integer Taylor-series correction.
  - act: No gamma table or builder exists.

- **[P3] L1_rng_util-010** (terra, conc:n, conf:high)  Background glyph constants are missing
  - ref: `reference/src/z-color.h:80`  port: `NONE`
  - exp: MULT_BG, BG_BLACK, BG_SAME, BG_DARK, and BG_MAX are exported.
  - act: No equivalent constants are exported.

- **[P3] L1_rng_util-011** (terra, conc:n, conf:high)  Re-seeding resets the WELL index
  - ref: `reference/src/z-rand.c:104`  port: `packages/core/src/rng.ts:140`
  - exp: Rand_state_init warms up from the existing state_i and does not reset it.
  - act: stateInit sets stateI to zero before warm-up.

- **[P3] L1_rng_util-012** (terra, conc:n, conf:high)  Rand_normal does not preserve int16 return narrowing
  - ref: `reference/src/z-rand.c:287`  port: `packages/core/src/rng.ts:240`
  - exp: The int16_t return narrows results outside the signed 16-bit range.
  - act: The TypeScript function returns an unrestricted number.

- **[P3] L1_rng_util-013** (terra, conc:n, conf:high)  Rand_init and Rand_simple are absent
  - ref: `reference/src/z-rand.c:131`  port: `NONE`
  - exp: C exposes global quick-to-complex initialization and a time/PID-based simple RNG.
  - act: Rng requires a supplied seed and has no Rand_simple equivalent.

- **[P3] L1_rng_util-015** (terra, conc:n, conf:high)  Queue invariant failures are not preserved
  - ref: `reference/src/z-queue.c:32`  port: `packages/core/src/gen/cave.ts:689`
  - exp: Fixed-capacity push overflow and empty pop abort.
  - act: The substitute grows dynamically and empty pop returns undefined.

- **[P3] L1_rng_util-018** (terra, conc:n, conf:high)  Build identity strings are absent
  - ref: `reference/src/buildid.c:37`  port: `NONE`
  - exp: buildid is "Angband 4.2.6", buildver is "4.2.6", and the C copyright text is linked into the program.
  - act: No port build-identity module or equivalent exported strings exist.

- **[P3] L1_rng_util-019** (terra, conc:n, conf:high)  GUID equality API is absent
  - ref: `reference/src/guid.c:22`  port: `NONE`
  - exp: guid is an unsigned integer with guid_eq(a, b) equality.
  - act: No equivalent guid type or equality function is implemented.

- **[P3] L1_rng_util-020** (terra, conc:y, conf:high)  C configuration path defaults are absent
  - ref: `reference/src/config.h:51`  port: `NONE`
  - exp: The configured default config, lib, and data paths are "./lib/" and Unix has a private user path.
  - act: No filesystem-path configuration counterpart exists.

- **[P3] L1_rng_util-021** (terra, conc:n, conf:high)  C point-set API is absent
  - ref: `reference/src/z-type.c:78`  port: `NONE`
  - exp: point_set_new, add_to_point_set, point_set_size, point_set_contains, and disposal implement a growable location collection.
  - act: loc.ts ports the loc helpers but has no point_set counterpart.

- **[P3] L1_rng_util-022** (terra, conc:y, conf:high)  C file abstraction is absent
  - ref: `reference/src/z-file.c:1`  port: `NONE`
  - exp: ang_file and path/file helpers provide C filesystem, directory, and locking operations.
  - act: No equivalent low-level file abstraction is implemented.

- **[P3] L1_rng_util-023** (terra, conc:n, conf:high)  C printf-formatting abstraction is absent
  - ref: `reference/src/z-form.c:1`  port: `NONE`
  - exp: format, vformat, strnfmt, vstrnfmt, and related bounded C formatting helpers are available.
  - act: No C-compatible formatting module exists; callers use JavaScript template strings.

- **[P3] L1_rng_util-024** (terra, conc:n, conf:high)  Quark interning API is not ported
  - ref: `reference/src/z-quark.c:21`  port: `NONE`
  - exp: quark_add interns strings to stable nonzero handles and quark_str resolves handles.
  - act: Object notes use nullable strings directly with no quark table or handles.

- **[P3] L1_rng_util-025** (terra, conc:n, conf:high)  Priority queue API is not ported
  - ref: `reference/src/z-queue.c:116`  port: `NONE`
  - exp: q_new, q_push, q_pop, q_push_int, and q_pop_int provide fixed-capacity min-priority queues.
  - act: gen/cave.ts has only an array FIFO substitute.

- **[P3] L1_rng_util-026** (terra, conc:n, conf:high)  Textblock API is only partially ported
  - ref: `reference/src/z-textblock.c:21`  port: `packages/core/src/obj/object-info.ts:121`
  - exp: textblocks support colored append, padding, concatenation, wrapping, line calculation, and rendering callbacks.
  - act: The port has narrow run-stream and web wrapping adapters without the C textblock API.

- **[P3] L1_rng_util-027** (terra, conc:y, conf:high)  C allocation wrappers are absent
  - ref: `reference/src/z-virt.c:30`  port: `NONE`
  - exp: Allocation, zero-allocation, reallocation, string-copy, and append wrappers implement C null and out-of-memory semantics.
  - act: No equivalent module exists; JavaScript garbage collection and strings are used directly.

- **[P3] L1_rng_util-028** (terra, conc:n, conf:high)  Debug assertion macros are absent
  - ref: `reference/src/z-debug.h:22`  port: `NONE`
  - exp: notreached asserts false and testonly is available as an annotation macro.
  - act: No matching debug support module is exported.

- **[P3] L1_rng_util-029** (terra, conc:n, conf:high)  Aggregating angband header has no port counterpart
  - ref: `reference/src/angband.h:18`  port: `NONE`
  - exp: A single header exports the low-level, mid-level, configuration, event, message, and player interfaces.
  - act: TypeScript consumers must import separate modules and no aggregate equivalent exists.

- **[P3] L1_rng_util-030** (terra, conc:y, conf:high)  Basic C compatibility header has no port counterpart
  - ref: `reference/src/h-basic.h:147`  port: `NONE`
  - exp: C platform types, path separators, math macros, and character conversion macros are defined together.
  - act: TypeScript and JavaScript primitives replace them without a compatibility module.

---
## L2_init_parse  (grok=10 codex=3 terra=9)
_cross-model overlap on: parser.c, init.c, datafile.c_

- **[P1] L2_init_parse-001** (codex, conc:n, conf:high)  Negative random values are parsed with the wrong base
  - ref: `reference/src/parser.c:126`  port: `packages/content/src/parser.ts:208`
  - exp: parse_random() treats a leading minus as whole-expression negation and adjusts base by subtracting m_bonus and dice * (sides + 1); for -3d5 it produces base -6, dice 1, sides 5.
  - act: isValidRandom() only validates and preserves the raw string, then packages/core/src/obj/bind.ts:107 parses that raw -3d5 with Dice as base -3, dice 1, sides 5; shipped object.txt:2308 reaches this path through bindKinds at obj/bind.ts:676.

- **[P1] L2_init_parse-001** (grok, conc:n, conf:high)  flavor list walk order is file order; C is reverse (prepend)
  - ref: `reference/src/init.c:4239-4270 (parse_flavor_flavor prepends f->next = h); reference/src/obj-util.c:76-112 (flavor_assign_random walks flavors head-first)`  port: `packages/core/src/obj/bind.ts:1143-1168 (bindFlavors pushes file order); packages/core/src/obj/flavor.ts:160-189 (assignRandom walks work[] file order; comment claims this matches upstream)`
  - exp: flavors linked list head is last-parsed flavor; flavor_assign_random choice=0 selects the last remaining random flavor of that tval in file order (reverse walk)
  - act: reg.flavors and work[] are forward file order; choice=0 selects the first remaining random flavor of that tval

- **[P1] L2_init_parse-006** (terra, conc:n, conf:high)  Random-name word order is not reversed
  - ref: `reference/src/init.c:1476`  port: `packages/core/src/session/boot.ts:149`
  - exp: Each names.txt word is prepended and finish_parse_names copies that linked-list order, so each section's indexed word array is reverse file order.
  - act: bindCore stores each compiled word array in source file order.

- **[P2] L2_init_parse-002** (codex, conc:n, conf:high)  Terrain look prefixes and prepositions miss C's terminating spaces
  - ref: `reference/src/init.c:2293`  port: `packages/core/src/world/feature.ts:132`
  - exp: finish_parse_feat() appends one trailing space to every nonempty look_prefix and look_in_preposition that does not already end in a space.
  - act: FeatureRegistry stores joined terrain strings verbatim and never applies the finish step; known.ts:212 returns the raw value, so terrain.txt:175 "the entrance to the" lacks C's added space before the feature name.

- **[P2] L2_init_parse-002** (grok, conc:n, conf:high)  combat critical tables hard-coded; not live z_info from constants
  - ref: `reference/src/init.c:702-761,1006-1025 (parse/finish constants into z_info->*_crit_*); reference/src/player-attack.c:399-418 (critical_melee reads z_info)`  port: `packages/core/src/constants.ts:296-323 (bindConstants builds meleeCritical etc); packages/core/src/combat/hit.ts:138-178,239-254 (MELEE_CRIT / MELEE_CRIT_LEVELS literals; criticalMelee ignores Constants)`
  - exp: critical_melee/shot and O-crit paths scale from z_info filled by constants.txt
  - act: hit.ts embeds stock constants.txt numbers; bound Constants.meleeCritical is unused by combat

- **[P2] L2_init_parse-003** (grok, conc:n, conf:high)  hints.txt compiled but not bound or used at runtime
  - ref: `reference/src/init.c:4336-4381 (hints_parser); reference/src/ui-store.c:120-158 (random_hint / prt_welcome one_in_(3) hint branch)`  port: `packages/content/src/specs/init.ts:261-266 (hintsSpec); packages/content/pack/hints.json exists; packages/core/src has no hints registry; packages/web/src/shop.ts:197-198 documents skipped hint branch`
  - exp: global hints list from hints.txt; shop welcome may print comment_hint + random_hint()
  - act: pack has hints.json but core/web never load it; shop always skips the hint path

- **[P2] L2_init_parse-004** (grok, conc:n, conf:high)  world.txt compiled but not bound; depth substitutes for level names
  - ref: `reference/src/init.c:1089-1197 (world_parser); reference/src/game-world.c:95-112 (level_by_name/depth); reference/src/generate.c:893-1028 (get_join_info / stored names use level_by_depth()->name)`  port: `packages/content/src/specs/init.ts:39-43 (worldSpec); packages/content/pack/world.json exists; packages/core/src/session/boot.ts CorePack/bindCore omit world; packages/core/src/game/context.ts:642-646 (levelCache keyed by depth number)`
  - exp: world linked list of named levels; join/persist look up by level name from depth
  - act: world.json never bound; persist/join identity is numeric depth only

- **[P2] L2_init_parse-005** (terra, conc:n, conf:high)  Terrain look phrases lack C's trailing-space finalization
  - ref: `reference/src/init.c:2293`  port: `packages/core/src/world/feature.ts:132`
  - exp: finish_parse_feat appends one space to every nonempty look-prefix and look-in-preposition that does not already end in a space.
  - act: FeatureRegistry preserves the compiled text exactly.

- **[P3] L2_init_parse-003** (codex, conc:y, conf:high)  File loader semantics are replaced by precompiled input
  - ref: `reference/src/datafile.c:87`  port: `packages/content/src/compile.ts:25`
  - exp: parse_file() first tries the user filename, falls back to standard gamedata, parses every line, reports errors up to the configured limit, and returns the first error; the browser path has no raw user filesystem.
  - act: compile.ts reads only reference/lib/gamedata at build time, records.ts:155 aborts on the first ParseError, and runtime loading consumes compiled pack JSON with no user-file override or equivalent parse-error stream.

- **[P3] L2_init_parse-005** (grok, conc:y, conf:high)  parse_file user-dir override of gamedata not present
  - ref: `reference/src/datafile.c:87-110 (ANGBAND_DIR_USER filename.txt then ANGBAND_DIR_GAMEDATA)`  port: `packages/content/src/compile.ts:29-37 (reads only reference/lib/gamedata/*.txt)`
  - exp: optional per-user <name>.txt in user dir overrides stock gamedata at parse time
  - act: offline compile always uses reference/lib/gamedata only; no runtime user txt overlay

- **[P3] L2_init_parse-006** (grok, conc:y, conf:high)  datafile write/archive and randart file activate/deactivate unported
  - ref: `reference/src/datafile.c:482-697 (write_flags/mods/elements, file_archive, randart_file_exists, activate/deactivate_randart_file)`  port: `NONE as filesystem APIs; packages/core/src/obj/randart.ts regenerates in memory from seed`
  - exp: user/archive dir file moves for randart.txt and flag dump writers
  - act: no archive_user_pfx / file_move path; randarts are seed-derived in memory

- **[P3] L2_init_parse-007** (grok, conc:n, conf:high)  get_parser_error_limit / multi-error parse_file reporting absent
  - ref: `reference/src/parser.c:637-658; reference/src/datafile.c:87-141 (collect first error, log up to PARSE_ERROR_LIMIT=20)`  port: `packages/content/src/records.ts:180-186 (compileGamedata throws on first ParseError)`
  - exp: parse continues after errors up to limit; first error state restored for return
  - act: first bad line aborts the compile with a thrown Error

- **[P3] L2_init_parse-008** (grok, conc:n, conf:high)  bindConstants skips check_critical_levels strictly-increasing validation
  - ref: `reference/src/init.c:987-1025 (finish_parse_constants check_critical_levels)`  port: `packages/core/src/constants.ts:296-323 (bindConstants assigns levels with no cutoff ordering check)`
  - exp: non-strictly-increasing melee/ranged crit cutoffs -> PARSE_ERROR_NON_SEQUENTIAL_RECORDS
  - act: bad cutoffs bind silently; combat would walk a wrong ladder

- **[P3] L2_init_parse-009** (grok, conc:n, conf:high)  critical-level msg strings not resolved via message_lookup_by_name
  - ref: `reference/src/init.c:733-748 (message_lookup_by_name; invalid -> PARSE_ERROR_INVALID_MESSAGE; stores msgt int)`  port: `packages/content pack stores raw "HIT_GOOD" etc; packages/core/src/constants.ts:314 keeps string msg; packages/core/src/combat/hit.ts uses string HitType`
  - exp: parse-time name->MSG_* index; unknown message name fails parse
  - act: raw strings kept; invalid msg names not rejected at bind

- **[P3] L2_init_parse-010** (grok, conc:n, conf:med)  PlayerProperty.bindui typed/stored incorrectly vs finish_parse_player_prop
  - ref: `reference/src/init.c:1292-1332,1351-1414 (bindui linked list; finish expands element templates and bind_player_ability_to_ui_entry_by_name)`  port: `packages/core/src/player/bind.ts:193-199,622-630 (bindui?: boolean; bindui: rec.bindui ?? false); packages/core/src/game/ui-entry.ts:1013-1034 (reads pack JSON object correctly)`
  - exp: structured bindui retained through finish; element rows expanded into player_abilities with per-element UI names
  - act: PlayerProperty.bindui is a boolean type but receives object or false; expansion for UI is only in ui-entry from raw pack; abilities.ts expands for display only

- **[P3] L2_init_parse-001** (terra, conc:y, conf:high)  Runtime user-file override and parser error flow are absent
  - ref: `reference/src/datafile.c:87`  port: `packages/content/src/compile.ts:31`
  - exp: At runtime, parse_file first opens <user>/<filename>.txt, falls back to gamedata, parses line by line, logs up to the configured error limit, and preserves the first parser state.
  - act: Gamedata is compiled to JSON before play from a supplied source directory; there is no runtime user-file fallback, parser-error limit, logging loop, or parser state.

- **[P3] L2_init_parse-002** (terra, conc:y, conf:high)  Datafile archival and randart file movement are absent
  - ref: `reference/src/datafile.c:617`  port: `NONE`
  - exp: The archive prefix, numbered/custom archive moves, and activate/deactivate randart file moves operate between user and archive directories.
  - act: No equivalent archive or filesystem randart-file operations exist.

- **[P3] L2_init_parse-003** (terra, conc:n, conf:high)  Object value integer helpers accept C-rejected boundary values
  - ref: `reference/src/datafile.c:213`  port: `packages/core/src/obj/bind.ts:172`
  - exp: find_value_arg and grab_int_range reject INT_MIN (-2147483648) and INT_MAX (2147483647), as well as values outside the C int range.
  - act: The JavaScript regular-expression helpers accept those boundaries and any exactly represented larger decimal integer.

- **[P3] L2_init_parse-004** (terra, conc:n, conf:high)  Parser hook/state API is not implemented
  - ref: `reference/src/parser.c:99`  port: `packages/content/src/parser.ts:338`
  - exp: A parser owns registered callbacks, parsed typed values, private data, line/column/error state, and invokes the matching hook.
  - act: parseLine is a stateless compiler helper returning a directive and scalar record; it has no hook registration, private data, parser state, or typed random-value result.

- **[P3] L2_init_parse-007** (terra, conc:n, conf:high)  Critical cutoff ordering is never validated
  - ref: `reference/src/init.c:986`  port: `packages/core/src/constants.ts:296`
  - exp: constants finalization rejects melee or ranged critical tables whose non-final cutoffs are not strictly increasing.
  - act: bindConstants copies critical level arrays without any sequential-cutoff check.

- **[P3] L2_init_parse-008** (terra, conc:n, conf:high)  Parsed world map has no runtime implementation
  - ref: `reference/src/init.c:1089`  port: `NONE`
  - exp: world.txt levels are loaded with depth/name/up/down links and finalization rejects references to nonexistent levels.
  - act: world.json is compiled but no package binds, validates, or exposes its records to the running game.

- **[P3] L2_init_parse-009** (terra, conc:n, conf:high)  Parsed hints have no runtime implementation
  - ref: `reference/src/init.c:4336`  port: `NONE`
  - exp: hints.txt is loaded into the global hint list for the game to consume.
  - act: hints.json is compiled but no runtime package loads or exposes it.

---
## L3_data  (grok=0 codex=5 terra=5)
_cross-model overlap on: old_class.txt_

- **[P0] L3_data-002** (codex, conc:n, conf:high)  Quest records are omitted from the live game pack
  - ref: `reference/src/player-quest.c:76-83,157-163,219-224; reference/lib/gamedata/quest.txt:10-18`  port: `packages/web/src/pack.ts:374-418`
  - exp: The C parser loads the Sauron and Morgoth quest records, player birth copies them into quest history, and quest_check can complete the final guardian quest and win the game.
  - act: loadGamePack returns no quest field, so bindCore receives no quest records and produces an empty quest table despite quest.json being compiled.

- **[P0] L3_data-002** (terra, conc:n, conf:high)  Quest data is dropped before game binding
  - ref: `reference/lib/gamedata/quest.txt:10`  port: `packages/web/src/pack.ts:374`
  - exp: The Sauron and Morgoth quest records are bound at game startup, copied to a new player, and allow the Morgoth kill to set total_winner.
  - act: loadGamePack omits quest.json even though CorePack and bindCore support it, so every new player gets an empty quest list.

- **[P2] L3_data-004** (codex, conc:n, conf:high)  Store hints are compiled but never supplied or displayed
  - ref: `reference/src/ui-store.c:120-128,156-158; reference/lib/gamedata/hints.txt:14-88`  port: `packages/web/src/pack.ts:374-418; packages/web/src/shop.ts:197-199`
  - exp: The C store greeting takes a one-in-three branch when hints is loaded, selects a random hint using the upstream RNG, and displays it.
  - act: loadGamePack omits hints, and the shop explicitly skips the hint branch because no hints list is loaded.

- **[P2] L3_data-005** (terra, conc:n, conf:high)  Gameplay hints are compiled but never supplied to shops
  - ref: `reference/lib/gamedata/hints.txt:14`  port: `packages/web/src/shop.ts:1`
  - exp: The parsed hint list is available to the store UI, which can display a random hint as upstream does.
  - act: hints.json is bundled but omitted from loadGamePack; the shop explicitly has no hints list.

- **[P3] L3_data-001** (codex, conc:n, conf:high)  old_class data has no compiled counterpart
  - ref: `reference/lib/gamedata/old_class.txt:1-5`  port: `packages/content/src/specs/index.ts:3-5 (and no packages/content/pack/old_class.json)`
  - exp: The old spellcasting classes remain available as an alternate class.txt-compatible data source, as the file documents.
  - act: The content specs explicitly defer old_class.txt and no compiled pack or manifest entry exists for it.

- **[P3] L3_data-003** (codex, conc:n, conf:high)  Chest trap pack data is bypassed by a hardcoded table
  - ref: `reference/src/obj-chest.c:55-74; reference/lib/gamedata/chest_trap.txt:30-81`  port: `packages/core/src/obj/chest.ts:21-23,58-135; packages/web/src/pack.ts:374-418`
  - exp: C parses chest_trap.txt into the linked chest_traps list, assigning pval order and using those records for trap selection and effects.
  - act: The live chest module hardcodes all seven entries, and loadGamePack never passes chest_trap.json to it.

- **[P3] L3_data-005** (codex, conc:n, conf:high)  World-map records are compiled but unreachable
  - ref: `reference/src/init.c:1087-1119,1122-1176; reference/lib/gamedata/world.txt:6-134`  port: `packages/web/src/pack.ts:374-418`
  - exp: C parses the world records into the linked world map, resolves each up/down name, and validates the referenced levels.
  - act: loadGamePack has no world field and no runtime world-map registry or consumer; world.json is only bundled as an unbound compiled file.

- **[P3] L3_data-001** (terra, conc:n, conf:high)  Retired class data has no compiled counterpart
  - ref: `reference/lib/gamedata/old_class.txt`  port: `NONE`
  - exp: The provided old spellcasting class dataset remains available as an alternate class.txt-compatible data source.
  - act: old_class.txt is deliberately excluded from gamedataSpecs and the core pack manifest.

- **[P3] L3_data-003** (terra, conc:n, conf:high)  Compiled chest-trap records are not the live trap source
  - ref: `reference/lib/gamedata/chest_trap.txt:30`  port: `packages/core/src/obj/chest.ts:58`
  - exp: Chest trap definitions, including their effects and messages, are loaded from chest_trap.txt.
  - act: The seven shipped definitions are duplicated as CHEST_TRAPS and chest_trap.json is never passed through loadGamePack or bound.

- **[P3] L3_data-004** (terra, conc:n, conf:high)  World-map records are compiled but unreachable
  - ref: `reference/lib/gamedata/world.txt`  port: `packages/web/src/pack.ts:374`
  - exp: World level depths, names, and up/down links are loaded for world-level navigation.
  - act: world.json is included in the bundle but loadGamePack and CorePack expose no world-map field or consumer.

---
## L4_objects  (grok=8 codex=0 terra=0)

- **[P1] L4_objects-001** (grok, conc:n, conf:high)  EF_DETECT_TRAPS never identifies chest traps
  - ref: `reference/src/effect-handler-general.c:1356-1373 (scan floor piles for is_trapped_chest, object_see, set obj->known->pval = obj->pval); reference/src/obj-chest.c:444 (CHEST_TRAPPED requires known->pval)`  port: `packages/core/src/game/effect-detect.ts:180-209 (handleDETECT_TRAPS)`
  - exp: Detect Traps walks every object on each scanned grid; for each non-ignored trapped chest whose known pval does not yet match the live pval, the player sees the chest and known->pval is set so trap names and disarm become available.
  - act: Only floor-trap reveal + SQUARE_DTRAP mark. Comment claims "chest-trap identification rides obj knowledge" but there is no chest pile scan and no place to store known chest pval. Detection never teaches chest traps.

- **[P1] L4_objects-002** (grok, conc:n, conf:high)  Chest known pval never tracked; disarm always treats traps as known
  - ref: `reference/src/obj-knowledge.c:1042-1043 (player_know_object never copies pval for chests); reference/src/obj-chest.c:702-707 (disarm requires known->pval); reference/src/obj-desc.c:361-365 (trap name gated on known->pval); reference/src/effect-handler-general.c:1364-1369; reference/src/project-obj.c:365`  port: `packages/core/src/obj/known-object.ts:438-440 (always skips chest pval on shadow); packages/core/src/game/chest.ts:110-112,325-332 (CHEST_TRAPPED / disarm omit known-pval gate); packages/core/src/obj/desc.ts:407-410`
  - exp: Chest trap/lock state is learned only via detect, kill-trap unlock, store, birth, etc., by writing known->pval. Disarm of unknown traps says "I don't see any traps." Names show only once known.
  - act: On-demand shadow never carries chest pval. chestCheck(CHEST_TRAPPED) returns any trapped chest. doCmdDisarmChest skips the known-pval branch and always attempts disarm. Descriptions never show "(gas trap)" etc. for unopened chests (only "(empty)" when pval is 0).

- **[P1] L4_objects-003** (grok, conc:n, conf:high)  pack_overflow not implemented; takeoff/wield can leave pack permanently overfull
  - ref: `reference/src/obj-gear.c:1338-1389 (pack_is_overfull / pack_overflow drops last inven item); reference/src/obj-gear.c:1009-1010 (inven_wield calls pack_overflow after takeoff); reference/src/game-world.c:947`  port: `packages/core/src/game/gear.ts:20-21,387; packages/core/src/game/obj-cmd.ts:191-198,206-216`
  - exp: After takeoff/wield (or end-of-turn notice), if pack_slots_used > pack_size the game disturbs, messages "Your pack overflows!", drops the last inventory item near the player.
  - act: invenTakeoff always pack.push(handle). invenWield takeoff path never calls pack_overflow. Module docs mark overflow DEFERRED. No packOverflow function exists in packages/.

- **[P2] L4_objects-004** (grok, conc:n, conf:high)  Opening an empty chest does not set OBJ_NOTICE_IGNORE
  - ref: `reference/src/obj-chest.c:636-640 (after open, if pval==0 set obj->known->notice |= OBJ_NOTICE_IGNORE); also PN_IGNORE on successful open L633`  port: `packages/core/src/game/chest.ts:241-281 (doCmdOpenChest)`
  - exp: Opened empty chests are marked ignored so floor autoignore/ignore_item_ok treats them as junk.
  - act: doCmdOpenChest never sets obj.notice IGNORE (or known twin notice). Empty opened chests remain non-ignored unless the player manually ignores them.

- **[P2] L4_objects-005** (grok, conc:n, conf:high)  KILL_TRAP unlock does not set known chest pval
  - ref: `reference/src/project-obj.c:355-369 (unlock_chest then obj->known->pval = obj->pval before "Click!")`  port: `packages/core/src/game/project-obj.ts:171-185`
  - exp: Disarm/unlock projection copies live pval into known twin so the chest's open/disarmed state is known.
  - act: unlockChest only; comment acknowledges known->pval reveal but does not store it (and known-object synthesis never exposes chest pval anyway).

- **[P2] L4_objects-008** (grok, conc:n, conf:high)  object_list_collect uses live floor piles gated by known-grid markers, not player-cave object array
  - ref: `reference/src/obj-list.c:156-230 (scan player->cave->objects[i], count from known kind vs live kind)`  port: `packages/core/src/game/obj-list.ts:10-16,83-134`
  - exp: List is built from the player's memorised object array (known twins), with unknown kinds counting as 1 and ignore via ignore_known_item_ok.
  - act: Port walks state.known.objects grid markers and enumerates live state.floor piles (plus null-glyph unknown entries). Documented as knowledge-model reduction. Can list live pile contents that differ from what the known cave would remember (order, multi-object grids, moved items).

- **[P3] L4_objects-006** (grok, conc:n, conf:high)  Runtime chest trap table is hardcoded, not bound from pack chest_trap.json
  - ref: `reference/src/obj-chest.c:53-282 (chest_trap_parser loads chest_trap.txt into chest_traps list; pvals assigned 1,2,4,...)`  port: `packages/core/src/obj/chest.ts:21-24,58-135 (CHEST_TRAPS constant); packages/content/pack/chest_trap.json (compiled data unused by runtime)`
  - exp: Live game uses the parsed gamedata table (moddable via chest_trap.txt / pack).
  - act: Engine uses a hand-copied CHEST_TRAPS array. Stock 4.2.6 values match pack/chest_trap.json (re-derived: names, levels, effects, msgs, destroy/magic), so stock play matches today.

- **[P3] L4_objects-007** (grok, conc:n, conf:med)  object_similar still skips object_is_equipped after gear exists
  - ref: `reference/src/obj-pile.c:399-403 (equipped items never stack)`  port: `packages/core/src/obj/object.ts:884-889`
  - exp: object_similar returns false if either object is equipped.
  - act: Comment says "no player gear yet" and skips the check. Gear is live (game/gear.ts). Callers mostly only merge pack/floor stacks so default paths avoid the bug, but any merge that receives an equipped GameObject would wrongly allow stacking.

---
## L5_monsters  (grok=10 codex=25 terra=0)
_cross-model overlap on: mon-blows.c, mon-attack.c, mon-move.c, mon-msg.c_

- **[P0] L5_monsters-001** (grok, conc:n, conf:high)  Melee timed statuses ignore Free Action / Prot Blind/Conf/Fear / poison resist
  - ref: `reference/src/mon-blows.c:502-556 (melee_effect_timed calls player_inc_timed with check=true); reference/src/mon-blows.c:674-689 (POISON then player_inc_timed TMD_POISONED); reference/src/mon-blows.c:990-1025 (BLIND/CONFUSE/TERRIFY/PARALYZE); reference/src/player-timed.c:923-956 (player_inc_check fail table: OF_FREE_ACT / OF_PROT_BLIND / OF_PROT_CONF / OF_PROT_FEAR / ELEM_POIS)`  port: `packages/core/src/game/mon-side.ts:204-210 (incTimed); packages/core/src/player/timed.ts:379-402 (playerIncTimed: when check true and hooks.incCheck absent, always allows)`
  - exp: Monster melee status application runs player_inc_timed(..., check=true) so Free Action blocks paralysis, Prot Blind/Conf/Fear block those, poison resist / OPP_POIS block poison, with equip_learn / update_smart_learn side effects from player_inc_check.
  - act: makeMonBlowEnv.incTimed calls playerIncTimed with check=true but never supplies hooks.incCheck (or equip_learn / smart-learn hooks). playerIncTimed then treats missing incCheck as always-true. Free Action, Prot Blind/Conf/Fear, and poison resist never stop melee statuses. Hallucination chaos resist likewise skipped for HALLU.

- **[P1] L5_monsters-002** (grok, conc:n, conf:high)  Melee never calls update_smart_learn (player rune learn + birth_ai_learn)
  - ref: `reference/src/mon-blows.c:486 (elemental pure update_smart_learn type); L554 (timed of_flag); L605 (OF_HOLD_LIFE); L689 (ELEM_POIS); L705 (ELEM_DISEN); L1167 (ELEM_CHAOS); reference/src/mon-util.c:788- (update_smart_learn always equip_learn_flag/element then optional mon known_pstate)`  port: `packages/core/src/combat/mon-melee.ts:678-928 (resolveBlowEffectLive); packages/core/src/game/mon-side.ts:140-442 (no updateSmartLearn)`
  - exp: After elemental / timed / exp-drain / disenchant / hallu blows, update_smart_learn teaches the player the corresponding rune and (under birth_ai_learn) updates mon->known_pstate.
  - act: Live melee path never calls updateSmartLearn. Elemental melee does not equip_learn_element; OF_PROT_* / HOLD_LIFE / etc. are not learned from those blows via this path; birth_ai_learn monsters never learn from melee.

- **[P1] L5_monsters-003** (grok, conc:n, conf:high)  monster_attack_monster skips blow effects and armor
  - ref: `reference/src/mon-attack.c:765-901 (monster_attack_monster: full melee_handler_for_blow_effect, test_hit vs t_mon->race->ac, stun critical)`  port: `packages/core/src/game/mon-cmd.ts:71-171`
  - exp: Commanded (or mon-vs-mon) blows run the same RBE handlers as player melee (HURT armor reduce, elemental mon damage, timed mon effects, EAT_ITEM steal from mon, etc.) against target race AC.
  - act: Port only rolls to-hit vs race AC, applies raw dice damage via monTakeHit, then optional mon stun. No adjust_dam_armor, no elemental/status/theft handlers, no lore blow counting, no hit-and-run blink.

- **[P1] L5_monsters-007** (codex, conc:n, conf:high)  Monster-versus-monster blows skip C effect handlers
  - ref: `reference/src/mon-attack.c:798`  port: `packages/core/src/game/mon-cmd.ts:116`
  - exp: monster_attack_monster dispatches melee handlers that apply armor reduction, elemental effects, statuses, theft, stat effects, and effect-specific damage.
  - act: The port sends the raw rolled damage directly to monTakeHit and only handles stun separately.

- **[P1] L5_monsters-008** (codex, conc:n, conf:high)  Monster-versus-monster blow messages and RNG draws are missing
  - ref: `reference/src/mon-blows.c:225`  port: `packages/core/src/game/mon-cmd.ts:116`
  - exp: Each handled monster-target blow calls display_blow_message_vs_monster, including its method action and randint0(num_messages) draw.
  - act: Hit messages are not emitted and the action-message RNG draw is absent.

- **[P1] L5_monsters-017** (codex, conc:n, conf:high)  Taunted monsters ignore the close-in override
  - ref: `reference/src/mon-move.c:232`  port: `packages/core/src/game/monster-turn.ts:437`
  - exp: When TMD_TAUNT is active, get_move_find_range returns after setting min_range to 1.
  - act: getMoveFindRange continues flee, power, and preferred-range calculations.

- **[P1] L5_monsters-018** (codex, conc:n, conf:high)  Shapechanged uniques can be trampled
  - ref: `reference/src/mon-move.c:154`  port: `packages/core/src/game/monster-turn.ts:339`
  - exp: monster_can_kill rejects a unique based on monster_is_unique, including its original race.
  - act: monsterCanKill checks UNIQUE only on the current race.

- **[P1] L5_monsters-019** (codex, conc:n, conf:high)  Trampling bypasses monster deletion cleanup
  - ref: `reference/src/mon-move.c:1360`  port: `packages/core/src/game/monster-turn.ts:1238`
  - exp: Trampling calls delete_monster before swapping, removing group, racial-count, target, command, held-object, and mimic state.
  - act: The port directly nulls the victim slot and square without deletion bookkeeping.

- **[P1] L5_monsters-020** (codex, conc:n, conf:high)  Fear conversion bypasses HOLD rules
  - ref: `reference/src/mon-move.c:1672`  port: `packages/core/src/game/monster-turn.ts:1588`
  - exp: Fear is cleared, then HOLD is increased through mon_inc_timed, applying resistance, minimum duration, MAX stacking, the timer cap, and notification.
  - act: The port directly clears FEAR and adds to HOLD without resistance, minimum duration, cap, or notification.

- **[P1] L5_monsters-021** (codex, conc:n, conf:high)  Monster swaps omit camouflage and visibility updates
  - ref: `reference/src/mon-util.c:566`  port: `packages/core/src/game/context.ts:889`
  - exp: monster_swap updates camouflage awareness, moves mimicked objects, refreshes monster visibility, light, distance, and redraw state.
  - act: monsterSwap only exchanges square occupants and monster grid coordinates.

- **[P2] L5_monsters-004** (grok, conc:n, conf:high)  make_ranged_attack omits lore_update after a cast
  - ref: `reference/src/mon-attack.c:468-484 (after cast: lore spell flags + cast counts, then lore_update)`  port: `packages/core/src/game/mon-ranged.ts:382-390`
  - exp: lore_update re-derives innateFreqKnown / spellFreqKnown once castInnate/castSpell exceeds 50 (and other derived fields).
  - act: lore.spellFlags and cast counters update, but loreUpdate is never called. Spell frequency never becomes "known" from observing casts until some other path calls loreUpdate.

- **[P2] L5_monsters-005** (grok, conc:n, conf:high)  process_monster_timed silently decrements instead of mon_dec_timed
  - ref: `reference/src/mon-move.c:1800-1826 (mon_dec_timed for FAST/SLOW/HOLD/DISEN; STUN/CONF/CHANGED/FEAR with MON_TMD_FLG_NOTIFY); reference/src/mon-timed.c:161-216 (timer->0 emits message_end when NOTIFY)`  port: `packages/core/src/game/monster-turn.ts:1656-1676`
  - exp: Expiry of stun/conf/fear/changed (and related) queues MON_MSG_NOT_DAZED / NOT_CONFUSED / NOT_AFRAID / etc. for obvious monsters; fear reduces by randint1(level/10+1) via mon_dec_timed.
  - act: Timers are written as mTimed[idx] = v-1 (fear: manual subtract). No monDecTimed, no NOTIFY, no end messages ("is no longer stunned/confused/afraid", "speeds up", "can move again", etc.).

- **[P2] L5_monsters-006** (grok, conc:n, conf:high)  Noise-based sleep reduction never messages wake-up
  - ref: `reference/src/mon-move.c:1768-1778 (mon_dec_timed SLEEP with NOTIFY; lore wake/ignore + lore_update)`  port: `packages/core/src/game/monster-turn.ts:1629-1638`
  - exp: Reducing sleep to 0 via noise uses mon_dec_timed(..., NOTIFY) so obvious monsters print "wake[s] up." and lore_update runs.
  - act: Raw mTimed[SLEEP] = next. No wake message on noise wake (aggravate path does msg separately). lore_update not called after wake/ignore counts.

- **[P2] L5_monsters-007** (grok, conc:n, conf:high)  Melee death note uses bare race.name not MDESC_SHOW|MDESC_IND_VIS
  - ref: `reference/src/mon-attack.c:563-564,639 (ddesc = monster_desc MDESC_SHOW|MDESC_IND_VIS); mon-blows.c take_hit(..., context->ddesc)`  port: `packages/core/src/game/mon-side.ts:155 (takeHit(..., mon.race.name, ...))`
  - exp: died_from / death note is "a kobold" / "an orc" / unique full name (forced visible indefinite).
  - act: Bare race.name ("kobold", "Farmer Maggot") without article/grammar from monster_desc.

- **[P2] L5_monsters-008** (grok, conc:n, conf:high)  Protection from evil repel message uses race.name not MDESC_STANDARD
  - ref: `reference/src/mon-attack.c:561,605 (msg("%s is repelled.", m_name) with MDESC_STANDARD)`  port: `packages/core/src/combat/mon-melee.ts:1014 (env?.msg(`${mon.race.name} is repelled.`))`
  - exp: "The kobold is repelled." (capitalized standard name).
  - act: "kobold is repelled." (or uncapitalized unique name as stored).

- **[P2] L5_monsters-009** (grok, conc:n, conf:high)  mon-msg stack/batch/history not ported; multi-mon messages never pluralize
  - ref: `reference/src/mon-msg.c:195-246 (stack_message), 248+ (add_monster_message), 318+ (get_subject count/invisible/offscreen), flush at end of projection`  port: `packages/core/src/game/mon-message.ts:8-13,102-109 (formats one visible count==1 line only; documents batching as deferred)`
  - exp: Same race + same msg_code batches into "3 kobolds die." / shared pain lines; redundant mon+code suppressed via mon_message_hist; death delay ordering.
  - act: Each mon message is formatted singly as it happens. Multi-monster balls/breaths produce N separate singular lines; no hist de-dupe.

- **[P2] L5_monsters-010** (grok, conc:n, conf:high)  Decoy-target cast witness path omitted in monster_can_cast
  - ref: `reference/src/mon-attack.c:123-145 (if target != player, require square_isview on mon, target, or a PROJECT_SHORT path grid)`  port: `packages/core/src/game/mon-ranged.ts:269-301 (monsterCanCast ends after projectable; comment admits witness deferred)`
  - exp: When aiming a decoy out of player view with no visible path grid, the cast is aborted.
  - act: Any projectable path to the decoy allows the cast regardless of player view.

- **[P2] L5_monsters-001** (codex, conc:n, conf:high)  Ranged attacks ignore visibility when marking seen
  - ref: `reference/src/mon-attack.c:400`  port: `packages/core/src/game/mon-ranged.ts:317`
  - exp: seen is true only when the player is not blind and the monster is visible.
  - act: seen defaults to true, and the live installation does not pass a visibility value.

- **[P2] L5_monsters-002** (codex, conc:n, conf:high)  Ranged attacks omit the unseen-target witness gate
  - ref: `reference/src/mon-attack.c:123`  port: `packages/core/src/game/mon-ranged.ts:291`
  - exp: A non-player target is cast at only when the player can see the caster, target, or a path square.
  - act: The port returns after range and projectability checks without testing witness visibility.

- **[P2] L5_monsters-003** (codex, conc:n, conf:high)  Melee smart-learning is absent
  - ref: `reference/src/mon-blows.c:486`  port: `packages/core/src/combat/mon-melee.ts:744`
  - exp: Elemental, timed, disenchant, experience, and related blows call update_smart_learn for the attacker.
  - act: Live melee blow handling applies effects but never updates the attacking monster's learned player resistances.

- **[P2] L5_monsters-004** (codex, conc:n, conf:high)  Monster death cause uses the raw race name
  - ref: `reference/src/mon-attack.c:564`  port: `packages/core/src/game/mon-side.ts:155`
  - exp: take_hit receives monster_desc(mon, MDESC_SHOW | MDESC_IND_VIS), such as the correct indefinite description.
  - act: takeHit receives mon.race.name directly.

- **[P2] L5_monsters-005** (codex, conc:n, conf:high)  Melee disturbance timing and gating differ
  - ref: `reference/src/mon-attack.c:593`  port: `packages/core/src/combat/mon-melee.ts:988`
  - exp: Every successful blow disturbs immediately; a miss disturbs only when its method reports misses.
  - act: The melee driver does not disturb per blow; the caller applies a later visible-in-view end-of-turn gate.

- **[P2] L5_monsters-006** (codex, conc:n, conf:high)  Light-emitting monsters do not advance melee lore when unseen
  - ref: `reference/src/mon-attack.c:569`  port: `packages/core/src/game/monster-turn.ts:1547`
  - exp: Melee lore is analyzed when the monster is visible or its race emits light.
  - act: Lore analysis is gated only by monsterIsVisible(mon).

- **[P2] L5_monsters-009** (codex, conc:n, conf:high)  Monster-versus-monster lore is never analyzed
  - ref: `reference/src/mon-attack.c:872`  port: `packages/core/src/game/mon-cmd.ts:171`
  - exp: Visible or light-emitting attacks increment blow observations and lore_update runs after the attack.
  - act: monsterAttackMonster returns without recording blow observations or updating lore.

- **[P2] L5_monsters-010** (codex, conc:n, conf:high)  Ranged casting does not run lore_update
  - ref: `reference/src/mon-attack.c:468`  port: `packages/core/src/game/mon-ranged.ts:383`
  - exp: After a successful cast, lore_update derives known spell frequencies and other lore from the updated counters.
  - act: The port increments spell flags and cast counters but never calls loreUpdate.

- **[P2] L5_monsters-011** (codex, conc:n, conf:med)  Live monster descriptions default to on-screen
  - ref: `reference/src/mon-desc.c:235`  port: `packages/core/src/mon/desc.ts:107`
  - exp: A visible monster outside the current panel receives the " (offscreen)" suffix.
  - act: panelContains defaults to a function that always returns true, and live callers commonly omit a panel predicate.

- **[P2] L5_monsters-013** (codex, conc:n, conf:high)  Monster timed upkeep omits notification messages
  - ref: `reference/src/mon-move.c:1812`  port: `packages/core/src/game/monster-turn.ts:1656`
  - exp: Timed upkeep decrements use mon_dec_timed with MON_TMD_FLG_NOTIFY for stun, confusion, changed, and fear effects.
  - act: The port directly decrements timers and only performs shape reversion for CHANGED.

- **[P2] L5_monsters-014** (codex, conc:n, conf:high)  Seasonal monsters are disabled in live allocation
  - ref: `reference/src/mon-make.c:251`  port: `packages/core/src/mon/make.ts:182; packages/core/src/session/boot.ts:198`
  - exp: RF_SEASONAL races are eligible during December 24 through December 26.
  - act: The allocation table defaults seasonalAllowed to false, and live constructors omit the option.

- **[P2] L5_monsters-015** (codex, conc:n, conf:high)  Monster message batching and pluralization are missing
  - ref: `reference/src/mon-msg.c:252`  port: `packages/core/src/game/mon-message.ts:102; packages/core/src/game/mon-death.ts:392`
  - exp: add_monster_message queues, stacks, de-duplicates, pluralizes, and displays monster messages with counts and average damage.
  - act: The port formats and emits one visible monster at a time with no queue, stacking, de-duplication, or plural count.

- **[P2] L5_monsters-016** (codex, conc:n, conf:high)  Unique kill sound refinement is missing
  - ref: `reference/src/mon-msg.c:450`  port: `packages/core/src/game/mon-message.ts:152`
  - exp: A MSG_KILL for a unique becomes MSG_KILL_UNIQUE, or MSG_KILL_KING for Morgoth.
  - act: monMessageSoundType returns the repository message type without inspecting the monster race, and no live caller supplies the refinement.

- **[P2] L5_monsters-022** (codex, conc:n, conf:high)  Pain messages omit optional damage amounts
  - ref: `reference/src/mon-msg.c:132`  port: `packages/core/src/game/mon-message.ts:142`
  - exp: message_pain_show_damage appends the damage amount, or an average for stacked messages.
  - act: formatPainMessage returns only the graded pain text and the live message hook never appends damage.

- **[P3] L5_monsters-012** (codex, conc:n, conf:high)  AC knowledge learning occurs at the wrong point
  - ref: `reference/src/mon-attack.c:529`  port: `packages/core/src/combat/mon-melee.ts:204`
  - exp: equip_learn_on_defend runs inside check_hit before each AC test.
  - act: checkHit only performs the RNG hit test; the live caller performs one learning call after the whole attack.

- **[P3] L5_monsters-023** (codex, conc:n, conf:high)  Pushing does not teach body movement flags
  - ref: `reference/src/mon-move.c:1345`  port: `packages/core/src/game/monster-turn.ts:1229`
  - exp: A visible push or trample records RF_KILL_BODY and RF_MOVE_BODY in monster lore.
  - act: The port emits the push message but does not update either lore flag.

- **[P3] L5_monsters-024** (codex, conc:n, conf:high)  Erratic movement does not teach RAND flags
  - ref: `reference/src/mon-move.c:1087`  port: `packages/core/src/game/monster-turn.ts:991`
  - exp: Visible RAND_25 and RAND_50 monsters record the corresponding lore flags while the cumulative chance is calculated.
  - act: The port applies the chances without updating lore.

- **[P3] L5_monsters-025** (codex, conc:n, conf:high)  NEVER_MOVE lore is not recorded after failed movement
  - ref: `reference/src/mon-move.c:1661`  port: `packages/core/src/game/monster-turn.ts:1575`
  - exp: When a visible monster acts despite having no movement option, RF_NEVER_MOVE is learned.
  - act: The port handles the later disturbance gate but does not set RF_NEVER_MOVE.

---
## L6_player  (grok=8 codex=9 terra=0)
_cross-model overlap on: player-util.c, cmd-obj.c, cmd-cave.c, player-path.c, player-calcs.c, player-timed.c_

- **[P1] L6_player-001** (grok, conc:n, conf:high)  player_is_trapsafe ignores OF_TRAP_IMMUNE equipment
  - ref: `reference/src/player-util.c:1073-1078 (player_is_trapsafe: TMD_TRAPSAFE OR player_of_has OF_TRAP_IMMUNE)`  port: `packages/core/src/game/player-path.ts:58-61 (playerIsTrapsafe); also packages/core/src/game/chest.ts:84 (local twin)`
  - exp: Wearing OF_TRAP_IMMUNE (or any source that sets player_state.flags OF_TRAP_IMMUNE) makes the player trapsafe for run_test, find_path forbid_traps, and related path/run decisions.
  - act: Local playerIsTrapsafe only tests timed[TMD.TRAPSAFE] > 0. OF_TRAP_IMMUNE from gear is ignored for running/pathfinding (trap activation in trap.ts can still honor OF via env.playerHasFlag when wired).

- **[P1] L6_player-002** (grok, conc:n, conf:high)  player_can_cast omits no_light
  - ref: `reference/src/player-util.c:1096-1100 (player_can_cast: TMD_BLIND || no_light(p) blocks with "You cannot see!")`  port: `packages/core/src/game/spell-cmd.ts:100-116 (playerCanCast)`
  - exp: Casting (and study, which calls player_can_cast first) fails when the player's own grid is unseen (no light), same message as blindness.
  - act: playerCanCast checks total_spells, TMD_BLIND, and TMD_CONFUSED only. no_light is never evaluated (noLight exists in cave-cmd.ts/chest.ts but is not used here). Web canCast menu only gates on totalSpells > 0.

- **[P1] L6_player-003** (grok, conc:n, conf:high)  Scroll read never enforces player_can_read
  - ref: `reference/src/player-util.c:1166-1196 (player_can_read: blind / no_light / confused / amnesia); player_can_read_prereq used before 'r'`  port: `packages/core/src/game/obj-cmd.ts:1132-1135 ("read" only gated by shape + tvalIsScroll)`
  - exp: Reading a scroll fails with "You can't see anything." / "You have no light to read by." / "You are too confused to read!" / "You can't remember how to read!" under those conditions.
  - act: installObjCommands registers "read" with only playerGetResumeNormalShape + tval filter. No blind, no_light, confused, or amnesia check on the live path.

- **[P1] L6_player-004** (grok, conc:n, conf:high)  TMD_FASTCAST cast costs a full turn, not 3/4 energy
  - ref: `reference/src/cmd-obj.c:1163-1168 (after spell_cast success: if TMD_FASTCAST then energy_use = move_energy * 3 / 4 else move_energy)`  port: `packages/core/src/game/spell-cmd.ts:287-288 (always return state.z.moveEnergy; comment admits FASTCAST deferred)`
  - exp: While FASTCAST is active, a successful cast spends (move_energy * 3) / 4.
  - act: Cast always spends full move_energy regardless of timed[TMD.FASTCAST].

- **[P1] L6_player-005** (grok, conc:n, conf:high)  do_cmd_run does not refuse when confused
  - ref: `reference/src/cmd-cave.c:1380-1381 (do_cmd_run: player_confuse_dir(player, &dir, true) returns without starting run; "You are too confused.")`  port: `packages/core/src/game/player-path.ts:877-879 (runAction -> runStep with no confusion gate); packages/core/src/game/obj-cmd.ts:610-626 (playerConfuseDir has no `too` parameter)`
  - exp: Starting a run while confused always fails with "You are too confused." and spends no energy / does not enter run state.
  - act: Run starts and continues; each step goes through walkAction, which may randomize direction via playerConfuseDir(false semantics) instead of blocking the run.

- **[P1] L6_player-001** (codex, conc:n, conf:high)  player_is_trapsafe ignores OF_TRAP_IMMUNE equipment
  - ref: `reference/src/player-util.c:1073-1078`  port: `packages/core/src/game/player-path.ts:58-61; packages/core/src/game/chest.ts:84`
  - exp: Wearing OF_TRAP_IMMUNE, or any source that sets player_state.flags OF_TRAP_IMMUNE, makes the player trapsafe for run_test, find_path forbid_traps, and related path and run decisions.
  - act: playerIsTrapsafe only tests timed TMD.TRAPSAFE. OF_TRAP_IMMUNE from gear is ignored for running and pathfinding, although trap activation can honor the flag when its environment is wired.

- **[P1] L6_player-002** (codex, conc:n, conf:high)  player_can_cast omits no_light
  - ref: `reference/src/player-util.c:1096-1100`  port: `packages/core/src/game/spell-cmd.ts:100-116`
  - exp: Casting and studying fail with "You cannot see!" when the player is blind or has no light.
  - act: playerCanCast checks total_spells, TMD.BLIND, and TMD.CONFUSED only. no_light is never evaluated.

- **[P1] L6_player-003** (codex, conc:n, conf:high)  scroll read never enforces player_can_read
  - ref: `reference/src/player-util.c:1166-1196`  port: `packages/core/src/game/obj-cmd.ts:1132-1135`
  - exp: Reading a scroll fails under blindness, no light, confusion, or amnesia with the corresponding upstream message.
  - act: The live read command is registered with only the normal-shape and scroll-type checks; it does not call player_can_read.

- **[P1] L6_player-004** (codex, conc:n, conf:high)  TMD_FASTCAST cast costs a full turn, not 3/4 energy
  - ref: `reference/src/cmd-obj.c:1163-1168`  port: `packages/core/src/game/spell-cmd.ts:287-288`
  - exp: A successful cast while TMD_FASTCAST is active spends move_energy * 3 / 4.
  - act: Successful casts always return and spend the full state.z.moveEnergy; the FASTCAST reduction is deferred.

- **[P1] L6_player-005** (codex, conc:n, conf:high)  do_cmd_run does not refuse when confused
  - ref: `reference/src/cmd-cave.c:1380-1381`  port: `packages/core/src/game/player-path.ts:877-879; packages/core/src/game/obj-cmd.ts:610-626`
  - exp: Starting a run while confused prints "You are too confused.", spends no energy, and does not enter run state.
  - act: runAction starts or continues the run without a confusion gate; walkAction can then randomize directions through playerConfuseDir.

- **[P2] L6_player-006** (grok, conc:n, conf:high)  Pathfinder door penalties skip dark-skill and convert_turn_penalty
  - ref: `reference/src/player-path.c:126-155 (convert_turn_penalty via energy_per_move); L161-210 (unlocked PF_SCL then convert; locked uses calc_unlocking_chance(p, 7, cur_light < 1 && !PF_UNLIGHT) then convert)`  port: `packages/core/src/game/player-path.ts:370-377 (lockedPenalty: calcUnlockingChance(state, 7) only); L431 (unlocked = PF_SCL raw); packages/core/src/game/trap.ts:596-609 (calcUnlockingChance has no lock_unseen arg)`
  - exp: In darkness (cur_light < 1 and not PF_UNLIGHT), lock skill is /10 for the path cost; all door/rubble penalties scale when energy_per_move != move_energy (extra moves).
  - act: lockedPenalty never applies the lock_unseen /10; neither unlocked nor locked nor rubble penalties call convert_turn_penalty. Extra-move characters get wrong path costs through doors/rubble.

- **[P2] L6_player-007** (grok, conc:n, conf:high)  weight_remaining never computed for character sheet
  - ref: `reference/src/player-calcs.c:1756-1765 (weight_remaining = 60 * adj_str_wgt[stat_ind STR] - total_weight - 1)`  port: `packages/core/src/game/char-sheet.ts:107,189,400 (weightRemaining optional, defaults 0); packages/web/src/screens.ts:417-439 (charSheetDeps does not supply weightRemaining); packages/core/src/player/calcs.ts has weightLimit only`
  - exp: Char sheet Burden/Overweight columns use live weight_remaining (red when negative).
  - act: No port of weight_remaining; web deps omit it so the sheet always uses 0 (Overweight "0.0 lb", burden color never overweight-red from this field).

- **[P2] L6_player-006** (codex, conc:n, conf:high)  pathfinder penalties skip dark-skill and move-energy scaling
  - ref: `reference/src/player-path.c:125-155,161-210`  port: `packages/core/src/game/player-path.ts:370-391,431-433; packages/core/src/game/trap.ts:596-609`
  - exp: Unlocked-door and rubble penalties pass through convert_turn_penalty; locked doors call calc_unlocking_chance with lock_unseen when cur_light < 1 and PF_UNLIGHT is absent, then also scale the result.
  - act: lockedPenalty has no lock_unseen argument, and unlocked, locked, and rubble penalties are used without convert_turn_penalty.

- **[P2] L6_player-007** (codex, conc:n, conf:high)  weight_remaining is never computed for the character sheet
  - ref: `reference/src/player-calcs.c:1756-1765`  port: `packages/core/src/game/char-sheet.ts:103-107,184-190,400; packages/web/src/screens.ts:417-439`
  - exp: Character-sheet burden uses weight_remaining = 60 * adj_str_wgt[stat_ind STR] - total_weight - 1 and shows the overweight state when it is negative.
  - act: weightRemaining is optional and defaults to 0; the web character-sheet dependencies do not supply it, so the sheet always displays zero and never gets this overweight-red state.

- **[P2] L6_player-009** (codex, conc:n, conf:high)  random birth choices leave the character name at a fixed default
  - ref: `reference/src/player.c:375-381`  port: `packages/web/src/birth.ts:1350-1355,1651-1653`
  - exp: The random birth-choice flow can call player_random_name, producing a 4-to-8 character capitalized Tolkien-style name before confirmation.
  - act: finishRandom explicitly leaves name blank, and confirmation substitutes the fixed name "Adventurer" instead of drawing and capitalizing a random name.

- **[P3] L6_player-008** (grok, conc:n, conf:med)  player_set_timed notify suppression for known temp resists/flags often inert
  - ref: `reference/src/player-timed.c:828-839 (suppress notify when temp_resist already known-immune or oflag_syn already known from non-timed gear)`  port: `packages/core/src/player/timed.ts:309-333 (notifyQueries optional; absent => no suppression)`
  - exp: Gaining a temporary resist the player already knows as immunity (or a timed flag synonym already known from gear) is silent.
  - act: When callers omit hooks.notifyQueries (common; comment cites gap 4.8), messages always fire even when C would silence them.

- **[P3] L6_player-008** (codex, conc:n, conf:med)  known temporary resist and flag notifications are not suppressed by default
  - ref: `reference/src/player-timed.c:828-839`  port: `packages/core/src/player/timed.ts:309-333`
  - exp: Gaining a temporary resistance already known as an immunity, or a timed flag synonym already known from non-timed gear, is silent.
  - act: Notification suppression only runs when callers provide hooks.notifyQueries; common callers omit the hook, so the messages always fire even when the C code would suppress them.

---
## L7_combat  (grok=13 codex=0 terra=0)

- **[P1] L7_combat-001** (grok, conc:n, conf:high)  Off-weapon brands/slays never applied in live melee
  - ref: `reference/src/player-attack.c:786-794 (for j = 2; j < body.count; improve_attack_modifier on slot_object)`  port: `packages/core/src/combat/melee.ts:407-409 (opts.offhand ?? []); packages/core/src/game/player-turn.ts:251-273 (attackMonster never passes offhand); packages/core/src/game/effect-melee.ts:91-103 (playerBlow same)`
  - exp: Brands/slays on equipment slots after weapon and bow (rings, gloves, armor, etc.) compete via improve_attack_modifier and can set the blow brand/slay/verb and damage mult.
  - act: MeleeOptions.offhand is only consumed inside pyAttackReal; no live caller ever supplies it (grep: only defined/used in melee.ts). Only the weapon and temporary brands/slays are considered.

- **[P1] L7_combat-002** (grok, conc:n, conf:high)  Invisible melee targets never get the 50% to-hit penalty
  - ref: `reference/src/player-attack.c:104-109 (chance_of_melee_hit halves when !monster_is_visible); L763 test_hit(chance_of_melee_hit(...))`  port: `packages/core/src/game/player-turn.ts:260 (monVisible: true hardcoded in attackMonster); packages/core/src/game/effect-melee.ts:100 (same); packages/core/src/combat/melee.ts:243-249 (chanceOfMeleeHit implements the half correctly when monVisible is false)`
  - exp: Melee against a non-visible monster uses chance/2 for test_hit (and monsterFled uses visibility).
  - act: Live melee always passes monVisible: true, so invisible monsters are hit at full accuracy. Comment admits "treated as visible".

- **[P1] L7_combat-003** (grok, conc:n, conf:high)  do_cmd_fire / do_cmd_throw never run player_confuse_dir
  - ref: `reference/src/player-attack.c:1349-1352 (do_cmd_fire: after cmd_get_target, player_confuse_dir(..., false)); L1392-1395 (do_cmd_throw same)`  port: `packages/core/src/game/ranged-cmd.ts:191-234 (fire), 279-325 (throw) use args.dir as-is; packages/web/src/main.ts:3065-3087 (aimDir) never confuses`
  - exp: While confused, fire/throw randomize direction 75% of the time (always if dir was 5/"no direction" semantics per player_confuse_dir), emit "You are confused." when the dir changes, and draw the confuse RNG.
  - act: Chosen aim direction is used verbatim; confused players fire and throw accurately with no confuse RNG draw on this path.

- **[P1] L7_combat-004** (grok, conc:n, conf:high)  do_cmd_fire / do_cmd_throw skip player_get_resume_normal_shape
  - ref: `reference/src/player-attack.c:1318-1320 (do_cmd_fire), L1373-1375 (do_cmd_throw): require player_get_resume_normal_shape or abort`  port: `packages/core/src/game/ranged-cmd.ts:191-325 (no playerGetResumeNormalShape); packages/core/src/game/obj-cmd.ts:591-604 (helper exists for other cmds)`
  - exp: A shapechanged player must confirm resume to normal form before firing or throwing; refuse cancels with no energy.
  - act: Fire and throw proceed in any shape with no prompt and no forced resume.

- **[P2] L7_combat-005** (grok, conc:n, conf:high)  Ranged hit never teaches missile/equip/brand-slay knowledge
  - ref: `reference/src/player-attack.c:1137-1140 (missile_learn_on_ranged_attack + equip_learn_on_ranged_attack on hit); L1258-1259 (learn_brand_slay_from_launch in make_ranged_shot); L1299 (learn_brand_slay_from_throw)`  port: `packages/core/src/game/ranged-cmd.ts:126-163 (hit path has mon_take_hit only); missileLearnOnRangedAttack / equipLearnOnRangedAttack / learnBrandSlayFromLaunch / learnBrandSlayFromThrow never called from game/ (only tests / obj knowledge module)`
  - exp: A successful shot/throw learns combat runes on the missile (and equip for shots) and brand/slay runes from the objects involved.
  - act: Ranged combat never invokes those learn helpers on the live path (ranged-cmd comment lists them as DEFERRED).

- **[P2] L7_combat-006** (grok, conc:n, conf:high)  Melee learn-on-attack runs on miss/afraid and ignores real visibility
  - ref: `reference/src/player-attack.c:822-823 (equip_learn_on_melee_attack + learn_brand_slay_from_melee only after a successful hit inside py_attack_real); learn_brand_slay_helper uses monster_is_visible for slays`  port: `packages/core/src/game/player-turn.ts:240-275 (learnBrandSlayFromMelee always before pyAttack with visible: true; equipLearnOnMeleeAttack always after, even if every blow missed or was refused by fear)`
  - exp: Learning runs once per successful blow only; slay runes require a visible monster; afraid early-out does not learn combat runes from the blow path.
  - act: One learn pass always runs per attackMonster (and effect playerBlow) regardless of hit/miss/afraid, and mon is forced visible for slay learning.

- **[P2] L7_combat-007** (grok, conc:n, conf:high)  show_damage never applied to player melee or ranged hit lines
  - ref: `reference/src/player-attack.c:853-860 (melee: dmg_text " (N)" when OPT show_damage); L1168-1179 (ranged same)`  port: `packages/web/src/main.ts:946-967 (onMelee: "You %s %s." with no damage suffix); packages/core/src/game/ranged-cmd.ts:131-133 (ranged hit line has no " (N)"); shield bash alone implements showDamage (melee.ts:615-618)`
  - exp: With show_damage on, hit messages append " (damage)" before the period (and crit flavor on the same C message for melee).
  - act: Player melee (except shield bash) and all ranged hits omit the damage suffix even when the option is set.

- **[P2] L7_combat-008** (grok, conc:n, conf:high)  Ranged hit on non-obvious monster never prints "finds a mark"
  - ref: `reference/src/player-attack.c:1156-1158 (if !visible: "The %s finds a mark.")`  port: `packages/core/src/game/ranged-cmd.ts:126-134 (always "Your %s %s %s." style; monObvious only affects to-hit math)`
  - exp: Hitting a non-obvious monster prints the impersonal finds-a-mark line instead of the named hit verb line.
  - act: Always names the monster and uses the hit verb; comment marks the branch DEFERRED.

- **[P2] L7_combat-009** (grok, conc:n, conf:high)  Ranged crit flavor lines never printed
  - ref: `reference/src/player-attack.c:1033-1038 (ranged_hit_types texts for HIT_GOOD/GREAT/SUPERB); L1174-1176 append flavor on same message`  port: `packages/core/src/game/ranged-cmd.ts:133 (only verb line); no CRIT_FLAVOR for ranged`
  - exp: Good/great/superb missile crits add "It was a good/great/superb hit!" to the hit message.
  - act: makeRangedShot/Throw return the HitType but ranged-cmd never emits the flavor text.

- **[P2] L7_combat-010** (grok, conc:n, conf:high)  Melee crit flavor is a second message, not one line with the hit
  - ref: `reference/src/player-attack.c:856-858 (single msgt: "You %s %s%s. %s" with flavor)`  port: `packages/web/src/main.ts:963-965 (say hit line, then separate say(flavor))`
  - exp: One message: "You hit the kobold. It was a good hit!" (plus optional damage text).
  - act: Two message-log entries: "You hit the kobold." then "It was a good hit!".

- **[P2] L7_combat-011** (grok, conc:n, conf:high)  Target-out-of-range "Fire anyway?" not implemented
  - ref: `reference/src/player-attack.c:1070-1080 (DIR_TARGET + target_okay: if taim > range, get_check "Target out of range by N squares. Fire anyway?")`  port: `packages/core/src/game/ranged-cmd.ts:71-77,82 (uses target/path with no out-of-range confirm)`
  - exp: Aimed fire/throw at a target beyond weapon range prompts; No aborts with no energy/missile consumption.
  - act: Always projects up to range along the path; no prompt, no cancel path.

- **[P2] L7_combat-012** (grok, conc:n, conf:high)  Afraid py_attack_real path does not equip_learn OF_AFRAID
  - ref: `reference/src/player-attack.c:752-755 (player_of_has OF_AFRAID: equip_learn_flag(OF_AFRAID) then refuse blow)`  port: `packages/core/src/combat/melee.ts:371-377 (afraid early return, no learn); packages/core/src/game/player-turn.ts:420-424 (walk obvious path does learn); invisible/tunnel-into-monster uses attackMonster afraid flag only`
  - exp: Any py_attack_real refuse for fear also teaches the OF_AFRAID rune from equipment.
  - act: Only the pre-attack obvious-monster walk gate learns OF_AFRAID; the invisible-monster / attackBlocker path prints fear via onMelee verb "afraid" without equipLearnFlag.

- **[P2] L7_combat-013** (grok, conc:n, conf:med)  O-combat non-crit melee hit messages while C is silent
  - ref: `reference/src/player-attack.c:467-469 (o_critical_melee non-crit sets MSG_SHOOT_HIT); L704-711 melee_hit_types has no MSG_SHOOT_HIT so the message loop prints nothing`  port: `packages/core/src/combat/hit.ts:401 (oCriticalMelee non-crit msg "SHOOT_HIT"); packages/web/src/main.ts:963 (always "You %s %s." on hit)`
  - exp: With birth_percent_damage, a non-critical melee hit leaves msg_type MSG_SHOOT_HIT and produces no "You hit..." line from melee_hit_types.
  - act: Port still prints the normal hit line for every successful blow, including O non-crits.

---
## L8_effects  (grok=11 codex=11 terra=0)
_cross-model overlap on: effects.c, project-mon.c, project.c, effect-handler-attack.c_

- **[P1] L8_effects-001** (grok, conc:n, conf:high)  EF_SELECT never prompts; always random for player origin
  - ref: `reference/src/effects.c:425-460 (EF_SELECT player origin: cmd_get_effect_from_list / get_effect_from_list, choice -2 random only when chosen)`  port: `packages/core/src/effects/interpreter.ts:487-500 (chooseEffect absent => choice=-2 always); packages/core/src/game/obj-cmd.ts:780-801 and packages/core/src/game/spell-cmd.ts:166-183 (attachGameEnv never sets chooseEffect); grep: chooseEffect only wired in interpreter.test.ts`
  - exp: Player-origin EF_SELECT with 2+ sub-effects presents a menu (or abort/random); gamedata uses this for dual-breath devices and activations (object.txt effect:SELECT dice:2; activation.txt many SELECT chains).
  - act: Live EffectContext never injects chooseEffect, so every player SELECT falls back to randint0(choice_count) without a prompt.

- **[P1] L8_effects-002** (grok, conc:n, conf:high)  WEAPON_DAMAGE expression base never bound for object/curse chains
  - ref: `reference/src/effects.c:308-315 (effect_value_base_weapon_damage: damroll(obj->dd,obj->ds)+obj->to_d); curse.txt "treacherous weapon" effect:DAMAGE dice:$B expr:B:WEAPON_DAMAGE:+ 0`  port: `packages/core/src/game/obj-cmd.ts:518-526 (buildObjectEffectChain baseValues only PLAYER_LEVEL/MAX_SIGHT/DUNGEON_LEVEL); packages/core/src/game/curse-tick.ts:77 (uses buildObjectEffectChain); packages/core/src/effects/effect.ts:529-530 (missing provider leaves expression base unset => 0)`
  - exp: Treacherous-weapon curse (and any WEAPON_DAMAGE expr) deals the equipped weapon's rolled base damage each fire.
  - act: Expression base evaluates as 0; the curse's DAMAGE effect deals 0 HP.

- **[P1] L8_effects-003** (grok, conc:n, conf:high)  MONSTER_PERCENT_HP_GONE expression base never bound for player spells
  - ref: `reference/src/effects.c:322-328 (effect_value_base_monster_percent_hp_gone from target_get_monster); class.txt vampire "Curse" dice:$Dd$S expr:S:MONSTER_PERCENT_HP_GONE:+ 50`  port: `packages/core/src/game/obj-cmd.ts:518-526; packages/core/src/game/spell-cmd.ts:161-165 (spellCast uses buildObjectEffectChain without MONSTER_PERCENT_HP_GONE / target)`
  - exp: Curse spell die sides = (target maxhp-hp)*100/maxhp + 50 so wounded monsters take more damage.
  - act: Missing provider => sides evaluate as 0+50 = 50 always; wound-scaling is lost.

- **[P1] L8_effects-004** (grok, conc:n, conf:high)  PLAYER_HP expression base never bound (vampire shape self-damage)
  - ref: `reference/src/effects.c:317-320 (effect_value_base_player_hp); shape.txt vampire effect:DAMAGE dice:$B expr:B:PLAYER_HP:/ 4`  port: `packages/core/src/game/effect-general.ts:793-797 (handleSHAPECHANGE builds chain via buildObjectEffectChain without PLAYER_HP); packages/core/src/game/obj-cmd.ts:518-526`
  - exp: Assuming vampire form deals chp/4 damage to the player (effect-msg "taking vampire form").
  - act: Expression base is 0; transform deals 0 self-damage.

- **[P1] L8_effects-005** (grok, conc:n, conf:high)  PF_CHARM never passed into project_m (nature mage animal boost)
  - ref: `reference/src/project-mon.c:1344-1346 (charm = origin SRC_PLAYER && player_has(PF_CHARM)); L489-491 and status handlers: dam += dam/2 vs RF_ANIMAL when charm; class.txt nature mage player-flags includes CHARM`  port: `packages/core/src/game/effect-attack.ts:80 (playerCastSource only if env.charm !== undefined); packages/core/src/game/obj-cmd.ts:780-801 and spell-cmd.ts:166-183 never set GameEffectEnv.charm; packages/core/src/session/game.ts cast hooks never set charm`
  - exp: Nature-mage player projections boost sleep/confuse/slow/hold/stun/poly vs animals by +50% power.
  - act: charm is always false/undefined on the live cast path; animal boost never applies.

- **[P1] L8_effects-006** (grok, conc:n, conf:high)  PROJ_MON_CLONE multiply_monster hook never wired on live projections
  - ref: `reference/src/project-mon.c project_monster_handler_MON_CLONE (multiply_monster); object.txt "Clone Monster" wand effect:BOLT_STATUS:MON_CLONE`  port: `packages/core/src/mon/project-mon.ts:673-676 (hMonClone calls hooks.multiplyMonster); packages/core/src/game/project-monster.ts:157-159 (forwards hook if present); packages/core/src/session/game.ts:998-1045 (cast.hooks.monster has no multiplyMonster; multiplyMonster only used for ambient breeders ~L1477)`
  - exp: Clone Monster wand/spell/wonder path clones the target via multiply_monster after heal+haste.
  - act: Handler runs heal/haste but multiplyMonster is absent, so no clone is placed.

- **[P1] L8_effects-001** (codex, conc:n, conf:high)  EF_SELECT never presents the player choice
  - ref: `reference/src/effects.c:437-450`  port: `packages/core/src/effects/interpreter.ts:487-500`
  - exp: A player-origin EF_SELECT with multiple sub-effects calls the command/UI chooser, and cancellation returns false; the random choice is used only for an explicit random selection.
  - act: The live port has no chooseEffect injection outside tests, so the no-UI fallback always selects a random sub-effect for player-origin EF_SELECT.

- **[P1] L8_effects-002** (codex, conc:n, conf:high)  ICE damage ignores cold resistance
  - ref: `reference/src/project-player.c:53-57`  port: `packages/core/src/game/project-player.ts:179-191`
  - exp: PROJ_ICE remaps to PROJ_COLD before reading the player's resistance level, so cold resistance, immunity, and vulnerability affect ice damage.
  - act: The port learns using the remapped cold type but reads resLevel with the original ICE type; ICE is outside the elemental range check, so resLevel is forced to zero.

- **[P1] L8_effects-003** (codex, conc:n, conf:high)  PROJECT_STOP does not stop at the active decoy
  - ref: `reference/src/project.c:146-147,215-219`  port: `packages/core/src/world/project.ts:95-113`
  - exp: project_path finds cave->decoy and stops a PROJECT_STOP path when it reaches that decoy after the initial grid.
  - act: The port compares against a permanent (-1,-1) sentinel and never consults the live GameState.decoy.

- **[P1] L8_effects-007** (codex, conc:n, conf:high)  Monster cloning has no live multiply hook
  - ref: `reference/src/project-mon.c:887-901`  port: `packages/core/src/mon/project-mon.ts:673-679`
  - exp: PROJ_MON_CLONE heals and hastens the monster, then calls multiply_monster and reports MON_MSG_SPAWN on a seen successful clone.
  - act: The port calls an optional multiplyMonster hook, but the live session monster hooks do not provide it, so no clone is spawned.

- **[P1] L8_effects-008** (codex, conc:n, conf:high)  Monster polymorph has no live replacement hook
  - ref: `reference/src/project-mon.c:1189-1231`  port: `packages/core/src/game/project-monster.ts:324-356`
  - exp: A failed save is reported, and a successful eligible polymorph replaces the monster with a new race at the same grid.
  - act: The port delegates replacement to an optional polymorph hook, but the live session does not provide it, so every eligible polymorph falls through to the maintain-shape message.

- **[P2] L8_effects-007** (grok, conc:n, conf:high)  EF_CURSE ignores show_damage and pain-with-damage path
  - ref: `reference/src/effect-handler-attack.c:1671-1698 (display_dam builds " dies! (%d)"; message_pain_show_damage when not dead)`  port: `packages/core/src/game/effect-melee.ts:210-229 (effectHit with fixed " dies!"; no show_damage branch; message_pain comment says deferred)`
  - exp: With show_damage on, kill note includes damage and surviving hits use message_pain_show_damage.
  - act: Always " dies!"; pain path is generic monTakeHit without damage display option.

- **[P2] L8_effects-008** (grok, conc:n, conf:high)  Monster-source EF_DAMAGE killer string is bare race name
  - ref: `reference/src/effect-handler-attack.c (monster_desc MDESC_DIED_FROM for SRC_MONSTER killer); project-player.c:848-849 same for projections`  port: `packages/core/src/game/effect-attack.ts:687-691 (killer = mon.race.name); packages/core/src/effects/handlers.ts:77-80 ("a monster" stand-in for base path)`
  - exp: Death cause uses monster_desc grammar ("an orc", "Smeagol", etc.).
  - act: Live monster EF_DAMAGE uses raw race.name (no article/indef); base path uses "a monster".

- **[P2] L8_effects-004** (codex, conc:n, conf:high)  PROJECT_INFO uses live walls instead of believed walls
  - ref: `reference/src/project.c:203-212`  port: `packages/core/src/world/project.ts:101-107`
  - exp: PROJECT_INFO stops on square_isbelievedwall, using the player's remembered terrain for targeting and information paths.
  - act: Both the normal and PROJECT_INFO branches call c.isProjectable, and the port explicitly substitutes the live map for the remembered-wall test.

- **[P2] L8_effects-005** (codex, conc:n, conf:high)  Object projection observes unseen or unknown objects
  - ref: `reference/src/project-obj.c:545-551`  port: `packages/core/src/game/project-obj.ts:193-197`
  - exp: Destruction is obvious only when obj->known, the object is not ignored, and the square is seen.
  - act: The port treats squareIsSeen as both the square visibility and the per-object known test, so a seen square makes an unrecognized object observed.

- **[P2] L8_effects-006** (codex, conc:n, conf:high)  Buried-object discovery ignores item ignore status
  - ref: `reference/src/project-feat.c:114-124`  port: `packages/core/src/game/project-feat.ts:160-179`
  - exp: After rubble creates an object, the buried-object message and obvious flag require the created object to be non-ignored and the square to be seen.
  - act: The port emits the message whenever an object was created on a seen rubble square, without checking state.isIgnored.

- **[P2] L8_effects-009** (codex, conc:n, conf:high)  show_damage monster messages are missing
  - ref: `reference/src/project-mon.c:1111-1158`  port: `packages/core/src/game/project-monster.ts:226-263`
  - exp: When the player attacks and show_damage is enabled, visible monster hit and pain messages use the show-damage variants with the damage amount.
  - act: The port always invokes the ordinary message and messagePain hooks; the live session supplies no show-damage branch for monster projections.

- **[P2] L8_effects-010** (codex, conc:n, conf:high)  Surviving projected monsters are not refreshed
  - ref: `reference/src/project-mon.c:1455-1468`  port: `packages/core/src/game/project-monster.ts:201-203`
  - exp: After projection side effects, a surviving monster runs update_mon and square_light_spot, with recall redraw as required.
  - act: The port makes this an optional onUpdate hook, and the live session does not provide that hook.

- **[P2] L8_effects-011** (codex, conc:n, conf:high)  Monster-origin player damage loses C killer description
  - ref: `reference/src/effect-handler-attack.c:466-491`  port: `packages/core/src/game/effect-attack.ts:687-691`
  - exp: SRC_MONSTER damage builds the killer string with monster_desc(MDESC_DIED_FROM), preserving the upstream article and descriptive qualifiers before take_hit.
  - act: The port passes only mon.race.name, with no monster_desc formatting, and explicitly defers the upstream death-cause description.

- **[P3] L8_effects-009** (grok, conc:n, conf:high)  effect_describe / get_spell_info skip dice_roll RNG draws
  - ref: `reference/src/effects-info.c:344-351 (dice_roll which calls damroll, z-dice.c:579-591) when formatting effect descriptions`  port: `packages/core/src/effects/effect-info.ts:12-25, 519+ (Dice.randomValue / rvAverage; tests assert zero RNG draws)`
  - exp: Inspecting/describing an effect chain advances the game RNG via damroll on dice_roll (upstream quirk).
  - act: Display path never draws RNG (deliberate determinism).

- **[P3] L8_effects-010** (grok, conc:?, conf:high)  PROJECT_INFO / square_isbelievedwall approximated by real map
  - ref: `reference/src/project.c:208-212, 272-276, 331-335 (PROJECT_INFO stops on square_isbelievedwall)`  port: `packages/core/src/world/project.ts:101-107 (INFO branch uses isProjectable on real map; comment DEFERRED); packages/core/src/game/target-loop.ts:38-42 documents same`
  - exp: Targeting/UI path geometry respects player remembered walls.
  - act: Path uses truth map; UI-only path until believed map is complete.

- **[P3] L8_effects-011** (grok, conc:n, conf:med)  project_path decoy stop never matches (no decoy in path geometry)
  - ref: `reference/src/project.c:147, 216-218 (cave_find_decoy; PROJECT_STOP stops on decoy grid)`  port: `packages/core/src/world/project.ts:51-52, 109-112 (NO_DECOY sentinel (-1,-1) never matches)`
  - exp: Bolts with PROJECT_STOP halt on a player decoy grid as on a monster.
  - act: Path geometry ignores decoys; stop only on mon != 0. (Decoy destroy on hit is handled in castProjection onPlayer separately.)

---
## L9_dungeon  (grok=12 codex=17 terra=0)
_cross-model overlap on: trap.c, mon-util.c, generate.c, cave-square.c, cmd-cave.c, cave-view.c_

- **[P1] L9_dungeon-001** (grok, conc:n, conf:high)  Gen-time trap pick/power never runs; trapKinds not wired
  - ref: `reference/src/trap.c:356-394 (place_trap during generation: pick_trap + randcalc power in the gen RNG stream); reference/src/gen-util.c alloc_object TYP_TRAP calls place_trap mid-level`  port: `packages/core/src/session/boot.ts:180-217 (genDeps never sets trapKinds); packages/core/src/gen/util.ts:1177-1179 (without trapKinds only markTrap, no pick/power draws); packages/core/src/session/game.ts:1982-1989 (live generateLevel uses genDeps without traps)`
  - exp: During generation, place_trap draws pick_trap + power into the level RNG stream so later object/monster placement and the final trap kind/power match C.
  - act: Live genDeps omits trapKinds, so gen only records trap grids; no gen-stream pick/power draws. Level content after each trap site diverges from C's RNG stream.

- **[P1] L9_dungeon-002** (grok, conc:n, conf:high)  populateFromLevel re-picks traps; discards Gen.traps
  - ref: `reference/src/trap.c:356-394 (place_trap is the only placer; gen placement is final)`  port: `packages/core/src/session/game.ts:1624-1629 (for trapGrids only: placeTrap(state, grid, -1, ...)); packages/core/src/gen/util.ts:274-279,1196-1197 (Gen.traps holds tidx+power when trapKinds present); packages/core/src/session/game.ts:2043-2054 (passes trapGrids, never g.traps); packages/core/src/game/trap.ts:333-354 (installTrap exists for gen-chosen kind/power)`
  - exp: Kind and power chosen at generation are the live traps; no second pick_trap.
  - act: Populate always calls placeTrap with tIdx=-1, re-drawing pick+power on the play RNG. Even if trapKinds were wired, g.traps would still be ignored.

- **[P1] L9_dungeon-003** (grok, conc:n, conf:high)  TRF_DELAY traps never fire (no player_leaving)
  - ref: `reference/src/mon-util.c:503-515 (player_leaving: hit_trap(grid1, 1) when player leaves a grid); reference/lib/gamedata/trap.txt "block fall trap" flags DELAY; reference/src/trap.c:511-513 (delayed gate)`  port: `packages/core/src/game/trap.ts:686-688 (onPlayerMoved only hitTrap(..., 0) on the NEW grid); packages/core/src/game/player-turn.ts:457-465 (movePlayer then onPlayerMoved(next) only); packages/core/src/game/context.ts:889-899,955-959 (monsterSwap/movePlayer never call hit_trap on the left grid)`
  - exp: DELAY traps (e.g. block fall / ancient mechanism) activate when the player leaves their square, sealing granite behind them.
  - act: Only delayed=0 (enter) is ever invoked on the live step path; DELAY traps never run their effects.

- **[P1] L9_dungeon-004** (grok, conc:n, conf:high)  Trap OF save / TRAP_IMMUNE never consulted on live path
  - ref: `reference/src/trap.c:515-549 (player_is_trapsafe / player_of_has save_flags / OF_TRAP_IMMUNE learn); trap.txt save: lines (e.g. FEATHER for pits)`  port: `packages/core/src/session/game.ts:1343-1350 (trapDeps.env has expGain/msg/changeLevel only; no playerHasFlag, no disturb); packages/core/src/game/trap.ts:419-441 (trapImmune and saveFlags use env.playerHasFlag ?? false)`
  - exp: Trap-immune equipment and trap save flags fully skip or save; equip_learn_flag on those OF flags.
  - act: playerHasFlag is never set; every trap treats OF saves and TRAP_IMMUNE as false (TMD_TRAPSAFE alone still works via timed[]).

- **[P1] L9_dungeon-005** (grok, conc:n, conf:high)  Town terrain not stored/restored without birth_levels_persist
  - ref: `reference/src/generate.c:1369-1373 (non-persist path: always cave_store town terrain when leaving depth 0); reference/src/gen-cave.c:2671-2703 (town_gen reloads chunk_find_name("Town") layout)`  port: `packages/core/src/session/game.ts:1871-2054 (without birth_levels_persist, every depth including 0 fully regenerates); packages/core/src/gen/cave.ts:2555-2558 (documents deferred town re-entry; regenerates every entry)`
  - exp: Default play keeps the same town shop layout/stair grid across visits (terrain-only store via chunk_write); only residents re-roll.
  - act: Leaving and returning to town regenerates a new layout (new store lots, stair position, ruins) every time unless birth_levels_persist is on.

- **[P1] L9_dungeon-006** (grok, conc:n, conf:high)  Live square_set_feat does not destroy traps on non-trappable terrain
  - ref: `reference/src/cave-square.c:1236-1262 (character_dungeon: if !square_player_trap_allowed then square_destroy_trap); reference/src/effect-handler-general.c EF_GRANITE / terrain changes use square_set_feat`  port: `packages/core/src/world/chunk.ts:201-211 (setFeat: feat_count + GLOW only); packages/core/src/game/effect-terrain.ts:235 (handleGRANITE setFeat GRANITE with no trap remove); packages/core/src/game/effect-terrain.ts:469-474 (square_destroy / DESTRUCTION setFeat without trap clear)`
  - exp: Changing a grid to non-trap-holding terrain removes all traps on that grid.
  - act: Traps remain in state.traps on granite/rubble/etc. after terrain effects (block-fall GRANITE, *destruction*, earthquake fills).

- **[P1] L9_dungeon-007** (grok, conc:n, conf:high)  Disarm-on-walk for known disarmable traps missing
  - ref: `reference/src/cmd-cave.c:1058-1083,1311-1312 (move_player(dir, disarm): known disarmable trap + disarm true -> do_cmd_alter_aux / disarm, not step)`  port: `packages/core/src/game/player-turn.ts:472-481 (documents walk/jump share body; disarm-on-walk deferred); packages/core/src/game/cave-cmd.ts:615-618 (disarm-on-walk still on base action); packages/core/src/game/trap.ts:686-688 (any step onto player trap fires hitTrap)`
  - exp: Walking onto a known, enabled player trap auto-disarms (alter) unless trapsafe/jump; jump deliberately steps on.
  - act: Every walk onto a trap triggers it; jump is identical; no alter/disarm branch on walk.

- **[P1] L9_dungeon-008** (grok, conc:n, conf:high)  Standing-in-web walk does not clear the web
  - ref: `reference/src/cmd-cave.c:1288-1297 (do_cmd_walk: if square_iswebbed on player grid, remove web, spend turn, do not move)`  port: `packages/core/src/game/player-turn.ts:382-469 (walkAction never checks web on current grid); packages/core/src/game/cave-cmd.ts:616-617 (web clear noted as still on base action)`
  - exp: Attempting to walk while webbed clears the web and ends the turn in place.
  - act: Player walks out of webs normally; webs only block via other optional predicates.

- **[P1] L9_dungeon-001** (codex, conc:n, conf:high)  Generated traps do not perform C-time kind and power rolls
  - ref: `reference/src/gen-util.c:790-791; reference/src/trap.c:275-394; reference/src/gen-cave.c:821-834`  port: `packages/core/src/session/boot.ts:209-216; packages/core/src/gen/util.ts:1176-1198; packages/core/src/gen/cave.ts:610-615`
  - exp: TYP_TRAP and try_door call place_trap during generation, which consumes the trap-kind and power RNG draws and records the selected trap.
  - act: genDeps supplies no trapKinds, so placeTrap only marks a trap grid and performs no kind or power draw; tryDoor also only calls markTrap and never calls placeTrap.

- **[P1] L9_dungeon-002** (codex, conc:n, conf:high)  Populating a level re-picks and discards generated traps
  - ref: `reference/src/trap.c:356-394; reference/src/gen-cave.c:821-834`  port: `packages/core/src/session/game.ts:1571-1633; packages/core/src/gen/util.ts:1176-1198`
  - exp: The trap kind and power chosen during generation remain attached to the generated level and are materialized without another random selection.
  - act: LevelContent stores only trapGrids; populateFromLevel calls placeTrap for each grid, reusing live RNG and re-picking the trap, while any Gen.traps data is not consumed.

- **[P1] L9_dungeon-003** (codex, conc:n, conf:high)  Delayed traps are never triggered when the player leaves
  - ref: `reference/src/mon-util.c:503-515; reference/src/trap.c:551-604`  port: `packages/core/src/game/player-turn.ts:457-465; packages/core/src/game/trap.ts:685-688; packages/core/src/game/context.ts:889-899`
  - exp: Player movement calls player_leaving on the old grid, and that hook calls hit_trap(old_grid, 1), triggering delayed traps.
  - act: Movement only calls onPlayerMoved for the new grid; its trap callback calls hitTrap on the new grid with mode 0, and monsterSwap has no leaving hook.

- **[P1] L9_dungeon-004** (codex, conc:n, conf:high)  Trap saving throws and trap immunity are not wired to live player state
  - ref: `reference/src/trap.c:515-549`  port: `packages/core/src/game/trap.ts:419-458; packages/core/src/session/game.ts:1329-1351`
  - exp: hit_trap checks trapsafe and OF_TRAP_IMMUNE, then applies save_flags through the player's flags, armor, and saving throw.
  - act: hitTrap queries optional env.playerHasFlag, but the live trap environment provides no playerHasFlag callback and no live trapsafe/save state.

- **[P1] L9_dungeon-005** (codex, conc:n, conf:high)  Town terrain is regenerated instead of persisted
  - ref: `reference/src/generate.c:1347-1373; reference/src/gen-cave.c:2664-2704`  port: `packages/core/src/session/game.ts:1864-2054; packages/core/src/gen/cave.ts:2555-2558`
  - exp: Leaving town stores the current Town chunk, and town_gen reuses that chunk and its stair on return.
  - act: The normal transition uses persist=false and does not cache the town; the generator explicitly regenerates town on each entry.

- **[P1] L9_dungeon-006** (codex, conc:n, conf:high)  Changing terrain does not destroy traps on live squares
  - ref: `reference/src/cave-square.c:1236-1262`  port: `packages/core/src/world/chunk.ts:196-211; packages/core/src/game/effect-terrain.ts:235-235; packages/core/src/game/effect-terrain.ts:469-474`
  - exp: A live square_set_feat on terrain that cannot hold traps calls square_destroy_trap before updating the square.
  - act: Chunk.setFeat updates feature counts and the feature value only; it never removes state.traps when the new terrain is non-trappable.

- **[P1] L9_dungeon-007** (codex, conc:n, conf:high)  Walking onto a known disarmable trap does not enter disarm mode
  - ref: `reference/src/cmd-cave.c:1058-1088`  port: `packages/core/src/game/player-turn.ts:457-481; packages/core/src/game/cave-cmd.ts:615-618`
  - exp: Movement detects a known disarmable trap and routes the action through do_cmd_alter_aux, auto-repeating disarm rather than stepping onto it.
  - act: The port moves to the destination and invokes the new-square trap callback; it has no movement branch that detects a known disarmable trap and disarms it.

- **[P1] L9_dungeon-008** (codex, conc:n, conf:high)  Standing in a web does not clear the web on movement
  - ref: `reference/src/cmd-cave.c:1287-1297`  port: `packages/core/src/game/player-turn.ts:457-465; packages/core/src/game/cave-cmd.ts:615-618`
  - exp: A movement command from a webbed square removes all web traps, spends movement energy, and ends the command.
  - act: The port has no pre-move web check; movement proceeds to the destination and only checks traps on the new square.

- **[P1] L9_dungeon-012** (codex, conc:n, conf:high)  Secret doors are incorrectly treated as strong mineral walls
  - ref: `reference/src/cave-square.c:236-240; reference/src/cave-square.c:278-282; reference/src/cave-square.c:698-700`  port: `packages/core/src/world/chunk.ts:302-305; packages/core/src/gen/util.ts:437-440; packages/content/pack/terrain.json:1`
  - exp: square_isrock excludes any TF_DOOR_ANY feature, so a secret door is not a mineral or strong wall.
  - act: isMineralWall returns true for any granite feature, and the shipped SECRET terrain has GRANITE and DOOR_ANY flags.

- **[P1] L9_dungeon-013** (codex, conc:n, conf:high)  Any glyph trap is treated as a warding glyph
  - ref: `reference/src/cave-square.c:751-755`  port: `packages/core/src/game/trap.ts:154-156; packages/content/pack/trap.json:1`
  - exp: square_iswarded is true only when the specific trap named glyph of warding is present.
  - act: squareIsWarded checks only TRF_GLYPH, and the shipped decoy trap also has the GLYPH flag.

- **[P1] L9_dungeon-014** (codex, conc:n, conf:high)  Removed traps do not stop hitTrap processing
  - ref: `reference/src/trap.c:551-604`  port: `packages/core/src/game/trap.ts:460-493`
  - exp: After each trap effect, C stops if the trap was removed from the square or the player died.
  - act: The port checks only state.isDead; if an effect removed the trap, processing continues through later effects and cleanup using the stale trap instance.

- **[P1] L9_dungeon-015** (codex, conc:n, conf:high)  Live monster light sources are never supplied to view updates
  - ref: `reference/src/cave-view.c:650-719`  port: `packages/core/src/world/view.ts:312-354; packages/web/src/main.ts:4117-4122`
  - exp: calc_lighting scans live non-hidden monsters with race light data and adds their light sources before view calculation.
  - act: The web updateView call always passes an empty sources array, and no live code constructs monster light sources from race data.

- **[P2] L9_dungeon-009** (grok, conc:n, conf:med)  Gen setFeat never clears WALL_INNER/OUTER/SOLID (C does)
  - ref: `reference/src/cave-square.c:1263-1268 (!character_dungeon: square_set_feat offs WALL_INNER/OUTER/SOLID); reference/src/gen-cave.c:742-756 (tunnel piercings use square_set_feat to floor)`  port: `packages/core/src/world/chunk.ts:201-211 (setFeat never clears wall gen flags); packages/core/src/gen/generate.ts:222-233 (clearGenerationFlags only after full builder success)`
  - exp: Any setFeat during generation clears SQUARE_WALL_* flags on that grid immediately.
  - act: Flags stick until end-of-level clearGenerationFlags; mid-gen grids can be floor yet still carry WALL_OUTER if only the flag is tested.

- **[P2] L9_dungeon-010** (grok, conc:n, conf:high)  hit_trap never disturbs (run/rest cancel) on live path
  - ref: `reference/src/trap.c:525-526 (disturb(player) before trap messages/effects)`  port: `packages/core/src/game/trap.ts:431 (env.disturb?.()); packages/core/src/session/game.ts:1343-1350 (trapDeps.env omits disturb though disturb() exists in player-path.ts)`
  - exp: Triggering a trap cancels running/resting/repeating commands.
  - act: disturb hook is never installed for traps; run can continue after setting off a trap unless another path cancels it.

- **[P2] L9_dungeon-009** (codex, conc:n, conf:high)  Generation setFeat does not clear wall-generation square flags
  - ref: `reference/src/cave-square.c:1263-1268`  port: `packages/core/src/world/chunk.ts:196-211; packages/core/src/gen/generate.ts:222-233`
  - exp: During generation, set_feat clears SQUARE_WALL_INNER, SQUARE_WALL_OUTER, and SQUARE_WALL_SOLID immediately when setting a feature.
  - act: Chunk.setFeat never clears those flags; generate.ts performs a later cleanup pass instead.

- **[P2] L9_dungeon-010** (codex, conc:n, conf:high)  Trap disturbance is omitted from the live trap environment
  - ref: `reference/src/trap.c:515-526`  port: `packages/core/src/game/trap.ts:419-431; packages/core/src/session/game.ts:1329-1351`
  - exp: A non-immune player who triggers a trap is disturbed before the trap effect runs.
  - act: hitTrap calls optional env.disturb, but the live trap environment does not provide disturb.

- **[P2] L9_dungeon-016** (codex, conc:n, conf:high)  Blindness does not forget the current non-passable square
  - ref: `reference/src/cave-view.c:889-897`  port: `packages/core/src/world/view.ts:483-510; packages/web/src/main.ts:4120-4122; packages/core/src/game/known.ts:696-710`
  - exp: While blind, update_view forgets the current square if it is known and non-passable before updating the view.
  - act: updateView has no blindness-forget step, and noteSpots retains seen squares without removing that memory.

- **[P2] L9_dungeon-017** (codex, conc:n, conf:high)  Hallucination map rendering is absent
  - ref: `reference/src/cave-map.c:179-187`  port: `packages/web/src/main.ts:4380-4397; packages/web/src/main.ts:4819-4895`
  - exp: During hallucination, an empty map square occasionally displays a random monster or object using the map RNG path.
  - act: The port's map indexes and rendering have no hallucination or TMD_IMAGE branch and render only actual known objects, monsters, and terrain.

- **[P3] L9_dungeon-011** (grok, conc:n, conf:high)  only_partial feeling reveal guard not modelled
  - ref: `reference/src/cave-view.c:849-854 (feeling_need reveal suppressed when p->upkeep->only_partial after fresh level full update)`  port: `packages/core/src/world/view.ts:447-456 (documents only_partial not modelled; feeling event can fire once more on level entry)`
  - exp: Initial FOV after new level does not pop the feeling message via the only_partial guard.
  - act: Feeling signal may fire on the first full view of a new level when feeling_need is reached immediately.

- **[P3] L9_dungeon-012** (grok, conc:n, conf:med)  Chunk object-list / player knowledge cave (cave.c list) is structural reshape
  - ref: `reference/src/cave.c:438-479 (list_object / delist_object oidx tables); reference/src/cave-map.c:459-489 (square_memorize_traps copies to player->cave)`  port: `packages/core/src/game/floor.ts (Map piles); packages/core/src/game/trap.ts:10-16,356-383 (VISIBLE flag stands in for player cave trap memory); packages/core/src/game/known.ts (known feat/object maps)`
  - exp: Dual real/known chunk with oidx-linked object lists and trap mirrors.
  - act: Flat arrays + GameState maps; knowledge is feature/object known maps + VISIBLE on trap instances.

- **[P3] L9_dungeon-011** (codex, conc:n, conf:high)  Feeling messages ignore the only_partial view guard
  - ref: `reference/src/cave-view.c:836-859`  port: `packages/core/src/world/view.ts:440-456; packages/core/src/world/view.ts:470-477`
  - exp: Newly felt terrain produces the feeling message only when upkeep.only_partial is false.
  - act: The port explicitly does not model only_partial and emits the feeling event whenever the feeling count threshold is reached.
