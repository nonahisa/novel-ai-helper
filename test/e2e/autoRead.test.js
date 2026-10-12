/**
 * 開いたときの自動取得（0.14.0）を、拡張を読み込んだ Chromium でなぞる（画面の自動テスト）。
 *
 * README 末尾「実機で確かめること」の 0.14.0 の項目のうち、機械で届くものをここへ移した。
 * 投稿サイトは本物へ行かず、test/e2e/fixtures/ の見本を返す（support/helperBrowser.js）。
 *
 * 作者の画面で「どう見えるか」（吹き出しの位置・大きさ・字が読めるか）は、ここでは確かめられない。
 * ここで確かめるのは、**何が出たか（吹き出しかお知らせか・文言）と、保存に何が残ったか**。
 */
import { describe, expect, it } from "vitest";
import {
  Actions,
  Messages,
  PAGES,
  WORK_ID,
  asksFrom,
  gotFrom,
  sleep,
  waitUntil,
  withHelper,
} from "./support/helperBrowser.js";

const 作品管理 = "kakuyomu|work";
const アクセス数 = "kakuyomu|accesses";
const ノベルポータル = "novelportal|contests";

/**
 * 「何も起きない」を確かめるときに待つ時間。裏方は開いてから 1.5秒待って読む（background.js の
 * 開いてから読むまで）ので、その倍より長く待つ。肯定の確かめは waitUntil で待つ（固定の時間にしない）。
 */
const 何も起きないのを待つ = 4000;

/** その種類の問いが、前の数より増えるまで待つ。増えた最後の1件を返す。 */
async function 問いを待つ(h, key, 前の数 = 0) {
  return waitUntil(
    async () => {
      const 問い = asksFrom(await h.readWatch()).filter((a) => a.key === key);
      return 問い.length > 前の数 ? 問い[問い.length - 1] : null;
    },
    { what: `「${key}」の自動取得の問い` }
  );
}

async function 問いの数(h, key) {
  return asksFrom(await h.readWatch()).filter((a) => a.key === key).length;
}

/** 「取得しました」が、前の数より増えるまで待つ。 */
async function 取得の知らせを待つ(h, 前の数 = 0) {
  return waitUntil(
    async () => {
      const 知らせ = gotFrom(await h.readWatch());
      return 知らせ.length > 前の数 ? 知らせ[知らせ.length - 1] : null;
    },
    { what: "「取得しました」の知らせ" }
  );
}

/** 説明のページで「統合小説執筆環境へ渡す」を入れる（新しく入れた方は切った状態で始まる。0.11.0）。 */
async function 渡すを入れる(h) {
  const 説明 = await h.openOptions();
  await 説明.check("#hand-to-ide");
  await 説明.waitForFunction(() => /入れました/.test(document.getElementById("toggle-result").textContent || ""));
  await 説明.close();
  const 保存 = await h.storage("helperSettings");
  expect(保存.helperSettings.handToIde).toBe(true);
}

/** カクヨムの作品管理を開いて問いを待ち、「自動で取得する」と答えて、取得の知らせまで待つ。 */
async function 作品管理を自動にする(h) {
  const ページ = await h.open(PAGES.kakuyomuWork);
  const 問い = await 問いを待つ(h, 作品管理);
  const 返事 = await h.answer(問い, "auto");
  expect(返事).toBe(Messages.AUTO_READ.answeredAuto("カクヨムの作品管理"));
  const 知らせ = await 取得の知らせを待つ(h);
  return { ページ, 問い, 知らせ };
}

