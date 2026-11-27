import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.opencode/**", "**/.stitch/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      thresholds: {
        lines: 60,
        branches: 45,
        functions: 50,
        statements: 55,
      },
    },
  },
});
