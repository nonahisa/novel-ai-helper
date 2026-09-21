import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// 表はドメインの照合を match.js から借りる（写しを作らない）。
// ブラウザでは manifest / popup.html の読み込み順がこれを保証している。
require("../common/match.js");
const {
  STATS_SITES,
  parseCount,
  parseEpisodeNumber,
  periodKeyFor,
  matchReadPage,
  statsSiteById,
} = require("../content/statsSites.js");

/**
 * 読み取りの表（content/statsSites.js）の判定だけを確かめる。
 *
 * いちばん怖いのは**数字の読み違い**である。ここを間違えると、母艦の台帳に
 * 「読んでいない数字」が静かに積まれ、あとから見ても本当の値と区別が付かない
 * ——「1,269」を1と読む、「102PV」を読めずに0と書く、のような間違いは、
 * 画面上は何事もなく通ってしまう。
 */
describe("数字の読み方", () => {
  it("桁区切りのカンマを落とす（1 と読まない）", () => {
    expect(parseCount("1,269")).toBe(1269);
    expect(parseCount("23")).toBe(23);
  });

  it("単位がくっついていても読む", () => {
    expect(parseCount("102PV")).toBe(102);
    expect(parseCount("780pt")).toBe(780);
    expect(parseCount("★18")).toBe(18);
  });

  it("略記（K・M）は桁をずらす（浮動小数で計算しない）", () => {
    expect(parseCount("1.05M")).toBe(1050000);
    expect(parseCount("27.5K")).toBe(27500);
    expect(parseCount("3M")).toBe(3000000);
    // 整数にならない略記は読まない（丸めると、読んでいない数字を書くことになる）
    expect(parseCount("1.2345K")).toBeUndefined();
  });

  it("全角の数字も読む", () => {
    expect(parseCount("１，２６９")).toBe(1269);
  });

  it("「まだ無い」の表示は、欄ごと無しにする（0と書かない）", () => {
    expect(parseCount("–")).toBeUndefined(); // カクヨムの応援コメント（実機）
    expect(parseCount("-")).toBeUndefined();
    expect(parseCount("")).toBeUndefined();
    expect(parseCount("　")).toBeUndefined();
    expect(parseCount(null)).toBeUndefined();
  });

  it("0 は読む（「まだ無い」と違う）", () => {
    expect(parseCount("0 PV")).toBe(0);
  });

  it("小数や負の数は読まない（母艦の7欄は0以上の整数）", () => {
    expect(parseCount("12.3")).toBeUndefined();
    expect(parseCount("▲12")).toBeUndefined();
    expect(parseCount("-5")).toBeUndefined();
  });
});

describe("話番号の読み方", () => {
  it("見出しから「第N話」を取る（題は読み捨てる）", () => {
    expect(parseEpisodeNumber("第1話　気がついたら幽霊に")).toBe(1);
    expect(parseEpisodeNumber("第 12 話 それから")).toBe(12);
    expect(parseEpisodeNumber("第１０話")).toBe(10);
  });

  it("カンマは受けない（「第1,2話」を12話にしない）", () => {
    expect(parseEpisodeNumber("第1,2話")).toBeUndefined();
  });

  it("読めない見出しは undefined（呼ぶ側が行の順番で代える）", () => {
    expect(parseEpisodeNumber("プロローグ")).toBeUndefined();
    expect(parseEpisodeNumber("")).toBeUndefined();
    expect(parseEpisodeNumber(undefined)).toBeUndefined();
  });
});

