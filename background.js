"use strict";

/**
 * 拡張の裏方（Manifest V3 の service worker。0.8.0）。
 *
 * 0.7.x まではポップアップが全部をしていた。作者の依頼（2026-09-23）で、
 * **アイコンを押す（または右クリックの項目を選ぶ）だけで、いまの画面でできる1つのことを実行する**
 * 形に変えたので、その流れをここへ移した。
 *
 *   アイコン・右クリック → いまのタブのURLで、できることを決める（common/actions.js）
 *     → 貼り込み：クリップボードを読む → 封筒か確かめる → 開いている画面と照合する
 *                 → ページ側（content/fill.js）へ「埋めて」と伝える → 結果を知らせる
 *     → 読み取り：読める画面か確かめる → ページ側（content/read.js）へ「読んで」と伝える
 *                 → 返ってきた封筒をクリップボードへ置く → 知らせる → VS Code を呼ぶ
 *
 * 照合（checkTarget・matchReadPage）をページ側でなくここで行うのは 0.7.x と同じ理由で、
 * **合わないページにはそもそも触れない**ため。合わなければメッセージすら送らない。
 *
 * ## ここにも通信のコードは無い
 *
 * 読むのはクリップボードとタブのURLだけ。VS Code を呼ぶのは、手元の VS Code を
 * `vscode://` のリンクで前に出すだけで、どこのサーバーへも何も送らない（データはリンクに載せない）。
 *
 * 表と判定は、ページ側・拡張のページと**同じファイル**を読む（写しを作らない）。
 * 読む順番は 0.7.x の popup.html と同じ（describePage が両方の表を使うため、表の2つが先）。
 */
importScripts(
  "common/messages.js",
  "common/envelope.js",
  "common/match.js",
  "content/sites.js",
  "content/statsSites.js",
  "common/pageState.js",
  "common/actions.js"
);

const Envelope = globalThis.NPHEnvelope;
const Match = globalThis.NPHMatch;
const Messages = globalThis.NPHMessages;
const PageState = globalThis.NPHPageState;
const Sites = globalThis.NPHSites;
const StatsSites = globalThis.NPHStatsSites;
const Actions = globalThis.NPHActions;

/** 右クリックの項目は1つだけ。名前と出す・出さないを、いまのタブに合わせて付け替える。 */
const MENU_ID = "novelai-helper-run";

function 見立てる(url) {
  return PageState.describePage(url || "", Sites.SITES, StatsSites.STATS_SITES);
}

// ---------------------------------------------------------------------------
// 知らせ（chrome.notifications）
// ---------------------------------------------------------------------------

/**
 * 押した結果を、Chrome の知らせで出す（作者の裁定、2026-09-23「終わったら通知」）。
 * ページの中には何も出さない——ページへHTMLを差し込まないのが約束だから。
 */
function 知らせる(kind, ok, message) {
  const 知らせ = Messages.notificationFor(kind, ok, message);
  try {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: 知らせ.title,
        message: 知らせ.message,
        contextMessage: Messages.APP_NAME,
        priority: 0,
      },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 知らせが出せなくても、貼り込み・読み取りそのものは済んでいる（画面で確かめられる）
  }
}

// ---------------------------------------------------------------------------
// クリップボード（画面に出ない拡張のページ offscreen.html に頼む）
// ---------------------------------------------------------------------------

const 受け渡しのページ = "offscreen.html";

async function 受け渡しのページがあるか() {
  if (chrome.runtime.getContexts) {
    const ある = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(受け渡しのページ)],
    });
    return ある.length > 0;
  }
  return false;
}

/**
 * クリップボードの読み書きを頼む。**終わったらページを閉じる**
 * ——開けたままにしておく理由が無く、残しておけば「どこかに溜まっている」ように見える。
 */
async function クリップボードに頼む(依頼) {
  if (!(await 受け渡しのページがあるか())) {
    await chrome.offscreen.createDocument({
      url: 受け渡しのページ,
      reasons: ["CLIPBOARD"],
      justification: "統合小説執筆環境とのあいだで、原稿と読者の反応をクリップボードで受け渡すため",
    });
  }
  try {
    const 返事 = await chrome.runtime.sendMessage(Object.assign({ target: "offscreen-clipboard" }, 依頼));
    return 返事 || { ok: false, detail: "返事がありませんでした" };
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_e) {
      // もう閉じている
    }
  }
}

// ---------------------------------------------------------------------------
// ページ側へ頼む
// ---------------------------------------------------------------------------

/**
 * ページ側（content script）へ依頼する。content script が動いていない（拡張を入れた直後で
 * ページを読み直していない等）ときは、応答が返らないので null を返す。
 */
