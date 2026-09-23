"use strict";

/**
 * 読者の反応を**拡張の中に溜めて、まとめて1回で渡す**ための素の判定（0.9.0）。
 *
 * 作者の依頼（2026-09-23）「ヘルパーの情報収集ですが、キャッシュして渡すことはできないでしょうか？」
 * への答え。0.8.x までは、読者の反応の画面を開くたびに押して、コピーして、VS Code へ取り込んで…を
 * ページの数だけ繰り返していた（カクヨムのアクセス数は50話ずつで、219話なら5回）。
 * 0.9.0 からは、**自分の作品の画面を開いたときに自動で読んで溜め**、押したときに
 * **溜まった分を1つのデータに束ねて**クリップボードへ置く。
 *
 * ## このファイルは Chrome に触れない
 *
 * 保存（chrome.storage.local）の読み書きは裏方（background.js）だけがする。ここは
 * 「何を溜めてよいか」「同じページをどう置き換えるか」「上限でどれを落とすか」「束の形」を
 * 決める関数だけで、テストから直接呼べる。
 *
 * ## 他人の作品は溜めない（作者の裁定、2026-09-23）
 *
 * 溜めてよいのは**ご自分の作品だと分かっているもの**だけ。
 * - カクヨムの**作品管理**（/my/works/作品ID）は、ログインした本人しか開けない
 *   （ログインしていなければログインの画面へ回される）。表の `ownerOnly` の印がそれで、
 *   開いて読めたら、その作品IDを「自分の作品」として覚える
 * - カクヨムの**アクセス数**（/works/作品ID/accesses）は、**ログインしていなくても誰の作品でも開ける**
 *   （2026-09-23 に確かめた）。だから覚えた作品IDのときだけ溜める
 * - **Narou.fun** は誰の作品のページでも開ける。作者が「自分の作品として覚える」と認めた
 *   Nコードのときだけ溜める
 *
 * 保存は拡張の中（chrome.storage.local）で、通信ではない。どこへも送らない。
 */
