import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@tmt/shared": `${root}/packages/shared/src/index.ts`,
      "@tmt/margin-engine": `${root}/packages/margin-engine/src/index.ts`
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
