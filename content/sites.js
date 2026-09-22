"use strict";

/**
 * サイトごとの「見分け方」と「欄の指定」の表。**この表が唯一の場所**。
 * ページ側（content/fill.js）とポップアップ（popup.js）の両方がこのファイルを読む。
 * 写しを別の場所に作らないこと——直し忘れると、黙って違う欄に入れる事故になる。
 *
 * ★★ カクヨムは実機で確認済み（2026-09-22）。アルファポリスは推測のままです ★★
 * アルファポリスのHTMLは手元で開いて確かめるまで分かりません。合わなければ
 * 「ページの形が変わったようです」と言って**何もしない**ので、原稿は壊れません。
 * 実機で開発者ツールを見て、この表の selectors を直してください（直すのはここだけ）。
 *
 * 表の読み方：
 * - hosts            : このサイトと認めるドメイン（完全一致か、その下位ドメイン）
 * - postPagePatterns : 「話の作成画面」と認めるパス。ここに合わないページでは動かさない
 * - postPageLabel    : その画面の呼び名（ポップアップが「◯◯の話の作成画面です」と出すのに使う。
 *                      読み取りの表の readPages[].label と同じ役どころ。**表が唯一の場所**）
 * - workIdPatterns   : パスから作品IDを取り出す正規表現（1番目の丸括弧がID）。
 *                      **空なら、そのサイトでは作品IDの照合をしない**（match.js が飛ばす）
 * - formScopes       : 欄を探す起点。上から試し、最初に見つかった要素の**中だけ**を探す。
 *                      どれも無ければページ全体。ページの隅の検索欄などに当たらないための枠
 * - fields           : 埋める欄。selectors は strict → generic の順に試す
 *   - strict         : サイト固有と読める形。ここで当たれば、空欄には断りなしで入れる
 *   - generic        : `#body` のように**どのページにもあり得る形**。当たっても「たぶん」
 *                      でしかないので、**空でも1度は作者に確認する**（guard.js）
 * - supported        : false なら、封筒が来ても貼り込まない（枠だけ置いてある）
 */
(function (global) {
  const SITES = [
    {
      id: "kakuyomu",
      label: "カクヨム",
      supported: true,
      // 規約に自動化・収集の明示条文が無く、貼り込みは負荷も妨害も生まない（設計書6.79.1）。
      hosts: ["kakuyomu.jp"],
      postPagePatterns: [
        // 話の新規作成：/my/works/{作品ID}/episodes/new
        /^\/my\/works\/\d+\/episodes\/new\/?$/,
      ],
      postPageLabel: "話の作成画面",
      workIdPatterns: [/^\/my\/works\/(\d+)(?:\/|$)/],
      /*
        **2026-09-22 実機で確認**（作者の Chrome で、母艦が話の新規作成画面を読んだ）。
        フォームは `form#episode-editForm`（action は /my/works/{id}/episodes/new）。
        隠し欄に csrf_token と status があるが、触らない（guard.js が hidden を弾く）。
      */
      formScopes: ["#episode-editForm", 'form[action*="episode"]', "main form", "form"],
      fields: {
        title: {
          label: "タイトル欄",
          required: false,
          selectors: {
            // 2026-09-22 実機で確認：input#episodeTitle-input[name="title"]
            // name の形も残す（idだけが変わることのほうが多いため）
            strict: ["#episodeTitle-input", 'input[name="title"]'],
            generic: ["#title", 'input[placeholder*="タイトル"]'],
          },
        },
        body: {
          label: "本文欄",
          required: true,
          selectors: {
            // 2026-09-22 実機で確認：textarea#episodeBody-input[name="body"]
            // **textarea なので、改行はそのまま入る**（contenteditable の心配は無い）
            strict: ["#episodeBody-input", 'textarea[name="body"]'],
            generic: ["#body", 'textarea[placeholder*="本文"]', 'div[contenteditable="true"]'],
          },
        },
      },
    },
    {
      id: "alphapolis",
      label: "アルファポリス",
      supported: true,
      // 禁止事項に自動化・収集の条文が無い（設計書6.79.1）。
      hosts: ["www.alphapolis.co.jp", "alphapolis.co.jp"],
      postPagePatterns: [
        // 投稿画面のパスは実機未確認。取りこぼすより「動かない」ほうが安全なので、
        // 見当のつくものを並べ、合わなければ何もしない。
        /^\/manage\/novel\/\d+\/episode\/(?:new|create)\/?$/,
        /^\/author\/novel\/\d+\/episode\/(?:new|create)\/?$/,
        /^\/novel\/\d+\/episode\/new\/?$/,
      ],
      postPageLabel: "話の作成画面",
      // **わざと空にしてある。** アルファポリスの作品IDはURL上で2つの数字に分かれる形が
      // あり（作者IDと作品ID）、封筒の作品IDとどちらを突き合わせるべきかを実機で
      // 確かめられていない。取り違え防止の照合が**間違って一致する**と、
      // 「確かめた」という顔で別の作品へ貼り込むことになる。
      // 照合しないほうがまだ安全なので、空にして match.js に飛ばさせる
      // （作者には「機械では確かめられない」と伝える。messages.js の workIdUnchecked）。
      // 実機でパスの形が分かったら、ここへ書けば照合が復活する。
      workIdPatterns: [],
      formScopes: ["#episode-form", 'form[action*="episode"]', "main form", "form"],
      fields: {
        title: {
          label: "タイトル欄",
          required: false,
          selectors: {
            strict: ['input[name="title"]'],
            generic: ["#title", 'input[placeholder*="タイトル"]'],
          },
        },
        body: {
          label: "本文欄",
          required: true,
          selectors: {
            strict: ['textarea[name="body"]', 'textarea[name="text"]'],
            generic: ["#body", "#text", 'div[contenteditable="true"]'],
          },
        },
      },
    },
    {
      id: "narou",
      label: "小説家になろう",
      // 枠だけ置く。**規約が4サイトで最も厳しい**——第14条23号が
      // 「APIを利用する以外の方法で、自動化された手段でのアクセス・データ収集」を禁じており、
      // **送信の自動化は明確に禁止**（設計書6.79.1）。貼り込み（欄を埋めるだけ）は文言上
      // 対象外と読めるが、対応の可否は作者の最終判断。読み取り（6.79.7）は対応しないと裁定済み。
      supported: false,
      hosts: ["syosetu.com", "ncode.syosetu.com"],
      postPagePatterns: [],
      workIdPatterns: [],
      formScopes: [],
      fields: {},
    },
  ];

  /** サイトIDから表を引く。 */
  function siteById(id) {
    return SITES.find((s) => s.id === id) || null;
  }

  const api = { SITES, siteById };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
