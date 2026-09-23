"use strict";

/**
 * 公募の一覧の読み取り係（content script。0.12.0）。
 *
 * ノベルポータル・ツクリテミライの公募の一覧のページで、作者がアイコン（または右クリックの項目）を
 * 押したときだけ、並んでいる公募を1件ずつ読んで、統合小説執筆環境へ渡す形（`novelai-contests` v1）にする。
 * 読むページ・枠・名前・リンクの場所は content/contestSites.js の表にある。
 *
 * ## 守っていること
 *
 * 1. **裏方に頼まれたときだけ、1回だけ動く。** 下でメッセージの受け口を登録するだけで、
 *    ページを見張らない（MutationObserver も setInterval も無い）。開いただけでは読まない
 * 2. **HTTPを1本も発しない。** 次のページへ自動で進まない（ツクリテミライのページ送りは作者が押す）
 * 3. **ページのどこにも書かない。** DOMを1文字も変えない
 * 4. **読むのは公募の枠の中だけ**（名前・締切・賞典・字数…の並んだ枠）。枠の外の文（記事・コメント・
 *    ランキング）は読まない。1件の長さにも上限を掛ける
 * 5. **読んだものの行き先はクリップボードだけ**（裏方が受け渡しのページで置く）。拡張の中に溜めない
 *
 * 1件ずつの**中身の読み分け（締切・字数…）はここでしない。** 統合小説執筆環境が、作者が
 * ページの文を貼り付けたときと**同じ読み取り**で読む——2か所で読むと、片方を直した日に食い違う。
 *
 * テストから読めるように、判定は readContests(doc, url, now) として外へ出してある
 * （作り物のDOMで、封筒が組めることを test/contestRead.test.js が見る）。
 */
