"use strict";

/**
 * 拡張の裏方（Manifest V3 の service worker。0.8.0、0.9.0 で溜める仕組みを足した）。
 *
 * 0.7.x まではポップアップが全部をしていた。作者の依頼（2026-09-23）で、
 * **アイコンを押す（または右クリックの項目を選ぶ）だけで、いまの画面でできる1つのことを実行する**
 * 形に変えたので、その流れをここへ移した。
 *
 *   アイコン・右クリック → いまのタブのURLで、できることを決める（common/actions.js）
 *     → 貼り込み：クリップボードを読む → 封筒か確かめる → 開いている画面と照合する
 *                 → ページ側（content/fill.js）へ「埋めて」と伝える → 結果を知らせる
 *     → まとめて渡す（0.9.0）：読者の反応の画面なら、その画面を読み直して溜める
 *                 → 溜まった分を1つの束にしてクリップボードへ置く → 知らせる → VS Code を呼ぶ
 *     → 自分の作品か訊く（0.9.0）：誰の作品でも開ける画面で、まだ覚えていない作品
 *
 *   ページが開いた（content/announce.js）→ ご自分の作品の読者の反応の画面なら、読んで溜める（0.9.0）
 *     → 0.14.0：読むのは、作者が「開いたときに自動で取得する」と答えたページの種類だけ（common/autoRead.js）。
 *       まだ決めていない種類なら一度だけ訊き、取得したらアイコンの吹き出し（bubble.html）で「取得しました」と出す。
 *       公募の一覧のページも同じ（取得した分は公募の棚に置き、渡すのは押したとき）。VS Code は呼ばない
 *     → 溜めたものは、集計のための記録（readerHistory）にも畳み込む（0.10.0。渡しても消さない。common/history.js）
 *     → 読み取り係が作品名を添えていれば、記録の側にだけ添える（0.13.1。集計の見出しを作品名にする。溜まりには入れない）
 *
 *   アイコンの右クリック「集計を表示」→ 説明のページを開く（0.10.0。集計はそこにある）
 *
 *   「統合小説執筆環境へ渡す」を切っているとき（0.11.0。common/settings.js）
 *     → アイコンを押すと集計を開く（「?」の画面は訊き、話の作成画面は貼り込む。0.11.1）。溜まりには溜めず、記録にだけ残す。全体の印を出さない
 *
 *   公募の一覧のページ（0.12.0。content/contestSites.js）でアイコン・右クリックを押す
 *     → 読み取り係（content/contestRead.js）へ「読んで」と頼む → 公募の一覧をクリップボードへ置く
 *     → 「統合小説執筆環境へ渡す」が入っていれば VS Code を呼ぶ（切っていれば置くだけ）。**拡張の中には溜めない**
 *
 * 照合（checkTarget・matchReadPage）をページ側でなくここで行うのは 0.7.x と同じ理由で、
 * **合わないページにはそもそも触れない**ため。合わなければメッセージすら送らない。
 *
 * ## 溜める（0.9.0。作者の依頼「キャッシュして渡すことはできないでしょうか？」）
 *
 * 溜まりは chrome.storage.local（拡張の中の保存。通信ではない）に置く。**ここ以外のファイルは
 * 保存に触れない**（test/redLine.test.js が見張る）。何を溜めてよいか・上限・束の形は common/stash.js。
 * 他人の作品は溜めない——誰の作品でも開ける画面では、作者が「自分の作品」と認めた作品だけ。
 *
 * ## ここにも通信のコードは無い
 *
 * 読むのはクリップボードとタブのURLだけ。VS Code を呼ぶのは、手元の VS Code を
 * `vscode://` のリンクで前に出すだけで、どこのサーバーへも何も送らない（データはリンクに載せない）。
 *
 * 表と判定は、ページ側・拡張のページと**同じファイル**を読む（写しを作らない）。
 * 読む順番は 0.7.x の popup.html と同じ（describePage が両方の表を使うため、表の2つが先）。
 */
importScripts(
  "common/messages.js",
  "common/envelope.js",
  "common/match.js",
  "content/sites.js",
  "content/statsSites.js",
  "content/contestSites.js",
  "common/pageState.js",
  "common/actions.js",
  "common/stash.js",
  "common/history.js",
  "common/settings.js",
  "common/autoRead.js",
  "common/rankings.js",
  "common/posted.js"
);

const Envelope = globalThis.NPHEnvelope;
const Match = globalThis.NPHMatch;
const Messages = globalThis.NPHMessages;
const PageState = globalThis.NPHPageState;
const Sites = globalThis.NPHSites;
const StatsSites = globalThis.NPHStatsSites;
const ContestSites = globalThis.NPHContestSites;
const Actions = globalThis.NPHActions;
const Stash = globalThis.NPHStash;
const History = globalThis.NPHHistory;
const Settings = globalThis.NPHSettings;
const AutoRead = globalThis.NPHAutoRead;
const Rankings = globalThis.NPHRankings;
const Posted = globalThis.NPHPosted;

/** 右クリックの項目は1つだけ。名前と出す・出さないを、いまのタブに合わせて付け替える。 */
const MENU_ID = "novelai-helper-run";

/**
 * アイコンを右クリックしたときの項目「集計を表示」（0.10.0。0.13.2 までは「読者の反応の集計を見る」）。
 * 集計は説明のページにあるので、それを開く。Chrome が付ける「オプション」と同じページだが、
 * 「オプション」の名では集計があると分からないため、名を付けて並べる。
 */
const REPORT_MENU_ID = "novelai-helper-report";

/**
 * カクヨムの作品管理の画面の右クリックにだけ出す項目「章立てを取得」（0.13.0。0.13.2 までは「章立てを統合小説執筆環境へ渡す」）。
 *
 * **アイコンの行いとは分ける。** 作品管理の画面でアイコンを押すと「読者の反応を取得」（まとめて渡す）
 * （0.9.0 からの約束。作者の依頼「画面で実行できるのは一つだけ」）。章立ては同じ画面の2つ目の用事で、
 * 毎回するものでもないので、アイコンには載せず、ページの右クリックの項目を1つ足す。
 */
const CHAPTERS_MENU_ID = "novelai-helper-chapters";

/**
 * 章立ての項目を出すページ。**作品管理の画面だけ**（manifest の3つ目の content_scripts と同じ範囲）。
 * `/my/works/*` は話の編集画面にも当たるので、押したときに読み取り係が画面を確かめる。
 */
const CHAPTERS_PAGES = ["https://kakuyomu.jp/my/works/*"];

function 見立てる(url) {
  return PageState.describePage(url || "", Sites.SITES, StatsSites.STATS_SITES);
}

/**
 * いまの画面でできることを、見立てと**溜まりの様子**（件数・自分の作品として覚えているか）から決める（0.9.0）。
 * 印・右クリックの項目・押したときの実行が、みなここを通る——別々に決めると、印は「読」なのに
 * 押すと「覚えますか」と訊く、が起きる。
 */
async function できることを決める(url) {
  const 見立て = 見立てる(url);
  const 状態 = await 状態を読む();
  const 渡す = await 渡すか();
  const 場所 = StatsSites.matchReadPage(url || "", StatsSites.STATS_SITES);
  const 決め = Stash.stashDecision(場所, 状態.ownWorks);
  const 行い = Actions.actionForPage(見立て, {
    stashCount: Stash.countItems(状態),
    // 0.19.0：順位だけ溜まっていても、ほかの画面で押せば渡せる
    rankingCount: Stash.countRankings(状態),
    needsApproval: 決め.needsApproval,
    handToIde: 渡す,
  });
  return { 見立て, 状態, 場所, 決め, 行い, 渡す };
}

// ---------------------------------------------------------------------------
// 「統合小説執筆環境へ渡す」の設定（chrome.storage.local。0.11.0）
// ---------------------------------------------------------------------------

/**
 * 保存の鍵。溜まり（helperState）とは別に置く——溜まりは開くたびに書き直すので、
 * 同じ鍵に入れると、作者が切り替えた値を古い読みで書き戻す恐れがある。
 * どう決めるか（新しく入れた方は切る・既に使っている方は入れておく）は common/settings.js。
 */
const 設定の鍵 = "helperSettings";

/** 保存にある設定。無い・形が合わないときは null。 */
async function 保存にある設定() {
  try {
    const 読めた = await chrome.storage.local.get(設定の鍵);
    return Settings.normalizeSettings(読めた && 読めた[設定の鍵]);
  } catch (_e) {
    return null;
  }
}

/**
 * 渡していた形跡を見るための溜まりの状態。**控えの古さで落とさない**（pruneHanded を通さない）
 * ——8日前に渡したのが最後、という方も、渡していた方である。
 */
async function 形跡を見る状態() {
  try {
    const 読めた = await chrome.storage.local.get(保存の鍵);
    return Stash.normalizeState(読めた && 読めた[保存の鍵]);
  } catch (_e) {
    return Stash.emptyState();
  }
}

/**
 * いまの設定。保存に無ければ、渡していた形跡で推し、推した値を保存に残す（列に並べて、待たない）。
 *
 * 残すのは、推した値があとで裏返らないため——切った状態で始めた方も、使っているうちに覚えた作品が
 * 保存に増えるので、毎回推し直すと、ある日から入ったことになってしまう。
 * 待たないのは、この関数が列の中（溜まりを書いたあとの印の付け直し）からも呼ばれるため
 * （列の中から列の後ろを待つと、いつまでも終わらない）。
 * 推した値（traces）は、入れた・更新した知らせが来たら決め直す（common/settings.js）。
 */
async function 設定を読む() {
  const ある = await 保存にある設定();
  if (ある) {
    return ある;
  }
  推した設定を残す();
  return Settings.settingsWhenMissing(await 形跡を見る状態());
}

function 推した設定を残す() {
  順に(async () => {
    if (await 保存にある設定()) {
      return;
    }
    await chrome.storage.local.set({ [設定の鍵]: Settings.settingsWhenMissing(await 形跡を見る状態()) });
  }).catch(() => {
    // 残せなくても、次に読んだときにまた推す
  });
}

async function 渡すか() {
  return (await 設定を読む()).handToIde === true;
}

// ---------------------------------------------------------------------------
// 開いたときの自動取得の答え（chrome.storage.local。0.14.0。common/autoRead.js）
// ---------------------------------------------------------------------------

/**
 * 保存の鍵。「統合小説執筆環境へ渡す」（helperSettings）とは**別の鍵**に置く——あちらは作者が切り替えると
 * 丸ごと書き直す（settingsByAuthor）ので、同じ鍵に入れると、切り替えた日に答えが消える。
 */
const 承認の鍵 = "autoReadConsent";

/** 公募の一覧の棚の鍵（開いたときに取得した公募の一覧。ページごとに最新の1つ）。 */
const 棚の鍵 = "contestShelf";

function ページの種類の一覧() {
  return AutoRead.listPageTypes(StatsSites.STATS_SITES, ContestSites.CONTEST_SITES, StatsSites.RANKING_SITES);
}

function ページの種類の名(種類) {
  const 行 = ページの種類の一覧().find((t) => t.key === 種類);
  return 行 ? 行.label : 種類;
}

