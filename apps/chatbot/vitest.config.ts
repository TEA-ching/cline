import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/example.test.ts"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
});
