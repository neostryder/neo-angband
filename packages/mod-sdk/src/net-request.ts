/**
 * The rules for a mod's HTTP request through `ctx.net`, shared by the page and
 * the desktop app's main process so both refuse the same requests with the same
 * words. The page checks first to answer quickly; the main process checks again
 * because anything on the page can reach its channel.
 */

import { CapabilityError, networkGrantCovers, networkRequestCapability } from "./capabilities.js";

/** The limits every request is held to. */
export const NET_LIMITS = Object.freeze({
  /** Longest URL accepted, in characters. */
  urlLength: 8192,
  /** Largest request body, in UTF-8 bytes. */
  requestBytes: 1024 * 1024,
  /** Largest response body read, in bytes. A longer one fails with `too-large`. */
  responseBytes: 4 * 1024 * 1024,
  /** Default time to wait for the whole response, in milliseconds. */
  defaultTimeoutMs: 30_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 120_000,
  /** Redirects followed before giving up; each hop must be a declared host. */
  redirects: 3,
});

export type NetMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What a mod passes to `ctx.net.request`. */
export interface NetRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

/** A request that passed `checkNetRequest`, with its defaults filled in. */
export interface CheckedNetRequest {
  readonly url: string;
  readonly method: NetMethod;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}

export type NetProblemCode =
  | "not-declared"
  | "bad-request"
  | "secret-missing"
  | "secret-host"
  | "redirect"
  | "too-large"
  | "timeout"
  | "unreachable";

export interface NetProblem {
  readonly ok: false;
  readonly code: NetProblemCode;
  readonly problem: string;
}