/** 保存にある答え。保存に無ければ null（「まだ一度も書いていない」と「全部まだ決めていない」を分けるため）。 */
async function 保存にある承認() {
  try {
    const 読めた = await chrome.storage.local.get(承認の鍵);
    const raw = 読めた && 読めた[承認の鍵];
    return raw && typeof raw === "object" ? AutoRead.normalizeConsent(raw) : null;
  } catch (_e) {
    return null;
  }
}

/**
 * いまの答え。保存に無ければ、0.9.0 以降を使っていた形跡で推す（読者の反応の画面は「自動」）。
 * 推した値は書かない——訊いたとき・作者が答えたとき・入れた／更新した知らせで書く。
 */
async function 承認を読む() {
  const ある = await 保存にある承認();
  if (ある) {
    return ある;
  }
  return AutoRead.consentWhenMissing(Settings.hasHandTraces(await 形跡を見る状態()), ページの種類の一覧(), new Date());
}

/** 答えを変える（溜まりと同じ列に並べる）。変える関数が新しい答えを返したときだけ書く。 */
function 承認を変える(変える) {
  return 順に(async () => {
    const 前 = await 承認を読む();
    const 後 = await 変える(前);
    if (後) {
      await chrome.storage.local.set({ [承認の鍵]: 後 });
    }
    return 後 || 前;
  });
}

// ---------------------------------------------------------------------------
// 溜まり（chrome.storage.local。0.9.0）
// ---------------------------------------------------------------------------

/** 保存の鍵。溜まり・渡した分の控え・覚えた作品・訊きかけの作品を、1つにまとめて置く。 */
const 保存の鍵 = "helperState";

/**
 * 保存から読む。形の崩れた欄は捨て、古い控え（7日より前）は落とす。
 * 保存が読めないときは空として扱う——溜まりが読めないせいで、貼り込みまで止めないため。
 */
async function 状態を読む() {
  try {
    const 読めた = await chrome.storage.local.get(保存の鍵);
    return Stash.pruneHanded(Stash.normalizeState(読めた && 読めた[保存の鍵]), new Date());
  } catch (_e) {
    return Stash.emptyState();
  }
}

async function 状態を書く(状態) {
  await chrome.storage.local.set({ [保存の鍵]: 状態 });
  await 全体の印を合わせる(状態);
}

/**
 * 保存の読み書きを**1本の列に並べる**。開いたときの自動の読み取りは、タブの数だけ同時に走りうる。
 * 並べないと、2つが同じ前の状態を読んで書き、片方の溜めた分が消える。
 */
let 保存の列 = Promise.resolve();
function 順に(仕事) {
  const 次 = 保存の列.then(仕事, 仕事);
  保存の列 = 次.catch(() => {});
  return 次;
}

/**
 * 状態を読んで、変えて、書く（列に並べて）。変える関数が { state } を返したときだけ書く。
 * 戻り値は、変える関数の戻り値そのもの。
 */
function 状態を変える(変える) {
  return 順に(async () => {
    const 前 = await 状態を読む();
    const 結果 = (await 変える(前)) || {};
    if (結果.state) {
      await 状態を書く(結果.state);
    }
    return 結果;
  });
}

/**
 * 読み取り係の結果を溜める。**溜めてよいかは、ここでもう一度決める**
 * （開いてから読むまでのあいだに、作者が説明のページで覚えた作品を外したかもしれない）。
 * どの画面の分かは、読み取り係が添えた「読んだURL」で決める（頼んだときのURLではない）。
 */
async function 溜める(result, 予備のURL) {
  const url = result && typeof result.url === "string" && result.url !== "" ? result.url : 予備のURL;
  const 場所 = StatsSites.matchReadPage(url || "", StatsSites.STATS_SITES);
  // 数の無い画面（アルファポリスの作品の設定の画面。0.17.0）：タグと連載の状態だけを作品ごとに覚える
  if (result && result.factsOnly === true) {
    return 事柄を溜める(result, url, 場所);
  }
  // 作品が複数並ぶ画面（アルファポリスの作品管理の一覧。0.17.0）：作品ごとに、その作品の画面として1件ずつ溜める
  if (result && Array.isArray(result.works)) {
    let 最後 = { ok: false, reason: "empty" };
    let 溜めた数 = 0;
    for (const w of result.works) {
      if (!w || typeof w.workId !== "string" || typeof w.json !== "string") {
        continue;
      }
      const 一件 = await 一件を溜める(
        { ok: true, json: w.json, counts: w.counts, title: w.title },
        url,
        Object.assign({}, 場所, { workId: w.workId })
      );
      if (一件.ok) {
        最後 = 一件;
        溜めた数 += 1;
      } else if (!最後.ok) {
        最後 = 一件;
      }
    }
    return 最後.ok ? Object.assign({}, 最後, { works: 溜めた数 }) : 最後;
  }
  return 一件を溜める(result, url, 場所);
}

/**
 * 1つの作品の1つの画面を溜める（溜める の本体。0.17.0 で分けた）。場所は、その作品の作品IDの入った照合の結果。
 */
async function 一件を溜める(result, url, 場所) {
  const 渡す = await 渡すか();
  const 溜めた = await 状態を変える((前) => {
    const 決め = Stash.stashDecision(場所, 前.ownWorks);
    if (!決め.stash) {
      return { ok: false, reason: "not-own" };
    }
    const 作った = Stash.makeItem(result, 場所, url, new Date());
    if (!作った.ok) {
      return { ok: false, reason: 作った.reason };
    }
    // 数の無い画面で覚えたタグと連載の状態を、同じ作品の数の1件へ載せる（0.17.0。その件に無い欄だけ）
    作った.item.envelope = Stash.withFacts(作った.item.envelope, 前.workFacts, 決め.siteId, 決め.workId);
    // 本人しか開けない画面（カクヨムの作品管理）を読めたら、その作品を自分の作品として覚える
    const 覚えた = 決め.learnOwn ? Stash.rememberOwnWork(前, 決め.siteId, 決め.workId, "owner-page", new Date()) : 前;
    // 0.11.0：「統合小説執筆環境へ渡す」を切っているときは溜まりに置かない（下の記録にだけ残す）。
    // 覚えた作品は切っていても覚える——記録してよい作品かは、覚えた作品で決めるため
    const 後 = 渡す ? Stash.putItem(覚えた, 作った.item).state : 覚えた;
    return {
      ok: true,
      state: 後 === 前 ? undefined : 後,
      count: Stash.countItems(後),
      url,
      envelope: 作った.item.envelope,
      siteId: 決め.siteId,
      workId: 決め.workId,
    };
  });
  if (溜めた.ok) {
    // 溜まり（渡したら空になる）とは別に、集計のための記録へも残す（0.10.0。渡しても消さない）。
    // 読み取り係が作品名を添えていれば、記録の側にだけ残す（0.13.1。溜まり＝渡す封筒には入れない）
    const 作品名 = result && typeof result.title === "string" ? result.title : null;
    await 記録に残す(溜めた.envelope, 溜めた.siteId, 溜めた.workId, 作品名);
  }
  return 溜めた;
}

/**
 * 数の無い画面（アルファポリスの作品の設定の画面。0.17.0）で読んだタグと連載の状態を、作品ごとに覚える。
 *
 * 溜まりの件は作らない（数が無いので、受け手へ渡す1件にならない）。覚えたものは、同じ作品の数の1件を
 * 溜めるとき・束にするときに載せる。本人しか開けない画面なので、その作品を自分の作品として覚え、
 * 集計の記録があればそこへも添える。
 */
async function 事柄を溜める(result, url, 場所) {
  const 溜めた = await 状態を変える((前) => {
    const 決め = Stash.stashDecision(場所, 前.ownWorks);
    if (!決め.stash || !決め.workId) {
      return { ok: false, reason: "not-own" };
    }
    const 覚えた = 決め.learnOwn ? Stash.rememberOwnWork(前, 決め.siteId, 決め.workId, "owner-page", new Date()) : 前;
    const 後 = Stash.putFacts(覚えた, 決め.siteId, 決め.workId, result.facts, new Date());
    return {
      ok: true,
      factsOnly: true,
      state: 後 === 前 ? undefined : 後,
      count: Stash.countItems(後),
      url,
      siteId: 決め.siteId,
      workId: 決め.workId,
    };
  });
  if (溜めた.ok) {
    const 読んだ日時 = typeof result.readAt === "string" ? result.readAt : new Date().toISOString();
    await 記録を変える((前) => {
      const 後 = History.rememberFacts(前, 溜めた.siteId, 溜めた.workId, result.facts, 読んだ日時);
      return 後 === 前 ? null : 後;
    });
  }
  return 溜めた;
}

// ---------------------------------------------------------------------------
// 記録（集計のための履歴。chrome.storage.local。0.10.0）
// ---------------------------------------------------------------------------

/**
 * 保存の鍵。溜まり（helperState）とは**別の鍵**に置く——溜まりは開くたびに書き直すので、
 * 同じ鍵にすると、半年ぶんの記録まで毎回書き直すことになる。
 */
const 記録の鍵 = "readerHistory";

/** 保存から読む。読めないときは空として扱う（記録が読めないせいで、溜まりや貼り込みまで止めない）。 */
async function 記録を読む() {
  try {
    const 読めた = await chrome.storage.local.get(記録の鍵);
    return History.normalizeHistory(読めた && 読めた[記録の鍵]);
  } catch (_e) {
    return History.emptyHistory();
  }
}

/**
 * 読み取り係のデータを、その作品の記録へ畳み込む（溜まりと同じ列に並べる）。
 *
 * **書く直前に、覚えた作品かをもう一度確かめる**——他人の作品の数は残さない約束で、
 * 溜めてから記録するまでのあいだに、作者が説明のページで外したかもしれないため。
 * 記録を残せなくても、溜まりと渡す流れは止めない（集計が1日ぶん欠けるだけ）。
 */
function 記録に残す(envelope, siteId, workId, 作品名) {
  return 順に(async () => {
    try {
      const 状態 = await 状態を読む();
      if (!Stash.isOwnWork(状態.ownWorks, siteId, workId)) {
        return;
      }
      const 前 = await 記録を読む();
      const 畳んだ = History.recordEnvelope(前, envelope, siteId, workId, new Date());
      // 作品名（0.13.1）は、いま畳んだ記録の読んだ日時で添える（古い読み取りで新しい名前を上書きしないため）
      const 読んだ日時 = envelope && typeof envelope.readAt === "string" ? envelope.readAt : new Date().toISOString();
      const 後 = History.rememberTitle(畳んだ, siteId, workId, 作品名, 読んだ日時);
      await chrome.storage.local.set({ [記録の鍵]: 後 });
    } catch (_e) {
      // 記録が残せなくても、溜まりはもう保存にある
    }
  });
}

/** 記録を書き換える（列に並べて）。変える関数が新しい記録を返したときだけ書く。 */
function 記録を変える(変える) {
  return 順に(async () => {
    const 前 = await 記録を読む();
    const 後 = await 変える(前);
    if (後) {
      await chrome.storage.local.set({ [記録の鍵]: 後 });
    }
  });
}

