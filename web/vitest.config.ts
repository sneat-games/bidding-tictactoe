import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.ts"],
    globals: true,
    // engine + bot tests are pure logic (node env); bid-input needs DOM.
    // Per-file environment annotation handles this; default to node and
    // annotate the bid-input test with @vitest-environment jsdom.
    environment: "node",
    environmentMatchGlobs: [
      ["src/ui/**/*.test.ts", "jsdom"],
    ],
  },
});