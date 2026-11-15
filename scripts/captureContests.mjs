/**
 * 本物の公募の一覧のページを1回ずつ写して、画面テストの見本にする（頼んだときだけ手で流す。テストからは呼ばない）。
 *
 *   node scripts/captureContests.mjs
 *
 * - 写すのは content/contestSites.js の表にある公開の3ページだけ（サインインしない）
 * - **窓を出さない**（headless）。作者の画面の前面を取らない
 * - 何度もアクセスしない：1ページにつき1回開くだけ
 * - 公募の名前・締切・賞典などは、どなたでも見られる公募の情報なので字は残す。スクリプト・画像・入力欄・
 *   クラスと href 以外の属性は消す（ページの中の決まった枠と字だけが読み取りの材料）
 *
 * 出す所：test/e2e/fixtures/real-novelportal-bungakusyou.html・real-novelportal-contest.html・real-tsukuritemirai.html
 * これを test/e2e/realContests.test.js が、ヘルパーの読み取り（content/contestRead.js の readContests）に通す。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

const 写すもの = [
  { url: "https://creative-story.net/bungakusyou/", file: "real-novelportal-bungakusyou.html", card: ".contest-card" },
  { url: "https://creative-story.net/202111contest/", file: "real-novelportal-contest.html", card: ".contest-card" },
  // ページのスクリプトがあとから枠を組むので、枠が出るまで待つ
  { url: "https://tsukuritemirai.com/kobo/novel/", file: "real-tsukuritemirai.html", card: 'div[class*="bg-surface-card"]' },
];

/** ページの中で、読み取りに要らない物を消す（ブラウザの中で動く） */
function 削る() {
  for (const el of document.querySelectorAll("script,style,link,meta,noscript,iframe,svg,img,picture,source,video,audio,canvas,template,object,embed,input,textarea,select,button,form")) {
    el.remove();
  }
  for (const el of document.querySelectorAll("*")) {
    for (const 名 of [...el.getAttributeNames()]) {
      if (名 !== "class" && 名 !== "href") el.removeAttribute(名);
    }
  }  // 主催の窓口のメールの宛先と電話番号は、読み取りに要らないので伏せる
  const 歩く = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (歩く.nextNode()) {
    const t = 歩く.currentNode;
    t.nodeValue = t.nodeValue
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g, "（メールの宛先は伏せた）")
      .replace(/0\d{1,3}-\d{2,4}-\d{3,4}/g, "（電話番号は伏せた）");
  }
  for (const a of document.querySelectorAll('a[href^="mailto:"],a[href^="tel:"]')) a.setAttribute("href", "#");
}

const browser = await chromium.launch({ headless: true, channel: process.env.NPH_E2E_CHANNEL || undefined });
try {
  const context = await browser.newContext({ locale: "ja-JP" });
  for (const 件 of 写すもの) {
    const page = await context.newPage();
    await page.goto(件.url, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector(件.card, { timeout: 30000 });
    const 枠 = await page.evaluate((sel) => document.querySelectorAll(sel).length, 件.card);
    await page.evaluate(削る);
    const 本文 = await page.evaluate(() => document.documentElement.outerHTML);
    const 頭 = `<!DOCTYPE html>\n<!-- 本物の画面の写し：${件.url}（${new Date().toISOString()} に scripts/captureContests.mjs で1回だけ取得。スクリプト・画像・属性を削り、メールの宛先と電話番号を伏せた。枠 ${枠}） -->\n`;
    writeFileSync(join(ルート, "test", "e2e", "fixtures", 件.file), 頭 + 本文 + "\n", "utf8");
    console.info(`${件.file}：枠 ${枠}`);
    await page.close();
  }
} finally {
  await browser.close();
}