/**
 * 拡張全体の印（どのタブでも出る）に、溜まっている件数を出す。溜まりが無ければ消す。
 * 「統合小説執筆環境へ渡す」を切っているときは、溜まりが残っていても出さない（0.11.0。渡さない分を数えて見せない）。
 */
async function 全体の印を合わせる(状態) {
  const text = (await 渡すか()) ? Actions.stashBadgeText(Stash.countItems(状態)) : "";
  try {
    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: Actions.BADGES.stats.color });
    }
  } catch (_e) {
    // 印が付かなくても、溜まりそのものは保存にある
  }
}

// ---------------------------------------------------------------------------
// 知らせ（chrome.notifications）
// ---------------------------------------------------------------------------

/**
 * 押した結果を、Chrome の知らせで出す（作者の裁定、2026-09-23「終わったら通知」）。
 * ページの中には何も出さない——ページへHTMLを差し込まないのが約束だから。
 */
function 知らせる(kind, ok, message) {
  const 知らせ = Messages.notificationFor(kind, ok, message);
  try {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: 知らせ.title,
        message: 知らせ.message,
        contextMessage: Messages.APP_NAME,
        priority: 0,
      },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 知らせが出せなくても、貼り込み・読み取りそのものは済んでいる（画面で確かめられる）
  }
}

// ---------------------------------------------------------------------------
// クリップボード（画面に出ない拡張のページ offscreen.html に頼む）
// ---------------------------------------------------------------------------

const 受け渡しのページ = "offscreen.html";

async function 受け渡しのページがあるか() {
  if (chrome.runtime.getContexts) {
    const ある = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(受け渡しのページ)],
    });
    return ある.length > 0;
  }
  return false;
}

/**
 * クリップボードの読み書きを頼む。**終わったらページを閉じる**
 * ——開けたままにしておく理由が無く、残しておけば「どこかに溜まっている」ように見える。
 */
async function クリップボードに頼む(依頼) {
  if (!(await 受け渡しのページがあるか())) {
    await chrome.offscreen.createDocument({
      url: 受け渡しのページ,
      reasons: ["CLIPBOARD"],
      justification: "統合小説執筆環境とのあいだで、原稿と読者の反応をクリップボードで受け渡すため",
    });
  }
  try {
    const 返事 = await chrome.runtime.sendMessage(Object.assign({ target: "offscreen-clipboard" }, 依頼));
    return 返事 || { ok: false, detail: "返事がありませんでした" };
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_e) {
      // もう閉じている
    }
  }
}

// ---------------------------------------------------------------------------
// ページ側へ頼む
// ---------------------------------------------------------------------------

/**
 * ページ側（content script）へ依頼する。content script が動いていない（拡張を入れた直後で
 * ページを読み直していない等）ときは、応答が返らないので null を返す。
 */
