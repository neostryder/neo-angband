import { afterEach, describe, expect, it, vi } from "vitest";
import { selectFromMenu, showTextScreen } from "../overlay";
import { liveRegionStack, resetRegionStack } from "../ui-stack";
import type { GridPointerInput, GridSurface } from "../term";
import type { CoreModManager, ModManagerService } from "./service";
import type { ManagerResult } from "./types";
import { drawPendingManagementConfirmation } from "./classic-confirmation";

vi.mock("../overlay", async (original) => ({
  ...await original<typeof import("../overlay")>(),
  selectFromMenu: vi.fn(async () => 0),
  showTextScreen: vi.fn(async () => {}),
}));

afterEach(() => { resetRegionStack(); vi.clearAllMocks(); });

describe("confirmed mod download progress", () => {
  it.each(["ok", "refused"] as const)("draws progress while staging and releases its region on %s", async (status) => {
    const term: GridSurface & GridPointerInput = {
      size: () => ({ cols: 80, rows: 24 }), invalidate: vi.fn(), flush: vi.fn(), clear: vi.fn(),
      setCursor: vi.fn(), hideCursor: vi.fn(), put: vi.fn(), print: vi.fn(), eraseToEol: vi.fn(), prt: vi.fn(), onCellTap: () => () => {},
    };
    const service = { state: { pendingConfirmation: { id: 7, operation: "update", mods: [], permissions: [], riskNotice: [], conflicts: [] } } } as unknown as ModManagerService;
    const result: ManagerResult<unknown> = status === "ok" ? { status: "ok", value: [] } : { status: "refused", code: "install", reason: "Download timed out." };
    const resolve: CoreModManager["resolveConfirmation"] = async (_id, _decision, progress) => {
      expect(liveRegionStack()).toHaveLength(1);
      progress?.({ done: 12, total: 630, path: "Cutting Room Floor: assets/tile.png" });
      return result;
    };
    const core = { resolveConfirmation: vi.fn(resolve) } as unknown as CoreModManager;
    expect(await drawPendingManagementConfirmation(term, service, core)).toEqual(result);
    expect(showTextScreen).toHaveBeenCalled();
    expect(selectFromMenu).toHaveBeenCalled();
    expect(term.print).toHaveBeenCalledWith(0, 1, "Updating mods", expect.any(String), undefined);
    expect(term.print).toHaveBeenCalledWith(0, 3, "Preparing mods...", expect.any(String), undefined);
    expect(term.print).toHaveBeenCalledWith(0, 3, "12 of 630: Cutting Room Floor: assets/tile.png", expect.any(String), undefined);
    expect(term.flush).toHaveBeenCalled();
    expect(liveRegionStack()).toHaveLength(0);
  });
});
