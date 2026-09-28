// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTICE_FADE_MS, NOTICE_SHOW_MS, mountChromeNotice } from "./chrome-notice";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("layout notice", () => {
  it("shows the text, fades after a few seconds, then goes away", () => {
    vi.useFakeTimers();
    const notice = mountChromeNotice(document.body);
    const box = document.querySelector<HTMLElement>(".chrome-notice")!;
    expect(box.hidden).toBe(true);
    expect(box.getAttribute("role")).toBe("status");
    notice.show("Some panels now share a space as tabs.");
    expect(box.hidden).toBe(false);
    expect(box.textContent).toBe("Some panels now share a space as tabs.");
    vi.advanceTimersByTime(NOTICE_SHOW_MS);
    expect(box.classList.contains("chrome-notice-fading")).toBe(true);
    vi.advanceTimersByTime(NOTICE_FADE_MS);
    expect(box.hidden).toBe(true);
    expect(box.textContent).toBe("");
  });

  it("restarts the timer when a new notice replaces the old one", () => {
    vi.useFakeTimers();
    const notice = mountChromeNotice(document.body);
    const box = document.querySelector<HTMLElement>(".chrome-notice")!;
    notice.show("first");
    vi.advanceTimersByTime(NOTICE_SHOW_MS - 100);
    notice.show("second");
    vi.advanceTimersByTime(NOTICE_SHOW_MS - 100);
    expect(box.hidden).toBe(false);
    expect(box.textContent).toBe("second");
    expect(box.classList.contains("chrome-notice-fading")).toBe(false);
  });
});
