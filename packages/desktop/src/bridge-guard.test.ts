/**
 * Preload argument checks. A bad call fails closed and does not become a path.
 */

import { describe, expect, it, vi } from "vitest";
import { capLogBatch, confirmHostAction, desktopConsentReport, hostFsCallIsSafe, hostFsFailure, isSafeHostLeaf, updateCallIsSafe } from "./bridge-guard.js";

describe("host feature consent reports", () => {
  it("keeps host identity and capabilities under main-process control", () => {
    const digest = vi.fn(() => "a".repeat(64));
    for (const arg of [null, [], { hostPurpose: "other" }, { modId: "@host/mod-profile-sync" },
      { hostPurpose: "mod-profile-sync", grants: ["network:*"] }, { hostPurpose: "mod-profile-sync", digest: "forged" }]) {
      expect(desktopConsentReport(arg, digest)).toBeNull();
    }
    expect(digest).not.toHaveBeenCalled();
    expect(desktopConsentReport({ hostPurpose: "mod-profile-sync" }, digest)).toMatchObject({
      modId: "@host/mod-profile-sync", digest: "a".repeat(64), grants: ["backup:folder"], destinations: [],
    });
    expect(desktopConsentReport({ hostPurpose: "mod-profile-sync" }, () => { throw new Error("unreadable"); })).toBeNull();
  });
});

describe("host filesystem arguments", () => {
  it("accepts a leaf in one of the five directories and rejects a path or a command", () => {
    expect(hostFsCallIsSafe("readText", ["save", "Adventurer"])).toBe(true);
    expect(hostFsCallIsSafe("writeText", ["user", "color.prf", "x", false, 1])).toBe(true);
    expect(hostFsCallIsSafe("listFiles", ["save"])).toBe(true);
    for (const args of [
      ["save", "../Adventurer"],
      ["save", "a/b"],
      ["save", "C:Adventurer"],
      ["save", "CON"],
      ["/etc", "passwd"],
      ["save", "Adventurer", "extra"],
      ["save", "a:stream"],
      ["save", "a\n.prf"],
      ["save", "x?.prf"],
    ]) {
      expect(hostFsCallIsSafe("readText", args), JSON.stringify(args)).toBe(false);
    }
    expect(hostFsCallIsSafe("exec", ["save", "Adventurer"])).toBe(false);
    expect(isSafeHostLeaf("..\\x")).toBe(false);
    expect(hostFsFailure("readText")).toBeNull();
    expect(hostFsFailure("writeText")).toBe("create-failed");
    expect(hostFsFailure("listFiles")).toEqual([]);
    expect(hostFsCallIsSafe("writeText", ["save", "Adventurer", "x".repeat(16 * 1024 * 1024 + 1)])).toBe(false);
    expect(hostFsCallIsSafe("writeText", ["save", "Adventurer", "x", false, NaN])).toBe(false);
  });
});

describe("update and log arguments", () => {
  it("accepts a release tag and rejects a url or a path", () => {
    expect(updateCallIsSafe("shape", undefined)).toBe(true);
    expect(updateCallIsSafe("apply", undefined)).toBe(true);
    expect(updateCallIsSafe("download", "v1.2.3")).toBe(true);
    expect(updateCallIsSafe("download", "https://evil.example/neo.zip")).toBe(false);
    expect(updateCallIsSafe("download", "../neo.zip")).toBe(false);
    expect(updateCallIsSafe("download", "..")).toBe(false);
    expect(updateCallIsSafe("apply", "C:/Windows/cmd.exe")).toBe(false);
    expect(updateCallIsSafe("reveal", "https://github.com/neostryder/neo-angband/releases")).toBe(true);
    expect(updateCallIsSafe("reveal", `http://evil.example/\n/calc`)).toBe(false);
    expect(updateCallIsSafe("run", "calc.exe")).toBe(false);
  });

  it("drops a mixed or oversized log batch", () => {
    expect(capLogBatch(["a", "b"])).toEqual(["a", "b"]);
    expect(capLogBatch(["a", 1])).toBeNull();
    expect(capLogBatch("rm -rf")).toBeNull();
    const huge = "x".repeat(9000);
    expect(capLogBatch([huge, "kept"])).toBeNull();
    expect(capLogBatch(Array(2001).fill("x"))).toBeNull();
    expect(capLogBatch(Array(100).fill("\u00e9".repeat(8000)))).toBeNull();
  });
});

const preload = vi.hoisted(() => ({ globals: {} as Record<string, unknown>, send: vi.fn(), sendSync: vi.fn(), invoke: vi.fn() }));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => { preload.globals[key] = value; } },
  ipcRenderer: { send: preload.send, sendSync: preload.sendSync, invoke: preload.invoke },
}));

describe("preload rejection", () => {
  it("refuses hostile arguments before sending any IPC or filesystem call", async () => {
    await import("./preload.js");
    const desktop = preload.globals["neoDesktop"] as { log(lines: unknown): void; update(op: string, arg?: unknown): Promise<unknown> };
    const host = preload.globals["neoHostFs"] as { call(op: string, args: unknown[]): unknown };
    preload.sendSync.mockClear();
    desktop.log(["valid", 1]);
    desktop.log(["x".repeat(8001)]);
    expect(await desktop.update("download", "C:/Windows/cmd.exe")).toMatchObject({ ok: false });
    expect(await desktop.update("apply", "C:/Windows/cmd.exe")).toMatchObject({ ok: false });
    expect(await desktop.update("reveal", "file:///C:/Windows/cmd.exe")).toMatchObject({ ok: false });
    expect(host.call("writeText", ["save", "../outside", "bad"])).toBe("create-failed");
    expect(host.call("exec", ["cmd.exe"])).toBe(false);
    expect(preload.send).not.toHaveBeenCalled();
    expect(preload.invoke).not.toHaveBeenCalled();
    expect(preload.sendSync).not.toHaveBeenCalled();
  });
});

describe("native confirmation", () => {
  it("defaults to cancel and does not run a mutation after a decline or a dialog failure", async () => {
    let mutations = 0;
    const decline = vi.fn(async () => ({ response: 1, accepted: true }));
    if (await confirmHostAction(decline, "Quit?", "Quit")) mutations++;
    if (await confirmHostAction(async () => { throw new Error("dialog failed"); }, "Install?", "Install")) mutations++;
    expect(mutations).toBe(0);
    expect(decline).toHaveBeenCalledWith(expect.objectContaining({ buttons: ["Quit", "Cancel"], defaultId: 1, cancelId: 1 }));
    expect(await confirmHostAction(async () => ({ response: 0 }), "Quit?", "Quit")).toBe(true);
  });
});
