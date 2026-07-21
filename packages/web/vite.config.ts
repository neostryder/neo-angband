import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Build-time provenance for the on-screen build stamp (build-stamp.ts). Git is
// available in local dev and in the Pages CI checkout; every value degrades to
// a safe fallback if git is absent so the build never fails over it.
function git(argline: string, fallback: string): string {
  try {
    return execSync(`git ${argline}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}

const pkgVersion = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version?: string }
).version ?? "0.0.0";
const commitShort = git("rev-parse --short HEAD", "dev");
const commitFull = git("rev-parse HEAD", "");
const commitDate = git("log -1 --format=%cd --date=short", "");

// The upstream Angband release this port tracks. Kept as a literal (not derived
// from reference/) so the stamp reads correctly even in checkouts without it.
const ANGBAND_VERSION = "4.2.6";

// The public repo the runtime freshness check compares the loaded build against.
const REPO = "neostryder/neo-angband";

export default defineConfig({
  base: "./",
  define: {
    __NEO_VERSION__: JSON.stringify(pkgVersion),
    __NEO_COMMIT__: JSON.stringify(commitShort),
    __NEO_COMMIT_FULL__: JSON.stringify(commitFull),
    __NEO_COMMIT_DATE__: JSON.stringify(commitDate),
    __ANGBAND_VERSION__: JSON.stringify(ANGBAND_VERSION),
    __NEO_REPO__: JSON.stringify(REPO),
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-512-maskable.png",
        "icons/apple-touch-icon-180.png",
      ],
      manifest: {
        name: "Neo Angband",
        short_name: "Neo Angband",
        description:
          "Modern TypeScript port of the roguelike Angband: web-first and offline-capable.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#101014",
        theme_color: "#101014",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        // The main bundle now includes the full engine + the bundled Borg
        // autoplayer, pushing the JS chunk past workbox's 2 MiB precache
        // default. Raise the cap so the offline PWA precaches the whole app.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5178,
  },
});
