"use strict";

/**
 * いま開いている画面の見立て（0.3.0。作者の依頼「開いた画面を認識して、
 * 表示するボタンを調整するとかできないですかね？」）。
 *
 * ポップアップは 0.2.3 まで、**いつも同じ2つのボタンを同じ見た目で出していた**。
 * どちらが使える画面なのかは、押して断られるまで分からなかった。
 * ここで URL だけを見て「貼り込める画面か／反応を読める画面か」を当て、
 * 使えないボタンを押せなくし、理由を1行添えるための材料を作る。
 *
 * ## ここは見た目のための層であって、守りではない
 *
 * 押したあとの確かめ（match.js の checkTarget、statsSites.js の matchReadPage、
 * guard.js）は**1つも外さない**。この見立てが間違っていても、間違った場所へは
 * 貼り込まれない——この層は「押す前に分かる」ぶんだけの親切である。
 * だから見立てが付かないとき（URLが読めない等）は、押せなくするより
 * **押せるままにして既存の守りへ渡す**ほうが安全な場面もある（popup.js 側の判断）。
 *
 * ## ボタンは隠さない
 *
 * 母艦の実装ルール7（ブラウザ版で使えない操作は、消さずに押せなくして理由を出す）と
 * 同じ考え方。隠すと「ボタンが無い、壊れた」になり、作者は理由にたどり着けない。
 *
 * 判定はこのファイルだけに置く。popup.js は結果を画面へ写すだけにする
 * ——2か所で判定すると、片方を直した日にもう片方が黙って食い違う。
 */
(function (global) {
  /**
   * 読めるURLのしるし。**http/https だけを見る。**
   *
   * `chrome://extensions` や `about:blank` は `new URL()` を通ってしまう
   * （protocol が chrome: / about: になるだけで、例外にならない）ので、
   * 例外の有無だけで「読めた」と判断すると、拡張の設定画面を
   * 「対応していないサイト」と言い張ることになる。そこは「この画面では使えません」が正しい。
   */
  const 読めるプロトコル = ["http:", "https:"];

  /** 見立てが付かなかったときの答え。URLが無い・読めないときはすべてこれ。 */
  function 見立てなし() {
    return {
      siteId: null,
      siteLabel: null,
      canFill: false,
      canReadStats: false,
      statsSupported: false,
      pageLabel: null,
      pageKind: null,
      kind: "noUrl",
    };
  }

  /** 読み取りの表から、サイトIDに当たる行の表示名を取る（statsSiteById は既定の表しか見ないため）。 */
  function 読み取りの表示名(siteId, statsSites) {
    const 行 = (statsSites || []).find((s) => s.id === siteId);
    return 行 ? 行.label : null;
  }

  /**
   * いま開いているURLから、2つのボタンが使えるかを当てる。
   *
   * @param {string} url いま選ばれているタブのURL（activeTab で読める）
   * @param {Array} sites content/sites.js の SITES（貼り込みの表）
   * @param {Array} statsSites content/statsSites.js の STATS_SITES（読み取りの表）
   * @returns {{siteId:string|null, siteLabel:string|null, canFill:boolean,
   *            canReadStats:boolean, statsSupported:boolean,
   *            pageLabel:string|null, pageKind:string|null, kind:string}}
   *   kind は "fill" | "stats" | "knownSiteOtherPage" | "unknownSite" | "noUrl"
   *   statsSupported は「**このサイトで読み取りが使えるか**」（いまのページではなく、サイトの話）。
   *   アルファポリスのように、貼り込みは使えるが読み取りは止めてあるサイトがあり、
   *   これが無いと「作品管理・アクセス数の画面で使えます」と案内してしまう
   *   ——**いつまで歩いても着かない道案内**になる（使えないと言うより悪い）
   *   pageKind は表の側の名前（"post" | "work" | "accesses"）。**文言の出し分けはこちらで行う**
   *   ——日本語の表示名（pageLabel）で分岐すると、表の label を直した日に、
   *   「このページの50話ぶん」の但し書きが黙って消える
   */
  function describePage(url, sites, statsSites) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (_e) {
      return 見立てなし();
    }
    if (!読めるプロトコル.includes(parsed.protocol)) {
      return 見立てなし();
    }

    const Match = global.NPHMatch;
    const StatsSites = global.NPHStatsSites;

    // 貼り込みの表から見た、いまのサイト。supported が false（なろう）は
    // 「貼り込み係が動くサイト」には数えない——数えると「話の作成画面で使えます」と
    // 言ってしまい、いつまで待っても使えない画面へ作者を案内することになる。
    const 貼り込み先 = Match.siteForHost(parsed.hostname, sites);
    const 貼り込めるサイト = Boolean(貼り込み先 && 貼り込み先.supported);
    const canFill = 貼り込めるサイト && Match.isPostPage(parsed.pathname, 貼り込み先);

    // 読み取りは、押したときと**同じ関数**に当てさせる（写しを作らない）。
    const 読み取り = StatsSites.matchReadPage(url, statsSites);
    const canReadStats = 読み取り.ok === true;
    /*
      **このサイトで読み取りが使えるか**（いまのページの話ではない）。
      matchReadPage は、表に在って supported なサイトでページが違うときだけ
      not-read-page を返す——つまり「ok または not-read-page」が、
      そのサイトで読み取りが使えることの印である（unsupported-site は別の理由で、
      アルファポリスがここに落ちる。siteId は付くが、案内してはいけない）。
    */
    const statsSupported = canReadStats || 読み取り.reason === "not-read-page";
    // siteId は unsupported-site（アルファポリス）でも付くので、supported のときだけ数える。
    const 読めるサイトID = statsSupported ? 読み取り.siteId || null : null;

    const siteId = 貼り込めるサイト ? 貼り込み先.id : 読めるサイトID;
    const siteLabel = 貼り込めるサイト
      ? 貼り込み先.label
      : 読み取りの表示名(読めるサイトID, statsSites);

    if (canFill) {
      return {
        siteId,
        siteLabel,
        canFill: true,
        canReadStats,
        statsSupported,
        // 表示名は表から取る（sites.js の postPageLabel）。ここへ書き写さない
        pageLabel: 貼り込み先.postPageLabel || null,
        pageKind: "post",
        kind: "fill",
      };
    }

    if (canReadStats) {
      return {
        siteId,
        siteLabel,
        canFill: false,
        canReadStats: true,
        statsSupported,
        pageLabel: 読み取り.page.label,
        pageKind: 読み取り.page.kind,
        kind: "stats",
      };
    }

    return {
      siteId,
      siteLabel,
      canFill: false,
      canReadStats: false,
      statsSupported,
      pageLabel: null,
      pageKind: null,
      // サイトは分かるが、いまのページでは何もできない（作品の閲覧ページ、トップなど）
      kind: siteId ? "knownSiteOtherPage" : "unknownSite",
    };
  }

  const api = { describePage };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHPageState = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
