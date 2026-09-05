"use strict";

/**
 * 「触ってはいけないページ・欄」の判定（設計書6.79.6-1：認証情報には絶対に触れない）。
 *
 * ページのDOMを直接見る代わりに、**要素から抜き出した最小限の情報だけ**を受け取って判定する。
 * こうすると、判定そのものを単体テストで確かめられる（DOM操作は実機の領分）。
 *
 * 受け取る形（fill.js が組み立てる）：
 *   { type: "password", autocomplete: "current-password", visible: true }
 */
(function (global) {
  /** パスワードとみなす autocomplete の値。 */
  const PASSWORD_AUTOCOMPLETE = ["current-password", "new-password"];

  /**
   * ログイン画面（または認証を求める画面）かどうか。
   *
   * **見えているパスワード欄だけ**を数える。投稿画面の中には、ブラウザの自動入力よけに
   * 隠しのパスワード欄を置いているものがあり、それで常に動かなくなると機能が死ぬため。
   * 本物のログイン画面のパスワード欄は必ず見えているので、これで取り逃さない。
   */
  function isLoginLikePage(fields) {
    if (!Array.isArray(fields)) {
      // 情報が取れないときは「触らない」側に倒す。
      return true;
    }
    return fields.some((f) => {
      if (!f || f.visible === false) {
        return false;
      }
      const type = String(f.type || "").toLowerCase();
      const autocomplete = String(f.autocomplete || "").toLowerCase();
      return type === "password" || PASSWORD_AUTOCOMPLETE.includes(autocomplete);
    });
  }

  /**
   * その欄に書き込んでよいか（セレクタが思わぬ欄に当たったときの最後の関門）。
   * パスワード・隠し欄・読み取り専用・使用不可の欄には、何があっても書かない。
   */
  function isSafeTarget(field) {
    if (!field) {
      return false;
    }
    const type = String(field.type || "").toLowerCase();
    const autocomplete = String(field.autocomplete || "").toLowerCase();
    if (type === "password" || PASSWORD_AUTOCOMPLETE.includes(autocomplete)) {
      return false;
    }
    if (type === "hidden") {
      return false;
    }
    if (field.readOnly === true || field.disabled === true) {
      return false;
    }
    return true;
  }

  const api = { PASSWORD_AUTOCOMPLETE, isLoginLikePage, isSafeTarget };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
