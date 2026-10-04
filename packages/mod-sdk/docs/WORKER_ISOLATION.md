# Worker mod isolation

A Worker mod runs in a Worker that shares nothing with the game except a message port. It has no network, none of the game's storage, and no way to load code from anywhere. A schema 2 manifest declares one with `"runtime": "worker"`, an `entry` and an `api` range that admits `2.0.0-worker`; a schema 1 manifest says `"modApi": 2`, `"runtime": "worker"` and a `workerEntry`. The sections below cover how the isolation holds, what it was tested against, and what it leaves open.

API-1 plugins are not covered. They run in the game's page with the game's own access and are trusted code (`PLUGINS.md`).

## How a Worker mod starts

1. The game reads every module the mod's entry reaches (`packages/web/src/mod-worker/staging.ts`). Only the mod's own files qualify: a file under the entry's folder on the game's origin, or a blob: URL the game made for a mod folder picked in a browser. A bare package name, another origin, a data: URL, a path out of the folder, a query string or fragment, or a cycle is refused before any code runs, and the message names the file at fault. A graph holds at most 256 files and 16,777,216 characters of source (16 Mi).
2. The game adds a hidden `<iframe sandbox="allow-scripts">` whose document comes from `srcdoc` (`packages/web/src/mod-worker/isolation.ts`). Without `allow-same-origin` the frame's origin is opaque. Its document sets a Content Security Policy before its one script runs.
3. The game sends the frame the module text and two MessagePorts. The frame accepts that message once, and only from the page that made it.
4. The frame turns each module into a `data:` URL, writing each import's own `data:` URL where the import stood, and starts a classic Worker from a `data:` URL. The Worker inherits the opaque origin and the frame's policy.
5. The Worker deletes its network, storage and nested-worker globals, installs the API-2 bootstrap on the port it was handed, and imports the mod's entry.

From then on the mod talks only to the game's broker (`host.ts`), through the port, and every request is checked against the capabilities the player granted. The second port carries the frame's ready and error reports to the game, and the order to stop. Stopping the mod terminates the Worker and removes the frame.

A mod that fails any step fails to start, with a problem line on the Mods screen. So does a Worker that has not answered as ready within 3 seconds. Nothing falls back to an unisolated Worker.

## The three layers

| Layer | What it stops | Where |
|---|---|---|
| Opaque origin | IndexedDB, Cache Storage and the origin-private file system refuse an opaque origin or give it an empty store of its own. Nothing in it is same-origin with the game, so the game's URLs and blob: URLs are out of reach. | the frame's `sandbox` attribute; the `data:` Worker |
| Content Security Policy | `connect-src 'none'` refuses fetch, XHR, WebSocket, EventSource and WebTransport before a request is made. `script-src` admits the frame's nonce and `data:` only, so no remote script or module loads and `eval` is refused. `worker-src` and `child-src` admit `data:` for the one Worker, and every other directive, `default-src` included, is `'none'`. | `modFrameCsp` |
| Global lockdown | Deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `WebSocketStream`, `EventSource`, `WebTransport`, `indexedDB`, `caches`, `cookieStore`, `Worker`, `SharedWorker`, `importScripts`, `BroadcastChannel`, `RTCPeerConnection` and `RTCDataChannel` from every object on the Worker's scope chain before the mod loads. A name the engine will not let it delete but lets it write is set to `undefined`. | `lockDownModWorkerScope` |

The first two layers are the boundary. The lockdown is defence in depth: a mod could find another way to an API it deletes, and the tests run with it switched off to show the boundary holds without it.

## Why data: URLs and a classic Worker

These were measured in an opaque-origin frame with Playwright:

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Module Worker from a blob: URL | refused | starts | refused |
| Classic Worker from a blob: URL | starts | starts | refused |
| Importing a blob: module made by another context | only from a blob: Worker | only from a blob: Worker | refused |
| Classic Worker from a data: URL, importing data: modules | starts | starts | starts |

The last row is the only combination all three engines run, so the frame uses it. A classic Worker still has `import()`, which is how it loads the mod's modules. In all three engines the `data:` Worker inherits the frame's policy.

