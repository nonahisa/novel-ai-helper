"use strict";

/**
 * カクヨムの作品管理の画面から、章立て（大見出しと話の並び）を読む係（content script。0.13.0）。
 *
 * 作者の問い（2026-09-23）「なろうやカクヨムのバックアップから章立ては読み取れませんでしたか？」
 * ——**カクヨムのバックアップには章が入っていない**（話ファイルの欄は題・公開状態・日時・文字数・
 * 本文だけ）。章は作品管理の画面の「大見出し」の行にだけある。そこで、作者が右クリックの項目
 * 「章立てを統合小説執筆環境へ渡す」を押したときだけ、この画面の話の並びと大見出しを読み、
 * 統合小説執筆環境へ渡す形（`novelai-chapters` v1）にする。
 *
 * ## 守っていること（読者の反応・公募の読み取り係と同じ線）
 *
 * 1. **裏方に頼まれたときだけ、1回だけ動く。** ページを見張らない。開いただけでは読まない
 * 2. **HTTPを1本も発しない。** ページのどこにも書かない（DOMを1文字も変えない）
 * 3. **読むのはご自分の作品の管理画面**（/my/works/作品ID。ログインした本人しか開けない）の、
 *    **話の題と大見出しの字だけ。** 数（PV・応援）は読まない——それは読者の反応の読み取り係の仕事
 * 4. **読んだものの行き先はクリップボードだけ**（裏方が受け渡しのページで置く）。拡張の中に溜めない
 *
 * 話数の読み分け（「１話　転生」→ 1話）は**ここでしない。** 統合小説執筆環境が、バックアップの
 * 話と同じ読み方で読む——2か所で読むと、片方を直した日に食い違う。
 *
 * ## 画面の作り（2026-09-24 時点で分かっていること）
 *
 * - 話の表は `table.episodes` が**2つ**あり、本物は PV の枡（`td.episode-feedback-pv`）を持つ行
 *   （読者の反応の読み取り係が 2026-09-22 に実機で確かめた形。content/statsSites.js）
 * - 大見出しの行は、作者の記録では「公開 大見出し 第一章『死の谷』」の並び。**行の作り（クラス名）は
 *   まだ実機で確かめていない**ので、クラス名ではなく「大見出し」の字で見分ける。見つからなければ
 *   「大見出しが見つかりません」と言って何も渡さない（違う字を章として渡さない）
 *
 * テストから読めるように、判定は readChapters(doc, url, now) として外へ出してある
 * （作り物のDOMで、封筒が組めることを test/chapterRead.test.js が見る）。
 */
