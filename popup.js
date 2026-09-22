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
  const StatsSites = globalThis.NPHStatsSites;

  const button = document.getElementById("fill");
  const statsButton = document.getElementById("copyStats");
  const status = document.getElementById("status");

  function show(text, kind) {
    status.textContent = text;
    status.className = "status" + (kind ? " " + kind : "");
  }

  /** どちらのボタンも、処理のあいだは両方とも押せなくする（二重に走らせない）。 */
  function 押せなくする(とめる) {
    button.disabled = とめる;
    statsButton.disabled = とめる;
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
  function askPage(tabId, request, 届かないときの文) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, request, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, message: 届かないときの文 });
          return;
        }
        resolve(response);
      });
    });
  }

  async function run() {
    押せなくする(true);
    show("クリップボードを読んでいます…");

    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      show(
        `クリップボードを読めませんでした（${e && e.message}）。ブラウザの許可を確認してください。`,
        "ng"
      );
      押せなくする(false);
      return;
    }

    const parsed = Envelope.parseEnvelope(text);
    if (!parsed.ok) {
      show(Messages.messageForEnvelope(parsed), "ng");
      押せなくする(false);
      return;
    }
    const envelope = parsed.envelope;

    const tab = await activeTab();
    if (!tab || !tab.id) {
      show("いま開いているタブが分かりませんでした。投稿画面のタブを選んでから押してください。", "ng");
      押せなくする(false);
      return;
    }

    const target = Match.checkTarget(envelope, tab.url || "", Sites.SITES);
    if (!target.ok) {
      show(Messages.messageForMatch(target), "ng");
      押せなくする(false);
      return;
    }

    const label = envelope.title === "" ? "（題なし）" : envelope.title;
    show(`「${label}」（本文 ${envelope.body.length} 字）を貼り込んでいます…`);

    const result = await askPage(tab.id, { type: "fill", envelope }, Messages.PAGE.notReady);
    // 作品IDを突き合わせられなかったときは、結果の前に但し書きを付ける
    // （「照合したうえで貼り込んだ」と受け取られると、取り違えに気づけない）。
    const 但し書き = target.workIdChecked ? "" : Messages.PAGE.workIdUnchecked;
    show(但し書き + result.message, result.ok ? "ok" : "ng");
    押せなくする(false);
  }

  /**
   * 読者の反応を読んでコピーする（設計書6.79.7）。貼り込みとは向きが逆で、
   *
   *   開いている画面が読める管理画面か確かめる → ページ側（content/read.js）へ
   *   「読んで」と伝える → 返ってきた封筒をクリップボードへ置く
   *
   * 合わない画面にはメッセージすら送らないのは貼り込みと同じ。**行き先は
   * クリップボードだけ**で、どこにも保存しないし、どこへも送らない。
   */
  async function runStats() {
    押せなくする(true);

    const tab = await activeTab();
    if (!tab || !tab.id) {
      show("いま開いているタブが分かりませんでした。管理画面のタブを選んでから押してください。", "ng");
      押せなくする(false);
      return;
    }

    const 場所 = StatsSites.matchReadPage(tab.url || "", StatsSites.STATS_SITES);
    if (!場所.ok) {
      show(Messages.messageForStatsRead(場所), "ng");
      押せなくする(false);
      return;
    }

    show(Messages.STATS.copying);
    const result = await askPage(tab.id, { type: "read" }, Messages.STATS.notReady);
    if (!result.ok) {
      // ページ側が届かなかったときだけ message が入っている（それ以外は理由を文にする）
      show(result.message || Messages.messageForStatsRead(result), "ng");
      押せなくする(false);
      return;
    }

    try {
      await navigator.clipboard.writeText(result.json);
    } catch (e) {
      show(Messages.STATS.clipboardFailed(e && e.message), "ng");
      押せなくする(false);
      return;
    }
    // 次のページがあるときは、そのことも伝える（アクセス数は50話ずつのページ送り）。
    // ここに入るのは真偽だけで、封筒（クリップボードへ置いたJSON）には入っていない。
    show(Messages.messageForStatsCopied(result.counts, result.hasNextPage), "ok");
    押せなくする(false);
  }

  button.addEventListener("click", () => {
    run().catch((e) => {
      show(`思わぬ問題が起きました：${e && e.message}`, "ng");
      押せなくする(false);
    });
  });

  statsButton.addEventListener("click", () => {
    runStats().catch((e) => {
      show(`思わぬ問題が起きました：${e && e.message}`, "ng");
      押せなくする(false);
    });
  });
})();
