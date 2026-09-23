"use strict";

/**
 * Chrome ウェブストアの画像を撮るための、chrome API の代役（`npm run store:images` が使う）。
 *
 * **拡張の中身ではない。** zip（`npm run pack`）には入らず、manifest からも読まれない。
 * 撮るときだけ、scripts/storeImages.mjs が本物の options.html の写しを使い捨ての場所に作り、
 * `options.js` の前にこのファイルと common/history.js・common/stash.js を差し込んで開く
 * （本物の options.html は書き換えない。撮影のための部品が本番に紛れ込まないように）。
 *
 * ## 何を代わりにするか
 *
 * options.js が使う chrome API は2つだけ——`chrome.runtime.getManifest()`（版の札）と
 * `chrome.runtime.sendMessage()`（裏方への頼み）。裏方の代わりにここが返事をする。
 * 集計の文は**本物の common/history.js の formatReport で組む**（見本のデータを本物の見せ方で出すため。
 * 字で描いた表が揃っているかを、撮った画像で確かめられる）。
 *
 * ## 見本のデータは、架空の作品だけ
 *
 * 作品ID は一目で作り物と分かる形にする（カクヨム風は `1000000000000000001`、Nコードは `n0000aa`
 * ——Nコードの数字は 0001 から始まるので 0000 の作品は無い）。題は集計に出ないので持たない。
 * 数も作り物で、どの作品の数でもない。
 *
 * このファイルも test/redLine.test.js の走査に入る（拡張の中身と同じ一線を守る）。保存に触れず、
 * ページの文字を読まず、要素を作らない。
 */
