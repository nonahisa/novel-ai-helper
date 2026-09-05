"use strict";

/**
 * ポップアップ。作者がボタンを押したときだけ、次の順で進む。
 *
 *   クリップボードを読む → 封筒か確かめる → 開いている画面と照合する
 *   → ページ側（content/fill.js）へ「埋めて」と伝える
 *
 * 照合（設計書6.79.6-2）をページ側でなくここで行うのは、**合わないページには
 * そもそも触れない**ようにするため。合わなければメッセージすら送らない。
 *
 * ここにも通信のコードは無い（6.79.2-1）。読むのはクリップボードとタブのURLだけ。
 */
(function () {
  const Envelope = globalThis.NPHEnvelope;
  const Match = globalThis.NPHMatch;
  const Messages = globalThis.NPHMessages;
  const Sites = globalThis.NPHSites;

  const button = document.getElementById("fill");
  const status = document.getElementById("status");

  function show(text, kind) {
    status.textContent = text;
    status.className = "status" + (kind ? " " + kind : "");
  }

  /** いま選ばれているタブ。activeTab 権限は、この popup を開いたときに与えられる。 */
  function activeTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  /**
   * ページ側へ依頼する。content script が動いていない（拡張を入れた直後で
   * ページを読み直していない等）ときは、応答が返らないので、その旨を伝える。
   */
  function askPage(tabId, envelope) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "fill", envelope }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, message: Messages.PAGE.notReady });
          return;
        }
        resolve(response);
      });
    });
  }

  async function run() {
    button.disabled = true;
    show("クリップボードを読んでいます…");

    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      show(
        `クリップボードを読めませんでした（${e && e.message}）。ブラウザの許可を確認してください。`,
        "ng"
      );
      button.disabled = false;
      return;
    }

    const parsed = Envelope.parseEnvelope(text);
    if (!parsed.ok) {
      show(Messages.messageForEnvelope(parsed), "ng");
      button.disabled = false;
      return;
    }
    const envelope = parsed.envelope;

    const tab = await activeTab();
    if (!tab || !tab.id) {
      show("いま開いているタブが分かりませんでした。投稿画面のタブを選んでから押してください。", "ng");
      button.disabled = false;
      return;
    }

    const target = Match.checkTarget(envelope, tab.url || "", Sites.SITES);
    if (!target.ok) {
      show(Messages.messageForMatch(target), "ng");
      button.disabled = false;
      return;
    }

    const label = envelope.title === "" ? "（題なし）" : envelope.title;
    show(`「${label}」（本文 ${envelope.body.length} 字）を貼り込んでいます…`);

    const result = await askPage(tab.id, envelope);
    // 作品IDを突き合わせられなかったときは、結果の前に但し書きを付ける
    // （「照合したうえで貼り込んだ」と受け取られると、取り違えに気づけない）。
    const 但し書き = target.workIdChecked ? "" : Messages.PAGE.workIdUnchecked;
    show(但し書き + result.message, result.ok ? "ok" : "ng");
    button.disabled = false;
  }

  button.addEventListener("click", () => {
    run().catch((e) => {
      show(`思わぬ問題が起きました：${e && e.message}`, "ng");
      button.disabled = false;
    });
  });
})();
