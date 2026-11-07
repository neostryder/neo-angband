/**
 * The host network relay for mods (`ctx.net`, neostryder/neo-angband#300).
 *
 * A mod in the page cannot reach a server that sends no CORS headers for the
 * game's origin, which covers most remote APIs. The
 * main process has no such rule, so the page hands it the request and gets the
 * response back. This module is that relay, with Electron's pieces injected so
 * the rules can be tested in Node.
 *
 * What the main process enforces, whatever the page sends:
 *  - the request itself passes `checkNetRequest` (http or https, size limits,
 *    no reserved headers) against the main process's authority entry;
 *  - every redirect hop lands on a covered host, and at most NET_LIMITS.redirects;
 *  - a secret is substituted only into a request to a host listed when the
 *    secret was stored, and its value never goes back to the page;
 *  - an environment variable is read only after the player agreed, in a native
 *    dialog the page cannot answer, to send it to the named hosts.
 * Authority handles are issued after native consent and expire on revocation
 * or navigation. The transport also checks DNS when opening the socket.
 */

import {
  NET_LIMITS,
  checkNetRequest,
  checkSecretHosts,
  fillSecretTemplates,
  isSecretName,
  modSecretsFormat,
  networkGrantCovers,
  networkRequestCapability,
  parseDocument,
  parseCapability,
  secretNamesIn,
  serializeDocument,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { CheckedNetRequest, NetProblem, NetSecretValue } from "@rpgm-tools/neo-angband-mod-sdk";
import { isBlockedHostname, isBlockedIp } from "./net-guard.js";
import { createHash, randomBytes } from "node:crypto";

export interface DesktopAuthorityEntry {
  readonly modId: string;
  readonly digest: string;
  readonly key: string;
  readonly grants: readonly string[];
  readonly destinations: readonly string[];
  readonly signal: AbortSignal;
}

export function createDesktopAuthority() {
  const entries = new Map<string, { owner: number; token: string; entry: DesktopAuthorityEntry; controller: AbortController }>();
  const pending = new Map<number, { key: string; controller: AbortController }>();
  const attempts = new Map<number, number[]>();
  const revoke = (key: string): void => {
    const record = entries.get(key);
    entries.delete(key);
    record?.controller.abort();
  };
  const list = (value: unknown): string[] | null => Array.isArray(value) && value.length <= 256 &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256 && /^[\x21-\x7e]+$/u.test(item))
    ? [...new Set(value as string[])].sort() : null;
  const identify = (a: Record<string, unknown>): { modId: string; digest: string; key: string } | null => {
    const { modId, digest } = a;
    if (typeof modId !== "string" || !/^[a-zA-Z0-9@][a-zA-Z0-9@/._:-]{0,127}$/u.test(modId) ||
      typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) return null;
    return { modId, digest, key: createHash("sha256").update(JSON.stringify([modId, digest])).digest("hex") };
  };
  return {
    lookup(arg: unknown, owner: number): DesktopAuthorityEntry | null {
      if (!arg || typeof arg !== "object" || Array.isArray(arg)) return null;
      const a = arg as Record<string, unknown>;
      if (typeof a["installation"] !== "string" || a["installation"].length !== 64) return null;
      for (const record of entries.values()) {
        const entry = record.entry;
        if (record.owner !== owner || record.token !== a["installation"]) continue;
        if ((a["modId"] !== undefined && a["modId"] !== entry.modId) ||
          (a["digest"] !== undefined && a["digest"] !== entry.digest)) return null;
        if (a["grants"] !== undefined) {
          const claimed = list(a["grants"]);
          if (!claimed || claimed.some((cap) => !entry.grants.includes(cap) && !entry.grants.includes(`network:${cap}`))) return null;
        }
        return entry;
      }
      return null;
    },
    async report(arg: unknown, owner: number, confirm: (entry: DesktopAuthorityEntry) => Promise<boolean>): Promise<unknown> {
      const refused = { ok: false, code: "not-declared", problem: "The desktop installation is not authorized." };
      if (!arg || typeof arg !== "object" || Array.isArray(arg)) return refused;
      const a = arg as Record<string, unknown>;
      if (Object.keys(a).some((key) => !["modId", "digest", "grants", "destinations", "installation", "revoke"].includes(key))) return refused;
      const identity = identify(a);
      if (!identity) return refused;
      const slot = `${owner}:${identity.key}`;
      if (a["revoke"] === true) {
        revoke(slot);
        if (pending.get(owner)?.key === slot) pending.get(owner)?.controller.abort();
        return { ok: true };
      }
      const grants = list(a["grants"]);
      const destinations = list(a["destinations"]);
      if (!grants || !destinations || grants.some((cap) => cap !== "backup:folder" && !cap.startsWith("network:"))) return refused;
      try {
        for (const cap of grants) parseCapability(cap);
        if (destinations.some((host) => host === "*" || host === "local" ||
          !checkSecretHosts([host], grants.filter((cap) => cap.startsWith("network:")).map((cap) => cap.slice(8))).ok)) return refused;
      } catch { return refused; }
      const prior = entries.get(slot);
      const held = prior !== undefined && prior.token === a["installation"];
      const widening = !held || grants.some((cap) => !prior.entry.grants.includes(cap)) || destinations.some((host) => !prior.entry.destinations.includes(host));
      if (held && !widening && JSON.stringify([grants, destinations]) === JSON.stringify([prior.entry.grants, prior.entry.destinations])) {
        return { ok: true, installation: prior.token, modId: identity.modId, digest: identity.digest };
      }
      const controller = new AbortController();
      const entry: DesktopAuthorityEntry = Object.freeze({ ...identity, grants: Object.freeze(grants), destinations: Object.freeze(destinations), signal: controller.signal });
      if (widening) {
        const recent = (attempts.get(owner) ?? []).filter((stamp) => Date.now() - stamp < 60_000);
        if (pending.has(owner) || recent.length >= 10 || entries.size >= 128) return refused;
        attempts.set(owner, [...recent, Date.now()]);
        pending.set(owner, { key: slot, controller });
        try {
          if (!(await confirm(entry)) || controller.signal.aborted) return refused;
        } catch { return refused; }
        finally { if (pending.get(owner)?.controller === controller) pending.delete(owner); }
      }
      if (controller.signal.aborted) return refused;
      if (held && prior.entry.grants.every((cap) => grants.includes(cap)) && prior.entry.destinations.every((host) => destinations.includes(host))) {
        entries.set(slot, { ...prior, entry: Object.freeze({ ...entry, signal: prior.controller.signal }) });
        return { ok: true, installation: prior.token, modId: identity.modId, digest: identity.digest };
      }
      if (!widening && pending.get(owner)?.key === slot) pending.get(owner)?.controller.abort();
      for (const [key, record] of entries) {
        if (record.owner === owner && record.entry.modId === identity.modId) revoke(key);
      }
      revoke(slot);
      const token = randomBytes(32).toString("hex");
      entries.set(slot, { owner, token, entry, controller });
      return { ok: true, installation: token, modId: identity.modId, digest: identity.digest };
    },
    revokeWindow(owner: number): void {
      pending.get(owner)?.controller.abort();
      for (const [key, record] of entries) if (record.owner === owner) revoke(key);
      attempts.delete(owner);
    },
  };
}

