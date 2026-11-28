/**
 * 押したときの診断の記録（0.21.0。作者の答え 2026-11-12「作る」）。
 *
 * 作者がツールバーのアイコンを**押したときだけ**、押した画面の「アドレスの形」と、押して何をしたかを
 * 拡張の中に最新の数件だけ残し、説明のページの「診断」に出す。作者は普段どおり投稿して押すだけで、
 * 投稿・公開のあとにサイトがどの形のアドレスへ移るか（引継ぎ書3章の 0.20.0 の①）が分かる。
 *
 * 守ること（設計書2章の一線）：
 * - **開いただけでは残さない。** 呼ぶのはアイコンを押したとき（background.js の 実行する）だけ
 * - **ページから集めない。** 残すのはアドレスの形と、押した結果・止めた理由の札（1.1.0。下の表のものだけ）。数字は「#」に、なろうの Nコードは「N#」に伏せ、
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

  /*
    1.1.0（障害報告用の記録。作者の答え 2026-11-28「失敗の種類を残す」）：押した結果と、止めたときの理由の札。
    **札は下の表にあるものだけを残す。** 知らせの文・クリップボード由来の detail（サイトの名・字数など）・例外の文は
    残さない——表に無い札は、欄ごと捨てる（行は残す）。札の無い前の版の行も、そのまま読む。
  */
  /** 押した結果 */
  const RESULT_LABELS = {
    done: "済み",
    stopped: "止めた",
    waiting: "結果待ち",
  };

  /** 止めた理由の札と、作者が読む名前（説明のページ・障害報告用の記録に出す） */
  const REASON_LABELS = {
    busy: "前の処理の途中",
    "nothing-here": "ここではできることが無い",
    unexpected: "思わぬ失敗",
    other: "そのほか",
    "clipboard-read": "クリップボードを読めなかった",
    "clipboard-write": "クリップボードへ置けなかった",
    "no-manuscript": "クリップボードに原稿が無い",
    "envelope-empty": "クリップボードが空",
    "envelope-not-json": "貼り込み用のデータでない",
    "envelope-not-object": "貼り込み用のデータでない",
    "envelope-not-envelope": "貼り込み用のデータでない",
    "envelope-bad-version": "貼り込み用のデータの版が違う",
    "envelope-unknown-site": "知らないサイト宛てのデータ",
    "envelope-bad-body": "本文の形が合わない",
    "envelope-bad-title": "題の形が合わない",
    "envelope-bad-workid": "作品の番号の形が合わない",
    "envelope-bad-chapter": "章の形が合わない",
    "match-bad-url": "画面のアドレスを読めない",
    "match-site-mismatch": "別のサイトの原稿",
    "match-unsupported-site": "貼り込みに対応していないサイト",
    "match-not-post-page": "話の作成画面でない",
    "match-work-id-not-found": "画面から作品の番号を読めない",
    "match-work-mismatch": "別の作品の原稿",
    "page-not-ready": "ページが応えなかった",
    "login-page": "ログインの画面",
    "fields-not-found": "欄が見つからない",
    "over-limit": "サイトの字数の上限を超える",
    canceled: "確認の窓で取りやめた",
    "page-exception": "ページの中で思わぬ失敗",
    "posted-not-here": "話の番号を読めない画面",
    "nothing-to-hand": "渡すものが無い",
    "stats-not-ready": "読者の反応の画面が応えなかった",
    "stats-read": "読者の反応を読めなかった",
    "stash-failed": "読者の反応を溜められなかった",
    "contests-not-here": "公募の一覧の画面でない",
    "contests-read": "公募の一覧を読めなかった",
    "rankings-not-ready": "ランキングの画面が応えなかった",
    "rankings-not-found": "ランキングに作品が無い",
  };

  /** 結果待ちの押しの鍵（ページ側の結果を、同じ押しの1件へ戻すため。中身は乱数だけ） */
  const PRESS_ID = /^[a-z0-9]{8}$/;

  /** 札と結果を確かめて、1件に付ける（表に無ければ付けない） */
  function withOutcome(行, result, reason, id) {
    if (typeof result === "string" && Object.prototype.hasOwnProperty.call(RESULT_LABELS, result)) {
      行.result = result;
    }
    if (行.result === "stopped" && typeof reason === "string" && Object.prototype.hasOwnProperty.call(REASON_LABELS, reason)) {
      行.reason = reason;
    }
    if (行.result === "waiting" && typeof id === "string" && PRESS_ID.test(id)) {
      行.id = id;
    }
    return 行;
  }

  /** 保存から読んだものを、形を確かめながら記録にする（壊れた行は捨てる。札だけ壊れていれば札を捨てる） */
  function normalizeLog(raw) {
    const 行たち = raw && Array.isArray(raw.entries) ? raw.entries : [];
    const 良い = 行たち
      .filter(
        (e) =>
          e &&
          typeof e.at === "string" &&
          typeof e.place === "string" &&
          typeof e.shape === "string" &&
          typeof e.did === "string" &&
          e.shape.length <= SHAPE_MAX
      )
      .map((e) =>
        withOutcome({ at: e.at, place: e.place, shape: e.shape, did: e.did, posted: !!e.posted }, e.result, e.reason, e.id)
      );
    return { entries: 良い.slice(-PRESS_LOG_MAX) };
  }

  /**
   * 1件足す（新しいものを末尾に。上限を超えたら古いものから消す）。
   * @param {object} log normalizeLog の形
   * @param {{url:string, did:string, posted?:boolean, result?:string, reason?:string, id?:string}} press
   *   押したアドレスと、押して何をしたか。結果と止めた理由の札（1.1.0）、結果待ちの鍵
   * @param {string[]} knownHosts
   * @param {Date} now
   */
  function addPress(log, press, knownHosts, now) {
    const { place, shape } = shapeOf(press && press.url, knownHosts);
    const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const 行 = withOutcome(
      {
        at: d.toISOString(),
        place,
        shape,
        did: String((press && press.did) || "nothing").slice(0, 40),
        posted: !!(press && press.posted),
      },
      press && press.result,
      press && press.reason,
      press && press.id
    );
    return { entries: normalizeLog(log).entries.concat([行]).slice(-PRESS_LOG_MAX) };
  }

  /**
   * ページ側の結果があとから届いたとき（貼り込みは、確認の窓を待たずに押しの記録を書く）、
   * 同じ鍵の結果待ちの1件だけを、済み／止めたに直す。見つからなければそのまま返す。
   */
  function settleResult(log, id, ok, reason) {
    const 記録 = normalizeLog(log);
    if (typeof id !== "string" || !PRESS_ID.test(id)) {
      return 記録;
    }
    const 何番 = 記録.entries.findIndex((e) => e.result === "waiting" && e.id === id);
    if (何番 < 0) {
      return 記録;
    }
    const e = 記録.entries[何番];
    const 直した = withOutcome(
      { at: e.at, place: e.place, shape: e.shape, did: e.did, posted: e.posted },
      ok ? "done" : "stopped",
      ok ? undefined : reason || "other"
    );
    return { entries: 記録.entries.map((x, i) => (i === 何番 ? 直した : x)) };
  }

  /** 結果待ちの鍵を作る（英小文字と数字の8字。作品や画面とは関わらない乱数） */
  function newPressId(randomValues) {
    const 字 = "abcdefghijklmnopqrstuvwxyz0123456789";
    const 乱 = new Uint8Array(8);
    const 既定 =
      globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function"
        ? (a) => globalThis.crypto.getRandomValues(a)
        : (a) => a.forEach((_b, i) => (a[i] = Math.floor(Math.random() * 256))); // 鍵は照合用で、秘密ではない
    (randomValues || 既定)(乱);
    return Array.from(乱, (b) => 字[b % 字.length]).join("");
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
        const 結果 = e.result
          ? `（${RESULT_LABELS[e.result]}${e.reason ? `：${REASON_LABELS[e.reason]}` : ""}）`
          : "";
        return `${日時(e.at)}　${どこ}${番号}　→ ${DID_LABELS[e.did] || e.did}${結果}`;
      })
      .join("\n");
  }

  const api = {
    PRESS_LOG_MAX,
    SHAPE_MAX,
    DID_LABELS,
    RESULT_LABELS,
    REASON_LABELS,
    hostKnown,
    shapeOf,
    normalizeLog,
    addPress,
    settleResult,
    newPressId,
    formatLog,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHPressLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
