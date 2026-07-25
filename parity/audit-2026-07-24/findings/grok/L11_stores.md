# L11_stores audit (stores/shops — store.c / store.h)
Auditor: grok. Method: re-derivation against reference C (not prior ledgers).
Lane files: reference/src/store.c, reference/src/store.h.
Searched packages/ (excl. node_modules, dist, borg) for real implementors.

### L11_stores-001  Home retrieve is routed through storeBuy and charges gold
sev: P0
concession: n
ref: reference/src/ui-store.c:729-733 (store_purchase pushes CMD_RETRIEVE for FEAT_HOME); reference/src/store.c:1783-1852 (do_cmd_retrieve: no price_item, no au change)
port: packages/core/src/session/game.ts:2525-2528 (buy always calls storeBuy); packages/core/src/store/transact.ts:120-186 (storeBuy always priceItem + player.au -= price); packages/web/src/shop.ts:732-749 (Home Take uses game.buy, then "You bought ... for N gold")
expected: Retrieving from the Home copies the stack into the pack for free (do_cmd_retrieve); no gold, no ORIGIN_STORE stamp, no empty-store restock/shuffle.
actual: Live Home "Take/Buy" calls storeBuy: charges full shop sell price, can refuse with cannot-afford, stamps ORIGIN_STORE, and on emptying the home may one_in_(store_shuffle) + store_maint x10 (maint is a no-op for home but still draws RNG for the shuffle chance). homeRetrieve exists and is unit-tested but is not wired into StartedGame.buy.
why: The Home is paid storage / a gold sink; high-value stashes can be unrecoverable without enough au. Core free-stash path is dead on the play path.
confidence: high

### L11_stores-002  Home stash is routed through storeSell/storeCarry, not home_carry
sev: P0
concession: n
ref: reference/src/ui-store.c:577-581 (Home pushes CMD_STASH); reference/src/store.c:2009-2074 (do_cmd_stash -> home_carry); reference/src/store.c:870-894 (home_carry: OSTACK_PACK merge, accept any object, no value gate, no fuel/timeout rewrite)
port: packages/core/src/session/game.ts:2530-2543 (sell always storeSell); packages/core/src/store/transact.ts:297-353 (sellObject -> storeCarry(..., true)); packages/core/src/store/store.ts:346-399 (storeCarry: object_value_real gate, erase note, reset light fuel / timeouts, OSTACK_STORE merge); packages/web/src/shop.ts:795-811 (Home drop uses game.sell)
expected: Stashing uses home_carry: free, accepts worthless gear, pack-style stacking, no shop maintenance rewrites of fuel/charges.
actual: Live Home drop uses do_cmd_sell economics/path: store_carry rejects value_real <= 0 after gear_object_for_use already detached the stack (item is lost), wipes inscriptions, refills torches/lamps, clears rod timeouts, merges with OSTACK_STORE. homeStash/homeCarry are implemented and tested but not used by StartedGame.sell.
why: Worthless or shop-rejected home drops silently destroy gear; home stacking and item state diverge from C.
confidence: high

### L11_stores-003  Town store init burns an extra owner RNG draw per store
sev: P1
concession: n
ref: reference/src/store.c:340-357 (store_reset: owner starts NULL from store_init zalloc; store_shuffle does one store_choose_owner because while (o == store->owner) with o non-NULL exits); reference/src/store.c:1478-1501
port: packages/core/src/store/store.ts:140-170 (bindStoreRuntime always storeChooseOwner); packages/core/src/store/store.ts:665-671 (storeReset always storeShuffle again until owner identity differs); packages/core/src/store/store.ts:679-690 (createTownStores = bind all + storeReset); packages/core/src/session/game.ts:2133-2142 (live first town visit)
expected: First owner selection is a single randint0(n_owners) per store, then store_maint x10 consumes the same stream for stock.
actual: Each store draws owner once at bind, then store_shuffle draws again until a different owner object is chosen (always at least one more draw; expected ~n/(n-1) with n=4). All subsequent mass_produce / create_random / delete_random draws for initial stock are offset vs C for the same seed.
why: Town shopkeepers and the entire initial stock RNG stream diverge from upstream on every new game.
confidence: high

### L11_stores-004  Shop flavor comments use display Math.random, not the game RNG
sev: P1
concession: n
ref: reference/src/store.c:1717 (do_cmd_buy: one_in_(3) then ONE_OF(comment_accept) on the main RNG before empty-store restock); reference/src/store.c:491-508,1972 (purchase_analyze ONE_OF on main RNG); reference/src/ui-store.c:139-177 (prt_welcome one_in_ / randint draws on main RNG)
port: packages/web/src/shop.ts:180-190 (flavorPick/flavorOneIn = Math.random); packages/web/src/shop.ts:201-217 (prtWelcome); packages/web/src/shop.ts:745-748 (comment_accept after game.buy returns); packages/web/src/shop.ts:818-822 (sale reaction comments)
expected: Welcome, accept, and purchase_analyze lines advance z-rand; comment_accept is drawn inside do_cmd_buy before any empty-store shuffle/maint.
actual: All three use Math.random (zero game-RNG cost). comment_accept is emitted in the shell after storeBuy returns, so when a purchase empties the shop the C order is accept-draw then shuffle/maint, while the port runs shuffle/maint first with no accept draws on state.rng.
why: Any shop visit that prints flavor desyncs the subsequent game RNG stream (and empty-store restock order) from C; not a browser necessity.
confidence: high

