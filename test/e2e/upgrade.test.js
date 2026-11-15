/**
 * 0.13.3（ストアより前に配った、開いたときの自動取得の無い版）から、いまの版へ**本当に更新**したときをなぞる
 * （2026-11-15。引継ぎ書3章の 0.14.0 の項目「0.13.x から本当に更新したとき」を機械へ移したもの）。
 *
 * やり方：一時のフォルダーへタグ v0.13.3 の中身を出して拡張として読み込み、古い版で作品管理を開いて溜める。
 * そのあと同じフォルダーの中身を、いまの作業場の拡張のファイルへ差し替えて chrome.runtime.reload() する。
 * 手元のフォルダーから入れた拡張は、場所が同じなら拡張IDも保存もそのままで、「更新した」（reason: "update"）の
 * 知らせが届く——ストアから更新した方と同じ決めの道（common/autoRead.js の consentOnInstalled ほか）を通る。
 *
 * Edge のときだけ走らせる（Playwright の Chromium では reload のあと裏方が見えなくなる。e2e/autoRead.test.js の注）。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXTENSION_ROOT, PAGES, WORK_ID, asksFrom, gotFrom, waitUntil, withHelper } from "./support/helperBrowser.js";

const 古い版 = "0.13.3";
const 作品管理 = "kakuyomu|work";

/** 拡張のファイルだけ（テスト・文書・道具・依存は入れない）。いまの作業場から写す */
const 入れない = new Set(["node_modules", ".git", ".claude", ".github", "dist", "test", "docs", "store", "scripts"]);

function 古い版を出す(場所) {
  // tar は使わない（Windows の tar は日本語の名前のファイルで止まる）。拡張のファイルだけを git から1つずつ取り出す
  const 名前たち = execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", `v${古い版}`], { cwd: EXTENSION_ROOT, encoding: "utf8" })
    // -z：名前を引用符で包まず、NUL で区切る（日本語の名前がそのまま読める）
    .split(String.fromCharCode(0))
    .filter((n) => n !== "" && !入れない.has(n.split("/")[0]) && !n.startsWith("."));
  for (const 名 of 名前たち) {
    const 中身 = execFileSync("git", ["show", `v${古い版}:${名}`], { cwd: EXTENSION_ROOT, maxBuffer: 64 * 1024 * 1024 });
    mkdirSync(dirname(join(場所, 名)), { recursive: true });
    writeFileSync(join(場所, 名), 中身);
  }
}

function いまの版へ差し替える(場所) {
  for (const 名 of readdirSync(場所)) {
    rmSync(join(場所, 名), { recursive: true, force: true });
  }
  for (const 名 of readdirSync(EXTENSION_ROOT)) {
    if (入れない.has(名)) continue;
    cpSync(join(EXTENSION_ROOT, 名), join(場所, 名), { recursive: true });
  }
}

