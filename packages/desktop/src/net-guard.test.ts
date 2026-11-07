/**
 * Address readings the desktop relay refuses, including the ones a URL parser
 * and a DNS answer can disagree about.
 */

import * as dns from "node:dns";
import { describe, expect, it } from "vitest";
import { createCheckedFetch, guardLookup, isBlockedHostname, isBlockedIp } from "./net-guard.js";

describe("blocked addresses", () => {
  it("refuses loopback, link-local, private, metadata, and the odd literal forms", () => {
    for (const host of [
      "127.0.0.1",
      "127.1",
      "2130706433",
      "0x7f000001",
      "0177.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "64:ff9b::7f00:1",
      "localhost",
      "printer.local",
      "app.localhost",
      "metadata.google.internal",
      "localhost.",
      "100.64.0.1",
      "168.63.129.16",
      "0:0:0:0:0:0:0:1",
      "0:0:0:0:0:ffff:7f00:1",
      "fec0::1",
      "ff02::1",
      "fe80::1%eth0",
    ]) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
    expect(isBlockedHostname("api.example.com")).toBe(false);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("fails a lookup closed when the resolver answers with a private address", async () => {
    const fake = ((
      _hostname: string,
      _options: dns.LookupOptions,
      callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
    ) => {
      callback(null, [{ address: "10.1.2.3", family: 4 }]);
    }) as typeof dns.lookup;
    const guarded = guardLookup(fake);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      guarded("api.example.com", {}, (err) => resolve(err));
    });
    expect(error?.code).toBe("ECONNREFUSED");
  });

  it("does not open a request to a loopback literal", async () => {
    const fetch = createCheckedFetch();
    await expect(fetch("http://127.0.0.1/")).rejects.toThrow(/refused/u);
  });

  it("refuses a rebinding answer at connect time without reaching a loopback server", async () => {
    let calls = 0;
    const fake = ((_hostname: string, _options: dns.LookupOptions, callback: (err: null, addresses: dns.LookupAddress[]) => void) => {
      calls++;
      callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    }) as typeof dns.lookup;
    await expect(createCheckedFetch(fake)("http://api.example.com/")).rejects.toThrow(/refused/u);
    expect(calls).toBe(1);
  });
});
