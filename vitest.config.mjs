import { configDefaults, defineConfig } from "vitest/config";

/**
 * 単体テスト（`npm test`）。
 *
 * - 画面の自動テスト（test/e2e/）は入れない。ブラウザを起こすので遅く、作者が使っているパソコンでは走らせない
 *   （`npm run test:e2e` で別に走らせる。vitest.e2e.config.mjs）
 * - 担当の作業場（.claude/worktrees/）の下のテストを拾わない。作業場で作りかけのものが落ちて見えるため
 *
 * 拡張子を .mjs にしているのは、test/redLine.test.js が拡張として動くファイル（.js など）を走査するため
 * （scripts/pack.mjs と同じ理由。これは拡張の中身ではない）。
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "test/e2e/**", ".claude/**"],
  },
});
