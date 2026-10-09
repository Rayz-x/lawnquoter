import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // geocode.ts is server-only; the real package throws outside the Next.js server build.
      "server-only": path.resolve(__dirname, "src/test/server-only.ts"),
    },
  },
});
