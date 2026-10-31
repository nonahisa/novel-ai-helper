"use strict";

/**
 * 「触ってはいけないページ・欄」の判定（設計書6.79.6-1：認証情報には絶対に触れない）。
 *
 * ページのDOMを直接見る代わりに、**要素から抜き出した最小限の情報だけ**を受け取って判定する。
 * こうすると、判定そのものを単体テストで確かめられる（DOM操作は実機の領分）。
 *
 * 受け取る形（fill.js が組み立てる）：
 *   { type: "password", autocomplete: "current-password", visible: true }
 *
 * 後半には「どの欄へ、断りなしに書いてよいか」の判定（selectorPlan / confirmationNeeded）も
 * 置いてある。こちらもDOMを受け取らない純粋な判定なので、単体テストで固定できる。
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

  /**
   * 表の selectors から、試す順番を作る。
   *
   * 「厳密（strict）」はサイト固有と読める形（`textarea[name="body"]` など）。
   * 「汎用（generic）」は `#body` や `div[contenteditable]` のように、
   * **投稿フォームの外にもいくらでもある形**。どちらで当たったかを持ち回るのは、
   * 確認を出すかどうかがそれで決まるため（confirmationNeeded）。
   *
   * 昔の形（selectors がただの配列）は受け付けない。黙って全部を「厳密」と
   * みなすと、汎用のセレクタで当たった欄へ無確認で書き込むことになる。
   */
  function selectorPlan(fieldSpec) {
    if (!fieldSpec || !fieldSpec.selectors || Array.isArray(fieldSpec.selectors)) {
      return [];
    }
    const 計画 = [];
    for (const kind of ["strict", "generic"]) {
      const 一覧 = fieldSpec.selectors[kind];
      if (!Array.isArray(一覧)) {
        continue;
      }
      for (const selector of 一覧) {
        計画.push({ selector, kind });
      }
    }
    return 計画;
  }

  /**
   * 貼り込む前に、作者へ確認を出すか。
   *
   * 確認が要るのは2つの場合で、理由が違う。
   *   1. 欄に中身がある      … 書きかけを黙って消さない（設計書6.79.6-3）
   *   2. 汎用セレクタで当たった … その欄でよいと機械では確かめられない。
   *                              空でも1度は見せる（見当違いの欄へ無確認で書くほうが危ない）
   * 1と2の両方に当てはまる欄は1（中身がある）だけに数える。理由としてそちらが強く、
   * 同じ欄を2回並べても作者には伝わらないため。
   *
   * @param {Array<{label:string, matchKind:string, occupied:boolean}>} targets
   */
  function confirmationNeeded(targets) {
    const occupied = [];
    const uncertain = [];
    if (Array.isArray(targets)) {
      for (const t of targets) {
        if (!t) {
          continue;
        }
        if (t.occupied === true) {
          occupied.push(t.label);
        } else if (t.matchKind !== "strict") {
          // 知らない種別も「確かめられていない」側に入れる（表の書き方を変えたときに、
          // 判定が黙って甘くならないように）。
          uncertain.push(t.label);
        }
      }
    }
    return { needsConfirm: occupied.length > 0 || uncertain.length > 0, occupied, uncertain };
  }

  /**
   * 章の題を比べるためにならす（0.15.0。アルファポリスの章の選択）。
   *
   * ならすのは「前後の空白・続く空白・全角の英数と空白」だけ。NFKC にしないのは、
   * ①や半角カナ・記号まで書き換わり、別の章の題が同じに見えてしまうことがあるため。
   * 大文字小文字もそろえない（同じ理由）。受け手とヘルパーで題の書き方が揺れるのは、
   * 空白の入れ方と全角半角くらいだと見込んでいる。
   */
  function normalizeChapterLabel(text) {
    if (typeof text !== "string") {
      return "";
    }
    return text
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 章の選択肢から、封筒の章と同じ題のものを選ぶ。**ちょうど1つ当たったときだけ**位置を返す。
   *
   * 0件で近いものを選んだり、2件以上で先頭を選んだりすると、作者が気づかないまま
   * 別の章へ話を入れることになる。選べなければ選ばず、理由（reason）を返して作者に言う。
   * value が空の選択肢（「章を選択しない」のような先頭の項目）は、選んでも章を選んだことに
   * ならないので候補から外す。
   *
   * @param {Array<{label:string, value:string}>} options 選択肢（並び順のまま）
   * @param {string} chapter 封筒の章
   * @returns {{ok:true, index:number}|{ok:false, reason:"none"|"many", count:number}}
   */
  function pickChapterOption(options, chapter) {
    const 目当て = normalizeChapterLabel(chapter);
    const 当たり = [];
    if (目当て !== "" && Array.isArray(options)) {
      options.forEach((o, i) => {
        if (!o || typeof o.value !== "string" || o.value === "") {
          return;
        }
        if (normalizeChapterLabel(o.label) === 目当て) {
          当たり.push(i);
        }
      });
    }
    if (当たり.length === 1) {
      return { ok: true, index: 当たり[0] };
    }
    return { ok: false, reason: 当たり.length === 0 ? "none" : "many", count: 当たり.length };
  }

  const api = {
    PASSWORD_AUTOCOMPLETE,
    isLoginLikePage,
    isSafeTarget,
    selectorPlan,
    confirmationNeeded,
    normalizeChapterLabel,
    pickChapterOption,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHGuard = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
