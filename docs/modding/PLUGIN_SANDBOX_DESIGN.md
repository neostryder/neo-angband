# Ordinary plugin Worker sandbox: design and feasibility

Issue #155 asks for a **technical containment boundary** around ordinary mod
`plugin.js` code.  Today there is no such boundary: the loader imports the
module in the renderer and invokes its members with live objects.  Capability
checks on `ModRegistryHost` are useful consent and diagnostics, but are not
containment; a plugin that has `ctx.core`, `ctx.state`, or `ctx.registries` can
reach the same mutable objects without going through a facade.

This document is deliberately a design and feasibility result, not a migration
promise.  Its conclusion is that a Worker runtime is viable on both supported
platforms, and is already proven for the narrower agent API, but **it cannot
transparently sandbox the current ordinary-plugin ABI**.  The current shipped
mods rely on synchronous callbacks and/or direct renderer objects.  A genuine
boundary requires a new, incompatible worker ABI while API 1 remains explicitly
trusted in-process code.

## Decision

Adopt this direction only if the product accepts the following split:

| Runtime | Code entry | What it is for | Technical boundary |
| --- | --- | --- | --- |
| API 1, retained temporarily | existing `plugin.js` | live engine hooks, registry handlers, current DOM plugins | none; explicitly trusted |
| API 2, new | worker-owned module loaded by a host-owned Worker bootstrap | reactive agents, data transforms, host-rendered UI, future declarative extensions | Dedicated Web Worker + structured-clone protocol |

Do not call API 1 capability grants a sandbox.  Do not provide a hidden
``synchronous RPC`` back to live `GameState`, registries, DOM, or core: that
would recreate the missing boundary.  In particular, `Atomics.wait`/shared
memory is not an answer; blocking the renderer while waiting for its Worker
would deadlock the message path, and sharing live memory defeats the goal.

The existing `packages/web/src/agents/sandbox/` implementation is useful
precedent, not a solution for ordinary plugins.  It has a versioned protocol,
serializes the `AgentView`, reconstructs it in a Worker, and turns a returned
plain `AgentCommand` into a host action.  Its one-decision pipeline also shows
how a synchronous controller seam can yield until the next Worker reply.  It
does not transfer `ctx.core`, `ctx.state`, `ctx.registries`, registry handlers,
or DOM access.

## Proposed boundary

### Boot and lifetime

1. The main renderer continues to parse the manifest, resolve dependencies and
   consent, and checks the new worker ABI **before** starting code.
2. It creates one dedicated module Worker per enabled worker plugin.  The
   Worker entry is a host-owned bootstrap, not `plugin.js` itself.  The
   bootstrap receives an opaque, validated entry URL and dynamically imports it
   only after the host protocol is installed.
3. The host sends an `init` snapshot (identity, versions, resolved flags, own
   data, approved immutable content snapshots and capabilities).  Every payload
   must be structured-cloneable, size-limited, schema/version checked and owned
   by the receiver.
4. The Worker sends requests and subscriptions; the host validates its plugin
   id, capability, argument schema, lifecycle state and rate/size limit before
   carrying out a semantic action.  Replies are data, never handles.
5. At reload/disable the host stops new requests, sends `teardown`, waits only a
   bounded period for an acknowledgement, terminates the Worker, then proceeds
   with the existing save/reload path.  The Worker may not veto or delay a save
   indefinitely.

The initial implementation should use explicit request names rather than a
generic ``call core export by string`` RPC.  A generic RPC would quickly grow
back into the entire core namespace, reintroduce capability bypasses, and make
the wire contract impossible to review.

### Important invariant

The host never posts a function, class instance, `GameState`, registry object,
DOM object, canvas, Electron bridge, or transferable `SharedArrayBuffer` to a
plugin.  The browser structured-clone algorithm does not clone functions; the
host must additionally refuse values that merely *look* plain but have a
non-plain prototype.  A Worker can retain copies of snapshots, but cannot
retain a live core reference because none crosses the boundary.

Every write is an intent with a narrow host implementation.  Examples are
`command { code, args }`, `prefs.set { value }`, `panel.patch { ... }`, and a
future `register.declaration { kind, definition }`.  The host applies the
intent, reports success/failure, and owns all live mutation.

## What crosses from `ModPluginContext`

The table covers every current `ctx.*` field in
`packages/web/src/mod-plugin.ts`.  “Async” means a new worker API can use an
ordinary request/reply or push message; it does not mean retaining the current
function identity or return timing.