export type DesktopAuthority = ReturnType<typeof createDesktopAuthority>;

/** One stored secret, as the secrets file holds it. */
interface StoredSecret {
  hosts: string[];
  encrypted?: string;
  env?: string[];
}

type SecretStore = Record<string, Record<string, StoredSecret>>;

export interface NetRelayDeps {
  readonly authority: DesktopAuthority;
  readonly fetch: typeof fetch;
  /** Reads an environment variable of the game's process. */
  readonly env: (name: string) => string | undefined;
  /** OS-backed string encryption (Electron safeStorage), as base64. */
  readonly encryption: {
    available(): boolean;
    encrypt(value: string): string;
    decrypt(encoded: string): string;
  };
  /** The secrets file's text, or null when there is none. */
  readonly readStore: () => string | null;
  readonly writeStore: (text: string) => void;
  /** Ask the player, natively, whether a mod may send environment variables to these hosts. */
  readonly confirmEnv: (ask: { modName: string; variables: readonly string[]; hosts: readonly string[] }) => Promise<boolean>;
  readonly resolveHost: (hostname: string) => Promise<readonly string[]>;
  readonly now?: () => number;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const fail = (code: NetProblem["code"], problem: string): NetProblem => ({ ok: false, code, problem });

async function readRelayBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal): Promise<string | null> {
  if (body === null) return "";
  const reader = body.getReader();
  const abort = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > NET_LIMITS.responseBytes) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
    if (signal.aborted) throw new Error("The request was canceled.");
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? [...value] : null;
}

