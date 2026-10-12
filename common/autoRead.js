"use strict";

/**
 * 開いたときの自動取得を、**ページの種類ごとに作者に訊いて決める**（0.14.0。作者の依頼、2026-10-12
 * 「最初にこのページで自動取得するか聞いて、承認されればあとは Chrome のアイコンから吹き出しで
 * 『取得しました』と出るようにできませんか？　取得系は全ページ同様です」）。
 *
 * ## ページの種類とは
 *
 * **サイト＋画面の種類**（作品ごとではない）。「カクヨムの作品管理」「カクヨムのアクセス数」
 * 「Narou.fun の作品ページ」「ノベルポータルの公募の一覧」「ツクリテミライの公募の一覧」の5つ。
 * 作品ごとに訊くと、作品を足すたびに同じことを訊かれる。どなたの作品を記録してよいかは、
 * これまでどおり「自分の作品として覚えた作品」（common/stash.js の stashDecision）が決める
 * ——ここで「自動で取得する」と答えても、覚えていない作品の画面は読まない。
 *
 * ## 答えの形（保存の鍵 autoReadConsent。読み書きは裏方 background.js だけ）
 *
 *   { pages: { "kakuyomu|work": { choice, by, at }, … } }
 *   choice … "auto"（開いたときに自動で取得する）／"manual"（今までどおり押して取得する）／
 *            "asked"（訊いたが、まだ答えていない。**二度は訊かない**——吹き出しを閉じた・知らせを流した方に、
 *            開くたびに同じことを訊き続けないため。説明のページから決められる）
 *   by     … "author"（作者が答えた・説明のページで変えた）／"update"（0.13.x 以前から更新した方。下）／
 *            "traces"（保存が無いまま動いたときに推した値）
 *   鍵が無いページの種類は「まだ決めていない」＝開いたときに一度だけ訊く
 *
 * ## 更新した方は、読者の反応の画面を「自動」で始める
 *
 * 0.9.0 から 0.13.x まで、ご自分の作品の読者の反応の画面は**訊かずに**開いたときに読んでいた
 * （集計の記録もそこで付く）。更新した日に黙って止めると、答えるまで集計が欠ける。
 * 「統合小説執筆環境へ渡す」（common/settings.js）が更新した方を入れたままにしたのと同じ考えで、
 * 更新した方は読者の反応の3種類を「自動」にしておく。公募の一覧は 0.13.x まで押したときだけ
 * 読んでいたので、更新した方にも訊く。新しく入れた方には全部を訊く。
 *
 * このファイルは Chrome に触れない（保存も知らせもしない）。テストから直接呼べる。
 */
