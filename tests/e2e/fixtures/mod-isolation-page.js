// The game page of the isolation probe. The specs bundle this with Vite (the
// game's own bundler and minifier, so the shipped toString() sources go through
// the same transform as in a release) and serve it from a fake game origin.

import { startModWorker } from "../../../packages/web/src/mod-worker/host.ts";
import { createIsolatedModWorker } from "../../../packages/web/src/mod-worker/isolation.ts";
import { MOD_WORKER_PROTOCOL_VERSION } from "../../../packages/web/src/mod-worker/protocol.ts";
import { stageModuleGraph } from "../../../packages/web/src/mod-worker/staging.ts";

/** Put a secret in each of the game origin's stores, so a probe that reaches one can say so. */
async function seed() {
  localStorage.setItem("neo-angband-isolation-probe", "game-secret");
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("neo-angband-isolation-probe");
    request.onupgradeneeded = () => request.result.createObjectStore("marks");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const tx = request.result.transaction("marks", "readwrite");
      tx.objectStore("marks").put("game-secret", "secret");
      tx.oncomplete = () => {
        request.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  if (typeof caches !== "undefined") {
    const cache = await caches.open("neo-angband-isolation-probe");
    /* Cache Storage keys only http(s) requests, which the desktop's
     * neo-angband:// origin is not; the key is a name, never fetched. */
    await cache.put("https://neo-angband-isolation.invalid/cached", new Response("game-secret"));
  }
}

async function readText(url) {
  const response = await fetch(url);
  return response.ok ? await response.text() : null;
}

/** What the broker's host side answers for the probe mod: its own data file names the game origin, and the world is a fixed value. */
function probeApi() {
  const ok = (value) => Promise.resolve(Object.freeze({ ok: true, value }));
  return {
    content: { own: () => ok({ probe: { origin: location.origin } }) },
    view: { world: () => ok({ probe: "known world", depth: 3 }) },
  };
}

window.probeIsolated = async (lockDown) => {
  await seed();
  const graph = await stageModuleGraph(`${location.origin}/mods/probe/worker.js`, { origin: location.origin, read: readText });
  const worker = createIsolatedModWorker({ id: "probe", graph, protocolVersion: MOD_WORKER_PROTOCOL_VERSION, lockDown });
  const logs = [];
  const problems = [];
  const session = startModWorker(worker, {
    id: "probe",
    entryUrl: "staged:worker.js",
    grants: ["*"],
    flags: {},
    engine: "probe",
    newCharacter: false,
    net: false,
    api: probeApi,
    readAsset: async () => null,
    onLog: (level, message) => logs.push(`${level}:${message}`),
    onProblem: (problem) => problems.push(problem),
  });
  let failure = null;
  let granted = null;
  try {
    await Promise.race([
      session.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("not ready after 30 s")), 30000)),
    ]);
    session.start();
    const deadline = Date.now() + 30000;
    while (!logs.some((line) => line.startsWith("info:world:")) && problems.length === 0) {
      if (Date.now() > deadline) throw new Error("the probe's start did not finish within 30 s");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } catch (err) {
    failure = String(err && err.message ? err.message : err);
  }
  const framesWhileRunning = document.querySelectorAll("iframe[sandbox]").length;
  session.teardown();
  const worldLine = logs.find((line) => line.startsWith("info:world:"));
  const grantedLine = logs.find((line) => line.startsWith("info:granted:"));
  if (grantedLine !== undefined) granted = JSON.parse(grantedLine.slice("info:granted:".length));
  return {
    logs,
    problems,
    failure,
    world: worldLine === undefined ? null : JSON.parse(worldLine.slice("info:world:".length)),
    granted,
    framesWhileRunning,
    framesAfterTeardown: document.querySelectorAll("iframe").length,
  };
};

window.probeControl = async () => {
  await seed();
  /* A Worker from a URL of the game's own origin, the way the game started its
   * Worker mods before the sandbox. */
  const worker = new Worker(`${location.origin}/control-worker.js`, { type: "module" });
  const result = await new Promise((resolve, reject) => {
    worker.onmessage = (event) => resolve(event.data);
    worker.onerror = (event) => reject(new Error(event.message || "control worker failed"));
    worker.postMessage(location.origin);
  });
  worker.terminate();
  return result;
};
