/**
 * Address readings the desktop relay refuses, including the ones a URL parser
 * and a DNS answer can disagree about.
 */

import * as dns from "node:dns";
import { describe, expect, it, vi } from "vitest";
import { confirmExternalOpen, createCheckedFetch, guardLookup, isBlockedHostname, isBlockedIp } from "./net-guard.js";

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


describe("external browser decisions", () => {
  it("requires confirmation of the full help or release URL before opening", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const open = vi.fn(async () => {});
    for (const url of ["https://www.angband.live/", "https://github.com/neostryder/neo-angband/releases?x=1#latest"]) {
      const confirm = vi.fn(async () => false);
      await confirmExternalOpen(url, confirm, open, resolve);
      expect(confirm).toHaveBeenCalledWith("Open this URL in your browser?\n" + url, "Open");
      expect(open).not.toHaveBeenCalled();
      await confirmExternalOpen(url, async () => true, open, resolve);
      expect(open).toHaveBeenLastCalledWith(url);
      open.mockClear();
    }
  });

  it("refuses local names, address literals, credentials, and private DNS answers", async () => {
    const confirm = vi.fn(async () => true);
    const open = vi.fn(async () => {});
    const resolve = vi.fn(async () => [{ address: "10.0.0.1", family: 4 }]);
    for (const url of ["http://localhost/", "http://metadata.google.internal/", "http://printer.local/", "http://127.1/", "http://0x7f000001/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/", "http://192.168.1.1/", "https://user:credential@example.com/", "file:///test", "broken", "https://private.example/"]) {
      await confirmExternalOpen(url, confirm, open, resolve);
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await confirmExternalOpen("https://example.com/", confirm, open, async () => { throw new Error("DNS failed"); });
    await confirmExternalOpen("https://example.com/", confirm, open, async () => []);
    expect(open).not.toHaveBeenCalled();
  });

  it("checks DNS again after the decision and contains dialog and shell failures", async () => {
    const open = vi.fn(async () => {});
    let calls = 0;
    const resolve = async () => [{ address: ++calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    await confirmExternalOpen("https://example.com/", async () => true, open, resolve);
    expect(open).not.toHaveBeenCalled();
    const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
    await confirmExternalOpen("https://example.com/", async () => { throw new Error("closed"); }, open, publicDns);
    expect(open).not.toHaveBeenCalled();
    await expect(confirmExternalOpen("https://example.com/", async () => true, async () => { throw new Error("shell failed"); }, publicDns)).resolves.toBeUndefined();
  });
});
