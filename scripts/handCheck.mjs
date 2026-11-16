/**
 * 手で見る台：この拡張を読み込んだ Chromium を**窓を出して**起こし、見本のページを開いたまま待つ。
 *
 * 実機確認の残りのうち、ブラウザの枠や OS が描くもの（アイコンからの吹き出しの位置・右クリックの一覧・
 * Windows の通知）を、作者の Chrome でなくても見るためのもの（作者の指示「各ハードにテストを割り振ってください」
 * 2026-11-16、母艦経由）。テスト用の機械（ノートPC・Mac）で人か Claude が画面を見て、押して確かめる。
 *
 * - **本物のサイトへは1本も行かない。** E2E と同じく全部の通信を止め、見本（test/e2e/fixtures/）だけを返す。
 *   サインインも投稿もしない
 * - E2E と違い、お知らせ（chrome.notifications）を止めない。本当に画面の隅に出るかを見るため
 * - 一時のプロフィールで起こし、窓を閉じるか Ctrl+C で終わると消す
 * - **作者の PC では走らせない**（窓が前に出る）。作者の PC で中身を確かめるときは --headless で開けるかだけ見る
 *
 * 使い方：node scripts/handCheck.mjs <C|D|F|G> [--headless]
 *   C：空のページ。アイコンを押すと、ふつうのお知らせ（「ここでは…」）が出るか
 *   D：カクヨムの作品管理（見本）。開くとアイコンから「開いたときに自動で取得しますか？」の吹き出しが出るか・その位置
 *   F：カクヨムのアクセス数（見本）。「統合小説執筆環境へ渡す」を入れてある。押すと「次へ」の但し書きのお知らせが出るか
 *   G：カクヨムの作品管理（見本）。ページの上で右クリックすると「章立てを取得」が出るか
 * ブラウザは NPH_E2E_CHANNEL（既定は Playwright の Chromium。ブランドの Chrome は拡張を読み込めない）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { EXTENSION_ROOT, PAGES, 通信を止めて見本を返す } from "../test/e2e/support/helperBrowser.js";

const 項目 = {
  C: { url: "about:blank", 見ること: "この拡張のアイコンを押す → 画面の隅にお知らせが出るか（出なければ Windows の時計を押した通知の一覧にあるか）" },
  D: { url: PAGES.kakuyomuWork, 見ること: "少し待つ → アイコン（またはパズルのかけらのボタン）のあたりから吹き出しが出るか・その位置。「自動で取得する」を押して「取得しました」が出るか。そのあとアイコンを押して吹き出しが残らないか" },
  F: { url: PAGES.kakuyomuAccesses, 見ること: "吹き出しの問いが出たら「自動で取得する」→ アイコンを押す → 「次へ」の但し書きのあるお知らせが画面の隅に出るか", 渡す: true },
  G: { url: PAGES.kakuyomuWork, 見ること: "ページの上で右クリック → 一覧に「章立てを取得」（この拡張の名前の下のこともある）が出るか。選ぶと「大見出し…」のお知らせが出るか" },
};

const 印 = String(process.argv[2] || "").toUpperCase();
const 窓を出さない = process.argv.includes("--headless");
if (!項目[印]) {
  console.error("使い方：node scripts/handCheck.mjs <C|D|F|G> [--headless]");
  process.exit(2);
}

const プロフィール = await mkdtemp(join(tmpdir(), "nph-hand-"));
let context = null;
const 片付ける = async () => {
  if (context) await context.close().catch(() => undefined);
  context = null;
  for (let i = 0; i < 10; i += 1) {
    try {
      await rm(プロフィール, { recursive: true, force: true });
      return;
    } catch (_e) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
};
process.on("SIGINT", async () => {
  await 片付ける();
  process.exit(0);
});

try {
  context = await chromium.launchPersistentContext(プロフィール, {
    channel: process.env.NPH_E2E_CHANNEL || "chromium",
    headless: 窓を出さない,
    viewport: null,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${EXTENSION_ROOT}`, `--load-extension=${EXTENSION_ROOT}`],
  });
  await 通信を止めて見本を返す(context);
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  const 拡張ID = new URL(sw.url()).host;
  // 入れた直後の決め（「渡す」の入・切など）が保存に書かれるまで待つ
  for (let i = 0; i < 75; i += 1) {
    const 保存 = await sw.evaluate(() => chrome.storage.local.get(["helperSettings", "autoReadConsent"]));
    if (保存.helperSettings !== undefined && 保存.autoReadConsent !== undefined) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // 入れた直後に開く説明のページは、そのまま残す（新しく入れたときの姿）
  if (項目[印].渡す) {
    const 説明 = await context.newPage();
    await 説明.goto(`chrome-extension://${拡張ID}/options.html`, { waitUntil: "load" });
    await 説明.waitForFunction(() => {
      const 欄 = document.getElementById("hand-to-ide");
      return 欄 && !欄.disabled;
    });
    await 説明.check("#hand-to-ide");
    await 説明.close();
  }
  const ページ = await context.newPage();
  await ページ.goto(項目[印].url, { waitUntil: "load" });
  await ページ.bringToFront();
  console.log(`開きました（${印}）：${項目[印].url}`);
  console.log(`見ること：${項目[印].見ること}`);
  if (窓を出さない) {
    const 題 = await ページ.title();
    console.log(`窓を出さずに開けた（題：${題 || "（空）"}・拡張ID：${拡張ID}）。閉じます`);
    await 片付ける();
  } else {
    console.log("見終わったら、窓を閉じるか、ここで Ctrl+C を押してください（一時のプロフィールを消します）");
    await new Promise((r) => context.on("close", r));
    await 片付ける();
  }
} catch (e) {
  console.error(e);
  await 片付ける();
  process.exit(1);
}
