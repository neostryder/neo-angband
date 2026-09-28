/**
 * A short notice at the top of the dungeon view that fades on its own, for news
 * about the window layout. It stays out of the game's message line and message
 * log, which hold what happens in the game. A second notice replaces the first
 * and starts the timer again.
 */

export const NOTICE_SHOW_MS = 6000;
export const NOTICE_FADE_MS = 600;

export interface ChromeNotice {
  show(text: string): void;
  dismiss(): void;
}

export function mountChromeNotice(host: HTMLElement): ChromeNotice {
  const box = document.createElement("div");
  box.className = "chrome-notice";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.hidden = true;
  host.appendChild(box);
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers(): void {
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    fadeTimer = hideTimer = undefined;
  }

  function dismiss(): void {
    clearTimers();
    box.hidden = true;
    box.classList.remove("chrome-notice-fading");
    box.textContent = "";
  }

  return {
    show(text) {
      clearTimers();
      box.textContent = text;
      box.classList.remove("chrome-notice-fading");
      box.hidden = false;
      fadeTimer = setTimeout(() => {
        box.classList.add("chrome-notice-fading");
        hideTimer = setTimeout(dismiss, NOTICE_FADE_MS);
      }, NOTICE_SHOW_MS);
    },
    dismiss,
  };
}
