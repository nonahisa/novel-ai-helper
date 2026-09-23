"use strict";

/**
 * 「このページが開いた」とだけ、拡張の裏方（background.js）へ知らせる（0.8.0）。
 *
 * アイコンに印（貼・読）を付けるには、裏方がタブのURLを知る必要がある。
 * タブのURLを常に読める `tabs` 権限は**足さない**と決めた（全部のタブのURLが読めてしまう）。
 * 代わりに、manifest の matches に書いたページ——この拡張が入るページ——だけから、
 * 開いたことを知らせる。知らせの送り手のURLは Chrome が添えるので、ここではURLすら送らない。
 *
 * ## 守っていること
 *
 * - **ページの中身を読まない・書かない。** 文字も欄も見ない。知らせるのは「開いた」だけ
 * - **見張らない。** 開いたときに1回知らせるだけで、ページの変化を追い続けない
 * - 知らせを受けても、裏方は**貼り込まない**（貼り込みは、作者がアイコンか右クリックの項目を押したときだけ）
 * - 0.9.0 から、**ご自分の作品の読者の反応の画面**のときだけ、裏方がこの知らせを受けて読み取り係
 *   （content/read.js）へ1回だけ「読んで」と頼み、拡張の中へ溜める（作者の依頼「開いたら自動で溜める」）。
 *   誰の作品か分からない画面（まだ覚えていない Nコードなど）では頼まない。このファイル自身は何も読まない
 */
(function () {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "page-opened" }, () => {
      // 裏方が返事をしないのはふつうのこと。「返事が無い」の警告を読んで捨てる
      void chrome.runtime.lastError;
    });
  } catch (_e) {
    // 拡張を入れ直した直後の古いページでは、知らせる先がもう無い。印が付かないだけで害は無い
  }

  /*
    タブを切り替えたとき、裏方が「このタブはどのページか」を尋ねてくる（右クリックの項目を
    そのタブに合わせるため）。答えるのはこのページのURLだけ——アドレス欄に出ているものと同じ。
  */
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!request || request.type !== "where") {
      return false;
    }
    sendResponse({ url: location.href });
    return false;
  });
})();
