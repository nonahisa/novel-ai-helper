/**
 * 押したときの診断の記録（0.21.0。作者の答え 2026-11-12「作る」）。
 *
 * 作者がツールバーのアイコンを**押したときだけ**、押した画面の「アドレスの形」と、押して何をしたかを
 * 拡張の中に最新の数件だけ残し、説明のページの「診断」に出す。作者は普段どおり投稿して押すだけで、
 * 投稿・公開のあとにサイトがどの形のアドレスへ移るか（引継ぎ書3章の 0.20.0 の①）が分かる。
 *
 * 守ること（設計書2章の一線）：
 * - **開いただけでは残さない。** 呼ぶのはアイコンを押したとき（background.js の 実行する）だけ
 * - **ページから集めない。** 残すのはアドレスの形だけ。数字は「#」に、なろうの Nコードは「N#」に伏せ、
 *   問い合わせ（?）と # 以降は捨てる。題・本文・欄の字は残さない
 * - ホスト名は、この拡張が入るサイト・話の番号を読むサイトのときだけ残す。ほかは「ほかのサイト」とだけ書く
 * - どこへも送らない（保存は chrome.storage.local の pressLog だけ。受け手へ渡す束にも入れない）
 */
(function (global) {
  "use strict";

  /** 残す件数。古いものから消える */
  const PRESS_LOG_MAX = 10;
  /** 1件のアドレスの形の長さの上限（変わったアドレスで保存が膨らまないように） */
  const SHAPE_MAX = 200;

  /** ホストが、残してよいホストの一覧に入るか（サブドメインも含む） */
  function hostKnown(host, knownHosts) {
    const h = String(host || "").toLowerCase();
    return (knownHosts || []).some((k) => {
      const kk = String(k || "").toLowerCase();
      return kk !== "" && (h === kk || h.endsWith("." + kk));
    });
  }

  /**
   * アドレスの形を作る。
   * @param {string} url 押した画面のアドレス
   * @param {string[]} knownHosts 残してよいホスト（この拡張が入るサイトと、話の番号を読むサイト）
   * @returns {{place:string, shape:string}}
   */
  function shapeOf(url, knownHosts) {
    let u = null;
    try {
      u = new URL(String(url || ""));
    } catch (_e) {
      return { place: "ほかの画面", shape: "" };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { place: "ほかの画面", shape: "" };
    }
    if (!hostKnown(u.hostname, knownHosts)) {
      return { place: "ほかのサイト", shape: "" };
    }
    const 形 = u.pathname
      .replace(/(^|\/)n\d{4}[a-z]{1,2}(?=\/|$)/gi, "$1N#")
      .replace(/\d+/g, "#")
      .slice(0, SHAPE_MAX);
    return { place: u.hostname.toLowerCase(), shape: 形 };
  }

  /** 保存から読んだものを、形を確かめながら記録にする（壊れた行は捨てる） */
  function normalizeLog(raw) {
    const 行たち = raw && Array.isArray(raw.entries) ? raw.entries : [];
    const 良い = 行たち.filter(
      (e) =>
        e &&
        typeof e.at === "string" &&
        typeof e.place === "string" &&
        typeof e.shape === "string" &&
        typeof e.did === "string" &&
        e.shape.length <= SHAPE_MAX
    );
    return { entries: 良い.slice(-PRESS_LOG_MAX) };
  }

  /**
   * 1件足す（新しいものを末尾に。上限を超えたら古いものから消す）。
   * @param {object} log normalizeLog の形
   * @param {{url:string, did:string, posted?:boolean}} press 押したアドレスと、押して何をしたか
   * @param {string[]} knownHosts
   * @param {Date} now
   */
  function addPress(log, press, knownHosts, now) {
    const { place, shape } = shapeOf(press && press.url, knownHosts);
    const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const 行 = {
      at: d.toISOString(),
      place,
      shape,
      did: String((press && press.did) || "nothing").slice(0, 40),
      posted: !!(press && press.posted),
    };
    return { entries: normalizeLog(log).entries.concat([行]).slice(-PRESS_LOG_MAX) };
  }

  /** 押して何をしたか（background.js の kind）を、作者が読む言葉にする */
  const DID_LABELS = {
    fill: "原稿を入れる",
    posted: "話の番号を渡す",
    stats: "読者の反応を読む",
    contests: "公募の一覧を読む",
    rankings: "ランキングの順位を読む",
    approve: "ご自分の作品か訊く",
    report: "集計を開く",
    hand: "まとめて渡す",
    busy: "前の処理の途中",
    nothing: "ここではできることが無い",
    error: "思わぬ失敗",
  };

  /** 説明のページに出す字（1件1行。新しい順） */
  function formatLog(log, toLocal) {
    const 行たち = normalizeLog(log).entries.slice().reverse();
    if (行たち.length === 0) {
      return "まだ記録はありません。投稿サイトの画面でツールバーのアイコンを押すと、ここに残ります。";
    }
    const 日時 = typeof toLocal === "function" ? toLocal : (iso) => iso;
    return 行たち
      .map((e) => {
        const どこ = e.shape ? `${e.place}${e.shape}` : e.place;
        const 番号 = e.posted ? "（話の番号を読む画面）" : "";
        return `${日時(e.at)}　${どこ}${番号}　→ ${DID_LABELS[e.did] || e.did}`;
      })
      .join("\n");
  }

  const api = {
    PRESS_LOG_MAX,
    SHAPE_MAX,
    DID_LABELS,
    hostKnown,
    shapeOf,
    normalizeLog,
    addPress,
    formatLog,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHPressLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
