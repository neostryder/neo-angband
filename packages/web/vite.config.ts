import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
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