function ページへ頼む(tabId, request) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, request, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (_e) {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// 実行（アイコン・右クリック）
// ---------------------------------------------------------------------------

/**
 * クリップボードの受け渡しのページは1つしか開けないので、前の分が済むまで次を受けない。
 * （0.7.x のポップアップが、処理中にボタンを押せなくしていたのと同じ役目）
 */
let 処理中 = false;

async function 貼り込む(tab, url, 読んだもの) {
  // 0.20.0：話の編集画面では、貼るかを決めるときに一度読んでいる（同じ押下で2回読まない）
  const 読めた = 読んだもの || (await クリップボードに頼む({ type: "read" }));
  if (!読めた.ok) {
    知らせる("fill", false, Messages.clipboardReadFailed(読めた.detail));
    return;
  }

  const parsed = Envelope.parseEnvelope(読めた.text);
  if (!parsed.ok) {
    知らせる("fill", false, Messages.messageForEnvelope(parsed));
    return;
  }
  const envelope = parsed.envelope;

  const target = Match.checkTarget(envelope, url, Sites.SITES);
  if (!target.ok) {
    知らせる("fill", false, Messages.messageForMatch(target));
    return;
  }

  // 0.20.0：貼り込めたら控える封筒（本文は持たない）。結果が届いたときに、作品ごとの最後の1件へ移す
  await 貼る前の控えを置く(envelope);

  // 結果は、ページ側が終わったあとに "fill-result" で届く（下の受け口）。
  // ここで待たないのは、確認のダイアログのあいだに裏方が止められても、結果を取りこぼさないため
  const 受けた = await ページへ頼む(tab.id, {
    type: "fill",
    envelope,
    workIdChecked: target.workIdChecked === true,
    // 0.20.0：話の編集画面なら、ページ側が置き換えの確認を毎回出す
    pageKind: target.pageKind === "edit" ? "edit" : "post",
  });
  if (!受けた || 受けた.accepted !== true) {
    知らせる("fill", false, Messages.PAGE.notReady);
  }
}

/*
  0.20.0：貼り込みの控え。作品ごとに最後の1件だけ持ち、話の番号を送り返すときに札（postRef）を添える。本文は持たない（字数だけ）。
  **置き場は chrome.storage.local**（共有メモの案は session だったが、設計書2章の一線「保存は local だけ」を変えないため）。
  Chrome を閉じても消えないので、7日より古い控えは使わずに捨てる（common/posted.js の freshPastes）
*/
const 貼る前の鍵 = "pendingPaste";
const 貼った控えの鍵 = "lastPastes";

function 一時の保管庫() {
  return chrome.storage && chrome.storage.local ? chrome.storage.local : null;
}

async function 貼る前の控えを置く(envelope) {
  const 庫 = 一時の保管庫();
  if (!庫) return;
  try {
    const 控え = Posted.rememberPaste({}, envelope, new Date());
    await 庫.set({ [貼る前の鍵]: 控え });
  } catch (_e) {
    // 控えられなくても貼り込みは進める（番号を送り返すときに札が付かないだけ）
  }
}

async function 貼った控えへ移す() {
  const 庫 = 一時の保管庫();
  if (!庫) return;
  try {
    const 貼る前 = (await 庫.get(貼る前の鍵))[貼る前の鍵] || {};
    const 前から = (await 庫.get(貼った控えの鍵))[貼った控えの鍵] || {};
    const 新しい = Posted.freshPastes(Object.assign({}, 前から, 貼る前), new Date());
    await 庫.set({ [貼った控えの鍵]: 新しい, [貼る前の鍵]: null });
  } catch (_e) {
    // 控えられなくても、貼り込みの結果はそのまま知らせる
  }
}

async function 貼る前の控えを捨てる() {
  const 庫 = 一時の保管庫();
  if (!庫) return;
  try {
    await 庫.set({ [貼る前の鍵]: null });
  } catch (_e) {
    // 捨てられなくても、次に貼ったときに上書きされる
  }
}

async function 貼った控えを読む() {
  const 庫 = 一時の保管庫();
  if (!庫) return {};
  try {
    return Posted.freshPastes((await 庫.get(貼った控えの鍵))[貼った控えの鍵] || {}, new Date());
  } catch (_e) {
    return {};
  }
}

/**
 * 話の編集画面で押したとき（0.20.0）、貼り込むか、話の番号を渡すか。
 * **まだ貼っていない原稿がクリップボードにあって、この画面に貼れるなら貼り込む。**
 * すでに貼った原稿（投稿したあとも残っている）や、原稿が無いときは、番号を渡す。**この決め方は仮**（作者の確認待ち）
 */
async function 編集画面で貼るか(url, 投稿後) {
  const 読めた = await クリップボードに頼む({ type: "read" });
  if (!読めた.ok) return { paste: false };
  const parsed = Envelope.parseEnvelope(読めた.text);
  if (!parsed.ok) return { paste: false };
  const target = Match.checkTarget(parsed.envelope, url, Sites.SITES);
  if (!target.ok) {
    // 別の作品の原稿でこの話の編集画面を開いている。番号を渡さず、取り違えを言う（新規作成の画面と同じ扱い）
    return target.reason === "work-mismatch" ? { paste: false, mismatch: target } : { paste: false };
  }
  const 前 = Posted.lastPasteFor(await 貼った控えを読む(), 投稿後.site, 投稿後.workId);
  return Posted.isSameAsLastPaste(parsed.envelope, 前) ? { paste: false } : { paste: true, 読めた };
}

/**
 * 投稿したあとの画面で押したとき（0.20.0）：URL の数字だけを読んで、封筒 novelai-posted をクリップボードへ置く。
 * 「統合小説執筆環境へ渡す」が入っていれば、置いたあと受け手を呼ぶ。切っていれば置くだけ。画面の中は読まない
 */
async function 話の番号を渡す(tab, 投稿後, 渡す) {
  const 前 = 投稿後.site === "narou" ? null : Posted.lastPasteFor(await 貼った控えを読む(), 投稿後.site, 投稿後.workId);
  // 0.20.0（作者の答え 2026-11-05「題も添える」）：カクヨム・アルファポリスの話の編集画面では、貼り込み係に題の欄の字を頼む。
  // 読めなければ題なしで渡す（受け手は札か、作者に選んでもらうことで話を決める）。なろうではページに入らないので頼まない
  let 題 = null;
  if (投稿後.site !== "narou") {
    try {
      const 返事 = await ページへ頼む(tab.id, { type: "read-episode-title", site: 投稿後.site });
      題 = 返事 && typeof 返事.title === "string" ? 返事.title : null;
    } catch (_e) {
      題 = null;
    }
  }
  const 封筒 = Posted.makePostedEnvelope(投稿後, 前, new Date(), 題);
  if (!封筒) {
    知らせる("posted", false, Messages.POSTED.notHere);
    return;
  }
  const 置けた = await クリップボードに頼む({ type: "write", text: JSON.stringify(封筒) });
  if (!置けた.ok) {
    知らせる("posted", false, Messages.POSTED.clipboardFailed(置けた.detail));
    return;
  }
  知らせる("posted", true, Messages.POSTED.handed(封筒, 渡す));
  const リンク = 渡す ? Actions.vscodeLinkAfter({ kind: "posted", copied: true }) : null;
  if (リンク) {
    VSCodeを呼ぶ(tab.id, リンク);
  }
}

/**
 * 溜まった分を1つの束にして、クリップボードへ置く（0.9.0）。置けたら溜まりを空にし、渡した分を控えへ移す。
 *
 * 統合小説執筆環境が受け取れたかは、この拡張には分からない（返事の道が無い）。だから
 * 溜まりを空にしても、渡した分は控えに残す（説明のページの「もう一度渡す」、次に渡すまで・長くても7日）。
 * **置けなかったときは何も消さない**——溜まりはそのまま、もう一度押せば渡せる。
 *
 * @returns {Promise<{ok:true, summary:object}|{ok:false, empty?:boolean, detail?:string}>}
 */
function 束にして置く() {
  return 順に(async () => {
    const 前 = await 状態を読む();
    // 0.19.0：「空の束は作らない」を「読者の反応も順位も空の束は作らない」へ（順位だけでも渡す。受け手との取り決め）
    if (前.items.length === 0 && 前.rankings.length === 0) {
      return { ok: false, empty: true };
    }
    const 束 = Stash.makeBundle(前.items, new Date(), 前.ownWorks, 前.workFacts, 前.rankings);
    const 置けた = await クリップボードに頼む({ type: "write", text: JSON.stringify(束) });
    if (!置けた.ok) {
      return { ok: false, detail: 置けた.detail };
    }
    await 状態を書く(Stash.afterHanded(前, 前.items, new Date(), 前.rankings));
    return { ok: true, summary: Stash.summarize(前.items, 前.rankings) };
  });
}

/**
 * まとめて渡す（0.9.0）。置けたら知らせて、VS Code を呼ぶ。
 *
 * @param {number} tabId VS Code を呼ぶタブ（押したタブ。説明のページからなら、そのページのタブ）
 * @param {object|null} current 押した画面を読み直したときの結果（内訳と、次のページの但し書きのため）
 */
async function まとめて渡す(tabId, current) {
  // 0.11.0：切っているときは渡さない（アイコンからはここへ来ない。説明のページのボタンの守り）
  if (!(await 渡すか())) {
    return { ok: false, off: true, detail: Messages.STATS.handIsOff };
  }
  const 置いた = await 束にして置く();
  if (!置いた.ok) {
    知らせる("hand", false, 置いた.empty ? Messages.STATS.nothingToHand : Messages.STATS.clipboardFailed(置いた.detail));
    return 置いた;
  }
  知らせる("hand", true, Messages.messageForHanded(置いた.summary, current));
  const リンク = Actions.vscodeLinkAfter({ kind: "hand", copied: true });
  if (リンク) {
    VSCodeを呼ぶ(tabId, リンク);
  }
  return 置いた;
}

/**
 * 前に渡した分を、もう一度渡す（0.9.0。説明のページから）。控えは変えない。
 */
async function もう一度渡す(tabId) {
  if (!(await 渡すか())) {
    return { ok: false, off: true, detail: Messages.STATS.handIsOff };
  }
  const 前 = await 状態を読む();
  const 渡した順位 = 前.handed ? 前.handed.rankings || [] : [];
  if (!前.handed || (前.handed.items.length === 0 && 渡した順位.length === 0)) {
    知らせる("hand", false, Messages.STATS.nothingToHandAgain);
    return { ok: false, empty: true };
  }
  // 0.19.0：渡した控えの順位も、もう一度渡す
  const 束 = Stash.makeBundle(前.handed.items, new Date(), 前.ownWorks, 前.workFacts, 渡した順位);
  const 置けた = await クリップボードに頼む({ type: "write", text: JSON.stringify(束) });
  if (!置けた.ok) {
    知らせる("hand", false, Messages.STATS.clipboardFailed(置けた.detail));
    return { ok: false, detail: 置けた.detail };
  }
  知らせる("hand", true, Messages.messageForHanded(Stash.summarize(前.handed.items, 渡した順位), null, true));
  const リンク = Actions.vscodeLinkAfter({ kind: "hand", copied: true });
  if (リンク) {
    VSCodeを呼ぶ(tabId, リンク);
  }
  return { ok: true };
}

/**
 * 読者の反応の画面で押したとき（0.9.0）：**その画面を読み直して溜めてから**、まとめて渡す。
 *
 * 開いたときにも溜めているが、読み直すのは、開いたあとに作者が画面を変えることがあるから
 * （アクセス数の画面を開き直したあと、など）。同じ画面の分は置き換わるので、二重にならない。
 * 読めなかったときは理由を知らせて、渡さない——渡すと、この画面の分が入ったと思われる。
 */
async function 読み直して渡す(tab, url) {
  const 場所 = StatsSites.matchReadPage(url, StatsSites.STATS_SITES);
  if (!場所.ok) {
    知らせる("stats", false, Messages.messageForStatsRead(場所));
    return;
  }
  const result = await ページへ頼む(tab.id, { type: "read" });
  if (!result) {
    知らせる("stats", false, Messages.STATS.notReady);
    return;
  }
  if (!result.ok) {
    知らせる("stats", false, Messages.messageForStatsRead(result));
    return;
  }
  const 溜めた = await 溜める(result, url);
  if (!溜めた.ok) {
    知らせる("stats", false, Messages.messageForStashFailed(溜めた.reason));
    return;
  }
  印を付ける(tab.id, 溜めた.url);
  // 数の無い画面（0.17.0）で、まだ溜まりが空なら渡すものが無い。覚えたことだけを言う
  if (溜めた.factsOnly === true && 溜めた.count === 0) {
    知らせる("facts", true, Messages.STATS.factsKept);
    return;
  }
  // 次のページがあるかは知らせの文の材料だけで、束（クリップボードへ置くデータ）には入らない
  await まとめて渡す(tab.id, result.factsOnly === true ? null : result);
}

/**
 * 「ご自分の作品ですか？」と訊く（0.9.0）。Chrome の知らせのボタンで答えてもらう。
 * 訊いた作品は控えておき、説明のページからも答えられるようにする（知らせを見落としたとき・
 * 知らせのボタンが出ない環境のため）。
 *
 * 知らせのIDに、どの作品を訊いたかを入れる——裏方は答えを待つあいだに止められることがあり、
 * 覚えておいた変数は消える。IDは Chrome が持っていてくれる。
 */
async function 訊く(tabId, 決め) {
  await 状態を変える((前) => ({
    state: Object.assign({}, 前, {
      pending: { siteId: 決め.siteId, workId: 決め.workId, askedAt: new Date().toISOString() },
    }),
  }));
  const 問い = Messages.approveQuestion(決め.siteId, 決め.workId);
  try {
    chrome.notifications.create(
      問いのID(決め.siteId, 決め.workId, tabId),
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: 問い.title,
        message: 問い.message,
        contextMessage: Messages.APP_NAME,
        buttons: Messages.APPROVE_BUTTONS.map((title) => ({ title })),
        // 答えるまで消えないように（流れて消えると、何を訊かれたのか分からない）
        requireInteraction: true,
        priority: 1,
      },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 知らせが出せなくても、説明のページから答えられる
  }
}

const 問いの頭 = "novelai-helper-approve";

function 問いのID(siteId, workId, tabId) {
  return [問いの頭, siteId, workId, String(typeof tabId === "number" ? tabId : "")].join("|");
}

function 問いのIDを読む(id) {
  const 部分 = String(id || "").split("|");
  if (部分.length !== 4 || 部分[0] !== 問いの頭 || !部分[1] || !部分[2]) {
    return null;
  }
  const tabId = Number(部分[3]);
  return { siteId: 部分[1], workId: 部分[2], tabId: 部分[3] !== "" && Number.isSafeInteger(tabId) ? tabId : null };
}

/**
 * 作者が「覚える」と答えた（0.9.0）。覚えて、訊いたときの画面がまだ開いていれば読んで溜める。
 * 読めなくても覚えたことは残る（次に開いたときから溜まる）。
 */
async function 覚えて溜める(siteId, workId, tabId) {
  await 状態を変える((前) => ({ state: Stash.rememberOwnWork(前, siteId, workId, "approved", new Date()) }));
  const 渡す = await 渡すか();
  let 件数 = null;
  if (typeof tabId === "number") {
    const result = await ページへ頼む(tabId, { type: "read" });
    const 読んだ場所 =
      result && result.ok ? StatsSites.matchReadPage(result.url || "", StatsSites.STATS_SITES) : null;
    // 訊いたあとに、同じタブで別の作品へ移っていたら溜めない（覚えた作品の分だけ）
    if (
      読んだ場所 &&
      読んだ場所.ok &&
      読んだ場所.siteId === siteId &&
      Stash.normalizeWorkId(siteId, 読んだ場所.workId) === Stash.normalizeWorkId(siteId, workId)
    ) {
      const 溜めた = await 溜める(result, result.url);
      if (溜めた.ok) {
        件数 = 溜めた.count;
        印を付ける(tabId, 溜めた.url);
      }
    }
  }
  知らせる("approved", true, Messages.messageForApproved(siteId, workId, 件数, 渡す));
}

/** 「覚えない」と答えた。訊きかけの印だけ外す（その作品は溜めない）。 */
function 覚えない(siteId, workId) {
  return 状態を変える((前) => {
    const 訊いていた = 前.pending;
    if (
      !訊いていた ||
      訊いていた.siteId !== siteId ||
      Stash.normalizeWorkId(siteId, 訊いていた.workId) !== Stash.normalizeWorkId(siteId, workId)
    ) {
      return {};
    }
    return { state: Object.assign({}, 前, { pending: null }) };
  });
}

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  // 0.14.0：「開いたときに自動で取得しますか？」の答え（吹き出しを出せなかったときのお知らせ）
  const 自動取得の問い = 自動取得の問いのIDを読む(id);
  if (自動取得の問い) {
    try {
      chrome.notifications.clear(id, () => void chrome.runtime.lastError);
    } catch (_e) {
      // もう消えている
    }
    自動取得に答えた(自動取得の問い.種類, buttonIndex === 0 ? "auto" : "manual", 自動取得の問い.tabId).then(
      (文) => {
        if (文) {
          知らせる("autoRead", true, 文);
        }
      },
      () => {}
    );
    return;
  }
  const 問い = 問いのIDを読む(id);
  if (!問い) {
    return;
  }
  try {
    chrome.notifications.clear(id, () => void chrome.runtime.lastError);
  } catch (_e) {
    // もう消えている
  }
  if (buttonIndex === 0) {
    覚えて溜める(問い.siteId, 問い.workId, 問い.tabId);
  } else {
    覚えない(問い.siteId, 問い.workId);
  }
});

/**
 * 統合小説執筆環境（VS Code）を前に出す（作者の裁定、2026-09-23）。
 *
 * **いまのタブを `vscode://` へ向ける**（chrome.tabs.update）。`vscode://` のように
 * Chrome が自分では開かない種類のリンクは、Chrome が手元のアプリ（VS Code）へ渡すだけで、
 * タブの中のページは入れ替わらない——アドレス欄に手で `mailto:` を打ったときと同じで、
 * 読み取った画面はそのまま残る。新しいタブも窓も開かない。
 *
 * 画面に出ない拡張のページ（offscreen.html）からは開けない。Chrome は、作者が押した操作の
 * 流れに無いページから手元のアプリを呼ぶことを断るため。
 *
 * 呼ぶのは渡したあとだけ（actions.js の vscodeLinkAfter）——投稿画面（書きかけの原稿の
 * あるページ）では呼ばない（投稿画面で押したときは貼り込みになり、渡さない）。
 *
 * **同じタブへ続けて向けても、2回目が門前払いになるわけではない**（0.13.2 で調べた）。Chromium の
 * 外部プロトコルの連打止め（external_protocol_handler.cc の g_accept_requests）は1回開くと閉じるが、
 * 拡張の API を呼ぶたびに開け直される（extension_function_dispatcher.cc の PermitExternalProtocolHandler）
 * ——ここの chrome.tabs.update 自身がその呼び出しなので、毎回開け直してから向けている。
 * 開いたかどうかは、この拡張には分からない（Chrome の「Visual Studio Code を開きますか」で止まることもある）。
 * だから知らせには「前に出なければ、もう一度押す」を添えている（common/messages.js）。
 * 新しいタブで開く・リンクに印を付ける、は使わない（test/redLine.test.js の「新しいタブや窓を開かない」
 * 「リンクにデータを載せない」）。
 */
