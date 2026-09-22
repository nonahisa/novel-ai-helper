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
 * ## 省略形と、ツールチップの正確な数（2026-09-22、219話の作品で分かったこと）
 *
 * 「読者からの反応」の6欄は、**数が大きくなると表示が省略形になる**（`1.05M`・`27.5K`）。
 * さらにフォロワーの欄は、アイコンの隣に `2,814` とあるだけで**ラベルの文字が無い**。
 * そのため「ラベルの次の数」を表示文字から読む道では、実機で ★ しか取れなかった。
 *
 * 正確な数は `data-ui-tooltip-label` 属性にある（`フォロワー数 2,814`／`PV数 1,053,339`）。
 * そこで**属性から読む道を最優先**にし、表示文字の道は逃げ道として残してある
 * ——小さい作品では表示文字も正確で、属性の名前が変わった日にはそちらで拾えるため。
 *
 * そして**省略形は数として採らない**（parseExactCount）。`1.05M` を 1,050,000 と書くと、
 * 母艦の台帳では正確な数と見分けが付かなくなる。読めない欄は、欄ごと入れないほうがよい。
 *
 * 表の読み方：
 * - hosts            : このサイトと認めるドメイン（照合は common/match.js の hostMatches）
 * - readPages        : 読めるページ。pattern の1番目の丸括弧が作品ID
 * - workMetrics      : 作品管理ページから拾う「作品全体」の数（母艦の7欄へ写す）
 * - periodMetrics    : 同じページの「今日／今月」のPV（今週は母艦に無い粒度なので読まない）
 * - episodeTables    : 話ごとの表の読み方を、**ページの種類ごと**に持つ（0.4.0）。
 *                      同じサイトでも、作品管理（work）とアクセス数（accesses）では
 *                      表そのものが別物で、読める欄も話の数も違う。引くのは
 *                      episodeTableFor(site, kind)——直接 `site.episodeTables.work` と
 *                      書かない（引き方が2通りあると、片方だけ直した日に黙って食い違う）
 *                      1つの表の中身：
 *                        tables    : 表の囲い。**当たった表を全部見る**（下記の「控えの表」）
 *                        rows      : 話の行
 *                        rowFilter : この選択子に当たる枡を持つ行だけを読む（控えの表を落とす）
 *                        heading   : 話数を読む枡
 *                        columns   : 欄の指定（metric と selectors）
 *                        nextPage  : 「次のページが在るか」を見るだけの印。押しも開きもしない
 * - supported        : false なら読み取りをしない（枠だけ置いてある）
 *
 * ## 作品管理ページには、控えの表がもう1つある（2026-09-22 実機）
 *
 * `table.episodes` が2つあり、`tr.episode` は**合わせて438行**（219話の作品）。
 * 片方は題も数字も入っていない控えで、拾うと**全話が二重に**母艦の台帳へ入る。
 * 台帳は追記なので、**入ってしまえば作者には見分けが付かない**。
 * そこで `rowFilter`（`td.episode-feedback-pv` を持つ行だけ）で落とす。
 *
 * 1件ぶんの拾い方（workMetrics / periodMetrics）：
 * - metric     : 母艦の欄の名前（models/posting.ts の READER_STATS_METRICS）
 * - tooltip    : **いちばん先に見る道**。`{ attr, pattern }` で、その属性の値から数を取る。
 *                カクヨムは表示の文字が省略形（`1.05M`）で、正確な数は
 *                `data-ui-tooltip-label` にしか無い（下の「省略形」の節）
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
   * 略記（K・M）を**受けない**読み方。読めれば正確な数、省略形なら undefined。
   *
   * parseCount は `1.05M` を 1,050,000 として読む——話ごとの表のように、
   * 画面の数がそのまま正確な値である場所では、それでよい。
   * だが作品全体の反応は、**丸めた表示と正確な数が別々にある**（後者はツールチップ）。
   * 丸めたほうを台帳へ書くと、あとから見て「本当に1,050,000だったのか」が分からない。
   * だから作品全体の欄では、こちらを通して省略形を落とす。
   */
  function parseExactCount(raw) {
    if (typeof raw !== "string" && typeof raw !== "number") {
      return undefined;
    }
    const m = NUMBER_PATTERN.exec(半角へ(raw).replace(/\s+/g, ""));
    // 数のすぐ後ろに K・M が付いていれば、それは丸めた表示である
    if (m && m[2]) {
      return undefined;
    }
    return parseCount(raw);
  }

  /**
   * 「第1話　気がついたら幽霊に」から話数（1）を取る。読めなければ undefined。
   *
   * **カンマを受けない**（母艦と同じ流儀）。「第1,2話」を12話と読むと、
   * 別の話の数字がその話に積まれる。
   *
   * 「第」が無い形（`１話　転生`。2026-09-22、作品管理ページの実機）も読む。
   * ただし**題の先頭に限る**——どこでもよいことにすると、「あの日の3話ぶんの記憶」
   * のような題を3話と読み、別の話の数字がその話へ積まれる。
   */
  function parseEpisodeNumber(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const 半角 = 半角へ(text);
    const m = /第\s*([0-9]+)\s*話/.exec(半角) || /^\s*([0-9]+)\s*話/.exec(半角);
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

  /**
   * カクヨムが正確な数を入れている属性（2026-09-22 実機）。
   * 表示の文字（`1.05M`）とは別に、ここへ `PV数 1,053,339` の形で入っている。
   */
  const カクヨムのツールチップ属性 = "data-ui-tooltip-label";

  /**
   * ツールチップの属性から数を取る拾い方を1つ作る。
   *
   * **末尾まで固定し、略記を受けない**（`([0-9][0-9,]*)$`）。ここは正確な数が
   * 入っている場所なので、`1.05M` のような文字が入っていたら、それは属性の意味が
   * 変わった合図である——その場合は当てずに、表示文字の道へ落とすほうが安全。
   * 末尾を固定しているので「今日 1 PV」のような期間つきの表示にも当たらない。
   */
  function ツールチップの数(ラベル) {
    return {
      attr: カクヨムのツールチップ属性,
      pattern: new RegExp(`^${ラベル}\\s*([0-9][0-9,]*)$`),
    };
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
        作品管理ページの「読者からの反応」（div.summary-content）。

        小さい作品（2026-09-22 実機、23フォロワー）の表示：
          フォロワー 23／PV 1,269／星 ★18・レビュー 6／応援 33・応援コメント –
          アクセシビリティの名前は listitem "フォロワー" / "星/レビュー" / "応援/応援コメント"

        大きい作品（同日、219話）の表示と `data-ui-tooltip-label`：
          2,814        → フォロワー数 2,814      （表示にラベルの文字が無い）
          1.05M        → PV数 1,053,339         （表示は省略形）
          ★1,612       → ★数 1,612
          611          → レビュー人数 611
          27.5K        → 応援数 27,534           （表示は省略形）
          258          → コメント数 258

        だから tooltip を先に見る。母艦の7欄への写しは設計書6.79.7.1 の表のとおり。
      */
      workMetrics: [
        {
          metric: "bookmarks",
          tooltip: ツールチップの数("フォロワー数"),
          names: ["フォロワー"],
          patterns: [ラベルの次の数("フォロワー")],
          soleNumber: true,
        },
        {
          metric: "pv",
          tooltip: ツールチップの数("PV数"),
          names: ["PV"],
          patterns: [ラベルの次の数("PV")],
          // 「今日 0 PV」「今月 2 PV」は作品全体の累計ではない
          exclude: /今日|今週|今月|昨日/,
          soleNumber: true,
        },
        {
          metric: "points",
          tooltip: ツールチップの数("★数"),
          names: ["星", "星/レビュー"],
          // ★の数。「★18」とも「星 18」とも書かれうる
          patterns: [ラベルの次の数("★"), ラベルの次の数("星", "／/・")],
        },
        {
          metric: "reviews",
          // 表示は「レビュー」だが、ツールチップは「レビュー人数」
          tooltip: ツールチップの数("レビュー人数"),
          names: ["レビュー", "星/レビュー"],
          patterns: [ラベルの次の数("レビュー")],
        },
        {
          metric: "likes",
          tooltip: ツールチップの数("応援数"),
          names: ["応援", "応援/応援コメント"],
          // 「応援コメント」に当たらないよう、あいだに「コ」を挟ませない
          patterns: [ラベルの次の数("応援", "コ")],
        },
        {
          metric: "comments",
          // 表示は「応援コメント」だが、ツールチップは「コメント数」
          tooltip: ツールチップの数("コメント数"),
          names: ["応援コメント", "応援/応援コメント"],
          // 小さい作品の実機では「–」（まだ無い）。数が無ければ欄ごと入れない
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
        話ごとの表は、ページの種類ごとに別物である（0.4.0）。

        作者の指摘（2026-09-22）「作品管理ページなら50話縛りが無いのでは」はそのとおりで、
        0.3.0 まではアクセス数の表しか持っておらず、**作品管理では作品全体の6欄しか
        読んでいなかった**。作品管理のほうが得である：

                  作品管理        アクセス数
          話の数  全部（219話）   50話ずつ・5ページ
          欄      応援・応援コメント・PV   応援・PV
          押す回数 1回             5回

        それでも**アクセス数の道は消さない**——片方の作りが変わった日の逃げ道になる。
      */
      episodeTables: {
        /*
          作品管理ページの話の表（2026-09-22 実機）：
            table.episodes            … **2つある**（もう1つは題も数字も入っていない控え）
              tr.episode              … 合わせて438行。本物は219行
                td.episode-title > a  … 「１話　転生」（**全角の数字**。「第」が無い）
                td.episode-characterCount        … 「3,697文字」。**読まない**（反応ではない）
                td.episode-feedback-cheerCount   … 応援数
                td.episode-feedback-cheerComment … 応援コメント数（無い話は**空**）
                td.episode-feedback-pv           … 「23,299 PV」

          クラス名にハッシュが付いていないので、前方一致ではなくそのまま当てる
          （アクセス数ページのほうは CSS Modules で、末尾がビルドごとに変わる）。
        */
        work: {
          tables: ["table.episodes"],
          rows: ["tr.episode"],
          // **控えの表を落とすのはここ**。PVの枡を持つ行だけが本物（219行）
          rowFilter: ["td.episode-feedback-pv"],
          heading: ["td.episode-title"],
          columns: [
            { metric: "likes", selectors: ["td.episode-feedback-cheerCount"] },
            { metric: "comments", selectors: ["td.episode-feedback-cheerComment"] },
            { metric: "pv", selectors: ["td.episode-feedback-pv"] },
          ],
          // ページ送りが無い（全話が1枚に出る）。だから nextPage を持たせない
        },
        /*
          アクセス数ページの表（2026-09-22 実機）：
            table.EpisodeStatsList_episodeStatsList__*
              tr.EpisodeStatsListItem_episodeStatsListItem__*
                th                                    … 話へのリンク（「第1話　…」）
                td.EpisodeStatsListItem_cheer__*      … 応援数
                td.EpisodeStatsListItem_pv__*         … 「102PV」
          クラス名の末尾はビルドごとに変わるので、前方一致で当てる。

          この表は**50話ずつのページ送り**で、219話の作品では5ページに分かれる。
          読むのは画面に出ている50話ぶんだけなので、次のページの印（nextPage）を
          見て、作者へ「このページの分だけです」と伝える（0.2.2）。
        */
        accesses: {
          tables: ['table[class^="EpisodeStatsList_"]'],
          rows: ['tr[class^="EpisodeStatsListItem_"]'],
          heading: ["th"],
          columns: [
            { metric: "likes", selectors: ['td[class^="EpisodeStatsListItem_cheer"]'] },
            { metric: "pv", selectors: ['td[class^="EpisodeStatsListItem_pv"]'] },
          ],
          /*
            次のページの印（2026-09-22 実機：文言は「次へ」、行き先は `…/accesses?page=2`）。

            **在ることを見るだけである。押さないし、href も開かない**——この拡張は
            HTTPを1本も発しない（6.79.2-1）。次のページを開くのは作者の手である。

            セレクタと文言の**両方に当たったときだけ**「次へ」と見なす。
            - href だけで見ると、ページ2以降にある「前へ」も同じ形なので、
              最後のページで「まだ続きがあります」と嘘を言うことになる
            - 文言だけで見ると、題に「次へ」を含む話のリンクを拾ってしまう
            どちらか片方が変わった日には当たらなくなるが、**黙って多く言うより、
            黙って言わないほうが安全**（言わなければ 0.2.1 までと同じ表示に戻るだけ）。
          */
          nextPage: {
            selectors: ['a[href*="/accesses?page="]'],
            text: /次へ/,
          },
        },
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
      episodeTables: {},
    },
  ];

  /** サイトIDから表を引く。 */
  function statsSiteById(id) {
    return STATS_SITES.find((s) => s.id === id) || null;
  }

  /**
   * 話ごとの表を、**ページの種類ごと**に引く（0.4.0）。
   *
   * 引き方をこの1か所に閉じ込めるのは、読み取り係（read.js）とテストが
   * 別々に `site.episodeTables.work` と書き始めると、形を変えた日に
   * 片方だけが黙って古いままになるから。
   *
   * @param {object|null} site 読み取りの表の1行
   * @param {string} kind readPages の kind（"work" / "accesses"）
   * @returns {object|null} 表が無いページなら null（呼ぶ側は話ごとを読まない）
   */
  function episodeTableFor(site, kind) {
    const 表 = site && site.episodeTables;
    if (!表 || typeof kind !== "string") {
      return null;
    }
    return Object.prototype.hasOwnProperty.call(表, kind) ? 表[kind] || null : null;
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
    parseExactCount,
    parseEpisodeNumber,
    periodKeyFor,
    statsSiteById,
    episodeTableFor,
    matchReadPage,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHStatsSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
