import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// 表はドメインの照合を match.js から借りる（写しを作らない）。
// ブラウザでは manifest / popup.html の読み込み順がこれを保証している。
require("../common/match.js");
const {
  STATS_SITES,
  parseCount,
  parseExactCount,
  parseEpisodeNumber,
  periodKeyFor,
  parseKakuyomuDate,
  parseKakuyomuDailyLabel,
  matchReadPage,
  statsSiteById,
  episodeTableFor,
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

/**
 * 作品全体の反応は、**丸めた表示と正確な数が別々にある**（後者はツールチップ）。
 * 丸めたほうを台帳へ書くと、あとから「本当に1,050,000だったのか」が分からなくなる。
 */
describe("略記を受けない読み方（作品全体の欄で使う）", () => {
  it("省略形は読まない（丸めた数を正確な数として書かない）", () => {
    expect(parseExactCount("1.05M")).toBeUndefined();
    expect(parseExactCount("27.5K")).toBeUndefined();
    expect(parseExactCount("3M")).toBeUndefined();
  });

  it("正確な数は、これまでどおり読む", () => {
    expect(parseExactCount("1,053,339")).toBe(1053339);
    expect(parseExactCount("2,814")).toBe(2814);
    expect(parseExactCount("★1,612")).toBe(1612);
    expect(parseExactCount("0 PV")).toBe(0);
    // 単位の文字が K・M でなければ、これまでどおり読める
    expect(parseExactCount("102PV")).toBe(102);
    expect(parseExactCount("780pt")).toBe(780);
  });

  it("「まだ無い」の表示は、欄ごと無しのまま", () => {
    expect(parseExactCount("–")).toBeUndefined();
    expect(parseExactCount(null)).toBeUndefined();
  });
});

describe("話番号の読み方", () => {
  it("見出しから「第N話」を取る（題は読み捨てる）", () => {
    expect(parseEpisodeNumber("第1話　気がついたら幽霊に")).toBe(1);
    expect(parseEpisodeNumber("第 12 話 それから")).toBe(12);
    expect(parseEpisodeNumber("第１０話")).toBe(10);
  });

  it("「第」が無い形も、題の先頭なら読む（作品管理ページの実機）", () => {
    // 2026-09-22 実機：作品管理の題は「１話　転生」「２１９話　最終回」（全角の数字）
    expect(parseEpisodeNumber("１話　転生")).toBe(1);
    expect(parseEpisodeNumber("２１９話　最終回")).toBe(219);
    expect(parseEpisodeNumber("12話 それから")).toBe(12);
  });

  it("題の途中の「N話」は読まない（別の話の数字を積まないため）", () => {
    expect(parseEpisodeNumber("あの日の3話ぶんの記憶")).toBeUndefined();
    // 「第」付きなら、これまでどおり途中でも読む
    expect(parseEpisodeNumber("おまけ　第3話の裏側")).toBe(3);
  });

  it("カンマは受けない（「第1,2話」を12話にしない）", () => {
    expect(parseEpisodeNumber("第1,2話")).toBeUndefined();
    expect(parseEpisodeNumber("1,2話")).toBeUndefined();
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
      for (const 表 of Object.values(site.episodeTables || {})) {
        for (const 列 of 表.columns) {
          使っている.push(列.metric);
        }
      }
    }
    expect(使っている.length).toBeGreaterThan(0);
    for (const key of 使っている) {
      expect(母艦の7欄, `${key} は母艦に無い欄`).toContain(key);
    }
  });

  it("作品全体の6欄には、ツールチップから読む道が付いている", () => {
    /*
      表示の文字だけを見る作りでは、実機（219話の作品）で ★ しか取れなかった
      ——大きい数は省略形になり、フォロワーには表示のラベルすら無いため。
      正確な数は data-ui-tooltip-label にしかない。
    */
    const 欄 = statsSiteById("kakuyomu").workMetrics;
    expect(欄.map((m) => m.metric)).toEqual([
      "bookmarks",
      "pv",
      "points",
      "reviews",
      "likes",
      "comments",
    ]);
    for (const 拾い方 of 欄) {
      expect(拾い方.tooltip, `${拾い方.metric} にツールチップの道が無い`).toBeTruthy();
      expect(拾い方.tooltip.attr).toBe("data-ui-tooltip-label");
      // 表示文字の道も残す（小さい作品と、属性の名前が変わった日の逃げ道）
      expect(拾い方.patterns.length).toBeGreaterThan(0);
    }
  });

  it("ツールチップの形は、末尾まで固定して略記を受けない", () => {
    for (const 拾い方 of statsSiteById("kakuyomu").workMetrics) {
      const 形 = 拾い方.tooltip.pattern;
      // 「今日 1 PV」のような期間つきの表示を、作品全体の数として拾わない
      expect(形.test("今日 1 PV"), `${拾い方.metric} が期間つきの表示に当たる`).toBe(false);
      // 省略形が入っていたら、それは属性の意味が変わった合図。当てずに逃げ道へ落とす
      expect(形.test("PV数 1.05M"), `${拾い方.metric} が省略形に当たる`).toBe(false);
    }
  });

  it("今週は読まない（母艦に無い粒度）", () => {
    const 粒度 = statsSiteById("kakuyomu").periodMetrics.map((p) => p.period);
    expect(粒度).toEqual(["day", "month"]);
    expect(粒度).not.toContain("week");
  });

  it("アクセス数の表は、クラス名の前方一致で当てる（末尾のハッシュは変わる）", () => {
    const 表 = episodeTableFor(statsSiteById("kakuyomu"), "accesses");
    for (const selector of [...表.tables, ...表.rows, ...表.columns.flatMap((c) => c.selectors)]) {
      expect(selector, `${selector} が前方一致になっていない`).toContain('[class^="');
    }
  });
});