| Current field | Worker representation | Async/message-based? | Synchronous escape hatch? |
| --- | --- | --- | --- |
| `id`, `api`, `engine`, `flags`, `newCharacter` | cloned immutable init fields | Yes | No |
| `data` | cloned, frozen-by-convention own-record data in init | Yes | No |
| `core` | **Never transfer.** Replace only individually approved semantic operations; pure constants may be copied into a versioned snapshot. | Only after an API redesign | No. A core namespace is the thing being protected. |
| `state` | purpose-specific read snapshots and semantic command/debug intents | Yes for reactive use | No. A live state reference nullifies isolation. |
| `registries` | versioned read-only record/value snapshots or constrained indexed queries | Yes, with cache/invalidation versions | No. Bound registry instances carry mutators and callbacks. |
| `composedRecords` | cloned immutable composed JSON snapshot, or a paged/query protocol for size | Yes | No |
| `authoring` | bundle the public, pure SDK implementation with the Worker bootstrap; pass data explicitly | Yes | No; it needs no host identity. |
| `assetUrl` | `asset.read(path)` reply with validated own-asset bytes (or a host-minted, own-asset-only URL where necessary) | Already async | No direct shell/file handle. |
| `prefs` | async `prefs.get`/`prefs.set`; optional init cache; `onSave` becomes a host-to-worker event subscription | Yes | No. API 1's synchronous `get()` is a compatibility break, not a reason to leak storage. |
| `display` | cloned display snapshots and host-to-worker input/layout events | Yes | No DOM/canvas object may cross. |
| `log` | bounded fire-and-forget `log` message | Yes | No |
| `backupFolder` | capability-checked semantic `choose`, `write`, `forget`, and save-delivery requests, all mediated by the host | Yes | No OS/file-system handle. |
| `ui` | declarative panel tree/patch/event protocol. The host owns the panel, ShadowRoot, focus and Escape behavior. | Yes | No `ShadowRoot`, `HTMLElement`, or event object. |
| `installMod`, `reloadGame`, `loadModForSession` | same promise-shaped host RPCs with byte and archive limits | Yes | No |
| `debug`, `wizard` | capability-checked semantic RPCs; the host owns confirmation and irreversible sandboxing of a save | Yes | No live debug facade. |

`assetUrl` deserves care.  A Worker can normally use `fetch`, so handing it a
same-origin URL is broader than a file read unless the server and CSP restrict
it to that mod's own assets.  Prefer bytes for the first worker ABI.  If URL
use is necessary for images/audio, mint an opaque per-worker URL and revoke it
on teardown rather than exposing a general `/mods` or game route.

## Plugin members and registry host

### Current `ModPlugin` members

| Member | What API 1 does | Worker-ABI shape | Result for compatibility |
| --- | --- | --- | --- |
| `hooks(ctx)` | returns arbitrary functions synchronously consulted throughout core, often with live state/RNG | no general equivalent.  A new declarative policy DSL or explicitly asynchronous event stream can cover only selected cases | Cannot migrate unchanged; no safe synchronous escape hatch. |
| `register(host, ctx)` | installs arbitrary function callbacks into live registries | declarations may install only host-owned, serializable behavior.  A later event protocol can cover reactive registrations where core can yield. | Cannot migrate arbitrary API-1 registrations unchanged. |
| `migrateBag(data, from, ctx)` | synchronous pure-looking return before registration | host sends plain data and awaits a cloned result before boot continues | Yes, with a `Promise` return in API 2; no known shipped mod currently uses it. |
| `controller(ctx)` | returns a synchronous `AgentController` | reuse the existing perceive/act snapshot protocol and pending-decision pump | Yes in principle, but its initialization must stop using direct core/state/registries. |
| `frontend(ctx)` | returns a main-thread `WorldFrameSink` | Worker consumes frame snapshots and returns display lists or `ImageBitmap`; host performs DOM/canvas mounting and input ownership | API break; needs latency/fallback design. |
| `hud(ctx)` | returns synchronous per-region sinks | same display-list/bitmap protocol, per host-owned region | API break. |
| `menu(ctx)` | returns a presenter that chooses questions | request/response protocol; acceptable only where the menu runtime can await a reply | API break; no raw event/DOM access. |
| `screen(ctx)` | returns a presenter that shows a screen and resolves dismissal | request/response protocol with host-owned overlay | API break. |
| `regions(ctx)` | returns declarations with paint callbacks | serializable layout declarations plus asynchronous frame updates/display lists | API break. |
| `uninstall()` | synchronous main-thread cleanup | bounded asynchronous teardown notification then forced termination | Yes semantically, but DOM cleanup becomes host ownership. |

`hooks` is the decisive limitation.  An arbitrary hook is executable code called
inside an engine operation that may need the current object, chunk, player and
RNG *now*.  A Worker round trip returns later.  Keeping the hook on the main
thread is a trusted synchronous escape hatch, but it means the plugin is not
sandboxed.  It must remain API 1 or be replaced by a deliberately smaller host
feature.

