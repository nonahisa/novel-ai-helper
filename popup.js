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
 * **開いた瞬間にタブのURLを見て**（common/pageState.js）、使えないほうの
 * ボタンを押せなくし、理由を各ボタンの下へ1行出す。**これは見た目の親切であって、
 * 守りではない**——押したあとの確かめ（checkTarget・matchReadPage・guard.js）は
 * 1つも外していない。見立てが外れても、間違った場所へは貼り込まれない。
 *
 * ここにも通信のコードは無い（6.79.2-1）。読むのはクリップボードとタブのURLだけ。
 */
(function () {
  const Envelope = globalThis.NPHEnvelope;
  const Match = globalThis.NPHMatch;
  const Messages = globalThis.NPHMessages;
  const PageState = globalThis.NPHPageState;
  const Sites = globalThis.NPHSites;
  const StatsSites = globalThis.NPHStatsSites;

  const button = document.getElementById("fill");
  const statsButton = document.getElementById("copyStats");
  const status = document.getElementById("status");
  const fillReason = document.getElementById("fillReason");
  const statsReason = document.getElementById("statsReason");

  /*
    版を見出しの脇へ入れる（作者の依頼、2026-09-22）。**manifest から読む**
    ——ここへ書き写すと、版を上げた日に画面だけが古い版を言い続ける。
    入れ直しが効いたかどうかは、この字が変わるかで分かる。
  */
  const versionSlot = document.getElementById("version");
  if (versionSlot && chrome.runtime && chrome.runtime.getManifest) {
    const 版 = chrome.runtime.getManifest().version;
    if (版) versionSlot.textContent = "v" + 版;
  }

  function show(text, kind) {
    status.textContent = text;
    status.className = "status" + (kind ? " " + kind : "");
  }

  /**
   * 開いた瞬間に当てた画面の見立て（common/pageState.js）。
   * **null は「まだ当てていない／当てられなかった」**で、そのときは両方押せるままにする
   * ——押せなくして黙るより、押させて既存の守りに理由を言わせるほうが作者は困らない。
   */
  let 見立て = null;

  /** 見立てどおりにボタンの可否を戻す。処理が終わるたびにここへ帰る。 */
  function 見立てどおりにする() {
    if (!見立て) {
      button.disabled = false;
      statsButton.disabled = false;
      return;
    }
    button.disabled = !見立て.canFill;
    statsButton.disabled = !見立て.canReadStats;
  }

  /**
   * どちらのボタンも、処理のあいだは両方とも押せなくする（二重に走らせない）。
   * 戻すときは**一律に押せるようにしない**——使えない画面のボタンが、
   * 1回押したあとだけ押せるようになってしまう。
   */
  function 押せなくする(とめる) {
    if (とめる) {
      button.disabled = true;
      statsButton.disabled = true;
      return;
    }
    見立てどおりにする();
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

  /**
   * 開いた瞬間に、いまのタブのURLから2つのボタンの可否と理由を決める。
   *
   * 判定そのものは describePage に全部ある。ここは**結果を画面へ写すだけ**
   * ——条件をここにも書くと、2か所が食い違った日に、理由と可否が別々のことを言い出す。
   */
  async function 画面を見立てる() {
    const tab = await activeTab();
    見立て = PageState.describePage((tab && tab.url) || "", Sites.SITES, StatsSites.STATS_SITES);
    const 理由 = Messages.messageForPageState(見立て);
    fillReason.textContent = 理由.fill;
    statsReason.textContent = 理由.stats;
    見立てどおりにする();
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

  // 見立てが付かなくても（タブのURLが読めない等）、ボタンは押せるままにしておく。
  // 押したときの確かめは、これまでとまったく同じに残してある。
  画面を見立てる().catch((e) => {
    show(`開いている画面を見られませんでした（${e && e.message}）。`, "ng");
  });
})();
