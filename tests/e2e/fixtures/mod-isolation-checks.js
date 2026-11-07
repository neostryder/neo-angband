// The probe a Worker mod runs to find out what it can reach. Shipped twice by
// the isolation specs: as a mod module inside the sandbox frame, and as a plain
// Worker of the game's own origin, which is the control that shows each check
// can tell an open door from a shut one.
//
// Every check answers "open:<what it got>" or "blocked:<error name>". A check
// that neither succeeds nor fails within the time limit answers "timeout".

export async function runChecks(gameOrigin) {
  const results = {};
  const attempt = async (name, run) => {
    try {
      const value = await Promise.race([
        Promise.resolve().then(run),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "timeout" })), 3000)),
      ]);
      results[name] = `open:${String(value).slice(0, 40)}`;
    } catch (err) {
      results[name] = `blocked:${err && err.name ? err.name : String(err)}`;
    }
  };

  results.origin = String(self.origin);
  /* Reading a global can itself throw: Chromium's `caches` getter does inside a
   * data: URL Worker. A global that throws when read is not reachable. */
  results.globals = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "caches", "Worker", "importScripts", "BroadcastChannel", "SharedArrayBuffer", "Atomics", "OffscreenCanvas", "Blob", "RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection", "localStorage", "sessionStorage", "cookieStore", "Cache", "CacheStorage", "StorageBucket", "StorageBucketManager", "webkitIndexedDB", "StorageManager", "FileSystemHandle", "FileSystemDirectoryHandle", "FileSystemFileHandle", "requestFileSystem", "webkitRequestFileSystem"]
    .filter((name) => {
      try {
        return typeof self[name] !== "undefined";
      } catch {
        return false;
      }
    })
    .join(",");

  await attempt("indexedDB", () => new Promise((resolve, reject) => {
    const request = indexedDB.open("neo-angband-isolation-probe");
    request.onupgradeneeded = () => request.result.createObjectStore("marks");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction("marks", "readonly").objectStore("marks").get("secret");
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(read.result);
    };
  }));
  await attempt("caches", async () => `[${(await caches.keys()).join(",")}]`);
  await attempt("opfs", async () => (await navigator.storage.getDirectory()).kind);
  await attempt("sharedArrayBuffer", () => new SharedArrayBuffer(8).byteLength);
  await attempt("atomics", () => Atomics.load(new Int32Array(1), 0));
  await attempt("offscreenCanvas", () => new OffscreenCanvas(1, 1).width);
  await attempt("blob", () => new Blob(["code"]).size);
  await attempt("objectUrl", () => URL.createObjectURL(new Blob(["code"])));
  await attempt("sendBeacon", () => navigator.sendBeacon("https://remote.test/beacon", "probe"));
  await attempt("serviceWorker", async () => (await navigator.serviceWorker.getRegistrations()).length);
  await attempt("storage", async () => (await navigator.storage.estimate()).usage);
  await attempt("storageBuckets", async () => (await navigator.storageBuckets.keys()).length);
  await attempt("storageFoundation", async () => (await navigator.storageFoundation.getAll()).length);
  for (const name of ["webkitTemporaryStorage", "webkitPersistentStorage", "getStorageDirectory"]) {
    await attempt(name, () => {
      if (typeof navigator[name] === "undefined") throw new TypeError("storage API unavailable");
      return "reachable";
    });
  }
  await attempt("locks", async () => (await navigator.locks.query()).held.length);
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"]) {
    await attempt(name, () => {
      const connection = new self[name]();
      connection.close();
      return "constructed";
    });
  }
  await attempt("portWrap", () => {
    const original = MessagePort.prototype.postMessage;
    if (!Reflect.defineProperty(MessagePort.prototype, "postMessage", { value: function (...args) { return original.apply(this, args); } })) throw new TypeError("frozen port");
    return "wrapped";
  });
  await attempt("messageEventWrap", () => {
    if (!Reflect.defineProperty(MessageEvent.prototype, "data", { get() { return {}; } })) throw new TypeError("frozen event");
    return "wrapped";
  });
  const codeUrl = (text) => `data:text/javascript,${encodeURIComponent(text)}`;
  await attempt("dataImport", async () => (await import(codeUrl("export default 42"))).default);
  await attempt("dataImportFetch", async () => (await import(codeUrl("export default (url) => fetch(url)"))).default(`${gameOrigin}/secret.txt`));
  await attempt("pageAccess", () => self.parent.document.body);
  await attempt("fetchGame", async () => (await (await fetch(`${gameOrigin}/secret.txt`)).text()));
  await attempt("fetchRemote", async () => (await fetch("https://remote.test/beacon")).status);
  await attempt("xhr", () => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", `${gameOrigin}/secret.txt`);
    request.onload = () => resolve(request.responseText);
    request.onerror = () => reject(Object.assign(new Error("xhr"), { name: "NetworkError" }));
    request.send();
  }));
  await attempt("webSocket", () => new Promise((resolve, reject) => {
    const socket = new WebSocket("wss://remote.test/socket");
    socket.onopen = () => resolve("connected");
    socket.onerror = () => reject(Object.assign(new Error("socket"), { name: "SocketError" }));
  }));
  await attempt("eventSource", () => new Promise((resolve, reject) => {
    const source = new EventSource(`${gameOrigin}/events`);
    source.onopen = () => resolve("connected");
    source.onerror = () => {
      source.close();
      reject(Object.assign(new Error("eventsource"), { name: "EventSourceError" }));
    };
  }));
  await attempt("remoteImport", async () => Object.keys(await import(`${gameOrigin}/remote-module.js`)).join(","));
  await attempt("eval", () => (0, eval)("6 * 7"));
  await attempt("nestedWorker", () => new Promise((resolve, reject) => {
    const nested = new Worker(URL.createObjectURL(new Blob(["fetch('https://remote.test/nested').then(() => postMessage('fetched'), (e) => postMessage('refused:' + e.name));"], { type: "text/javascript" })));
    nested.onmessage = (event) => resolve(event.data);
    nested.onerror = (event) => {
      event.preventDefault();
      reject(Object.assign(new Error("nested"), { name: "WorkerError" }));
    };
  }));
  await attempt("broadcast", () => {
    const channel = new BroadcastChannel("neo-angband-isolation-probe");
    channel.postMessage("hello");
    channel.close();
    return "posted";
  });
  return results;
}