const METHODS: readonly NetMethod[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
/** Header names the transport sets itself, or that would carry the page's own state. */
const RESERVED_HEADERS = new Set(["host", "cookie", "content-length", "connection", "transfer-encoding", "origin", "referer"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SECRET_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TEMPLATE = /\{secret:([^}]*)\}/g;

const problem = (code: NetProblemCode, text: string): NetProblem => ({ ok: false, code, problem: text });

/** True when `name` can name a secret: kebab-case, starting with a letter. */
export function isSecretName(name: unknown): name is string {
  return typeof name === "string" && name.length <= 64 && SECRET_NAME.test(name);
}

/**
 * Validate `request` and fill in its defaults. `grants` are the mod's `network:`
 * grant hosts (`CapabilitySet.networkGrants()`); the URL's host must be covered
 * by one of them.
 */
export function checkNetRequest(
  request: unknown,
  grants: readonly string[],
): { readonly ok: true; readonly value: CheckedNetRequest } | NetProblem {
  if (request === null || typeof request !== "object") return problem("bad-request", "A request needs at least a url.");
  const r = request as Record<string, unknown>;
  if (typeof r["url"] !== "string" || r["url"].length > NET_LIMITS.urlLength) {
    return problem("bad-request", `The url must be a string of at most ${NET_LIMITS.urlLength} characters.`);
  }
  const url = r["url"];
  const cap = networkRequestCapability(url);
  if (cap === null) return problem("bad-request", "Only absolute http and https URLs can be requested.");
  if (!networkGrantCovers(grants, cap)) {
    return problem("not-declared", `This mod's manifest does not ask for "${cap}", so the request was not sent.`);
  }
  const method = (typeof r["method"] === "string" ? r["method"].toUpperCase() : "GET") as NetMethod;
  if (!METHODS.includes(method)) return problem("bad-request", `The method must be one of ${METHODS.join(", ")}.`);
  const headers: Record<string, string> = {};
  if (r["headers"] !== undefined) {
    if (r["headers"] === null || typeof r["headers"] !== "object" || Array.isArray(r["headers"])) {
      return problem("bad-request", "headers must be an object of strings.");
    }
    for (const [name, value] of Object.entries(r["headers"] as Record<string, unknown>)) {
      if (!HEADER_NAME.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) {
        return problem("bad-request", `The header "${name}" needs a plain name and a one-line string value.`);
      }
      if (RESERVED_HEADERS.has(name.toLowerCase())) {
        return problem("bad-request", `The header "${name}" is set by the game and cannot be sent by a mod.`);
      }
      for (const match of value.matchAll(TEMPLATE)) {
        if (!isSecretName(match[1])) {
          return problem("bad-request", `"{secret:${match[1] ?? ""}}" in the header "${name}" does not name a secret.`);
        }
      }
      headers[name] = value;
    }
  }
  let body: string | undefined;
  if (r["body"] !== undefined) {
    if (typeof r["body"] !== "string") return problem("bad-request", "body must be a string.");
    if (method === "GET" || method === "HEAD") return problem("bad-request", `A ${method} request cannot carry a body.`);
    if (new TextEncoder().encode(r["body"]).length > NET_LIMITS.requestBytes) {
      return problem("too-large", `The request body is larger than ${NET_LIMITS.requestBytes} bytes.`);
    }
    body = r["body"];
  }
  const asked = typeof r["timeoutMs"] === "number" && Number.isFinite(r["timeoutMs"]) ? r["timeoutMs"] : NET_LIMITS.defaultTimeoutMs;
  const timeoutMs = Math.min(NET_LIMITS.maxTimeoutMs, Math.max(NET_LIMITS.minTimeoutMs, Math.round(asked)));
  return { ok: true, value: { url, method, headers, ...(body !== undefined ? { body } : {}), timeoutMs } };
}

/** The distinct secret names the header templates use, in order of first use. */
export function secretNamesIn(headers: Readonly<Record<string, string>>): string[] {
  const names: string[] = [];
  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(TEMPLATE)) {
      const name = match[1] as string;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** A secret a request may use: its value and the hosts it may be sent to. */
export interface NetSecretValue {
  readonly value: string;
  readonly hosts: readonly string[];
}

/**
 * Replace every `{secret:name}` in `headers` for a request to `url`. Each secret
 * must exist and list a host covering `url`; otherwise the request is refused
 * and nothing is sent.
 */
export function fillSecretTemplates(
  headers: Readonly<Record<string, string>>,
  url: string,
  lookup: (name: string) => NetSecretValue | { readonly missing: string },
): { readonly ok: true; readonly headers: Record<string, string> } | NetProblem {
  const cap = networkRequestCapability(url);
  const values = new Map<string, string>();
  for (const name of secretNamesIn(headers)) {
    const found = lookup(name);
    if ("missing" in found) return problem("secret-missing", found.missing);
    if (cap === null || !networkGrantCovers(found.hosts, cap)) {
      return problem("secret-host", `The secret "${name}" is not set up to be sent to ${cap?.slice("network:".length) ?? url}.`);
    }
    values.set(name, found.value);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = value.replace(TEMPLATE, (_m, name: string) => values.get(name) ?? "");
  }
  return { ok: true, headers: out };
}

/**
 * Check the hosts a secret is being bound to: each must be a valid `network:`
 * host that one of the mod's own grants covers.
 */
export function checkSecretHosts(hosts: unknown, grants: readonly string[]): { readonly ok: true; readonly hosts: string[] } | NetProblem {
  if (!Array.isArray(hosts) || hosts.length === 0 || hosts.some((h) => typeof h !== "string")) {
    return problem("bad-request", "A secret needs a list of the hosts it may be sent to.");
  }
  const out: string[] = [];
  for (const host of hosts as string[]) {
    let covered: boolean;
    try {
      covered = networkGrantCovers(grants, `network:${host}`);
    } catch (error) {
      if (error instanceof CapabilityError) return problem("bad-request", `"${host}" is not a host.`);
      throw error;
    }
    if (!covered) return problem("not-declared", `This mod's manifest does not ask for "network:${host}".`);
    out.push(host.toLowerCase());
  }
  return { ok: true, hosts: out };
}

/**
 * Read a response body up to `limit` bytes. Resolves null when the body is
 * longer, after cancelling the rest of it.
 */
export async function readBodyCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