function ページへ頼む(tabId, request) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, request, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (_e) {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// 実行（アイコン・右クリック）
// ---------------------------------------------------------------------------

/**
 * クリップボードの受け渡しのページは1つしか開けないので、前の分が済むまで次を受けない。
 * （0.7.x のポップアップが、処理中にボタンを押せなくしていたのと同じ役目）
 */
let 処理中 = false;

async function 貼り込む(tab, url) {
  const 読めた = await クリップボードに頼む({ type: "read" });
  if (!読めた.ok) {
    知らせる("fill", false, Messages.clipboardReadFailed(読めた.detail));
    return;
  }

  const parsed = Envelope.parseEnvelope(読めた.text);
  if (!parsed.ok) {
    知らせる("fill", false, Messages.messageForEnvelope(parsed));
    return;
  }
  const envelope = parsed.envelope;

  const target = Match.checkTarget(envelope, url, Sites.SITES);
  if (!target.ok) {
    知らせる("fill", false, Messages.messageForMatch(target));
    return;
  }

  // 結果は、ページ側が終わったあとに "fill-result" で届く（下の受け口）。
  // ここで待たないのは、確認のダイアログのあいだに裏方が止められても、結果を取りこぼさないため
  const 受けた = await ページへ頼む(tab.id, {
    type: "fill",
    envelope,
    workIdChecked: target.workIdChecked === true,
  });
  if (!受けた || 受けた.accepted !== true) {
    知らせる("fill", false, Messages.PAGE.notReady);
  }
}

async function 読み取る(tab, url) {
  const 場所 = StatsSites.matchReadPage(url, StatsSites.STATS_SITES);
  if (!場所.ok) {
    知らせる("stats", false, Messages.messageForStatsRead(場所));
    return;
  }

  const result = await ページへ頼む(tab.id, { type: "read" });
  if (!result) {
    知らせる("stats", false, Messages.STATS.notReady);
    return;
  }
  if (!result.ok) {
    知らせる("stats", false, Messages.messageForStatsRead(result));
    return;
  }

  // 行き先はクリップボードだけ。どこにも保存しないし、どこへも送らない
  const 置けた = await クリップボードに頼む({ type: "write", text: result.json });
  if (!置けた.ok) {
    知らせる("stats", false, Messages.STATS.clipboardFailed(置けた.detail));
    return;
  }
  // 次のページがあるときは、そのことも伝える（アクセス数は50話ずつのページ送り）。
  // ここに入るのは真偽だけで、封筒（クリップボードへ置いたJSON）には入っていない
  知らせる(
    "stats",
    true,
    Messages.messageForStatsCopied(result.counts, result.hasNextPage, result.nextPageKind)
  );

  const リンク = Actions.vscodeLinkAfter({ kind: "stats", copied: true });
  if (リンク) {
    VSCodeを呼ぶ(tab.id, リンク);
  }
}

/**
 * 統合小説執筆環境（VS Code）を前に出す（作者の裁定、2026-09-23）。
 *
 * **いまのタブを `vscode://` へ向ける**（chrome.tabs.update）。`vscode://` のように
 * Chrome が自分では開かない種類のリンクは、Chrome が手元のアプリ（VS Code）へ渡すだけで、
 * タブの中のページは入れ替わらない——アドレス欄に手で `mailto:` を打ったときと同じで、
 * 読み取った画面はそのまま残る。新しいタブも窓も開かない。
 *
 * 画面に出ない拡張のページ（offscreen.html）からは開けない。Chrome は、作者が押した操作の
 * 流れに無いページから手元のアプリを呼ぶことを断るため。
 *
 * 呼ぶのは読み取りのあとだけ（actions.js の vscodeLinkAfter）——投稿画面（書きかけの原稿の
 * あるページ）では呼ばない。「このページを離れますか」の確認を出すページがあっても、
 * 読者の反応の画面はそういう作りではない。
 */
function VSCodeを呼ぶ(tabId, リンク) {
  try {
    chrome.tabs.update(tabId, { url: リンク }, () => void chrome.runtime.lastError);
  } catch (_e) {
    // 呼べなくても、読者の反応はクリップボードにある（「読者の反応を貼り付けて取り込む」で入る）
  }
}

async function 実行する(tab, 予備のURL) {
  if (処理中) {
    知らせる("busy", false, Messages.busy);
    return;
  }
  処理中 = true;
  let kind = null;
  try {
    // activeTab（アイコン・右クリックを押した瞬間に与えられる）で、このタブのURLが読める
    const url = (tab && tab.url) || 予備のURL || "";
    const 見立て = 見立てる(url);
    kind = Actions.actionForPage(見立て).kind;
    if (!tab || typeof tab.id !== "number" || kind === null) {
      知らせる(null, false, Messages.messageForNothingHere(見立て));
      return;
    }
    if (kind === "fill") {
      await 貼り込む(tab, url);
    } else {
      await 読み取る(tab, url);
    }
  } catch (e) {
    知らせる(kind || "error", false, Messages.unexpected(e && e.message));
  } finally {
    処理中 = false;
  }
}

chrome.action.onClicked.addListener((tab) => {
  実行する(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }
  実行する(tab, info.pageUrl);
});

// ---------------------------------------------------------------------------
// アイコンの印と、右クリックの項目
// ---------------------------------------------------------------------------

/**
 * タブにアイコンの印を付ける（外す）。タブごとに付けるので、ほかのタブの印は変わらない。
 * Chrome は、タブが別のページへ移ると、そのタブの印を自分で外す。
 */
async function 印を付ける(tabId, url) {
  const 行い = Actions.actionForPage(見立てる(url));
  try {
    await chrome.action.setBadgeText({ tabId, text: 行い.badgeText });
    if (行い.badgeColor) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: 行い.badgeColor });
    }
    await chrome.action.setTitle({ tabId, title: 行い.title });
  } catch (_e) {
    // タブがもう閉じている
  }
}