describe("期間のキー", () => {
  const 日 = new Date(2026, 8, 22, 7, 30); // 2026-09-22 07:30（手元の時計）

  it("母艦の形（YYYY-MM-DD／YYYY-MM）で作る", () => {
    expect(periodKeyFor("day", 日)).toBe("2026-09-22");
    expect(periodKeyFor("month", 日)).toBe("2026-09");
  });

  it("手元の時計の日付を使う（UTCへずらさない）", () => {
    // ISO文字列（UTC）で切ると 2026-09-21 になる時刻。サイトの「今日」は作者の今日。
    expect(日.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(periodKeyFor("day", 日)).toBe("2026-09-22");
  });

  it("累計（total）は期間を持たない", () => {
    expect(periodKeyFor("total", 日)).toBeUndefined();
  });
});

describe("読めるページの照合", () => {
  const 作品管理 = "https://kakuyomu.jp/my/works/16816927859000000000";
  const アクセス数 = "https://kakuyomu.jp/works/16816927859000000000/accesses";

  it("作品管理（/my/ 付き）を読める", () => {
    const 結果 = matchReadPage(作品管理, STATS_SITES);
    expect(結果.ok).toBe(true);
    expect(結果.siteId).toBe("kakuyomu");
    expect(結果.page.kind).toBe("work");
    expect(結果.workId).toBe("16816927859000000000");
  });

  it("アクセス数（/my/ 無し）を読める", () => {
    const 結果 = matchReadPage(アクセス数, STATS_SITES);
    expect(結果.ok).toBe(true);
    expect(結果.page.kind).toBe("accesses");
    expect(結果.workId).toBe("16816927859000000000");
  });

  it("末尾のスラッシュが付いていても同じ", () => {
    expect(matchReadPage(作品管理 + "/", STATS_SITES).ok).toBe(true);
    expect(matchReadPage(アクセス数 + "/", STATS_SITES).ok).toBe(true);
  });

  it("話の編集画面や公開ページでは読まない", () => {
    // 作品管理の下にある別のページ（/epsiodes/new など）を巻き込まない
    expect(
      matchReadPage("https://kakuyomu.jp/my/works/168/episodes/new", STATS_SITES).reason
    ).toBe("not-read-page");
    // 他の方の作品の公開ページ。読んでよいのは自分の管理画面だけ（6.79.7-1）
    expect(matchReadPage("https://kakuyomu.jp/works/168", STATS_SITES).reason).toBe(
      "not-read-page"
    );
    expect(
      matchReadPage("https://kakuyomu.jp/works/168/episodes/999", STATS_SITES).reason
    ).toBe("not-read-page");
  });

  it("似たドメインを通さない", () => {
    expect(matchReadPage("https://evilkakuyomu.jp/my/works/168", STATS_SITES).reason).toBe(
      "unknown-site"
    );
  });

  it("読み取りに対応していないサイトは、そう言って断る", () => {
    const 結果 = matchReadPage(
      "https://www.alphapolis.co.jp/manage/novel/1177354",
      STATS_SITES
    );
    expect(結果.ok).toBe(false);
    expect(結果.reason).toBe("unsupported-site");
    expect(結果.siteId).toBe("alphapolis");
  });

  it("投稿サイト以外のタブでは読まない", () => {
    // about: や chrome: もURLとしては読めてしまう（ホスト名が合わないので弾かれる）
    expect(matchReadPage("about:blank", STATS_SITES).reason).toBe("unknown-site");
    expect(matchReadPage("chrome://extensions", STATS_SITES).reason).toBe("unknown-site");
    // URLとして読めないものだけが bad-url（タブのURLが取れなかったとき）
    expect(matchReadPage("", STATS_SITES).reason).toBe("bad-url");
    expect(matchReadPage(null, STATS_SITES).reason).toBe("bad-url");
  });
});

describe("読み取りの表そのもの", () => {
  it("読み取りに対応しているのはカクヨムだけ（アルファポリスは枠）", () => {
    expect(STATS_SITES.map((s) => s.id)).toEqual(["kakuyomu", "alphapolis"]);
    expect(statsSiteById("kakuyomu").supported).toBe(true);
    expect(statsSiteById("alphapolis").supported).toBe(false);
    // なろう・pixiv・ハーメルン・note は表に載せない（読み取りをしないと裁定済み）
    expect(statsSiteById("narou")).toBeNull();
  });

  it("母艦の7欄の名前だけを使う（知らない欄を作らない）", () => {
    // 母艦 models/posting.ts の READER_STATS_METRICS。ここに無い名前を書くと、
    // 封筒は受け取られても、その数字は黙って捨てられる。
    const 母艦の7欄 = ["pv", "unique", "bookmarks", "points", "likes", "comments", "reviews"];
    const 使っている = [];
    for (const site of STATS_SITES) {
      for (const 拾い方 of site.workMetrics) 使っている.push(拾い方.metric);
      for (const 拾い方 of site.periodMetrics) 使っている.push(拾い方.metric);
      for (const 列 of (site.episodeTable && site.episodeTable.columns) || []) {
        使っている.push(列.metric);
      }
    }
    expect(使っている.length).toBeGreaterThan(0);
    for (const key of 使っている) {
      expect(母艦の7欄, `${key} は母艦に無い欄`).toContain(key);
    }
  });

  it("今週は読まない（母艦に無い粒度）", () => {
    const 粒度 = statsSiteById("kakuyomu").periodMetrics.map((p) => p.period);
    expect(粒度).toEqual(["day", "month"]);
    expect(粒度).not.toContain("week");
  });

  it("話ごとの表は、クラス名の前方一致で当てる（末尾のハッシュは変わる）", () => {
    const 表 = statsSiteById("kakuyomu").episodeTable;
    for (const selector of [...表.tables, ...表.rows, ...表.columns.flatMap((c) => c.selectors)]) {
      expect(selector, `${selector} が前方一致になっていない`).toContain('[class^="');
    }
  });
});
