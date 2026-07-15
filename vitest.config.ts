import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./test-results/junit.xml",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      thresholds: {
        perFile: true,
        100: true,
      },
    },
  },
});
