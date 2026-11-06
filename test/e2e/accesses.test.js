/**
 * カクヨムのアクセス数の画面（0.2.2・0.9.0）を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 *
 * 引継ぎ書3章の「アクセス数の画面を押して、話ごとの数と『次へ』の知らせが出るか」のうち、拡張の中で決まること——
 * 押したときのお知らせの文（次のページの但し書き）と、2ページ目を開いたときの溜まり——をここへ移した。
 * 見本は test/e2e/fixtures/kakuyomu-accesses.html（「次へ」〔…/accesses?page=2〕がある。2ページ目も同じ見本を返す）。
 *
 * ここで確かめないこと（作者の Chrome と VS Code で残る）：お知らせが本当に画面の隅に出るか・統合小説執筆環境の記録の積み上がり。
 */
import { describe, expect, it } from "vitest";
import { PAGES, asksFrom, gotFrom, waitUntil, withHelper } from "./support/helperBrowser.js";

/** ページを新しいタブで開き、そのタブの番号を返す（tabs の権限が無いので、開く前と後の差で引く） */
async function 開いて番号を引く(h, url) {
  const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
  const 前 = new Set(await 番号たち());
  await h.open(url);
  return waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, { what: `${url} のタブ` });
}

/** その種類の問いを待ち、「自動で取得する」と答えて、取得の知らせが増えるまで待つ */
async function 自動にする(h, key) {
  const 前の知らせ = gotFrom(await h.readWatch()).length;
  const 問い = await waitUntil(async () => asksFrom(await h.readWatch()).find((a) => a.key === key) || null, {
    what: `「${key}」の問い`,
  });
  await h.answer(問い, "auto");
  await waitUntil(async () => gotFrom(await h.readWatch()).length > 前の知らせ || null, { what: `「${key}」の取得の知らせ` });
}

const 溜まりの画面の数 = async (h) => ((await h.storage("helperState")).helperState.items || []).length;

describe("カクヨムのアクセス数の画面（0.2.2・0.9.0）", () => {
  it("押すと「次へ」の但し書きつきで渡し、2ページ目を開くと別の画面として溜まる", () =>
    withHelper(async (h) => {
      const 説明 = await h.openOptions();
      await 説明.check("#hand-to-ide");
      await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
      await 説明.close();

      // 作品管理を読めた作品は「ご自分の作品」として覚える（アクセス数は覚えた作品だけ溜める）
      await h.open(PAGES.kakuyomuWork);
      await 自動にする(h, "kakuyomu|work");
      const tabId = await 開いて番号を引く(h, PAGES.kakuyomuAccesses);
      await 自動にする(h, "kakuyomu|accesses");
      await waitUntil(async () => (await 溜まりの画面の数(h)) === 2 || null, { what: "溜まりが2画面（作品管理とアクセス数）" });

      // 2ページ目を開く。同じ作品でもページが違えば別の画面として溜まる
      await h.open(`${PAGES.kakuyomuAccesses}?page=2`);
      await waitUntil(async () => (await 溜まりの画面の数(h)) === 3 || null, { what: "2ページ目も溜まって3画面" });
      // 1ページ目を開き直しても二重にならない
      await h.open(PAGES.kakuyomuAccesses);
      await waitUntil(async () => gotFrom(await h.readWatch()).length >= 4 || null, { what: "開き直しの取得の知らせ" });
      expect(await 溜まりの画面の数(h)).toBe(3);

      // 1ページ目のタブでアイコンを押す
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuAccesses });
      const 知らせ = await waitUntil(
        async () => (await h.readWatch()).filter((e) => e.kind === "notify" && !e.id && /まとめて渡しました/.test(e.message || "")).at(-1) || null,
        { what: "まとめて渡したお知らせ" }
      );
      expect(知らせ.message).toContain("溜まった読者の反応をまとめて渡しました（3画面・1作品");
      expect(知らせ.message).toContain("「次へ」で次のページを開くと、そのページも溜まります");

      const 置いた = (await h.readWatch()).filter((e) => e.kind === "clipboardWrite");
      const 束 = JSON.parse(置いた.at(-1).text);
      expect(束.kind).toBe("novelai-stats-bundle");
      expect(束.items).toHaveLength(3);
      expect((await h.readWatch()).filter((e) => e.kind === "signal")).toHaveLength(1);
    }));
});
