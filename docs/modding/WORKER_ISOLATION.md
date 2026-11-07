# Worker mod isolation

A Worker mod (`"runtime": "worker"`, an `api` range over API 2 and an `entry`) runs in a Worker that exchanges bounded JSON messages with the game through a sandboxed frame. It has no direct network or game-storage access. It can construct and dynamically import data: code at runtime; that code retains the same sandbox restrictions. A Worker is the isolated way to run a mod: a mod that does not need isolation runs in process with the same API and none of these limits. This page says how the isolation holds, what it was tested against, and what it leaves open.

API 1 plugins are not covered. They run in the game's page with the game's own access and are trusted code (`PLUGINS.md`).

## How a Worker mod starts

1. The game reads every module named by literal imports reachable from the mod's entry (`packages/web/src/mod-worker/staging.ts`). The mod's own files qualify: a file under the entry's folder on the game's origin, or a blob: URL the game made for a mod folder picked in a browser. The sole package exception is `@rpgm-tools/neo-angband-mod-sdk/authoring`, which stages a fixed pure library only with `mod:authoring`. Every other bare package name, another origin, a data: URL, a path out of the folder, a query string or fragment, or a cycle is refused before any code runs, and the message names the file at fault. A graph, including the authoring library, holds at most 256 files and 16,777,216 characters of source (16 Mi).
2. The game adds a hidden `<iframe sandbox="allow-scripts">` whose document comes from `srcdoc` (`packages/web/src/mod-worker/isolation.ts`). Without `allow-same-origin` the frame's origin is opaque. Its document sets a Content Security Policy before its one script runs.
3. The game transfers a control MessagePort in a hello message with a fresh nonce embedded in the frame. The frame checks the parent and nonce, accepts one hello, and echoes the nonce on the port. Only after that acknowledgment does the game send the module text and a second port, over the control port. A wrong nonce, wrong source, or replay cannot start another Worker. No module source is sent to the frame window.
4. The frame turns each module into a `data:` URL, writing each import's own `data:` URL where the import stood, and starts a classic Worker from a `data:` URL. The Worker inherits the opaque origin and the frame's policy.
5. The Worker deletes its network, storage, shared-memory, canvas, blob, and nested-worker globals and aborts before importing the entry if a forbidden name remains reachable. Its failure message is bounded to 1,024 characters. It freezes MessagePort and MessageEvent prototypes and constructors, installs the API 2 bootstrap on a private transport, and imports the entry. The bootstrap checks that the default export is an API 2 definition and tells the broker what it declares.

From then on the frame retains both page-facing ports. The Worker sends JSON text to the frame, which rejects raw objects, transferred ports, invalid JSON, non-finite numbers, nesting beyond 64 levels, and messages over 64 KiB before posting parsed data to the page. The Worker never receives a page-facing MessagePort. The mod talks to the game's broker (`host.ts`) through that relay. The broker serves each call with the same API 2 host an in-process mod gets, under the permissions the player granted, and [API2.md](API2.md) ("In a Worker") lists its limits. The second port carries only Worker errors to the game and the order to stop. Stopping the mod terminates the Worker and removes the frame.

A mod that fails any step fails to start, with a problem line on the Mods screen. So does a Worker that has not answered as ready within 3 seconds. Nothing falls back to an unisolated Worker.

## The three layers

Worker text replacements and grid regions carry only bounded line records, fixed style tokens, and grid coordinates. The host draws them with `textContent`, clips them to validated geometry, caps them at eight outputs, and hides them whenever a host dialog or another modal screen owns the display. Workers receive no DOM, canvas, callback, or transferable handle for these regions.

The simple Worker grants add bounded data paths for interface options, edits in the current keyset, and named visual filters. The broker checks its connection's grants and the host's current grants before dispatch. The host rechecks a pending key capture before returning it. Host dialogs cancel capture and suspend mod panels and filters; permission dialogs also prevent Worker controller key and decision delivery. A Worker never supplies CSS for a filter or receives a live key event through these paths. [API2.md](API2.md) lists the methods and bounds.

