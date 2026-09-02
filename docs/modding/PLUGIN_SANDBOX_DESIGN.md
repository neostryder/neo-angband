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

Therefore **not every existing shipped mod can be migrated to a message-passing
boundary without losing functionality**.  This is a go/no-go blocker for a plan
whose premise is “move all ordinary plugins to Workers while preserving API 1.”
It is not an Electron blocker, nor a reason to abandon workers for the class of
plugins that can use a reactive API.

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
   represented.  Borg is the strongest candidate for a later pilot because the
   controller transport already exists, but it is not yet an easy pilot due to
   its direct initialization dependencies.
4. Keep callback-heavy engine extensions as API-1 trusted plugins unless and
   until core deliberately replaces the individual extension with declarative
   host behavior.  Do not silently run an API-2 fallback in-process.
5. Give API 1 the documented deprecation period, then remove it only in the
   next major mod-API change.  If the product goal is “all plugins are
   technically sandboxed,” removal—not a version-window bump alone—is the point
   at which that claim becomes true.

A mere `MOD_API_VERSION` bump with an accepted API-1 compatibility window does
not make existing plugins safe.  It only labels them old while still executing
them in the process.

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
It must stay opt-in and leave all current shipped mods exactly as they run
today.
