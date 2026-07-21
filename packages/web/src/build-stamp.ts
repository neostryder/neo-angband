// A small, always-on build stamp pinned to the bottom-right corner of the
// screen. It names the running build so a stale cache is obvious at a glance,
// and - when online - reports how many commits behind the public repo the
// loaded build is, so "am I on the latest?" is answerable without guessing.
//
// It is a DOM overlay on top of the game canvas, NOT drawn into the terminal
// grid, so it never collides with the faithful game display. Values come from
// build-time `define` constants (vite.config.ts); the freshness count comes
// from a runtime GitHub compare call and refreshes on load, on focus, and on a
// slow timer.

const REPO = __NEO_REPO__;
const COMMIT_FULL = __NEO_COMMIT_FULL__;

/** Base provenance line, always shown. */
function baseText(): string {
  const date = __NEO_COMMIT_DATE__ ? ` · ${__NEO_COMMIT_DATE__}` : "";
  return (
    `Neo Angband v${__NEO_VERSION__} · ${__NEO_COMMIT__}${date}` +
    ` · based on Angband ${__ANGBAND_VERSION__}`
  );
}

export function installBuildStamp(): void {
  if (typeof document === "undefined") return;

  const el = document.createElement("div");
  el.id = "neo-build-stamp";
  Object.assign(el.style, {
    position: "fixed",
    right: "5px",
    bottom: "3px",
    zIndex: "2147483000",
    font: "10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    color: "rgba(168,168,190,0.5)",
    textShadow: "0 1px 2px rgba(0,0,0,0.95)",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
    letterSpacing: "0.02em",
    maxWidth: "100vw",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);

  const render = (suffix: string, warn: boolean): void => {
    el.textContent = suffix ? `${baseText()} · ${suffix}` : baseText();
    el.style.color = warn ? "rgba(224,192,96,0.8)" : "rgba(168,168,190,0.5)";
  };
  render("", false);

  // Runtime freshness: compare the loaded build's commit against the repo's
  // default branch. `ahead_by` counts commits the branch has that the build
  // does not - i.e. how many commits behind the loaded build is. Best-effort:
  // offline or a rate-limited API just leaves the base stamp in place.
  const check = async (): Promise<void> => {
    if (!COMMIT_FULL || !navigator.onLine) return;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/compare/${COMMIT_FULL}...HEAD`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        status?: string;
        ahead_by?: number;
      };
      const behind = typeof data.ahead_by === "number" ? data.ahead_by : 0;
      if (data.status === "identical" || behind === 0) {
        render("up to date", false);
      } else {
        const s = behind === 1 ? "" : "s";
        render(`${behind} commit${s} behind · reload to update`, true);
      }
    } catch {
      /* offline / rate-limited: keep the base stamp */
    }
  };

  void check();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.setInterval(() => void check(), 10 * 60 * 1000);
}
