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
 * 読むのは**作者が自分で開いた、作者自身の作品の管理画面と、作者自身の作品の
 * Narou.fun のページ**（0.6.0）に出ている「ラベルと数の組」だけ。本文も、
 * 他の方の作品も、ページ全体の文字も読まない（Narou.fun は誰の作品のページでも
 * 開けるので、作者の作品かどうかは母艦が作品IDで確かめる——下の表の注記）。
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
 * - envelopeSite     : 封筒の site に書く名前（0.6.0）。無ければ id をそのまま書く。
 *                      Narou.fun は「なろうの作品の数」なので "narou" と書く
 * - source           : 封筒の source（どこで読んだか。0.6.0）。無ければ書かない
 *                      ——書かない封筒は「そのサイトの管理画面そのもの」の意味になる
 * - readPages        : 読めるページ。pattern の1番目の丸括弧が作品ID。
 *                      readsWork が true のページでは作品全体の数を読む（0.6.0）
 * - workMetrics      : 作品管理ページから拾う「作品全体」の数（母艦の7欄へ写す）
 * - workCards        : 「ラベルの枡と数の枡」が1枚の札に収まっている形の、作品全体の数
 *                      （0.6.0。Narou.fun）。ラベルは完全一致で当てる。無いサイトは書かない。
 *                      0.14.2 から組の並びで、組ごとに within（区画。その中だけを探す）・containers（札）・
 *                      label（ラベルの要素）・value（数の要素。ラベルの要素でない最初の1つ）・metrics を持つ
 * - periodMetrics    : 同じページの「今日／今月」のPV（今週は母艦に無い粒度なので読まない）
 * - dailyGraph       : 同じページの日ごとのPVのグラフ（0.5.0）。1本ずつ属性から
 *                      日付と数を読む（selectors・attr・parse）。無いサイトは null
 * - dailyTable       : 日ごとの**累計**の表（0.7.0。Narou.fun）。読み取り係が前の日との
 *                      差を取り、日の期間の行にする（負もある）。列は見出しの名前で当てる。
 *                      無いサイトは書かない
 * - readAtFrom       : 封筒の記録の日時を、押した時刻ではなくページの文字から読む指定
 *                      （0.7.0。Narou.fun の「データ取得」の日付。0.14.2）。無いサイトは書かない（押した時刻）
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
 *                        updatedAt : 話の最終更新の枡と読み方（0.5.0。無い表もある）
 *                        nextPage  : 「次のページが在るか」を見るだけの印。押しも開きもしない
 * - supported        : false なら読み取りをしない（枠だけ置いてある）
 * - facts            : タグと連載の状態の読み方（0.16.0）。readPages の readsFacts が true のページでだけ読む。
 *                      tags は containers（入れ物の選択子）か lists＋dtLabel（字がその名の dt の次の dd）と items
 *                      （タグの字の要素）、completion は selectors（印の要素）か lists＋dtLabel。決めるのは字
 *                      （completionFromText）。読めなければ封筒の欄ごと省く
 * - workTitle        : 作品名の探し方（0.13.1。作者の依頼 2026-10-11「IDではなく作品名表示に」）。
 *                      selectors を上から試し（`{workId}` はその画面の作品IDに置き換える）、
 *                      見つからなければページの題（document.title）から docTitleSuffix を剥がして使う。
 *                      **封筒には入れない**（母艦は知らない欄を受け付けない）。集計の見出しに使うだけ。
 *                      名前の形は cleanWorkTitle で確かめ、怪しければ使わない（作品IDのまま出す）
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

  /** 2桁へ揃える（`4` → `04`）。 */
  function 二桁(n) {
    return String(n).padStart(2, "0");
  }

  /**
   * 暦に在る日か。`Date.UTC` は 2月30日 を黙って3月2日へ繰り上げるので、
   * 繰り上がったら暦に無い日と見なす——読めない日付を別の日として書かないため。
   */
  function 暦にある日か(年, 月, 日) {
    if (月 < 1 || 月 > 12 || 日 < 1) {
      return false;
    }
    const d = new Date(Date.UTC(年, 月 - 1, 日));
    return d.getUTCFullYear() === 年 && d.getUTCMonth() === 月 - 1 && d.getUTCDate() === 日;
  }

  /**
   * 日付の文字を読む前に揃える。全角の数字・コロンと、続く空白（改行を含む）を1つに。
   * 実機では `2022年4月25日15:07 最終更新` のように、日付と時刻のあいだに
   * **空白が無いこともある**ので、空白の有無に意味を持たせない。
   */
  function 日付を揃える(text) {
    return 半角へ(text).replace(/：/g, ":").replace(/\s+/g, " ").trim();
  }

  /**
   * カクヨムの「最終更新」の枡（`td.episode-date`）を、ISO 8601（日本時間 `+09:00`）にする。
   *
   *   `2022年4月25日15:07 最終更新`   → `2022-04-25T15:07:00+09:00`
   *   `2024年7月31日 08:13 最終更新`  → `2024-07-31T08:13:00+09:00`
   *
   * **時刻まで読めたときだけ**返す。母艦はこの日時から「更新後3日（72時間）以上」を
   * 決めるので、時刻の無い日付を 0時 と書くと、最大で1日ぶん古い話として扱われ、
   * まだ3日経っていない話が基準の話に選ばれうる。読めなければ undefined
   * （呼ぶ側は `updatedAt` の欄ごと入れない——約束の「空文字や null にしない」）。
   *
   * 先頭に日付が来る形だけを読む。「予約公開 …」のように前に別の語がある形は、
   * 最終更新の日時かどうか分からないので読まない。
   *
   * タイムゾーンは**サイトの表示が日本時間**なので `+09:00` と書く
   * （作者の時計には寄せない——periodKeyFor とは逆。こちらはサイトが書いた日時である）。
   */
  function parseKakuyomuDate(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const m = /^(\d{4})年 ?(\d{1,2})月 ?(\d{1,2})日 ?(\d{1,2}):(\d{2})(?!\d)/.exec(日付を揃える(text));
    if (!m) {
      return undefined;
    }
    const [年, 月, 日, 時, 分] = m.slice(1, 6).map(Number);
    if (!暦にある日か(年, 月, 日) || 時 > 23 || 分 > 59) {
      return undefined;
    }
    return `${年}-${二桁(月)}-${二桁(日)}T${二桁(時)}:${二桁(分)}:00+09:00`;
  }

  /**
   * 作品管理ページの日ごとのグラフの1本（`data-ui-tooltip-label` の
   * `2026年8月24日：5PV`）を、母艦の日の期間キーと数にする。読めなければ undefined。
   *
   *   `2026年8月24日：5PV` → `{ periodKey: "2026-08-24", value: 5 }`
   *
   * **末尾まで固定する**（`…PV$`）。略記（`1.2KPV`）や、別の意味の文言が混じった日には
   * 当たらない——ツールチップの数（ツールチップの数()）と同じ流儀で、数は parseExactCount。
   */
  function parseKakuyomuDailyLabel(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const m = /^(\d{4})年 ?(\d{1,2})月 ?(\d{1,2})日 ?: ?([0-9][0-9,]*) ?PV$/.exec(日付を揃える(text));
    if (!m) {
      return undefined;
    }
    const [年, 月, 日] = m.slice(1, 4).map(Number);
    if (!暦にある日か(年, 月, 日)) {
      return undefined;
    }
    const value = parseExactCount(m[4]);
    if (value === undefined) {
      return undefined;
    }
    return { periodKey: `${年}-${二桁(月)}-${二桁(日)}`, value };
  }

  /**
   * なろうファンDB（Narou.fun）の「データ取得 2026/10/31」を、ISO 8601（日本時間 `+09:00`）にする（0.14.2）。
   *
   *   `データ取得 2026/10/31` → `2026-10-31T00:00:00+09:00`
   *
   * **なろうファンDB がなろうから数を取ってきた日**である（作者が押した時刻ではない）。
   * 作者の裁定（2026-09-23）で、封筒の記録の日時（readAt）をこれにする——同じページを
   * 翌朝に押しても、数は前の日の取得のままだから、押した時刻を書くと「いつの数か」がずれる。
   *
   * ## 時刻が無いことの扱い（2026-11-01 のリニューアルで、日付だけになった）
   *
   * リニューアル前は「最終取得日時：2026/09/22 01:26」と時刻まであった。いまは日付だけなので、
   * **その日の 0:00（日本時間）として書く**。時刻を当て推量で足さない（取ってきた時刻はページの
   * どこにも無い）。0:00 にそろえておけば、同じ日のデータを何度読んでも記録の日時が同じになり、
   * 受け手の側で同じ記録が二重に増えない（押した時刻にすると、押すたびに別の記録になる）。
   * 印（readAtBasis）は "fetched" のまま——「サイトが数を取ってきた日時」という意味は変わらず、
   * 封筒の形も変えない（受け手の読み口は "fetched"／"clicked" しか知らない）。
   *
   * 「データ取得」の語から日付の終わりまでを固定する。前に別の語が付いた形・後ろに何か付いた形・
   * リニューアル前の「最終取得日時」は読まない（読めなければ undefined。呼ぶ側は押した時刻へ落とし、
   * そうと分かる印を付ける）。タイムゾーンはサイトの表示が日本時間なので `+09:00`。
   */
  function parseNarouFunDataDate(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const m = /^データ取得 ?(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(日付を揃える(text).replace(/／/g, "/"));
    if (!m) {
      return undefined;
    }
    const [年, 月, 日] = m.slice(1, 4).map(Number);
    if (!暦にある日か(年, 月, 日)) {
      return undefined;
    }
    return `${年}-${二桁(月)}-${二桁(日)}T00:00:00+09:00`;
  }

  /** 年月日を「日の番号」（1970-01-01 からの日数）にする。日の前後と差を、時差抜きで比べるため。 */
  function 日の番号(年, 月, 日) {
    return Math.round(Date.UTC(年, 月 - 1, 日) / 86400000);
  }

  /**
   * 年の無い日付を補うとき、読んだ日から何日まで離れていてよいか。
   *
   * 表は「直近30日」なので、30日ほどしか離れないはず。60日を超えて離れた日付は、
   * 今年か去年かを**当て推量することになる**ので読まない（古いままのページなど）。
   */
  const 補ってよい日数 = 60;

  /**
   * Narou.fun の日ごとの表の日付（`09/22`。**年が無い**）を、母艦の日の期間キーにする（0.7.0）。
   *
   *   `09/22`（2026年9月23日に読んだ） → `2026-09-22`
   *   `12/28`（2027年1月5日に読んだ）  → `2026-12-28`   ← 年をまたぐ
   *
   * **年は読んだ日（作者の時計の日付）から補う**（作者の裁定）。去年・今年・来年の3つのうち、
   * 読んだ日にいちばん近い日を採る——「今年の日付が先なら去年」とだけ決めると、
   * 大晦日に読んだ「01/01」（リアルタイム表示の明日の行）を去年の元日にしてしまう。
   *
   * **読んだ日より先の日は読まない。** Narou.fun の「リアルタイム」表示は、いまの数を
   * **明日の日付**の行として足す（ページのスクリプトがそう組んでいる。2026-09-23 に読んだ）。
   * まだ締まっていない数を、来ていない日の数として台帳へ入れない。
   *
   * 閏日（02/29）はその年に在るときだけ。遠すぎる日（補ってよい日数を超える）も読まない。
   *
   * @param {string} text 表の日付の枡の文字
   * @param {Date} now 読んだ日時
   * @returns {string|undefined} `YYYY-MM-DD`
   */
  function parseNarouFunTableDate(text, now) {
    if (typeof text !== "string" || !(now instanceof Date) || Number.isNaN(now.getTime())) {
      return undefined;
    }
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(日付を揃える(text).replace(/／/g, "/"));
    if (!m) {
      return undefined;
    }
    const 月 = Number(m[1]);
    const 日 = Number(m[2]);
    const 今年 = now.getFullYear();
    const 今日 = 日の番号(今年, now.getMonth() + 1, now.getDate());
    let 採る;
    for (const 年 of [今年 - 1, 今年, 今年 + 1]) {
      if (!暦にある日か(年, 月, 日)) {
        continue;
      }
      const 番号 = 日の番号(年, 月, 日);
      const 離れ = Math.abs(番号 - 今日);
      if (!採る || 離れ < 採る.離れ) {
        採る = { 年, 番号, 離れ };
      }
    }
    if (!採る || 採る.番号 > 今日 || 採る.離れ > 補ってよい日数) {
      return undefined;
    }
    return `${採る.年}-${二桁(月)}-${二桁(日)}`;
  }

  /**
   * なろうファンDB の日ごとの表の数の枡（`1,111 ±0`・`1,114 +1`・`1,112 -1`）から、**累計だけ**を読む
   * （0.7.0。形は 0.14.2）。
   *
   * 枡は「その日までの累計」の span と「前の日との差」の span でできている（2026-11-01 のリニューアル後。
   * それまでは `1113 (0)` の括弧の形だった）。**差は読まない**——表の最初の行は、前の日が無いのに
   * サイトが「±0」と置いている（リニューアル前の「(0)」と同じ）。差は読み取り係が累計どうしから自分で取る。
   *
   * 形は末尾まで固定する。「-」（まだ無い）・略記・ほかの語が付いたもの・古い括弧の形は undefined
   * （呼ぶ側は、その欄の差を取らない。0で埋めない）。差の符号は「±」「+」「-」と全角の「−」を受ける。
   */
  function parseNarouFunCumulative(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const m = /^([0-9][0-9,]*)(?: [±+\-−][0-9,]+)?$/.exec(半角へ(text).replace(/\s+/g, " ").trim());
    return m ? parseExactCount(m[1]) : undefined;
  }

  /**
   * 日の期間キーの前の日（`2026-03-01` → `2026-02-28`）。読めなければ undefined。
   *
   * 日ごとの差は**前の日の行があるときだけ**取る。日が抜けた表で「すぐ上の行」と比べると、
   * 2日ぶんの差を1日の数として書くことになる。
   */
  function previousDayKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
    if (!m) {
      return undefined;
    }
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
    if (Number.isNaN(d.getTime())) {
      return undefined;
    }
    return `${d.getUTCFullYear()}-${二桁(d.getUTCMonth() + 1)}-${二桁(d.getUTCDate())}`;
  }

  /**
   * タグ1つの長さの上限は、ほかの数のラベルと同じ MAX_LABEL_TEXT（0.16.0）。タグはサイトの側で短く決まっている
   * （カクヨムもなろうも数十字まで）ので、これより長い字はタグではない——ページのほかの文を拾ったので読まない。
   * 個数にも上限を置く（カクヨムのタグは数個、なろうのキーワードも十数個。50 を超えて並ぶのは別の一覧を拾ったとき）。
   */
  const MAX_TAGS = 50;

  /**
   * 連載の状態の字（「連載中」「完結済」「連載中・全219話」）を、封筒の completion にする（0.16.0）。
   *
   * **字で決める**（作者の頼み）。カクヨムの印のクラス名（`widget-workStatusLabel-running`）は探す手がかり
   * にとどめる——完結の作品のクラス名は実機で見ておらず、知らない名で同じ字が出ても拾えるように。
   * - 先頭が「連載中」→ "ongoing"
   * - 「完結」を含む（「完結済」「完結済・全30話」）→ "completed"
   * - それ以外（「短編」「休載中」・空）→ undefined（呼ぶ側は欄ごと省く）
   *
   * なろうファンDB の「短編」は省く。短編は連載ではなく、受け手の「連載中／完結」のどちらに入れても
   * 作者の言い方と違う意味になる（完結の連載と並べて数えると、完結した連載の数が化ける）。写しで短編の作品の
   * 形も見ていないので、分からないものとして扱う。
   *
   * @param {string} text 印の字
   * @returns {"ongoing"|"completed"|undefined}
   */
  function completionFromText(text) {
    if (typeof text !== "string") {
      return undefined;
    }
    const 字 = text.replace(/\s+/g, "").trim();
    if (字 === "" || 字.length > MAX_LABEL_TEXT) {
      return undefined;
    }
    if (/^連載中/.test(字)) {
      return "ongoing";
    }
    if (字.indexOf("完結") >= 0 && 字.indexOf("未完結") < 0) {
      return "completed";
    }
    return undefined;
  }

  /**
   * 作品名の長さの上限（0.13.1）。カクヨムもなろうも題は100字まで（common/history.js の MAX_TITLE と同じ）。
   * これより長い字は題ではない——ページのほかの文を拾ったので、読まない。
   */
  const MAX_WORK_TITLE = 100;

  /**
   * 題ではない、画面の言葉（0.13.1。小文字で照合する）。リンクの字やページの題がこれだけなら、
   * 作品名として使わない——集計に「アクセス数」と出るより、作品IDのまま出るほうがよい。
   */
  const 題でない言葉 = [
    "カクヨム",
    "narou.fun",
    // 2026-11-01 のリニューアル後のサイトの名（小文字で照合するので db も小文字）
    "なろうファンdb",
    "なろう",
    "小説家になろう",
    "作品",
    "作品ページ",
    "作品トップ",
    "作品の管理",
    "作品管理",
    "作品を管理",
    "作品の編集",
    "作品を編集",
    "作品の設定",
    "アクセス数",
    "アクセス解析",
    "目次",
    "トップ",
    "戻る",
    "詳細",
    "公開ページ",
    "マイページ",
    "ワークスペース",
    "ログイン",
    "エピソード",
  ];

  /** リンクの字に多い、題ではない言い回し（リンクから拾ったときだけ見る。題の終わりにもありうるため） */
  const リンクの言い回し = /(?:を見る|を読む|へ戻る|に戻る|を表示|はこちら)$/;

  /**
   * 拾った字が作品名として使えるかを確かめ、使えるなら整えた字を返す（0.13.1）。使えなければ null。
   *
   * - 改行と半角の空白の並びは1つの空白へ（**全角の空白は残す**——題の書き方である）
   * - 空・100字を超える・作品ID（数字だけ、Nコード）だけ・題ではない言葉だけ、は使わない
   * - リンクから拾った字は、「作品ページを見る」のような言い回しも落とす
   *
   * @param {string} raw 拾った字
   * @param {{fromLink?:boolean, workId?:string}} [opts]
   */
  function cleanWorkTitle(raw, opts) {
    if (typeof raw !== "string") {
      return null;
    }
    const 字 = raw.replace(/[ \t\r\n\f\v]+/g, " ").trim();
    if (字 === "" || 字.length > MAX_WORK_TITLE) {
      return null;
    }
    const o = opts || {};
    if (/^[0-9]+$/.test(字) || /^[Nn][0-9]{4}[A-Za-z]{1,2}$/.test(字)) {
      return null;
    }
    if (o.workId && 字.toLowerCase() === String(o.workId).toLowerCase()) {
      return null;
    }
    if (題でない言葉.includes(字.toLowerCase())) {
      return null;
    }
    if (o.fromLink === true && リンクの言い回し.test(字)) {
      return null;
    }
    return 字;
  }

  /**
   * ページの題（document.title）から作品名を取り出す（0.13.1）。取り出せなければ null。
   *
   * **サイトの名の接尾（「 - カクヨム」）が付いている題だけを読む**——付いていない題は、どういう形か
   * 分からないので当てずっぽうにしない。剥がしたあとに区切り（半角の「-」「|」は前後に空白があるときだけ
   * ——題の中の「Re-Start」を割らないため。全角の「｜」「－」は空白が無くても）が残っていれば、
   * 題ではない言葉（「アクセス数」など）の区切りを落とし、**1つだけ残ったときだけ**使う
   * （2つ以上残ったら、どれが題か分からない）。
   *
   * @param {string} docTitle ページの題
   * @param {object} spec 表の workTitle
   * @param {string} [workId]
   */
  function workTitleFromDocTitle(docTitle, spec, workId) {
    if (typeof docTitle !== "string" || !spec || !(spec.docTitleSuffix instanceof RegExp)) {
      return null;
    }
    if (!spec.docTitleSuffix.test(docTitle)) {
      return null;
    }
    const 区切り = docTitle
      .replace(spec.docTitleSuffix, "")
      .split(/\s+[-|]\s+|\s*[－｜]\s*/)
      .map((s) => cleanWorkTitle(s, { workId }))
      .filter((s) => s !== null);
    return 区切り.length === 1 ? 区切り[0] : null;
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
        // readsWork：作品全体の数（workMetrics・workCards）を読むページ（0.6.0。種類の名前で分岐しない）
        /*
          ownerOnly（0.9.0）：**ログインした本人しか開けない画面**の印。開いて読めたら、その作品IDを
          「自分の作品」として覚え、以後はアクセス数の画面も溜める（common/stash.js）。
          作品管理は /my/ の下で、ログインしていなければログインの画面へ回される（2026-09-23 に確かめた）。
          **アクセス数には付けない**——ログインしていなくても、誰の作品のアクセス数でも開ける
          （同じ日に確かめた。話ごとの表が50行そのまま出る）。
          pageParam（0.9.0）：ページ送りの番号の名前（`?page=2`）。溜めるときに、ページごとに別の1件にする
        */
        { kind: "work", label: "作品管理", readsWork: true, readsFacts: true, ownerOnly: true, pattern: /^\/my\/works\/(\d+)\/?$/ },
        { kind: "accesses", label: "アクセス数", pageParam: "page", pattern: /^\/works\/(\d+)\/accesses\/?$/ },
      ],
      /*
        作品名（0.13.1）。**どれも実機ではまだ確かめていない。**
        - `[id="workTitle"]`：カクヨムの作品の公開ページで題を入れている場所の id。管理の画面にもあれば当たる
        - 作品の公開ページ（/works/作品ID）へのリンク：作品管理・アクセス数の画面の題は、公開ページへの
          リンクになっていることが多い。リンクの字が「作品ページを見る」のような言葉なら cleanWorkTitle が落とす
        - ページの題：「… - カクヨム」の「 - カクヨム」を剥がす。「アクセス数」などの言葉の区切りは落とす
        外れても作品IDで出るだけで、ほかの読み取りには響かない。
      */
      workTitle: {
        selectors: ['[id="workTitle"]', 'a[href="/works/{workId}"]', 'a[href="https://kakuyomu.jp/works/{workId}"]'],
        docTitleSuffix: /\s*[-－|｜]\s*カクヨム\s*$/,
      },
      /*
        タグと連載の状態（0.16.0。作者の頼み。受け手と取り決め済み）。作品管理の画面だけで読む
        （readsFacts の印のあるページ。アクセス数の画面には無い）。
        - タグ：作品情報の dl の中で、字が「タグ」の dt の**次の dd** の中の `/tags/` へのリンクの字（実機で8個）。
          同じ dl の「セルフレイティング」の dd にも `/tags/` のリンクがあるが、dt の字で分けるので読まない
        - 連載の状態：`span.widget-workStatusLabel-running`（字「連載中」）。完結の作品の印は実機で見ていない
          （`widget-workStatusLabel-completed`／字「完結済」の見込み）ので、クラス名の一部で探し、字で決める
      */
      facts: {
        tags: {
          lists: ["dl"],
          dtLabel: "タグ",
          items: ['a[href^="/tags/"]', 'a[href^="https://kakuyomu.jp/tags/"]'],
        },
        completion: { selectors: ['span[class*="workStatusLabel"]'] },
      },
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
        同じページの「読者からの反応」の下の、日ごとのPVのグラフ（0.5.0。2026-09-23 実機）：
          li.feedbackGraph-graph.ui-tooltip[data-ui-tooltip-label="2026年8月24日：5PV"]
        1本が1日。**何日ぶんあるかは実機で数えていない**（30日ほどと見込み）ので、
        本数では絞らず、出ているものを全部読む。

        母艦の日のグラフの材料になる。「今日 ◯ PV」（periodMetrics）と日が重なったら
        **1件にする**（約束：表示文字の側を採る）。重ねるのは read.js の仕事。
      */
      dailyGraph: {
        metric: "pv",
        selectors: ["li.feedbackGraph-graph[data-ui-tooltip-label]"],
        attr: カクヨムのツールチップ属性,
        parse: parseKakuyomuDailyLabel,
      },
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
          /*
            各話の最終更新（0.5.0。2026-09-23 実機：`2022年4月25日15:07 最終更新`）。
            数ではないので columns とは分けてある——columns は metrics へ入り、
            こちらは話の行の `updatedAt` へ入る。母艦は「更新後3日以上の最新話」を
            決めるのに使う。読めなければ欄ごと入れない。
          */
          updatedAt: { selectors: ["td.episode-date"], parse: parseKakuyomuDate },
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
        **アルファポリスの作者の管理画面**（0.17.0。作者の決定 2026-11-01「数も読むようにする」）。
        規約の判定は「可」（3章）。形は 2026-10-12 と 2026-11-01 に作者の Chrome で読んだもの
        （docs/measurements/2026-10-12-alphapolis-pages.md）。読むのは**どれも /mypage/ の下＝ログインした本人しか
        開けない画面**なので、開いて読めた作品はカクヨムの作品管理と同じく「自分の作品」として覚える（ownerOnly）。

        ## 封筒の約束（受け手と取り決め済み。母艦が受け手を読んだ結果）

        - site は "alphapolis"、**source は付けない**（受け手は知らない source の封筒を断る）
        - 指標は、受け手の表にある共通の名前（pv・unique・bookmarks・points・likes・comments・reviews）に
          意味が合うものだけをその名で載せ、合わないものは `alphapolis_` で始まる名前にする（受け手は 0.116.1 までは捨て、その次の版から受け取る）
        - **共通の名前が1つも無い行が混ざると、受け手は封筒ごと断る。** だから行ごとに共通の名前を最低1つ持たせ、
          持たない行は入れない（commonMetrics。読み取り係が落とす）。0 は画面に 0 と出ているときだけ入れる

        意味の対応（判断と理由）：
          お気に入り数 → bookmarks   作品を「お気に入り」に入れた読者の数。カクヨムのフォロワー・なろうのブクマと同じ
                                      「続きを追う読者」の数で、受け手のブックマーク率の分子として意味が合う
          累計ポイント → points       作品の評価の累計。カクヨムの★・なろうの総合ポイントと同じ「作品の点の累計」の欄
          いいね（話ごと） → likes    話ごとの反応の数。カクヨムの応援（likes）と同じ「その話を読んで押す」もの
          24時間のポイント → alphapolis_points24h   直近24時間の窓の数で、暦の日（period: "day"）でも累計でもない
          累計・24時間の順位 → alphapolis_rankTotal・alphapolis_rank24h   順位は読者の反応の数ではない
          ハート → alphapolis_hearts   一覧の作品ごとの数。何を数えているかを確かめていない（いいねの合計とは限らない）
          しおり（話ごと） → alphapolis_bookmarks  その話に挟まれたしおりの数。作品のお気に入り（bookmarks）とは別物
          エール（話ごと） → alphapolis_yells      投げ銭に近い応援で、いいねとは別
          誤字報告（話ごと） → alphapolis_typoReports  読者の反応ではあるが、評価でも感想の本文でもない

        ## 読む画面
          /mypage/content                  作品管理の一覧。**作品が複数並ぶ**ので、作品の枠（div.main）ごとに別の1件を作る
                                           （multiWork）。作品IDは枠の中の管理画面へのリンク（/mypage/content/detail/ID）か、
                                           題のリンク（/novel/作者ID/作品ID）から
          /mypage/content/detail/{作品ID}  作品の管理画面。話ごとの行（div.content）。章の見出し（div.chapter）は読まない。
                                           話ごとの閲覧数（PV）はこの画面に無い
          /mypage/novel/save/{作品ID}      作品の設定の画面（投稿のフォーム）。**数が無いので1件を作らない**（factsOnly）。
                                           タグと連載の状態だけを読み、拡張の中に作品ごとに持っておいて、同じ作品の数の1件を
                                           溜めるとき・束にするときに載せる。**読むだけで、欄に何も書かない・何も押さない**
                                           （test/redLine.test.js が見張る）
        どの画面も、初めて開いたときは自動で取得するかを訊く（askFirst。更新しただけで「自動」にしない）。
      */
      supported: true,
      hosts: ["www.alphapolis.co.jp", "alphapolis.co.jp"],
      readPages: [
        { kind: "list", label: "作品管理の一覧", readsWork: true, ownerOnly: true, multiWork: true, askFirst: true, pattern: /^\/mypage\/content\/?$/ },
        { kind: "detail", label: "作品の管理画面", ownerOnly: true, askFirst: true, pattern: /^\/mypage\/content\/detail\/(\d+)\/?$/ },
        { kind: "settings", label: "作品の設定の画面", ownerOnly: true, askFirst: true, factsOnly: true, readsFacts: true, pattern: /^\/mypage\/novel\/save\/(\d+)\/?$/ },
      ],
      /** 受け手の表にある共通の名前。どの行にも1つは入れる（無い行は読み取り係が落とす） */
      commonMetrics: ["pv", "unique", "bookmarks", "points", "likes", "comments", "reviews"],
      /*
        作品管理の一覧の作品の枠（multiWork のページ）。containers の要素1つが1作品。
        **中に別の枠を持つ要素は読まない**（ページ全体を包む div.main があっても、それを1作品と取り違えない）。
        数は枠の中の短い字を、metrics の形（字の頭から終わりまで）に当てて読む。最初に当たった1つを採る。
      */
      workBlocks: {
        containers: ["div.main"],
        workIdFrom: [
          { selectors: ['a[href*="/mypage/content/detail/"]'], pattern: /\/mypage\/content\/detail\/(\d+)/ },
          { selectors: ['a[href*="/novel/"]'], pattern: /\/novel\/\d+\/(\d+)/ },
        ],
        title: ["h2.title"],
        metrics: [
          { metric: "points", selectors: ["div.notes"], pattern: /^累計 ?([0-9][0-9,]*) ?pt(?:$| ?[(（])/ },
          { metric: "alphapolis_rankTotal", selectors: ["div.notes"], pattern: /^累計 ?[0-9,]+ ?pt ?[(（] ?([0-9][0-9,]*) ?位 ?[)）]$/ },
          { metric: "alphapolis_points24h", selectors: ["div.notes"], pattern: /^24h\.? ?([0-9][0-9,]*) ?pt(?:$| ?[(（])/ },
          { metric: "alphapolis_rank24h", selectors: ["div.notes"], pattern: /^24h\.? ?[0-9,]+ ?pt ?[(（] ?([0-9][0-9,]*) ?位 ?[)）]$/ },
          // 要素は確かめていない（字の上では「お気に入り数：264」）。字の形で当てる
          { metric: "bookmarks", selectors: ["div", "span", "p", "li", "dd"], pattern: /^お気に入り数 ?[:：] ?([0-9][0-9,]*)$/ },
          // ハートの数（字の上では div.heart の中の 23）。数だけの字のときだけ
          { metric: "alphapolis_hearts", selectors: ["div.heart", "span.icon-heart"], pattern: /^([0-9][0-9,]*)$/ },
        ],
      },
      workMetrics: [],
      periodMetrics: [],
      dailyGraph: null,
      episodeTables: {
        /*
          作品の管理画面の話の行（2026-10-12 作者の Chrome）：
            div.content
              div.title h3                       … 題（全文。「１話　転生」）
              span.bookmark span.count           … しおり
              p.yell-count span.icon-emendation  … 誤字報告「0回 |」
              p.yell-count span.icon-heart       … いいね「10回 |」
              p.yell-count span.icon-yell        … エール「0 回 |」
          **数の字が、アイコンの要素の中にあるのか隣にあるのかは確かめていない。** 中にあれば読め、隣なら読めない
          （いいねが読めない行は入らないので、全部読めなければ「ページの形が変わったようです」になる。0 で埋めない）。
          選択子の空白は「その中の」の意味（読み取り係が1段ずつ辿る）。
        */
        detail: {
          tables: [],
          rows: ["div.content"],
          rowFilter: ["p.yell-count"],
          heading: ["div.title h3", "h3"],
          columns: [
            { metric: "likes", selectors: ["p.yell-count span.icon-heart"] },
            { metric: "alphapolis_bookmarks", selectors: ["span.bookmark span.count"] },
            { metric: "alphapolis_typoReports", selectors: ["p.yell-count span.icon-emendation"] },
            { metric: "alphapolis_yells", selectors: ["p.yell-count span.icon-yell"] },
          ],
        },
      },
      /*
        作品の設定の画面のタグと連載の状態（2026-11-01 作者の Chrome）：
          タグ    input.tag-name[name="tag_names[]"] の value（実機で9個＋空1。空の欄は除く）
          状態    select#NovelComplete[name="complete"] の選ばれている選択肢の字（「連載中」「完結」。実機は value 2＝連載中）
        値と選ばれた選択肢を**読むだけ**（書き換えない・変更の知らせを配らない）。
      */
      facts: {
        tags: { items: ["input.tag-name"], fromValue: true },
        completion: { select: ["select#NovelComplete", 'select[name="complete"]'] },
      },
    },
    {
      /*
        **Narou.fun の作品ページ**（0.6.0。母艦の残課題 B11、作者の依頼 2026-09-23）。

        なろうの分析サイト（db.narou.fun）で、なろうの作品ごとの数を出している。
        **なろう本体（syosetu.com）とは別のサイト**である——なろうの読み取りを
        しないと決めたのは、なろう本体を機械で読むことについての規約の判断で、
        作者が自分で開いた Narou.fun のページを1回読むのはその外にある
        （robots.txt は全許可、サイト自身に「クリップボードにコピー」の釦がある）。

        ## 読まないもの

        - **なろう本体と KASASAGI**（kasasagi.hinaproject.com。なろうの運営会社の
          アクセス解析）。ページの中の「解析」の導線も辿らない（そもそも辿る機能が無い）
        - **本文・あらすじ**（読むのは下の表のラベルと数の組と、0.16.0 からはキーワードと形式の字だけ）
        - **ほかの方の作品**：Narou.fun は誰の作品のページでも開けるので、
          **この拡張には作者の作品かどうかが分からない**。封筒の作品ID（Nコード）を
          母艦が台帳のなろうの作品IDと照合し、合わなければ取り込まない

        ## 封筒のサイトと出どころ

        封筒の `site` は **"narou"**（母艦の台帳で、なろうの作品の数として積むため）、
        `source` は **"narou.fun"**（どこで読んだか）。母艦はなろう本体の封筒を
        断り続け、出どころが Narou.fun の封筒だけを受ける。
        表の id（"narouFun"）は封筒へは出ない——この表の中の名前である。

        ## ページの形（2026-11-01 のリニューアル後。作者の Chrome と同じ URL から取った、サーバーが組んだHTML）

        サイトの名は「なろうファンDB」になり、作品のページは /novels/{Nコード小文字}（例 /novels/n2600go）。
        リニューアル前の /works/{Nコード大文字} は 404。数は区画（section）ごとに置かれている：

          section[aria-labelledby="pts"]   … 「ポイント」
            div > span「総合ポイント」 + span「4,808」（日間ポイント・日間ランクイン・最高順位も同じ形）
            div[role="img"][aria-label="総合ポイントの内訳：評価ポイント2,586（53.8%）、ブックマーク由来2,222（46.2%）"]
            凡例 span > span（色の印）＋ 文字「評価ポイント」＋ span「2,586」＋ span「53.8%」（「ブクマ×2」も同じ形）
          section[aria-labelledby="react"] … 「読者の反応」
            dl > div > dt「ブクマ」 + dd「1,111」（感想・レビュー・評価者数・平均評価・週間読者も同じ形）
          section[aria-labelledby="spec"]  … 「作品の基本情報」
            dl > div > dt「データ取得」 + dd「2026/10/31」（形式・文字数・Nコードなども）

        ラベルは**完全一致**で、**その区画の中でだけ**当てる（「ブクマ」は読者の反応の区画の 1,111。
        ポイントの区画の「ブクマ×2」2,222 ではない）。評価ポイントだけは「ラベルの要素＋数の要素」の
        形でない（ラベルが文字の節）ので、内訳の帯の名前（aria-label）から読む（凡例の字は読まない。下の workMetrics に理由）。

        母艦の欄への写し（なろうのバックアップ `core/narouBackup.ts` と同じ対応。リニューアル前と同じ7つ）：
          総合ポイント→points／ブクマ→bookmarks／感想→comments／レビュー→reviews／
          評価ポイント→narou_ratingPoints／評価者数→narou_raters／週間読者→narou_weeklyReaders

        ## 読まない欄と、その理由

        - **平均評価**（8.16）：評価P ÷ 評価者数 で、1人あたりの**点**（10点満点）。
          なろうのバックアップの「評価平均」（同じ作品で 4.10）は**星**の平均で、
          **尺度が違う**。同じ欄（narou_ratingAverage）へ入れると数字が化ける。
          読む2つ（評価P・評価者数）から割れるので、別の欄も作らない
        - **評価頻度**：評価者数 ÷ ブクマ。**作者の評価率（評価した人数 ÷ 第1話のPV）とは別物**で、
          並べると取り違える。リニューアル後の画面には無いが、出てきても読まない
        - **ブクマ×2**：総合ポイントのうちブクマ由来の点。ブクマの数ではない
        - 日間ポイント・日間ランクイン・最高順位：その日の順位まわりで、読者の反応の台帳の欄が無い
        - 文字数・会話率・Nコード：読者の反応ではない（母艦は原稿と投稿の記録から知っている）。
          キーワードと形式は 0.16.0 から読む（作者の頼み。タグと連載の状態として封筒の省いてよい欄へ。下の facts）

        ## 日ごとのブクマと評価ポイントの表（0.7.0。作者の裁定 2026-09-23。形は 0.14.2）

        **前の日の累計との差を、その日の数（母艦の「日別」）にする。ブクマが外された日は
        負の数のまま渡す**（母艦は日別の増減の欄だけ負を受ける）。

        リニューアル後の形（2026-11-01）：
          div[role="table"][data-range="7"|"14"|"all"]（7日・14日・全期間。14 と all は hidden）
            div[role="row"] > span[role="columnheader"]「日付」「ブクマ」「評価P」
            div[role="row"] > span[role="cell"]「10/30」
                            > span[role="cell"] > span「1,111」 + span「±0」
        1. **3つの期間の表が、はじめから全部ページにある**（切り替えは見せ方だけ）。ページ送りも
           表示件数も無い。全期間は「直近30日分まで」（ページの注記）。作者の画面の作品で29行
           （1日抜けていた）。**全期間の表を先に読み、14日・7日の表は足りない日を埋めるだけ**
           （同じ日は最初の1行を採るので、写しを重ねても二重にならない。全期間の表が無くなった日にも読める）
        2. 日付は**年の無い「10/30」**。年は読んだ日から補う（parseNarouFunTableDate）。表の data-tsv 属性には
           年つきの日付もあるが、長い文字（全行）なので読まない——読む文字の長さの線を緩めない
        3. 数は**その日までの累計**（1,111）で、後ろの「±0」「+1」「-1」が前の日との差。**差は読まずに**
           累計どうしから自分で取る——最初の行は前の日が無いのに「±0」と出ている
        4. 「評価P」の列は評価ポイント（ポイントの区画の評価ポイントと同じ数）
        5. いちばん新しい行の日付は「データ取得」の前の日だった（10/30 と 2026/10/31）。
           リニューアル前は同じ日だった（09/22 と 2026/09/22 01:26）

        **表の最初の日（前の日の行が無い日）は、差が取れないので入れない。** 日が抜けていれば、
        抜けたあとの日も入れない。30行なら最大29日ぶん。累計のまま別の印で渡す道もあるが、
        母艦の「日別」は「その日ぶん」の意味で、累計を混ぜると「今日」の欄に 1,113 が並ぶ
        ——捨てても、翌日以降の取り込みでその日の差は埋まる（最初の日は毎回ずれるため）。
      */
      id: "narouFun",
      // 画面に出す名（0.16.0 でリニューアル後の名に。id・envelopeSite・source は受け手との約束なので変えない）
      label: "なろうファンDB",
      envelopeSite: "narou",
      source: "narou.fun",
      supported: true,
      // db.narou.fun だけ（narou.fun の他の場所へは入らない）
      hosts: ["db.narou.fun"],
      readPages: [
        {
          kind: "narouFun",
          label: "作品ページ",
          readsWork: true,
          readsFacts: true,
          // Nコードは N＋4桁＋英字1〜2字（母艦の narouNcode と同じ形）。リニューアル後のサイトは小文字で開くが、
          // 大文字も受ける。照合と記録に使う値は、溜まりと記録の側で小文字にそろえる（common/stash.js・history.js）
          pattern: /^\/novels\/([Nn][0-9]{4}[A-Za-z]{1,2})\/?$/,
        },
      ],
      /*
        作品名（0.13.1。0.14.2 でリニューアル後の形に）。作品のページの大見出し（h1）が題だけを持つ
        （2026-11-01 の形）。無ければページの題「{作品名}のブクマ・評価ポイント推移とランキング | なろうファンDB」
        から、作品名のあとの決まり文句を剥がす。Nコードだけ・サイトの名だけの字は落とす
      */
      workTitle: {
        selectors: ["h1"],
        docTitleSuffix: /のブクマ・評価ポイント推移とランキング\s*[|｜]\s*なろうファンDB\s*$/,
      },
      /*
        キーワードと連載の状態（0.16.0。作者の頼み）。作品の基本情報の区画（2026-11-01 の写しで形を確かめた）：
          div > dt.sr-only「キーワード」 + dd > ul[aria-label="キーワード"] > li > a「（キーワード）」
          div > dt「形式」 + dd「連載中・全219話」
        キーワードは ul の名前で当て、その中のリンクの字だけを読む（検索へのリンク。押しも開きもしない）。
        形式は「連載中」で始まれば ongoing、「完結」を含めば completed、短編などは省く（completionFromText）。
      */
      facts: {
        tags: { containers: ['ul[aria-label="キーワード"]'], items: ["a"] },
        completion: { lists: ['section[aria-labelledby="spec"]'], dtLabel: "形式" },
      },
      /*
        評価ポイント（0.14.2）。ラベルが文字の節で「ラベルの要素＋数の要素」の札にならないので、
        内訳の帯の名前「総合ポイントの内訳：評価ポイント2,586（53.8%）、…」から読む（45字ほどで、
        読む文字の長さの線の内）。**読む道はこれ1つだけ。** 凡例の字を逃げ道にしない——凡例は
        `評価ポイント <span>2,586</span><span>53.8%</span>` で、数と％のあいだに空白が無く、本物の
        textContent は「評価ポイント 2,58653.8%」になる。数の形を緩めて当てると「258653」を読む道が
        できるので、当てない（2026-11-01、取ったページで帯の名前を外して走らせ、凡例では読めないと確かめた）。
        帯の名前が変わった日は評価ポイントだけ欄ごと入らない（0 にはしない）。日ごとの表の評価Pは別に読める
      */
      workMetrics: [
        {
          metric: "narou_ratingPoints",
          tooltip: { attr: "aria-label", pattern: /^総合ポイントの内訳 ?[:：] ?評価ポイント ?([0-9,]+) ?[（(]/ },
        },
      ],
      /*
        区画ごとの札（0.14.2）。within の区画の中で、containers の要素を1枚の札として見て、
        label の最初の要素をラベル、value のうちラベルの要素でない最初の要素を数とする。
        選択子は単純なものだけにしてある（テストの偽のDOMが子孫の選択子を持たないので、区画の中を順に辿る）。
      */
      workCards: [
        {
          within: ['section[aria-labelledby="pts"]'],
          containers: ["div"],
          label: ["span"],
          value: ["span"],
          metrics: [{ metric: "points", label: "総合ポイント" }],
        },
        {
          within: ['section[aria-labelledby="react"]'],
          containers: ["div"],
          label: ["dt"],
          value: ["dd"],
          metrics: [
            { metric: "bookmarks", label: "ブクマ" },
            { metric: "comments", label: "感想" },
            { metric: "reviews", label: "レビュー" },
            { metric: "narou_raters", label: "評価者数" },
            { metric: "narou_weeklyReaders", label: "週間読者" },
          ],
        },
      ],
      periodMetrics: [],
      dailyGraph: null,
      /*
        日ごとのブクマと評価Pの表（0.7.0。形は 0.14.2）。列は**見出しの名前で当てる**（並びに頼らない）。
        tables・headerCells・rows・cells は単純な選択子だけにしてある
        （テストの偽のDOMが子孫の選択子を持たないので、表の中を順に辿る）。
        ページ送りが無くなったので nextPage は持たない（0.7.0〜0.14.1 の「表示件数を30に」の知らせはやめた）。
      */
      dailyTable: {
        tables: [
          'div[role="table"][data-range="all"]',
          'div[role="table"][data-range="14"]',
          'div[role="table"][data-range="7"]',
        ],
        headerCells: ['span[role="columnheader"]'],
        rows: ['div[role="row"]'],
        cells: ['span[role="cell"]'],
        dateColumn: "日付",
        columns: [
          { label: "ブクマ", metric: "bookmarks" },
          { label: "評価P", metric: "narou_ratingPoints" },
        ],
        parseDate: parseNarouFunTableDate,
        parseValue: parseNarouFunCumulative,
      },
      /*
        記録の日時（0.7.0。形は 0.14.2）。作品の基本情報の「データ取得 2026/10/31」（dt と dd を包む div の字）。
        日付だけなので、その日の 0:00（日本時間）にする（parseNarouFunDataDate に理由）。読めなければ押した時刻へ落とす。
      */
      readAtFrom: {
        selectors: ["div"],
        parse: parseNarouFunDataDate,
      },
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
    MAX_WORK_TITLE,
    cleanWorkTitle,
    workTitleFromDocTitle,
    NAMED_SELECTOR,
    TEXT_SELECTOR,
    STATS_SITES,
    parseCount,
    parseExactCount,
    parseEpisodeNumber,
    periodKeyFor,
    parseKakuyomuDate,
    parseKakuyomuDailyLabel,
    parseNarouFunDataDate,
    parseNarouFunTableDate,
    parseNarouFunCumulative,
    previousDayKey,
    MAX_TAGS,
    completionFromText,
    statsSiteById,
    episodeTableFor,
    matchReadPage,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHStatsSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
