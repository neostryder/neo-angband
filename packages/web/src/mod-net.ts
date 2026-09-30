/**
 * `ctx.net`: HTTP requests from a mod, gated by its `network:` grants
 * (neostryder/neo-angband#300).
 *
 * Two transports behind one interface. In the desktop app the request goes to
 * the main process (packages/desktop/src/net-relay.ts), which sends it, so CORS
 * and mixed content do not apply and secrets stay in the main process. In a
 * browser tab the request is an ordinary `fetch`, CORS applies, and secrets are
 * kept in page storage, which any script on the page can read; every answer that
 * used one says `secretStorage: "page"` so the mod can tell the player.
 */

import {
  NET_LIMITS,
  checkNetRequest,
  checkSecretHosts,
  fillSecretTemplates,
  isSecretName,
  modPageSecretsFormat,
  parseDocument,
  readBodyCapped,
  secretNamesIn,
  serializeDocument,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { NetProblem, NetProblemCode, NetRequest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModNetResponse, ModSecretResult, ModNet } from "@rpgm-tools/neo-angband-core";
export type { ModSecretStorage, ModNetResponse, ModSecretResult, ModNetSecrets, ModNet } from "@rpgm-tools/neo-angband-core";

export type { NetProblemCode, NetRequest } from "@rpgm-tools/neo-angband-mod-sdk";

/** The desktop preload's relay, when this page has one. */
export interface NetRelayBridge {
  net(op: string, arg?: unknown): Promise<unknown>;
}

/** Find the desktop relay on `scope`, or null in a browser tab. */
export function netRelayBridge(scope: unknown = globalThis): NetRelayBridge | null {
  if (scope === null || typeof scope !== "object") return null;
  const desktop = (scope as Record<string, unknown>)["neoDesktop"];
  if (desktop === null || typeof desktop !== "object") return null;
  const net = (desktop as Record<string, unknown>)["net"];
  return typeof net === "function" ? (desktop as NetRelayBridge) : null;
}

export interface ModNetDeps {
  readonly modId: string;
  /** The mod's manifest name, for the desktop's environment dialog. */
  readonly modName: string;
  /** The mod's `network:` grant hosts. */
  readonly grants: readonly string[];
  readonly relay: NetRelayBridge | null;
  readonly fetch: typeof fetch;
  /** Page storage for the browser fallback; null when the browser refuses it. */
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

const PAGE_SECRETS_KEY = "neo-angband-mod-secrets:";

const problem = (code: NetProblemCode, text: string): NetProblem => ({ ok: false, code, problem: text });

/** A relay answer that is not the shape the main process sends. */
const garbled = (): NetProblem => problem("unreachable", "The desktop relay sent back an answer the game could not read.");

function isNetResponse(value: unknown): value is ModNetResponse {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v["ok"] === true) return typeof v["status"] === "number" && typeof v["body"] === "string" && typeof v["headers"] === "object";
  return v["ok"] === false && typeof v["problem"] === "string" && typeof v["code"] === "string";
}

function freezeResponse(response: ModNetResponse): ModNetResponse {
  if (response.ok) Object.freeze(response.headers);
  return Object.freeze(response);
}

function secretResult(value: unknown): ModSecretResult {
  if (value !== null && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v["ok"] === true && (v["storage"] === "os" || v["storage"] === "environment" || v["storage"] === "page")) {
      return Object.freeze({ ok: true as const, storage: v["storage"] });
    }
    if (v["ok"] === false && typeof v["problem"] === "string") return Object.freeze({ ok: false as const, problem: v["problem"] });
  }
  return Object.freeze({ ok: false as const, problem: "The desktop relay sent back an answer the game could not read." });
}

/** The desktop transport: every operation goes to the main process. */
function relayNet(deps: ModNetDeps, relay: NetRelayBridge): ModNet {
  const base = { modId: deps.modId, grants: [...deps.grants] };
  const call = async (op: string, arg: Record<string, unknown>): Promise<unknown> => {
    try {
      return await relay.net(op, { ...base, ...arg });
    } catch {
      return undefined;
    }
  };
  return Object.freeze({
    transport: "relay" as const,
    async request(request: NetRequest): Promise<ModNetResponse> {
      const checked = checkNetRequest(request, deps.grants);
      if (!checked.ok) return freezeResponse(checked);
      const answer = await call("request", { request: checked.value });
      return freezeResponse(isNetResponse(answer) ? answer : garbled());
    },
    secrets: Object.freeze({
      storage: "os" as const,
      async set(name: string, value: string, options: { readonly hosts: readonly string[] }) {
        return secretResult(await call("secret-set", { name, value, hosts: [...(options?.hosts ?? [])] }));
      },
      async fromEnv(name: string, variables: readonly string[], options: { readonly hosts: readonly string[] }) {
        return secretResult(await call("secret-env", {
          name, variables: [...(variables ?? [])], hosts: [...(options?.hosts ?? [])], modName: deps.modName,
        }));
      },
      async has(name: string) {
        const answer = (await call("secret-has", { name })) as { present?: unknown; storage?: unknown } | undefined;
        const storage = answer?.storage === "os" || answer?.storage === "environment" ? answer.storage : undefined;
        return Object.freeze(answer?.present === true ? { present: true, ...(storage ? { storage } : {}) } : { present: false });
      },
      async delete(name: string) {
        const answer = (await call("secret-delete", { name })) as { ok?: unknown } | undefined;
        return Object.freeze({ ok: answer?.ok === true });
      },
    }),
  });
}