/**
 * 話ごとの表は**ページの種類ごとに別物**である（0.4.0。作者の指摘
 * 「作品管理ページなら50話縛りが無いのでは」）。
 *
 * ここで守りたいのは2つ。**作品管理の表が、控えの表を落とす形になっていること**と、
 * **アクセス数の表を壊していないこと**（片方の作りが変わった日の逃げ道として残す）。
 */
describe("ページの種類ごとの、話ごとの表", () => {
  const カクヨム = statsSiteById("kakuyomu");

  it("work と accesses で、別の表が引かれる", () => {
    const 作品管理 = episodeTableFor(カクヨム, "work");
    const アクセス数 = episodeTableFor(カクヨム, "accesses");
    expect(作品管理).toBeTruthy();
    expect(アクセス数).toBeTruthy();
    expect(作品管理).not.toBe(アクセス数);
    expect(作品管理.rows).not.toEqual(アクセス数.rows);
    // 知らないページの種類には、表を渡さない（話ごとを読みにいかせない）
    expect(episodeTableFor(カクヨム, "episodes")).toBeNull();
    expect(episodeTableFor(statsSiteById("alphapolis"), "work")).toBeNull();
    expect(episodeTableFor(null, "work")).toBeNull();
  });

  it("作品管理の表は、控えの表を落とす（rowFilter が要る）", () => {
    /*
      同じページに `tr.episode` を持つ表が2つあり、合わせて438行ある（219話の作品）。
      本物は `td.episode-feedback-pv` を持つ219行だけ。ここが外れると、
      **全話が二重に母艦の台帳へ入る**——台帳は追記なので、作者には見分けが付かない。
    */
    const 表 = episodeTableFor(カクヨム, "work");
    expect(表.rowFilter).toEqual(["td.episode-feedback-pv"]);
    expect(表.tables).toEqual(["table.episodes"]);
    expect(表.rows).toEqual(["tr.episode"]);
  });

  it("作品管理では、応援・応援コメント・PV の3欄を読む（文字数は読まない）", () => {
    const 欄 = episodeTableFor(カクヨム, "work").columns;
    expect(欄.map((c) => c.metric)).toEqual(["likes", "comments", "pv"]);
    // 文字数は反応ではない。読む欄に入れない
    for (const 列 of 欄) {
      for (const selector of 列.selectors) {
        expect(selector).not.toContain("characterCount");
      }
    }
  });

  it("作品管理にはページ送りが無い（全話が1枚に出る）", () => {
    expect(episodeTableFor(カクヨム, "work").nextPage).toBeUndefined();
  });

  it("アクセス数の表は、これまでどおり（0.3.0 から変えない）", () => {
    const 表 = episodeTableFor(カクヨム, "accesses");
    expect(表.heading).toEqual(["th"]);
    expect(表.columns.map((c) => c.metric)).toEqual(["likes", "pv"]);
    // 50話ずつのページ送りがあるので、次のページの印は要る
    expect(表.nextPage).toBeTruthy();
    // 控えの表はアクセス数のページには無い（行を絞らない）
    expect(表.rowFilter).toBeUndefined();
  });
});

