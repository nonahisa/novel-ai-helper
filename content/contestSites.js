"use strict";

/**
 * 公募の一覧のページの表（0.12.0。作者の依頼、2026-09-23「コンテストの読み込み機能が欲しい」）。
 *
 * 公募（文学賞・コンテスト）の一覧を載せているまとめサイトのうち、**決めた3ページだけ**を読む。
 * どのページか・1件の枠はどれか・名前と公式サイトへのリンクはどこか、をここに置き、
 * 読む係（content/contestRead.js）と裏方（background.js）と印の判定（common/pageState.js）が
 * **同じ表を引く**（写しを作らない）。
 *
 * ## 読者の反応の読み取りと、線の引き方が違う
 *
 * 読者の反応は作者だけが見られる管理画面で、読むのは「ラベルと数の組」だけに絞っている。
 * 公募の一覧は**誰でも見られる公開のページ**で、作者が応募先を選ぶために見ている情報
 * （名前・締切・賞典・字数・主催・募集作品・応募資格）そのものを読む。
 * それでも、次は同じにする：
 *
 * - 作者が押したときだけ、1回だけ読む（開いただけでは読まない・見張らない）
 * - 通信しない。次のページへ自動で進まない（ページ送りは作者が押す）
 * - 読んだものはクリップボードへ置くだけ（拡張の中に溜めない・どこへも送らない）
 * - ページへ何も差し込まない
 *
 * セレクタは簡単なもの（タグ・クラス・属性の1つずつ）だけで書く。子孫の組み合わせは使わない
 * ——テストの作り物のDOMで確かめられる形にするため（test/readEnvelope.test.js と同じ）。
 */
(function (global) {
  /**
   * @typedef {object} ContestSite
   * @property {string} id 出どころの名（統合小説執筆環境の core/contestListing.ts と揃える）
   * @property {string} label 表示名
   * @property {string} host ホスト名（完全一致）
   * @property {string[]} paths 読むページのパス（完全一致。末尾の / の有無は問わない）
   * @property {string} card 1件の枠のセレクタ
   * @property {string} name 枠の中の、名前の要素のセレクタ
   * @property {string} link 枠の中の、リンクのセレクタ（公式サイト、無ければそのサイトの詳しいページ）
   * @property {string|null} section 見出し（「2026年10月締切」「カクヨム」）のセレクタ。無ければ null
   * @property {string[]} skipNames 公募でない枠の名前（「開催予定」の表）
   * @property {boolean} paged ページ送りのある一覧か（知らせで「次のページも押す」と言う）
   */

  /** @type {ContestSite[]} */
  const CONTEST_SITES = [
    {
      id: "novelportal",
      label: "ノベルポータル",
      host: "creative-story.net",
      // 文学賞・公募一覧と、投稿サイトのコンテスト一覧
      paths: ["/bungakusyou/", "/202111contest/"],
      card: ".contest-card",
      name: "h3",
      // 名前の見出しのリンクが、公式サイトの募集要項を指している
      link: "a[href]",
      section: "h2",
      skipNames: ["開催予定"],
      paged: false,
    },
    {
      id: "tsukuritemirai",
      label: "ツクリテミライ",
      host: "tsukuritemirai.com",
      paths: ["/kobo/novel/"],
      // 1件ずつの枠。ページのスクリプトがあとから組む（開いた直後は「読み込み中...」）
      card: 'div[class*="bg-surface-card"]',
      name: "h2",
      // 一覧に公式サイトへのリンクは無い。そのサイトの詳しいページ（/kobo/…）を持つ
      link: 'a[href^="/kobo/"]',
      section: null,
      skipNames: [],
      paged: true,
    },
  ];

  /**
   * このURLが公募の一覧のページか。http/https だけを見る。
   *
   * @param {string} url
   * @param {ContestSite[]} [sites]
   * @returns {{ok:true, site:ContestSite}|{ok:false, reason:"bad-url"|"not-contest-page"}}
   */
  function matchContestPage(url, sites) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (_e) {
      return { ok: false, reason: "bad-url" };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "not-contest-page" };
    }
    const 末尾を揃える = (p) => (p.endsWith("/") ? p : p + "/");
    const site = (sites || CONTEST_SITES).find(
      (s) => s.host === parsed.hostname && s.paths.some((p) => 末尾を揃える(parsed.pathname) === p)
    );
    return site ? { ok: true, site } : { ok: false, reason: "not-contest-page" };
  }

  const api = { CONTEST_SITES, matchContestPage };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHContestSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
