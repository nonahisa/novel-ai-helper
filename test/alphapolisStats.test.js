import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

require("../common/match.js");
require("../common/guard.js");
const Stats = require("../content/statsSites.js");
const { readStats } = require("../content/read.js");
const Stash = require("../common/stash.js");
const History = require("../common/history.js");
const AutoRead = require("../common/autoRead.js");
const ContestSites = require("../content/contestSites.js");
const { 要素, 偽ページ } = require("./fakeDom.js");

/**
 * 0.17.0：アルファポリスの数・タグ・連載の状態を読む（作者の決定「数も読むようにする」）。
 *
 * 読むのは作者本人しか開けない画面（/mypage/ の下）だけ：
 *   作品管理の一覧 /mypage/content           … 作品ごとの累計ポイント・24時間のポイント・お気に入り数・ハート
 *   作品の管理画面 /mypage/content/detail/ID … 話ごとのいいね・しおり・エール・誤字報告
 *   作品の設定の画面 /mypage/novel/save/ID   … タグと連載の状態（数が無いので1件を作らない）
 *
 * 見本のページは本物の写しではない。要素の形（docs/measurements/2026-10-12-alphapolis-pages.md と
 * 作者の Chrome で読んだ形）だけを最小限にし、題・数・タグはすべて架空。
 */

const 読んだ日 = new Date(2026, 10, 2, 9, 0);
const 一覧のURL = "https://www.alphapolis.co.jp/mypage/content";
const 作品A = "111111111";
const 作品B = "222222222";
const 詳細のURL = `https://www.alphapolis.co.jp/mypage/content/detail/${作品A}`;
const 設定のURL = `https://www.alphapolis.co.jp/mypage/novel/save/${作品A}`;

/** 作品管理の一覧の1作品の枠（div.main） */
function 作品の枠(workId, 題, 数) {
  const n = Object.assign({ 累計: "1,234 pt (5,678位)", 一日: "24h. 7 pt (40,259位)", お気に入り: "お気に入り数：56", ハート: "9" }, 数 || {});
  const 中 = [
    要素("div", { class: "info" }, [
      要素("h2", { class: "title" }, [要素("a", { href: `/novel/999999999/${workId}` }, 題)]),
    ]),
    要素("div", { class: "favorite" }, [
      要素("div", { class: "heart" }, [要素("span", { class: "icon-heart" }, n.ハート)]),
      要素("div", { class: "count" }, n.お気に入り),
    ]),
    要素("div", { class: "text-count" }, [要素("div", { class: "published" }, [要素("span", { class: "value" }, "12,345")])]),
    要素("div", { class: "manage" }, [
      ...(n.累計 === null ? [] : [要素("div", { class: "notes" }, `累計 ${n.累計}`)]),
      ...(n.一日 === null ? [] : [要素("div", { class: "notes" }, n.一日)]),
      要素("a", { class: "button", href: `/mypage/content/detail/${workId}` }, "管理画面"),
    ]),
  ];
  return 要素("div", { class: "main" }, 中);
}

function 一覧のページ(枠たち) {
  return 偽ページ([要素("div", { class: "content-list" }, 枠たち)]);
}

describe("アルファポリスの読む画面と許す形（0.17.0）", () => {
  it("3つの画面を読める画面として認め、どれも本人しか開けない画面（ownerOnly）", () => {
    for (const [url, kind, id] of [
      [一覧のURL, "list", null],
      [`${一覧のURL}/`, "list", null],
      [詳細のURL, "detail", 作品A],
      [設定のURL, "settings", 作品A],
    ]) {
      const m = Stats.matchReadPage(url);
      expect(m.ok, url).toBe(true);
      expect(m.siteId).toBe("alphapolis");
      expect(m.page.kind).toBe(kind);
      expect(m.page.ownerOnly).toBe(true);
      expect(m.workId).toBe(id);
    }
  });

  it("投稿画面（save_episode）・作品の公開ページ・章の設定は読む画面ではない", () => {
    for (const url of [
      `https://www.alphapolis.co.jp/mypage/novel/save_episode/${作品A}`,
      `https://www.alphapolis.co.jp/novel/999999999/${作品A}`,
      `https://www.alphapolis.co.jp/mypage/content/manage_chapter/${作品A}`,
    ]) {
      expect(Stats.matchReadPage(url).ok, url).toBe(false);
    }
  });
});

