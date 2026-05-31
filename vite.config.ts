import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  }
});
