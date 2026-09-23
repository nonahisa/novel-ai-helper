"use strict";

/**
 * クリップボードの受け渡し係（0.8.0）。画面に出ないページ（offscreen.html）の中で動く。
 *
 * ## なぜこのページが要るか
 *
 * 0.7.x まではポップアップ（拡張のページ）がクリップボードを読み書きしていた。
 * ポップアップを無くすと（作者の依頼、2026-09-23）、残る裏方（background.js）は
 * service worker で、クリップボードに触れる手段を持たない。Chrome が用意している道は
 * 「画面に出ない拡張のページ（chrome.offscreen）」を開き、そこで読み書きすることだけである。
 *
 * ## 守っていること
 *
 * - **投稿サイトのページには入らない。** これは拡張の中のページで、サイトのスクリプトからは見えない
 * - **どこにも溜めない。** 読み書きが終わったら欄を空にする。ページそのものも、裏方が用が済み次第閉じる
 * - 通信のコードは無い（test/redLine.test.js が見張る）
 *
 * navigator.clipboard ではなく document.execCommand を使うのは、画面に出ないページには
 * 「選ばれている（focus のある）ページ」という状態が無く、navigator.clipboard が断るため。
 * execCommand の貼り付け・コピーは、manifest の clipboardRead・clipboardWrite の権限で通る。
 */
(function () {
  const 欄 = document.getElementById("clipboard");

  /** クリップボードの文字を読む。読んだら欄は空に戻す。 */
  function 読む() {
    欄.value = "";
    欄.focus();
    const できた = document.execCommand("paste");
    const 文字 = 欄.value;
    欄.value = "";
    if (!できた) {
      return { ok: false, detail: "貼り付けの操作が断られました" };
    }
    return { ok: true, text: 文字 };
  }

  /** クリップボードへ置く。置いたら欄は空に戻す。 */
  function 置く(文字) {
    欄.value = String(文字);
    欄.select();
    const できた = document.execCommand("copy");
    欄.value = "";
    return できた ? { ok: true } : { ok: false, detail: "コピーの操作が断られました" };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 宛先がこのページのものだけを受ける。裏方の知らせ（印の付け替えなど）は素通りさせる
    if (!request || request.target !== "offscreen-clipboard") {
      return false;
    }
    // この拡張の中からの依頼だけを受ける（投稿サイトのページのスクリプトは、ここへ届かない）
    if (!sender || sender.id !== chrome.runtime.id) {
      return false;
    }
    let 結果;
    try {
      if (request.type === "read") {
        結果 = 読む();
      } else if (request.type === "write") {
        結果 = 置く(request.text);
      } else {
        結果 = { ok: false, detail: "知らない依頼です" };
      }
    } catch (e) {
      結果 = { ok: false, detail: e && e.message };
    }
    sendResponse(結果);
    return false;
  });
})();