describe("作品管理の一覧から、作品ごとに別の1件を作る（0.17.0）", () => {
  it("並んだ作品の数だけ封筒ができ、作品IDは管理画面へのリンクから", () => {
    const r = readStats(一覧のページ([作品の枠(作品A, "架空の題A"), 作品の枠(作品B, "架空の題B", { 累計: "20 pt (9,999位)" })]), 一覧のURL, 読んだ日);
    expect(r.ok).toBe(true);
    expect(r.works.map((w) => w.workId)).toEqual([作品A, 作品B]);
    expect(r.works.map((w) => w.title)).toEqual(["架空の題A", "架空の題B"]);
    const 封筒A = JSON.parse(r.works[0].json);
    expect(封筒A["novelai-stats"]).toBe(1);
    expect(封筒A.site).toBe("alphapolis");
    // 受け手は知らない source を封筒ごと断るので、source は付けない
    expect("source" in 封筒A).toBe(false);
    expect(封筒A.workId).toBe(作品A);
    expect(封筒A.title).toBe("架空の題A");
    expect(封筒A.entries).toEqual([
      {
        scope: "work",
        metrics: {
          points: 1234,
          alphapolis_rankTotal: 5678,
          alphapolis_points24h: 7,
          alphapolis_rank24h: 40259,
          bookmarks: 56,
          alphapolis_hearts: 9,
        },
      },
    ]);
    expect(JSON.parse(r.works[1].json).entries[0].metrics.points).toBe(20);
    expect(r.counts).toEqual({ work: 2, day: 0, episode: 0 });
  });

  it("お気に入り数が要素に包まれず、ハートと同じ枠に地の字で置かれていても読む（2026-11-01 実機の形）", () => {
    // 実機（作者の Chrome で読んだ形）：<div class="favorite"><div class="heart"><span class="icon icon-heart">23</span></div>
    // <i class="fa fa-caret-right"></i> お気に入り数：264 </div>。「お気に入り数：264」を包む要素が無く、
    // 枠の字は「23 お気に入り数：264」になる。偽のDOMは文字の節を持たないので、要素でない子として置く
    const 地の字 = (字) => ({ tagName: "#text", attrs: {}, children: [], textContent: 字, getAttribute: () => null });
    const 枠 = 作品の枠(作品A, "架空");
    const 好き = 枠.children.find((c) => c.getAttribute("class") === "favorite");
    好き.children.splice(0, 好き.children.length,
      要素("div", { class: "heart" }, [要素("span", { class: "icon icon-heart" }, "23")]),
      要素("i", { class: "fa fa-caret-right" }, ""),
      地の字("お気に入り数：264")
    );
    const m = JSON.parse(readStats(一覧のページ([枠]), 一覧のURL, 読んだ日).works[0].json).entries[0].metrics;
    expect(m.bookmarks).toBe(264);
    expect(m.alphapolis_hearts).toBe(23);
  });

  it("読めない数は欄ごと入れない（0 にしない）", () => {
    const r = readStats(一覧のページ([作品の枠(作品A, "架空", { 一日: null, ハート: "-" })]), 一覧のURL, 読んだ日);
    const m = JSON.parse(r.works[0].json).entries[0].metrics;
    expect("alphapolis_points24h" in m).toBe(false);
    expect("alphapolis_hearts" in m).toBe(false);
    expect(m.points).toBe(1234);
  });

  it("共通の名前（points・bookmarks など）が1つも読めない作品は、1件にしない（受け手が封筒ごと断るため）", () => {
    const r = readStats(
      一覧のページ([作品の枠(作品A, "架空", { 累計: null, お気に入り: "お気に入り数：-" }), 作品の枠(作品B, "架空B")]),
      一覧のURL,
      読んだ日
    );
    expect(r.works.map((w) => w.workId)).toEqual([作品B]);
  });

  it("作品が1つも読めなければ、何も返さない", () => {
    expect(readStats(一覧のページ([]), 一覧のURL, 読んだ日).ok).toBe(false);
  });

  it("枠を包む外側の div.main（中に別の枠を持つもの）は読まない", () => {
    const 外 = 要素("div", { class: "main" }, [作品の枠(作品A, "架空A"), 作品の枠(作品B, "架空B")]);
    const r = readStats(偽ページ([外]), 一覧のURL, 読んだ日);
    expect(r.works.map((w) => w.workId)).toEqual([作品A, 作品B]);
  });
});

