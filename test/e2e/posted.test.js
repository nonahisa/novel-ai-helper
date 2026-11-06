/**
 * 0.20.0：投稿したあとの話の番号を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 * 見本の話の編集画面（test/e2e/fixtures/kakuyomu-edit.html。架空・欄は見込み）で押したとき、
 * URL の作品ID・話の番号と、題の欄の字が封筒 novelai-posted に入り、受け手の /import-posted へ向かうか。
 */
import { describe, expect, it } from "vitest";
import { Actions, PAGES, WORK_ID, waitUntil, withHelper } from "./support/helperBrowser.js";

describe("投稿したあとの話の番号（0.20.0）", () => {
  it("話の編集画面で、原稿の無いクリップボードのまま押すと、番号と題を渡す（本文は渡さない）", () =>
    withHelper(async (h) => {
      const 説明 = await h.openOptions();
      await 説明.check("#hand-to-ide");
      await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
      await 説明.close();

      const ページ = await h.open(PAGES.kakuyomuEdit);
      await ページ.bringToFront();
      // tabs 権限が無いので、アドレスでは探さない。いま前にあるタブ（開いたばかりの見本）の番号を使う
      const tabId = await h.inWorker(async () => {
        const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return t ? t.id : null;
      });
      expect(Number.isSafeInteger(tabId)).toBe(true);

      // クリップボードを原稿でない字にしておく（作者のパソコンのクリップボードに原稿が残っていても、貼り込みに倒れないように）
      await h.inWorker(() => クリップボードに頼む({ type: "write", text: "e2e" }));
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuEdit });

      const 置いた = await waitUntil(
        async () => (await h.readWatch()).filter((e) => e.kind === "clipboardWrite" && e.text.includes("novelai-posted")).at(-1) || null,
        { what: "話の番号の封筒" }
      );
      const 封筒 = JSON.parse(置いた.text);
      expect(封筒).toMatchObject({
        "novelai-posted": 1,
        site: "kakuyomu",
        workId: WORK_ID,
        episodeId: "1177354054800000099",
        title: "第5話 雨の日",
      });
      expect(置いた.text).not.toContain("保存してある本文");
      const 合図 = await waitUntil(async () => (await h.readWatch()).filter((e) => e.kind === "signal").at(-1) || null, {
        what: "受け手の合図",
      });
      expect(new URL(合図.url).pathname).toBe(new URL(Actions.VSCODE_POSTED_URL).pathname);
      await ページ.close();
    }));
});
