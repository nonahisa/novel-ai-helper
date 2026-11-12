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
    return { items: [], handed: null, ownWorks: [], pending: null, workFacts: [], rankings: [] };
  }

  /**
   * 作品ごとに覚えておくタグと連載の状態（0.17.0。アルファポリスの作品の設定の画面）の上限。
   * 1作品1行で、覚えた作品の上限（記録の20作品）より十分多い数。越えたら古いものから落とす。
   */
  const MAX_WORK_FACTS = 50;

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
        // 0.19.0：渡したランキングの順位（もう一度渡すときに束へ入れる）。0.18.x までの控えには無い
        rankings: 順位だけ(raw.handed.rankings),
      };
    }
    s.rankings = 順位だけ(raw.rankings);
    if (Array.isArray(raw.ownWorks)) {
      s.ownWorks = raw.ownWorks.filter(
        (w) => w && typeof w.siteId === "string" && typeof w.workId === "string"
      );
    }
    if (raw.pending && typeof raw.pending === "object" && typeof raw.pending.workId === "string") {
      s.pending = raw.pending;
    }
    if (Array.isArray(raw.workFacts)) {
      s.workFacts = raw.workFacts
        .filter((f) => f && typeof f.siteId === "string" && typeof f.workId === "string" && typeof f.readAt === "string")
        .map((f) => Object.assign({ siteId: f.siteId, workId: f.workId, readAt: f.readAt }, 事柄だけ(f)))
        .filter((f) => "tags" in f || "completion" in f);
    }
    return s;
  }

  /** タグと連載の状態のうち、形の合うものだけを写す（0.17.0）。 */
  function 事柄だけ(raw) {
    const out = {};
    if (raw && Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === "string")) {
      out.tags = raw.tags.slice(0, 50);
    }
    if (raw && (raw.completion === "ongoing" || raw.completion === "completed")) {
      out.completion = raw.completion;
    }
    return out;
  }

  /**
   * 数の無い画面（アルファポリスの作品の設定の画面）で読んだタグと連載の状態を、作品ごとに覚える（0.17.0）。
   * **作品ごとに新しいもの1つ**。欄ごとに置き換える（タグだけ読めた日に、前に読めた連載の状態を消さない）。
   * これ自体は渡さない——同じ作品の数の1件を束にするとき（makeBundle）に載せる。
   */
  function putFacts(state, siteId, workId, facts, now) {
    const id = normalizeWorkId(siteId, workId);
    const 新しい = 事柄だけ(facts);
    if (id === "" || Object.keys(新しい).length === 0) {
      return state;
    }
    const 前 = (state.workFacts || []).find((f) => f.siteId === siteId && f.workId === id);
    const 行 = Object.assign({}, 前 ? 事柄だけ(前) : {}, 新しい, { siteId, workId: id, readAt: 日時の文字(now) });
    const 残す = (state.workFacts || []).filter((f) => f !== 前).concat([行]);
    return Object.assign({}, state, { workFacts: 残す.slice(Math.max(0, 残す.length - MAX_WORK_FACTS)) });
  }

  /**
   * 封筒に、その作品の覚えたタグと連載の状態を載せた写しを返す（0.17.0）。**封筒に既にある欄は上書きしない**
   * （その画面で読めたものを、別の画面で読んだもので変えない）。載せるものが無ければ渡した封筒をそのまま返す。
   */
  function withFacts(envelope, workFacts, siteId, workId) {
    const id = normalizeWorkId(siteId, workId);
    const 行 = (workFacts || []).find((f) => f.siteId === siteId && normalizeWorkId(siteId, f.workId) === id);
    if (!行) {
      return envelope;
    }
    const 足す = {};
    for (const [k, v] of Object.entries(事柄だけ(行))) {
      if (!Object.prototype.hasOwnProperty.call(envelope, k)) {
        足す[k] = v;
      }
    }
    return Object.keys(足す).length === 0 ? envelope : Object.assign({}, envelope, 足す);
  }

  // -------------------------------------------------------------------------
  // ランキングの順位（0.19.0。束の最上位の rankings。受け手との取り決め 2026-11-02）
  // -------------------------------------------------------------------------

  /**
   * 順位を受けてよいサイト。**なろう（narou）は入れない**（作者の判断 2026-11-02「なろうではヘルパーからの取得はしないでください」）。
   * 読み取り係が作らない値だが、保存が壊れていたときや将来の書き間違いで束へ混ざらないよう、ここでも断る。
   */
  const RANKING_SITE_IDS = ["kakuyomu", "alphapolis"];

  /** 受け手が知っている期間の名前（取り決めの span）。 */
  const RANKING_SPANS = ["daily", "weekly", "monthly", "yearly", "total", "24h", "other"];

  /**
   * 溜める順位の件数の上限。1件は「1つの作品が、1つの区分で、1日に何位だったか」。
   * 作品を数作・それぞれ毎日いくつかの区分を開いても、渡すまでの数日では届かない数にした。
   * 1件は300字ほどなので、300件で10万字に満たない（読者の反応の溜まりの上限 200万字の中に十分収まる）。
   * 越えたら、読んだ日時の古いものから落とす。
   */
  const MAX_RANKINGS = 300;

  /**
   * 順位の1件の形を確かめ、取り決めの欄だけを写す。合わなければ null（その1件だけ捨てる）。
   * 圏外は作らない（読み取り係は、載っている行しか返さない）。
   */
  function normalizeRanking(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const 字 = (v, 上限) => typeof v === "string" && v.trim() !== "" && v.length <= 上限;
    if (
      !RANKING_SITE_IDS.includes(raw.site) ||
      typeof raw.workId !== "string" ||
      !/^[0-9]{1,30}$/.test(raw.workId) ||
      !字(raw.board, 200) ||
      !字(raw.boardLabel, 100) ||
      !RANKING_SPANS.includes(raw.span) ||
      !Number.isSafeInteger(raw.rank) ||
      raw.rank < 1 ||
      typeof raw.date !== "string" ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw.date) ||
      typeof raw.readAt !== "string" ||
      Number.isNaN(Date.parse(raw.readAt))
    ) {
      return null;
    }
    return Object.assign(
      { site: raw.site, workId: raw.workId },
      字(raw.title, 100) ? { title: raw.title } : {},
      { board: raw.board, boardLabel: raw.boardLabel, span: raw.span },
      字(raw.genre, 40) ? { genre: raw.genre } : {},
      { rank: raw.rank, date: raw.date, readAt: raw.readAt }
    );
  }

  /** 並びのうち、形の合う順位だけを写す（合わない1件だけ捨てる）。 */
  function 順位だけ(list) {
    return Array.isArray(list) ? list.map(normalizeRanking).filter((r) => r !== null) : [];
  }

  /** 同じ順位の見分け（取り決め）：サイト＋作品ID＋区分＋日付。同じ鍵は後のもので上書きする。 */
  function rankingKey(r) {
    return [r.site, r.workId, r.board, r.date].join("|");
  }

  /** 読んだ日時の古い順に並べる（同じ日時なら元の並び）。 */
  function 読んだ順(list) {
    return list
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.readAt < b.r.readAt ? -1 : a.r.readAt > b.r.readAt ? 1 : a.i - b.i))
      .map((x) => x.r);
  }

  /**
   * 順位を溜める。同じ鍵があれば置き換え、上限を越えたら読んだ日時の古いものから落とす。
   * 形の合わない1件は黙って捨てる（束も溜まりも断らない。順位は数の記録の添え物）。
   */
  function putRankings(state, entries, limit) {
    const 新しい = 順位だけ(entries);
    if (新しい.length === 0) {
      return state;
    }
    const 鍵たち = new Set(新しい.map(rankingKey));
    const 残す = 読んだ順(((state && state.rankings) || []).filter((r) => !鍵たち.has(rankingKey(r))).concat(新しい));
    const 上限 = Number.isSafeInteger(limit) && limit > 0 ? limit : MAX_RANKINGS;
    return Object.assign({}, state, { rankings: 残す.slice(Math.max(0, 残す.length - 上限)) });
  }

  /** 溜まっている順位の件数。 */
  function countRankings(state) {
    return state && Array.isArray(state.rankings) ? state.rankings.length : 0;
  }

  /**
   * 渡せるものの件数（読者の反応の画面＋順位）。**押したら渡せるか**の判定に使う
   * ——順位だけ溜まっていても、ほかの画面で押せば渡せるように。アイコンの「読3」の印は画面の数のまま（countItems）。
   */
  function countHandable(state) {
    return countItems(state) + countRankings(state);
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
    if (id === "") {
      return state;
    }
    if (isOwnWork(state.ownWorks, siteId, id)) {
      /*
        作者が認めた作品（approved）でも、本人しか開けない画面で読めたら owner-page に上げる（0.17.1）。
        受け手は ownedVia が owner-page の作品だけを作品一覧の枠に出すので、先にアクセス数で「覚える」と
        答えた作品が、作品管理を開いたあとも枠に出ない、を避ける。覚えた日（addedAt）は変えない。
        下げることはしない（owner-page はあとで「覚える」と答えても owner-page のまま）
      */
      const 上げる = how === "owner-page";
      const 変わる = 上げる && state.ownWorks.some((w) => w.siteId === siteId && normalizeWorkId(siteId, w.workId) === id && w.how !== "owner-page");
      return 変わる
        ? Object.assign({}, state, {
            ownWorks: state.ownWorks.map((w) =>
              w.siteId === siteId && normalizeWorkId(siteId, w.workId) === id ? Object.assign({}, w, { how: "owner-page" }) : w
            ),
          })
        : state;
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
    // 説明のページの欄に無いサイト（アルファポリス。0.17.0。本人の画面で覚えた作品だけ）の覚えた作品は、そのまま残す
    // ——欄を保存しただけで、作者の知らないうちに覚えた作品が消えないように
    const 新しい = state.ownWorks.filter((w) => !Object.prototype.hasOwnProperty.call(形, w.siteId));
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
    // 外した作品の分は、溜まり・渡した分の控え・溜まった順位からも消す（作者の答え 2026-11-12「消す」）。
    // 間違えて覚えたほかの方の作品の数を、次の束で受け手へ渡さないため。欄の無いサイトの作品は外れないので触らない
    const 外した = state.ownWorks.filter(
      (w) =>
        Object.prototype.hasOwnProperty.call(形, w.siteId) &&
        !新しい.some((n) => n.siteId === w.siteId && normalizeWorkId(n.siteId, n.workId) === normalizeWorkId(w.siteId, w.workId))
    );
    const 外した作品か = (siteId, workId) =>
      外した.some((w) => w.siteId === siteId && normalizeWorkId(siteId, w.workId) === normalizeWorkId(siteId, workId));
    const 残す = (items) => (Array.isArray(items) ? items.filter((i) => !(i && 外した作品か(i.siteId, i.workId))) : items);
    const 直した = Object.assign({}, state, { ownWorks: 新しい });
    if (外した.length > 0) {
      直した.items = 残す(state.items);
      if (Array.isArray(state.rankings)) {
        直した.rankings = state.rankings.filter((r) => !(r && 外した作品か(r.site, r.workId)));
      }
      if (state.handed && Array.isArray(state.handed.items)) {
        直した.handed = Object.assign({}, state.handed, { items: 残す(state.handed.items) });
        if (Array.isArray(state.handed.rankings)) {
          直した.handed.rankings = state.handed.rankings.filter((r) => !(r && 外した作品か(r.site, r.workId)));
        }
      }
    }
    return { ok: true, state: 直した };
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
    if (!match || match.ok !== true || !match.page) {
      return いいえ;
    }
    // 作品が複数並ぶ本人だけの画面（アルファポリスの作品管理の一覧。0.17.0）は、URL に作品IDが無い。
    // 画面としては溜めてよく、読めた作品ごとに、その作品の画面として改めて決める（裏方が作品IDを入れて呼び直す）
    if (!match.workId && match.page.multiWork === true && match.page.ownerOnly === true) {
      return { stash: true, learnOwn: true, needsApproval: false, siteId: match.siteId, workId: null };
    }
    if (!match.workId) {
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
   *
   * **1件＝1画面のまま並べる**（同じ作品の画面をここで1件にまとめない）。タグ・連載の状態（0.16.0）は、
   * 読めた画面の件にだけ入っている（作品管理の件にはあり、アクセス数の件には無い）。どれを今の値とするかは、
   * 受け手が readAt で決める。
   *
   * 覚えた作品（ownWorks）を渡されたら、その作品を覚えた理由を省いてよい欄 `ownedVia` として添える（0.16.0。
   * 作者の頼み。受け手は「作品の作者管理画面から登録された作品」だけを作品一覧の枠に出すのに使う）：
   *   本人しか開けない画面で覚えた（how が "owner-page"）→ "owner-page"
   *   作者が「覚える」と答えた・説明のページで書いた（how が "approved"）→ "approved"
   * 束にするときの**今の**覚えた作品から引く（溜めたときではない。溜めてから作者が説明のページで
   * 直したかもしれないため）。覚えた作品でなければ欄ごと省く。溜まりの封筒そのものは書き換えない。
   */
  function makeBundle(items, now, ownWorks, workFacts, rankings) {
    const 並び = trimItems(items || [], { maxItems: Infinity, maxChars: Infinity }).items;
    /*
      ランキングの順位（0.19.0）は束の**最上位の rankings**（受け手との取り決め 2026-11-02）。古い受け手は
      kind・version・items・handedAt しか読まないので、黙って捨てる。順位が無ければ欄ごと省く。読んだ順に並べる。
    */
    const 順位 = 読んだ順(順位だけ(rankings));
    return Object.assign(
      {
        kind: BUNDLE_KIND,
        version: BUNDLE_VERSION,
        handedAt: 日時の文字(now),
        items: 並び.map((i) => {
          // 数の無い画面で覚えたタグと連載の状態を、同じ作品の数の1件に載せる（0.17.0。その件に無い欄だけ）
          const 封筒 = withFacts(i.envelope, workFacts, i.siteId, i.workId);
          const 理由 = 覚えた理由(ownWorks, i.siteId, i.workId);
          return 理由 ? Object.assign({}, 封筒, { ownedVia: 理由 }) : 封筒;
        }),
      },
      順位.length > 0 ? { rankings: 順位 } : {}
    );
  }

  /** 覚えた作品の how を、封筒の ownedVia の値にする（知らない how・覚えていない作品は undefined）。 */
  function 覚えた理由(ownWorks, siteId, workId) {
    if (!Array.isArray(ownWorks) || typeof siteId !== "string") {
      return undefined;
    }
    const id = normalizeWorkId(siteId, workId);
    const w = ownWorks.find((o) => o && o.siteId === siteId && normalizeWorkId(siteId, o.workId) === id);
    return w && (w.how === "owner-page" || w.how === "approved") ? w.how : undefined;
  }

  /**
   * 渡したあと：溜まりを空にし、渡した分を控えへ移す（前の控えは捨てる）。
   * 渡せなかったとき（クリップボードへ置けなかった）は呼ばない——溜まりはそのまま残る。
   */
  function afterHanded(state, items, now, rankings) {
    // 0.19.0：渡した順位も溜まりから外して控えへ（まとめているあいだに読んだ順位は、渡したことにしない）
    const 渡した順位 = Array.isArray(rankings) ? rankings : [];
    return Object.assign({}, state, {
      items: state.items.filter((i) => !items.some((h) => h.key === i.key && h.storedAt === i.storedAt)),
      rankings: ((state && state.rankings) || []).filter(
        (r) => !渡した順位.some((h) => rankingKey(h) === rankingKey(r) && h.readAt === r.readAt)
      ),
      handed: { handedAt: 日時の文字(now), items: items.slice(), rankings: 渡した順位.slice() },
    });
  }

  /** 控えが古くなっていたら捨てる（7日）。 */
  function pruneHanded(state, now) {
    if (!state.handed) {
      return state;
    }
    const 渡した = Date.parse(state.handed.handedAt);
    const いま = (now instanceof Date ? now : new Date()).getTime();
    const 空 = state.handed.items.length === 0 && countRankings(state.handed) === 0;
    if (Number.isNaN(渡した) || いま - 渡した > HANDED_KEEP_MS || 空) {
      return Object.assign({}, state, { handed: null });
    }
    return state;
  }

  /**
   * 溜まっている分の内訳（知らせと説明のページに出す）。
   * 順位（0.19.0）を渡されたときだけ、その件数を rankings として添える（渡さなければ 0.18.x までと同じ形）。
   */
  function summarize(items, rankings) {
    const 作品 = new Set(items.map((i) => `${i.siteId}|${i.workId}`));
    const 件数 = items.reduce(
      (n, i) => n + (i.counts ? (i.counts.work || 0) + (i.counts.day || 0) + (i.counts.episode || 0) : 0),
      0
    );
    const 内訳 = { pages: items.length, works: 作品.size, entries: 件数 };
    return Array.isArray(rankings) ? Object.assign(内訳, { rankings: rankings.length }) : 内訳;
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
    putFacts,
    withFacts,
    stashDecision,
    pageNumberOf,
    itemKey,
    makeItem,
    putItem,
    trimItems,
    countItems,
    RANKING_SITE_IDS,
    RANKING_SPANS,
    MAX_RANKINGS,
    normalizeRanking,
    rankingKey,
    putRankings,
    countRankings,
    countHandable,
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
