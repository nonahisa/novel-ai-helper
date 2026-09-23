"use strict";

/**
 * いま開いている画面で「できる1つのこと」を決める（0.8.0。作者の依頼、2026-09-23
 * 「シンプルに画面で実行できるのは一つだけだと思いますので、アイコンクリック、
 * もしくは右クリックメニューだけで実行できるようにしてください」）。
 *
 * 0.7.x までは、ポップアップに2つのボタンを並べ、使えないほうを押せなくしていた。
 * 実際には、**1つの画面で両方ができることは無い**（話の作成画面では貼り込みだけ、
 * 作品管理・アクセス数・Narou.fun の作品ページでは読み取りだけ）。だから、
 * アイコンを押す（右クリックの項目を選ぶ）だけで、その1つを実行する。
 *
 * ## 判定はここに置かない
 *
 * どの画面で何ができるかは common/pageState.js の describePage が決める（0.3.0 から）。
 * ここは**その結果を、アイコンの印・右クリックの項目・実行する処理へ写すだけ**
 * ——条件をここにも書くと、2か所が食い違った日に、印と実行が別々のことを言い出す。
 *
 * ## 印は守りではない
 *
 * 押したあとの確かめ（match.js の checkTarget、statsSites.js の matchReadPage、guard.js）は
 * 1つも外していない。印や右クリックの項目が古いままでも、間違った場所へは貼り込まれない。
 */
(function (global) {
  /** 文言の表。読み込み順に頼らないよう、使うときに引く（テストでは require の順が変わりうる）。 */
  const 文言 = () => global.NPHMessages;

  /**
   * アイコンに重ねる小さな印。**1文字で、意味が分かるもの**（作者の依頼の例のとおり）。
   * 色も分ける——並んだタブを行き来したときに、字を読まなくても違いが分かるように。
   * 色はポップアップの頃の色（ボタンの青・成功の緑）を引き継ぐ。
   */
  const BADGES = {
    fill: { text: "貼", color: "#2b6cb0" },
    stats: { text: "読", color: "#2f855a" },
  };

  /**
   * 読者の反応をコピーしたあとに呼ぶ、統合小説執筆環境（VS Code）の取り込み口
   * （作者の裁定、2026-09-23「押したら VS Code が前に出て取り込む」）。
   *
   * **データはリンクに載せない。** リンクは VS Code を前に出して取り込みを始めさせるだけで、
   * 中身はクリップボードで渡す（受け側は統合小説執筆環境の担当が作る）。
   * リンクに載せると、ブラウザの履歴やOSのログに読者の数が残るうえ、長さの上限で黙って切れる。
   */
  const VSCODE_IMPORT_URL = "vscode://nonahisa.novel-ai-assistant/import-reader-stats";

  /**
   * 見立て（describePage の戻り値）から、いまの画面でできることを決める。
   *
   * @param {object|null} state common/pageState.js の describePage の戻り値
   * @returns {{kind:"fill"|"stats"|null, badgeText:string, badgeColor:string|null, title:string}}
   *   kind が null なら、この画面でできることは無い（印を外し、右クリックの項目を隠す）
   */
  function actionForPage(state) {
    const 見立て = state || {};
    let kind = null;
    // kind と can… の両方を見る。片方だけを見ると、表を直した日に「印は貼なのに押すと断られる」が起きる
    if (見立て.kind === "fill" && 見立て.canFill === true) {
      kind = "fill";
    } else if (見立て.kind === "stats" && 見立て.canReadStats === true) {
      kind = "stats";
    }
    const 印 = kind ? BADGES[kind] : null;
    return {
      kind,
      badgeText: 印 ? 印.text : "",
      badgeColor: 印 ? 印.color : null,
      title: 文言().actionTitle(kind),
    };
  }

  /**
   * 読み取りのあとに VS Code を呼ぶか。呼ぶならそのリンクを返す（呼ばないなら null）。
   *
   * 呼ぶのは**読者の反応をクリップボードへ置けたときだけ**。置けていないのに VS Code を
   * 前に出すと、取り込みの側はクリップボードにある別のもの（前にコピーした原稿など）を
   * 読みに行くことになる。貼り込みのあとには呼ばない——貼り込みは投稿画面で終わる作業で、
   * VS Code へ戻る理由が無いうえ、投稿画面の書きかけのそばで別の窓を開かせたくない。
   *
   * @param {{kind:string|null, copied:boolean}} outcome 何をして、クリップボードへ置けたか
   * @returns {string|null}
   */
  function vscodeLinkAfter(outcome) {
    if (!outcome || outcome.kind !== "stats" || outcome.copied !== true) {
      return null;
    }
    return VSCODE_IMPORT_URL;
  }

  const api = { BADGES, VSCODE_IMPORT_URL, actionForPage, vscodeLinkAfter };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