| Layer | What it stops | Where |
|---|---|---|
| Opaque origin | IndexedDB, Cache Storage and the origin-private file system refuse an opaque origin or give it an empty store of its own. Nothing in it is same-origin with the game, so the game's URLs and blob: URLs are out of reach. | the frame's `sandbox` attribute; the `data:` Worker |
| Content Security Policy | `connect-src 'none'` refuses fetch, XHR, WebSocket, EventSource and WebTransport before a request is made. `script-src` admits the frame's nonce and `data:` only, so no remote script or module loads and `eval` is refused. `worker-src` and `child-src` admit `data:` for the one Worker, and every other directive, `default-src` included, is `'none'`. | `modFrameCsp` |
| Global lockdown | Deletes network, storage, and nested-worker globals, BroadcastChannel, WebRTC constructors including prefixed forms, SharedArrayBuffer, Atomics, OffscreenCanvas, Blob, URL.createObjectURL, storage/cache constructors, and navigator.sendBeacon, serviceWorker, storage, and locks along their prototype chains before the mod loads. A writable name that cannot be deleted is set to `undefined`; a reachable leftover aborts boot. | `lockDownModWorkerScope` |

Opaque origin and CSP constrain page, storage, and network access even when the probe disables global deletion. Production boot requires global deletion to succeed as well. A Worker can normally share memory through SharedArrayBuffer; this host removes that global and Atomics and refuses shared memory and transferable handles at the frame relay. It does not depend on the desktop page's cross-origin isolation headers being absent from srcdoc. Dynamic import is language syntax and cannot be deleted from the scope.

## Why data: URLs and a classic Worker

These were measured in an opaque-origin frame with Playwright:

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Module Worker from a blob: URL | refused | starts | refused |
| Classic Worker from a blob: URL | starts | starts | refused |
| Importing a blob: module made by another context | only from a blob: Worker | only from a blob: Worker | refused |
| Classic Worker from a data: URL, importing data: modules | starts | starts | starts |

The last row is the only combination the existing harness supports across all three engines, so the frame uses it. Removing data: from script-src would block those staged-module imports. The current loader implements no measured blob/module URL alternative for that matrix; restricting dynamic imports to measured sources remains unfinished. Broker-provided text can therefore become runtime code inside the sandbox. A classic Worker still has `import()`, which is how it loads the mod's modules. In all three engines the `data:` Worker inherits the frame's policy.

## Browser and desktop

The browser game and the desktop app use the same frame. The desktop app serves the game from its own `neo-angband://game` scheme. Every response there carries the headers that make the page cross-origin isolated, and the window runs with `contextIsolation`, `sandbox` and no Node integration. A `srcdoc` frame needs no response of its own, so those headers do not get in its way, and the frame and its Worker behave there as they do in Chromium. The frame relay rejects non-JSON Worker traffic before it reaches the page. This does not provide a separate process or a CPU or memory quota.

## Game-page policy and parent-page trust

The desktop response headers and Vite preview server send `Content-Security-Policy-Report-Only`. The web bundle also emits `_headers` for static hosts that support that file; other hosts, including GitHub Pages, require response-header configuration outside the bundle. A meta element cannot deliver a report-only CSP. The proposed policy defaults to no loads, permits same-origin and blob scripts without eval or inline scripts, and permits HTTPS connections for existing network operations. It is not enforcement. The game has not been verified under an enforced page policy, and inherited page restrictions would currently conflict with the frame's inline bootstrap and data: module imports.

The nonce handshake rejects blind races and keeps source out of window messages. It cannot protect against arbitrary code already executing in the parent page: that code can read srcdoc, hook MessageChannel or postMessage, and act with page authority. No handshake within the same page can establish a secret against that page. Page execution remains trusted; the full guarantee against a hostile parent script is unfinished.

## What the tests prove

