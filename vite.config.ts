import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src/renderer",
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  },
  test: {
    root: __dirname
  }
});