### L11_stores-005  Empty-store restock omits shopkeeper retire / new-stock messages
sev: P2
concession: n
ref: reference/src/store.c:1756-1771 (if stock_num==0 after a reducing sale: one_in_(store_shuffle) -> "The shopkeeper retires." + shuffle, else "The shopkeeper brings out some new stock."; then maint x10)
port: packages/core/src/store/transact.ts:176-183 (shuffle chance + maint x10, no messages); packages/web/src/shop.ts:732-750 (only "You bought ... for N gold")
expected: Player sees the retire or new-stock line when a real shop is cleaned out.
actual: Restock still runs; messages are missing.
why: Visible store feedback on a dramatic stock wipe is gone.
confidence: high

### L11_stores-006  Live store_will_buy always treats runes as unknown
sev: P1
concession: n
ref: reference/src/store.c:531-536 (store_will_buy: worthless OK under birth_no_selling only when tval_has_variable_power && !object_runes_known(obj))
port: packages/core/src/session/game.ts:2511-2523 (txnKnow never sets runesKnown); packages/core/src/session/game.ts:2577-2580 (willBuy passes runesKnown=false); packages/core/src/store/transact.ts:312 (storeSell uses know.runesKnown ?? false)
expected: After runes are known, a worthless variable-power item is refused even with birth_no_selling.
actual: Live filter and sell path always pass runesKnown=false, so the no-selling exception stays open forever for those tvals.
why: birth_no_selling shop acceptance diverges once the player has identified the item.
confidence: high

### L11_stores-007  Buy/sell omit the full rune-learn loop
sev: P1
concession: n
ref: reference/src/store.c:1737-1742 (do_cmd_buy: object_flavor_aware then while (!object_fully_known) learn_unknown_rune + player_know_object); reference/src/store.c:1948-1953 (do_cmd_sell: same on the sold stack before gear_object_for_use)
port: packages/core/src/store/transact.ts:166-170,331-335 (only optional objectFlavorAware; comments mark rune loop DEFERRED)
expected: Transacting an item fully teaches every unknown rune on that object (and buy fully IDs the purchased copy).
actual: Flavor may become known; runes are not force-learned on the transaction path.
why: Items bought or sold can remain partially unknown vs C, changing later {??} / ego knowledge / power use.
confidence: high

### L11_stores-008  Maintenance deletes of store artifacts skip history_lose_artifact
sev: P1
concession: n
ref: reference/src/store.c:1090-1092 (store_delete_random: if obj->artifact history_lose_artifact); reference/src/store.c:1306-1310 (black-market cull of non-ok stock: same)
port: packages/core/src/store/store.ts:424-447 (storeDeleteRandom: no history hook); packages/core/src/store/store.ts:580-586 (black market cull: storeDelete only)
expected: When turnover or BM cleanup destroys an artifact the player previously sold into stock, character history records the loss.
actual: Artifact is removed from stock with no onArtifactLost / history_lose_artifact call (sell-reject path does fire onArtifactLost; maintenance does not).
why: Sold-then-turned-over artifacts vanish from history parity (and any UI that surfaces lost arts).
confidence: high

### L11_stores-009  store_will_buy flag-qualified buy rules skip object_flag_is_known
sev: P3
concession: n
ref: reference/src/store.c:549-552 (buy->flag set: require of_has && object_flag_is_known(player, obj, flag))
port: packages/core/src/store/store.ts:234-238 (if buy.flag and obj.flags.has(flag) return true; object_flag_is_known deferred)
expected: Flag-qualified buy entries only accept items the player already knows have that flag.
actual: Any object that merely carries the flag is accepted, even if the flag is unknown to the player.
why: Baseline store.txt uses only bare buy: tval lines (flag 0), so unreached in default data; mods using buy-flag would leak acceptance.
confidence: high

### L11_stores-010  store_carry always uses object_value_real (drops carried-object branch)
sev: P3
concession: n
ref: reference/src/store.c:921-925 (if object_is_carried(player, obj) value = object_value; else object_value_real)
port: packages/core/src/store/store.ts:356-360 (always objectValueReal)
expected: A still-carried object would be valued by apparent object_value when offered to store_carry.
actual: Always real value. Live do_cmd_sell detaches via gear_object_for_use before store_carry, so the carried branch is unused on the normal sell path (same as C in practice for sells).
why: Dead-branch divergence only; no normal-play impact unless a future caller passes a still-carried object.
confidence: med

## MAP L11_stores
reference/src/store.c -> packages/core/src/store/store.ts (maint, stock, will_buy, mass_produce, carry, reset/update/shuffle); packages/core/src/store/price.ts (price_item); packages/core/src/store/transact.ts (do_cmd_buy/sell/retrieve/stash, home_carry, purchase_analyze); packages/core/src/store/bind.ts (init_parse_stores / store_at-by-feat binding); packages/core/src/store/types.ts (struct store/owner/object_buy); packages/core/src/session/game.ts (createTownStores / storeUpdate / live buy-sell wiring); packages/web/src/shop.ts (ui-store presentation over store APIs: find_inven, store_stock_list, comments, runStore); packages/content/src/specs/misc.ts (store.txt FileSpec)
reference/src/store.h -> packages/core/src/store/types.ts; packages/core/src/store/store.ts; packages/core/src/store/price.ts; packages/core/src/store/transact.ts; packages/core/src/store/bind.ts (API surface for structs and exported store_* / do_cmd_*)
