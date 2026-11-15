import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createDesktopConsentStore } from "./desktop-consent.js";
import { desktopBackupFolderKey } from "./backup-folder.js";
import { createDesktopAuthority } from "./net-relay.js";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

function folder(): string {
  const base = path.resolve(".repro");
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, "consent-"));
  folders.push(directory);
  return directory;
}

describe("persisted desktop consent", () => {
  const request = { modId: "qol", digest: "a".repeat(64), grants: ["backup:folder", "network:*"], destinations: ["api.example.com"] };

  it("asks once in a non-lab build, survives a launch, and asks for wider destinations", async () => {
    const base = folder();
    const confirm = vi.fn(async () => true);
    const first = createDesktopAuthority(createDesktopConsentStore(base));
    await first.report(request, 1, confirm);
    const records = JSON.parse(fs.readFileSync(path.join(base, "mod-desktop-consent.json"), "utf8"));
    expect(records[desktopBackupFolderKey("qol")]).toEqual({ grants: request.grants, destinations: request.destinations });
    const next = createDesktopAuthority(createDesktopConsentStore(base));
    await first.report({ ...request, release: true }, 1, confirm);
    const changed = { ...request, digest: "b".repeat(64) };
    expect(await next.report({ ...changed, quiet: true }, 2, confirm)).toMatchObject({ ok: true });
    expect(await next.report({ ...changed, grants: ["backup:folder"], destinations: [] }, 2, confirm)).toMatchObject({ ok: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    await next.report({ ...changed, destinations: [...request.destinations, "other.example.com"] }, 2, confirm);
    expect(confirm).toHaveBeenCalledTimes(2);
    await next.report({ ...changed, revoke: true }, 2, confirm);
    await createDesktopAuthority(createDesktopConsentStore(base)).report(changed, 3, confirm);
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(fs.readdirSync(base)).toEqual(["mod-desktop-consent.json"]);
  });

  it("treats missing and corrupt files as no approval and replaces corruption atomically", async () => {
    const base = folder();
    const store = createDesktopConsentStore(base);
    expect(store.approved!("qol", request.grants, request.destinations)).toBe(false);
    fs.writeFileSync(path.join(base, "mod-desktop-consent.json"), "{broken", "utf8");
    const authority = createDesktopAuthority(store);
    const confirm = vi.fn(async () => true);
    expect(await authority.report({ ...request, quiet: true }, 1, confirm)).toMatchObject({ ok: false });
    expect(confirm).not.toHaveBeenCalled();
    expect(await authority.report(request, 1, confirm)).toMatchObject({ ok: true });
    expect(createDesktopConsentStore(base).approved!("qol", request.grants, request.destinations)).toBe(true);
    fs.writeFileSync(path.join(base, "mod-desktop-consent.json"), JSON.stringify({ [desktopBackupFolderKey("qol")]: { grants: ["backup:folder"], destinations: ["invalid host"] } }), "utf8");
    expect(store.approved!("qol", ["backup:folder"], ["api.example.com"])).toBe(false);
    expect(store.approved!("qol", ["backup:folder"], [])).toBe(false);
  });
});