/** 作品の管理画面の話の行（div.content） */
function 話の行(題, しおり, 誤字, いいね, エール) {
  return 要素("div", { class: "content" }, [
    要素("div", { class: "title" }, [要素("h3", {}, 題)]),
    要素("span", { class: "bookmark" }, [要素("span", { class: "icon-bookmark" }, ""), 要素("span", { class: "count" }, しおり)]),
    要素("p", { class: "yell-count" }, [
      要素("span", { class: "icon-emendation" }, 誤字),
      要素("span", { class: "icon-heart" }, いいね),
      要素("span", { class: "icon-yell" }, エール),
    ]),
    要素("div", { class: "char-count" }, "3,697文字"),
  ]);
}

function 詳細のページ(行たち) {
  return 偽ページ([要素("div", { class: "episodes" }, 行たち)]);
}

describe("作品の管理画面から、話ごとの数を読む（0.17.0）", () => {
  it("話ごとに likes（いいね）と、アルファポリスにだけある数を入れる。いいねが 0 でも入れる", () => {
    const ページ = 詳細のページ([
      要素("div", { class: "chapter" }, "第一章『架空の谷』"),
      話の行("１話　架空の始まり", "12", "0回 |", "10回 |", "0 回 |"),
      話の行("２話　架空の続き", "3", "1回 |", "0回 |", "2 回 |"),
    ]);
    const r = readStats(ページ, 詳細のURL, 読んだ日);
    expect(r.ok).toBe(true);
    const 封筒 = JSON.parse(r.json);
    expect(封筒.site).toBe("alphapolis");
    expect(封筒.workId).toBe(作品A);
    expect("source" in 封筒).toBe(false);
    expect(封筒.entries).toEqual([
      { scope: "episode", episode: 1, metrics: { likes: 10, alphapolis_bookmarks: 12, alphapolis_typoReports: 0, alphapolis_yells: 0 } },
      { scope: "episode", episode: 2, metrics: { likes: 0, alphapolis_bookmarks: 3, alphapolis_typoReports: 1, alphapolis_yells: 2 } },
    ]);
    expect(r.counts).toEqual({ work: 0, day: 0, episode: 2 });
  });

  it("いいねが読めない話は、行ごと入れない（共通の名前の無い行が混ざると、受け手が封筒ごと断る）", () => {
    const r = readStats(詳細のページ([話の行("１話　架空", "12", "0回 |", "", "0 回 |"), 話の行("２話　架空", "1", "0回 |", "4回 |", "0 回 |")]), 詳細のURL, 読んだ日);
    expect(JSON.parse(r.json).entries.map((e) => e.episode)).toEqual([2]);
  });

  it("話の行を包む同じ名の要素（中に別の話の行を持つ div.content）は読まない（話が二重にならない）", () => {
    const 包み = 要素("div", { class: "content" }, [
      話の行("１話　架空", "1", "0回 |", "4回 |", "0 回 |"),
      話の行("２話　架空", "2", "0回 |", "5回 |", "0 回 |"),
    ]);
    const r = readStats(偽ページ([包み]), 詳細のURL, 読んだ日);
    expect(JSON.parse(r.json).entries.map((e) => [e.episode, e.metrics.likes])).toEqual([
      [1, 4],
      [2, 5],
    ]);
  });

  it("話の行が無ければ、何も返さない", () => {
    expect(readStats(詳細のページ([]), 詳細のURL, 読んだ日).ok).toBe(false);
  });
});

