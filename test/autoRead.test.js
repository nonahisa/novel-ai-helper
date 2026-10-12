import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

// 表は globalThis を通して互いを引くので、読み込む順を守る（background.js の importScripts と同じ順）
require("../common/match.js");
require("../content/statsSites.js");
const { CONTEST_SITES } = require("../content/contestSites.js");
const { STATS_SITES, matchReadPage } = require("../content/statsSites.js");
const { matchContestPage } = require("../content/contestSites.js");
const AutoRead = require("../common/autoRead.js");

/**
 * 開いたときの自動取得の答え（0.14.0。common/autoRead.js）。
 * つなぎ方（訊く・取得する・知らせる）は test/background.test.js、ここは決め方の素の関数だけ。
 */
const 今 = new Date("2026-10-12T00:00:00.000Z");

describe("ページの種類", () => {
  it("表から作る。読み取りを止めてあるサイト（アルファポリス）は並べない", () => {
    const 一覧 = AutoRead.listPageTypes(STATS_SITES, CONTEST_SITES);
    expect(一覧.map((t) => [t.key, t.label, t.group])).toEqual([
      ["kakuyomu|work", "カクヨムの作品管理", "stats"],
      ["kakuyomu|accesses", "カクヨムのアクセス数", "stats"],
      ["narouFun|narouFun", "Narou.fun の作品ページ", "stats"],
      ["novelportal|contests", "ノベルポータルの公募の一覧", "contests"],
      ["tsukuritemirai|contests", "ツクリテミライの公募の一覧", "contests"],
    ]);
  });

  it("作品ごとではなく、サイト＋画面の種類で決まる（作品IDもページ送りも鍵に入らない）", () => {
    const a = matchReadPage("https://kakuyomu.jp/works/111111/accesses?page=2", STATS_SITES);
    const b = matchReadPage("https://kakuyomu.jp/works/222222/accesses", STATS_SITES);
    expect(AutoRead.pageTypeForStats(a)).toBe("kakuyomu|accesses");
    expect(AutoRead.pageTypeForStats(b)).toBe("kakuyomu|accesses");
    expect(AutoRead.pageTypeForStats(matchReadPage("https://example.com/", STATS_SITES))).toBeNull();
  });

  it("ノベルポータルの2ページは同じ種類", () => {
    const a = matchContestPage("https://creative-story.net/bungakusyou/", CONTEST_SITES);
    const b = matchContestPage("https://creative-story.net/202111contest/", CONTEST_SITES);
    expect(AutoRead.pageTypeForContest(a)).toBe("novelportal|contests");
    expect(AutoRead.pageTypeForContest(b)).toBe("novelportal|contests");
  });

  it("説明のページに、どの種類にも選ぶ欄が置いてある（表に画面を足したら、欄も足す）", () => {
    const html = readFileSync(join(ルート, "options.html"), "utf8");
    for (const t of AutoRead.listPageTypes(STATS_SITES, CONTEST_SITES)) {
      expect(html, t.key).toContain(`data-auto-read="${t.key}"`);
    }
  });
});

describe("答え", () => {
  it("まだ決めていなければ訊く。訊いたら二度は訊かない", () => {
    let 答え = AutoRead.normalizeConsent(null);
    expect(AutoRead.shouldAsk(答え, "kakuyomu|work")).toBe(true);
    答え = AutoRead.markAsked(答え, "kakuyomu|work", 今);
    expect(AutoRead.shouldAsk(答え, "kakuyomu|work")).toBe(false);
    expect(AutoRead.isAuto(答え, "kakuyomu|work")).toBe(false);
  });

  it("「自動」と答えたときだけ自動。「押して」と答えたら自動にしない", () => {
    const 自動 = AutoRead.setChoice({ pages: {} }, "kakuyomu|work", "auto", "author", 今);
    expect(AutoRead.isAuto(自動, "kakuyomu|work")).toBe(true);
    const 押して = AutoRead.setChoice(自動, "kakuyomu|work", "manual", "author", 今);
    expect(AutoRead.isAuto(押して, "kakuyomu|work")).toBe(false);
    expect(AutoRead.shouldAsk(押して, "kakuyomu|work")).toBe(false);
    // 元の答えは変えない
    expect(AutoRead.isAuto(自動, "kakuyomu|work")).toBe(true);
  });

  it("「まだ決めていない」に戻すと、次は訊く", () => {
    const 自動 = AutoRead.setChoice({ pages: {} }, "kakuyomu|work", "auto", "author", 今);
    const 戻した = AutoRead.setChoice(自動, "kakuyomu|work", null, "author", 今);
    expect(AutoRead.shouldAsk(戻した, "kakuyomu|work")).toBe(true);
  });

  it("形の崩れた行は捨てる（その種類は、まだ決めていない扱い）", () => {
    const 読んだ = AutoRead.normalizeConsent({
      pages: { "kakuyomu|work": { choice: "auto", by: "author", at: "x" }, "kakuyomu|accesses": { choice: "yes" }, bad: null },
    });
    expect(Object.keys(読んだ.pages)).toEqual(["kakuyomu|work"]);
  });
});

