/**
 * 章立て（0.13.0）を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 *
 * 引継ぎ書3章の「0.13.0：章立て」のうち、拡張の中で決まること——右クリックの「章立てを取得」を選んだときの
 * お知らせの文・クリップボードへ置く封筒・受け手の合図——をここへ移した。見本は test/e2e/fixtures/ の作品管理
 * （大見出し1つ・話2つ。PV の枡の無い控えの表もある＝拾うと二重になる）。
 *
 * ここで確かめないこと（作者の Chrome と VS Code で残る）：右クリックの一覧に項目が出るか（Playwright からは
 * 右クリックの一覧を開けない）・VS Code が前に出るか・統合小説執筆環境の章立ての確認・中見出しのある本物の作品。
 */
import { describe, expect, it } from "vitest";
import { Actions, Messages, PAGES, WORK_ID, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

/** ページを新しいタブで開き、そのタブの番号を返す（tabs の権限が無いので、開く前と後の差で引く） */
async function 開いて番号を引く(h, url) {
  const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
  const 前 = new Set(await 番号たち());
  await h.open(url);
  return waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, { what: `${url} のタブ` });
}

/** 右クリックの「章立てを取得」を選ぶ（選んだときに Chrome が呼ぶ受け口と同じ関数を、裏方の中で呼ぶ） */
async function 章立てを選ぶ(h, tabId, url) {
  await h.inWorker(({ id, url: u }) => 章立てを読んで渡す({ id, url: u, active: true }), { id: tabId, url });
}

/** 説明のページで「統合小説執筆環境へ渡す」を入れる */
async function 渡すを入れる(h) {
  const 説明 = await h.openOptions();
  await 説明.check("#hand-to-ide");
  await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
  await 説明.close();
}

const 知らせたち = async (h) => (await h.readWatch()).filter((e) => e.kind === "notify" && !e.id);

describe("章立て（0.13.0）", () => {
  it("作品管理で選ぶと「大見出し 1個と 2話」（二重にならない）を知らせ、章立ての封筒をクリップボードへ置いて受け手の合図へ向かう", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      const tabId = await 開いて番号を引く(h, PAGES.kakuyomuWork);
      await 章立てを選ぶ(h, tabId, PAGES.kakuyomuWork);

      const 置いた = await waitUntil(
        async () => (await h.readWatch()).filter((e) => e.kind === "clipboardWrite" && e.text.includes("novelai-chapters")).at(-1) || null,
        { what: "章立ての封筒" }
      );
      const 封筒 = JSON.parse(置いた.text);
      expect(封筒.workId).toBe(WORK_ID);
      const 知らせ = await waitUntil(async () => (await 知らせたち(h)).at(-1) || null, { what: "章立てのお知らせ" });
      expect(知らせ.message).toBe(Messages.messageForChaptersHanded({ count: 2, chapters: 1, subHeadings: 0 }, true));
      // 題に「公開」「大見出し」の字が混ざらない
      expect(置いた.text).toContain("第一章『見本の岬』");
      expect(置いた.text).not.toMatch(/公開第一章|大見出し第一章/);

      const 合図 = await waitUntil(async () => (await h.readWatch()).find((e) => e.kind === "signal") || null, {
        what: "受け手の合図",
      });
      expect(合図.tabId).toBe(tabId);
      expect(new URL(合図.url).pathname).toBe(new URL(Actions.VSCODE_CHAPTERS_URL).pathname);
    }));

  it("話の作成画面（項目が出るが作品管理ではない画面）で選ぶと、作品管理の画面で、と断り、何も置かない", () =>
    withHelper(async (h) => {
      // 項目を出す範囲は /my/works/* だけ（アクセス数の画面 /works/…/accesses には出ない）。
      // その範囲のうち作品管理でないのは話の作成・編集画面で、押したときに読み取り係が断る
      expect(await h.inWorker(() => CHAPTERS_PAGES)).toEqual(["https://kakuyomu.jp/my/works/*"]);
      await 渡すを入れる(h);
      const tabId = await 開いて番号を引く(h, PAGES.kakuyomuNew);
      await 章立てを選ぶ(h, tabId, PAGES.kakuyomuNew);
      const 知らせ = await waitUntil(async () => (await 知らせたち(h)).at(-1) || null, { what: "断りのお知らせ" });
      expect(知らせ.message).toBe(Messages.CHAPTERS.notHere);
      await sleep(1500);
      const 記録 = await h.readWatch();
      expect(記録.filter((e) => e.kind === "clipboardWrite")).toHaveLength(0);
      expect(記録.filter((e) => e.kind === "signal")).toHaveLength(0);
    }));
});