The same is true of a handler registered through
`packages/core/src/mod/registry-host.ts`.  The host exposes `effects`, `rooms`,
`profiles`, `blows`, `stores`, `commands`, `monsters`, `projections`, `uiEntry`,
`glyphs`, `effectInfo`, `randart`, `tval`, `rune`, `vocab`, `messages`, `menus`,
and `tiles`.  Their registrations are not just data:

- `effects`, `rooms`, `profiles`, `blows`, `stores`, `commands`, `monsters`,
  `projections`, `uiEntry`, `glyphs`, `effectInfo`, `randart`, `tval`, and
  `rune` install synchronous handlers which may read/mutate live game objects
  and, in several cases, consume RNG.  They cannot cross as functions.
- `menus` has a synchronous transformer in the present API.  A worker-friendly
  replacement is possible only as a new async menu-presenter protocol, not by
  forwarding the existing transformer.
- `tiles.register` and `tiles.player` receive mutable fill/render callbacks;
  they can perhaps be replaced by precomputed asset declarations or
  double-buffered Worker rendering, but not carried across unchanged or used
  for a same-frame decision.
- `vocab` and parts of `messages` are closest to serializable declarations.
  They are good candidates for a first *real* worker registration feature, but
  only after the host defines validation and ownership semantics.  They do not
  establish a path for the live callback registries.

## Shipped-mod audit

The audited entry files were the current `plugin.ts`/`plugin.js` in all seven
sibling mod repositories: `neo-angband-mod-borg`, `-bug-fixes`, `-qol`,
`-linoleum`, `-feature-restoration`, `-forge`, and `-upstream-catchup`.  This is
an audit of real installed code, not only of the type declarations.

| Mod | Actual use | Can it move to a Worker without functionality loss today? |
| --- | --- | --- |
| Borg | `controller()` calls `bindCore(ctx.core)`, captures `ctx.registries` (races, objects, blow methods/spells) and `ctx.state` (shop/awareness/player) to make its controller. | **No, not unchanged.** The existing perceive/act transport proves the command loop, but agent snapshots must gain the static monster/object facts and shop/awareness information that Borg currently reads directly.  Then Borg itself must be refactored not to bind live core.  This is feasible research work, not a transparent migration. |
| bug-fixes | `hooks()` returns synchronous history, message, save, object-order, artifact, stack, overflow, and level-generation callbacks; some call `ctx.core` helpers. | **No.** These are the exact arbitrary synchronous hook case.  A worker would answer after core needs the result.  Preserving them requires trusted API 1 or a separate core-owned declarative fix feature for each class. |
| QoL | `hooks()` calls live core (`movementTunnelTest`, `tunnelAux`, `OptionState`, policy setters) and returns synchronous hooks; `register()` mutates live options; it installs raw `document`/`window` keyboard/pointer listeners, queries canvases, reads `ctx.display` and `ctx.state`, and returns HUD output; `uninstall()` removes listeners. | **No.** Workers have no `document`, `window`, `HTMLElement`, canvas DOM, or synchronous hook access.  A host-owned overlay/input/render protocol could reproduce some UI eventually, but the current raw-DOM implementation cannot cross. |
| linoleum | `register()` stores `ctx.state`/`ctx.registries`-derived data and installs `host.tiles.register(fill => ...)` plus `host.tiles.player(view => ...)`. | **No.** Both are synchronous tile callbacks over a live/mutable fill surface.  Precompute-plus-declaration could be designed, but it is a new rendering/tile ABI and may not preserve per-frame shape changes without a new data stream. |
| feature-restoration | `register()` installs a synchronous store discount RNG handler and a `feature-restoration:spike` command handler that closes over `ctx.core` and mutates/reads live state, chunk, gear, and messages. | **No.** This is a direct live-engine callback and RNG boundary.  A Worker reply cannot safely run in the command/roll it is handling. |
| forge | `regions()` paints a text-grid tab through a synchronous `place`/`paint`/`input` triple, and its `input` handler calls `openWorkshop(ctx, doc)` against a live `document` to open a full DOM overlay. | **No.** The tab geometry alone could become a declaration, but the workshop overlay is exactly the raw-DOM case: no `Document` crosses a Worker boundary. |
| upstream-catchup | `hooks()` returns synchronous callbacks over the same `HooksCtx` shape as bug-fixes; `register()` installs `host.tiles.register(fill => applyCatchupTiles(fill, ctx.registries, ctx.core))`, a live tile-fill callback closing over both registries and core. | **No.** Same synchronous-hook and live-tile-callback cases as bug-fixes and linoleum above. |

