import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  server: {
    port: 5178,
  },
});
