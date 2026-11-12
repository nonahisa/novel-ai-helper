/**
 * 0.20.0：投稿したあとの話の番号を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 * 見本の話の編集画面（test/e2e/fixtures/kakuyomu-edit.html。架空・欄は見込み）で押したとき、
 * URL の作品ID・話の番号と、題の欄の字が封筒 novelai-posted に入り、受け手の /import-posted へ向かうか。
 */
import { describe, expect, it } from "vitest";
import { Actions, Messages, PAGES, WORK_ID, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

/** ページを新しいタブで開き、そのページとタブの番号を返す（tabs の権限が無いので、開く前と後の差で引く） */
async function 開いて番号を引く(h, url) {
  const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
  const 前 = new Set(await 番号たち());
  const ページ = await h.open(url);
  const tabId = await waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, {
    what: `${url} のタブ`,
  });
  return { ページ, tabId };
}

/** 「渡す」を入れる */
async function 渡すを入れる(h) {
  const 説明 = await h.openOptions();
  await 説明.check("#hand-to-ide");
  await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
  await 説明.close();
}

const 話の番号の封筒たち = async (h) =>
  (await h.readWatch()).filter((e) => e.kind === "clipboardWrite" && e.text.includes("novelai-posted"));

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

  it("話の編集画面で原稿を貼ると、置き換えの確認（字数と、違う題）が毎回出る。断れば何も変わらず、入れたあとにもう一度押すと番号を渡す", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      const { ページ, tabId } = await 開いて番号を引く(h, PAGES.kakuyomuEdit);
      const 原稿 = { "novelai-post": 1, site: "kakuyomu", workId: WORK_ID, title: "第5話 雨の日（直し）", body: "直した本文です" };
      await h.inWorker((t) => クリップボードに頼む({ type: "write", text: t }), JSON.stringify(原稿));
      const 押す = () => h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuEdit });
      const 窓を待つ = (決める) =>
        new Promise((resolve) => {
          ページ.once("dialog", async (d) => {
            const 文 = d.message();
            await 決める(d);
            resolve(文);
          });
        });

      // 1回目：断る。何も変わらない
      const 一回目の窓 = 窓を待つ((d) => d.dismiss());
      await 押す();
      const 文1 = await 一回目の窓;
      expect(文1).toContain("この話の本文（いま 12字）を、統合小説執筆環境でコピーした本文（7字）に置き換えます。");
      expect(文1).toContain("題が違います。画面の題「第5話 雨の日」／コピーした題「第5話 雨の日（直し）」");
      await waitUntil(
        async () => (await h.readWatch()).find((e) => e.kind === "notify" && (e.message || "").includes(Messages.PAGE.canceled)) || null,
        { what: "断ったときのお知らせ" }
      );
      expect(await ページ.inputValue("#episodeBody-input")).toBe("保存してある本文（見本）");
      expect(await ページ.inputValue("#episodeTitle-input")).toBe("第5話 雨の日");
      expect(await 話の番号の封筒たち(h)).toHaveLength(0);

      // 2回目：同じ原稿でも、また確認が出る（毎回出す）。今度は［OK］
      const 二回目の窓 = 窓を待つ((d) => d.accept());
      await 押す();
      expect(await 二回目の窓).toContain("置き換えますか？");
      await ページ.waitForFunction(() => document.getElementById("episodeBody-input").value === "直した本文です");
      expect(await ページ.inputValue("#episodeTitle-input")).toBe("第5話 雨の日（直し）");
      expect(await 話の番号の封筒たち(h)).toHaveLength(0);
      expect((await h.readWatch()).filter((e) => e.kind === "signal")).toHaveLength(0);

      // 3回目：貼り込めた同じ原稿なので、番号を渡す（題は画面の題の欄の字）
      let 窓が出た = false;
      ページ.once("dialog", (d) => {
        窓が出た = true;
        d.dismiss();
      });
      await 押す();
      const 置いた = await waitUntil(async () => (await 話の番号の封筒たち(h)).at(-1) || null, { what: "話の番号の封筒" });
      const 封筒 = JSON.parse(置いた.text);
      expect(封筒).toMatchObject({ "novelai-posted": 1, site: "kakuyomu", workId: WORK_ID, episodeId: "1177354054800000099", title: "第5話 雨の日（直し）" });
      expect(置いた.text).not.toContain("直した本文です");
      const 合図 = await waitUntil(async () => (await h.readWatch()).filter((e) => e.kind === "signal").at(-1) || null, {
        what: "受け手の合図",
      });
      expect(new URL(合図.url).pathname).toBe(new URL(Actions.VSCODE_POSTED_URL).pathname);
      expect(窓が出た).toBe(false);
      await ページ.close();
    }));

  it("なろうの作品の管理画面で押すと、ページの中身を読まずに URL の小説番号だけを渡し、「話の番号を読みました」と知らせる", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      const { ページ, tabId } = await 開いて番号を引く(h, PAGES.narouManage);
      await sleep(1000);
      // 印は付かない（manifest の matches の外なので、ページには入らない）
      expect(await h.inWorker((id) => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("");
      await h.inWorker(() => クリップボードに頼む({ type: "write", text: "e2e" }));
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.narouManage });
      const 置いた = await waitUntil(async () => (await 話の番号の封筒たち(h)).at(-1) || null, { what: "小説番号の封筒" });
      const 封筒 = JSON.parse(置いた.text);
      expect(封筒).toMatchObject({ "novelai-posted": 1, site: "narou", novelNo: "1234567" });
      expect(封筒).not.toHaveProperty("workId");
      expect(置いた.text).not.toContain("見本の本文");
      const 知らせ = await waitUntil(
        async () => (await h.readWatch()).find((e) => e.kind === "notify" && e.title === "話の番号を読みました") || null,
        { what: "「話の番号を読みました」のお知らせ" }
      );
      expect(知らせ.title).toBe("話の番号を読みました");
      const 合図 = await waitUntil(async () => (await h.readWatch()).filter((e) => e.kind === "signal").at(-1) || null, {
        what: "受け手の合図",
      });
      expect(new URL(合図.url).pathname).toBe(new URL(Actions.VSCODE_POSTED_URL).pathname);
      await ページ.close();
    }));
});