(function (global) {
  /** 封筒の目印と版（統合小説執筆環境の core/chapterEnvelope.ts と揃える）。 */
  const MARKER = "novelai-chapters";
  const ENVELOPE_VERSION = 1;

  /** 題1つの長さの上限（それより長い分は切る。ページ全体を流し込まない） */
  const 題の上限 = 200;
  /** 1回に読む話の数の上限（統合小説執筆環境が受ける数と揃える） */
  const 話の上限 = 5000;

  /** 作品管理の画面（/my/works/作品ID）。話の編集画面（/my/works/…/episodes/…）は含めない */
  const 作品管理の形 = /^\/my\/works\/(\d+)\/?$/;

  /**
   * 章立てを読める画面か。**https の kakuyomu.jp の作品管理の画面だけ。**
   * @returns {{ok:true, workId:string}|{ok:false}}
   */
  function matchChapterPage(url) {
    let u;
    try {
      u = new URL(String(url));
    } catch (_e) {
      return { ok: false };
    }
    if (u.protocol !== "https:" || u.hostname !== "kakuyomu.jp") {
      return { ok: false };
    }
    const m = 作品管理の形.exec(u.pathname);
    return m ? { ok: true, workId: m[1] } : { ok: false };
  }

  function 要素たち(root, selector) {
    try {
      const 一覧 = root.querySelectorAll(selector);
      return 一覧 ? Array.from(一覧) : [];
    } catch (_e) {
      return [];
    }
  }

  function 子たち(el) {
    return el && el.children ? Array.from(el.children) : [];
  }

  /**
   * 1行にした字（改行・連続する半角の空白は1つの空白へ）。長すぎる分は切る。
   * **全角の空白は畳まない**——「１話　潮の匂い」の全角空白は作者の題の書き方である
   * （`\s` は全角空白にも当たるので使わない）
   */
  function 一行(el) {
    if (!el) {
      return "";
    }
    const raw = typeof el.innerText === "string" ? el.innerText : el.textContent;
    const text = typeof raw === "string" ? raw.replace(/[ \t\r\n\f\v]+/g, " ").trim() : "";
    return text.length > 題の上限 ? text.slice(0, 題の上限) : text;
  }

  /** 本物の話の行か（題があり、PV の枡を持つ）。控えの表の行は題も PV の枡も持たない */
  function 話の題(row) {
    const 題の枡 = 要素たち(row, "td.episode-title")[0];
    if (!題の枡 || 要素たち(row, "td.episode-feedback-pv").length === 0) {
      return null;
    }
    return 一行(題の枡) || null;
  }

  /**
   * 見出しの行なら、その種類（大見出し・中見出し）と題。違えば null。
   *
   * 枡（td）の1つが「大見出し」なら、その**次の、字のある枡**を題とみなす。枡の作りが
   * 違ったときのために、行の字の「大見出し」より後ろも見る（前後の「公開」などは題に入れない）。
   */
  function 見出し(row) {
    const 枡たち = 子たち(row);
    for (let i = 0; i < 枡たち.length; i++) {
      const 字 = 一行(枡たち[i]);
      if (字 !== "大見出し" && 字 !== "中見出し") {
        continue;
      }
      for (let j = i + 1; j < 枡たち.length; j++) {
        const 題 = 一行(枡たち[j]);
        if (題) {
          return { 種類: 字, 題 };
        }
      }
      return { 種類: 字, 題: "" };
    }
    const m = /(大見出し|中見出し)[ ]*(.*)$/.exec(一行(row));
    return m ? { 種類: m[1], 題: m[2].trim() } : null;
  }

  /** その土地の時差つきの日時（公募の読み取り係と同じ形） */
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
   * 章立てを読む。
   *
   * @param {object} doc ページ（document、テストでは作り物）
   * @param {string} url いまのページのURL
   * @param {Date} [now]
   * @returns {{ok:true, envelope:string, count:number, chapters:number, subHeadings:number}
   *          |{ok:false, reason:"not-work-page"|"no-episodes"|"no-chapters", count?:number}}
   *   count は話の数、chapters は大見出しの数、subHeadings は読まなかった中見出しの数
   */
  function readChapters(doc, url, now) {
    const 場所 = matchChapterPage(url);
    if (!場所.ok) {
      return { ok: false, reason: "not-work-page" };
    }
    const episodes = [];
    let 今の章 = null;
    let chapters = 0;
    let subHeadings = 0;
    for (const 表 of 要素たち(doc, "table.episodes")) {
      const 行たち = 要素たち(表, "tr");
      // 本物の話の行を持たない表（控え）は、見出しの行も読まない
      if (!行たち.some((row) => 話の題(row) !== null)) {
        continue;
      }
      for (const row of 行たち) {
        const 題 = 話の題(row);
        if (題 !== null) {
          if (episodes.length < 話の上限) {
            episodes.push({ heading: 題, part: 今の章 });
          }
          continue;
        }
        const 見 = 見出し(row);
        if (!見) {
          continue;
        }
        if (見.種類 === "中見出し") {
          subHeadings += 1;
          continue;
        }
        chapters += 1;
        今の章 = 見.題 || null;
      }
    }
    if (episodes.length === 0) {
      // 読み込み中・画面の作りが変わった。0件を「渡した」にしない
      return { ok: false, reason: "no-episodes" };
    }
    if (!episodes.some((e) => e.part !== null)) {
      return { ok: false, reason: "no-chapters", count: episodes.length };
    }
    let pageUrl = String(url);
    try {
      const u = new URL(String(url));
      u.hash = "";
      u.search = "";
      pageUrl = u.href;
    } catch (_e) {
      // matchChapterPage が読めたURLなので、ここへは来ない
    }
    const envelope = {
      [MARKER]: ENVELOPE_VERSION,
      site: "kakuyomu",
      workId: 場所.workId,
      pageUrl,
      readAt: 時差つき(now),
      episodes,
    };
    return { ok: true, envelope: JSON.stringify(envelope), count: episodes.length, chapters, subHeadings };
  }

  // 裏方からの頼み（作者が右クリックの項目を押したときだけ届く）
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (!request || request.type !== "read-chapters") {
        return false;
      }
      try {
        sendResponse(readChapters(document, location.href, new Date()));
      } catch (e) {
        sendResponse({ ok: false, reason: "failed", detail: String((e && e.message) || e) });
      }
      return false;
    });
  }

  const api = { MARKER, ENVELOPE_VERSION, matchChapterPage, readChapters };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHChapterRead = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
