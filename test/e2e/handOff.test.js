/**
 * 「統合小説執筆環境へ渡す」を切ったとき（0.11.0）を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 *
 * 引継ぎ書3章の「0.11.0：切ったとき」のうち、拡張の中だけで決まること——印の字・押したときに何が開くか・
 * 溜まりと集計の記録——をここへ移した。投稿サイトは本物へ行かず、test/e2e/fixtures/ の見本を返す。
 *
 * ここで確かめないこと（作者の Chrome で残る）：
 * - Chrome が「Visual Studio Code を開きますか？」と本当に尋ねないか（ここでは合図〔vscode://〕へ向かう頼みが
 *   1本も出ないことまでを見る）
 * - 話の作成画面で、切っていても「貼」が出て貼り込めるか（0.11.1。見本の投稿画面がまだ無い）
 */
import { describe, expect, it } from "vitest";
import { Actions, PAGES, asksFrom, gotFrom, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

const 作品管理 = "kakuyomu|work";

/** 説明のページで「統合小説執筆環境へ渡す」を入れる・切る */
async function 渡すを切り替える(h, 入れる) {
  const 説明 = await h.openOptions();
  if (入れる) {
    await 説明.check("#hand-to-ide");
  } else {
    await 説明.uncheck("#hand-to-ide");
  }
  const 返事の字 = 入れる ? /入れました/ : /切りました/;
  await 説明.waitForFunction((源) => new RegExp(源).test(document.getElementById("toggle-result").textContent || ""), 返事の字.source);
  await 説明.close();
  expect((await h.storage("helperSettings")).helperSettings.handToIde).toBe(入れる);
}

/**
 * ページを新しいタブで開き、そのタブの番号を返す。開く前と後のタブの番号の差で引く
 * （この拡張は tabs の権限を持たないので、URL で絞って探せない）
 */
async function 開いて番号を引く(h, url) {
  const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
  const 前 = new Set(await 番号たち());
  await h.open(url);
  return waitUntil(
    async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null,
    { what: `${url} のタブ` }
  );
}

/** 説明のページ（options.html）を開いているタブの数 */
function 説明のタブの数(h) {
  return h.context.pages().filter((p) => p.url().startsWith(h.url("options.html"))).length;
}

/** アイコンを押す（押したときに Chrome が呼ぶ受け口と同じ関数を、裏方の中で呼ぶ。autoRead.test.js と同じ） */
async function アイコンを押す(h, tabId, url) {
  await h.inWorker(({ id, url: u }) => 実行する({ id, url: u, active: true }, u), { id: tabId, url });
}

describe("「統合小説執筆環境へ渡す」を切ったとき（0.11.0）", () => {
  it("全体の印「読N」が消え、作品管理の印は数字の無い「読」。押すと集計が開き、VS Code を呼ばない。溜まりは増えず、集計には記録され、入れ直すと切る前の溜まりを渡せる", () =>
    withHelper(async (h) => {
      // 入れた状態で、作品管理を「自動」にして1画面ぶん溜める
      await 渡すを切り替える(h, true);
      await h.open(PAGES.kakuyomuWork);
      const 問い = await waitUntil(
        async () => asksFrom(await h.readWatch()).find((a) => a.key === 作品管理) || null,
        { what: "作品管理の自動取得の問い" }
      );
      await h.answer(問い, "auto");
      await waitUntil(async () => gotFrom(await h.readWatch()).length > 0 || null, { what: "「取得しました」" });
      await waitUntil(async () => ((await h.storage("helperState")).helperState.items.length === 1) || null, {
        what: "溜まりが1画面になる",
      });
      expect(await h.inWorker(() => chrome.action.getBadgeText({}))).toBe(Actions.stashBadgeText(1));
      const 切る前の記録 = (await h.storage("readerHistory")).readerHistory;

      // 切る。全体の印「読1」が消える。溜まりは消さない
      await 渡すを切り替える(h, false);
      await waitUntil(async () => (await h.inWorker(() => chrome.action.getBadgeText({}))) === "" || null, {
        what: "全体の印が消える",
      });
      expect((await h.storage("helperState")).helperState.items).toHaveLength(1);

      // 作品管理を開き直す。印は数字の無い「読」。取得はするが、溜まりは増えない
      const 知らせの数 = gotFrom(await h.readWatch()).length;
      const tabId = await 開いて番号を引く(h, PAGES.kakuyomuWork);
      await waitUntil(
        async () => (await h.inWorker((id) => chrome.action.getBadgeText({ tabId: id }), tabId)) === Actions.BADGES.stats.text || null,
        { what: "作品管理のタブの印が「読」になる" }
      );
      await waitUntil(async () => gotFrom(await h.readWatch()).length > 知らせの数 || null, { what: "切ったあとの「取得しました」" });
      const 後 = await h.storage(["helperState", "readerHistory"]);
      expect(後.helperState.items).toHaveLength(1);
      // 集計には記録される（同じ作品のまま、記録の数は減らない）
      expect(後.readerHistory.works.map((w) => `${w.siteId}|${w.workId}`)).toEqual(
        切る前の記録.works.map((w) => `${w.siteId}|${w.workId}`)
      );
      expect(JSON.stringify(後.readerHistory).length).toBeGreaterThanOrEqual(JSON.stringify(切る前の記録).length);

      // 押すと説明のページ（集計）が開く。クリップボードにも VS Code にも行かない
      // 開いている説明のページ（入れた直後に開いたもの）は先に閉じる。開いていると、Chrome はそれを前に出すだけで新しく開かない
      for (const p of h.context.pages().filter((p) => p.url().startsWith(h.url("options.html")))) await p.close();
      expect(説明のタブの数(h)).toBe(0);
      await アイコンを押す(h, tabId, PAGES.kakuyomuWork);
      await waitUntil(async () => 説明のタブの数(h) > 0 || null, { what: "説明のページが開く" });
      await sleep(1500);
      const 記録 = await h.readWatch();
      expect(記録.filter((e) => e.kind === "signal")).toHaveLength(0);
      expect(記録.filter((e) => e.kind === "clipboardWrite")).toHaveLength(0);
      expect((await h.storage("helperState")).helperState.items).toHaveLength(1);

      // 入れ直すと、全体の印が戻り、押すと切る前の溜まりを渡せる
      await 渡すを切り替える(h, true);
      await waitUntil(
        async () => (await h.inWorker(() => chrome.action.getBadgeText({}))) === Actions.stashBadgeText(1) || null,
        { what: "全体の印「読1」が戻る" }
      );
      await アイコンを押す(h, tabId, PAGES.kakuyomuWork);
      const 合図 = await waitUntil(
        async () => (await h.readWatch()).find((e) => e.kind === "signal") || null,
        { what: "入れ直したあとの受け手の合図" }
      );
      expect(合図.tabId).toBe(tabId);
      const 置いた = (await h.readWatch()).filter((e) => e.kind === "clipboardWrite");
      expect(置いた).toHaveLength(1);
      const 束 = JSON.parse(置いた[0].text);
      expect(束.kind).toBe("novelai-stats-bundle");
      expect(束.items).toHaveLength(1);
    }));
});
