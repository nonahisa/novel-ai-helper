"use strict";

/**
 * アイコンから出す吹き出し（bubble.html。0.14.0）。
 *
 * 裏方（background.js）がこのページのアドレスの問い合わせの部分に、出す文言と、訊くときはページの種類と
 * タブを入れて開く。ここは文言を欄へ入れ（textContent だけ）、答えのボタンが押されたら裏方へ伝えるだけ。
 *
 * **保存には触れない**（溜まり・答えの読み書きは裏方だけ。test/redLine.test.js が見張る）。
 * 問い合わせの部分は、この拡張の中のページのアドレスで、どこへも送られない（裏方が組んだ字だけが入る）。
 */
(function () {
  const 欄 = (id) => document.getElementById(id);
  const 文言 = globalThis.NPHMessages;
  const 問い合わせ = new URLSearchParams(location.search);

  欄("title").textContent = 問い合わせ.get("title") || 文言.APP_NAME;
  欄("text").textContent = 問い合わせ.get("text") || "";

  if (問い合わせ.get("mode") !== "ask") {
    return;
  }

  const 種類 = 問い合わせ.get("key") || "";
  const タブ = Number(問い合わせ.get("tab"));
  const ボタン = { auto: 欄("answer-auto"), manual: 欄("answer-manual") };
  ボタン.auto.textContent = 文言.AUTO_READ.BUTTONS[0];
  ボタン.manual.textContent = 文言.AUTO_READ.BUTTONS[1];
  欄("answers").hidden = false;

  async function 答える(choice) {
    ボタン.auto.disabled = true;
    ボタン.manual.disabled = true;
    let 返事 = null;
    try {
      返事 = await chrome.runtime.sendMessage({
        type: "bubble-answer",
        key: 種類,
        choice,
        tabId: Number.isSafeInteger(タブ) ? タブ : null,
      });
    } catch (_e) {
      返事 = null;
    }
    欄("answers").hidden = true;
    欄("result").textContent =
      返事 && 返事.ok
        ? 返事.message || ""
        : "答えを残せませんでした。アイコンの右クリック「集計を表示」で開くページから決めてください。";
  }

  ボタン.auto.addEventListener("click", () => 答える("auto"));
  ボタン.manual.addEventListener("click", () => 答える("manual"));
})();