(function (global) {
  const CHOICES = ["auto", "manual", "asked"];
  const DECIDED_BY = ["author", "update", "traces"];

  /** ページの種類の鍵。サイトのIDと画面の種類を「|」でつなぐ（溜まりの鍵 itemKey と同じ区切り）。 */
  function pageTypeKey(siteId, kind) {
    return `${siteId}|${kind}`;
  }

  /** 読者の反応の画面（statsSites.js の matchReadPage の結果）の鍵。読めない画面なら null。 */
  function pageTypeForStats(match) {
    if (!match || match.ok !== true || !match.page || !match.siteId) {
      return null;
    }
    return pageTypeKey(match.siteId, match.page.kind);
  }

  /**
   * 公募の一覧のページ（contestSites.js の matchContestPage の結果）の鍵。
   * ノベルポータルは2ページあるが、同じサイトの同じ画面の種類なので1つ（作者には1度だけ訊く）。
   */
  function pageTypeForContest(match) {
    if (!match || match.ok !== true || !match.site || !match.site.id) {
      return null;
    }
    return pageTypeKey(match.site.id, "contests");
  }

  /**
   * 訊く・選べるページの種類の一覧（説明のページと、更新したときに「自動」にする範囲）。
   * 表から作る——ここへ書き写すと、表に画面を足した日に、訊かれない画面ができる。
   * 読み取りを止めてあるサイト（アルファポリス。supported:false）は並べない。
   *
   * @returns {{key:string, label:string, group:"stats"|"contests"}[]}
   */
  function listPageTypes(statsSites, contestSites) {
    const 一覧 = [];
    for (const site of statsSites || []) {
      if (!site.supported) {
        continue;
      }
      for (const page of site.readPages || []) {
        const 名 = site.id === "narouFun" ? `${site.label} の${page.label}` : `${site.label}の${page.label}`;
        一覧.push({ key: pageTypeKey(site.id, page.kind), label: 名, group: "stats" });
      }
    }
    for (const site of contestSites || []) {
      一覧.push({ key: pageTypeKey(site.id, "contests"), label: `${site.label}の公募の一覧`, group: "contests" });
    }
    return 一覧;
  }

  /** 保存から読んだものを形に揃える。形の合わない行は捨てる（捨てた種類は「まだ決めていない」に戻る）。 */
  function normalizeConsent(raw) {
    const 答え = { pages: {} };
    if (!raw || typeof raw !== "object" || !raw.pages || typeof raw.pages !== "object") {
      return 答え;
    }
    for (const [key, v] of Object.entries(raw.pages)) {
      if (!v || typeof v !== "object" || !CHOICES.includes(v.choice) || typeof key !== "string" || key === "") {
        continue;
      }
      答え.pages[key] = {
        choice: v.choice,
        by: DECIDED_BY.includes(v.by) ? v.by : "traces",
        at: typeof v.at === "string" ? v.at : "",
      };
    }
    return 答え;
  }

  /** そのページの種類の答え。まだ決めていなければ null。 */
  function choiceFor(consent, key) {
    const 行 = consent && consent.pages ? consent.pages[key] : null;
    return 行 ? 行.choice : null;
  }

  /** 開いたときに訊くか（まだ一度も訊いていない・決めていない）。 */
  function shouldAsk(consent, key) {
    return typeof key === "string" && key !== "" && choiceFor(consent, key) === null;
  }

  /** 開いたときに自動で取得するか。 */
  function isAuto(consent, key) {
    return choiceFor(consent, key) === "auto";
  }

  function 日時の文字(now) {
    const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return d.toISOString();
  }

  /** 答えを置く（新しい形を返す。元は変えない）。choice が null なら消す（＝まだ決めていない＝次に開いたら訊く）。 */
  function setChoice(consent, key, choice, by, now) {
    const pages = Object.assign({}, (consent && consent.pages) || {});
    if (choice === null) {
      delete pages[key];
    } else {
      pages[key] = { choice, by, at: 日時の文字(now) };
    }
    return { pages };
  }

  /** 訊いたことを残す（答えが来るまで「asked」。二度は訊かない）。 */
  function markAsked(consent, key, now) {
    return setChoice(consent, key, "asked", "author", now);
  }

  /**
   * 保存に答えが無いまま動いたとき（裏方が更新の知らせより先に起きた等）に推す値。
   * 0.9.0 以降を使っていた形跡（溜まり・控え・覚えた作品。common/settings.js の hasHandTraces）があれば、
   * 読者の反応の画面は「自動」（更新した方と同じ）。無ければ何も決めない（開いたときに訊く）。
   */
  function consentWhenMissing(hadTraces, types, now) {
    let 答え = { pages: {} };
    if (hadTraces === true) {
      for (const t of types || []) {
        if (t.group === "stats") {
          答え = setChoice(答え, t.key, "auto", "traces", now);
        }
      }
    }
    return 答え;
  }

  /**
   * 入れた・更新した知らせ（chrome.runtime.onInstalled）が届いたときに書く答え。変えないなら null。
   *
   * - update：読者の反応の画面のうち、**作者がまだ答えていない種類だけ**「自動」にする
   *   （作者が「押して取得する」と答えた種類を、次の版への更新で黙って戻さない）
   * - install：何も決めない（保存が無いことを「まだ訊いていない」として残すため、空の形を書く）
   * - それ以外（Chrome 自身の更新など）：変えない
   *
   * @param {object|null} existing 保存にある答え（normalizeConsent を通したもの。無ければ null）
   */
  function consentOnInstalled(existing, reason, types, now) {
    if (reason === "update") {
      let 答え = existing || { pages: {} };
      let 変えた = existing === null;
      for (const t of types || []) {
        if (t.group !== "stats") {
          continue;
        }
        const 行 = 答え.pages[t.key];
        if (!行 || 行.by === "traces") {
          答え = setChoice(答え, t.key, "auto", "update", now);
          変えた = true;
        }
      }
      return 変えた ? 答え : null;
    }
    if (reason === "install") {
      return existing ? null : { pages: {} };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 公募の一覧の棚（保存の鍵 contestShelf）
  // -------------------------------------------------------------------------

  /**
   * 開いたときに取得した公募の一覧を置く棚（0.14.0）。**ページごとに最新の1つだけ**。
   *
   * 公募の一覧は、読者の反応の溜まり（common/stash.js）には入れない。束（novelai-stats-bundle）は
   * 読者の反応の形で、統合小説執筆環境の取り込み口も別（import-contests）だから。
   * 渡すのはこれまでどおり公募の一覧のページでアイコンを押したとき——押したときは画面を読み直し、
   * 読めなかったときだけ棚の分を使う。棚に置くのは、誰でも見られる募集の情報（名前・締切など）だけ。
   */
  const SHELF_LIMIT = 10;

  /** 同じページかどうかの鍵。ページ送り（?page=2）は別のページ。アドレスの # は見ない。 */
  function shelfKey(url) {
    try {
      const u = new URL(String(url));
      const ページ = u.searchParams.get("page");
      const 道 = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
      return `${u.hostname}${道}${ページ ? `?page=${ページ}` : ""}`;
    } catch (_e) {
      return "";
    }
  }

  function normalizeShelf(raw) {
    const items =
      raw && typeof raw === "object" && Array.isArray(raw.items)
        ? raw.items.filter((i) => i && typeof i.key === "string" && typeof i.envelope === "string")
        : [];
    return { items };
  }

  /**
   * 棚に置く。同じページは置き換え、上限を越えたら古いものから落とす。
   * @param {{envelope:string, count:number, skipped:number, paged:boolean, siteId:string}} result 公募の読み取り係の結果
   */
  function putShelf(shelf, result, url, now) {
    const key = shelfKey(url);
    const 残す = normalizeShelf(shelf).items.filter((i) => i.key !== key);
    残す.push({
      key,
      siteId: String((result && result.siteId) || ""),
      storedAt: 日時の文字(now),
      count: Number(result && result.count) || 0,
      skipped: Number(result && result.skipped) || 0,
      paged: Boolean(result && result.paged),
      envelope: String(result.envelope),
    });
    return { items: 残す.slice(-SHELF_LIMIT) };
  }

  /** そのページの棚の分（無ければ null）。読み取り係の結果と同じ形で返す（そのまま渡す処理へ入れられる）。 */
  function findShelf(shelf, url) {
    const key = shelfKey(url);
    const 行 = normalizeShelf(shelf).items.find((i) => i.key === key && key !== "");
    return 行
      ? { ok: true, envelope: 行.envelope, count: 行.count, skipped: 行.skipped, paged: 行.paged, siteId: 行.siteId }
      : null;
  }

  const api = {
    SHELF_LIMIT,
    shelfKey,
    normalizeShelf,
    putShelf,
    findShelf,
    CHOICES,
    pageTypeKey,
    pageTypeForStats,
    pageTypeForContest,
    listPageTypes,
    normalizeConsent,
    choiceFor,
    shouldAsk,
    isAuto,
    setChoice,
    markAsked,
    consentWhenMissing,
    consentOnInstalled,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHAutoRead = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
