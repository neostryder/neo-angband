import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectFromMenu, showTextScreen } from "../overlay";
import { buildCatalog, ModStore } from "../mod-store";
import type { GridSurface, GridPointerInput } from "../term";
import { classicManager } from "./classic-service";
import { createModManagerService } from "./service";
import { drawPendingManagementConfirmation } from "./classic-confirmation";
import { prepareSaveModList, restoreModListScreen } from "./classic-mod-list";
import { runLoadDelve } from "./classic-delve";
import { ModListStore } from "./mod-lists";
import type { ModManagerDeps } from "./classic-types";
import type { ModUpgradeDeps } from "./browse-types";

vi.mock("../overlay", () => ({ selectFromMenu: vi.fn(), showTextScreen: vi.fn(), promptText: vi.fn(), promptPastedText: vi.fn() }));
vi.mock("./classic-service", () => ({ classicManager: vi.fn(), classicCatalog: vi.fn(), classicBrowser: vi.fn() }));
vi.mock("./classic-confirmation", () => ({ drawPendingManagementConfirmation: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

async function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const store = new ModStore(storage);
  const listCatalog = () => buildCatalog({ content: [{ id: "frost", name: "Frost's proper name", version: "1.0.0", shape: "content" }], sandbox: [], trusted: [], enabled: store.getEnabled(), consents: {} });
  store.setModEnabled("frost", true);
  const manager = createModManagerService({ store, listCatalog });
  vi.mocked(classicManager).mockReturnValue(manager);
  vi.mocked(drawPendingManagementConfirmation).mockImplementation(async (_term, service, core) => core.resolveConfirmation(service.state.pendingConfirmation!.id, { accepted: true }));
  const list = await manager.service.captureModList("Frost list");
  store.setModEnabled("frost", false);
  const deps: ModManagerDeps = { store, listCatalog, modLists: new ModListStore(storage), requestReload: vi.fn(), conflictLines: () => ({ declared: [], contested: [], combined: [], declaredRows: [], contestedRows: [], combinedRows: [] }) };
  return { manager, deps, list, term: {} as GridSurface & GridPointerInput };
}

describe("saved mod list screens", () => {
  it("draws one transaction notice before the saved-list restore prompt", async () => {
    const f = await fixture();
    const order: string[] = [];
    vi.mocked(showTextScreen).mockImplementationOnce(async () => { order.push("notice"); });
    vi.mocked(selectFromMenu).mockImplementationOnce(async () => { order.push("restore"); return 2; });
    const text = "The mod update for Frost failed. The previous versions were restored.";
    expect(await prepareSaveModList(f.term, f.deps, f.list, text)).toEqual({ load: false, allowOverwrite: false });
    expect(order).toEqual(["notice", "restore"]);
    expect(showTextScreen).toHaveBeenCalledOnce();
    expect(showTextScreen).toHaveBeenCalledWith(f.term, expect.objectContaining({ id: "core:mod-transaction-notice", blocks: [expect.objectContaining({ kind: "text", paragraphs: [[{ text }]] })] }));
  });

  it("returns to the boot reload after staging a restore without asking to overwrite", async () => {
    const f = await fixture();
    const manager = createModManagerService({ store: f.deps.store, listCatalog: f.deps.listCatalog, stagePlan: async () => ({ ok: true, results: [] }) });
    vi.mocked(classicManager).mockReturnValue(manager);
    vi.mocked(selectFromMenu).mockResolvedValueOnce(0);
    expect(await prepareSaveModList(f.term, f.deps, f.list)).toEqual({ load: true, allowOverwrite: false });
    expect(manager.service.state.staged).toBe(true);
    expect(f.deps.store.getEnabled()).toEqual([]);
    expect(selectFromMenu).toHaveBeenCalledOnce();
  });

  it("loads old saves without asking about mods", async () => {
    const f = await fixture();
    expect(await prepareSaveModList(f.term, f.deps, undefined)).toEqual({ load: true, allowOverwrite: false });
    expect(selectFromMenu).not.toHaveBeenCalled();
  });

  it.each([0, 1])("asks separately before permitting a different-set overwrite (choice %s)", async (choice) => {
    const f = await fixture();
    vi.mocked(selectFromMenu).mockResolvedValueOnce(1).mockResolvedValueOnce(choice);
    expect(await prepareSaveModList(f.term, f.deps, f.list)).toEqual({ load: true, allowOverwrite: choice === 1 });
    expect(selectFromMenu).toHaveBeenNthCalledWith(1, f.term, "core:restore-save-mods", expect.any(String), [
      { label: "Restore my mods" }, { label: "Continue with current mods" }, { label: "Cancel" },
    ], expect.any(String));
  });

  it("applies the one restore plan through the Core confirmation", async () => {
    const f = await fixture();
    vi.mocked(selectFromMenu).mockResolvedValueOnce(0);
    expect(await prepareSaveModList(f.term, f.deps, f.list)).toEqual({ load: true, allowOverwrite: false });
    expect(drawPendingManagementConfirmation).toHaveBeenCalledOnce();
    expect(f.deps.store.getEnabled()).toEqual(["frost"]);
    expect(f.deps.modLists?.list()["Frost list"]).toEqual(f.list);
  });

  it("names an unavailable mod by its proper name and allows continuing without it", async () => {
    const f = await fixture();
    const manager = createModManagerService({ store: f.deps.store, listCatalog: () => [] });
    vi.mocked(classicManager).mockReturnValue(manager);
    vi.mocked(selectFromMenu).mockResolvedValueOnce(0);
    expect(await restoreModListScreen(f.term, f.deps, f.list)).toBe(true);
    expect(selectFromMenu).toHaveBeenCalledWith(f.term, "core:restore-save-mods", "Restore my mods", [{ label: "Frost's proper name - continue without it" }, { label: "Cancel" }], expect.any(String));
    expect(f.deps.store.getEnabled()).toEqual([]);
    expect(showTextScreen).not.toHaveBeenCalled();
  });

  it("applies a profile's named list from the Delve screen", async () => {
    const f = await fixture();
    f.deps.modLists?.save(f.list);
    f.deps.modBrowse = {} as ModUpgradeDeps;
    vi.mocked(selectFromMenu).mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    expect(await runLoadDelve(f.term, f.deps)).toBe(true);
    expect(f.deps.store.getEnabled()).toEqual(["frost"]);
    expect(selectFromMenu).toHaveBeenNthCalledWith(2, f.term, "core:load-mod-list", "My mod lists", [{ label: "Frost list" }], expect.any(String));
  });
});