- `packages/web/src/mod-worker/staging.test.ts` covers the staging rules: what is read, the order, and every refusal.
- `packages/web/src/mod-worker/host.test.ts` wires the real bootstrap to the broker in one thread, on a real game. Two games that differ only in an unseen monster look the same through the Worker, and the same as through the in-process host. It also covers an answer that times out and the late reply that follows, the wildcard grant, policy tables answering inside a turn, a credential that never reaches the Worker, and a stalled Worker being stopped.
- `packages/web/src/mod-worker/isolation.test.ts` runs the real frame script and the real Worker source against stand-ins. It covers policy text, lockdown leftovers aborting before entry execution, the standalone shipped source, broker round trips, teardown, wrong-source and wrong-nonce boot attempts, replays, JSON-only relay limits, the link limit, and frame load failures.
- `tests/e2e/mod-worker-isolation.spec.ts` runs a probe mod in Chromium, Firefox and WebKit, with the lockdown on and off. The probe tries the game's IndexedDB, Cache Storage, and private file system, network APIs, remote imports, eval, nested Workers, BroadcastChannel, SharedArrayBuffer, Atomics, OffscreenCanvas, Blob, object URLs, sendBeacon, service workers, storage estimates, locks, and WebRTC constructors including prefixed forms. It also tries MessagePort and MessageEvent prototype replacement and sends raw typed arrays and a transferred port outside the API proxy. A separate real Worker with an immutable forbidden global must abort before entry execution. Runtime data: import succeeds, while code imported that way cannot fetch the game or access its page. Every request the page makes is counted. In every engine the probe's origin is `null`, every network attempt fails, no store holds the game's data, `eval` is refused, and no request is made. A control run of the same probe as a plain Worker of the game's origin opens the game's IndexedDB and Cache Storage, runs `eval` and imports the remote module, which shows each check can see an open door.
- `tests/e2e/mod-worker-isolation.electron.spec.ts` runs the same probe in the repository's Electron, on the desktop shell's scheme, privileges, headers and window settings, with the main process counting every request. It first checks that the page is `neo-angband://game`, cross-origin isolated and a secure context. The isolated runs pass the same checks as in the browsers, every store refuses the probe even with the lockdown off, and no request reaches the main process. Its control run reads the game's IndexedDB and fetches a game file, and the main process sees those requests. It uses a small stand-in for the shell's main process, because the packaged-app fixture needs a release build.

The page script in both specs is bundled by Vite with minification, so the frame and Worker source that ship as `Function.prototype.toString()` text are tested in the shape a release build gives them.

Run them with `pnpm exec playwright test tests/e2e/mod-worker-isolation.spec.ts` and `pnpm exec playwright test --project=electron tests/e2e/mod-worker-isolation.electron.spec.ts`.

## What it does not stop

- **What the broker allows.** A mod can send out whatever its granted capabilities let it send, and can misuse an action the player approved. The broker's checks are its own subject.
- **Resource use.** The Worker shares the renderer's CPU and memory. An endless loop or allocation flood slows or crashes the tab. The broker's rate and size limits, and its heartbeat, which stops a Worker that goes 5 seconds without answering, soften this; they are not a quota.
- **Side channels.** Timing and covert channels are not addressed.
- **BroadcastChannel without the lockdown.** It opens, scoped to the frame's opaque origin, which each sandboxed frame gets afresh. Two mods running at once were not tested against each other; the lockdown removes the API in any case.
- **Empty stores of its own.** WebKit gives the Worker an empty Cache Storage of its own. It holds nothing of the game's and is gone with the frame.
- **Engine bugs.** This is not a VM or a process boundary. It depends on Chromium, Gecko and WebKit enforcing the sandbox and the policy, and on the desktop app's Electron being kept current.

## Refused permissions

A broker request that needs an ungranted permission resolves to `{ ok: false, reason: "not-granted", capability }`. This applies during startup too, so awaiting a refused preference read does not prevent the Worker from becoming ready. Methods that normally return no value also return this result on refusal. Invalid payloads and operational failures still reject. Host-rendered Worker panels and in-process API 2 panels stay hidden and inert while a Core confirmation is open, including panels mounted or patched during that confirmation.

## What it asks of a Worker mod

- Import only the mod's own files, by relative path. A bare package name has to be bundled in.
- No import cycles.
- No `import.meta.url` and no computed dynamic imports of the mod's files: a module is a `data:` URL, so neither resolves to a file. Read files with `content.asset` instead.
- Each module carries the `data:` URLs of its imports inside it, so a deep or diamond-shaped graph grows faster than its source. Linking stops at 64 MiB with a message; bundling a mod into one file avoids the question.