describe("開いたときの自動取得（0.14.0）", () => {
  it("新しいプロフィールでカクヨムの作品管理を開くと、自動取得の問いが出る（吹き出しか、ボタン付きのお知らせ）", () =>
    withHelper(async (h) => {
      await h.open(PAGES.kakuyomuWork);
      const 問い = await 問いを待つ(h, 作品管理);

      // どちらで出たかを残す（作者の画面では吹き出しが出るかが、いちばん確かめたいこと。headless では断られうる）
      const 吹き出しの試み = (await h.readWatch()).filter((e) => e.kind === "openPopup");
      console.info(
        `問いの出方：${問い.via === "bubble" ? "アイコンの吹き出し" : "ボタン付きのお知らせ"}` +
          `（吹き出しの試み：${吹き出しの試み.map((e) => (e.ok ? "通った" : `断られた〔${e.error}〕`)).join("・") || "無し"}）`
      );
      expect(["bubble", "notification"]).toContain(問い.via);
      if (問い.via === "notification") {
        expect(問い.buttons).toEqual(Messages.AUTO_READ.BUTTONS);
      }

      // 訊いたことが残る（二度は訊かない）。答えるまでは取得しない
      const 保存 = await h.storage(["autoReadConsent", "readerHistory", "helperState"]);
      expect(保存.autoReadConsent.pages[作品管理].choice).toBe("asked");
      await sleep(何も起きないのを待つ);
      expect(gotFrom(await h.readWatch())).toHaveLength(0);
      const 後 = await h.storage(["readerHistory", "helperState"]);
      expect((後.readerHistory && 後.readerHistory.works) || []).toHaveLength(0);
      expect((後.helperState && 後.helperState.items) || []).toHaveLength(0);
    }));

  it("「自動で取得する」と答えると「取得しました（溜まり 1画面）」が出て、開き直しても二度は訊かれず、VS Code は呼ばない", () =>
    withHelper(async (h) => {
      // 「溜まり N画面」と言うのは「統合小説執筆環境へ渡す」が入っているときだけ（新しく入れた方は切ってある）
      await 渡すを入れる(h);
      const { 知らせ } = await 作品管理を自動にする(h);
      expect(知らせ.title).toBe(Messages.AUTO_READ.statsGot(1, true).title);
      expect(知らせ.title).toBe("取得しました（溜まり 1画面）");

      const 保存 = await h.storage(["autoReadConsent", "helperState"]);
      expect(保存.autoReadConsent.pages[作品管理]).toMatchObject({ choice: "auto", by: "author" });
      expect(保存.helperState.items).toHaveLength(1);

      // 開き直す（新しいタブで。同じタブの同じ URL は、裏方が10秒のあいだ読み直さない）
      await h.open(PAGES.kakuyomuWork);
      const 二度目 = await 取得の知らせを待つ(h, 1);
      // 同じ画面は置き換わるので、溜まりは 1画面のまま
      expect(二度目.title).toBe(Messages.AUTO_READ.statsGot(1, true).title);
      expect(await 問いの数(h, 作品管理)).toBe(1);

      // 開いたときには VS Code を呼ばない（呼ぶのは押したときだけ）
      expect((await h.readWatch()).filter((e) => e.kind === "signal")).toHaveLength(0);
    }));

  it("作品管理で答えたあと、アクセス数の画面を初めて開くと、アクセス数についてもう一度訊かれる", () =>
    withHelper(async (h) => {
      await 作品管理を自動にする(h);
      // 作品管理を読めたので、この作品は「ご自分の作品」として覚えている（アクセス数は覚えた作品だけ取得する）
      const 覚えた = (await h.storage("helperState")).helperState.ownWorks;
      expect(覚えた.map((w) => `${w.siteId}|${w.workId}`)).toContain(`kakuyomu|${WORK_ID}`);

      await h.open(PAGES.kakuyomuAccesses);
      const 問い = await 問いを待つ(h, アクセス数);
      expect(問い.key).toBe(アクセス数);
      expect(await 問いの数(h, 作品管理)).toBe(1);
    }));

  it("説明のページで「今までどおり押して取得する」に変えると、開いても訊かれず取得もされない", () =>
    withHelper(async (h) => {
      const 説明 = await h.openOptions();
      await 説明.selectOption('select[data-auto-read="kakuyomu|work"]', "manual");
      await 説明.waitForFunction(() => /変えました/.test(document.getElementById("auto-read-result").textContent || ""));
      await 説明.close();
      expect((await h.storage("autoReadConsent")).autoReadConsent.pages[作品管理]).toMatchObject({
        choice: "manual",
        by: "author",
      });

      await h.open(PAGES.kakuyomuWork);
      await sleep(何も起きないのを待つ);
      expect(await 問いの数(h, 作品管理)).toBe(0);
      expect(gotFrom(await h.readWatch())).toHaveLength(0);
      const 保存 = await h.storage(["readerHistory", "helperState"]);
      expect((保存.readerHistory && 保存.readerHistory.works) || []).toHaveLength(0);
      expect((保存.helperState && 保存.helperState.items) || []).toHaveLength(0);
    }));

  it("「統合小説執筆環境へ渡す」を切っているときは、取得して記録するが、溜まりの数を出さない", () =>
    withHelper(async (h) => {
      // 新しく入れた方は切った状態で始まる（0.11.0）。その既定のまま
      expect((await h.storage("helperSettings")).helperSettings.handToIde).toBe(false);
      const { 知らせ } = await 作品管理を自動にする(h);
      expect(知らせ.title).toBe(Messages.AUTO_READ.statsGot(1, false).title);
      expect(知らせ.title).not.toMatch(/溜まり/);

      const 保存 = await h.storage(["readerHistory", "helperState"]);
      // 溜まり（渡す分）には置かない
      expect(保存.helperState.items).toHaveLength(0);
      // 集計の記録には残る
      expect(保存.readerHistory.works.map((w) => `${w.siteId}|${w.workId}`)).toContain(`kakuyomu|${WORK_ID}`);
      // 拡張全体の印（読N）も出さない
      expect(await h.inWorker(() => chrome.action.getBadgeText({}))).toBe("");
    }));

  it("アイコンを押すと、溜まりがクリップボードに入り、受け手の合図（読者の反応の取り込み口）へタブが向かう", () =>
    withHelper(async (h) => {
      await 渡すを入れる(h);
      const { 問い } = await 作品管理を自動にする(h);
      const tabId = Number(問い.tab);
      expect(Number.isSafeInteger(tabId)).toBe(true);

      // 吹き出しを出したあと、アイコンに吹き出しが結び付いたままになっていない（残っていると、押しても実行されず吹き出しが出る）
      expect(await h.inWorker((id) => chrome.action.getPopup({ tabId: id }), tabId)).toBe("");

      // アイコンを押す。Playwright からはツールバーのアイコンを押せないので、押したときに Chrome が呼ぶ
      // 受け口（action.onClicked → 実行する）と同じ関数を、裏方の中で呼ぶ。tab.url は activeTab で読めるものの代わり
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuWork });

      const 合図 = await waitUntil(
        async () => (await h.readWatch()).find((e) => e.kind === "signal") || null,
        { what: "受け手の合図" }
      );
      // 合図は押したタブへ。行き先はパスだけ確かめる（受け手の名前はここに書き写さない）
      expect(合図.tabId).toBe(tabId);
      expect(new URL(合図.url).pathname).toBe(new URL(Actions.VSCODE_IMPORT_URL).pathname);

      // クリップボードへ置いたのは、溜まりの束（読者の反応の封筒が1つ）
      const 置いた = (await h.readWatch()).filter((e) => e.kind === "clipboardWrite");
      expect(置いた).toHaveLength(1);
      const 束 = JSON.parse(置いた[0].text);
      expect(束.kind).toBe("novelai-stats-bundle");
      expect(束.items).toHaveLength(1);

      // 渡したら溜まりは空になり、控えに移る
      const 保存 = await h.storage("helperState");
      expect(保存.helperState.items).toHaveLength(0);
      expect(保存.helperState.handed.items).toHaveLength(1);
    }));

  it("公募の一覧のページでも訊かれ、「自動」なら「取得しました（公募 N件）」が出る", () =>
    withHelper(async (h) => {
      await h.open(PAGES.novelportal);
      const 問い = await 問いを待つ(h, ノベルポータル);
      await h.answer(問い, "auto");
      const 知らせ = await 取得の知らせを待つ(h);
      // 見本の公募は2件（「開催予定」の枠は数えない）。切っている既定のまま
      expect(知らせ.title).toBe(Messages.AUTO_READ.contestsGot({ count: 2 }, false).title);
      const 棚 = (await h.storage("contestShelf")).contestShelf;
      expect(棚.items).toHaveLength(1);
      expect(棚.items[0].count).toBe(2);
    }));

  /*
    **飛ばす（2026-10-12）。** テスト用の Chromium（Playwright 1.63、headless）では、chrome.runtime.reload()
    のあと拡張の裏方（service worker）がテストから二度と見えない。ノートPCで、合図を待つ形で1/1、一覧を
    繰り返し見て説明のページで起こす形で 0/3（「30秒見つからなかった」）。製品の判断（更新した方は
    読者の反応の画面を「自動」で始める）は単体テスト test/autoRead.test.js の consentOnInstalled が見張る。
    更新の知らせから保存までのつながりは、実機確認（README の 0.14.0 の項目「0.13.x から更新した Chrome」）に残す
  */
  it.skip("更新した Chrome（拡張の再読み込み＝更新の知らせ）では、読者の反応の画面は訊かれずに取得される", () =>
    withHelper(async (h) => {
      // 入れた直後は「まだ決めていない」
      expect((await h.storage("autoReadConsent")).autoReadConsent.pages[作品管理]).toBeUndefined();

      // 拡張を読み込み直す。手元のフォルダーから入れた拡張は、読み込み直すと「更新した」（reason: "update"）
      // の知らせが届く。0.13.x から更新した方と同じ決めの道（common/autoRead.js の consentOnInstalled）を通る
      await h.inWorker(() => {
        setTimeout(() => chrome.runtime.reload(), 100);
      });
      await waitUntil(
        async () => {
          const 答え = (await h.storage("autoReadConsent")).autoReadConsent;
          return 答え && 答え.pages[作品管理] && 答え.pages[作品管理].by === "update";
        },
        { what: "更新の知らせで、読者の反応の画面が「自動」になる", timeout: 30_000 }
      );
      await h.watch();
      expect((await h.storage("autoReadConsent")).autoReadConsent.pages[作品管理].choice).toBe("auto");

      await h.open(PAGES.kakuyomuWork);
      const 知らせ = await 取得の知らせを待つ(h);
      expect(知らせ.title).toBe(Messages.AUTO_READ.statsGot(1, false).title);
      expect(await 問いの数(h, 作品管理)).toBe(0);
    }));
});