Therefore no existing shipped mod can be moved unchanged. This is a blocker for
any plan whose premise is "move all ordinary plugins to Workers while preserving
API 1." It is not a blocker for the deliberately redesigned, full-cutover ABI
specified below. The migration must replace each live callback with a bounded
host operation, policy, snapshot, or declarative UI contract; it must not retain
an API-1 escape hatch for the difficult mods.

## Full API-2 surface: closing the API-1 gap

This section is the full-cutover design. It preserves the shipped decisions:
one Worker per plugin, structured-clone data only, capability-gated host
operations, the event/model protocol, declarative panels, and `command.submit`.
It does not make a Worker call a live function synchronously. "Resolved" below
means that the replacement can carry every shipped mod to API 2; it never means
that an API-1 callback is passed through.

### Protocol additions and rules

The existing `protocol.ts` messages remain the base. The following names are
wire shapes, not TypeScript implementations. Every request has the existing
`protocolVersion`, `pluginId`, and `requestId`; every reply uses the existing
success/error envelope. Payloads are cloned, schema-checked, size-limited, and
capability-gated on the host.

* `query.snapshot { domain, revision?, selector }` returns a named, versioned,
  immutable record snapshot. `domain` is an allow-listed domain, never an export
  name. A reply includes `{ revision, data }`; the host emits
  `event.snapshotInvalidated { domain, revision }` when the data can change.
* `policy.install { policy, revision, body }` installs validated data into a
  host cache. The host, not the Worker, evaluates it in a synchronous comparator,
  renderer, RNG roll, or turn path. A later installation replaces only that
  plugin's policy and is applied in normal load order.
* `hook.request { hook, sequence, input }` and
  `hook.result { sequence, decision, patch? }` are a serial async decision.
  The host sends requests to participating plugins in load order and applies the
  existing fold rule after each answer. Input is a purpose-built snapshot; a
  patch is a validated declarative operation, never an object mutation.
* `registry.declare { kind, id, definition }` is a serializable content or
  command declaration. `registry.revoke { kind, id }` is its teardown inverse.
  The host validates the kind-specific schema and owns the live registry.
* `ui.region.declare { id, layer, placement, inputActions }` and
  `ui.region.patch { id, cells, visible? }` replace region callbacks. `cells`
  is a bounded display list of text cells and styles. The host retains the last
  accepted patch and paints that cache synchronously every frame.

Requests that affect a save or command are ordered with the owning game action.
A timed-out request has the old faithful neutral answer, reports the fault, and
does not leave a half-applied action. A Worker never chooses host object handles
except where a snapshot explicitly exposes a stable numeric handle and the host
validates that it is still eligible.

### Category A: reads and ordinary context

| API-1 capability | Resolved via | API-2 shape and verified scope |
| --- | --- | --- |
| `ctx.core` | Query snapshots plus semantic intents | `query.snapshot { domain: "engine.facts", selector }` exposes only documented constants and facts, and `command.submit` or a named intent performs a write. QoL's `movementTunnelTest` and `tunnelAux` become the `walk.blocked` host operation below; Borg stops binding the core namespace. There is no `core.call` message. |
| `ctx.registries` | Versioned, cached query snapshot | `query.snapshot { domain: "content.borg-v1" }` returns Borg's exact static needs in one batch: monster `ridx`, flags, level, sleep, spell power/frequencies, friend presence, blow dice/effect names, spell ordinals and messages; object/ego/artifact activation names; and blow-method messages. It is invalidated only on content composition or reload, not per monster considered. Linoleum and catchup receive `content.tiles-v1` records instead. |
| `ctx.composedRecords` | Paged query snapshot | `query.snapshot { domain: "content.records-v1", selector: { packFile?, cursor?, fields? } }` returns cloned JSON records and a content revision. This is sufficient for Forge's peer and field work without exposing bound registries. |
| `ctx.authoring` | Needs its own follow-up design pass | Forge uses a large public SDK, complete composed records, editable drafts, install/session-load/reload, and wizard testing. Pure SDK code could be bundled with the Worker, but its public versioning, generated documentation, record paging, and interactive editor model need one dedicated Forge API-2 design before its port. This is a named migration blocker, not a reason to retain API 1. |
| `ctx.state` | Push snapshots and semantic intents | Expand `event.subscribe` with capability-scoped models such as `state.player-v1`, `state.options-v1`, `state.map-hover-v1`, `state.shape-v1`, and `state.shop-v1`. Borg's shop/awareness facts join its controller model; QoL gets only the option/map fields it needs. No snapshot has methods or mutable arrays. |
| `ctx.flags`, `ctx.newCharacter`, `ctx.data`, `ctx.id`, `ctx.api`, `ctx.engine` | Existing immutable init snapshot | Keep them in `WorkerInitSnapshot`, with schema/versioned `data`. They are already clone-safe. |
| `ctx.prefs` | Existing async request/reply | Keep `prefs.get` and `prefs.set`; add `event.prefsSaved` only if a port needs the API-1 save notification. QoL's boot restore awaits `prefs.get`; its options event awaits a read-modify-write or uses a host `prefs.update` compare-and-set. |
| `ctx.log` | Existing message | Keep bounded `log`. All seven mods that log need no live context. |