/** 右クリックの項目を、いま選ばれているタブのページに合わせる（できることが無ければ隠す）。 */
function 右クリックを合わせる(url) {
  const 行い = Actions.actionForPage(見立てる(url));
  try {
    chrome.contextMenus.update(
      MENU_ID,
      { title: 行い.title, visible: 行い.kind !== null },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 項目がまだ作られていない（入れた直後の一瞬）
  }
}

/**
 * タブのURLを知る。`tabs` 権限を足さないので、Chrome が教えてくれないことがある。
 * そのときは、そのページに入っている content/announce.js に尋ねる
 * （入っていない＝この拡張の入らないページなので、できることは無い）。
 */
async function タブのURL(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      return tab.url;
    }
  } catch (_e) {
    return "";
  }
  const 返事 = await ページへ頼む(tabId, { type: "where" });
  return 返事 && typeof 返事.url === "string" ? 返事.url : "";
}

async function 選ばれたタブに合わせる(tabId) {
  右クリックを合わせる(await タブのURL(tabId));
}

// ページが開いた（content/announce.js）・貼り込みが終わった（content/fill.js）の知らせ
chrome.runtime.onMessage.addListener((request, sender) => {
  // この拡張のページ側からの知らせだけを受ける。クリップボードの受け渡しの宛先は素通り
  if (!request || !sender || sender.id !== chrome.runtime.id || !sender.tab) {
    return false;
  }
  if (request.type === "page-opened") {
    印を付ける(sender.tab.id, sender.url);
    if (sender.tab.active) {
      右クリックを合わせる(sender.url);
    }
    return false;
  }
  if (request.type === "fill-result" && request.result) {
    // 作品IDを突き合わせられなかったときは、結果の前に但し書きを付ける
    // （「照合したうえで貼り込んだ」と受け取られると、取り違えに気づけない）
    const 但し書き = request.workIdChecked === true ? "" : Messages.PAGE.workIdUnchecked;
    知らせる("fill", request.result.ok === true, 但し書き + (request.result.message || ""));
    return false;
  }
  return false;
});

// 同じ作品サイトの中で、ページを読み直さずにURLだけが変わったとき
// （Chrome がURLを教えてくれるのは、この拡張の入るページのときだけ）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url !== "string") {
    return;
  }
  印を付ける(tabId, changeInfo.url);
  if (tab && tab.active) {
    右クリックを合わせる(changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  選ばれたタブに合わせる(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0] || typeof tabs[0].id !== "number") {
      return;
    }
    選ばれたタブに合わせる(tabs[0].id);
  });
});

// ---------------------------------------------------------------------------
// 入れたとき
// ---------------------------------------------------------------------------

/**
 * 右クリックの項目は、この拡張の入るページ（manifest の matches）にだけ出す。
 * いまのタブに合わせた付け替えが遅れても、関係の無いサイトで項目が出ることは無い。
 * 範囲は manifest から読む——ここへ書き写すと、ページの範囲を直した日に食い違う。
 */
function 入るページの範囲() {
  const 設定 = chrome.runtime.getManifest();
  return (設定.content_scripts || []).flatMap((c) => c.matches || []);
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: Messages.APP_NAME,
        contexts: ["page", "selection", "editable", "link", "image"],
        documentUrlPatterns: 入るページの範囲(),
        // いまのタブが分かるまでは出さない（ページが開いた知らせで付け替える）
        visible: false,
      },
      () => void chrome.runtime.lastError
    );
  });
  // 「この拡張がしないこと」と使い方は、入れた直後に1回だけ見せる（更新のたびには開かない）
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});