describe(`${古い版} から本当に更新したとき`, () => {
  it.runIf(process.env.NPH_E2E_CHANNEL === "msedge")(
    "古い版で溜めた分・覚えた作品・「渡す」の設定は残り、読者の反応の画面は訊かれずに「自動」で取得される",
    async () => {
      const 親 = mkdtempSync(join(tmpdir(), "nph-e2e-upgrade-"));
      const 場所 = join(親, "extension");
      try {
        mkdirSync(場所);
        古い版を出す(場所);
        await withHelper(
          async (h) => {
            expect(await h.inWorker(() => chrome.runtime.getManifest().version)).toBe(古い版);
            // 入れた直後に開く説明のページは閉じる
            for (const p of h.context.pages().filter((p) => p.url().includes("/options.html"))) await p.close();

            // 古い版で、ご自分の作品の作品管理を開く。0.13.3 は、まだ覚えていない作品だと、押したときにお知らせで
            // 「ご自分の作品ですか？」と訊き、［覚える］を押すと覚えて溜める。ここでは［覚える］を押した先の
            // 古い版の関数（覚えて溜める）を呼ぶ。タブの番号は、開く前と後の差で引く（tabs の権限が無い）
            // 新しく入れたときは「統合小説執筆環境へ渡す」が切ってあり、切っている間は溜まりへ入れない（0.11.0）。
            // 渡す方の更新をなぞるため、古い版の説明のページで入れておく
            const 説明 = await h.openOptions();
            await 説明.check("#hand-to-ide");
            await waitUntil(async () => (await h.storage("helperSettings")).helperSettings?.handToIde === true || null, {
              what: "古い版で「渡す」が入る",
            });
            await 説明.close();
            const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
            const 開く前 = new Set(await 番号たち());
            await h.open(PAGES.kakuyomuWork);
            const tabId = await waitUntil(async () => (await 番号たち()).filter((id) => !開く前.has(id)).at(-1) || null, {
              what: "作品管理のタブ",
            });
            await h.inWorker(({ workId, tabId }) => 覚えて溜める("kakuyomu", workId, tabId), { workId: WORK_ID, tabId });
            const 前 = await waitUntil(
              async () => {
                const 状態 = (await h.storage("helperState")).helperState;
                return 状態 && 状態.items && 状態.items.length === 1 ? 状態 : null;
              },
              { what: "古い版で作品管理の分が溜まる", timeout: 30_000 }
            );
            expect(前.ownWorks.map((w) => w.workId)).toContain(WORK_ID);
            const 前の設定 = (await h.storage("helperSettings")).helperSettings;
            const 前の記録 = (await h.storage("readerHistory")).readerHistory;
            expect(前の記録).toBeTruthy();
            for (const p of h.context.pages().filter((p) => p.url().startsWith("https://kakuyomu.jp/"))) await p.close();

            // 同じフォルダーの中身をいまの版へ差し替えて、読み込み直す＝更新
            いまの版へ差し替える(場所);
            await h.inWorker(() => {
              setTimeout(() => chrome.runtime.reload(), 100);
            });
            const 版 = JSON.parse(readFileSync(join(EXTENSION_ROOT, "manifest.json"), "utf8")).version;
            await waitUntil(
              async () => {
                try {
                  return (await h.inWorker(() => chrome.runtime.getManifest().version)) === 版 || null;
                } catch (_e) {
                  return null;
                }
              },
              { what: `${版} へ更新される`, timeout: 30_000 }
            );
            // 更新の知らせで、読者の反応の画面は「自動」で始まる（訊かない）
            const 答え = await waitUntil(
              async () => {
                const a = (await h.storage("autoReadConsent")).autoReadConsent;
                return a && a.pages && a.pages[作品管理] ? a : null;
              },
              { what: "更新の知らせで、作品管理の画面の答えが決まる", timeout: 30_000 }
            );
            expect(答え.pages[作品管理]).toMatchObject({ choice: "auto", by: "update" });
            await h.watch();

            // 古い版の保存はそのまま読める：溜まり・覚えた作品・設定・集計の記録
            const 後 = (await h.storage("helperState")).helperState;
            expect(後.items).toHaveLength(1);
            expect(後.ownWorks.map((w) => w.workId)).toContain(WORK_ID);
            expect((await h.storage("helperSettings")).helperSettings).toMatchObject({ handToIde: 前の設定.handToIde });
            expect((await h.storage("readerHistory")).readerHistory).toBeTruthy();
            // 更新では説明のページを開かない
            expect(h.context.pages().filter((p) => p.url().includes("/options.html"))).toHaveLength(0);

            // 作品管理を開き直すと、訊かれずに取得される（溜まりは同じ画面の分なので置き換わり、1画面のまま）
            await h.open(PAGES.kakuyomuWork);
            await waitUntil(async () => gotFrom(await h.readWatch()).length > 0 || null, { what: "開いたときの取得の知らせ", timeout: 30_000 });
            expect(asksFrom(await h.readWatch()).filter((a) => a.key === 作品管理)).toHaveLength(0);
            expect((await h.storage("helperState")).helperState.items).toHaveLength(1);
          },
          { extensionRoot: 場所, installedKeys: ["helperSettings"] }
        );
      } finally {
        rmSync(親, { recursive: true, force: true });
      }
    },
    180_000
  );
});
