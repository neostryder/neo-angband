import { afterEach, describe, expect, it, vi } from "vitest";
import { LookStore } from "../look-state";
import { buildCatalog, ModStore } from "../mod-store";
import { runLookChoice } from "./classic-look";
import type { ModManagerDeps } from "./classic-types";
import type { GridSurface, GridPointerInput } from "../term";
import { selectFromMenu } from "../overlay";
import { classicManager } from "./classic-service";

vi.mock("../overlay", () => ({ selectFromMenu: vi.fn(), showTextScreen: vi.fn() }));
vi.mock("./classic-service", async (importActual) => { const actual = await importActual<typeof import("./classic-service")>(); return { ...actual, classicManager: vi.fn(actual.classicManager) }; });
vi.mock("./classic-confirmation", () => ({ drawPendingManagementConfirmation: vi.fn(async () => undefined) }));

function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const store = new ModStore(storage);
  const look = new LookStore(storage, store);
  const deps: ModManagerDeps = { store, look, listCatalog: () => buildCatalog({ content: [], sandbox: [], trusted: [], enabled: [], consents: {} }), conflictLines: () => ({ declared: [], contested: [], combined: [], declaredRows: [], contestedRows: [], combinedRows: [] }), requestReload: vi.fn() };
  return { deps, look };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Core look choice", () => {
  it("offers both looks and records the first Vanilla choice", async () => {
    const f = fixture();
    vi.mocked(selectFromMenu).mockResolvedValueOnce(0);
    await runLookChoice({} as GridSurface & GridPointerInput, f.deps);
    expect(selectFromMenu).toHaveBeenCalledWith(expect.anything(), "core:look-choice", "Choose your look", [
      { label: "Vanilla - Classic Angband presentation" }, { label: "Neo Angband - AnybandUI presentation" },
    ], expect.any(String));
    expect(f.look.read()).toMatchObject({ chosen: true, desired: "Vanilla", active: "Vanilla" });
  });

  it("leaves an offline Neo choice pending and allows play without reloading", async () => {
    const f = fixture();
    vi.stubGlobal("navigator", { onLine: false });
    vi.mocked(selectFromMenu).mockResolvedValueOnce(1);
    await runLookChoice({} as GridSurface & GridPointerInput, f.deps);
    expect(f.look.read()).toMatchObject({ desired: "Neo", active: "Vanilla", pending: { look: "Neo" } });
    expect(f.deps.requestReload).not.toHaveBeenCalled();
  });

  it("keeps a pending choice when the title choice is canceled", async () => {
    const f = fixture();
    f.look.choose("Neo");
    vi.mocked(selectFromMenu).mockResolvedValueOnce(null);
    await runLookChoice({} as GridSurface & GridPointerInput, f.deps);
    expect(f.look.read().desired).toBe("Neo");
  });

  it("applies a staged install by restarting instead of waiting on the title", async () => {
    const f = fixture();
    vi.stubGlobal("navigator", { onLine: true });
    const entry = { ok: true, ref: { repo: "neostryder/neo-angband-mod-anybandui", tag: "v1" }, mod: { id: "anybandui" } };
    const service = {
      state: { installed: [] as unknown[], staged: false },
      refreshState: vi.fn(),
      browse: vi.fn(async () => ({ status: "ok", value: { curated: [entry], community: [] } })),
      planCatalogInstall: vi.fn(async () => ({ status: "ok", value: { id: 7 } })),
      applyPlan: vi.fn(() => { service.state.staged = true; return { status: "confirmation" }; }),
      enable: vi.fn(),
    };
    vi.mocked(classicManager).mockReturnValueOnce({ service, core: {} } as unknown as ReturnType<typeof classicManager>);
    vi.mocked(selectFromMenu).mockResolvedValueOnce(1);
    await runLookChoice({} as GridSurface & GridPointerInput, f.deps);
    expect(service.applyPlan).toHaveBeenCalledWith(7, null, true);
    expect(f.deps.requestReload).toHaveBeenCalledTimes(1);
    expect(service.enable).not.toHaveBeenCalled();
    expect(f.look.read()).toMatchObject({ desired: "Neo", active: "Vanilla", pending: { look: "Neo" } });
  });
});
