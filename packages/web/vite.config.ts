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
        /* OFFLINE MEANS THE WHOLE GAME, not the parts that were cheap.
         *
         * The extensions matter as much as the paths, and this list was missing
         * two kinds of file that the game cannot use a tileset or a sound without:
         *
         *   prf - the pref files (graf-*, flvr-*, xtra-*) that map every feature,
         *         monster and object to a cell of the atlas. 346 KiB across the
         *         four packs. Without them a cached PNG is a picture the renderer
         *         cannot index, so NO tileset worked offline - not just the
         *         excluded one. The atlas was cached and the map still drew ASCII.
         *   mp3 - the Dubtrain sample pack, 2.8 MiB. Sound is off by default
         *         (faithful to upstream), but a player who turns it on and then
         *         goes offline should keep it.
         *
         * txt/md are the two CREDITS files that travel with that art. They are
         * small and they are the attribution; an offline player should be able to
         * read who made what they are looking at.
         *
         * WHAT WAS EXCLUDED, AND WHY IT NO LONGER IS. Two globIgnores used to sit
         * here, and neostryder's ruling on both is parity: the installed app, the
         * static site and the desktop build should differ as little as possible.
         *
         *   **&#47;mods/**  - written when the linoleum packs were generated INTO this
         *                package's public/ directory. They are not: the conversion
         *                moved to the mod's own repository and nothing here builds
         *                pack bytes any more, so this pattern has matched nothing
         *                in a clean checkout for some time. (A stale public/mods/
         *                may survive in an old working tree; it is gitignored and
         *                no build step writes it.) Should a mod ever ship inside
         *                the app again, precaching it is the RIGHT behaviour, not
         *                a regression.
         *   shockbolt  - a single 17.6 MiB atlas, and the reason the cap below is
         *                what it is. It is core data, not opt-in extra: upstream
         *                ships all four tile sets and so does this port, so
         *                "install the app, then discover one of its tilesets only
         *                works online" is exactly the split parity forbids.
         *
         * The honest cost, measured rather than estimated: the precache goes from
         * roughly 5 MiB to roughly 25 MiB, paid once at install. That is the price
         * of an offline install that can do everything the desktop build can. */
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,prf,mp3,txt,md}"],
        /* 20 MiB, sized to admit the largest single asset the game ships -
         * Shockbolt's 64x64.png at 17,564,551 bytes - and not much more. A round
         * "make it big" number would silently admit whatever asset comes next;
         * this one has to be revisited deliberately, which is the point. The main
         * JS chunk (full engine + bundled Borg) is the other thing that would not
         * fit under workbox's 2 MiB default. */
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5178,
  },
});