(function (global) {
  /** 束の目印と版。統合小説執筆環境の受け取り口と揃える（形は README の「束の形」）。 */
  const BUNDLE_KIND = "novelai-stats-bundle";
  const BUNDLE_VERSION = 1;

  /** 1件ずつのデータ（読み取り係が作る形）の目印と版。溜める前に形を確かめる。 */
  const ITEM_MARKER = "novelai-stats";
  const ITEM_VERSION = 1;

  /**
   * 溜める量の上限。**件数と大きさの両方**で見る。
   *
   * - 件数：1件は「1つの作品の1つの画面（アクセス数ならそのページ）」。50件は、作品を10ほど、
   *   それぞれ作品管理とアクセス数を数ページ開いても届かない数
   * - 大きさ：データの文字数の合計。219話の作品管理で1件2万字ほど。200万字は、
   *   chrome.storage.local の持ち分（10MB）の中に、渡した分の控えと一緒に余裕で収まる大きさ
   *
   * 越えたら**いちばん前に溜めたものから落とす**。新しく読んだもののほうが、作者がいま見たい数だから。
   */
  const LIMITS = { maxItems: 50, maxChars: 2000000 };

  /**
   * 渡した分の控えを残す長さ（7日）。
   *
   * 統合小説執筆環境が受け取れたかは、この拡張には分からない（通信しないので、返事が来ない）。
   * だから渡した分はすぐに消さず、「もう一度渡す」ができるように控えておく。
   * 控えは**次に渡すまで**、長くても7日。それより前の分は、統合小説執筆環境の記録にもう入っているか、
   * 入っていなければ画面を開き直せば読み直せる。
   */
  const HANDED_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

  /** 何も溜まっていない状態。 */
  function emptyState() {
    return { items: [], handed: null, ownWorks: [], pending: null };
  }

  /**
   * 保存から読んだものを、形を確かめながら状態にする。**壊れた欄は空として扱う**
   * （欄ごとに捨てる）。保存の形を変えた日に、古い形のせいで押しても何も起きない、を避ける。
   */
  function normalizeState(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== "object") {
      return s;
    }
    if (Array.isArray(raw.items)) {
      s.items = raw.items.filter(溜めた1件の形か);
    }
    if (raw.handed && typeof raw.handed === "object" && Array.isArray(raw.handed.items)) {
      s.handed = {
        handedAt: String(raw.handed.handedAt || ""),
        items: raw.handed.items.filter(溜めた1件の形か),
      };
    }
    if (Array.isArray(raw.ownWorks)) {
      s.ownWorks = raw.ownWorks.filter(
        (w) => w && typeof w.siteId === "string" && typeof w.workId === "string"
      );
    }
    if (raw.pending && typeof raw.pending === "object" && typeof raw.pending.workId === "string") {
      s.pending = raw.pending;
    }
    return s;
  }

  function 溜めた1件の形か(item) {
    return (
      item &&
      typeof item === "object" &&
      typeof item.key === "string" &&
      typeof item.storedAt === "string" &&
      item.envelope &&
      typeof item.envelope === "object"
    );
  }

  /**
   * 作品IDを揃える。Nコードは大文字でも小文字でも同じ作品なので、小文字にする
   * （`N1234AB` で覚えて `n1234ab` のページを開いたときに、別の作品と見なさないため）。
   */
  function normalizeWorkId(siteId, workId) {
    const id = String(workId || "").trim();
    return siteId === "narouFun" ? id.toLowerCase() : id;
  }

  /** 覚えた作品の中に、その作品があるか。 */
  function isOwnWork(ownWorks, siteId, workId) {
    const id = normalizeWorkId(siteId, workId);
    if (id === "") {
      return false;
    }
    return (ownWorks || []).some((w) => w.siteId === siteId && normalizeWorkId(siteId, w.workId) === id);
  }

  /**
   * 作品を「自分の作品」として覚える。既に覚えていれば何もしない（二重にしない）。
   *
   * @param {"owner-page"|"approved"} how どうして覚えたか（作品管理を開けた／作者が認めた）。
   *        説明のページで、作者がどれを自分で認めたかを見分けられるように残す
   */
  function rememberOwnWork(state, siteId, workId, how, now) {
    const id = normalizeWorkId(siteId, workId);
    if (id === "" || isOwnWork(state.ownWorks, siteId, id)) {
      return state;
    }
    return Object.assign({}, state, {
      ownWorks: state.ownWorks.concat([{ siteId, workId: id, how, addedAt: 日時の文字(now) }]),
      // 訊いていた作品を覚えたら、訊きかけの印は外す
      pending: state.pending && state.pending.siteId === siteId && normalizeWorkId(siteId, state.pending.workId) === id
        ? null
        : state.pending,
    });
  }

  /**
   * 覚えた作品の一覧を、説明のページで直した1行ずつの文字から作り直す。
   *
   * 形の合わない行が1つでもあれば**何も変えずに**断る（どの行かを返す）
   * ——黙って飛ばすと、打ち間違えた作品が覚えられていないことに作者が気づけない。
   *
   * @param {{kakuyomu:string, narouFun:string}} texts それぞれの欄の文字
   * @returns {{ok:true, state:object}|{ok:false, bad:string[]}}
   */
  function replaceOwnWorksFromText(state, texts, now) {
    const 形 = {
      kakuyomu: /^[0-9]{5,30}$/,
      // 統合小説執筆環境の Nコードと同じ形（N＋4桁＋英字1〜2字）
      narouFun: /^[Nn][0-9]{4}[A-Za-z]{1,2}$/,
    };
    const 悪い行 = [];
    const 新しい = [];
    for (const siteId of Object.keys(形)) {
      const 行たち = String((texts && texts[siteId]) || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s !== "");
      for (const 行 of 行たち) {
        if (!形[siteId].test(行)) {
          悪い行.push(行);
          continue;
        }
        const id = normalizeWorkId(siteId, 行);
        if (新しい.some((w) => w.siteId === siteId && w.workId === id)) {
          continue;
        }
        // もともと覚えていた作品は、覚えた日と理由をそのまま残す
        const 前から = state.ownWorks.find((w) => w.siteId === siteId && normalizeWorkId(siteId, w.workId) === id);
        新しい.push(前から || { siteId, workId: id, how: "approved", addedAt: 日時の文字(now) });
      }
    }
    if (悪い行.length > 0) {
      return { ok: false, bad: 悪い行 };
    }
    return { ok: true, state: Object.assign({}, state, { ownWorks: 新しい }) };
  }

  /**
   * 開いた画面を溜めてよいか（開いたとき・押したときの両方で使う）。
   *
   * @param {object} match content/statsSites.js の matchReadPage の結果
   * @param {Array} ownWorks 覚えた作品
   * @returns {{stash:boolean, learnOwn:boolean, needsApproval:boolean, siteId?:string, workId?:string}}
   *   stash         … 溜めてよい
   *   learnOwn      … 読めたら、この作品を自分の作品として覚える（作品管理のような本人だけの画面）
   *   needsApproval … 誰の作品でも開ける画面で、まだ覚えていない作品。押したら作者に訊く
   */
  function stashDecision(match, ownWorks) {
    const いいえ = { stash: false, learnOwn: false, needsApproval: false };
    if (!match || match.ok !== true || !match.page || !match.workId) {
      return いいえ;
    }
    const siteId = match.siteId;
    const workId = normalizeWorkId(siteId, match.workId);
    if (match.page.ownerOnly === true) {
      return { stash: true, learnOwn: true, needsApproval: false, siteId, workId };
    }
    if (isOwnWork(ownWorks, siteId, workId)) {
      return { stash: true, learnOwn: false, needsApproval: false, siteId, workId };
    }
    return { stash: false, learnOwn: false, needsApproval: true, siteId, workId };
  }

  /**
   * ページ送りのある画面なら、何ページ目か（アクセス数の `?page=2`）。無ければ 1。
   * 表の readPages の `pageParam` が決める——ページ送りの無い画面は、問い合わせの部分を見ない。
   */
  function pageNumberOf(url, page) {
    if (!page || !page.pageParam) {
      return 1;
    }
    try {
      const n = Number(new URL(String(url)).searchParams.get(page.pageParam));
      return Number.isSafeInteger(n) && n >= 1 ? n : 1;
    } catch (_e) {
      return 1;
    }
  }

  /**
   * 同じ画面かどうかの鍵。**サイト・画面の種類・作品・ページ**で決める。
   * 同じ鍵を2度読んだら、新しいほうで置き換える（二重にしない）。
   * 読んだ日時は鍵に入れない——入れると、開くたびに同じページが増えていく。
   */
  function itemKey(match, url) {
    const workId = normalizeWorkId(match.siteId, match.workId);
    return [match.siteId, match.page.kind, workId, String(pageNumberOf(url, match.page))].join("|");
  }

  /**
   * 読み取り係の結果から、溜める1件を作る。形を確かめ、合わなければ溜めない。
   *
   * @param {{json:string, counts?:object}} result content/read.js の readStats の結果（ok のもの）
   * @param {object} match matchReadPage の結果
   * @param {string} url 読んだページのURL
   * @returns {{ok:true, item:object}|{ok:false, reason:string}}
   */
  function makeItem(result, match, url, now) {
    let envelope;
    try {
      envelope = JSON.parse(String(result && result.json));
    } catch (_e) {
      return { ok: false, reason: "not-json" };
    }
    if (!envelope || typeof envelope !== "object" || envelope[ITEM_MARKER] !== ITEM_VERSION || !Array.isArray(envelope.entries)) {
      return { ok: false, reason: "not-stats" };
    }
    if (envelope.entries.length === 0) {
      return { ok: false, reason: "empty" };
    }
    const 大きさ = String(result.json).length;
    if (大きさ > LIMITS.maxChars) {
      return { ok: false, reason: "too-large" };
    }
    const c = (result && result.counts) || {};
    return {
      ok: true,
      item: {
        key: itemKey(match, url),
        siteId: match.siteId,
        pageKind: match.page.kind,
        pageLabel: match.page.label || "",
        workId: normalizeWorkId(match.siteId, match.workId),
        page: pageNumberOf(url, match.page),
        storedAt: 日時の文字(now),
        size: 大きさ,
        counts: { work: c.work || 0, day: c.day || 0, episode: c.episode || 0 },
        envelope,
      },
    };
  }

  /**
   * 1件を溜める。**同じ鍵があれば置き換える**（位置は新しいものとして末尾へ）。
   * そのあと上限を越えていれば、前に溜めたものから落とす。
   *
   * @returns {{state:object, dropped:object[]}} dropped は上限で落としたもの
   */
  function putItem(state, item, limits) {
    const 上限 = limits || LIMITS;
    const 残す = state.items.filter((i) => i.key !== item.key).concat([item]);
    const 削った = trimItems(残す, 上限);
    return { state: Object.assign({}, state, { items: 削った.items }), dropped: 削った.dropped };
  }

  /** 上限（件数・大きさ）を越えた分を、溜めた日時の古いほうから落とす。 */
  function trimItems(items, limits) {
    const 上限 = limits || LIMITS;
    // 溜めた順に並べる（同じ日時なら元の並びのまま）
    const 並び = items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => (a.item.storedAt < b.item.storedAt ? -1 : a.item.storedAt > b.item.storedAt ? 1 : a.i - b.i))
      .map((x) => x.item);
    const dropped = [];
    let 合計 = 並び.reduce((n, i) => n + (i.size || 0), 0);
    while (並び.length > 0 && (並び.length > 上限.maxItems || 合計 > 上限.maxChars)) {
      const 古い = 並び.shift();
      合計 -= 古い.size || 0;
      dropped.push(古い);
    }
    return { items: 並び, dropped };
  }

  /** 溜まっている件数（画面の数。アイコンの印に出す）。 */
  function countItems(state) {
    return state && Array.isArray(state.items) ? state.items.length : 0;
  }

  /**
   * 束を作る。**溜めた順に並べる**（統合小説執筆環境は1件ずつ取り込むので、古いものから入れる）。
   *
   * 形（統合小説執筆環境の受け取り口との取り決め。README の「束の形」）：
   *   { kind: "novelai-stats-bundle", version: 1, handedAt: ISO 8601, items: [ 1件ずつのデータ, … ] }
   * items の1つずつは、0.8.0 までクリップボードへ置いていたデータ（novelai-stats v1）と**同じ形**。
   */
  function makeBundle(items, now) {
    const 並び = trimItems(items, { maxItems: Infinity, maxChars: Infinity }).items;
    return {
      kind: BUNDLE_KIND,
      version: BUNDLE_VERSION,
      handedAt: 日時の文字(now),
      items: 並び.map((i) => i.envelope),
    };
  }

  /**
   * 渡したあと：溜まりを空にし、渡した分を控えへ移す（前の控えは捨てる）。
   * 渡せなかったとき（クリップボードへ置けなかった）は呼ばない——溜まりはそのまま残る。
   */
  function afterHanded(state, items, now) {
    return Object.assign({}, state, {
      items: state.items.filter((i) => !items.some((h) => h.key === i.key && h.storedAt === i.storedAt)),
      handed: { handedAt: 日時の文字(now), items: items.slice() },
    });
  }

  /** 控えが古くなっていたら捨てる（7日）。 */
  function pruneHanded(state, now) {
    if (!state.handed) {
      return state;
    }
    const 渡した = Date.parse(state.handed.handedAt);
    const いま = (now instanceof Date ? now : new Date()).getTime();
    if (Number.isNaN(渡した) || いま - 渡した > HANDED_KEEP_MS || state.handed.items.length === 0) {
      return Object.assign({}, state, { handed: null });
    }
    return state;
  }

  /** 溜まっている分の内訳（知らせと説明のページに出す）。 */
  function summarize(items) {
    const 作品 = new Set(items.map((i) => `${i.siteId}|${i.workId}`));
    const 件数 = items.reduce(
      (n, i) => n + (i.counts ? (i.counts.work || 0) + (i.counts.day || 0) + (i.counts.episode || 0) : 0),
      0
    );
    return { pages: items.length, works: 作品.size, entries: 件数 };
  }

  /** 日時を ISO 8601 の文字にする（テストで固定できるように、now を受ける）。 */
  function 日時の文字(now) {
    const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return d.toISOString();
  }

  const api = {
    BUNDLE_KIND,
    BUNDLE_VERSION,
    LIMITS,
    HANDED_KEEP_MS,
    emptyState,
    normalizeState,
    normalizeWorkId,
    isOwnWork,
    rememberOwnWork,
    replaceOwnWorksFromText,
    stashDecision,
    pageNumberOf,
    itemKey,
    makeItem,
    putItem,
    trimItems,
    countItems,
    makeBundle,
    afterHanded,
    pruneHanded,
    summarize,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHStash = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