describe("入れた・更新したとき", () => {
  const 種類 = AutoRead.listPageTypes(STATS_SITES, CONTEST_SITES);

  it("更新：読者の反応の3種類だけを「自動」にし、公募の一覧は決めない", () => {
    const 答え = AutoRead.consentOnInstalled(null, "update", 種類, 今);
    expect(Object.keys(答え.pages).sort()).toEqual(["kakuyomu|accesses", "kakuyomu|work", "narouFun|narouFun"]);
  });

  it("更新：作者が答えた種類（訊いたまま、も含む）は変えない。推した値（traces）は決め直す", () => {
    const 前 = {
      pages: {
        "kakuyomu|work": { choice: "manual", by: "author", at: "x" },
        "kakuyomu|accesses": { choice: "asked", by: "author", at: "x" },
        "narouFun|narouFun": { choice: "auto", by: "traces", at: "x" },
      },
    };
    const 答え = AutoRead.consentOnInstalled(前, "update", 種類, 今);
    expect(答え.pages["kakuyomu|work"].choice).toBe("manual");
    expect(答え.pages["kakuyomu|accesses"].choice).toBe("asked");
    expect(答え.pages["narouFun|narouFun"]).toMatchObject({ choice: "auto", by: "update" });
  });

  it("新しく入れた：空の答えを書く（どれも、開いたときに訊く）。Chrome の更新などでは変えない", () => {
    expect(AutoRead.consentOnInstalled(null, "install", 種類, 今)).toEqual({ pages: {} });
    expect(AutoRead.consentOnInstalled({ pages: {} }, "install", 種類, 今)).toBeNull();
    expect(AutoRead.consentOnInstalled(null, "chrome_update", 種類, 今)).toBeNull();
  });

  it("保存に無いまま動いたら、使っていた形跡があるときだけ読者の反応を「自動」と推す", () => {
    expect(AutoRead.consentWhenMissing(false, 種類, 今)).toEqual({ pages: {} });
    const 推した = AutoRead.consentWhenMissing(true, 種類, 今);
    expect(Object.values(推した.pages).every((v) => v.choice === "auto" && v.by === "traces")).toBe(true);
    expect(Object.keys(推した.pages)).toHaveLength(3);
  });
});

describe("公募の一覧の棚", () => {
  const 結果 = (n) => ({ ok: true, envelope: `{"n":${n}}`, count: n, skipped: 0, paged: false, siteId: "novelportal" });

  it("ページごとに最新の1つ。ページ送りは別のページ、# は見ない", () => {
    let 棚 = AutoRead.putShelf(null, 結果(1), "https://creative-story.net/bungakusyou/", 今);
    棚 = AutoRead.putShelf(棚, 結果(2), "https://creative-story.net/bungakusyou/#top", 今);
    棚 = AutoRead.putShelf(棚, 結果(3), "https://tsukuritemirai.com/kobo/novel/?page=2", 今);
    expect(棚.items.map((i) => i.count)).toEqual([2, 3]);
    expect(AutoRead.findShelf(棚, "https://creative-story.net/bungakusyou").count).toBe(2);
    expect(AutoRead.findShelf(棚, "https://tsukuritemirai.com/kobo/novel/")).toBeNull();
  });

  it("上限を越えたら古いものから落とす", () => {
    let 棚 = null;
    for (let i = 1; i <= AutoRead.SHELF_LIMIT + 2; i += 1) {
      棚 = AutoRead.putShelf(棚, 結果(i), `https://tsukuritemirai.com/kobo/novel/?page=${i}`, 今);
    }
    expect(棚.items).toHaveLength(AutoRead.SHELF_LIMIT);
    expect(棚.items[0].count).toBe(3);
  });
});

/*
  0.14.1：吹き出しの答えのボタンの並びは HTML で hidden にしてあるが、CSS の `.buttons { display: flex }` が
  ブラウザの [hidden] の既定に勝ち、「取得しました」の吹き出しにも字の無いボタンが2つ出ていた（作者の実機、2026-10-12）。
  hidden の印を CSS で負かさない決めが残っていることを見張る
*/
describe("吹き出しの隠す印", () => {
  it("bubble.css は [hidden] を display: none で必ず隠す", () => {
    const css = readFileSync(join(ルート, "bubble.css"), "utf8");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});