## Browser and desktop

The browser game and the desktop app use the same frame. The desktop app serves the game from its own `neo-angband://game` scheme. Every response there carries the headers that make the page cross-origin isolated, and the window runs with `contextIsolation`, `sandbox` and no Node integration. A `srcdoc` frame needs no response of its own, so those headers do not get in its way, and the frame and its Worker behave there as they do in Chromium. No separate origin, partition or process is needed.

## What the tests prove

- `packages/web/src/mod-worker/staging.test.ts` covers the staging rules: what is read, the order, each kind of import that is refused, a cycle, a file that cannot be read, and the size limit.
- `packages/web/src/mod-worker/isolation.test.ts` runs the real frame script and the real Worker source against stand-ins. It covers the policy text, the lockdown, that the shipped source runs with nothing from outside it, a mod booting and answering through the broker, teardown, refused boot messages, the link limit and a frame that fails to load.
- `tests/e2e/mod-worker-isolation.spec.ts` runs a probe mod in Chromium, Firefox and WebKit, with the lockdown on and off. The probe tries the game's IndexedDB, Cache Storage and private file system, fetch and XHR to the game, fetch to another host, a WebSocket, an EventSource, a remote module import, `eval`, a nested Worker and a BroadcastChannel. Every request the page makes is counted. In every engine the probe's origin is `null`, every network attempt fails, no store holds the game's data, `eval` is refused, and no request is made. A control run of the same probe as a plain Worker of the game's origin opens the game's IndexedDB and Cache Storage, runs `eval` and imports the remote module, which shows each check can see an open door.
- `tests/e2e/mod-worker-isolation.electron.spec.ts` runs the same probe in the repository's Electron, on the desktop shell's scheme, privileges, headers and window settings, with the main process counting every request. It first checks that the page is `neo-angband://game`, cross-origin isolated and a secure context. The isolated runs pass the same checks as in the browsers, every store refuses the probe even with the lockdown off, and no request reaches the main process. Its control run reads the game's IndexedDB and fetches a game file, and the main process sees those requests. It uses a small stand-in for the shell's main process, because the packaged-app fixture needs a release build.

The page script in both specs is bundled by Vite with minification, so the frame and Worker source that ship as `Function.prototype.toString()` text are tested in the shape a release build gives them.

Run them with `pnpm exec playwright test tests/e2e/mod-worker-isolation.spec.ts` and `pnpm exec playwright test --project=electron tests/e2e/mod-worker-isolation.electron.spec.ts`.

## What it does not stop

- **What the broker allows.** A mod can send out whatever its granted capabilities let it send, and can misuse an action the player approved. The broker's checks are its own subject.
- **Resource use.** The Worker shares the renderer's CPU and memory. An endless loop or allocation flood slows or crashes the tab. The broker refuses a message over 64 KiB and more than 60 requests a minute, each refusal counts as a fault, and a mod that faults three times within 200 game turns is switched off and its Worker stopped. These soften the problem; they are not a quota.
- **Side channels.** Timing and covert channels are not addressed.
- **BroadcastChannel without the lockdown.** It opens, scoped to the frame's opaque origin, which each sandboxed frame gets afresh. Two mods running at once were not tested against each other; the lockdown removes the API in any case.
- **Empty stores of its own.** WebKit gives the Worker an empty Cache Storage of its own. It holds nothing of the game's and is gone with the frame.
- **Engine bugs.** This is not a VM or a process boundary. It depends on Chromium, Gecko and WebKit enforcing the sandbox and the policy, and on the desktop app's Electron being kept current.

## What it asks of a Worker mod

- Import only the mod's own files, by relative path. A bare package name has to be bundled in.
- No import cycles.
- No `import.meta.url` and no computed dynamic imports of the mod's files: a module is a `data:` URL, so neither resolves to a file. Read files with the asset request instead.
- Each module carries the `data:` URLs of its imports inside it, so a deep or diamond-shaped graph grows faster than its source. Linking stops at 67,108,864 characters (64 Mi) with a message; bundling a mod into one file avoids the question.
