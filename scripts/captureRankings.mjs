/**
 * 本物のランキングの画面を1回ずつ写して、画面テストの見本にする（頼んだときだけ手で流す。テストからは呼ばない）。
 *
 *   node scripts/captureRankings.mjs
 *
 * - 写すのは公開の画面だけ（サインインしない）。カクヨムの日間総合と、アルファポリスの HOTランキング
 * - **窓を出さない**（headless）。作者の画面の前面を取らない
 * - 写しは保存する前にページの中で伏せる：他の方の題は「見本の題N」、作者名などほかの字は「・」に。
 *   残すのは、読み取りが当てる形（クラス名・作品へのリンクの行き先）と、順位の字と見出し（h1）だけ。
 *   スクリプト・画像・外へのリンク・クラスと href 以外の属性は消す
 * - 何度もアクセスしない：1ページにつき1回開くだけ
 *
 * 出す所：test/e2e/fixtures/real-kakuyomu-ranking.html・real-alphapolis-hot.html
 * これを test/e2e/realRankings.test.js が、ヘルパーの読み取り（content/read.js の readRankings）に通す。
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

const 写すもの = [
  {
    url: "https://kakuyomu.jp/rankings/all/daily",
    file: "real-kakuyomu-ranking.html",
    rank: 'div[class*="RankingWorkBox_rank__"]',
    title: 'h3 a[href*="/works/"]',
    keepHref: /^(?:https:\/\/kakuyomu\.jp)?\/works\/\d+\/?$/,
  },
  {
    url: "https://www.alphapolis.co.jp/novel/ranking/hot",
    file: "real-alphapolis-hot.html",
    rank: "span.c-content__rank",
    title: 'h2.c-content__title a[href*="/novel/"]',
    keepHref: /^(?:https:\/\/(?:www\.)?alphapolis\.co\.jp)?\/novel\/\d+\/\d+\/?$/,
  },
];

/** ページの中で伏せる（ブラウザの中で動く） */
function 伏せる({ rank, title, keepHref }) {
  const 残す型 = new RegExp(keepHref);
  for (const el of document.querySelectorAll("script,style,link,meta,noscript,iframe,svg,img,picture,source,video,audio,canvas,template,object,embed,input,textarea,select,button,form")) {
    el.remove();
  }
  const 順位の要素 = new Set(document.querySelectorAll(rank));
  const 題の要素 = [...document.querySelectorAll(title)];
  const 題の集合 = new Set(題の要素);
  題の要素.forEach((a, i) => {
    a.textContent = `見本の題${i + 1}`;
  });
  const 中か = (node, 集合) => {
    for (let p = node.parentElement; p; p = p.parentElement) {
      if (集合.has(p)) return true;
    }
    return false;
  };
  const h1たち = new Set(document.querySelectorAll("h1"));
  const 歩く = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const 字たち = [];
  while (歩く.nextNode()) 字たち.push(歩く.currentNode);
  for (const t of 字たち) {
    if (!t.nodeValue.trim()) continue;
    if (中か(t, 順位の要素) || 中か(t, 題の集合) || 中か(t, h1たち)) continue;
    t.nodeValue = "・";
  }
  for (const el of document.querySelectorAll("*")) {
    for (const 名 of [...el.getAttributeNames()]) {
      if (名 === "class") continue;
      if (名 === "href") {
        const v = el.getAttribute("href") || "";
        if (!残す型.test(v.trim())) el.setAttribute("href", "#");
        continue;
      }
      el.removeAttribute(名);
    }
  }
  return { 順位: 順位の要素.size, 題: 題の要素.length };
}

const browser = await chromium.launch({ headless: true, channel: process.env.NPH_E2E_CHANNEL || undefined });
try {
  const context = await browser.newContext({ locale: "ja-JP" });
  for (const 件 of 写すもの) {
    const page = await context.newPage();
    await page.goto(件.url, { waitUntil: "networkidle", timeout: 60000 });
    const 数 = await page.evaluate(伏せる, { rank: 件.rank, title: 件.title, keepHref: 件.keepHref.source });
    const 本文 = await page.evaluate(() => document.documentElement.outerHTML);
    const 頭 = `<!DOCTYPE html>\n<!-- 本物の画面の写し：${件.url}（${new Date().toISOString()} に scripts/captureRankings.mjs で1回だけ取得。題は「見本の題N」、ほかの字は「・」に伏せた。順位の枠 ${数.順位}・題のリンク ${数.題}） -->\n`;
    writeFileSync(join(ルート, "test", "e2e", "fixtures", 件.file), 頭 + 本文 + "\n", "utf8");
    console.info(`${件.file}：順位の枠 ${数.順位}・題のリンク ${数.題}`);
    await page.close();
  }
} finally {
  await browser.close();
}