/**
 * アクセス数のページは**50話ずつのページ送り**（2026-09-22 実機。219話の作品で5ページ）。
 *
 * 読むのは画面に出ている50話ぶんだけなので、次のページがあることを作者へ伝えないと、
 * 「◯件コピーしました」を見て**全話が入ったと思われる**。ここで確かめるのは
 * 「次へ」を見つける印の形で、**押すことも、href を開くこともしない**。
 */
describe("次のページの印", () => {
  const 印 = episodeTableFor(statsSiteById("kakuyomu"), "accesses").nextPage;

  it("文言は「次へ」だけに当たる（マイページや話の題、「前へ」には当たらない）", () => {
    expect(印.text.test("次へ")).toBe(true);
    expect(印.text.test("マイページ")).toBe(false);
    expect(印.text.test("第51話　次の朝")).toBe(false);
    // ページ2以降には「前へ」もある。これを次のページと読むと、最後のページで嘘を言う
    expect(印.text.test("前へ")).toBe(false);
  });

  it("セレクタは、アクセス数のページ送りのリンクに限る", () => {
    expect(印.selectors.length).toBeGreaterThan(0);
    for (const selector of 印.selectors) {
      // 話へのリンク（/episodes/…）やマイページを巻き込まないよう、行き先を絞る
      expect(selector, `${selector} がリンク（a）に限っていない`).toMatch(/^a\[href/);
      expect(selector, `${selector} がアクセス数のページ送りに限っていない`).toContain(
        "/accesses?page="
      );
    }
  });
});

/**
 * カクヨムの日付の読み方（0.5.0）。
 *
 * 母艦は `updatedAt` から「更新後3日（72時間）以上の最新話」を選び、離脱率・ブックマーク率・
 * 評価率の分母にする。**読み違えた日付は、別の話を基準に選ばせる**——読めない形は
 * 欄ごと入れないほうがよい（母艦は「◯◯が無い」と言える）。
 */
describe("カクヨムの最終更新の読み方", () => {
  it("日付と時刻のあいだに空白が無くても、あっても読む", () => {
    expect(parseKakuyomuDate("2022年4月25日15:07 最終更新")).toBe("2022-04-25T15:07:00+09:00");
    expect(parseKakuyomuDate("2024年7月31日 08:13 最終更新")).toBe("2024-07-31T08:13:00+09:00");
  });

  it("1桁の月・日・時を2桁に揃える", () => {
    expect(parseKakuyomuDate("2026年1月5日 9:03 最終更新")).toBe("2026-01-05T09:03:00+09:00");
    expect(parseKakuyomuDate("2026年1月5日9:03")).toBe("2026-01-05T09:03:00+09:00");
  });

  it("全角の数字・コロン、改行まじりの空白も読む", () => {
    expect(parseKakuyomuDate("２０２２年４月２５日１５：０７ 最終更新")).toBe(
      "2022-04-25T15:07:00+09:00"
    );
    expect(parseKakuyomuDate("  2022年4月25日\n 15:07\n 最終更新 ")).toBe(
      "2022-04-25T15:07:00+09:00"
    );
  });

  it("読めない形は undefined（呼ぶ側は欄ごと入れない）", () => {
    for (const 形 of [
      "",
      "–",
      "最終更新",
      // 時刻が無い。0時と書くと、まだ3日経っていない話が基準に選ばれうる
      "2022年4月25日 最終更新",
      // 前に別の語がある（最終更新の日時かどうか分からない）
      "予約公開 2026年10月1日 12:00",
      // 暦に無い日・時刻
      "2026年2月30日 10:00",
      "2026年13月1日 10:00",
      "2026年4月25日 24:00",
      "2026年4月25日 10:60",
      // 分の桁が多い（15:078 を 15:07 と読まない）
      "2026年4月25日 15:078",
      null,
      undefined,
      20220425,
    ]) {
      expect(parseKakuyomuDate(形), String(形)).toBeUndefined();
    }
  });

  it("閏年の2月29日は読み、平年の2月29日は読まない", () => {
    expect(parseKakuyomuDate("2024年2月29日 10:00")).toBe("2024-02-29T10:00:00+09:00");
    expect(parseKakuyomuDate("2025年2月29日 10:00")).toBeUndefined();
  });
});

describe("日ごとのPVのグラフの読み方", () => {
  it("「2026年8月24日：5PV」を、日の期間キーと数にする", () => {
    expect(parseKakuyomuDailyLabel("2026年8月24日：5PV")).toEqual({
      periodKey: "2026-08-24",
      value: 5,
    });
    expect(parseKakuyomuDailyLabel("2026年10月3日: 1,234 PV")).toEqual({
      periodKey: "2026-10-03",
      value: 1234,
    });
    expect(parseKakuyomuDailyLabel("2026年8月24日：0PV")).toEqual({
      periodKey: "2026-08-24",
      value: 0,
    });
  });

  it("略記・暦に無い日・別の文言は読まない", () => {
    for (const 形 of [
      "2026年8月24日：1.2KPV",
      "2026年2月30日：3PV",
      "2026年8月24日：PV",
      "2026年8月24日：5PV（今日）",
      "PV数 1,053,339",
      "今日 1 PV",
      "",
      null,
    ]) {
      expect(parseKakuyomuDailyLabel(形), String(形)).toBeUndefined();
    }
  });
});

describe("作品管理の表の、更新日とグラフの指定（0.5.0）", () => {
  const カクヨム = statsSiteById("kakuyomu");

  it("作品管理の話の表は、td.episode-date から最終更新を読む", () => {
    const 指定 = episodeTableFor(カクヨム, "work").updatedAt;
    expect(指定.selectors).toEqual(["td.episode-date"]);
    expect(指定.parse).toBe(parseKakuyomuDate);
    // 数ではないので、metrics の欄（columns）には入れない
    expect(episodeTableFor(カクヨム, "work").columns.map((c) => c.metric)).not.toContain(
      "updatedAt"
    );
  });

  it("アクセス数の表には、更新日の指定が無い", () => {
    expect(episodeTableFor(カクヨム, "accesses").updatedAt).toBeUndefined();
  });

  it("日ごとのグラフは、ツールチップの属性から PV を読む", () => {
    expect(カクヨム.dailyGraph).toEqual({
      metric: "pv",
      selectors: ["li.feedbackGraph-graph[data-ui-tooltip-label]"],
      attr: "data-ui-tooltip-label",
      parse: parseKakuyomuDailyLabel,
    });
    // 実機を見ていないサイトには置かない
    expect(statsSiteById("alphapolis").dailyGraph).toBeNull();
  });
});