export function createNetRelay(deps: NetRelayDeps): { handle(op: unknown, arg: unknown, windowId?: number): Promise<unknown> } {
  const hits = new Map<number, number[]>();
  const active = new Map<number, number>();
  const now = deps.now ?? Date.now;
  const allowRate = (windowId: number): boolean => {
    const stamp = now();
    const recent = (hits.get(windowId) ?? []).filter((t) => stamp - t < 10_000);
    if (recent.length >= 60) return false;
    recent.push(stamp);
    hits.set(windowId, recent);
    return true;
  };

  const publicHost = async (hostname: string, signal: AbortSignal): Promise<boolean> => {
    if (isBlockedHostname(hostname)) return false;
    if (signal.aborted) throw new Error("The request timed out.");
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error("The request timed out."));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const addresses = await Promise.race([deps.resolveHost(hostname), aborted]);
      return addresses.length > 0 && addresses.every((address) => !isBlockedIp(address));
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  const load = (): SecretStore => {
    const text = deps.readStore();
    if (text === null) return {};
    const parsed = parseDocument(text, modSecretsFormat.format);
    return parsed.ok ? structuredClone(parsed.data as { mods: SecretStore }).mods : {};
  };
  const save = (store: SecretStore): void => {
    deps.writeStore(serializeDocument(modSecretsFormat.format, { mods: store }));
  };

  /** A secret's value for a request, or the sentence saying why there is none. */
  const resolve = (store: SecretStore, modId: string, name: string): NetSecretValue | { missing: string } => {
    const secret = store[modId]?.[name];
    if (!secret) return { missing: `The secret "${name}" has not been set.` };
    if (secret.env) {
      for (const variable of secret.env) {
        const value = deps.env(variable);
        if (value !== undefined && value !== "") return { value, hosts: secret.hosts };
      }
      return { missing: `None of ${secret.env.join(", ")} is set in the environment the game was started from.` };
    }
    if (secret.encrypted === undefined) return { missing: `The secret "${name}" has no value.` };
    try {
      return { value: deps.encryption.decrypt(secret.encrypted), hosts: secret.hosts };
    } catch {
      return { missing: `The secret "${name}" could not be decrypted on this computer. Set it again.` };
    }
  };

  const request = async (entry: DesktopAuthorityEntry, raw: unknown): Promise<unknown> => {
    const modId = entry.key;
    const grants = entry.grants.filter((cap) => cap.startsWith("network:")).map((cap) => cap.slice(8));
    const checked = checkNetRequest(raw, grants);
    if (!checked.ok) return checked;
    const target = new URL(checked.value.url);
    if (target.username || target.password) return fail("bad-request", "A request URL cannot contain credentials.");
    if (Buffer.byteLength(JSON.stringify(checked.value.headers), "utf8") > 16 * 1024) return fail("too-large", "The request headers exceed 16 KiB.");
    const store = load();
    const usesSecrets = secretNamesIn(checked.value.headers).length > 0;
    const headers = Object.fromEntries(Object.entries(checked.value.headers).filter(([name, value]) => {
      const key = name.toLowerCase();
      return key !== "cookie" && key !== "proxy-authorization" &&
        (key !== "authorization" || /^(?:[A-Za-z]+ )?\{secret:[^{}\s]+\}$/u.test(value));
    }));
    let current: CheckedNetRequest = { ...checked.value, headers };
    const controller = new AbortController();
    const revoke = (): void => { controller.abort(); };
    entry.signal.addEventListener("abort", revoke, { once: true });
    if (entry.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), current.timeoutMs);
    try {
      for (let hop = 0; ; hop++) {
        const target = new URL(current.url);
        if (controller.signal.aborted) throw new Error("The request was canceled.");
        const cap = networkRequestCapability(current.url);
        if (!cap || !networkGrantCovers(grants, cap) || !networkGrantCovers(entry.destinations, cap)) {
          return fail(hop === 0 ? "not-declared" : "redirect", "The destination is not approved for this installation.");
        }
        if (target.username || target.password) return fail("redirect", "A redirect URL cannot contain credentials.");
        if (!(await publicHost(target.hostname, controller.signal))) {
          return fail(hop === 0 ? "not-declared" : "redirect", "The desktop relay refuses private, loopback, link-local, and metadata destinations.");
        }
        if (controller.signal.aborted) throw new Error("The request was canceled.");
        const filled = fillSecretTemplates(current.headers, current.url, (name) => resolve(store, modId, name));
        if (!filled.ok) return hop === 0 ? filled : fail("redirect", `The server redirected to ${current.url}, which the request's secrets may not be sent to.`);
        if (Buffer.byteLength(JSON.stringify(filled.headers), "utf8") > 16 * 1024) return fail("too-large", "The request headers exceed 16 KiB.");
        const response = await deps.fetch(current.url, {
          method: current.method,
          headers: filled.headers,
          ...(current.body !== undefined ? { body: current.body } : {}),
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error("The request was canceled.");
        }
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          await response.body?.cancel().catch(() => undefined);
          if (hop >= NET_LIMITS.redirects) return fail("redirect", `The server redirected more than ${NET_LIMITS.redirects} times.`);
          const next = new URL(location, current.url).toString();
          const cap = networkRequestCapability(next);
          if (cap === null || !networkGrantCovers(grants, cap) || !networkGrantCovers(entry.destinations, cap)) {
            return fail("redirect", "The redirect destination is not approved for this installation.");
          }
          const toGet = response.status === 303 || ((response.status === 301 || response.status === 302) && current.method === "POST");
          if (toGet) {
            const { body: _dropped, ...rest } = current;
            current = { ...rest, url: next, method: "GET" };
          } else {
            current = { ...current, url: next };
          }
          continue;
        }
        const body = await readRelayBody(response.body, controller.signal);
        if (entry.signal.aborted) return fail("not-declared", "The installation's authority was revoked.");
        if (body === null) return fail("too-large", `The response was larger than ${NET_LIMITS.responseBytes} bytes.`);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === "set-cookie") return;
          headers[key.toLowerCase()] = value;
        });
        const storage = usesSecrets ? secretStorageOf(store, modId, secretNamesIn(checked.value.headers)) : undefined;
        return { ok: true, status: response.status, headers, body, ...(storage ? { secretStorage: storage } : {}) };
      }
    } catch {
      if (entry.signal.aborted) return fail("not-declared", "The installation's authority was revoked.");
      if (controller.signal.aborted) return fail("timeout", `No complete response within ${current.timeoutMs} ms.`);
      return fail("unreachable", "The server could not be reached.");
    } finally {
      clearTimeout(timer);
      entry.signal.removeEventListener("abort", revoke);
    }
  };

  const setSecret = (modId: string, grants: readonly string[], a: Record<string, unknown>): unknown => {
    if (!isSecretName(a["name"])) return fail("bad-request", "A secret name is kebab-case, such as \"jev-key\".");
    if (typeof a["value"] !== "string" || a["value"] === "") return fail("bad-request", "A secret needs a non-empty string value.");
    if (Buffer.byteLength(a["value"], "utf8") > 8192) return fail("too-large", "A secret cannot exceed 8 KiB.");
    const hosts = checkSecretHosts(a["hosts"], grants);
    if (!hosts.ok) return hosts;
    if (!deps.encryption.available()) {
      return fail("secret-missing", "This computer offers no encrypted storage for the game, so the secret was not kept. Set an environment variable instead.");
    }
    const store = load();
    (store[modId] ??= {})[a["name"]] = { hosts: hosts.hosts, encrypted: deps.encryption.encrypt(a["value"]) };
    save(store);
    return { ok: true, storage: "os" };
  };

  const envSecret = async (entry: DesktopAuthorityEntry, grants: readonly string[], a: Record<string, unknown>): Promise<unknown> => {
    const modId = entry.key;
    if (!isSecretName(a["name"])) return fail("bad-request", "A secret name is kebab-case, such as \"jev-key\".");
    const variables = stringList(a["variables"]);
    if (!variables || variables.length === 0 || variables.length > 8 || variables.some((v) => !ENV_NAME.test(v))) {
      return fail("bad-request", "List one to eight environment variable names, such as TYPESAFE_API_KEY.");
    }
    const hosts = checkSecretHosts(a["hosts"], grants);
    if (!hosts.ok) return hosts;
    const store = load();
    const existing = store[modId]?.[a["name"]];
    const same = existing?.env !== undefined &&
      existing.env.join("\n") === variables.join("\n") &&
      [...existing.hosts].sort().join("\n") === [...hosts.hosts].sort().join("\n");
    if (!same) {
      const modName = entry.modId;
      if (!(await deps.confirmEnv({ modName, variables, hosts: hosts.hosts }))) {
        return fail("secret-missing", "The player chose not to share those environment variables.");
      }
      if (entry.signal.aborted) return fail("not-declared", "The installation's authority was revoked.");
      (store[modId] ??= {})[a["name"]] = { hosts: hosts.hosts, env: variables };
      save(store);
    }
    return { ok: true, storage: "environment" };
  };

  return {
    async handle(op: unknown, arg: unknown, windowId = -1): Promise<unknown> {
      if (!allowRate(windowId)) return fail("bad-request", "This window sent too many network calls.");
      const a = (arg !== null && typeof arg === "object" ? arg : {}) as Record<string, unknown>;
      if (op === "info") return { encryption: deps.encryption.available() };
      const entry = deps.authority.lookup(arg, windowId);
      if (!entry || !entry.grants.some((cap) => cap.startsWith("network:"))) return fail("not-declared", "The desktop installation is not authorized.");
      const modId = entry.key;
      const grants = entry.grants.filter((cap) => cap.startsWith("network:")).map((cap) => cap.slice(8));
      try {
        switch (op) {
          case "request":
            if (!modId) return fail("bad-request", "The request did not say which mod sent it.");
            if ((active.get(windowId) ?? 0) >= 8) return fail("bad-request", "This window has too many active requests.");
            active.set(windowId, (active.get(windowId) ?? 0) + 1);
            try {
              return await request(entry, a["request"]);
            } finally {
              active.set(windowId, (active.get(windowId) ?? 1) - 1);
            }
          case "secret-set":
            if (!modId) return fail("bad-request", "The request did not say which mod sent it.");
            if (!checkSecretHosts(a["hosts"], entry.destinations).ok) return fail("not-declared", "The secret destination is not approved.");
            return setSecret(modId, grants, a);
          case "secret-env":
            if (!modId) return fail("bad-request", "The request did not say which mod sent it.");
            if (!checkSecretHosts(a["hosts"], entry.destinations).ok) return fail("not-declared", "The secret destination is not approved.");
            return await envSecret(entry, grants, a);
          case "secret-has": {
            if (!modId || !isSecretName(a["name"])) return { present: false };
            const secret = load()[modId]?.[a["name"]];
            return secret ? { present: true, storage: secret.env ? "environment" : "os" } : { present: false };
          }
          case "secret-delete": {
            if (!modId || !isSecretName(a["name"])) return { ok: false };
            const store = load();
            if (store[modId]?.[a["name"]] === undefined) return { ok: true };
            delete store[modId]![a["name"]];
            if (Object.keys(store[modId]!).length === 0) delete store[modId];
            save(store);
            return { ok: true };
          }
          default:
            return fail("bad-request", "The relay operation is unknown.");
        }
      } catch {
        /* An exception in an invoke handler becomes a rejected promise in the page
         * with Electron's own wording, so it is answered as a problem instead. */
        return fail("unreachable", "The relay failed.");
      }
    },
  };
}

/** Where the secrets a request used are kept: "environment" or "os". */
function secretStorageOf(store: SecretStore, modId: string, names: readonly string[]): "environment" | "os" | undefined {
  const kinds = names.map((name) => (store[modId]?.[name]?.env ? "environment" : "os"));
  if (kinds.length === 0) return undefined;
  return kinds.includes("os") ? "os" : "environment";
}
