/**
 * 貼り込みの確認の窓（0.8.0）を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 *
 * 引継ぎ書3章の「0.8.0：お知らせ」のうち「貼り込みの確認で30秒以上待ってから決めても、結果のお知らせが出るか」を
 * ここへ移した。裏方（service worker）は確認の窓のあいだ待たず、ページが終わったあとに "fill-result" で結果を受ける作り
 * （background.js の 貼り込む）。30秒より長く待っても、その結果がお知らせになるかを見る。
 * 見本は test/e2e/fixtures/kakuyomu-new.html（話の作成画面）。本文の欄に書きかけを入れておくと、確認の窓が出る。
 *
 * ここで確かめないこと（作者の Chrome で残る）：お知らせが本当に画面の隅に出るか（ここでは出す頼みを記録して止めている）。
 */
import { describe, expect, it } from "vitest";
import { Messages, PAGES, WORK_ID, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

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

const 原稿 = { "novelai-post": 1, site: "kakuyomu", workId: WORK_ID, title: "第1話 待ってから", body: "直した本文" };

/** 書きかけのある作成画面で、原稿を置いてアイコンを押す。確認の窓が出たら、決め方（決める）に任せる */
async function 書きかけの上へ貼る(h, 決める) {
  const { ページ, tabId } = await 開いて番号を引く(h, PAGES.kakuyomuNew);
  await ページ.fill("#episodeBody-input", "書きかけの本文");
  let 窓の文 = "";
  ページ.once("dialog", async (d) => {
    窓の文 = d.message();
    await 決める(d);
  });
  await h.inWorker((t) => クリップボードに頼む({ type: "write", text: t }), JSON.stringify(原稿));
  await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuNew });
  return { ページ, 窓の文: () => 窓の文 };
}

const 貼り込みの知らせ = async (h) =>
  (await h.readWatch()).filter((e) => e.kind === "notify" && !e.id && /入れ|何もしませんでした/.test(e.message || ""));

describe("貼り込みの確認の窓（0.8.0）", () => {
  it("確認の窓で31秒待ってから［OK］を押しても、入れて、結果のお知らせが出る", () =>
    withHelper(async (h) => {
      const { ページ, 窓の文 } = await 書きかけの上へ貼る(h, async (d) => {
        await sleep(31_000);
        await d.accept();
      });
      await ページ.waitForFunction(() => document.getElementById("episodeBody-input").value === "直した本文", null, {
        timeout: 60_000,
      });
      expect(窓の文()).not.toBe("");
      expect(await ページ.inputValue("#episodeTitle-input")).toBe(原稿.title);
      const 知らせ = await waitUntil(async () => (await 貼り込みの知らせ(h)).at(-1) || null, { what: "貼り込みの結果のお知らせ" });
      expect(知らせ.message).toMatch(/入れました/);
    }));

  it("確認の窓で［キャンセル］を押すと、書きかけはそのままで「何もしませんでした」", () =>
    withHelper(async (h) => {
      const { ページ } = await 書きかけの上へ貼る(h, (d) => d.dismiss());
      const 知らせ = await waitUntil(async () => (await 貼り込みの知らせ(h)).at(-1) || null, { what: "断ったときのお知らせ" });
      expect(知らせ.message).toContain(Messages.PAGE.canceled);
      expect(await ページ.inputValue("#episodeBody-input")).toBe("書きかけの本文");
      expect(await ページ.inputValue("#episodeTitle-input")).toBe("");
    }));
});
