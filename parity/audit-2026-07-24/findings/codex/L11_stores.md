### L11_stores-001  Home take/drop uses commercial buy/sell transactions
sev: P1
concession: n
ref: reference/src/store.c:1783-1852, 2009-2075
port: packages/web/src/shop.ts:732-800; packages/core/src/session/game.ts:2525-2535
expected: At HOME, taking an item runs do_cmd_retrieve with no gold change and dropping an item runs do_cmd_stash with no gold change, using home stock and home_carry.
actual: runStore calls game.buy for a HOME take and game.sell for a HOME drop; those facades route to storeBuy/storeSell, which price the item and debit or credit gold before using commercial store behavior.
why: Every normal home retrieval or stash can charge or award gold and follows the wrong stock path.
confidence: high

### L11_stores-002  Store flavor messages use the wrong RNG stream
sev: P1
concession: n
ref: reference/src/store.c:453-460, 491-507, 1717-1718
port: packages/web/src/shop.ts:189-190, 748, 818-822
expected: The accept roll and purchase_analyze ONE_OF selections consume the game randint stream in the C statement order.
actual: flavorOneIn and flavorPick use Math.random, so the game RNG is not advanced and the chosen comments are not reproducible from the game seed.
why: Store actions produce different random outcomes and leave the deterministic gameplay RNG stream misaligned.
confidence: high

### L11_stores-003  Shop transactions omit known-object and rune-learning updates
sev: P1
concession: n
ref: reference/src/store.c:1731-1742, 1823-1838, 1947-1953
port: packages/core/src/store/transact.ts:159-170, 331-335, 384-396; packages/core/src/store/store.ts:14-16
expected: Buying and selling copy the known object, propagate effects, make flavor aware, and repeatedly learn unknown runes until the object is fully known; home retrieval also copies and charge-splits the known twin.
actual: The port has no obj->known twin, only marks flavor awareness when supplied, and omits the effect propagation and rune-learning loops; home retrieval copies only the live object.
why: Identification, rune knowledge, and subsequent object descriptions or values diverge after ordinary shop transactions.
confidence: high

### L11_stores-004  No-selling buy test hardcodes runes as unknown
sev: P1
concession: n
ref: reference/src/store.c:524-556
port: packages/core/src/session/game.ts:2577-2580; packages/core/src/store/store.ts:222-239
expected: With birth_no_selling, a worthless variable-power item is accepted only when object_runes_known(obj) is false.
actual: The live willBuy path always passes false for runesKnown, so the port accepts the worthless variable-power item even after all of its runes are known.
why: No-selling mode permits sales that C rejects once the item's runes have already been identified.
confidence: high

### L11_stores-005  Store display sorting uses sale price instead of object_value
sev: P2
concession: n
ref: reference/src/store.c:779-807; reference/src/player-calcs.c:939-1003
port: packages/web/src/shop.ts:88-107
expected: store_stock_list repeatedly uses earlier_object with object_value(obj, 1) as the value tiebreaker, including the player's known-state rules for variable-power items.
actual: sortStoreStock supplies game.price(store, obj, false, 1), which uses objectValueReal for the purchase price and can include bonuses the player does not know.
why: Unidentified or partially identified stock can appear in a different order from the C store inventory.
confidence: high

### L11_stores-006  Maintenance drops artifacts without the C history-loss side effect
sev: P1
concession: n
ref: reference/src/store.c:1040-1095, 1300-1313
port: packages/core/src/store/store.ts:425-456, 574-582
expected: store_delete_random and black-market cleanup call history_lose_artifact before deleting an artifact from store stock.
actual: The port deletes the stock object without invoking any artifact-loss callback; only player sale wiring handles artifact found/lost callbacks.
why: An artifact sold into a store and later removed by maintenance disappears without updating artifact history/state.
confidence: high

## MAP L11_stores
reference/src/store.c -> packages/core/src/store/bind.ts, packages/core/src/store/price.ts, packages/core/src/store/store.ts, packages/core/src/store/transact.ts, packages/web/src/shop.ts, packages/core/src/session/game.ts
reference/src/store.h -> packages/core/src/store/types.ts, packages/core/src/store/bind.ts, packages/core/src/store/price.ts, packages/core/src/store/store.ts, packages/core/src/store/transact.ts
