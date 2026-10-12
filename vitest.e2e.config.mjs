import { defineConfig } from "vitest/config";

/**
 * 画面の自動テスト（E2E。`npm run test:e2e`。設計書12章）。
 *
 * この拡張を読み込んだ Chromium を画面の外（headless）で起こし、投稿サイトの代わりに手元の見本を返して、
 * 開いた・答えた・押したときに起きることを確かめる。土台は test/e2e/support/helperBrowser.js。
 *
 * **`npm test`（単体）には入れない。** 1件ごとにブラウザを起こすので遅い。
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.js"],
    environment: "node",
    // 前の走りが途中で止まって残した一時のプロフィールを、最初と最後に片づける
    globalSetup: ["test/e2e/support/globalSetup.js"],
    // ブラウザを1つずつ起こす（並べると重く、待ち時間の見込みが狂う）
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
