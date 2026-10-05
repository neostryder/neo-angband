// Shared by the browser and Electron isolation specs: the probe's files, built
// once per run, and the reading of what the probe reported.
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/* Playwright loads the specs as CommonJS, so the folder comes from __dirname. */
const here = __dirname;
const root = path.resolve(here, "..", "..");

export interface ProbeFiles {
  /** Path on the fake game origin to the body served there. */
  readonly files: Readonly<Record<string, { readonly body: string; readonly type: string }>>;
}

export type ProbeResults = Record<string, string>;

const HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><title>isolation probe</title></head><body><script src=\"/probe.js\"></script></body></html>";

/**
 * The page script is bundled by Vite with minification on, the same bundler and
 * minifier as the game's release build, so the Function.prototype.toString()
 * sources the frame and the Worker receive are the shapes a release ships.
 */
export async function buildProbeFiles(): Promise<ProbeFiles> {
  const require = createRequire(path.join(root, "packages", "web", "package.json"));
  const vite = (await import(pathToFileURL(require.resolve("vite")).href)) as {
    build(config: unknown): Promise<unknown>;
  };
  const built = await vite.build({
    configFile: false,
    logLevel: "warn",
    root,
    build: {
      write: false,
      minify: true,
      target: "es2022",
      lib: { entry: path.join(here, "fixtures", "mod-isolation-page.js"), formats: ["iife"], name: "probe", fileName: () => "probe.js" },
    },
  });
  const outputs = (Array.isArray(built) ? built : [built]) as { output: { fileName: string; code?: string }[] }[];
  const page = outputs.flatMap((entry) => entry.output).find((chunk) => chunk.fileName === "probe.js")?.code;
  if (page === undefined) throw new Error("the probe page did not build");
  const js = "text/javascript; charset=utf-8";
  const checks = fs.readFileSync(path.join(here, "fixtures", "mod-isolation-checks.js"), "utf8");
  return {
    files: {
      "/": { body: HTML, type: "text/html; charset=utf-8" },
      "/probe.js": { body: page, type: js },
      "/mods/probe/worker.js": { body: fs.readFileSync(path.join(here, "fixtures", "mod-isolation-worker.js"), "utf8"), type: js },
      "/mods/probe/lib/checks.js": { body: checks, type: js },
      "/control-worker.js": { body: `${checks}
self.onmessage = async (event) => postMessage(await runChecks(event.data));
`, type: js },
      "/secret.txt": { body: "game-secret-file", type: "text/plain; charset=utf-8" },
      "/remote-module.js": { body: "export const reached = true;", type: js },
      "/events": { body: "data: reached\n\n", type: "text/event-stream" },
    },
  };
}

/** What an isolated run handed back from the page. */
export interface IsolatedRun {
  readonly logs: string[];
  readonly problems: string[];
  readonly failure: string | null;
  readonly framesWhileRunning: number;
  readonly framesAfterTeardown: number;
}

/** The probe's results from an isolated run, or a thrown error that shows the whole run. */
export function isolatedResults(run: IsolatedRun): ProbeResults {
  const line = run.logs.find((entry) => entry.startsWith("info:{"));
  if (line === undefined) throw new Error(`the isolated probe reported nothing: ${JSON.stringify(run)}`);
  return JSON.parse(line.slice("info:".length)) as ProbeResults;
}

/** Ways out: each must fail inside the sandbox, and no request may reach the route log. */
export const NETWORK_CHECKS = ["fetchGame", "fetchRemote", "xhr", "webSocket", "eventSource", "remoteImport"] as const;

/**
 * The game's stores: none may hand the sandbox the secret the page put there.
 * An engine may give an opaque origin an empty store of its own (WebKit gives
 * a data: Worker an empty Cache Storage); that holds nothing of the game's.
 */
export const STORAGE_CHECKS = ["indexedDB", "caches", "opfs"] as const;
export const GAME_SECRETS = /game-secret|neo-angband-isolation-probe/u;
