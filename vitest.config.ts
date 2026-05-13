import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest 설정 — `@/` 경로 alias 를 tsconfig.json 과 동일하게 해석.
 * Next.js build/runtime 과는 별개 — 테스트 전용 모듈 해석.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