function VSCodeを呼ぶ(tabId, リンク) {
  try {
    chrome.tabs.update(tabId, { url: リンク }, () => void chrome.runtime.lastError);
  } catch (_e) {
    // 呼べなくても、読者の反応はクリップボードにある（「読者の反応を貼り付けて取り込む」で入る）
  }
}

/**
 * 公募の一覧のページで押したとき（0.12.0）：並んでいる公募を読んで、クリップボードへ置く。
 *
 * **読めた数・読めなかった数を必ず知らせる。** 1件も読めなければ「読めなかった」と言い、
 * クリップボードへは何も置かない（前にコピーしたものを、空の一覧で消さない）。
 * 「統合小説執筆環境へ渡す」が入っていれば、置いたあと VS Code を呼ぶ。切っていれば置くだけ。
 * 0.14.0：押したときに画面を読めず、開いたときに取得した分（公募の棚）があれば、それを渡す
 * （その旨を知らせの頭に書く）。棚に置くのは、作者が「開いたときに自動で取得する」と答えたページの種類だけ。
 */
async function 公募を読んで渡す(tab, url, 渡す) {
  const 場所 = ContestSites.matchContestPage(url, ContestSites.CONTEST_SITES);
  if (!場所.ok) {
    知らせる("contests", false, Messages.CONTESTS.notHere);
    return;
  }
  const 読んだ = await ページへ頼む(tab.id, { type: "read-contests" });
  const 読めた = Boolean(読んだ && 読んだ.ok && typeof 読んだ.envelope === "string");
  const 棚の分 = 読めた ? null : await 棚から探す(url);
  const result = 読めた ? 読んだ : 棚の分;
  if (!result) {
    知らせる("contests", false, 読んだ ? Messages.messageForContestsRead(読んだ) : Messages.CONTESTS.notReady);
    return;
  }
  const 置けた = await クリップボードに頼む({ type: "write", text: result.envelope });
  if (!置けた.ok) {
    知らせる("contests", false, Messages.CONTESTS.clipboardFailed(置けた.detail));
    return;
  }
  知らせる(
    "contests",
    true,
    (棚の分 ? Messages.AUTO_READ.contestsFromShelf : "") + Messages.messageForContestsHanded(result, 渡す)
  );
  if (!渡す) {
    return;
  }
  const リンク = Actions.vscodeLinkAfter({ kind: "contests", copied: true });
  if (リンク) {
    VSCodeを呼ぶ(tab.id, リンク);
  }
}

/**
 * カクヨムの作品管理の画面で「章立てを取得」を選んだとき（0.13.0）：
 * 大見出しと話の並びを読んで、クリップボードへ置く。
 *
 * 公募の一覧と同じ流れ——**読めなければ何も置かない**（前にコピーしたものを、空の章立てで消さない）。
 * 「統合小説執筆環境へ渡す」が入っていれば VS Code を呼び、切っていれば置くだけ。拡張の中には溜めない。
 */
async function 章立てを読んで渡す(tab) {
  if (処理中) {
    知らせる("busy", false, Messages.busy);
    return;
  }
  if (!tab || typeof tab.id !== "number") {
    知らせる("chapters", false, Messages.CHAPTERS.notHere);
    return;
  }
  処理中 = true;
  try {
    const result = await ページへ頼む(tab.id, { type: "read-chapters" });
    if (!result) {
      知らせる("chapters", false, Messages.CHAPTERS.notReady);
      return;
    }
    if (!result.ok || typeof result.envelope !== "string") {
      知らせる("chapters", false, Messages.messageForChaptersRead(result));
      return;
    }
    const 置けた = await クリップボードに頼む({ type: "write", text: result.envelope });
    if (!置けた.ok) {
      知らせる("chapters", false, Messages.CHAPTERS.clipboardFailed(置けた.detail));
      return;
    }
    const 渡す = await 渡すか();
    知らせる("chapters", true, Messages.messageForChaptersHanded(result, 渡す));
    if (!渡す) {
      return;
    }
    const リンク = Actions.vscodeLinkAfter({ kind: "chapters", copied: true });
    if (リンク) {
      VSCodeを呼ぶ(tab.id, リンク);
    }
  } catch (e) {
    知らせる("error", false, Messages.unexpected(e && e.message));
  } finally {
    処理中 = false;
  }
}

/**
 * 押した画面を読み直して、記録する（0.11.0。切っているときの「押す」）。
 * 読めなくても何も言わない——このあと開く集計に、開いたときに記録した分は出ている。
 */
async function 読み直して記録する(tab, url) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }
  const result = await ページへ頼む(tab.id, { type: "read" });
  if (!result || !result.ok) {
    return;
  }
  const 溜めた = await 溜める(result, url);
  if (溜めた.ok) {
    印を付ける(tab.id, 溜めた.url);
  }
}

/**
 * 集計（説明のページ）を開く。作者がアイコンの右クリックで「集計を見る」を選んだときと、
 * 「統合小説執筆環境へ渡す」を切っているときにアイコン（右クリックの項目）を押したときだけ（勝手には開かない）。
 */
function 集計を開く() {
  chrome.runtime.openOptionsPage();
}

async function 実行する(tab, 予備のURL) {
  if (処理中) {
    知らせる("busy", false, Messages.busy);
    return;
  }
  処理中 = true;
  let kind = null;
  try {
    // activeTab（アイコン・右クリックを押した瞬間に与えられる）で、このタブのURLが読める
    const url = (tab && tab.url) || 予備のURL || "";
    const 決まり = await できることを決める(url);
    kind = 決まり.行い.kind;
    // 0.20.0：投稿したあとの画面（話の編集画面・なろうの管理画面）。押したときだけ、URL の数字を送り返す
    const 投稿後 = Posted.matchPostedPage(url);
    if (投稿後.ok && tab && typeof tab.id === "number") {
      const 決め = kind === "fill" ? await 編集画面で貼るか(url, 投稿後) : { paste: false };
      if (決め.mismatch) {
        知らせる("fill", false, Messages.messageForMatch(決め.mismatch));
        return;
      }
      if (決め.paste) {
        await 貼り込む(tab, url, 決め.読めた);
        return;
      }
      kind = "posted";
      await 話の番号を渡す(tab, 投稿後, 決まり.渡す);
      return;
    }
    if (kind === "report") {
      // 0.11.0：「統合小説執筆環境へ渡す」を切っているとき。ご自分の作品の読者の反応の画面なら、
      // 読み直して記録してから（画面を切り替えたあとの数も入るように）、集計を開く。知らせは出さない
      if (決まり.決め.stash) {
        await 読み直して記録する(tab, url);
      }
      集計を開く();
      return;
    }
    if (!tab || typeof tab.id !== "number" || kind === null) {
      知らせる(null, false, Messages.messageForNothingHere(決まり.見立て));
      return;
    }
    if (kind === "fill") {
      await 貼り込む(tab, url);
    } else if (kind === "contests") {
      await 公募を読んで渡す(tab, url, 決まり.渡す);
    } else if (kind === "rankings") {
      // 0.19.0：ランキングの画面。その場で覚えた作品の順位を読む（載っていればお祝い）
      await 順位を読んで知らせる(tab, url);
    } else if (kind === "approve") {
      await 訊く(tab.id, 決まり.決め);
    } else if (kind === "stats") {
      await 読み直して渡す(tab, url);
    } else {
      await まとめて渡す(tab.id, null);
    }
  } catch (e) {
    知らせる(kind === "fill" ? "fill" : "error", false, Messages.unexpected(e && e.message));
  } finally {
    処理中 = false;
  }
}

chrome.action.onClicked.addListener((tab) => {
  実行する(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === REPORT_MENU_ID) {
    集計を開く();
    return;
  }
  if (info.menuItemId === CHAPTERS_MENU_ID) {
    章立てを読んで渡す(tab);
    return;
  }
  if (info.menuItemId !== MENU_ID) {
    return;
  }
  実行する(tab, info.pageUrl);
});

// ---------------------------------------------------------------------------
// アイコンの印と、右クリックの項目
// ---------------------------------------------------------------------------

/**
 * タブにアイコンの印を付ける（外す）。タブごとに付けるので、ほかのタブの印は変わらない。
 * Chrome は、タブが別のページへ移ると、そのタブの印を自分で外す。
 *
 * 0.9.0：このタブだけの印が無い画面（badgeText が null）では、タブの印を消して、
 * 拡張全体の印（溜まっている件数「読3」）が出るようにする。
 */
async function 印を付ける(tabId, url) {
  const 行い = (await できることを決める(url)).行い;
  try {
    await chrome.action.setBadgeText({ tabId, text: 行い.badgeText });
    if (行い.badgeColor) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: 行い.badgeColor });
    }
    await chrome.action.setTitle({ tabId, title: 行い.title });
  } catch (_e) {
    // タブがもう閉じている
  }
}

/**
 * 右クリックの項目を、いま選ばれているタブのページに合わせる（できることが無ければ隠す）。
 * 項目の名は短い名（menuTitle。0.13.3）——アイコンに重ねたときの説明（title）とは分ける。
 * 作品管理の画面では「統合小説執筆環境ヘルパー ›」の下に章立ての項目と並ぶので、拡張名を付けると二重になる。
 */
async function 右クリックを合わせる(url) {
  const 行い = (await できることを決める(url)).行い;
  try {
    chrome.contextMenus.update(
      MENU_ID,
      { title: 行い.menuTitle, visible: 行い.menuVisible },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 項目がまだ作られていない（入れた直後の一瞬）
  }
}

/**
 * タブのURLを知る。`tabs` 権限を足さないので、Chrome が教えてくれないことがある。
 * そのときは、そのページに入っている content/announce.js に尋ねる
 * （入っていない＝この拡張の入らないページなので、できることは無い）。
 */
async function タブのURL(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) {
      return tab.url;
    }
  } catch (_e) {
    return "";
  }
  const 返事 = await ページへ頼む(tabId, { type: "where" });
  return 返事 && typeof 返事.url === "string" ? 返事.url : "";
}

async function 選ばれたタブに合わせる(tabId) {
  右クリックを合わせる(await タブのURL(tabId));
}

// ---------------------------------------------------------------------------
// 開いたら溜める（0.9.0。作者の依頼「開いたら自動で溜める」）
// ---------------------------------------------------------------------------

/**
 * 開いてから読むまで待つ時間（ミリ秒）。
 *
 * ページの中の数は、開いた直後にはまだ組まれていないことがある（Narou.fun の日ごとの表は、
 * ページのスクリプトがあとから組む）。見張って待つ仕組みは使わない約束なので、
 * **1回だけ、少し待ってから読む**。読めなかったら諦める（押せば読み直す）。
 */
const 開いてから読むまで = 1500;

/**
 * 同じタブの同じURLを、続けて2度読まない（開いた知らせと、URLが変わった知らせは、
 * ふつうのページの読み込みでは両方届く）。同じ画面は溜まりの中で置き換わるので害は無いが、
 * ページへ2度頼むのは無駄である。
 */
const 最近読んだ = new Map();
const 続けて読まない間 = 10000;

function 待つ(ミリ秒) {
  return new Promise((resolve) => setTimeout(resolve, ミリ秒));
}

