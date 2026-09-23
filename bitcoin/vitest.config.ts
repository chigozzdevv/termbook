import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["bitcoin/test/**/*.test.ts"],
    environment: "node",
  },
});