The Borg inspection changes an earlier broad claim: its danger resolver is not
only a per-monster registry lookup. It also builds message tables from blow
methods and monster spells, resolves activation identity through object, ego,
and artifact records, and reads the shop entrance and awareness state. The
single cached `content.borg-v1` snapshot plus dynamic controller/state models is
therefore required; sending just monster races would be incomplete.

### Category B: registry and content overrides

| API-1 facade | Resolved via | API-2 declaration or policy |
| --- | --- | --- |
| `effects`, `rooms`, `profiles`, `blows`, `projections`, `uiEntry`, `glyphs`, `effectInfo`, `randart`, `tval`, `rune` | Dedicated declarative schemas are required; no shipped caller | Use `registry.declare { kind, id, definition }` only for definitions that the host can validate and execute itself. The current facades accept synchronous handlers, so a generic replacement would recreate API 1 and is rejected. Each kind needs a follow-up schema before API-2 promises that kind to third parties. The audit found no real call site in the seven shipped mods. |
| `vocab`, `messages` | Declarative registration | `registry.declare { kind: "vocab" or "messages", id, definition }` contains namespaced terms, values, and static templates only. The host owns lookup and persistence. No shipped mod currently uses either facade. |
| `menus` | Declarative action plus async presenter | `registry.declare { kind: "menu.action", id, label, commandCode }` adds a host-owned row; `menu.present` events and `menu.answer` replies cover prompts the host can await. Existing synchronous transformers do not cross. No shipped mod uses it. |
| `stores.setDiscountRoll` | Precomputed policy/table | `policy.install { policy: "store.discount-v1", body: { minimumCost: 5, rolls: [{ oneIn: 25, percent: 10 }, { oneIn: 50, percent: 25 }, { oneIn: 150, percent: 50 }, { oneIn: 300, percent: 75 }, { oneIn: 500, percent: 90 }] } }`. The host draws RNG and applies the table synchronously. This exactly covers feature-restoration's rule. |
| `commands.register` and `commands.setVerb` | Async command invocation | `registry.declare { kind: "command", id, verb, input: { direction: true }, intentCodes: ["door.spike-v1"] }` installs a host parser. On use, `command.invoke { id, input, state: CommandSnapshot }` goes to the Worker and the Worker returns `command.intent { code: "door.spike-v1", direction }`. The host alone checks spikes, confusion, blockers, door lock, energy, messages, and gear consumption. This is a discrete player action, so an async answer is acceptable. |
| `monsters.setTurnHook` | Precomputed policy/table, if the seam is retained | `policy.install { policy: "monster.turn-v1", body }` may contain only host-defined predicates and outcomes over a published monster-turn snapshot. A future request for arbitrary per-turn code needs its own schema; no shipped mod calls this hook today. |
| `tiles.register` | Precomputed tile assignment table | The host sends `tile.fill.request { pack, contentRevision, unassignedMonsterIds, unassignedObjectIds }`. The Worker computes once from `content.tiles-v1` and replies `tile.assignments { monsters, objects }`; the host accepts only blank, in-range assignments. This covers both Linoleum's kin fill and upstream-catchup's fill without a mutable `TileFill`. |
| `tiles.player` | Push-on-change plus host cache | `event.subscribe("state.shape-v1")` provides shape, class, race, and palette revision. The Worker sends `tile.player.set { tile: TileId | null, inputRevision }` whenever that state or its precomputed shape table changes. The renderer reads the cached tile synchronously on every repaint. Linoleum's provider is a table lookup, not a computation that needs a round trip per frame. |

### Category C: `ModHooks`