/** 同じタブの同じURLを続けて読もうとしていれば false。読むなら控えて true。 */
function 続けて読まないか確かめる(tabId, url) {
  const 前 = 最近読んだ.get(tabId);
  const いま = Date.now();
  if (前 && 前.url === url && いま - 前.at < 続けて読まない間) {
    return false;
  }
  最近読んだ.set(tabId, { url, at: いま });
  return true;
}

/**
 * 開いた画面で取得する（0.9.0 の「開いたら溜める」を、0.14.0 でページの種類ごとの答えの後ろへ回した）。
 *
 * - 読者の反応の画面：**ご自分の作品の画面のときだけ**（誰の作品か分からない画面＝「?」では、訊きもしない）
 * - 公募の一覧のページ：誰でも見られる募集の情報なので、作品の確かめは無い
 * どちらも、作者が「開いたときに自動で取得する」と答えたページの種類でだけ読む。まだ決めていなければ一度だけ訊く。
 * 読むのは押したときと**同じ読み取り係・同じ確かめ**（作品の取り違え・ログイン画面は読み取り係と溜める側が止める）。
 * 取得したら、アイコンの吹き出し（出せなければ Chrome のお知らせ）で「取得しました」と出す。VS Code は呼ばない。
 *
 * @param {{active?:boolean, windowId?:number}|null} タブ 開いたタブ（吹き出しを出せるかを見る）
 * @param {{答えた直後?:boolean}} [様子] 答えた直後は、続けて読まない間を気にせず、待たずに読む
 */
async function 開いたら取得する(tabId, url, タブ, 様子) {
  const 直後 = Boolean(様子 && 様子.答えた直後);
  const 公募 = ContestSites.matchContestPage(url || "", ContestSites.CONTEST_SITES);
  if (公募.ok) {
    await 公募を開いたら取得する(tabId, url, タブ, 公募, 直後);
    return;
  }
  const 順位の場所 = StatsSites.matchRankingPage(url || "", StatsSites.RANKING_SITES);
  if (順位の場所.ok) {
    await ランキングを開いたら取得する(tabId, url, タブ, 順位の場所, 直後);
    return;
  }
  const 場所 = StatsSites.matchReadPage(url || "", StatsSites.STATS_SITES);
  if (!場所.ok) {
    return;
  }
  const 決め = Stash.stashDecision(場所, (await 状態を読む()).ownWorks);
  if (!決め.stash) {
    return;
  }
  if (!(await 自動で取得するか(tabId, AutoRead.pageTypeForStats(場所), タブ))) {
    return;
  }
  if (!直後) {
    if (!続けて読まないか確かめる(tabId, url)) {
      return;
    }
    await 待つ(開いてから読むまで);
  }
  const result = await ページへ頼む(tabId, { type: "read" });
  if (!result || !result.ok) {
    return;
  }
  const 溜めた = await 溜める(result, url);
  if (!溜めた.ok) {
    return;
  }
  印を付ける(tabId, 溜めた.url);
  const 渡す = await 渡すか();
  await 取得を知らせる(tabId, タブ, Messages.AUTO_READ.statsGot(溜めた.count, 渡す));
}

/** 公募の一覧のページを開いたとき（0.14.0）。取得した一覧は公募の棚へ置く（溜まりとは別。common/autoRead.js）。 */
async function 公募を開いたら取得する(tabId, url, タブ, 公募, 直後) {
  if (!(await 自動で取得するか(tabId, AutoRead.pageTypeForContest(公募), タブ))) {
    return;
  }
  if (!直後) {
    if (!続けて読まないか確かめる(tabId, url)) {
      return;
    }
    await 待つ(開いてから読むまで);
  }
  const result = await ページへ頼む(tabId, { type: "read-contests" });
  if (!result || !result.ok || typeof result.envelope !== "string") {
    return;
  }
  await 棚に置く(result, url);
  const 渡す = await 渡すか();
  await 取得を知らせる(tabId, タブ, Messages.AUTO_READ.contestsGot(result, 渡す));
}

function 棚に置く(result, url) {
  return 順に(async () => {
    try {
      const 読めた = await chrome.storage.local.get(棚の鍵);
      const 後 = AutoRead.putShelf(読めた && 読めた[棚の鍵], result, url, new Date());
      await chrome.storage.local.set({ [棚の鍵]: 後 });
    } catch (_e) {
      // 棚に置けなくても、押せば画面を読み直して渡せる
    }
  });
}

async function 棚から探す(url) {
  try {
    const 読めた = await chrome.storage.local.get(棚の鍵);
    return AutoRead.findShelf(読めた && 読めた[棚の鍵], url);
  } catch (_e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ランキングの画面（0.19.0。作者の指示 2026-11-02「ランキング画面に自作があったら吹き出しでお祝い、そして取得」）
// ---------------------------------------------------------------------------

/**
 * お祝いの記憶（鳴らした印と、前に見た順位。common/rankings.js）の保存の鍵。溜まり（helperState）とは**別の鍵**——
 * 「溜まりを空にする」や渡したあとも残す（同じ順位で二度鳴らさない・次の演出の規模を決めるため）。
 */
const お祝いの鍵 = "rankingMemory";

async function お祝いの記憶を読む() {
  try {
    const 読めた = await chrome.storage.local.get(お祝いの鍵);
    return Rankings.normalizeMemory(読めた && 読めた[お祝いの鍵]);
  } catch (_e) {
    return Rankings.emptyMemory();
  }
}

/** そのサイトの覚えた作品の作品ID（ランキングの画面へ添える照合の相手）。 */
function 覚えた作品ID(状態, siteId) {
  return (状態.ownWorks || []).filter((w) => w.siteId === siteId).map((w) => Stash.normalizeWorkId(siteId, w.workId));
}

/**
 * ランキングの画面を読む。**そのサイトの覚えた作品が無ければ、ページへ頼まない**（照合する相手が無いのに、
 * 他の方の作品が並ぶ画面に触れる理由が無い）。頼むときは覚えた作品の作品IDを添え、読み取り係は一致した行だけを読む。
 * 返ってきた順位も、覚えた作品のものだけに絞り、形を確かめる（ページ側を信じきらない）。
 *
 * @returns {Promise<{ok:true, rankings:object[], rows:number, siteId:string}|{ok:false, reason:string, siteId?:string}|null>}
 *          null はページの中の読み取り係が返事をしなかった（開き直しが要る）
 */
async function 順位を読む(tabId, url) {
  const 場所 = StatsSites.matchRankingPage(url || "", StatsSites.RANKING_SITES);
  if (!場所.ok) {
    return 場所;
  }
  const 作品IDたち = 覚えた作品ID(await 状態を読む(), 場所.siteId);
  if (作品IDたち.length === 0) {
    return { ok: false, reason: "no-own-works", siteId: 場所.siteId };
  }
  const result = await ページへ頼む(tabId, { type: "read-rankings", workIds: 作品IDたち });
  if (!result) {
    return null;
  }
  if (!result.ok) {
    return result;
  }
  // 頼んでから読むまでに、別のサイトの画面へ移っていたら使わない
  const 読んだ場所 = StatsSites.matchRankingPage(typeof result.url === "string" ? result.url : url, StatsSites.RANKING_SITES);
  if (!読んだ場所.ok || 読んだ場所.siteId !== 場所.siteId) {
    return { ok: false, reason: "moved" };
  }
  const 覚えた = new Set(作品IDたち);
  const rankings = (Array.isArray(result.rankings) ? result.rankings : [])
    .filter((r) => r && r.site === 場所.siteId && 覚えた.has(r.workId))
    .map(Stash.normalizeRanking)
    .filter((r) => r !== null);
  return { ok: true, rankings, rows: Number(result.rows) || 0, siteId: 場所.siteId };
}

/**
 * 読んだ順位を溜める。「統合小説執筆環境へ渡す」を切っているときは溜めない（読者の反応と同じ。お祝いはする）。
 * 溜める直前に、覚えた作品かをもう一度確かめる（読むあいだに作者が外したかもしれない）。
 * @returns {Promise<{stored:boolean, handable:number}>}
 */
async function 順位を溜める(rankings) {
  if (!(await 渡すか()) || rankings.length === 0) {
    return { stored: false, handable: Stash.countHandable(await 状態を読む()) };
  }
  return 状態を変える((前) => {
    const 自分の = rankings.filter((r) => Stash.isOwnWork(前.ownWorks, r.site, r.workId));
    if (自分の.length === 0) {
      return { stored: false, handable: Stash.countHandable(前) };
    }
    const 後 = Stash.putRankings(前, 自分の);
    return { state: 後, stored: true, handable: Stash.countHandable(後) };
  });
}

/**
 * お祝いする。まだ鳴らしていない順位があれば、アイコンの吹き出しで「おめでとうございます！」と演出を出す。
 *
 * - **タブが前に無ければ鳴らさない**。アイコンに「祝」の印を付けるだけ（お知らせにも回さない——裏のタブから突然鳴らさない）。
 *   そのタブへ移ってアイコンを押すと、もう一度読んでお祝いを出す
 * - タブは前にあるのに吹き出しを出せない（古い Chrome など）ときは、Chrome のお知らせで文だけ出す
 * - **鳴らした印は、実際に出せたときだけ残す**（出せなかったのに残すと、作者は一度も見ないまま終わる）
 * 記憶の読み書きは溜まりと同じ列に並べる（開いた知らせと URL の変わった知らせが続けて来ても、二度鳴らさない）。
 *
 * @param {{active?:boolean, windowId?:number}|null} タブ
 * @param {boolean} 渡す 「統合小説執筆環境へ渡す」が入っているか（吹き出しに、もう一度押すと渡すことを添える）
 * @returns {Promise<"rung"|"pending"|"nothing">}
 */
function お祝いする(tabId, タブ, rankings, 渡す) {
  return 順に(async () => {
    const 記憶 = await お祝いの記憶を読む();
    const 予定 = Rankings.planCelebration(記憶, rankings);
    if (予定.fresh.length === 0) {
      return "nothing";
    }
    if (!タブ || タブ.active !== true) {
      await 祝の印を付ける(tabId);
      return "pending";
    }
    const 文 = Messages.RANKINGS.celebrateText(予定.fresh) + (渡す ? `\n${Messages.RANKINGS.handHint}` : "");
    let 出せた = await 吹き出しで出す(tabId, タブ, {
      mode: "celebrate",
      title: Messages.RANKINGS.celebrateTitle,
      text: 文,
      effect: 予定.effect,
    });
    if (!出せた) {
      出せた = お知らせで出す(Messages.RANKINGS.celebrateTitle, 文);
    }
    if (!出せた) {
      await 祝の印を付ける(tabId);
      return "pending";
    }
    try {
      await chrome.storage.local.set({ [お祝いの鍵]: Rankings.markRung(記憶, 予定.fresh, new Date()) });
    } catch (_e) {
      // 残せなくても、お祝いは出た（次に開いたときにもう一度鳴るだけ）
    }
    return "rung";
  });
}

/** お祝いを出せなかったタブに「祝」の印を付ける（そのタブが別のページへ移れば、Chrome が外す）。 */
async function 祝の印を付ける(tabId) {
  if (typeof tabId !== "number") {
    return;
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: Actions.BADGES.celebrate.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: Actions.BADGES.celebrate.color });
    await chrome.action.setTitle({ tabId, title: Messages.RANKINGS.pendingTitle });
  } catch (_e) {
    // タブがもう閉じている
  }
}

