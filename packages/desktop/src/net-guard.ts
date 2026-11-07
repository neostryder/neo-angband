/**
 * The desktop relay refuses destinations that can reach this computer or its private networks.
 *
 * The relay runs in the main process, so it is not bound by the page's CORS
 * rules. A name the player accepted can still be pointed at a loopback, link-local,
 * private, or metadata address between the check and the connect. Callers resolve
 * before the request and pass the looked-up address through `guardLookup` at connect time.
 */

import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { Readable } from "node:stream";

const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
]);

export function isBlockedHostname(hostname: string): boolean {
  const host = bareHost(hostname);
  if (host === "" || BLOCKED_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) return blockedV6(host);
  const forms = interpretations(host);
  return forms.length > 0 && forms.some((ip) => blockedV4(ip));
}

export function isBlockedIp(raw: string): boolean {
  const ip = bareHost(raw);
  if (ip.includes(":")) return blockedV6(ip);
  const forms = interpretations(ip);
  if (forms.length === 0) return true;
  return forms.some((form) => blockedV4(form));
}

/**
 * The lookup fails closed when any address is blocked.
 *
 * `base` is injectable so a test can hand back an address without a real resolver.
 */
export function guardLookup(base: typeof dns.lookup = dns.lookup): net.LookupFunction {
  const guarded: net.LookupFunction = (hostname, options, callback) => {
    if (isBlockedHostname(hostname)) {
      callback(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), "", 0);
      return;
    }
    base(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, "", 0);
        return;
      }
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address, family }) =>
        typeof address !== "string" || net.isIP(address) !== family || isBlockedIp(address))) {
        callback(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), "", 0);
        return;
      }
      const first = addresses[0]!;
      callback(null, options.all ? addresses : first.address, first.family);
    });
  };
  return guarded;
}

/**
 * This transport asks `guardLookup` which address to connect to.
 *
 * Node's own fetch does not take a resolver. The relay follows redirects itself,
 * so this wrapper only performs one hop and can be given a lookup that refuses
 * a private address at the moment of the connect.
 */
export function createCheckedFetch(baseLookup: typeof dns.lookup = dns.lookup): typeof fetch {
  const lookup = guardLookup(baseLookup);
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || isBlockedHostname(url.hostname)) {
      throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    }
    const lib = url.protocol === "https:" ? https : http;
    const method = init?.method ?? "GET";
    const headers = headerPairs(init?.headers);
    const body = typeof init?.body === "string" ? init.body : undefined;
    return await new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers, lookup, agent: false }, (res) => {
        const pairs: [string, string][] = [];
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) {
            for (const item of value) pairs.push([key, item]);
          } else {
            pairs.push([key, value]);
          }
        }
        try {
          const status = res.statusCode ?? 0;
          const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
          if (noBody) res.resume();
          resolve(new Response(noBody ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, {
            status,
            headers: pairs,
          }));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      });
      const signal = init?.signal ?? undefined;
      const onAbort = (): void => {
        req.destroy(Object.assign(new Error("aborted"), { name: "AbortError" }));
      };
      req.on("error", reject);
      req.once("close", () => signal?.removeEventListener("abort", onAbort));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      req.end(body);
    });
  };
}

function headerPairs(headers: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers || Array.isArray(headers)) {
    const list = headers instanceof Headers ? [...headers.entries()] : headers;
    for (const [key, value] of list) out[key] = value;
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function bareHost(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/u, "");
}

function interpretations(host: string): string[] {
  if (net.isIP(host) === 4) return [host];
  if (host.includes(":")) return [];
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return [];
  const decimal: number[] = [];
  const alternate: number[] = [];
  let split = false;
  for (const part of parts) {
    if (part === "") return [];
    if (/^0x[0-9a-f]+$/iu.test(part)) {
      const n = Number.parseInt(part.slice(2), 16);
      if (!Number.isFinite(n)) return [];
      decimal.push(n);
      alternate.push(n);
      continue;
    }
    if (!/^\d+$/u.test(part)) return [];
    const dec = Number.parseInt(part, 10);
    if (!Number.isFinite(dec)) return [];
    decimal.push(dec);
    if (part.length > 1 && part.startsWith("0") && /^[0-7]+$/u.test(part)) {
      split = true;
      alternate.push(Number.parseInt(part, 8));
    } else {
      alternate.push(dec);
    }
  }
  const out: string[] = [];
  const first = pack(decimal, parts.length);
  if (first) out.push(first);
  if (split) {
    const second = pack(alternate, parts.length);
    if (second && second !== first) out.push(second);
  }
  return out;
}

function pack(nums: readonly number[], count: number): string | null {
  for (let i = 0; i < nums.length; i++) {
    const width = i === nums.length - 1 ? 32 - 8 * (count - 1) : 8;
    if ((nums[i] ?? 0) < 0 || (nums[i] ?? 0) >= 2 ** width) return null;
  }
  let value = 0;
  if (count === 1) value = nums[0] ?? 0;
  else if (count === 2) value = ((nums[0] ?? 0) * 2 ** 24) + (nums[1] ?? 0);
  else if (count === 3) value = ((nums[0] ?? 0) * 2 ** 24) + ((nums[1] ?? 0) * 2 ** 16) + (nums[2] ?? 0);
  else value = ((nums[0] ?? 0) * 2 ** 24) + ((nums[1] ?? 0) * 2 ** 16) + ((nums[2] ?? 0) * 2 ** 8) + (nums[3] ?? 0);
  value >>>= 0;
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function blockedV4(v4: string): boolean {
  if (net.isIP(v4) !== 4) return true;
  const parts = v4.split(".").map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (v4 === "168.63.129.16") return true;
  if (a >= 224) return true;
  return false;
}

function blockedV6(ip: string): boolean {
  if (net.isIP(ip) !== 6 || ip.includes("%")) return true;
  ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = mappedV4(ip);
  if (mapped !== null) return isBlockedIp(mapped);
  if (ip === "::" || ip === "::1") return true;
  const head = ip.split(":")[0] ?? "";
  if (head === "") return ip.startsWith("::");
  const word = Number.parseInt(head, 16);
  if (!Number.isFinite(word)) return true;
  if ((word & 0xe000) !== 0x2000) return true;
  return ip.startsWith("2002:") || ip.startsWith("2001:0:") || ip.startsWith("2001::");
}

function mappedV4(ip: string): string | null {
  const v4tail = /(?:::(?:ffff:)?)(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(ip);
  if (v4tail?.[1] && interpretations(v4tail[1]).length > 0) return v4tail[1];
  const nat = /^64:ff9b(?::0){0,4}:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(ip);
  const hex = nat ?? /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(ip);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1] ?? "", 16);
  const lo = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >>> 8) & 255}.${hi & 255}.${(lo >>> 8) & 255}.${lo & 255}`;
}
