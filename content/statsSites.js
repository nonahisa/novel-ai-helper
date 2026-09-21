"use strict";

/**
 * 読者の反応を「どのページから」「どう読むか」の表（設計書6.79.7）。**この表が唯一の場所**。
 * ページ側（content/read.js）とポップアップ（popup.js）の両方がこのファイルを読む。
 *
 * 貼り込みの表（content/sites.js）とは**別の表にしてある**。同じサイトでも、
 * 書く画面（話の新規作成）と読む画面（作品管理・アクセス数）は別のページで、
 * 欄の指定も照合の仕方も別物だから——1つの表に混ぜると、片方を直したときに
 * もう片方が黙って壊れる。
 *
 * ## ここで読んでよいものの範囲（6.79.2-3 の例外は 6.79.7 の枠だけ）
 *
 * 読むのは**作者が自分で開いた、作者自身の作品の管理画面**に出ている
 * 「ラベルと数の組」だけ。本文も、他の方の作品も、ページ全体の文字も読まない。
 * そのために、読む文字には**長さの上限**（MAX_LABEL_TEXT）を掛けてある
 * ——「フォロワー 23」より長いものは、もう数のラベルではない。
 *
 * ## カクヨムの値は実機で確かめたもの（2026-09-22、作者の Chrome）
 *
 * クラス名は CSS Modules のハッシュ付き（`EpisodeStatsListItem_pv__abc123`）で、
 * **サイトのビルドのたびに末尾が変わる**。だから前方一致（`[class^="…"]`）で当てる。
 * 当たらなければ「ページの形が変わったようです」と言って**何も返さない**
 * ——読めない数を0で埋めると、母艦の台帳に嘘が入る。
 *
 * 表の読み方：
 * - hosts            : このサイトと認めるドメイン（照合は common/match.js の hostMatches）
 * - readPages        : 読めるページ。pattern の1番目の丸括弧が作品ID
 * - workMetrics      : 作品管理ページから拾う「作品全体」の数（母艦の7欄へ写す）
 * - periodMetrics    : 同じページの「今日／今月」のPV（今週は母艦に無い粒度なので読まない）
 * - episodeTable     : アクセス数ページの、話ごとの表の読み方
 * - supported        : false なら読み取りをしない（枠だけ置いてある）
 *
 * 1件ぶんの拾い方（workMetrics / periodMetrics）：
 * - metric     : 母艦の欄の名前（models/posting.ts の READER_STATS_METRICS）
 * - names      : アクセシビリティの名前（aria-label／title）で当てるときの名前。
 *                「星/レビュー」のように2つ入っていることがあるので、区切って照合する
 * - patterns   : テキストから数を取る正規表現（1番目の丸括弧が数）。
 *                **ラベルが数より先**に来る形だけを書く——「今日 0 PV」の 0 を
 *                作品全体のPVとして拾わないため
 * - exclude    : この語を含むテキストは読まない（期間つきの表示は作品全体の値ではない）
 * - soleNumber : その要素に数が1つしか無いと分かっているもの。名前で当たったときに限り、
 *                正規表現が外れても「テキスト中の最初の数」を採る
 */