(function (global) {
  /** 封筒の目印と版（統合小説執筆環境の core/contestListing.ts と揃える）。 */
  const MARKER = "novelai-contests";
  const ENVELOPE_VERSION = 1;

  /** 1件・名前・見出しの長さの上限（それより長い分は切る。ページ全体を流し込まない） */
  const 上限 = { text: 4000, name: 200, section: 100 };
  /** 1回に読む件数の上限（統合小説執筆環境が受ける数と揃える） */
  const 件数の上限 = 500;

  function 部品() {
    return { Sites: global.NPHContestSites };
  }

  /** querySelectorAll を配列で返す（作り物のDOMでも同じ形で扱えるように）。 */
  function 要素たち(root, selector) {
    try {
      const 一覧 = root.querySelectorAll(selector);
      return 一覧 ? Array.from(一覧) : [];
    } catch (_e) {
      return [];
    }
  }

  function 最初の要素(root, selector) {
    return 要素たち(root, selector)[0] || null;
  }

  /**
   * 枠の文を読む。改行の残る innerText を先に使う（締切・賞典…が1行ずつ並ぶ）。
   * 畳まれて見えていない枠は innerText でも改行が付かないが、統合小説執筆環境は
   * 欄の名前（締切：・賞典：…）で区切って読むので、1行でも読める。
   */
  function 枠の文(el, 長さ) {
    if (!el) {
      return "";
    }
    const raw = typeof el.innerText === "string" ? el.innerText : el.textContent;
    const text = typeof raw === "string" ? raw.trim() : "";
    return text.length > 長さ ? text.slice(0, 長さ) : text;
  }

  function 一行(el, 長さ) {
    return 枠の文(el, 長さ).replace(/\s+/g, " ").trim();
  }

  /** リンクの行き先。**http・https だけ**（それ以外は持たない）。相対の書き方はページのURLから組む。 */
  function 行き先(a, pageUrl) {
    if (!a || !a.getAttribute) {
      return null;
    }
    const href = a.getAttribute("href");
    if (!href) {
      return null;
    }
    try {
      const u = new URL(href, pageUrl);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch (_e) {
      return null;
    }
  }

  /** その土地の時差つきの日時（統合小説執筆環境の「○月○日時点の情報」が日付をずらさないように）。 */
  function 時差つき(now) {
    const d = now instanceof Date ? now : new Date();
    const 二桁 = (n, w) => String(n).padStart(w || 2, "0");
    const ずれ = -d.getTimezoneOffset();
    const 符号 = ずれ >= 0 ? "+" : "-";
    const 絶対 = Math.abs(ずれ);
    return (
      `${d.getFullYear()}-${二桁(d.getMonth() + 1)}-${二桁(d.getDate())}` +
      `T${二桁(d.getHours())}:${二桁(d.getMinutes())}:${二桁(d.getSeconds())}.${二桁(d.getMilliseconds(), 3)}` +
      `${符号}${二桁(Math.floor(絶対 / 60))}:${二桁(絶対 % 60)}`
    );
  }

  /**
   * 見出しごとに、どの枠がその下にあるか（「2026年10月締切」「カクヨム」）。
   * 見出しと枠を**ページの並び順**で一度に取り、直前の見出しを添える。
   */
  function 見出しの対応(doc, site) {
    const 対応 = new Map();
    if (!site.section) {
      return 対応;
    }
    let いまの見出し = null;
    for (const el of 要素たち(doc, `${site.section},${site.card}`)) {
      if (String(el.tagName || "").toLowerCase() === site.section) {
        いまの見出し = 一行(el, 上限.section) || null;
      } else {
        対応.set(el, いまの見出し);
      }
    }
    return 対応;
  }

  /**
   * 公募の一覧を読む。
   *
   * @param {object} doc ページ（document、テストでは作り物）
   * @param {string} url いまのページのURL
   * @param {Date} [now]
   * @returns {{ok:true, envelope:string, count:number, skipped:number, siteId:string, paged:boolean}
   *          |{ok:false, reason:"not-contest-page"|"no-cards"}}
   *   count は渡す件数、skipped は枠はあったが名前を読めなかった数（数を黙って減らさない）
   */
  function readContests(doc, url, now) {
    const { Sites } = 部品();
    const 場所 = Sites.matchContestPage(url, Sites.CONTEST_SITES);
    if (!場所.ok) {
      return { ok: false, reason: "not-contest-page" };
    }
    const site = 場所.site;
    const 枠たち = 要素たち(doc, site.card);
    if (枠たち.length === 0) {
      // 読み込み中・ページの作りが変わった。0件を「渡した」にしない
      return { ok: false, reason: "no-cards" };
    }
    const 見出し = 見出しの対応(doc, site);
    const items = [];
    let skipped = 0;
    for (const 枠 of 枠たち.slice(0, 件数の上限)) {
      const 名前の要素 = 最初の要素(枠, site.name);
      const name = 一行(名前の要素, 上限.name);
      if (!name) {
        skipped += 1;
        continue;
      }
      if (site.skipNames.includes(name)) {
        // 「開催予定」の表。公募ではないので数えもしない
        continue;
      }
      const リンク = 最初の要素(名前の要素, "a[href]") || 最初の要素(枠, site.link);
      items.push({
        name,
        url: 行き先(リンク, url),
        section: 見出し.get(枠) || null,
        text: 枠の文(枠, 上限.text),
      });
    }
    skipped += Math.max(0, 枠たち.length - 件数の上限);
    if (items.length === 0) {
      return { ok: false, reason: "no-cards" };
    }
    let pageUrl = url;
    try {
      const u = new URL(url);
      u.hash = "";
      pageUrl = u.href;
    } catch (_e) {
      // matchContestPage が読めたURLなので、ここへは来ない
    }
    const envelope = {
      [MARKER]: ENVELOPE_VERSION,
      source: site.id,
      pageUrl,
      readAt: 時差つき(now),
      items,
    };
    return {
      ok: true,
      envelope: JSON.stringify(envelope),
      count: items.length,
      skipped,
      siteId: site.id,
      paged: site.paged === true,
    };
  }

  // 裏方からの頼み（作者がアイコン・右クリックの項目を押したときだけ届く）
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (!request || request.type !== "read-contests") {
        return false;
      }
      try {
        sendResponse(readContests(document, location.href, new Date()));
      } catch (e) {
        sendResponse({ ok: false, reason: "failed", detail: String((e && e.message) || e) });
      }
      return false;
    });
  }

  const api = { MARKER, ENVELOPE_VERSION, readContests };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHContestRead = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
