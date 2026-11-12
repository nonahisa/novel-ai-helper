/**
 * 入れた直後と説明のページ（0.8.0・0.9.0・0.11.0）を、拡張を読み込んだブラウザでなぞる（画面の自動テスト）。
 *
 * 引継ぎ書3章の実機確認の残りのうち、作者の Chrome が要らないもの——拡張の中だけで決まること——をここへ移した。
 * 投稿サイトは本物へ行かず、test/e2e/fixtures/ の見本を返す（support/helperBrowser.js）。
 */
import { describe, expect, it } from "vitest";
import { PAGES, WORK_ID, asksFrom, gotFrom, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

/** いま開いている説明のページ（options.html）のタブ */
function 説明のタブ(h) {
  return h.context.pages().filter((p) => p.url().startsWith(h.url("options.html")));
}

/** 説明のページで「統合小説執筆環境へ渡す」を入れる */
async function 渡すを入れる(h) {
  const 説明 = await h.openOptions();
  await 説明.check("#hand-to-ide");
  await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
  await 説明.close();
}

/** カクヨムの作品管理を開き、「自動で取得する」と答えて、1画面ぶん溜める */
async function 一画面ためる(h) {
  await h.open(PAGES.kakuyomuWork);
  const 問い = await waitUntil(
    async () => asksFrom(await h.readWatch()).find((a) => a.key === "kakuyomu|work") || null,
    { what: "作品管理の自動取得の問い" }
  );
  await h.answer(問い, "auto");
  await waitUntil(async () => gotFrom(await h.readWatch()).length > 0 || null, { what: "「取得しました」" });
  await waitUntil(async () => ((await h.storage("helperState")).helperState.items.length === 1) || null, {
    what: "溜まりが1画面になる",
  });
}

describe("入れた直後（0.8.0・0.11.0）", () => {
  it("新しく入れると説明のページが1回だけ開き、「統合小説執筆環境へ渡す」は切ってある", () =>
    withHelper(async (h) => {
      await waitUntil(async () => 説明のタブ(h).length > 0 || null, { what: "入れた直後の説明のページ" });
      // 少し待っても2枚目は開かない
      await sleep(2000);
      expect(説明のタブ(h)).toHaveLength(1);
      expect((await h.storage("helperSettings")).helperSettings.handToIde).toBe(false);

      // 入れた直後に開いた説明のページで、欄も切ってある
      const 開いた = 説明のタブ(h)[0];
      await 開いた.waitForFunction(() => {
        const 欄 = document.getElementById("hand-to-ide");
        return 欄 && !欄.disabled;
      });
      expect(await 開いた.isChecked("#hand-to-ide")).toBe(false);
    }));

  it("拡張を再読み込み（更新）しても説明のページは開かず、作者が入れた「渡す」は入ったまま", () =>
    withHelper(async (h) => {
      await waitUntil(async () => 説明のタブ(h).length > 0 || null, { what: "入れた直後の説明のページ" });
      for (const p of 説明のタブ(h)) await p.close();
      await 渡すを入れる(h);
      expect(説明のタブ(h)).toHaveLength(0);

      // 手元のフォルダーから入れた拡張は、読み込み直すと「更新した」（reason: "update"）の知らせが届く
      await h.inWorker(() => {
        setTimeout(() => chrome.runtime.reload(), 100);
      });
      await waitUntil(
        async () => {
          const 答え = (await h.storage("autoReadConsent")).autoReadConsent;
          return (答え && 答え.pages["kakuyomu|work"] && 答え.pages["kakuyomu|work"].by === "update") || null;
        },
        { what: "更新の知らせが届いた（読者の反応の画面が「自動」で始まる）", timeout: 30_000 }
      );
      await sleep(2000);
      expect(説明のタブ(h)).toHaveLength(0);
      expect((await h.storage("helperSettings")).helperSettings.handToIde).toBe(true);
    }));

  it("0.10.0（設定の鍵が無い版）から更新すると「渡す」が入っていて、全体の印「読N」が出て、押すと渡せる", () =>
    withHelper(async (h) => {
      await waitUntil(async () => 説明のタブ(h).length > 0 || null, { what: "入れた直後の説明のページ" });
      for (const p of 説明のタブ(h)) await p.close();
      // 0.10.0 を使っていた方の保存を作る：1画面ぶん溜まっていて、「渡す」の設定の鍵はまだ無い
      await 渡すを入れる(h);
      await 一画面ためる(h);
      await h.inWorker(() => chrome.storage.local.remove("helperSettings"));
      expect((await h.storage("helperSettings")).helperSettings).toBeUndefined();

      // 読み込み直す＝更新の知らせ（reason: "update"）
      await h.inWorker(() => {
        setTimeout(() => chrome.runtime.reload(), 100);
      });
      await waitUntil(
        async () => {
          const 設定 = (await h.storage("helperSettings")).helperSettings;
          return (設定 && 設定.decidedBy === "update") || null;
        },
        { what: "更新の知らせで「渡す」が決まる", timeout: 30_000 }
      );
      expect((await h.storage("helperSettings")).helperSettings.handToIde).toBe(true);
      await h.watch();

      // 説明のページの欄は入っている
      const 説明 = await h.openOptions();
      expect(await 説明.isChecked("#hand-to-ide")).toBe(true);
      await 説明.close();

      // 溜まりは残り、全体の印「読1」が出る
      expect((await h.storage("helperState")).helperState.items).toHaveLength(1);
      await waitUntil(async () => (await h.inWorker(() => chrome.action.getBadgeText({}))) === "読1" || null, {
        what: "全体の印「読1」",
      });

      // 新しいタブの作品管理で押すと、溜まりを渡して受け手の合図へ向かう
      const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
      const 前 = new Set(await 番号たち());
      await h.open(PAGES.kakuyomuWork);
      const tabId = await waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, {
        what: "作品管理のタブ",
      });
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuWork });
      await waitUntil(async () => (await h.readWatch()).find((e) => e.kind === "signal") || null, { what: "受け手の合図" });
      const 置いた = (await h.readWatch()).filter((e) => e.kind === "clipboardWrite");
      expect(JSON.parse(置いた.at(-1).text).kind).toBe("novelai-stats-bundle");
    }));
});