/** ボタンの無い Chrome のお知らせを1つ出す。出す頼みができたら true。 */
function お知らせで出す(title, message) {
  try {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title,
        message,
        contextMessage: Messages.APP_NAME,
        priority: 0,
      },
      () => void chrome.runtime.lastError
    );
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * ランキングの画面を開いたとき（0.19.0）。そのサイトの覚えた作品が無ければ、訊きもしない（読むものが無い）。
 * 「開いたときに自動で取得する」と答えていれば、少し待って1回だけ読み、溜めて、載っていればお祝いする。
 * 載っていなければ何も言わない（開くたびに「載っていませんでした」と出るのは騒がしい）。VS Code は呼ばない。
 */
async function ランキングを開いたら取得する(tabId, url, タブ, 場所, 直後) {
  if (覚えた作品ID(await 状態を読む(), 場所.siteId).length === 0) {
    return;
  }
  if (!(await 自動で取得するか(tabId, AutoRead.pageTypeForRanking(場所), タブ))) {
    return;
  }
  if (!直後) {
    if (!続けて読まないか確かめる(tabId, url)) {
      return;
    }
    await 待つ(開いてから読むまで);
  }
  const 読んだ = await 順位を読む(tabId, url);
  if (!読んだ || !読んだ.ok || 読んだ.rankings.length === 0) {
    return;
  }
  const 溜めた = await 順位を溜める(読んだ.rankings);
  await お祝いする(tabId, タブ, 読んだ.rankings, 溜めた.stored);
}

/**
 * ランキングの画面でアイコンを押したとき（0.19.0）：その場で覚えた作品の順位を読み、溜めて、
 * まだお祝いしていない順位があればお祝いの吹き出しを出す（押したタブは前に出ている）。
 *
 * **お祝いを出した回は、統合小説執筆環境へは渡さない**——続けて VS Code を前に出すと、吹き出しがすぐ閉じてしまう。
 * もうお祝いした順位だけのとき（2回目に押したとき）は、ほかの読者の反応の画面と同じく、まとめて渡す
 * （「統合小説執筆環境へ渡す」を切っていれば、順位をお知らせで言うだけ）。
 */
async function 順位を読んで知らせる(tab, url) {
  const 読んだ = await 順位を読む(tab.id, url);
  if (!読んだ) {
    知らせる("rankings", false, Messages.RANKINGS.notReady);
    return;
  }
  if (!読んだ.ok) {
    知らせる(
      "rankings",
      false,
      読んだ.reason === "no-own-works" ? Messages.RANKINGS.noOwnWorks(読んだ.siteId) : Messages.RANKINGS.readFailed(読んだ)
    );
    return;
  }
  if (読んだ.rankings.length === 0) {
    知らせる("rankings", false, Messages.RANKINGS.notFound(読んだ.rows));
    return;
  }
  const 溜めた = await 順位を溜める(読んだ.rankings);
  // 押したタブは、作者がいま見ているタブ
  const 鳴らした = await お祝いする(tab.id, Object.assign({}, tab, { active: true }), 読んだ.rankings, 溜めた.stored);
  // 「祝」の印が付いていたら、ふだんの「位」へ戻す（出せなかったときは「祝」のまま残す）
  if (鳴らした !== "pending") {
    印を付ける(tab.id, url);
  }
  if (鳴らした === "rung") {
    return;
  }
  if (溜めた.stored) {
    await まとめて渡す(tab.id, null);
    return;
  }
  知らせる("rankings", true, Messages.RANKINGS.found(読んだ.rankings, false, 溜めた.handable));
}

/**
 * このページの種類で、開いたときに自動で取得するか。**まだ決めていなければ、ここで一度だけ訊く**（false を返す）。
 *
 * 「訊いた」は、問いを出す**前に**列の中で残す——同じ種類の画面を続けて開いても（タブを2つ開いても）
 * 問いが2つ出ないように。答えが来るまでは取得しない（承認しなければ取得しない）。
 */
async function 自動で取得するか(tabId, 種類, タブ) {
  if (!種類) {
    return false;
  }
  let 決まり = "no";
  await 承認を変える((前) => {
    if (AutoRead.isAuto(前, 種類)) {
      決まり = "auto";
      return null;
    }
    if (!AutoRead.shouldAsk(前, 種類)) {
      return null;
    }
    決まり = "ask";
    return AutoRead.markAsked(前, 種類, new Date());
  });
  if (決まり === "ask") {
    await 自動取得を訊く(tabId, 種類, タブ);
  }
  return 決まり === "auto";
}

const 自動取得の問いの頭 = "novelai-helper-autoread";

/** 問いの知らせのID。ページの種類の鍵に「|」が入るので、区切りは「#」にする（自分の作品かの問いのIDとも分ける）。 */
function 自動取得の問いのID(種類, tabId) {
  return [自動取得の問いの頭, 種類, String(typeof tabId === "number" ? tabId : "")].join("#");
}

function 自動取得の問いのIDを読む(id) {
  const 部分 = String(id || "").split("#");
  if (部分.length !== 3 || 部分[0] !== 自動取得の問いの頭 || !部分[1]) {
    return null;
  }
  const tabId = Number(部分[2]);
  return { 種類: 部分[1], tabId: 部分[2] !== "" && Number.isSafeInteger(tabId) ? tabId : null };
}

/**
 * 「開いたときに自動で取得しますか？」を出す。アイコンの吹き出しを先に試し、出せなければ
 * ボタン付きの Chrome のお知らせ（自分の作品かの問いと同じ形。答えるまで消えない）。
 * どちらも見落としたときは、説明のページから決められる。
 */
async function 自動取得を訊く(tabId, 種類, タブ) {
  const 行 = ページの種類の一覧().find((t) => t.key === 種類);
  const 文 = Messages.AUTO_READ.question(行 ? 行.label : 種類, 行 ? 行.group : null);
  const 出せた = await 吹き出しで出す(tabId, タブ, {
    mode: "ask",
    key: 種類,
    tab: String(tabId),
    title: Messages.AUTO_READ.questionTitle,
    text: 文,
  });
  if (出せた) {
    return;
  }
  try {
    chrome.notifications.create(
      自動取得の問いのID(種類, tabId),
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: Messages.AUTO_READ.questionTitle,
        message: 文,
        contextMessage: Messages.APP_NAME,
        buttons: Messages.AUTO_READ.BUTTONS.map((title) => ({ title })),
        requireInteraction: true,
        priority: 1,
      },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 知らせが出せなくても、説明のページから決められる
  }
}

/**
 * 作者が答えた（吹き出し・お知らせのボタン）。答えを残し、「自動」なら、訊いたときの画面をすぐ取得する。
 * @returns {Promise<string>} 吹き出しに出す、答えを受けた文
 */
async function 自動取得に答えた(種類, choice, tabId) {
  if (!ページの種類の一覧().some((t) => t.key === 種類) || (choice !== "auto" && choice !== "manual")) {
    return null;
  }
  await 承認を変える((前) => AutoRead.setChoice(前, 種類, choice, "author", new Date()));
  const 名 = ページの種類の名(種類);
  if (choice === "auto" && typeof tabId === "number") {
    const url = await タブのURL(tabId);
    // 訊いたあとに別の種類の画面へ移っていたら、そちらは読まない（答えたのはこの種類について）
    const いまの種類 =
      AutoRead.pageTypeForContest(ContestSites.matchContestPage(url, ContestSites.CONTEST_SITES)) ||
      AutoRead.pageTypeForRanking(StatsSites.matchRankingPage(url, StatsSites.RANKING_SITES)) ||
      AutoRead.pageTypeForStats(StatsSites.matchReadPage(url, StatsSites.STATS_SITES));
    if (いまの種類 === 種類) {
      // 答えた吹き出しはまだ開いているので、取得した知らせは吹き出しに重ねない（タブを渡さず、お知らせへ回す）
      開いたら取得する(tabId, url, null, { 答えた直後: true });
    }
  }
  if (choice !== "auto") {
    return Messages.AUTO_READ.answeredManual(名);
  }
  const 組 = (ページの種類の一覧().find((t) => t.key === 種類) || {}).group;
  return 組 === "rankings" ?Messages.AUTO_READ.answeredAutoRanking(名) : Messages.AUTO_READ.answeredAuto(名);
}

/**
 * 「取得しました」を出す。アイコンの吹き出しを先に試し、出せなければ Chrome のお知らせ。
 * 吹き出しが出せるのは、そのタブがいま前に出ているときだけ（Chrome の決まり）。
 */
async function 取得を知らせる(tabId, タブ, 中身) {
  const 出せた = await 吹き出しで出す(tabId, タブ, { mode: "got", title: 中身.title, text: 中身.message });
  if (出せた) {
    return;
  }
  try {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: 中身.title,
        message: 中身.message,
        contextMessage: Messages.APP_NAME,
        priority: 0,
      },
      () => void chrome.runtime.lastError
    );
  } catch (_e) {
    // 知らせが出せなくても、取得したものは保存にある（印の件数で分かる）
  }
}

/**
 * アイコンから吹き出し（bubble.html）を出す（0.14.0）。出せたら true。
 *
 * ふだんアイコンには吹き出しを付けていない（押すと1つ実行する。0.8.0 の作者の裁定）。だから出すときだけ、
 * **そのタブに**吹き出しのページを結び付けて chrome.action.openPopup() で開き、開いたらすぐ外す
 * ——外し忘れると、次にアイコンを押したときに実行されず吹き出しが出てしまう。
 * openPopup は Chrome 127 から、どの拡張でも使える。古い Chrome・タブが前に出ていない・窓が選ばれていない
 * ときは断られるので、そのときは false を返して、呼んだ側が Chrome のお知らせへ回す。
 */
async function 吹き出しで出す(tabId, タブ, 中身) {
  const action = chrome.action;
  if (
    !タブ ||
    タブ.active !== true ||
    typeof tabId !== "number" ||
    typeof action.openPopup !== "function" ||
    typeof action.setPopup !== "function"
  ) {
    return false;
  }
  const 問い合わせ = new URLSearchParams(中身).toString();
  try {
    await action.setPopup({ tabId, popup: `bubble.html?${問い合わせ}` });
    await action.openPopup(typeof タブ.windowId === "number" ? { windowId: タブ.windowId } : undefined);
    return true;
  } catch (_e) {
    return false;
  } finally {
    try {
      await action.setPopup({ tabId, popup: "" });
    } catch (_e) {
      // タブがもう閉じている
    }
  }
}

// ---------------------------------------------------------------------------
// 知らせの受け口
// ---------------------------------------------------------------------------

/**
 * 説明のページ（options.html）からの頼み（0.9.0）。溜まりの様子を見せ、まとめて渡す・
 * もう一度渡す・溜まりを空にする・覚えた作品を直す・訊きかけの作品を覚える。
 * 保存に触れるのは裏方だけなので、説明のページはここへ頼む。
 */