/** 作品の設定の画面（投稿のフォーム） */
function 設定のページ(タグたち, 状態) {
  return 偽ページ([
    要素("form", { id: "NovelSaveForm" }, [
      要素("input", { type: "text", name: "title", value: "架空の題" }),
      ...タグたち.map((t) => 要素("input", { type: "text", class: "tag-name", name: "tag_names[]", value: t })),
      要素(
        "select",
        { id: "NovelComplete", name: "complete" },
        [
          ["1", "完結"],
          ["2", "連載中"],
        ].map(([v, 字]) => 要素("option", Object.assign({ value: v }, 状態 === 字 ? { selected: "" } : {}), 字))
      ),
      要素("input", { type: "submit", name: "save", value: "保存" }),
    ]),
  ]);
}

describe("作品の設定の画面から、タグと連載の状態を読む（0.17.0）", () => {
  it("タグの欄の値（空の欄は除く）と、選ばれている連載の状態を返し、封筒は作らない", () => {
    const r = readStats(設定のページ(["架空の街", "幽霊", "", "幽霊"], "連載中"), 設定のURL, 読んだ日);
    expect(r.ok).toBe(true);
    expect(r.factsOnly).toBe(true);
    expect(r.workId).toBe(作品A);
    expect(r.facts).toEqual({ tags: ["架空の街", "幽霊"], completion: "ongoing" });
    expect(r.json).toBeUndefined();
  });

  it("「完結」が選ばれていれば completed。タグの欄が全部空なら空の配列", () => {
    const r = readStats(設定のページ(["", ""], "完結"), 設定のURL, 読んだ日);
    expect(r.facts).toEqual({ tags: [], completion: "completed" });
  });

  it("タグの欄も連載の状態の欄も無ければ、何も返さない", () => {
    expect(readStats(偽ページ([要素("form", {}, [])]), 設定のURL, 読んだ日).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 溜まりと束
 * ------------------------------------------------------------------ */

describe("溜めてよいか（0.17.0）", () => {
  it("作品管理の一覧は作品IDの無い画面でも、本人だけの画面として溜めてよい", () => {
    const d = Stash.stashDecision(Stats.matchReadPage(一覧のURL), []);
    expect(d.stash).toBe(true);
    expect(d.learnOwn).toBe(true);
  });

  it("作品の管理画面・設定の画面は、開いて読めたら自分の作品として覚える", () => {
    for (const url of [詳細のURL, 設定のURL]) {
      const d = Stash.stashDecision(Stats.matchReadPage(url), []);
      expect(d).toMatchObject({ stash: true, learnOwn: true, workId: 作品A });
    }
  });
});

describe("設定の画面で読んだタグと連載の状態を、数のある1件へ載せる（0.17.0）", () => {
  it("覚えた事柄は作品ごとに新しいもの1つ。数の1件が無いあいだは何も渡さない", () => {
    let s = Stash.emptyState();
    s = Stash.putFacts(s, "alphapolis", 作品A, { tags: ["古い"] }, new Date(2026, 10, 1));
    s = Stash.putFacts(s, "alphapolis", 作品A, { tags: ["幽霊"], completion: "ongoing" }, 読んだ日);
    expect(s.workFacts).toHaveLength(1);
    expect(s.workFacts[0]).toMatchObject({ siteId: "alphapolis", workId: 作品A, tags: ["幽霊"], completion: "ongoing" });
    expect(Stash.countItems(s)).toBe(0);
    // 保存から読み直しても残る
    expect(Stash.normalizeState(JSON.parse(JSON.stringify(s))).workFacts[0].tags).toEqual(["幽霊"]);
  });

  it("束にするとき、同じ作品の数の1件にタグと連載の状態を載せる（ほかの作品には載せない）", () => {
    let s = Stash.emptyState();
    const 一覧 = readStats(一覧のページ([作品の枠(作品A, "架空A"), 作品の枠(作品B, "架空B")]), 一覧のURL, 読んだ日);
    const 場所 = Stats.matchReadPage(一覧のURL);
    for (const w of 一覧.works) {
      const 作った = Stash.makeItem({ json: w.json, counts: { work: 1 } }, Object.assign({}, 場所, { workId: w.workId }), 一覧のURL, 読んだ日);
      s = Stash.putItem(s, 作った.item).state;
    }
    expect(s.items.map((i) => i.key)).toEqual([`alphapolis|list|${作品A}|1`, `alphapolis|list|${作品B}|1`]);
    s = Stash.putFacts(s, "alphapolis", 作品A, { tags: ["幽霊"], completion: "completed" }, 読んだ日);
    const 束 = Stash.makeBundle(s.items, 読んだ日, s.ownWorks, s.workFacts);
    expect(束.items[0].tags).toEqual(["幽霊"]);
    expect(束.items[0].completion).toBe("completed");
    expect("tags" in 束.items[1]).toBe(false);
    // 溜まりの封筒そのものは書き換えない
    expect("tags" in s.items[0].envelope).toBe(false);
  });

  it("説明のページで覚えた作品の欄を保存しても、アルファポリスの覚えた作品は消えない", () => {
    let s = Stash.emptyState();
    s = Stash.rememberOwnWork(s, "alphapolis", 作品A, "owner-page", 読んだ日);
    const r = Stash.replaceOwnWorksFromText(s, { kakuyomu: "1177354054000000001", narouFun: "" }, 読んだ日);
    expect(r.ok).toBe(true);
    expect(r.state.ownWorks.map((w) => w.siteId).sort()).toEqual(["alphapolis", "kakuyomu"]);
  });
});

describe("集計（0.17.0）", () => {
  it("アルファポリスの作品は、サイトの名と画面の呼び名で出る", () => {
    let h = History.emptyHistory();
    const 一覧 = readStats(一覧のページ([作品の枠(作品A, "架空の題A")]), 一覧のURL, 読んだ日);
    h = History.recordEnvelope(h, JSON.parse(一覧.works[0].json), "alphapolis", 作品A, 読んだ日);
    h = History.rememberTitle(h, "alphapolis", 作品A, "架空の題A", JSON.parse(一覧.works[0].json).readAt);
    h = History.rememberFacts(h, "alphapolis", 作品A, { tags: ["幽霊"], completion: "ongoing" }, 読んだ日.toISOString());
    const 文 = History.formatReport(h, [{ siteId: "alphapolis", workId: 作品A }], 読んだ日);
    expect(文).toContain(`■ アルファポリス　架空の題A（作品ID ${作品A}）`);
    expect(文).toContain("連載中　タグ：幽霊");
    expect(文).toContain("累計ポイント 1,234");
    expect(文).toContain("お気に入り 56");
  });
});

/* ------------------------------------------------------------------ *
 * 開いたときの自動取得の承認
 * ------------------------------------------------------------------ */

describe("開いたときの自動取得の承認（0.17.0）", () => {
  const 種類 = AutoRead.listPageTypes(Stats.STATS_SITES, ContestSites.CONTEST_SITES);

  it("アルファポリスの3つの画面が、承認の種類に並ぶ", () => {
    const 鍵 = 種類.map((t) => t.key);
    expect(鍵).toEqual(expect.arrayContaining(["alphapolis|list", "alphapolis|detail", "alphapolis|settings"]));
  });

  it("更新して入れても、アルファポリスの画面は「自動」にせず、初めて開いたときに訊く", () => {
    const 答え = AutoRead.consentOnInstalled({ pages: {} }, "update", 種類, 読んだ日);
    expect(AutoRead.isAuto(答え, "kakuyomu|work")).toBe(true);
    for (const k of ["alphapolis|list", "alphapolis|detail", "alphapolis|settings"]) {
      expect(AutoRead.shouldAsk(答え, k), k).toBe(true);
    }
    const 形跡 = AutoRead.consentWhenMissing(true, 種類, 読んだ日);
    expect(AutoRead.shouldAsk(形跡, "alphapolis|list")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * ページへ入る範囲
 * ------------------------------------------------------------------ */

const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
function 型を正規表現に(型) {
  const m = /^(https):\/\/([^/*]+)(\/.*)$/.exec(型);
  const 逃がす = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${m[1]}://${逃がす(m[2])}${逃がす(m[3]).replace(/\*/g, ".*")}$`);
}
const 入るか = (url, js) =>
  manifest.content_scripts.some((c) => (c.js || []).includes(js) && (c.matches || []).some((型) => 型を正規表現に(型).test(url)));

describe("アルファポリスの読む画面へ入る範囲（manifest の matches。0.17.0）", () => {
  it("一覧・管理画面・設定の画面に、読み取り係が入る", () => {
    for (const url of [一覧のURL, `${一覧のURL}?page=2`, 詳細のURL, 設定のURL]) {
      expect(入るか(url, "content/read.js"), url).toBe(true);
    }
  });

  it("設定の画面の範囲（save/*）は、投稿画面（save_episode）に重ならない", () => {
    const 型たち = manifest.content_scripts.flatMap((c) => c.matches || []).filter((m) => m.includes("/mypage/novel/save/"));
    expect(型たち.length).toBeGreaterThan(0);
    for (const 型 of 型たち) {
      expect(型を正規表現に(型).test(`https://www.alphapolis.co.jp/mypage/novel/save_episode/${作品A}`), 型).toBe(false);
    }
  });

  it("貼り込み係は、一覧・管理画面・設定の画面に入らない（投稿画面だけ）", () => {
    for (const url of [一覧のURL, 詳細のURL, 設定のURL]) {
      expect(入るか(url, "content/fill.js"), url).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 受け手の本物に読ませる
 * ------------------------------------------------------------------ */

const 母艦の読み口 = join(
  process.env.NOVELAI_ASSISTANT_DIR || join(ルート, "..", "novel-ai-assistant"),
  "src",
  "core",
  "readerStatsEnvelope.ts"
);

describe.skipIf(!existsSync(母艦の読み口))("アルファポリスの封筒を、受け手がそのまま受け取る（0.17.0）", () => {
  it("作品管理の一覧の1件", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const r = readStats(一覧のページ([作品の枠(作品A, "架空の題A")]), 一覧のURL, 読んだ日);
    const 封筒 = Object.assign(JSON.parse(r.works[0].json), { tags: ["幽霊"], completion: "ongoing", ownedVia: "owner-page" });
    const 受け取り = parseReaderStatsEnvelope(JSON.stringify(封筒));
    expect(受け取り.ok, JSON.stringify(受け取り)).toBe(true);
  });

  it("作品の管理画面（話ごと）", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const r = readStats(詳細のページ([話の行("１話　架空", "12", "0回 |", "0回 |", "0 回 |")]), 詳細のURL, 読んだ日);
    const 受け取り = parseReaderStatsEnvelope(r.json);
    expect(受け取り.ok, JSON.stringify(受け取り)).toBe(true);
  });
});
