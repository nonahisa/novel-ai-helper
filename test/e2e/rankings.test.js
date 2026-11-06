/**
 * ランキングの画面のお祝いと順位（0.19.0）を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 *
 * 引継ぎ書3章の「0.19.0 のランキングの画面のお祝いと順位」のうち、拡張の中で決まること——問い・前に無いタブの「祝」の印・お祝いが一度だけ出るか・
 * 溜まった順位と渡す束・なろうのランキングでは何もしないか——をここへ移した。
 * 見本は test/e2e/fixtures/kakuyomu-ranking.html（見本の作品が5位）と narou-ranking.html。
 *
 * ここで確かめないこと（作者の Chrome で残る）：本物のランキングの1作品の枠の作り（読み取りの当て方は 2026-11-02 に
 * 公開の画面で確かめ済み）・風船と花火の見た目・吹き出しの位置。
 */
import { describe, expect, it } from "vitest";
import { Actions, Messages, PAGES, WORK_ID, asksFrom, gotFrom, shownFrom, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

/** ページを新しいタブで開き、そのタブの番号を返す（tabs の権限が無いので、開く前と後の差で引く） */
async function 開いて番号を引く(h, url) {
  const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
  const 前 = new Set(await 番号たち());
  await h.open(url);
  return waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, { what: `${url} のタブ` });
}

/** お祝い（吹き出しの mode=celebrate か、題が「ランキングに入っています」のお知らせ） */
const お祝いたち = async (h) =>
  shownFrom(await h.readWatch()).filter(
    (s) => (s.via === "bubble" && s.mode === "celebrate") || (s.via === "notification" && s.title === Messages.RANKINGS.celebrateTitle)
  );

describe("ランキングの画面のお祝いと順位（0.19.0）", () => {
  it("覚えた作品が載った一覧を開くと、訊いたうえでお祝いが一度だけ出て、順位が溜まり、渡す束に入る。なろうのランキングでは何もしない", () =>
    withHelper(async (h) => {
      const 説明 = await h.openOptions();
      await 説明.check("#hand-to-ide");
      await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
      await 説明.close();

      // 作品管理を読んで、見本の作品を「ご自分の作品」として覚える
      const 作品管理のタブ = await 開いて番号を引く(h, PAGES.kakuyomuWork);
      const 問い1 = await waitUntil(async () => asksFrom(await h.readWatch()).find((a) => a.key === "kakuyomu|work") || null, {
        what: "作品管理の問い",
      });
      await h.answer(問い1, "auto");
      await waitUntil(async () => gotFrom(await h.readWatch()).length > 0 || null, { what: "作品管理の取得" });

      // ランキングを開く。初めてなので訊かれる。「自動」と答えると読む
      const ランキングのタブ = await 開いて番号を引く(h, PAGES.kakuyomuRanking);
      const 問い2 = await waitUntil(
        async () => asksFrom(await h.readWatch()).find((a) => a.key === "kakuyomu|rankings") || null,
        { what: "ランキングの問い" }
      );
      // 答えるために吹き出しの画面を別のタブで開くので、ランキングのタブは前に無い。
      // 前に無いタブでは、お祝いを出さずに「祝」の印だけを付ける決まり（0.19.0）
      await h.answer(問い2, "auto");
      await waitUntil(
        async () => (await h.inWorker((id) => chrome.action.getBadgeText({ tabId: id }), ランキングのタブ)) === Actions.BADGES.celebrate.text || null,
        { what: "ランキングのタブの印「祝」" }
      );
      expect(await お祝いたち(h)).toHaveLength(0);

      // そのタブでアイコンを押すと、お祝いが出る
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: ランキングのタブ, url: PAGES.kakuyomuRanking });
      const お祝い = await waitUntil(async () => (await お祝いたち(h)).at(-1) || null, { what: "お祝い" });
      console.info(`お祝いの出方：${お祝い.via === "bubble" ? "アイコンの吹き出し" : "お知らせ"}`);
      expect(お祝い.text).toContain("「画面テストの作品」が");
      expect(お祝い.text).toContain("で 5 位に入っています。");
      expect(お祝い.text).toContain("おめでとうございます！");
      // お祝いを出した回は渡さない（VS Code が前に出ると吹き出しが閉じるため）
      expect((await h.readWatch()).filter((e) => e.kind === "signal")).toHaveLength(0);

      // 順位が溜まる（見本の作品の行だけ。ほかの方の作品の順位は読まない）
      const 順位 = await waitUntil(async () => {
        const r = (await h.storage("helperState")).helperState.rankings || [];
        return r.length > 0 ? r : null;
      }, { what: "溜まった順位" });
      expect(順位).toHaveLength(1);
      expect(順位[0]).toMatchObject({ site: "kakuyomu", workId: WORK_ID, rank: 5 });

      // 開き直しても、お祝いは二度出ない
      const 数 = (await お祝いたち(h)).length;
      await h.open(PAGES.kakuyomuRanking);
      await sleep(4000);
      expect((await お祝いたち(h)).length).toBe(数);
      expect(((await h.storage("helperState")).helperState.rankings || []).length).toBe(1);

      // なろうのランキングでは、訊かず、印も付けず、何も溜めない
      const 問いの数 = asksFrom(await h.readWatch()).length;
      const なろうのタブ = await 開いて番号を引く(h, PAGES.narouRanking);
      await sleep(4000);
      expect(asksFrom(await h.readWatch()).length).toBe(問いの数);
      expect(await h.inWorker((id) => chrome.action.getBadgeText({ tabId: id }), なろうのタブ)).not.toMatch(/位|祝/);
      expect(((await h.storage("helperState")).helperState.rankings || []).length).toBe(1);

      // 作品管理で押すと、読者の反応と一緒に順位も渡す
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: 作品管理のタブ, url: PAGES.kakuyomuWork });
      await waitUntil(async () => (await h.readWatch()).find((e) => e.kind === "signal") || null, { what: "受け手の合図" });
      const 束 = JSON.parse((await h.readWatch()).filter((e) => e.kind === "clipboardWrite").at(-1).text);
      expect(束.kind).toBe("novelai-stats-bundle");
      expect(束.rankings).toHaveLength(1);
      expect(束.rankings[0]).toMatchObject({ site: "kakuyomu", workId: WORK_ID, rank: 5 });
    }));
});