| Hook | Resolved via | API-2 shape |
| --- | --- | --- |
| `walkBlockedByDiggable` | Real async request/response | `hook.request { hook: "walk.blocked", input: { grid, canTunnel, moveEnergy } }` returns `decline` or `handle: "tunnel"`. On `tunnel`, the host performs its own one tunnel attempt and spends the supplied energy. This preserves QoL's check-before-RNG ordering without exposing `CaveCmdDeps`. |
| `objectListTiebreak` | Precomputed policy/table | `policy.install { policy: "object-list.order-v1", body: { keys: ["dy", "dx"] } }`. The host compares these scalar fields inside `Array.sort`; no async comparator exists. This covers bug-fixes' strict geometric order. |
| `projectionRadius` | Real async request/response | `hook.request { hook: "projection.radius", input: { radius, maxRange } }` returns `{ radius }`; the host range-validates it before geometry. The shipped clamp is tiny, but this follows the approved discrete-event pattern and preserves chained load order. |
| `levelGenerated` | Real async request/response plus validated patch | `hook.request { hook: "level.generated", input: LevelGenerationSnapshot }` may return `accept`, `reject`, or `patch: { addStair: { kind, at } }`. The snapshot includes walkability, stair locations, player spot, no-stair cells, adjacent-wall counts, and quest facts. The host validates the location and calls its own stair placement primitive. This covers the bug-fixes repair, which only chooses a deterministic replacement stair. |
| `artifactCommit` | Real async request/response | `hook.request { hook: "artifact.commit", input: { artifactIndex, alreadyCreated } }` returns `allow` or `deny`. This is RNG-free and exactly covers the shipped duplicate guard. |
| `partialStackMerge` | Real async request/response | `hook.request { hook: "stack.partialMerge", input: { drained: { number, maxStack }, receiving: { number, maxStack } } }` returns `allow` or `deny`. No `GameObject` crosses. |
| `packOverflowVictim` | Real async request/response | `hook.request { hook: "pack.overflowVictim", input: { orderedHandles, departedQuiver } }` returns `{ handle }` or `decline`; the host verifies that the handle is still in the pack. |
| `historyAdd` | Real async request/response | `hook.request { hook: "history.add", input: { what, type, duplicate, rawUserInput? } }` returns `{ accept, what?, expandUserInput? }`. The host owns immutable type/duplicate facts and persists only the approved rewritten fields. |
| `historyDisplay` | Async batch presentation | `hook.request { hook: "history.display", input: { entries, playerName } }` returns a same-length text list. History screen and dump presentation already have asynchronous control flow available; saved entries are not changed. |
| `saveNoiseScent` | Precomputed policy | `policy.install { policy: "save.include-v1", body: { noiseScent: true } }` is read synchronously by serialization. This covers the shipped constant-true hook. |
| `shapeLearnObviousFlagsDirectly` | Precomputed policy | `policy.install { policy: "shape.learn-v1", body: { obviousFlagsDirectly: true } }` lets the host perform its existing bounded operation synchronously. |
| `levelRevisited` | Precomputed policy plus host operation | `policy.install { policy: "level.revisit-v1", body: { clearNoise: true, ageScent: true } }`. The host applies the known uint16-safe update from frozen and current turns. This covers upstream-catchup's constant rule and avoids copying typed arrays to a Worker. |
| `messageText` | Queue-and-flush for general transforms; policy for the shipped mod | `message.transform.request { sequence, raw, type }` and ordered `message.transform.result { sequence, text }` hold messages until they can be committed in order to both `state.messages.add(text, code)` and the display/event sink. Before serialization, `flushMessageTransforms()` awaits all earlier sequences, then serialization reads the log. Bug-fixes' actual `miscStringFix` is an exact-match table, so it should instead install `policy.install { policy: "message.rewrite-v1", body: { exact: [...] } }`; that removes latency for the shipped port while retaining the generic queue design for a future transform. |
| `optionsChanged` | Async event | `event.optionsChanged { snapshot }` has no return value. QoL persists its filtered settings through asynchronous prefs calls. |
| `abilityGained` | Async event plus declarative UI/keymap requests | Keep the already-shipped event form and let QoL open a host-owned form and submit a keymap bind after the event. |

The save inspection found a hard qualification to the `messageText` design. The
current `persistSave()` directly calls `saveGame(game)` synchronously, is invoked
from autosave, level and menu paths, and is also called from `beforeunload`.
There is not currently a clean await point. Before API 2 enables a general
message transform, all normal save callers must route through an async save
coordinator that flushes first. `beforeunload` cannot reliably await a Worker;
the follow-up must choose and document its bounded fallback (for example, flush
earlier on visibility change and save only finalized messages on forced unload).
The shipped exact-match policy avoids this limitation, but a full generic,
persisted chained transform cannot claim complete fidelity until that save
coordinator exists.

### Category D: UI, interaction, and lifecycle

