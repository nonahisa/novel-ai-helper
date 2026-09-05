"use strict";

/**
 * サイトごとの「見分け方」と「欄の指定」の表。**この表が唯一の場所**。
 * ページ側（content/fill.js）とポップアップ（popup.js）の両方がこのファイルを読む。
 * 写しを別の場所に作らないこと——直し忘れると、黙って違う欄に入れる事故になる。
 *
 * ★★ セレクタは推測です（2026-09-05時点・実機未確認）★★
 * 各サイトのHTMLは手元で開いて確かめるまで分かりません。合わなければ
 * 「ページの形が変わったようです」と言って**何もしない**ので、原稿は壊れません。
 * 実機で開発者ツールを見て、この表の selectors を直してください（直すのはここだけ）。
 *
 * 表の読み方：
 * - hosts            : このサイトと認めるドメイン（完全一致か、その下位ドメイン）
 * - postPagePatterns : 「話の作成画面」と認めるパス。ここに合わないページでは動かさない
 * - workIdPatterns   : パスから作品IDを取り出す正規表現（1番目の丸括弧がID）
 * - fields           : 埋める欄。selectors は上から順に試し、最初に見つかったものを使う
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
      workIdPatterns: [/^\/my\/works\/(\d+)(?:\/|$)/],
      fields: {
        title: {
          label: "タイトル欄",
          required: false,
          selectors: [
            'input[name="title"]',
            "#episode-title",
            "#title",
            'input[placeholder*="タイトル"]',
          ],
        },
        body: {
          label: "本文欄",
          required: true,
          selectors: [
            'textarea[name="body"]',
            "#episode-body",
            "#body",
            'textarea[placeholder*="本文"]',
            'div[contenteditable="true"]',
          ],
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
      workIdPatterns: [
        /^\/manage\/novel\/(\d+)(?:\/|$)/,
        /^\/author\/novel\/(\d+)(?:\/|$)/,
        /^\/novel\/(\d+)(?:\/|$)/,
      ],
      fields: {
        title: {
          label: "タイトル欄",
          required: false,
          selectors: ['input[name="title"]', "#title", 'input[placeholder*="タイトル"]'],
        },
        body: {
          label: "本文欄",
          required: true,
          selectors: [
            'textarea[name="body"]',
            'textarea[name="text"]',
            "#body",
            "#text",
            'div[contenteditable="true"]',
          ],
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
