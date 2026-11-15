/**
 * 本物の公募の一覧のページの写しを、ヘルパーの読み取り（content/contestRead.js の readContests）に通す（2026-11-15。
 * 引継ぎ書3章の「0.12.0：公募の一覧を、本物のページで拡張から押して渡す」のうち、読み取りの分を機械へ移したもの）。
 *
 * 写しは scripts/captureContests.mjs で本物の公開のページから1回だけ取ったもの（スクリプト・画像・属性は削り、
 * 主催の窓口のメールの宛先と電話番号は伏せた）。ここではサイトへアクセスしない：本物の URL への行き来は
 * Playwright の route で写しを返し、それ以外は止める。読み込む部品と順番は manifest の公募の content_scripts と同じ。
 *
 * サイトの形が変わったら：作者に頼まれたときに scripts/captureContests.mjs を流し直して写しを取り替える。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const 見本 = (名) => readFileSync(join(ルート, "test", "e2e", "fixtures", 名), "utf8");

/** manifest の公募の一覧のページの部品（announce.js は読み取りに要らないので除く） */
const 部品 = ["common/messages.js", "content/contestSites.js", "content/contestRead.js"];

/**
 * 統合小説執筆環境（novel-ai-assistant）が隣のフォルダーにあれば、本物の写しから作った封筒を、受け手の本物の読み口
 * （core/contestListing.ts の parseContestsClipboard）にも読ませる（test/contestRead.test.js と同じ考え方）。
 */
const 受け手の読み口 = join(process.env.NOVELAI_ASSISTANT_DIR || join(ルート, "..", "novel-ai-assistant"), "src", "core", "contestListing.ts");

async function 受け手に読ませる(結果) {
  if (!existsSync(受け手の読み口)) {
    console.info("統合小説執筆環境のソースが隣に無いので、受け手に読ませる確かめは飛ばした");
    return;
  }
  const { parseContestsClipboard } = await import(/* @vite-ignore */ 受け手の読み口);
  const 受け取り = parseContestsClipboard(結果.r.envelope);
  expect(受け取り.ok, 受け取り.ok ? "" : JSON.stringify(受け取り)).toBe(true);
  expect(受け取り.from).toBe("helper");
  expect(受け取り.listings.map((l) => l.name)).toEqual(結果.封筒.items.map((i) => i.name));
  const 締切つき = 受け取り.listings.filter((l) => Array.isArray(l.deadlines) && l.deadlines.length > 0).length;
  console.info(`  受け手が読んだ ${受け取り.listings.length} 件（締切を読めたもの ${締切つき} 件）`);
}

let browser = null;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true, channel: process.env.NPH_E2E_CHANNEL || "chromium" });
});
afterAll(async () => {
  if (browser) await browser.close();
});

/**
 * 写しを本物の URL で開いて部品を入れ、読み取りの結果と、読み取りとは別に数えた枠の名前を返す。
 * 別に数える方は、表（CONTEST_SITES）のセレクタを使わず、枠と名前の見出しを手で書いた単純なセレクタで拾う。
 */
async function 写しを読む(url, 写し, 枠の型, 名前の型) {
  const context = await browser.newContext();
  try {
    await context.route("**/*", (route) =>
      route.request().url() === url
        ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: 写し })
        : route.abort("blockedbyclient")
    );
    const page = await context.newPage();
    await page.goto(url);
    for (const p of 部品) {
      await page.addScriptTag({ path: join(ルート, p) });
    }
    return await page.evaluate(
      ({ url, 枠の型, 名前の型 }) => {
        const 名前たち = [...document.querySelectorAll(枠の型)].map((枠) => {
          const h = 枠.querySelector(名前の型);
          return h ? h.textContent.replace(/\s+/g, " ").trim() : "";
        });
        const r = globalThis.NPHContestRead.readContests(document, url, new Date("2026-11-15T06:00:00.000Z"));
        return { 名前たち, r, 封筒: r.ok ? JSON.parse(r.envelope) : null };
      },
      { url, 枠の型, 名前の型 }
    );
  } finally {
    await context.close();
  }
}

/** どのページでも同じ確かめ：枠の数と渡す件数が合い、1件ずつ名前・行き先・文がある */
function 揃っているか({ 名前たち, r, 封筒 }, { source, 見出しがある, 行き先の型 }) {
  expect(名前たち.length).toBeGreaterThan(0);
  expect(r).toMatchObject({ ok: true, siteId: source, skipped: 0 });
  // 「開催予定」の表は公募ではないので渡さない。それ以外の枠はすべて渡す
  const 渡すはず = 名前たち.filter((n) => n !== "" && n !== "開催予定");
  expect(r.count).toBe(渡すはず.length);
  expect(封筒.source).toBe(source);
  expect(封筒.items.map((i) => i.name)).toEqual(渡すはず);
  for (const i of 封筒.items) {
    expect(i.url, i.name).toMatch(行き先の型);
    expect(i.text.length, i.name).toBeGreaterThan(0);
    if (見出しがある) {
      expect(i.section, i.name).toBeTruthy();
    } else {
      expect(i.section).toBeNull();
    }
  }
}

describe("本物の公募の一覧のページの写しから、公募を読む（2026-11-15 に取得）", () => {
  it("ノベルポータルの文学賞・公募一覧：枠ごとに名前・公式サイトへの行き先・締切の見出しを読む", async () => {
    const url = "https://creative-story.net/bungakusyou/";
    const 結果 = await 写しを読む(url, 見本("real-novelportal-bungakusyou.html"), ".contest-card", "h3");
    揃っているか(結果, { source: "novelportal", 見出しがある: true, 行き先の型: /^https?:\/\// });
    console.info(`ノベルポータルの文学賞・公募一覧：枠 ${結果.名前たち.length}・渡す ${結果.r.count} 件`);
    await 受け手に読ませる(結果);
  });

  it("ノベルポータルの投稿サイトのコンテスト一覧：枠ごとに名前・行き先・見出しを読む", async () => {
    const url = "https://creative-story.net/202111contest/";
    const 結果 = await 写しを読む(url, 見本("real-novelportal-contest.html"), ".contest-card", "h3");
    揃っているか(結果, { source: "novelportal", 見出しがある: true, 行き先の型: /^https?:\/\// });
    console.info(`ノベルポータルのコンテスト一覧：枠 ${結果.名前たち.length}・渡す ${結果.r.count} 件`);
    await 受け手に読ませる(結果);
  });

  it("ツクリテミライの小説の公募：枠ごとに名前と、そのサイトの詳しいページ（/kobo/…）を読み、ページ送りがあると知らせる", async () => {
    const url = "https://tsukuritemirai.com/kobo/novel/";
    const 結果 = await 写しを読む(url, 見本("real-tsukuritemirai.html"), 'div[class*="bg-surface-card"]', "h2");
    揃っているか(結果, { source: "tsukuritemirai", 見出しがある: false, 行き先の型: /^https:\/\/tsukuritemirai\.com\/kobo\// });
    expect(結果.r.paged).toBe(true);
    console.info(`ツクリテミライ：枠 ${結果.名前たち.length}・渡す ${結果.r.count} 件`);
    await 受け手に読ませる(結果);
  });
});
