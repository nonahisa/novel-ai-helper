"use strict";

/**
 * クリップボードから受け取った「封筒」を検証する。
 *
 * 封筒の形（母艦側と同一。設計書6.79.3）：
 *   {"novelai-post":1, "site":"kakuyomu"|"narou"|"alphapolis",
 *    "workId"?:string, "title":string, "body":string}
 *
 * 方針：
 * - **余分な欄は無視して読む**（母艦側が将来 caption などを足しても、古い貼り込み係が壊れない）
 * - **版数が1でなければ断る**（知らない版を「たぶん同じだろう」で読むと、
 *   欄の意味が変わっていたときに本文を取り違えて埋めることになる）
 * - ここでは文言を作らない。理由（reason）だけを返し、日本語は messages.js が持つ
 *   ——判定そのものをテストで確かめられるようにするため。
 */
(function (global) {
  /** 貼り込み係が知っているサイト。ここに無い site の封筒は読まない。 */
  const KNOWN_SITES = ["kakuyomu", "narou", "alphapolis"];

  /** 母艦と揃える封筒の版。将来1以外が来たら、読まずに断る。 */
  const ENVELOPE_VERSION = 1;

  function fail(reason, detail) {
    return { ok: false, reason, detail };
  }

  /**
   * クリップボードの文字列を封筒として読む。
   *
   * @param {unknown} text クリップボードの中身
   * @returns {{ok:true, envelope:{site:string, workId?:string, title:string, body:string}}
   *          |{ok:false, reason:string, detail?:string}}
   */
  function parseEnvelope(text) {
    if (typeof text !== "string" || text.trim() === "") {
      return fail("empty");
    }

    let raw;
    try {
      raw = JSON.parse(text);
    } catch (_e) {
      // 普通の本文をコピーしたまま押した場合がここに来る。よくある操作なので、
      // 例外の中身は出さず「貼り込み用のデータがありません」で受ける。
      return fail("not-json");
    }

    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return fail("not-object");
    }

    if (!Object.prototype.hasOwnProperty.call(raw, "novelai-post")) {
      return fail("not-envelope");
    }

    const version = raw["novelai-post"];
    if (version !== ENVELOPE_VERSION) {
      return fail("bad-version", String(version));
    }

    if (typeof raw.site !== "string" || !KNOWN_SITES.includes(raw.site)) {
      return fail("unknown-site", typeof raw.site === "string" ? raw.site : String(raw.site));
    }

    // タイトルは空文字を許す（連載の途中で題を付けない作者がいる）。
    // ただし文字列でなければ、母艦側の作りが違うということなので断る。
    if (typeof raw.title !== "string") {
      return fail("bad-title");
    }

    // 本文が空の封筒は貼り込む意味がなく、空で上書きする事故のもとなので断る。
    if (typeof raw.body !== "string" || raw.body === "") {
      return fail("bad-body");
    }

    // workId は任意。ただし「有るのに文字列でない」は母艦側の不具合なので断る。
    // 空文字は「無い」と同じ扱いにする（照合をすり抜けさせない）。
    let workId;
    if (raw.workId !== undefined && raw.workId !== null) {
      if (typeof raw.workId === "string") {
        workId = raw.workId.trim() === "" ? undefined : raw.workId.trim();
      } else if (typeof raw.workId === "number") {
        // 母艦の台帳が数値でIDを持っていた場合の受け（カクヨムの作品IDは数字）。
        workId = String(raw.workId);
      } else {
        return fail("bad-workId");
      }
    }

    // 知っている欄だけを取り出して返す（余分な欄はここで落ちる）。
    const envelope = {
      site: raw.site,
      title: raw.title,
      body: raw.body,
    };
    if (workId !== undefined) {
      envelope.workId = workId;
    }
    return { ok: true, envelope };
  }

  const api = { KNOWN_SITES, ENVELOPE_VERSION, parseEnvelope };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHEnvelope = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