| API-1 capability/member | Resolved via | API-2 shape and verified scope |
| --- | --- | --- |
| `ctx.ui.openPanel` | Expanded declarative UI | Keep `ui.mount`/`ui.patch`, and add schema-checked form controls, values, validation messages, and `ui.action` events. QoL's macro wizard needs an input field and buttons, not an `HTMLElement`. |
| `ctx.keymaps` | Async semantic request | `keymap.query { key }` and `keymap.bind { trigger, action }` are capability-gated host requests. The host checks availability and owns keyboard dispatch. |
| `ctx.display` (`snapshot`, grid/camera/map/sidebar/tile/filter/repaint/onKey) | Push display snapshots plus display intents | Keep `display.snapshot` subscription; add `display.intent { kind: "grid" | "camera" | "mapView" | "sidebarExtent" | "tileScaling" | "visualFilter" | "repaint", value }` and `input.key`/`input.pointer` events with clone-safe fields. QoL's zoom/pan changes only on user input, resize, or option change, so each intent can be asynchronous. Its hover card must become a host-owned declarative overlay fed by `state.map-hover-v1`, not canvas/DOM sampling. |
| `installMod`, `reloadGame`, `loadModForSession` | Existing promise-shaped RPC | Add named `mod.install`, `game.reload`, and `mod.loadForSession` request codes with existing byte, archive, and consent limits. Forge already awaits these actions. |
| `ctx.debug` | Semantic host commands | `debug.request { code, args }` is capability-gated and confirmed by the host. No shipped mod uses it; a generic live debug facade is rejected. |
| `ctx.wizard` | Needs a small named command catalogue | Forge uses a wizard test surface, not an incidental one-shot call. Define `wizard.catalogue` and individually validated `wizard.request` codes after a focused Forge design; the host remains responsible for confirmation and save detachment. |
| `ctx.backupFolder` | Async mediated storage | Keep capability-gated `backup.choose`, `backup.write`, and `backup.forget` requests. No shipped mod uses it. |
| `frontend(ctx)` | Push-on-change display-list cache | `ui.frontend.declare` claims the allowed surface once; `ui.frontend.patch { revision, displayList }` updates a host cache. The host presents the last valid display list every frame. No shipped mod currently supplies `frontend`; the audit's callback cadence is confirmed by the host render loop, not by a shipped frontend. |
| `hud(ctx)` | Push-on-change display-list cache | `ui.hud.declare { regions }` and `ui.hud.patch { revision, cells }` replace `HudFrameSink.present`. Inspection corrects the simpler assumption here: QoL returns a sidebar sink whose `present(section, frame)` paints every HUD frame, including live player values. The host must publish a coalesced HUD model when its values change and paint the last Worker display list synchronously; it cannot wait for a Worker during each render. |
| `menu(ctx)` and `screen(ctx)` | Async host presentation | `menu.present`/`menu.answer` and `screen.present`/`screen.dismiss` give the host overlay and focus ownership. The audit found no shipped caller; synchronous presenter functions do not cross. |
| `regions(ctx)` | Push-on-change region cache | `ui.region.declare` is once per lifetime and `ui.region.patch` changes the cached cells on state/input changes. The current compositor calls every `paint(surface)` synchronously on every `render()`; Forge's actual tab paint is constant text and placement depends only on grid size, so one declaration plus cached patch is sufficient. Its workshop itself is covered by the Forge follow-up, not by a raw `Document`. |
| `migrateBag` | Existing async migration | Keep `migrateBag` request/result. The audit found no shipped caller, but it is already naturally Worker-shaped. |
| `controller(ctx)` | Existing agent decision protocol plus cached snapshots | Use the existing serialized perceive/act pump for one decision per player turn. Feed it Borg's `content.borg-v1` cache and dynamic models rather than `bindCore`, registries, or `GameState`. A few milliseconds is acceptable at the command boundary; the host waits before asking for the next player action, not during rendering. |
| `uninstall()` | Host-owned teardown | Keep bounded `teardown`/acknowledgement then termination. UI, policies, declarations, and caches are keyed by plugin id and removed by the host even if the Worker does not acknowledge. |

## Browser and Electron

### Browser

Use a dedicated **module Web Worker**, one per plugin.  A Worker has a separate
global scope and communicates with `postMessage`; it has no renderer DOM.
Structured-clone snapshots make the absence of live object identity enforceable
at the JavaScript boundary.  The Worker needs a host bootstrap so host protocol
and egress policy exist before importing third-party code.

This is not a resource/security sandbox by itself.  Same-origin Workers retain
web platform abilities such as CPU use, memory allocation and normally network
access.  The implementation must use restrictive Worker CSP and a capability
broker, not a best-effort deletion of `fetch` from JavaScript globals: an
untrusted module can use other web APIs or imports.  Use separate bootstrap
responses/CSP policies for no-network and approved-network workers; validate
allowed module URLs and do not make a general same-origin service route an
implicit capability.

### Electron desktop

The same browser Worker design works.  Neo Angband's real game
`BrowserWindow` already has `contextIsolation: true`, `nodeIntegration: false`,
and `sandbox: true` in `packages/desktop/src/main.ts`; the renderer is therefore
Chromium-style web content and the Worker is a renderer Worker.  It does **not**
need, and must not gain, a Node worker, Electron utility process, iframe, or
main-process bridge.

