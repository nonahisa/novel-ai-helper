"use strict";

/**
 * 「統合小説執筆環境へ渡す」の切り替え（0.11.0。作者の裁定、2026-09-23）。
 *
 * 統合小説執筆環境（VS Code の拡張機能）を使っていない方がこの拡張だけを入れて、ご自分の作品の画面で
 * アイコンを押すと、0.10.0 までは「まとめて渡す」が動いて `vscode://` を開こうとし、Chrome が
 * 「開きますか」と尋ねていた。溜まり（統合小説執筆環境へ渡す分）も使われないまま上限まで溜まり、
 * アイコンに「読50」の印が出続けた。そこで、渡すかどうかを説明のページで切り替えられるようにした。
 *
 * - 切っている間：アイコンを押すと集計（説明のページ）が開く。溜まりには溜めない（記録には書く）。
 *   全体の印（読N）も出さない。`vscode://` は開かない
 * - 入っている間：0.10.0 までと同じ
 *
 * ## 誰を入った状態で始めるか
 *
 * **新しく入れた方は切った状態で始める。既に使っている方は入ったままにする**
 * ——作者（統合小説執筆環境と一緒に使っている）が更新した日に、渡す動きが黙って止まらないため。
 *   - この拡張を更新して入った（chrome.runtime.onInstalled の reason が "update"）→ 入れる
 *   - 新しく入れた（reason が "install"）→ 切る（外すと Chrome が保存を消すので、形跡は残っていない）
 *   - 設定が保存に無いまま動いた（裏方が先に起きた・Chrome を更新した）→ 渡していた形跡で推す
 *
 * 形跡は、溜まりの保存（helperState）に次のどれかがあること：溜まり・渡した分の控え・覚えた作品・
 * 訊きかけの作品。どれも 0.9.0 から「統合小説執筆環境へ渡す」ために作った保存で、これがあるのは
 * 0.9.0 以降を使っていた方だけ。
 *
 * ## decidedBy（どう決めたか）を残す理由
 *
 * 形跡から推した値は、あとで入れた・更新した知らせが届いたら決め直したい（裏方が起きた直後に推して、
 * そのあとに更新の知らせが届くことがある）。一方で作者が切り替えた値と、入れた・更新したときに
 * 決めた値は、以後ずっと変えない（新しく入れた方が次の版へ更新したときに、勝手に入らないように）。
 *
 * このファイルは保存に触れない（読み書きは裏方 background.js だけ）。
 */
(function (global) {
  /** 決め方。traces だけが、あとから決め直してよいもの。 */
  const DECIDED_BY = ["install", "update", "traces", "author"];

  /**
   * 保存から読んだものを設定にする。形が合わなければ null（無いものとして扱い、形跡で推す）。
   * 決め方が分からないものは traces 扱い（決め直せるほうへ倒す）。
   */
  function normalizeSettings(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.handToIde !== "boolean") {
      return null;
    }
    const decidedBy = DECIDED_BY.includes(raw.decidedBy) ? raw.decidedBy : "traces";
    return { handToIde: raw.handToIde, decidedBy };
  }

  /**
   * 統合小説執筆環境へ渡していた形跡があるか。
   * @param {object} state common/stash.js の normalizeState を通した溜まりの状態
   *        （控えは古くなると落ちるので、pruneHanded を通す前のものを渡す）
   */
  function hasHandTraces(state) {
    if (!state || typeof state !== "object") {
      return false;
    }
    return (
      (Array.isArray(state.items) && state.items.length > 0) ||
      Boolean(state.handed && Array.isArray(state.handed.items) && state.handed.items.length > 0) ||
      (Array.isArray(state.ownWorks) && state.ownWorks.length > 0) ||
      Boolean(state.pending)
    );
  }

  /** 設定が保存に無いときに推す値（保存はしない。書くのは入れた・更新した知らせと、作者の切り替えだけ）。 */
  function settingsWhenMissing(state) {
    return { handToIde: hasHandTraces(state), decidedBy: "traces" };
  }

  /**
   * 入れた・更新した知らせ（chrome.runtime.onInstalled）が届いたときに、書く設定を決める。
   *
   * @param {object|null} existing normalizeSettings を通したいまの設定（無ければ null）
   * @param {string} reason onInstalled の details.reason
   * @param {object} state 溜まりの状態（形跡を見る）
   * @returns {object|null} 書く設定。変えないなら null
   */
  function settingsOnInstalled(existing, reason, state) {
    if (existing && existing.decidedBy !== "traces") {
      return null;
    }
    if (reason === "install") {
      // 外して入れ直すと保存は消えるので、形跡はふつう無い。あれば入れておく（渡していた方を止めない）
      return { handToIde: hasHandTraces(state), decidedBy: "install" };
    }
    if (reason === "update") {
      return { handToIde: true, decidedBy: "update" };
    }
    // Chrome 自身の更新など。この拡張を入れた・更新したのではないので、推した値があればそのまま
    return existing ? null : settingsWhenMissing(state);
  }

  /** 作者が説明のページで切り替えた設定。 */
  function settingsByAuthor(on) {
    return { handToIde: on === true, decidedBy: "author" };
  }

  const api = { normalizeSettings, hasHandTraces, settingsWhenMissing, settingsOnInstalled, settingsByAuthor };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHSettings = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
