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
   *
   * 0.9.0 で2つ増えた。
   * - 読の後ろに**溜まっている件数**を付ける（「読3」。作者の依頼の例のとおり）
   * - approve（「?」・橙）：誰の作品でも開ける画面で、まだ自分の作品として覚えていない作品。
   *   押すと「自分の作品として覚えますか」と訊く。緑の「読」と分けるのは、**開いても溜まっていない**
   *   ことが字を読まなくても分かるように
   */
  const BADGES = {
    fill: { text: "貼", color: "#2b6cb0" },
    stats: { text: "読", color: "#2f855a" },
    approve: { text: "?", color: "#c05621" },
    // 0.12.0：公募の一覧のページ。押すと、並んでいる公募を読んで統合小説執筆環境へ渡す
    contests: { text: "募", color: "#6b46c1" },
  };

  /**
   * 読者の反応を渡したあとに呼ぶ、統合小説執筆環境（VS Code）の取り込み口
   * （作者の裁定、2026-09-23「押したら VS Code が前に出て取り込む」）。
   *
   * **データはリンクに載せない。** リンクは VS Code を前に出して取り込みを始めさせるだけで、
   * 中身はクリップボードで渡す（受け側は統合小説執筆環境の担当が作る）。
   * リンクに載せると、ブラウザの履歴やOSのログに読者の数が残るうえ、長さの上限で黙って切れる。
   */
  const VSCODE_IMPORT_URL = "vscode://nonahisa.novel-ai-assistant/import-reader-stats";

  /**
   * 公募の一覧を渡したあとに呼ぶ取り込み口（0.12.0）。読者の反応と同じく、**データはリンクに載せない**
   * （公募の一覧はクリップボードで渡す）。統合小説執筆環境の受け口は1つで、パスで見分ける。
   */
  const VSCODE_CONTESTS_URL = "vscode://nonahisa.novel-ai-assistant/import-contests";

  /**
   * 章立てを渡したあとに呼ぶ取り込み口（0.13.0）。**データはリンクに載せない**（クリップボードで渡す）。
   * 統合小説執筆環境の受け口は1つで、パスで見分ける（core/readerStatsHelperLink.ts の CHAPTERS_IMPORT_URI_PATH）。
   */
  const VSCODE_CHAPTERS_URL = "vscode://nonahisa.novel-ai-assistant/import-chapters";

  /**
   * 溜まっている件数を、印の字にする（「読3」）。溜まりが無ければ空（印を出さない）。
   *
   * 印に収まるのは4字ほどなので、100件からは「読99+」と言う（上限は50件なので、ふだんは出ない）。
   */
  function stashBadgeText(count) {
    const n = Number(count) || 0;
    if (n <= 0) {
      return "";
    }
    return BADGES.stats.text + (n > 99 ? "99+" : String(n));
  }

  /**
   * 見立て（describePage の戻り値）と、溜まりの様子から、いまの画面でできることを決める。
   *
   * 0.9.0 から、**読者の反応の画面で押すと「まとめて渡す」**になった（作者の依頼、2026-09-23）。
   * 開いたときに自動で溜めているので、押したときに「この画面だけをコピー」する必要は無い。
   * 作者の「画面で実行できるのは一つだけ」に合わせて、読むだけの動きは残さず1本にした
   * （押したときはその画面を読み直してから渡すので、表示件数を変えたあとの数も入る）。
   *
   * 0.11.0：「統合小説執筆環境へ渡す」を切っているとき（context.handToIde === false）は、
   * まとめて渡さず、**押すと集計（説明のページ）を開く**（report）。ただし「?」（自分の作品か訊く）は残す
   * ——覚えた作品だけを記録するので、集計にも要る。話の作成画面の貼り込みも残す（0.11.1。作者の裁定）。
   * 読者の反応の画面の印は、件数を付けない「読」（開くと記録する画面の目印。溜まりの件数は出さない）。
   *
   * @param {object|null} state common/pageState.js の describePage の戻り値
   * @param {{stashCount?:number, needsApproval?:boolean, handToIde?:boolean}} [context]
   *   stashCount    … 溜まっている件数
   *   needsApproval … 読者の反応の画面だが、まだ自分の作品として覚えていない作品（common/stash.js の stashDecision）
   *   handToIde     … 「統合小説執筆環境へ渡す」が入っているか（common/settings.js。指定が無ければ入っている扱い）
   * @returns {{kind:"fill"|"stats"|"approve"|"hand"|"report"|null, badgeText:string|null, badgeColor:string|null, title:string, menuVisible:boolean}}
   *   kind   … fill（貼り込む）／stats（この画面を読み直して、まとめて渡す）／approve（自分の作品か訊く）／
   *            hand（ほかの画面で、溜まった分をまとめて渡す）／report（集計を開く。切っているとき）／
   *            null（できることが無い）
   *   badgeText が null なら、このタブだけの印を付けない（拡張全体の印＝溜まっている件数が出る）
   *   menuVisible … ページの上の右クリックの項目を出すか
   */
  function actionForPage(state, context) {
    const 見立て = state || {};
    const 様子 = context || {};
    if (見立て.kind === "contests") {
      return 公募の行い(様子);
    }
    if (様子.handToIde === false) {
      return 渡さないときの行い(見立て, 様子);
    }
    const 溜まり = Number(様子.stashCount) || 0;
    let kind = null;
    // kind と can… の両方を見る。片方だけを見ると、表を直した日に「印は貼なのに押すと断られる」が起きる
    if (見立て.kind === "fill" && 見立て.canFill === true) {
      kind = "fill";
    } else if (見立て.kind === "stats" && 見立て.canReadStats === true) {
      kind = 様子.needsApproval === true ? "approve" : "stats";
    } else if (溜まり > 0) {
      kind = "hand";
    }
    let badgeText = null;
    let badgeColor = null;
    if (kind === "fill" || kind === "approve") {
      badgeText = BADGES[kind].text;
      badgeColor = BADGES[kind].color;
    } else if (kind === "stats") {
      // 溜まりが無ければ従来の「読」（開いて読めなかったときなど）
      badgeText = stashBadgeText(溜まり) || BADGES.stats.text;
      badgeColor = BADGES.stats.color;
    }
    return { kind, badgeText, badgeColor, title: 文言().actionTitle(kind), menuVisible: kind !== null };
  }

  /**
   * 公募の一覧のページ（0.12.0）。押すと、並んでいる公募を読んでクリップボードへ置く。
   *
   * 「統合小説執筆環境へ渡す」が入っていれば、置いたあと VS Code を呼ぶ（取り込みが始まる）。
   * **切っていれば、置くだけ**にする（VS Code は呼ばない）。公募の一覧は統合小説執筆環境で
   * 使うためのものだが、VS Code を使っている方でも、新しく入れた直後は切ってある。
   * 押したのに何も起きない、にしないため、コピーまではして、貼り付けて取り込む道を知らせで言う。
   * 溜まりには関わらない（公募は拡張の中に溜めない）。
   */
  function 公募の行い(様子) {
    const 渡す = 様子.handToIde !== false;
    return {
      kind: "contests",
      badgeText: BADGES.contests.text,
      badgeColor: BADGES.contests.color,
      title: 文言().actionTitle(渡す ? "contests" : "contestsCopy"),
      menuVisible: true,
    };
  }

  /**
   * 「統合小説執筆環境へ渡す」を切っているとき（0.11.0）。押すと集計を開く（話の作成画面と「?」の画面を除く）。
   * 右クリックの項目は、読者の反応の画面にだけ出す——投稿画面やほかの画面の右クリックに
   * 「集計を見る」を並べても、その画面でする理由が無い（アイコンの右クリックの項目がある）。
   */
  function 渡さないときの行い(見立て, 様子) {
    // 0.11.1（作者の裁定、2026-09-23）：話の作成画面では、切っていても貼り込む。
    // 貼り込みは押したときにクリップボードを読むだけで、溜まりにも VS Code にも関わらないため
    if (見立て.kind === "fill" && 見立て.canFill === true) {
      return {
        kind: "fill",
        badgeText: BADGES.fill.text,
        badgeColor: BADGES.fill.color,
        title: 文言().actionTitle("fill"),
        menuVisible: true,
      };
    }
    const 読める画面 = 見立て.kind === "stats" && 見立て.canReadStats === true;
    if (読める画面 && 様子.needsApproval === true) {
      return {
        kind: "approve",
        badgeText: BADGES.approve.text,
        badgeColor: BADGES.approve.color,
        title: 文言().actionTitle("approve"),
        menuVisible: true,
      };
    }
    return {
      kind: "report",
      badgeText: 読める画面 ? BADGES.stats.text : null,
      badgeColor: 読める画面 ? BADGES.stats.color : null,
      title: 文言().actionTitle("report"),
      menuVisible: 読める画面,
    };
  }

  /**
   * 渡したあとに VS Code を呼ぶか。呼ぶならそのリンクを返す（呼ばないなら null）。
   *
   * 呼ぶのは**読者の反応をクリップボードへ置けたときだけ**。置けていないのに VS Code を
   * 前に出すと、取り込みの側はクリップボードにある別のもの（前にコピーした原稿など）を
   * 読みに行くことになる。貼り込みのあとには呼ばない——貼り込みは投稿画面で終わる作業で、
   * VS Code へ戻る理由が無いうえ、投稿画面の書きかけのそばで別の窓を開かせたくない。
   *
   * @param {{kind:string|null, copied:boolean}} outcome 何をして、クリップボードへ置けたか
   *        （kind は stats／hand。説明のページの「もう一度渡す」も hand）
   * @returns {string|null}
   */
  function vscodeLinkAfter(outcome) {
    if (!outcome || outcome.copied !== true) {
      return null;
    }
    if (outcome.kind === "contests") {
      // 0.12.0：公募の一覧を置けたとき
      return VSCODE_CONTESTS_URL;
    }
    if (outcome.kind === "chapters") {
      // 0.13.0：章立てを置けたとき
      return VSCODE_CHAPTERS_URL;
    }
    if (outcome.kind !== "stats" && outcome.kind !== "hand") {
      return null;
    }
    return VSCODE_IMPORT_URL;
  }

  const api = {
    BADGES,
    VSCODE_IMPORT_URL,
    VSCODE_CONTESTS_URL,
    VSCODE_CHAPTERS_URL,
    stashBadgeText,
    actionForPage,
    vscodeLinkAfter,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