(function (global) {
  /**
   * 読んでよいテキストの長さ（字）。
   *
   * 「応援 33・応援コメント –」で18字。**これを超えるものは、もう数のラベルではない**
   * ——本文や説明文を読まないための線で、ここを緩めると「集めない」の約束が緩む。
   */
  const MAX_LABEL_TEXT = 60;

  /** アクセシビリティの名前を持つ要素（1つ目の当て方）。 */
  const NAMED_SELECTOR = "[aria-label], [title]";

  /**
   * テキストで当てるときに見る要素（2つ目の当て方）。
   *
   * 広く見えるが、上の長さの上限と組で効く——長い文字を持つ要素はここで落ちる。
   */
  const TEXT_SELECTOR = "li, dt, dd, p, span, a, td, th, div";

  /** 数の形。桁区切り・小数・K/M の略記を受ける（1番目が数字、2番目が略記）。 */
  const NUMBER_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*([KkMm])?/;

  /** ラベルと数のあいだに挟まってよい文字（「：」「 」「★」など）の数。 */
  const 数の形 = "([0-9][0-9,.]*[KkMm]?)";
  const 隙間 = "[^0-9]{0,6}";

  /** ラベルが先、数があとの形を1つ作る。 */
  function ラベルの次の数(ラベル, 追加の除外) {
    const あいだ = 追加の除外 ? `[^0-9${追加の除外}]{0,6}` : 隙間;
    return new RegExp(ラベル + あいだ + 数の形);
  }

  /** 全角の数字・記号を半角へ。サイトによって混ざるため、読む前に揃える。 */
  function 半角へ(text) {
    return String(text)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/．/g, ".")
      .replace(/，/g, ",");
  }

  /**
   * 「1,269」「102PV」「★18」「1.05M」「27.5K」を数にする。
   *
   * 読めなければ **undefined**（呼ぶ側はその欄ごと入れない）。「–」のように
   * サイトが「まだ無い」と表示している欄を0として書き込むと、母艦の台帳に
   * **読んでいない数字**が残る——あとから見て、0だったのか読めなかったのかが
   * 区別できなくなる。
   *
   * 略記（K・M）は**文字のまま桁をずらす**。`1.05 * 1000000` を浮動小数で計算すると
   * 1050000.0000000001 になり、整数として書けなくなるため。
   */
  function parseCount(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") {
      return undefined;
    }
    const text = 半角へ(raw).replace(/\s+/g, "");
    if (text === "") {
      return undefined;
    }
    const m = NUMBER_PATTERN.exec(text);
    if (!m) {
      return undefined;
    }
    // 直前が負号なら読まない（前年比などの「▲12」を正の数として書かないため）
    if (/[-−▲△]$/.test(text.slice(0, m.index))) {
      return undefined;
    }
    const 桁数 = m[2] ? (m[2].toLowerCase() === "k" ? 3 : 6) : 0;
    const 数字 = m[1].replace(/,/g, "");
    const 区切り = 数字.split(".");
    const 小数の桁 = 区切り.length > 1 ? 区切り[1].length : 0;
    // 「12.3」や「1.2345K」は整数にならない。丸めると、読んでいない数字を書くことになる
    if (小数の桁 > 桁数) {
      return undefined;
    }
    const 並び = 区切り.join("") + "0".repeat(桁数 - 小数の桁);
    const 値 = Number(並び);
    return Number.isSafeInteger(値) && 値 >= 0 ? 値 : undefined;
  }

  /**
   * 「第1話　気がついたら幽霊に」から話数（1）を取る。読めなければ undefined。
   *
   * **カンマを受けない**（母艦と同じ流儀）。「第1,2話」を12話と読むと、
   * 別の話の数字がその話に積まれる。
   */
  function parseEpisodeNumber(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const m = /第\s*([0-9]+)\s*話/.exec(半角へ(text));
    if (!m) {
      return undefined;
    }
    const 値 = Number(m[1]);
    return Number.isSafeInteger(値) && 値 >= 1 ? 値 : undefined;
  }

  /**
   * 期間のキー（母艦の形：`2026-09-22`／`2026-09`／`2026`）。
   *
   * **手元の時計の日付を使う**（`toISOString()` を切らない）。ISO文字列はUTCなので、
   * 日本時間の朝9時より前に読むと**前日のキー**になり、「今日のPV」が昨日の行として
   * 台帳に積まれる。サイトが見せている「今日」は、作者の時計の今日である。
   */
  function periodKeyFor(period, now) {
    const d = now instanceof Date ? now : new Date();
    if (Number.isNaN(d.getTime())) {
      return undefined;
    }
    const 年 = String(d.getFullYear());
    const 月 = String(d.getMonth() + 1).padStart(2, "0");
    const 日 = String(d.getDate()).padStart(2, "0");
    if (period === "day") return `${年}-${月}-${日}`;
    if (period === "month") return `${年}-${月}`;
    if (period === "year") return 年;
    // total（累計・その時点の値）は期間を持たない
    return undefined;
  }

  const STATS_SITES = [
    {
      id: "kakuyomu",
      label: "カクヨム",
      supported: true,
      // 収集を禁じる条文が無く、自分の管理画面をボタン1回で読むのは負荷も妨害も無い（6.79.7）
      hosts: ["kakuyomu.jp"],
      readPages: [
        // 2026-09-22 実機で確認：作品管理は /my/ 付き、アクセス数は /my/ 無し
        { kind: "work", label: "作品管理", pattern: /^\/my\/works\/(\d+)\/?$/ },
        { kind: "accesses", label: "アクセス数", pattern: /^\/works\/(\d+)\/accesses\/?$/ },
      ],
      /*
        作品管理ページの「読者からの反応」（2026-09-22 実機）：
          フォロワー 23／PV 1,269／星 ★18・レビュー 6／応援 33・応援コメント –
        アクセシビリティの名前は listitem "フォロワー" / "星/レビュー" / "応援/応援コメント"。
        母艦の7欄への写しは設計書6.79.7.1 の表のとおり。
      */
      workMetrics: [
        {
          metric: "bookmarks",
          names: ["フォロワー"],
          patterns: [ラベルの次の数("フォロワー")],
          soleNumber: true,
        },
        {
          metric: "pv",
          names: ["PV"],
          patterns: [ラベルの次の数("PV")],
          // 「今日 0 PV」「今月 2 PV」は作品全体の累計ではない
          exclude: /今日|今週|今月|昨日/,
          soleNumber: true,
        },
        {
          metric: "points",
          names: ["星", "星/レビュー"],
          // ★の数。「★18」とも「星 18」とも書かれうる
          patterns: [ラベルの次の数("★"), ラベルの次の数("星", "／/・")],
        },
        {
          metric: "reviews",
          names: ["レビュー", "星/レビュー"],
          patterns: [ラベルの次の数("レビュー")],
        },
        {
          metric: "likes",
          names: ["応援", "応援/応援コメント"],
          // 「応援コメント」に当たらないよう、あいだに「コ」を挟ませない
          patterns: [ラベルの次の数("応援", "コ")],
        },
        {
          metric: "comments",
          names: ["応援コメント", "応援/応援コメント"],
          // 実機では「–」（まだ無い）。数が無ければ欄ごと入れない
          patterns: [ラベルの次の数("応援コメント")],
        },
      ],
      /*
        同じページの「今日 0 PV／今週 0 PV／今月 2 PV」。
        **今週は読まない**——母艦の粒度は day／month／year／total で、週が無い。
        無い粒度を月や日に寄せると、あとから見て何の数字か分からなくなる。
      */
      periodMetrics: [
        { period: "day", metric: "pv", names: ["今日"], patterns: [ラベルの次の数("今日")] },
        { period: "month", metric: "pv", names: ["今月"], patterns: [ラベルの次の数("今月")] },
      ],
      /*
        アクセス数ページの表（2026-09-22 実機）：
          table.EpisodeStatsList_episodeStatsList__*
            tr.EpisodeStatsListItem_episodeStatsListItem__*
              th                                    … 話へのリンク（「第1話　…」）
              td.EpisodeStatsListItem_cheer__*      … 応援数
              td.EpisodeStatsListItem_pv__*         … 「102PV」
        クラス名の末尾はビルドごとに変わるので、前方一致で当てる。
      */
      episodeTable: {
        tables: ['table[class^="EpisodeStatsList_"]'],
        rows: ['tr[class^="EpisodeStatsListItem_"]'],
        heading: ["th"],
        columns: [
          { metric: "likes", selectors: ['td[class^="EpisodeStatsListItem_cheer"]'] },
          { metric: "pv", selectors: ['td[class^="EpisodeStatsListItem_pv"]'] },
        ],
      },
    },
    {
      id: "alphapolis",
      label: "アルファポリス",
      /*
        **枠だけ置いてある。** 規約の判定は「可」（6.79.7）だが、管理画面のDOMを
        実機で見られていない（作者の作品がアルファポリスに無い）。推測で書いた
        セレクタで数を拾うと、**違う数字を母艦の台帳へ入れる**——貼り込みと違って、
        入ってしまえば作者にも見分けが付かない。実機で確かめたら supported を true にし、
        カクヨムと同じ形で表を埋める。
      */
      supported: false,
      hosts: ["www.alphapolis.co.jp", "alphapolis.co.jp"],
      readPages: [],
      workMetrics: [],
      periodMetrics: [],
      episodeTable: null,
    },
  ];

  /** サイトIDから表を引く。 */
  function statsSiteById(id) {
    return STATS_SITES.find((s) => s.id === id) || null;
  }

  /**
   * いま開いているURLが「読める管理画面」かを見る（貼り込みの checkTarget と同じ流儀）。
   *
   * ドメインの照合は common/match.js の hostMatches を借りる（写しを作らない）。
   * そのため、このファイルより先に match.js が読み込まれている必要がある
   * （manifest.json の content_scripts と popup.html の順番がそれを保証する）。
   *
   * @returns {{ok:true, siteId:string, page:object, workId:string|null}
   *          |{ok:false, reason:string, siteId?:string}}
   */
  function matchReadPage(url, sites) {
    const 表 = Array.isArray(sites) ? sites : STATS_SITES;
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (_e) {
      return { ok: false, reason: "bad-url" };
    }
    const Match = global.NPHMatch;
    const site = 表.find((s) => Match.hostMatches(parsed.hostname, s.hosts)) || null;
    if (!site) {
      return { ok: false, reason: "unknown-site" };
    }
    if (!site.supported) {
      return { ok: false, reason: "unsupported-site", siteId: site.id };
    }
    for (const page of site.readPages) {
      const m = page.pattern.exec(parsed.pathname);
      if (m) {
        return { ok: true, siteId: site.id, page, workId: m[1] || null };
      }
    }
    return { ok: false, reason: "not-read-page", siteId: site.id };
  }

  const api = {
    MAX_LABEL_TEXT,
    NAMED_SELECTOR,
    TEXT_SELECTOR,
    STATS_SITES,
    parseCount,
    parseEpisodeNumber,
    periodKeyFor,
    statsSiteById,
    matchReadPage,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHStatsSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
