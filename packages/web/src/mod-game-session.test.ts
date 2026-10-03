import { describe, expect, it, vi } from "vitest";
import { createModSession, type ModSessionHost } from "./mod-game-session";

function host(overrides: Partial<ModSessionHost> = {}): ModSessionHost {
  return {
    refusal: () => null,
    save: vi.fn(() => true),
    announceSaved: vi.fn(),
    exitToTitle: vi.fn(async () => {}),
    quit: vi.fn(),
    ...overrides,
  };
}

describe("ctx.session", () => {
  it("saves and shows the game's own message", () => {
    const h = host();
    expect(createModSession(h).save()).toEqual({ ok: true });
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.announceSaved).toHaveBeenCalledTimes(1);
  });

  it("leaves for the title or quits only after the save is written", async () => {
    const h = host();
    const session = createModSession(h);
    expect(await session.exitToTitle()).toEqual({ ok: true });
    expect(h.exitToTitle).toHaveBeenCalledTimes(1);
    expect(await session.quit()).toEqual({ ok: true });
    expect(h.quit).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it("stays in the game when the save fails", async () => {
    const h = host({ save: vi.fn(() => false) });
    const session = createModSession(h);
    expect(session.save()).toEqual({ ok: false, reason: "Saving failed." });
    expect(await session.exitToTitle()).toEqual({ ok: false, reason: "Saving failed." });
    expect(await session.quit()).toEqual({ ok: false, reason: "Saving failed." });
    expect(h.announceSaved).not.toHaveBeenCalled();
    expect(h.exitToTitle).not.toHaveBeenCalled();
    expect(h.quit).not.toHaveBeenCalled();
  });

  it("refuses without trying to save when there is nothing to save", async () => {
    const h = host({ refusal: () => "No character is in play." });
    const session = createModSession(h);
    expect(session.save()).toEqual({ ok: false, reason: "No character is in play." });
    expect(await session.quit()).toEqual({ ok: false, reason: "No character is in play." });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.quit).not.toHaveBeenCalled();
  });
});
