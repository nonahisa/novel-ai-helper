"use strict";

/**
 * サイトごとの「見分け方」と「欄の指定」の表。**この表が唯一の場所**。
 * ページ側（content/fill.js）とポップアップ（popup.js）の両方がこのファイルを読む。
 * 写しを別の場所に作らないこと——直し忘れると、黙って違う欄に入れる事故になる。
 *
 * カクヨムは実機で確認済み（2026-09-22）。アルファポリスは 2026-11-01 に作者の Chrome で
 * 投稿画面を読んで直した（0.14.2。拡張を入れて貼り込むところはまだ確かめていない）。
 * サイトの形が変わって合わなくなれば「ページの形が変わったようです」と言って**何もしない**ので、
 * 原稿は壊れません。直すときは、開発者ツールで見てこの表の selectors を直す（直すのはここだけ）。
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
        /*
          **2026-11-01 作者の Chrome で読んだ**：新しい話の投稿画面は /mypage/novel/save_episode/{作品ID}
          （作品IDは数字9桁）。話の編集は /mypage/novel/save_episode/{作品ID}/{話ID} で、**こちらは対象外**
          （カクヨムと同じく新規作成だけ。書いた話へ上から入れると、保存済みの本文を作者が見ずに消しかねない）。
          manifest の matches（save_episode/*）は Chrome の書き方の都合で編集の画面も覆うが、
          ここの末尾を固定しているので、編集の画面では「話の作成画面ではない」と言って何もしない。
          0.14.1 まで並べていた /manage/・/author/・/novel/ の3つの見当は、どれも実在しなかったので外した。
        */
        /^\/mypage\/novel\/save_episode\/\d+\/?$/,
      ],
      postPageLabel: "話の作成画面",
      /*
        作品IDは投稿画面の URL に1つだけ出る（2026-11-01。作品の公開ページは /novel/{作者ID}/{作品ID} と
        2つに分かれるが、投稿画面と管理画面は作品IDだけ）。0.14.1 までは形が分からず、間違って一致すると
        取り違え防止が「確かめた」顔で通ってしまうので空にしていた。投稿画面の形が分かったので、照合を戻す。
      */
      workIdPatterns: [/^\/mypage\/novel\/save_episode\/(\d+)(?:\/|$)/],
      /*
        起点は投稿のフォーム `form#ContentBlockEpisodeNovelMypageSaveEpisodeForm`（action は save_episode）。
        同じフォームの中に、本文をファイルから読む欄 `input[type=file][name="text"]`（id TextSelect）・
        画像の欄 `input[type=file][name="image_files"]`・章の選択 `select[name="chapter"]`・
        ［保存］［公開］の釦（submit の name="draft"／"publish"）がある。**どの見当もこれらに当たらない形にする**
        （test/alphapolisForm.test.js が見張る）。ページにパスワード欄は無い。
      */
      formScopes: [
        "#ContentBlockEpisodeNovelMypageSaveEpisodeForm",
        'form[action*="save_episode"]',
        "main form",
        "form",
      ],
      fields: {
        title: {
          label: "タイトル欄",
          required: false,
          selectors: {
            // 2026-11-01：input#ContentBlockEpisodeNovelTitle[name="episode_title"]（type=text）。
            // name の形も残す（id だけが変わることのほうが多いため）
            strict: ["#ContentBlockEpisodeNovelTitle", 'input[name="episode_title"]'],
            generic: ["#title", 'input[placeholder*="タイトル"]'],
          },
        },
        body: {
          label: "本文欄",
          required: true,
          selectors: {
            // 2026-11-01：textarea#NovelEpisodeBodyId[name="body"]。textarea なので改行は消えない。
            // 0.14.1 までの 'textarea[name="text"]' と '#text' は外した——同じフォームに name="text" の
            // ファイルの欄があり、名前の似た見当は、形が変わった日にそちらへ当たりかねない
            strict: ["#NovelEpisodeBodyId", 'textarea[name="body"]'],
            generic: ["#body", 'textarea[placeholder*="本文"]', 'div[contenteditable="true"]'],
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