Electron documents that sandboxed renderers behave like Chromium renderers and
have no Node environment; its multithreading guide specifically says
`nodeIntegrationInWorker` requires `sandbox` not be true.  Enabling it would
make this design worse, not better.  Context isolation also keeps preload APIs
out of page JavaScript; a Worker has neither the page `window` nor a reason to
receive `neoDesktop`/`neoHostFs`.  The host must still avoid posting those
objects, validate every Worker message, and restrict the loopback server's
module/asset routes, because same-origin fetch is not a filesystem permission
model.  See Electron's [process sandboxing guide](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[multithreading guide](https://www.electronjs.org/docs/latest/tutorial/multithreading/),
and [security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

## Migration and versioning

This is a breaking change to the ordinary plugin API.  The recommended path is:

1. Add an explicitly selected worker ABI (`modApi: 2` plus an execution/runtime
   marker and worker entry) without changing how API-1 `plugin.js` loads.
   The API-1 consent UI must continue to say that code is trusted in-process.
2. Define the minimum useful worker contract: immutable init data, logging,
   preferences, asset bytes, bag migration, a reactive event/read model, semantic
   commands, and a host-owned UI/display protocol.  Version its wire messages
   independently.
3. Port one opt-in mod only after its required reads/actions are explicitly
   represented. Borg is a useful controller pilot because the decision transport
   already exists, but its content snapshot must come first.
4. Port every shipped callback-heavy mod through the named policies, hook
   requests, declarations, and UI caches in the full-surface section. Do not
   silently run an API-2 fallback in-process.
5. Complete the explicitly named follow-up designs for Forge authoring/wizard
   and the generic persisted message-transform save coordinator before claiming
   the corresponding API-2 surfaces are complete.
6. Deprecate API 1 only after every shipped mod has moved, then remove it in the
   later major mod-API change that the project chooses.

A mere `MOD_API_VERSION` bump with an accepted API-1 compatibility window does
not make existing plugins safe.  It only labels them old while still executing
them in the process.

### Full-cutover end state

API 1 is a migration compatibility path, not a permanent second ABI. The end
state is that all seven shipped mods run as API-2 Workers and API 1 is deprecated
because nothing shipped still requires its trusted in-process callbacks, live
objects, or DOM access. The exact deprecation and removal dates are a separate
product decision and are intentionally not set here.

## Threat model: honest limits

With the stated invariants, the Worker boundary protects the live engine from a
misbehaving worker plugin directly reading or retaining `GameState`, core
singletons, registry objects, DOM nodes, canvas contexts, or Electron preload
objects.  It also makes host capability checks meaningful: the Worker receives
only permitted snapshots and can request only validated semantic actions.  A
bad plugin cannot mutate a registry by discovering it through `ctx.core`,
because no `ctx.core` exists in that runtime.

It does **not** make arbitrary untrusted JavaScript safe in every sense:

- A Worker shares the application's CPU, memory pressure and browser process
  budget.  An infinite loop, allocation flood, or message flood can still harm
  responsiveness or crash the renderer.  Host timeouts, request/message size
  ceilings, rate limits, termination and crash reporting reduce this; they are
  not a resource quota.
- A plugin can still ask for, and misuse within their meaning, capabilities the
  player granted.  Validation narrows operations; it cannot make an authorized
  destructive semantic command benign.
- Network, module loading and same-origin asset routes need CSP/server policy.
  Removing `fetch` in a runtime library is defense in depth, not a complete
  egress sandbox.
- This is not a VM, OS container, or defense against a Chromium/Electron
  vulnerability.  Keep Electron/Chromium current and preserve Electron's
  sandboxing, context isolation and no-Node configuration.
- Worker data is copied, not magically secret after it was intentionally sent.
  The host must minimize snapshots and never send save secrets, arbitrary host
  handles, or live mutable data.

## Why this change set has no new proof of concept

No new ordinary-plugin proof of concept was added.  The existing agent Worker
bridge already proves the bounded property a small POC could honestly prove:
the worker receives serialized perceive data and returns a command, not a live
core reference; its host/runtime/serialization tests cover the protocol and
denied read domains.  Repackaging one harmless API-1 method such as `log` would
not test the hard parts (`hooks`, registry callbacks, rendering and DOM) and
would risk implying that ordinary `plugin.js` is on a migration path when the
audit shows it is not.

The correct next implementation is therefore a human-approved API-2 scope,
starting with a reactive-only capability whose complete host contract is known.
It stays opt-in while each migration is verified, but the target is the full
cutover specified above rather than a permanent split.
