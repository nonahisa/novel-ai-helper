/**
 * 障害報告用の記録を組み立てる（1.1.0。作者の答え 2026-11-28「3つとも作る」、母艦経由）。
 *
 * Discord のボットの /不具合を報告 に添付する .md を1枚作る。形は統合小説執筆環境の「記録の形 1」
 * （統合の設計書 8.5.2）と同じで、環境の欄に `製品: 投稿ヘルパー` の行を置いて、どの製品の記録かを伝える。
 *
 * 守ること（設計書2章の一線と、統合の 8.5.3 の伏せ方）：
 * - **受け取るのは、数・札・決まった名前だけ。** 保存の丸写しをしない（呼ぶ側が名指しで数えて渡す）
 * - 作品の番号・話の番号・Nコード・作品名・題・本文・章・読者の反応の数・URL・会員の情報は入れない。
 *   押したときの記録は「アドレスの形」だけで、その中でも、決まった語でない部分（ユーザー名・タグなど）は〈語〉に伏せる
 * - 読めなかった数は 0 と書かず、行ごと省く
 * - どこへも送らない。説明のページが、作者の押したボタンでファイルに保存するだけ
 *
 * DOM も chrome.* も使わない（単体テストから読む）。
 */
(function (global) {
  "use strict";

  /** 記録の形の版。見出しや欄を変えたら上げる（ボットが読み分ける。統合と同じ数） */
  const FORMAT_VERSION = 1;
  const FORMAT_LINE = `記録の形 ${FORMAT_VERSION}`;
  /** ボットが製品を見分ける名前（フォーラムの製品のタグと同じ字） */
  const PRODUCT_NAME = "投稿ヘルパー";
  /** 報告ID の形（統合と同じ） */
  const REPORT_ID_PATTERN = /^NAI-\d{8}-[a-z0-9]{4}$/;
  /** 欄の上限（ボットとの約束。環境は1000字、記録（任意）は4000字） */
  const ENVIRONMENT_MAX_CHARS = 1000;
  const RECORD_MAX_CHARS = 4000;
  /** ファイル全体の上限（UTF-8 のバイト数） */
  const MAX_BYTES = 1000000;

  /** 要約の見出し。**Discord の入力窓の欄と1字も違えない**（統合の SUMMARY_HEADINGS と同じ字・同じ順） */
  const SUMMARY_HEADINGS = {
    environment: "## 環境",
    steps: "## 何をしたら（再現手順）",
    expected: "## 期待した動き",
    actual: "## 実際の動き",
    record: "## 記録（任意）",
  };

  /** 作者が書く欄の案内の一文。「（ここに、」で始まり「）」で終わる1行（ボットはこの行のままなら空とみなす） */
  const AUTHOR_HINTS = {
    steps: "（ここに、押した操作を順に書いてください。例：カクヨムの話の作成画面でツールバーのアイコンを押した）",
    expected: "（ここに、どうなるはずだったかを書いてください）",
    // この欄は #不具合報告 で会員みんなに見える。お知らせの文には作品の番号や題が入ることがあるので、消してもらう
    actual: "（ここに、実際に起きたことを書いてください。お知らせの文を写すときは、作品の番号と題を消してください）",
  };

  /**
   * アドレスの形のうち、そのまま残してよい語（この拡張の表に出てくる画面の語）。
   * これ以外の部分は〈語〉に伏せる——カクヨムの /users/<ユーザー名> のような形で、名前を出さないため
   */
  const SHAPE_WORDS = new Set([
    "my", "works", "work", "episodes", "episode", "new", "edit", "users", "user", "accesses", "stats",
    "tags", "ranking", "rankings", "contest", "contests", "novel", "novels", "mypage", "author", "detail",
    "manage", "save_episode", "settings", "top", "ncode", "usernovelmanage", "usernoveldatamanage",
    "updateinput", "noveldataid", "content", "chapter", "page", "history", "measurements", "reader",
    "annual", "completed", "hot", "posting", "rank", "list", "daily", "weekly", "monthly", "quarter",
    "yearly", "total", "genre", "all", "bungakusyou", "kobo", "read", "index", "save", "genrelist", "type",
  ]);
  const MASKED_WORD = "〈語〉";

  /** 押したときの記録の「押して何をしたか」（common/pressLog.js の DID_LABELS と同じ字。字が違えば札のまま） */
  function didLabel(did, labels) {
    return (labels && labels[did]) || did;
  }

  const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** 報告ID を作る。書き出すたびに作る（同じ不具合を2回書き出しても取り違えない）。日付は作者の時計 */
  function makeReportId(now, randomValues) {
    const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const 日 = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
    const 乱 = new Uint8Array(4);
    if (typeof randomValues === "function") {
      randomValues(乱);
    } else if (global.crypto && typeof global.crypto.getRandomValues === "function") {
      global.crypto.getRandomValues(乱);
    } else {
      乱.forEach((_b, i) => (乱[i] = Math.floor(Math.random() * 256)));
    }
    return `NAI-${日}-${Array.from(乱, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("")}`;
  }

  function fileNameFor(reportId) {
    return `${reportId}.md`;
  }

  /** この次の部分は、どんな字でも必ず伏せる（人の名前・タグの名前が入る） */
  const ALWAYS_MASK_AFTER = new Set(["users", "user", "tags"]);
  /** この次の2つまでの部分は、英小文字と _ だけならそのまま（ランキングのジャンルと期間の名） */
  const CATEGORY_AFTER = new Set(["rankings", "ranking", "rank"]);

  /** アドレスの形の、決まった語でない部分を〈語〉に伏せる。伏せた数も返す */
  function maskShape(shape) {
    let masked = 0;
    let 必ず伏せる = false;
    let 区分の残り = 0;
    const 形 = String(shape || "")
      .split("/")
      .map((part) => {
        if (part === "") {
          return part;
        }
        const 伏せる番 = 必ず伏せる;
        必ず伏せる = false;
        const 区分 = 区分の残り > 0;
        区分の残り = Math.max(0, 区分の残り - 1);
        if (伏せる番) {
          masked += 1;
          return MASKED_WORD;
        }
        if (part === "#" || part === "N#") {
          return part;
        }
        // 数字を # にした語（例 weekly_#・#contest）は、# と前後の記号を外して語として見る
        const 語 = part.replace(/#/g, "").replace(/^[-_.]+|[-_.]+$/g, "");
        if (語 === "" || SHAPE_WORDS.has(語) || (区分 && /^[a-z_]+$/.test(語))) {
          if (ALWAYS_MASK_AFTER.has(語)) 必ず伏せる = true;
          if (CATEGORY_AFTER.has(語)) 区分の残り = 2;
          return part;
        }
        masked += 1;
        return MASKED_WORD;
      })
      .join("/");
    return { shape: 形, masked };
  }

  /**
   * ブラウザの名前と版・OS を、navigator.userAgentData から作る（取れなければ undefined。書かない）。
   * @param {{brands?:{brand:string,version:string}[], platform?:string}|undefined} uaData
   */
  function browserFromUAData(uaData) {
    if (!uaData || typeof uaData !== "object") {
      return { browser: undefined, os: undefined };
    }
    const 名の順 = ["Microsoft Edge", "Google Chrome", "Opera", "Brave", "Chromium"];
    const brands = Array.isArray(uaData.brands) ? uaData.brands : [];
    let browser;
    for (const 名 of 名の順) {
      const b = brands.find((x) => x && x.brand === 名);
      if (b && /^\d{1,4}$/.test(String(b.version))) {
        browser = `${名} ${b.version}`;
        break;
      }
    }
    const 決まったOS = ["Windows", "macOS", "Linux", "Chrome OS", "ChromeOS", "Android"];
    const os = 決まったOS.includes(uaData.platform) ? uaData.platform : undefined;
    return { browser, os };
  }

  function charCount(text) {
    return Array.from(String(text)).length;
  }

  function isCount(n) {
    return typeof n === "number" && Number.isInteger(n) && n >= 0;
  }

  /** 環境の欄（見出しを含む）。読めなかったものは行ごと省く */
  function environmentLines(input) {
    const 行 = [SUMMARY_HEADINGS.environment, `報告ID: ${input.reportId}`, FORMAT_LINE, `製品: ${PRODUCT_NAME}`];
    if (typeof input.version === "string" && /^\d+\.\d+\.\d+$/.test(input.version)) {
      行.push(`ヘルパー: ${input.version}`);
    }
    if (input.install === "store") {
      行.push("入れ方: Chrome ウェブストア");
    } else if (input.install === "unpacked") {
      行.push("入れ方: 手で読み込んだ版");
    }
    if (typeof input.browser === "string" && input.browser !== "") {
      行.push(`ブラウザ: ${input.browser}`);
    }
    if (typeof input.os === "string" && input.os !== "") {
      行.push(`OS: ${input.os}`);
    }
    if (typeof input.handToIde === "boolean") {
      行.push(`統合小説執筆環境へ渡す: ${input.handToIde ? "入" : "切"}`);
    }
    if (Array.isArray(input.ownWorks)) {
      const 並び = input.ownWorks.filter((w) => w && typeof w.label === "string" && isCount(w.count) && w.count > 0);
      行.push(`覚えた作品: ${並び.length > 0 ? 並び.map((w) => `${w.label} ${w.count}`).join("・") : "なし"}`);
    }
    if (isCount(input.stashCount)) {
      行.push(`溜まり: ${input.stashCount}件`);
    }
    if (Array.isArray(input.autoRead)) {
      const 数 = { auto: 0, manual: 0, undecided: 0 };
      for (const p of input.autoRead) {
        if (p && Object.prototype.hasOwnProperty.call(数, p.choice)) 数[p.choice] += 1;
      }
      行.push(`開いたときの自動取得: 自動 ${数.auto}種類・押したときだけ ${数.manual}種類・まだ決めていない ${数.undecided}種類`);
    }
    // 上限は見出しの下の中身で数える。ここまでの行は短いので超えないが、念のため後ろから落とす（報告ID・形・製品は残す）
    while (charCount(行.slice(1).join("\n")) > ENVIRONMENT_MAX_CHARS && 行.length > 4) {
      行.pop();
    }
    return 行;
  }

  /** 押したときの記録の1件を、伏せた形の1行にする */
  function pressLine(e, labels, toLocal) {
    const { shape, masked } = maskShape(e.shape);
    const どこ = shape ? `${e.place}${shape}` : e.place;
    const 結果 = e.result ? `${labels.result[e.result] || ""}${e.reason ? `（${labels.reason[e.reason] || e.reason}）` : ""}` : "";
    const 番号 = e.posted ? "（話の番号を読む画面）" : "";
    return {
      line: `- ${toLocal(e.at)}　${どこ}${番号}　${didLabel(e.did, labels.did)}${結果 ? `　${結果}` : ""}`,
      raw: [e.at, e.place, shape || "-", e.did, e.result || "-", e.reason || "-"].join(" "),
      masked,
    };
  }

  /**
   * 記録を組み立てる。
   * @param {object} input
   * @param {Date} input.now
   * @param {string} input.reportId
   * @param {string} [input.version] ヘルパーの版
   * @param {"store"|"unpacked"} [input.install]
   * @param {string} [input.browser] 例「Google Chrome 131」
   * @param {string} [input.os]
   * @param {boolean} [input.handToIde]
   * @param {{label:string, count:number}[]} [input.ownWorks] サイトの名前と、覚えた作品の数（番号は渡さない）
   * @param {number} [input.stashCount] 溜まりの件数
   * @param {{label:string, choice:"auto"|"manual"|"undecided"}[]} [input.autoRead] 画面の種類の名前と答え
   * @param {{entries:object[]}} [input.pressLog] common/pressLog.js の normalizeLog の形
   * @param {{did:object, result:object, reason:object}} input.labels pressLog の名前の表
   * @param {(iso:string)=>string} [input.toLocal] 時刻の書き方
   * @returns {{reportId:string, fileName:string, summary:string, document:string, maskedWords:number}}
   */
  function buildIssueReport(input) {
    if (!input || !REPORT_ID_PATTERN.test(String(input.reportId))) {
      throw new Error("報告ID の形が違います");
    }
    const labels = input.labels || { did: {}, result: {}, reason: {} };
    const toLocal = typeof input.toLocal === "function" ? input.toLocal : (iso) => iso;
    const fileName = fileNameFor(input.reportId);
    const entries = input.pressLog && Array.isArray(input.pressLog.entries) ? input.pressLog.entries.slice().reverse() : [];
    const 行たち = entries.map((e) => pressLine(e, labels, toLocal));
    const maskedWords = 行たち.reduce((n, x) => n + x.masked, 0);
    const 止めた = entries.filter((e) => e.result === "stopped").length;

    const 記録の頭 = [
      SUMMARY_HEADINGS.record,
      `報告ID ${input.reportId} の記録ファイル（${fileName}）を添付`,
      entries.length > 0 ? `押したときの記録: ${entries.length}件（新しい順）・止めた ${止めた}件` : "押したときの記録: なし",
    ];
    let 載せる = 行たち.length;
    const 記録の欄 = (n) => [
      ...記録の頭,
      ...行たち.slice(0, n).map((x) => x.line),
      ...(n < 行たち.length ? [`- ほか${行たち.length - n}件は添付の記録に`] : []),
    ];
    while (載せる > 0 && charCount(記録の欄(載せる).slice(1).join("\n")) > RECORD_MAX_CHARS) {
      載せる -= 1;
    }

    const 要約 = [
      ...environmentLines(input),
      "",
      SUMMARY_HEADINGS.steps,
      AUTHOR_HINTS.steps,
      "",
      SUMMARY_HEADINGS.expected,
      AUTHOR_HINTS.expected,
      "",
      SUMMARY_HEADINGS.actual,
      AUTHOR_HINTS.actual,
      "",
      ...記録の欄(載せる),
    ].join("\n");

    const 自動 = Array.isArray(input.autoRead)
      ? input.autoRead
          .filter((p) => p && typeof p.label === "string")
          .map((p) => `${p.label}: ${{ auto: "自動", manual: "押したときだけ", undecided: "まだ決めていない" }[p.choice] || "まだ決めていない"}`)
      : [];

    // 案内の行は句点で終わらせない（原稿の形に見せない。統合の guardShape と同じ理由）
    const 文書 = [
      `# 障害報告用の記録 ${input.reportId}`,
      "",
      "- このファイル：Discord の /不具合を報告 の「添付」に付けると、前半の「要約」で入力窓が埋まる（後半が詳細）",
      "- 添付しないとき：前半の「要約」を入力窓へ、欄ごとに貼る",
      "- 原稿・題・章・クリップボードの中身・作品の番号・作品名・読者の反応の数・URL は入れていない",
      "",
      "---",
      "",
      "# 要約",
      "",
      要約,
      "",
      "---",
      "",
      "# 詳細",
      "",
      "### 伏せたもの",
      "- 作品の番号・話の番号: 数字は #、なろうの Nコードは N#（押したときの記録の形のまま）",
      `- アドレスの中の決まった語でない部分（ユーザー名・タグの名前など）: ${maskedWords}か所 → ${MASKED_WORD}`,
      "- この拡張に関わらないサイト: サイトの名前も書かず「ほかのサイト」",
      "- 入れていないもの: 欄に入れた本文・題・章、クリップボードの中身、作品名、読者の反応の数、アドレスの ? から後ろ、会員の情報、拡張の ID",
      "",
      ...(自動.length > 0 ? ["### 開いたときの自動取得（画面の種類ごと）", "~~~text", ...自動, "~~~", ""] : []),
      "### 押したときの記録",
      "~~~text",
      ...(行たち.length > 0 ? 行たち.map((x) => x.raw) : ["（なし）"]),
      "~~~",
      "",
    ].join("\n");

    const バイト = new TextEncoder().encode(文書).byteLength;
    if (バイト > MAX_BYTES) {
      throw new Error("記録が大きすぎます");
    }
    return { reportId: input.reportId, fileName, summary: 要約, document: 文書, maskedWords };
  }

  const api = {
    FORMAT_VERSION,
    FORMAT_LINE,
    PRODUCT_NAME,
    REPORT_ID_PATTERN,
    ENVIRONMENT_MAX_CHARS,
    RECORD_MAX_CHARS,
    MAX_BYTES,
    SUMMARY_HEADINGS,
    AUTHOR_HINTS,
    MASKED_WORD,
    makeReportId,
    fileNameFor,
    maskShape,
    browserFromUAData,
    buildIssueReport,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHIssueReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
