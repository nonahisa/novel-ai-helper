/**
 * 本物のランキングの画面の写しを、ヘルパーの読み取り（content/read.js の readRankings）に通す（2026-11-14。
 * 統合の実機確認リストの「本物のランキングから順位を読めるか」を機械へ移したもの）。
 *
 * 写しは scripts/captureRankings.mjs で本物の公開の画面から1回だけ取ったもの（他の方の題と作者名は伏せてある）。
 * ここではサイトへアクセスしない：本物の URL への行き来は Playwright の route で写しを返し、それ以外は止める。
 * 読み込む部品と順番は manifest の4つ目の content_scripts（ランキングの画面）と同じ。
 *
 * サイトの形が変わったら：作者に頼まれたときに scripts/captureRankings.mjs を流し直して写しを取り替える。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const 見本 = (名) => readFileSync(join(ルート, "test", "e2e", "fixtures", 名), "utf8");

/** manifest のランキングの画面の部品（announce.js は読み取りに要らないので除く） */
const 部品 = ["common/messages.js", "common/guard.js", "common/match.js", "common/rankings.js", "content/statsSites.js", "content/read.js"];

let browser = null;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true, channel: process.env.NPH_E2E_CHANNEL || "chromium" });
});
afterAll(async () => {
  if (browser) await browser.close();
});

/** 写しを本物の URL で開き、部品を入れて、作品IDの並びと読み取りの結果を返す */
async function 写しを読む(url, 写し, 作品IDを取る, 選ぶ, もう一つ選ぶ) {
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
      ({ url, 型, 選ぶ, もう一つ選ぶ }) => {
        const re = new RegExp(型);
        const 並び = [];
        for (const a of document.querySelectorAll("a[href]")) {
          const m = re.exec(a.getAttribute("href"));
          if (m && !並び.includes(m[1])) 並び.push(m[1]);
        }
        const now = new Date("2026-11-14T03:00:00.000Z");
        const 全部 = globalThis.NPHRead.readRankings(document, url, 並び, now);
        const 一つ = globalThis.NPHRead.readRankings(document, url, [並び[選ぶ]], now);
        const もう一つ = もう一つ選ぶ === undefined ? null : globalThis.NPHRead.readRankings(document, url, [並び[もう一つ選ぶ]], now);
        return { 並び, 全部, 一つ, もう一つ };
      },
      { url, 型: 作品IDを取る, 選ぶ, もう一つ選ぶ }
    );
  } finally {
    await context.close();
  }
}

/** 読んだ順位を小さい順に（1〜N に1つずつ並ぶかを見る） */
const 一から順に = (rankings) => rankings.map((r) => r.rank).sort((a, b) => a - b);

describe("本物のランキングの画面の写しから、順位を読む（2026-11-14 に取得）", () => {
  it("カクヨムの日間総合：110枠のうち順位の付いた100作品を 1〜100 で読み、順位の無い差し込みの10枠には順位を付けない。1作品だけ覚えていれば、その作品だけ", async () => {
    const url = "https://kakuyomu.jp/rankings/all/daily";
    const r = await 写しを読む(url, 見本("real-kakuyomu-ranking.html"), String.raw`^/works/(\d+)$`, 2, 5);
    // 本物の画面は、11枠ごとに順位の数字の無い枠（おすすめの差し込み）が1つ入る（2026-11-14 の写しで10枠）
    expect(r.並び).toHaveLength(110);
    expect(r.全部).toMatchObject({ ok: true, siteId: "kakuyomu", rows: 110 });
    expect(一から順に(r.全部.rankings)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    // 6枠目（差し込み）の作品だけを覚えている：載っているが順位ではないので、順位を作らない
    expect(r.もう一つ).toMatchObject({ ok: true, rankings: [], rows: 110 });
    expect(r.全部.rankings[0]).toMatchObject({ site: "kakuyomu", board: "rankings/all/daily/long", span: "daily", date: "2026-11-14" });
    expect(r.全部.rankings[0].boardLabel).toMatch(/日間.*ランキング/);
    // 並びの3つ目の作品だけを覚えている：その作品が3位で、ほかの作品は返さない
    expect(r.一つ.rows).toBe(110);
    expect(r.一つ.rankings).toHaveLength(1);
    expect(r.一つ.rankings[0]).toMatchObject({ workId: r.並び[2], rank: 3, title: "見本の題3" });
  });

  it("アルファポリスの HOTランキング：100作品の枠を読み、どの作品の順位も 1〜100 で読める。1作品だけ覚えていれば、その作品だけ", async () => {
    const url = "https://www.alphapolis.co.jp/novel/ranking/hot";
    const r = await 写しを読む(url, 見本("real-alphapolis-hot.html"), String.raw`^/novel/\d+/(\d+)$`, 2);
    expect(r.並び).toHaveLength(100);
    expect(r.全部).toMatchObject({ ok: true, siteId: "alphapolis", rows: 100 });
    expect(一から順に(r.全部.rankings)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(r.全部.rankings[0]).toMatchObject({ site: "alphapolis", board: "novel/ranking/hot", span: "24h", boardLabel: "HOTランキング" });
    expect(r.一つ.rows).toBe(100);
    expect(r.一つ.rankings).toHaveLength(1);
    expect(r.一つ.rankings[0]).toMatchObject({ workId: r.並び[2], rank: 3, title: "見本の題3" });
  });
});