type PageSecrets = Record<string, { hosts: string[]; value: string }>;

/** The browser transport: `fetch` from the page, secrets in page storage. */
function pageNet(deps: ModNetDeps): ModNet {
  const key = PAGE_SECRETS_KEY + deps.modId;
  const load = (): PageSecrets => {
    try {
      const text = deps.storage?.getItem(key) ?? null;
      if (text === null) return {};
      const parsed = parseDocument(text, modPageSecretsFormat);
      return parsed.ok ? structuredClone(parsed.data.secrets) as PageSecrets : {};
    } catch {
      return {};
    }
  };
  const save = (secrets: PageSecrets): boolean => {
    try {
      if (!deps.storage) return false;
      if (Object.keys(secrets).length === 0) deps.storage.removeItem(key);
      else deps.storage.setItem(key, serializeDocument(modPageSecretsFormat.format, { secrets }));
      return true;
    } catch {
      return false;
    }
  };
  return Object.freeze({
    transport: "page" as const,
    async request(request: NetRequest): Promise<ModNetResponse> {
      const checked = checkNetRequest(request, deps.grants);
      if (!checked.ok) return freezeResponse(checked);
      const { url, method, body, timeoutMs } = checked.value;
      const secrets = load();
      const filled = fillSecretTemplates(checked.value.headers, url, (name) => {
        const found = secrets[name];
        return found ?? { missing: `The secret "${name}" has not been set.` };
      });
      if (!filled.ok) return freezeResponse(filled);
      const usedSecret = secretNamesIn(checked.value.headers).length > 0;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await deps.fetch(url, {
          method,
          headers: filled.headers,
          ...(body !== undefined ? { body } : {}),
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        });
        if (response.type === "opaqueredirect") {
          return freezeResponse(problem("redirect", "The server answered with a redirect, which a browser tab does not follow for a mod. Use the address it redirects to."));
        }
        const text = await readBodyCapped(response.body, NET_LIMITS.responseBytes);
        if (text === null) return freezeResponse(problem("too-large", `The response was larger than ${NET_LIMITS.responseBytes} bytes.`));
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        return freezeResponse({
          ok: true, status: response.status, headers, body: text,
          ...(usedSecret ? { secretStorage: "page" as const } : {}),
        });
      } catch (error) {
        if (controller.signal.aborted) return freezeResponse(problem("timeout", `No complete response within ${timeoutMs} ms.`));
        return freezeResponse(problem(
          "unreachable",
          `The server could not be reached from this browser tab. It may be offline, or it may not allow requests from this page's address (CORS). The desktop app does not have that limit. (${error instanceof Error ? error.message : String(error)})`,
        ));
      } finally {
        clearTimeout(timer);
      }
    },
    secrets: Object.freeze({
      storage: "page" as const,
      async set(name: string, value: string, options: { readonly hosts: readonly string[] }): Promise<ModSecretResult> {
        if (!isSecretName(name)) return Object.freeze({ ok: false as const, problem: "A secret name is kebab-case, such as \"jev-key\"." });
        if (typeof value !== "string" || value === "") return Object.freeze({ ok: false as const, problem: "A secret needs a non-empty string value." });
        const hosts = checkSecretHosts(options?.hosts, deps.grants);
        if (!hosts.ok) return Object.freeze({ ok: false as const, problem: hosts.problem });
        const secrets = load();
        secrets[name] = { hosts: hosts.hosts, value };
        return save(secrets)
          ? Object.freeze({ ok: true as const, storage: "page" as const })
          : Object.freeze({ ok: false as const, problem: "This browser would not let the game store the secret." });
      },
      async fromEnv(): Promise<ModSecretResult> {
        return Object.freeze({ ok: false as const, problem: "Environment variables can only be read by the desktop app." });
      },
      async has(name: string) {
        return Object.freeze(isSecretName(name) && load()[name] ? { present: true, storage: "page" as const } : { present: false });
      },
      async delete(name: string) {
        if (!isSecretName(name)) return Object.freeze({ ok: false });
        const secrets = load();
        delete secrets[name];
        return Object.freeze({ ok: save(secrets) });
      },
    }),
  });
}

/** Build `ctx.net` for one mod, on whichever transport this page has. */
export function createModNet(deps: ModNetDeps): ModNet {
  return deps.relay ? relayNet(deps, deps.relay) : pageNet(deps);
}