describe("説明のページの溜まりの欄（0.9.0）", () => {
  it("［もう一度渡す］で、前に渡した分がもう一度クリップボードへ入り、受け手の合図へ向かう", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      await 一画面ためる(h);

      const 説明 = await h.openOptions();
      await 説明.waitForFunction(() => !document.getElementById("hand-now").disabled);
      await 説明.click("#hand-now");
      await waitUntil(async () => ((await h.storage("helperState")).helperState.handed || null), {
        what: "渡した分の控え",
      });
      const 一回目 = (await h.readWatch()).filter((e) => e.kind === "clipboardWrite");
      expect(一回目).toHaveLength(1);

      await 説明.reload({ waitUntil: "load" });
      await 説明.waitForFunction(() => !document.getElementById("hand-again").disabled);
      await 説明.click("#hand-again");
      const 二回目 = await waitUntil(
        async () => {
          const 置いた = (await h.readWatch()).filter((e) => e.kind === "clipboardWrite");
          return 置いた.length >= 2 ? 置いた : null;
        },
        { what: "もう一度渡したクリップボード" }
      );
      // 同じ中身をもう一度（渡した時刻 handedAt だけは、渡し直した時刻になる）
      const 時刻を除く = (t) => {
        const { handedAt, ...残り } = JSON.parse(t);
        expect(typeof handedAt).toBe("string");
        return 残り;
      };
      expect(時刻を除く(二回目[1].text)).toEqual(時刻を除く(二回目[0].text));
      expect(JSON.parse(二回目[1].text).kind).toBe("novelai-stats-bundle");
      expect((await h.readWatch()).filter((e) => e.kind === "signal").length).toBeGreaterThanOrEqual(2);
    }));

  it("［溜まりを空にする］は確かめてから空にし、断れば何もしない。集計の記録は残る", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      await 一画面ためる(h);

      const 説明 = await h.openOptions();
      await 説明.waitForFunction(() => !document.getElementById("clear-stash").disabled);
      expect(await 説明.textContent("#stash-count")).toMatch(/1画面ぶん/);

      // 断ると何もしない
      説明.once("dialog", (d) => d.dismiss());
      await 説明.click("#clear-stash");
      await sleep(1000);
      expect((await h.storage("helperState")).helperState.items).toHaveLength(1);

      // 確かめて空にする
      let 文 = "";
      説明.once("dialog", (d) => {
        文 = d.message();
        d.accept();
      });
      await 説明.click("#clear-stash");
      await waitUntil(async () => ((await h.storage("helperState")).helperState.items.length === 0) || null, {
        what: "溜まりが空になる",
      });
      expect(文).toMatch(/溜まっている読者の反応を消します/);
      await 説明.waitForFunction(() => /溜まっている読者の反応はありません/.test(document.getElementById("stash-count").textContent || ""));
      // 集計の記録は残る
      expect((await h.storage("readerHistory")).readerHistory.works.length).toBe(1);
    }));
});

describe("押したときの診断（0.21.0）", () => {
  it("開いただけでは残らず、アイコンを押すとアドレスの形（数字は伏せる）が説明のページの診断に出て、消せる", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      await 一画面ためる(h);
      let 説明 = await h.openOptions();
      await 説明.waitForFunction(() => /まだ記録はありません/.test(document.getElementById("press-log").textContent || ""));
      expect(await 説明.isDisabled("#clear-press-log")).toBe(true);
      await 説明.close();

      // 作品管理のタブで押す
      const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
      const 前 = new Set(await 番号たち());
      await h.open(PAGES.kakuyomuWork);
      const tabId = await waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, { what: "作品管理のタブ" });
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuWork });
      await waitUntil(async () => ((await h.storage("pressLog")).pressLog || null), { what: "診断の記録" });

      説明 = await h.openOptions();
      await 説明.waitForFunction(() => /kakuyomu\.jp\/my\/works\/#/.test(document.getElementById("press-log").textContent || ""));
      expect(await 説明.textContent("#press-log")).not.toContain(WORK_ID);
      説明.once("dialog", (d) => d.accept());
      await 説明.click("#clear-press-log");
      await 説明.waitForFunction(() => /まだ記録はありません/.test(document.getElementById("press-log").textContent || ""));
      expect((await h.storage("pressLog")).pressLog).toBeUndefined();
      expect((await h.storage("readerHistory")).readerHistory.works.length).toBe(1);
    }));
});