(function () {
  const 問い = new URLSearchParams(location.search);

  /** 撮る日（見本の「今日」）。ずっと同じ絵になるよう固定する。時刻は作者の時計で読む */
  const 今 = new Date(2026, 8, 23, 21, 30);
  const 時 = (月, 日, 時, 分) => new Date(2026, 月 - 1, 日, 時, 分 || 0).toISOString();
  const 日の鍵 = (月, 日) => `2026-${String(月).padStart(2, "0")}-${String(日).padStart(2, "0")}`;

  const カクヨムの作品 = "1000000000000000001";
  const なろうの作品 = "n0000aa";

  const 覚えた作品 = [
    { siteId: "kakuyomu", workId: カクヨムの作品, how: "owner", addedAt: 時(8, 1, 10) },
    { siteId: "narouFun", workId: なろうの作品, how: "approved", addedAt: 時(8, 1, 10) },
  ];

  // --- カクヨム風の見本：9/10〜9/23 の日ごとのPV、記録した日ごとの作品全体の数、話ごとのPV ---
  const 日ごとのPV = [312, 287, 455, 398, 276, 530, 612, 488, 350, 402, 367, 521, 690, 214];
  const カクヨムの日ごと = {};
  日ごとのPV.forEach((pv, i) => {
    カクヨムの日ごと[日の鍵(9, 10 + i)] = { at: 時(9, 10 + i, 21), metrics: { pv } };
  });
  // 作者が作品管理を開いた日だけ記録がある（毎日ではない）。間が空いた日は表に * が付く
  const 記録した日 = [
    [9, 12, 11020, 281, 655],
    [9, 13, 11418, 284, 661],
    [9, 15, 12224, 290, 676],
    [9, 16, 12836, 293, 682],
    [9, 17, 13324, 297, 690],
    [9, 19, 14076, 304, 709],
    [9, 20, 14443, 309, 718],
    [9, 22, 15654, 315, 736],
    [9, 23, 15868, 318, 742],
  ];
  const カクヨムの記録 = 記録した日.map(([月, 日, pv, bookmarks, points]) => ({
    date: 日の鍵(月, 日),
    readAt: 時(月, 日, 21, 5),
    metrics: { pv, bookmarks, points },
  }));
  const 最後 = 時(9, 23, 21, 5);
  const 話ごと = {};
  const 話のPV = [2140, 1302, 1011, 872, 790, 731, 684, 642, 610, 581, 556, 534, 515, 497, 480, 466, 451, 437, 426, 412, 398, 351, 262, 118];
  話のPV.forEach((pv, i) => {
    const 話 = i + 1;
    // 週に3話ずつ更新してきた見本。いちばん新しい話は、読んだ日の前日に出た
    const 出た日 = new Date(2026, 8, 22 - Math.round(((話のPV.length - 話) * 7) / 3), 19, 0);
    話ごと[String(話)] = { at: 最後, pv, pvAt: 最後, updatedAt: 出た日.toISOString(), updatedReadAt: 最後 };
  });

  // --- Narou.fun 風の見本：日ごとのブクマと評価の増減、記録した日ごとの作品全体の数（話ごとのPVは無い）---
  const なろうの日ごと = {};
  [
    [9, 17, 3, 12],
    [9, 18, 1, 4],
    [9, 19, 5, 20],
    [9, 20, 2, 8],
    [9, 21, 0, 0],
    [9, 22, 4, 16],
    [9, 23, 2, 6],
  ].forEach(([月, 日, bookmarks, narou_ratingPoints]) => {
    なろうの日ごと[日の鍵(月, 日)] = { at: 時(月, 日, 20), metrics: { bookmarks, narou_ratingPoints } };
  });
  const なろうの記録 = [
    [9, 18, 1216, 390, 48],
    [9, 20, 1250, 396, 50],
    [9, 23, 1284, 402, 52],
  ].map(([月, 日, points, bookmarks, narou_raters]) => ({
    date: 日の鍵(月, 日),
    readAt: 時(月, 日, 20, 40),
    metrics: { points, bookmarks, narou_raters },
  }));
  const なろうの最後 = 時(9, 23, 20, 40);

  const いまの数 = (readAt, 数) => {
    const out = {};
    for (const [k, value] of Object.entries(数)) out[k] = { value, readAt };
    return out;
  };

  const 記録 = {
    version: 1,
    works: [
      {
        siteId: "kakuyomu",
        site: "kakuyomu",
        workId: カクヨムの作品,
        lastReadAt: 最後,
        latest: いまの数(最後, { pv: 15868, bookmarks: 318, points: 742, reviews: 21, likes: 1905, comments: 146 }),
        snapshots: カクヨムの記録,
        daily: カクヨムの日ごと,
        monthly: { "2026-09": { at: 最後, metrics: { pv: 9214 } } },
        episodes: 話ごと,
      },
      {
        siteId: "narouFun",
        site: "narou",
        workId: なろうの作品,
        lastReadAt: なろうの最後,
        latest: いまの数(なろうの最後, {
          points: 1284,
          bookmarks: 402,
          narou_ratingPoints: 480,
          narou_raters: 52,
          reviews: 3,
          comments: 28,
          narou_weeklyReaders: 610,
        }),
        snapshots: なろうの記録,
        daily: なろうの日ごと,
        monthly: {},
        episodes: {},
      },
    ],
  };

  const History = globalThis.NPHHistory;
  const Stash = globalThis.NPHStash;
  const 空の溜まり = { pages: 0, works: 0, entries: 0 };

  /** 裏方（background.js の 説明のページの頼み）の代わりの返事。形は本物に揃える */
  const 返事 = {
    "options-report": () => ({
      ok: true,
      text: History.formatReport(記録, 覚えた作品, 今),
      works: 覚えた作品.length,
      limits: History.HISTORY_LIMITS,
    }),
    "options-status": () => ({
      ok: true,
      items: [],
      summary: 空の溜まり,
      handed: null,
      ownWorks: 覚えた作品,
      pending: null,
      limits: Stash.LIMITS,
      // 新しく入れた方と同じ、切った状態で撮る（ストアから入れた方が最初に見る画面）
      handToIde: false,
    }),
  };

  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: 問い.get("v") || "" }),
      sendMessage: async (依頼) => {
        const 作る = 依頼 && 返事[依頼.type];
        return 作る ? 作る() : { ok: false };
      },
    },
  };

  /**
   * 撮る画面の大きさ（`?w=`・`?h=`。CSS の px）。
   *
   * 新しいヘッドレスのブラウザは、窓の大きさ（--window-size）から枠のぶんを引いた幅でページを組むのに、
   * 撮る絵は窓の大きさのまま（Edge 153 で、1024×640 を頼んで組まれた幅は 994×546 だった）。
   * そのままだと本文が左へ寄り、下の端の位置も狂うので、ページの幅を撮る絵の幅に合わせる。
   */
  const 幅 = Number(問い.get("w")) || 0;
  const 高さ = Number(問い.get("h")) || window.innerHeight;
  if (幅 > 0) {
    document.documentElement.style.width = `${幅}px`;
  }

  /**
   * 撮る位置へ送る（`?at=` に CSS の選び方、`?shift=` にそこからさらに下へ送る px を渡す。
   * 集計は1つの <pre> なので、続きを撮るときは px で送る）。options.js が裏方の返事を欄へ入れ終えてから
   * 動かしたいので、読み込みが済んで少し待ってからにする（撮る側は仮想の時計を進めてから撮る）。
   *
   * 巻き物を送る（scrollTo）のではなく、ページ全体を上へずらす。ヘッドレスのブラウザの撮影は、
   * 送った位置を撮らずに真っ白な絵を返した（Edge 153 で実際にそうなった）。
   */
  const 位置 = 問い.get("at");
  if (位置) {
    window.addEventListener("load", () => {
      setTimeout(() => {
        const 的 = document.querySelector(位置);
        if (!的) {
          return;
        }
        // 送り過ぎて下に白い所が出ないよう、ページの終わりで止める
        const 送る = Math.min(
          的.getBoundingClientRect().top - 12 + (Number(問い.get("shift")) || 0),
          document.documentElement.scrollHeight - 高さ
        );
        document.body.style.marginTop = `${-Math.max(0, 送る)}px`;
      }, 300);
    });
  }
})();