async function 説明のページの頼み(request, sender) {
  const tabId = sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : null;
  switch (request.type) {
    case "options-status": {
      const 状態 = await 状態を読む();
      return {
        ok: true,
        // 0.19.0：溜まった順位も1行ずつ並べる（どの作品が、どの一覧で何位か）
        items: 状態.items.map((i) => Messages.describeStashItem(i)).concat(状態.rankings.map((r) => Messages.RANKINGS.describe(r))),
        summary: Stash.summarize(状態.items, 状態.rankings),
        handed: 状態.handed
          ? { handedAt: 状態.handed.handedAt, summary: Stash.summarize(状態.handed.items, 状態.handed.rankings || []) }
          : null,
        ownWorks: 状態.ownWorks,
        pending: 状態.pending,
        limits: Stash.LIMITS,
        handToIde: await 渡すか(),
        // 0.14.0：開いたときの自動取得の答え（ページの種類ごと。まだ決めていなければ undecided）
        autoRead: await 自動取得の答えの一覧(),
      };
    }
    case "options-set-auto-read": {
      // 0.14.0：作者が説明のページで変えた。undecided は「まだ決めていない」に戻す（次に開いたら訊く）
      const 種類 = request.key;
      const 選んだ = request.choice;
      if (!ページの種類の一覧().some((t) => t.key === 種類) || !["undecided", ...AutoRead.CHOICES].includes(選んだ)) {
        return { ok: false };
      }
      await 承認を変える((前) =>
        AutoRead.setChoice(前, 種類, 選んだ === "undecided" ? null : 選んだ, "author", new Date())
      );
      return { ok: true, autoRead: await 自動取得の答えの一覧() };
    }
    case "options-set-hand-to-ide": {
      // 0.11.0：作者が説明のページで切り替えた。切っても溜まりは消さない（入れ直せば渡せる）
      if (typeof request.on !== "boolean") {
        return { ok: false };
      }
      const 新しい = Settings.settingsByAuthor(request.on);
      await 順に(async () => {
        await chrome.storage.local.set({ [設定の鍵]: 新しい });
        await 全体の印を合わせる(await 状態を読む());
      });
      return { ok: true, handToIde: 新しい.handToIde };
    }
    case "options-hand":
    case "options-hand-again": {
      if (処理中) {
        return { ok: false, detail: Messages.busy };
      }
      処理中 = true;
      try {
        return request.type === "options-hand" ? await まとめて渡す(tabId, null) : await もう一度渡す(tabId);
      } finally {
        処理中 = false;
      }
    }
    case "options-clear":
      // 0.19.0：溜まった順位も一緒に空にする（お祝いした印・前に見た順位は残す——同じ順位で二度鳴らさないため）
      await 状態を変える((前) => ({ state: Object.assign({}, 前, { items: [], rankings: [] }) }));
      return { ok: true };
    case "options-save-own-works": {
      const 結果 = await 状態を変える((前) => {
        const 直した = Stash.replaceOwnWorksFromText(前, request.texts, new Date());
        return 直した.ok ? { ok: true, state: 直した.state } : { ok: false, bad: 直した.bad };
      });
      if (結果.ok === true) {
        // 覚えた作品から外した作品は、集計の記録も消す（外したのは、ご自分の作品ではなかったからかもしれない）
        await 記録を変える((前) => History.keepOnlyOwn(前, 結果.state.ownWorks));
      }
      return { ok: 結果.ok === true, bad: 結果.bad || [] };
    }
    case "options-report": {
      // 読者の反応の集計（0.10.0）。覚えた作品だけを、字の表にして返す（ページで要素を作らないため）
      const 状態 = await 状態を読む();
      const 記録 = await 記録を読む();
      return {
        ok: true,
        text: History.formatReport(記録, 状態.ownWorks, new Date()),
        works: 状態.ownWorks.length,
        limits: History.HISTORY_LIMITS,
      };
    }
    case "options-clear-history":
      await 記録を変える(() => History.emptyHistory());
      return { ok: true };
    case "options-approve-pending": {
      const 状態 = await 状態を読む();
      if (!状態.pending) {
        return { ok: false };
      }
      // 訊いたときのタブは分からない（知らせのIDにしか無い）ので、覚えるだけ。次に開いたときから溜まる
      await 覚えて溜める(状態.pending.siteId, 状態.pending.workId, null);
      return { ok: true };
    }
    case "options-decline-pending": {
      const 状態 = await 状態を読む();
      if (状態.pending) {
        await 覚えない(状態.pending.siteId, 状態.pending.workId);
      }
      return { ok: true };
    }
    default:
      return { ok: false };
  }
}

/** 説明のページに見せる、ページの種類ごとの答え（0.14.0）。 */
async function 自動取得の答えの一覧() {
  const 答え = await 承認を読む();
  return ページの種類の一覧().map((t) => ({
    key: t.key,
    label: t.label,
    group: t.group,
    choice: AutoRead.choiceFor(答え, t.key) || "undecided",
  }));
}

function 説明のページからか(sender) {
  return 拡張のページからか(sender, "options.html");
}

function 拡張のページからか(sender, ページ) {
  const 置き場 = chrome.runtime.getURL(ページ);
  return typeof sender.url === "string" && (sender.url === 置き場 || sender.url.startsWith(置き場 + "#") || sender.url.startsWith(置き場 + "?"));
}

// ページが開いた（content/announce.js）・貼り込みが終わった（content/fill.js）・説明のページの頼み・吹き出しの答え
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !sender || sender.id !== chrome.runtime.id) {
    return false;
  }
  // 吹き出し（bubble.html。0.14.0）はタブの中のページではないので、sender.tab が無い。先に見分ける
  if (request.type === "bubble-answer" && 拡張のページからか(sender, "bubble.html")) {
    自動取得に答えた(request.key, request.choice, typeof request.tabId === "number" ? request.tabId : null).then(
      (文) => sendResponse(文 ? { ok: true, message: 文 } : { ok: false }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  // ここから先は、この拡張の入ったページ・拡張のタブからの知らせだけ。クリップボードの受け渡しの宛先は素通り
  if (!sender.tab) {
    return false;
  }
  if (説明のページからか(sender)) {
    説明のページの頼み(request, sender).then(sendResponse, (e) =>
      sendResponse({ ok: false, detail: Messages.unexpected(e && e.message) })
    );
    // 返事はあとで送る（保存の読み書きを待つ）
    return true;
  }
  if (request.type === "page-opened") {
    印を付ける(sender.tab.id, sender.url);
    if (sender.tab.active) {
      右クリックを合わせる(sender.url);
    }
    開いたら取得する(sender.tab.id, sender.url, sender.tab);
    return false;
  }
  if (request.type === "fill-result" && request.result) {
    // 作品IDを突き合わせられなかったときは、結果の前に但し書きを付ける
    // （「照合したうえで貼り込んだ」と受け取られると、取り違えに気づけない）
    const 但し書き = request.workIdChecked === true ? "" : Messages.PAGE.workIdUnchecked;
    知らせる("fill", request.result.ok === true, 但し書き + (request.result.message || ""));
    if (request.result.ok === true) {
      貼った控えへ移す();
    } else {
      // 断られた・入れられなかった貼り込みの控えは残さない（PRIVACY の「作品ごとに最後の1件」を保つ）
      貼る前の控えを捨てる();
    }
    return false;
  }
  return false;
});

// 同じ作品サイトの中で、ページを読み直さずにURLだけが変わったとき（アクセス数の「次へ」など）
// （Chrome がURLを教えてくれるのは、この拡張の入るページのときだけ）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (typeof changeInfo.url !== "string") {
    return;
  }
  印を付ける(tabId, changeInfo.url);
  if (tab && tab.active) {
    右クリックを合わせる(changeInfo.url);
  }
  開いたら取得する(tabId, changeInfo.url, tab || null);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  最近読んだ.delete(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  選ばれたタブに合わせる(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0] || typeof tabs[0].id !== "number") {
      return;
    }
    選ばれたタブに合わせる(tabs[0].id);
  });
});

// ---------------------------------------------------------------------------
// 入れたとき
// ---------------------------------------------------------------------------

/**
 * 右クリックの項目は、この拡張の入るページ（manifest の matches）にだけ出す。
 * いまのタブに合わせた付け替えが遅れても、関係の無いサイトで項目が出ることは無い。
 * 範囲は manifest から読む——ここへ書き写すと、ページの範囲を直した日に食い違う。
 */
function 入るページの範囲() {
  const 設定 = chrome.runtime.getManifest();
  return (設定.content_scripts || []).flatMap((c) => c.matches || []);
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: Messages.APP_NAME,
        contexts: ["page", "selection", "editable", "link", "image"],
        documentUrlPatterns: 入るページの範囲(),
        // いまのタブが分かるまでは出さない（ページが開いた知らせで付け替える）
        visible: false,
      },
      () => void chrome.runtime.lastError
    );
    // アイコンの右クリックにだけ出す（ページの上には出さない）
    chrome.contextMenus.create(
      { id: REPORT_MENU_ID, title: Messages.REPORT_MENU_TITLE, contexts: ["action"] },
      () => void chrome.runtime.lastError
    );
    // カクヨムの作品管理の画面の右クリックにだけ出す（0.13.0）。いまのタブに合わせた付け替えはしない
    // ——出す範囲は documentUrlPatterns が決め、押したときに読み取り係が画面を確かめる
    chrome.contextMenus.create(
      {
        id: CHAPTERS_MENU_ID,
        title: Messages.CHAPTERS_MENU_TITLE,
        contexts: ["page", "selection", "link"],
        documentUrlPatterns: CHAPTERS_PAGES,
      },
      () => void chrome.runtime.lastError
    );
  });
  // 「はじめに」（自分の作品の画面を開く → 作品を覚える → 集計を見る）と「この拡張がしないこと」は、
  // 入れた直後に1回だけ見せる（更新のたびには開かない）
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
  // 「統合小説執筆環境へ渡す」を決める（0.11.0）：新しく入れた方は切る、更新で入った方は入れておく。
  // 作者が切り替えた値は変えない（common/settings.js）
  順に(async () => {
    const 書く = Settings.settingsOnInstalled(await 保存にある設定(), details.reason, await 形跡を見る状態());
    if (書く) {
      await chrome.storage.local.set({ [設定の鍵]: 書く });
    }
    // 開いたときの自動取得（0.14.0）：更新した方は、読者の反応の画面を「自動」で始める（これまで訊かずに
    // 読んでいたので、黙って止めない）。新しく入れた方は何も決めない（開いたときに訊く）。common/autoRead.js
    const 答え = AutoRead.consentOnInstalled(await 保存にある承認(), details.reason, ページの種類の一覧(), new Date());
    if (答え) {
      await chrome.storage.local.set({ [承認の鍵]: 答え });
    }
    await 全体の印を合わせる(await 状態を読む());
  }).catch(() => {
    // 書けなくても、形跡で推した値で動く
  });
});

// 裏方が起きたとき（Chrome を開き直した・しばらく止まっていた）に、溜まりの件数を印へ戻す
状態を読む().then(全体の印を合わせる, () => {});
