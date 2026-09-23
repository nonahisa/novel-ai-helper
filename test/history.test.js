import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const History = require("../common/history.js");

/**
 * 読者の反応の記録（履歴）と簡易集計（0.10.0。common/history.js）。
 *
 * 確かめること：
 * - 記録の畳み方（同じ作品・同じ日は1件、欄ごとに新しい数で置き換え。古い読み取りで上書きしない）
 * - 上限（日数・作品数・大きさ。古いものから落とす）
 * - 率の式が統合小説執筆環境と**同じ入力で同じ値**を出す（相手の src/core/readerRates.ts に直接計算させる）
 * - 材料が欠けたときは 0% にせず、理由を出す
 * - 覚えていない作品は集計にも記録にも残さない
 *
 * 数字・作品ID・Nコードはすべて架空。
 */

const 作品ID = "1177354054934570000";
const Nコード = "N1234AB";

/** 読み取り係のデータ（1件）を作る。 */
function データ(readAt, entries, extra = {}) {
  return Object.assign({ "novelai-stats": 1, site: "kakuyomu", workId: 作品ID, readAt, entries }, extra);
}

function なろうのデータ(readAt, entries) {
  return データ(readAt, entries, { site: "narou", source: "narou.fun", workId: Nコード, readAtBasis: "fetched" });
}

/** 並べたデータを順に記録へ畳む。 */
function 記録する(データたち, siteId = "kakuyomu", workId = 作品ID, limits) {
  let h = History.emptyHistory();
  for (const d of データたち) {
    h = History.recordEnvelope(h, d, siteId, workId, new Date("2026-09-23T03:00:00Z"), limits);
  }
  return h;
}

const 作品 = (h, siteId = "kakuyomu", workId = 作品ID) =>
  h.works.find((w) => w.siteId === siteId && w.workId === History.normalizeHistory({ works: [{ siteId, workId }] }).works[0].workId);

/* ------------------------------------------------------------------ *
 * 話ごとの行を作る小道具
 * ------------------------------------------------------------------ */

/** 第n話（PVと最終更新） */
const 話 = (n, pv, updatedAt) =>
  Object.assign({ scope: "episode", episode: n, metrics: pv === undefined ? { likes: 1 } : { pv } }, updatedAt ? { updatedAt } : {});

const 全体 = (metrics) => ({ scope: "work", metrics });
const 日 = (periodKey, metrics) => ({ scope: "work", period: "day", periodKey, metrics });
const 月 = (periodKey, metrics) => ({ scope: "work", period: "month", periodKey, metrics });

/* ------------------------------------------------------------------ *
 * 率の場面（統合小説執筆環境と比べるものと、理由を確かめるものの両方で使う）
 * ------------------------------------------------------------------ */

const 読んだ日 = "2026-09-20T03:00:00.000Z";
const 場面 = {
  "作品管理1回（全話・更新日つき）": [
    データ(読んだ日, [
      全体({ bookmarks: 230, reviews: 61, pv: 12345, points: 611 }),
      話(1, 1000, "2026-09-01T12:00:00+09:00"),
      話(2, 700, "2026-09-05T12:00:00+09:00"),
      話(3, 400, "2026-09-10T12:00:00+09:00"),
      // 読んだ時点で更新から2日足らず（基準にしない）
      話(4, 50, "2026-09-19T00:00:00+09:00"),
    ]),
  ],
  "作品管理のあとに、アクセス数（更新日なし）を読んだ": [
    データ(読んだ日, [
      全体({ bookmarks: 230, reviews: 61 }),
      話(1, 1000, "2026-09-01T12:00:00+09:00"),
      話(2, 700, "2026-09-05T12:00:00+09:00"),
      話(3, 400, "2026-09-10T12:00:00+09:00"),
    ]),
    データ("2026-09-21T03:00:00.000Z", [話(1, 1100), 話(2, 720)]),
  ],
  "72時間ちょうどは基準に入る": [
    データ("2026-09-20T03:00:00.000Z", [
      全体({ bookmarks: 10, reviews: 2 }),
      話(1, 100, "2026-09-10T03:00:00.000Z"),
      話(2, 40, "2026-09-17T03:00:00.000Z"),
    ]),
  ],
  "更新から3日たった話が無い": [
    データ(読んだ日, [全体({ bookmarks: 10, reviews: 2 }), 話(1, 100, "2026-09-19T12:00:00+09:00")]),
  ],
  "更新日の分かる話が無い（アクセス数だけ）": [データ(読んだ日, [話(1, 100), 話(2, 60)])],
  "第1話のPVが無い": [
    データ(読んだ日, [全体({ bookmarks: 10, reviews: 2 }), 話(2, 60, "2026-09-01T12:00:00+09:00")]),
  ],
  "第1話のPVが0": [
    データ(読んだ日, [全体({ bookmarks: 10, reviews: 2 }), 話(1, 0, "2026-09-01T12:00:00+09:00")]),
  ],
  "基準の話にPVが無い": [
    データ(読んだ日, [
      全体({ bookmarks: 10, reviews: 2 }),
      話(1, 100, "2026-09-01T12:00:00+09:00"),
      話(2, undefined, "2026-09-02T12:00:00+09:00"),
    ]),
  ],
  "新しいほうをあとから、古いほうをさらにあとから入れた": [
    データ("2026-09-22T03:00:00.000Z", [全体({ bookmarks: 300, reviews: 70 }), 話(1, 2000, "2026-09-01T12:00:00+09:00")]),
    データ("2026-09-20T03:00:00.000Z", [全体({ bookmarks: 200, reviews: 50 }), 話(1, 1500, "2026-09-01T12:00:00+09:00")]),
  ],
  "Narou.fun だけ（話ごとの数が無い）": [
    なろうのデータ(読んだ日, [全体({ points: 900, bookmarks: 300, narou_raters: 40, reviews: 0 })]),
  ],
};

function 場面の記録(名) {
  const データたち = 場面[名];
  const なろう = データたち[0].site === "narou";
  return 記録する(データたち, なろう ? "narouFun" : "kakuyomu", なろう ? Nコード : 作品ID);
}

function 場面の率(名) {
  const h = 場面の記録(名);
  return History.computeRates(h.works[0]);
}

describe("記録の畳み方", () => {
  it("同じ作品・同じ日の2回は1件にまとめ、新しいほうの数で置き換える。別の日は別の1件", () => {
    const h = 記録する([
      データ("2026-09-20T01:00:00.000Z", [全体({ pv: 100, bookmarks: 10 })]),
      データ("2026-09-20T05:00:00.000Z", [全体({ pv: 120 })]),
      データ("2026-09-21T03:00:00.000Z", [全体({ pv: 150, bookmarks: 12 })]),
    ]);
    const w = 作品(h);
    expect(w.snapshots.map((s) => s.date)).toEqual(["2026-09-20", "2026-09-21"]);
    // 同じ日の2回目に無かった欄（bookmarks）は、1回目の数を残す
    expect(w.snapshots[0].metrics).toEqual({ pv: 120, bookmarks: 10 });
    expect(w.snapshots[0].readAt).toBe("2026-09-20T05:00:00.000Z");
    expect(w.latest.pv).toEqual({ value: 150, readAt: "2026-09-21T03:00:00.000Z" });
  });

  it("古い読み取りをあとから入れても、新しい数を上書きしない（欠けた欄は埋める）", () => {
    const h = 記録する([
      データ("2026-09-20T05:00:00.000Z", [全体({ pv: 120 }), 話(1, 50)]),
      データ("2026-09-20T01:00:00.000Z", [全体({ pv: 100, bookmarks: 10 }), 話(1, 40, "2026-09-01T12:00:00+09:00")]),
    ]);
    const w = 作品(h);
    expect(w.snapshots).toHaveLength(1);
    expect(w.snapshots[0].metrics).toEqual({ pv: 120, bookmarks: 10 });
    expect(w.latest.pv.value).toBe(120);
    expect(w.lastReadAt).toBe("2026-09-20T05:00:00.000Z");
    // 話ごと：PVは新しいほう、更新日は（新しいほうに無かったので）古いほうから
    expect(w.episodes["1"].pv).toBe(50);
    expect(w.episodes["1"].updatedAt).toBe("2026-09-01T12:00:00+09:00");
  });

  it("サイトが出している日ごと・月ごとの数は、日付ごとに新しいほうで置き換える", () => {
    const h = 記録する([
      データ("2026-09-20T03:00:00.000Z", [日("2026-09-19", { pv: 30 }), 日("2026-09-20", { pv: 5 }), 月("2026-09", { pv: 600 })]),
      データ("2026-09-20T09:00:00.000Z", [日("2026-09-20", { pv: 12 }), 月("2026-09", { pv: 607 })]),
    ]);
    const w = 作品(h);
    expect(w.daily["2026-09-19"].metrics).toEqual({ pv: 30 });
    expect(w.daily["2026-09-20"].metrics).toEqual({ pv: 12 });
    expect(w.monthly["2026-09"].metrics).toEqual({ pv: 607 });
  });

  it("Nコードは大文字でも小文字でも同じ作品として畳む", () => {
    let h = History.emptyHistory();
    h = History.recordEnvelope(h, なろうのデータ("2026-09-20T03:00:00.000Z", [全体({ points: 1 })]), "narouFun", "N1234AB", new Date());
    h = History.recordEnvelope(h, なろうのデータ("2026-09-21T03:00:00.000Z", [全体({ points: 2 })]), "narouFun", "n1234ab", new Date());
    expect(h.works).toHaveLength(1);
    expect(h.works[0].workId).toBe("n1234ab");
    expect(h.works[0].snapshots).toHaveLength(2);
  });

  it("形の崩れた保存は、その欄だけ捨てて読む", () => {
    const h = History.normalizeHistory({
      works: [
        { siteId: "kakuyomu", workId: 作品ID, lastReadAt: "2026-09-20T03:00:00.000Z", latest: { pv: { value: "多い", readAt: "x" } }, snapshots: "壊れた", episodes: { "0": { at: "2026-09-20T03:00:00.000Z" } } },
        { siteId: "kakuyomu" },
        "文字",
      ],
    });
    expect(h.works).toHaveLength(1);
    expect(h.works[0].latest).toEqual({});
    expect(h.works[0].snapshots).toEqual([]);
    expect(h.works[0].episodes).toEqual({});
    expect(History.normalizeHistory(null)).toEqual(History.emptyHistory());
  });
});

describe("記録の上限（古いものから落とす）", () => {
  it("日数：記録した日が上限を越えたら、古い日から落とす（日ごとの数も同じ）", () => {
    const データたち = [];
    for (let i = 1; i <= 8; i += 1) {
      const d = `2026-09-${String(i).padStart(2, "0")}`;
      データたち.push(データ(`${d}T03:00:00.000Z`, [全体({ pv: i }), 日(d, { pv: i })]));
    }
    const h = 記録する(データたち, "kakuyomu", 作品ID, { maxDays: 5 });
    const w = 作品(h);
    expect(w.snapshots.map((s) => s.date)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
    expect(Object.keys(w.daily).sort()).toEqual(["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
  });

  it("作品数：上限を越えたら、いちばん長く記録していない作品から落とす", () => {
    let h = History.emptyHistory();
    for (let i = 1; i <= 4; i += 1) {
      const id = `1000000000000000${i}`;
      h = History.recordEnvelope(h, データ(`2026-09-0${i}T03:00:00.000Z`, [全体({ pv: i })], { workId: id }), "kakuyomu", id, new Date(), { maxWorks: 3 });
    }
    expect(h.works.map((w) => w.workId).sort()).toEqual(["10000000000000002", "10000000000000003", "10000000000000004"]);
  });

  it("大きさ：上限を越えたら、全作品を通していちばん古い日の分から落とす（どの作品も最後の1日は残す）", () => {
    const データたち = [];
    for (let i = 1; i <= 9; i += 1) {
      const d = `2026-09-0${i}`;
      データたち.push(データ(`${d}T03:00:00.000Z`, [全体({ pv: i * 1000, bookmarks: i, points: i, reviews: i })]));
    }
    const 全部 = 記録する(データたち);
    const 大きさ = JSON.stringify(全部).length;
    const h = 記録する(データたち, "kakuyomu", 作品ID, { maxChars: 大きさ - 1 });
    const w = 作品(h);
    expect(JSON.stringify(h).length).toBeLessThanOrEqual(大きさ - 1);
    expect(w.snapshots[0].date).not.toBe("2026-09-01");
    expect(w.snapshots.at(-1).date).toBe("2026-09-09");
  });

  it("既定の上限は 20作品・180日・24か月・150万字", () => {
    expect(History.HISTORY_LIMITS).toEqual({ maxWorks: 20, maxDays: 180, maxMonths: 24, maxChars: 1500000 });
  });
});

describe("覚えていない作品は残さない", () => {
  it("覚えた作品から外した作品の記録は消える", () => {
    let h = 記録する([データ("2026-09-20T03:00:00.000Z", [全体({ pv: 1 })])]);
    h = History.recordEnvelope(h, なろうのデータ("2026-09-20T03:00:00.000Z", [全体({ points: 1 })]), "narouFun", Nコード, new Date());
    const 残した = History.keepOnlyOwn(h, [{ siteId: "narouFun", workId: "N1234AB" }]);
    expect(残した.works.map((w) => w.siteId)).toEqual(["narouFun"]);
  });

  it("集計に出すのは覚えた作品だけ（記録に残っていても、覚えていない作品は出さない）", () => {
    const h = 記録する([データ("2026-09-20T03:00:00.000Z", [全体({ pv: 1 })])]);
    expect(History.buildReport(h, [], new Date())).toEqual([]);
    const 文 = History.formatReport(h, [{ siteId: "narouFun", workId: "n9999zz" }], new Date());
    expect(文).not.toContain(作品ID);
    expect(文).toContain("n9999zz");
    expect(文).toContain("まだ記録がありません");
  });

  it("覚えた作品が1つも無いときは、はじめの手順を案内する", () => {
    expect(History.formatReport(History.emptyHistory(), [], new Date())).toContain("はじめに");
  });
});

describe("率：材料が欠けたら 0% にせず理由を出す", () => {
  it("そろっていれば、式と実際の数を並べる（作品管理1回）", () => {
    const r = 場面の率("作品管理1回（全話・更新日つき）");
    // 基準の話は第3話（第4話は更新から3日たっていない）
    expect(r.base.episode).toBe(3);
    expect(r.dropout.percent).toBe("60.0%");
    expect(r.dropout.formula).toBe("1 − 第3話のPV ÷ 第1話のPV");
    expect(r.dropout.expression).toBe("1 − 400 ÷ 1,000 = 60.0%");
    expect(r.bookmark.expression).toBe("230 ÷ 1,000 = 23.0%");
    expect(r.rating.formula).toBe("作品全体のレビュー（評価した人数） ÷ 第1話のPV");
    expect(r.rating.expression).toBe("61 ÷ 1,000 = 6.1%");
  });

  it.each([
    ["更新から3日たった話が無い", "dropout", "更新から3日以上たった話がありません"],
    ["更新日の分かる話が無い（アクセス数だけ）", "dropout", "更新日の分かる話がありません"],
    ["更新日の分かる話が無い（アクセス数だけ）", "bookmark", "作品全体のブックマークがありません"],
    ["第1話のPVが無い", "bookmark", "第1話のPVがありません"],
    ["第1話のPVが0", "rating", "第1話のPVが0です（0では割れません）"],
    ["基準の話にPVが無い", "dropout", "第2話のPVがありません"],
    ["Narou.fun だけ（話ごとの数が無い）", "dropout", "話ごとの記録がありません"],
    ["Narou.fun だけ（話ごとの数が無い）", "rating", "話ごとの記録がありません"],
  ])("%s → %s は「%s」", (名, 率, 理由) => {
    const r = 場面の率(名)[率];
    expect(r.missing).toBe(理由);
    expect(r.value).toBeUndefined();
    expect(r.percent).toBeUndefined();
  });

  it("出せない率は、画面の文でも 0% と書かず「出せません」と理由を書く", () => {
    const h = 場面の記録("第1話のPVが0");
    const 文 = History.formatReport(h, [{ siteId: "kakuyomu", workId: 作品ID }], new Date("2026-09-23T03:00:00Z"));
    expect(文).toContain("出せません：第1話のPVが0です（0では割れません）");
    expect(文).not.toMatch(/(離脱率|ブックマーク率|評価率)\s+0\.0%/);
  });

  it("なろうの評価率は評価者数で割る（なろうのレビューは書かれたレビューの件数）", () => {
    const h = 記録する(
      [
        なろうのデータ(読んだ日, [全体({ bookmarks: 30, narou_raters: 8, reviews: 0 })]),
        // Narou.fun には話ごとのPVが無いので、ここでは架空に足して式だけを確かめる
        なろうのデータ(読んだ日, [{ scope: "episode", episode: 1, metrics: { pv: 400 } }]),
      ],
      "narouFun",
      Nコード
    );
    const r = History.computeRates(h.works[0]);
    expect(r.rating.formula).toBe("作品全体の評価者数（評価した人数） ÷ 第1話のPV");
    expect(r.rating.expression).toBe("8 ÷ 400 = 2.0%");
  });
});

/*
 * 統合小説執筆環境（novel-ai-assistant）が隣のフォルダーにあれば、**同じ入力を相手の率の計算に通して**
 * 値が一致することを確かめる。式を写しで書いているので、片方だけが変わった日に気づくため
 * （test/readEnvelope.test.js と同じ考え方。相手が無い環境では、この組だけを飛ばす）。
 */
const 相手のフォルダー = process.env.NOVELAI_ASSISTANT_DIR || join(ルート, "..", "novel-ai-assistant");
const 相手の率 = join(相手のフォルダー, "src", "core", "readerRates.ts");
const 相手の読み口 = join(相手のフォルダー, "src", "core", "readerStatsEnvelope.ts");
const 相手がある = existsSync(相手の率) && existsSync(相手の読み口);

/** 比べやすい形にする（日時は書き方でなく時刻で比べる）。 */
function 比べる形(r) {
  const 率 = (x) => ({
    label: x.label,
    formula: x.formula,
    value: x.value,
    percent: x.percent,
    expression: x.expression,
    missing: x.missing,
    operands: x.operands.map((o) => ({ label: o.label, value: o.value, readAt: o.readAt ? Date.parse(o.readAt) : undefined })),
  });
  return {
    episodeReadAt: r.episodeReadAt ? Date.parse(r.episodeReadAt) : null,
    base: r.base
      ? { episode: r.base.episode, pv: r.base.pv, updatedAt: Date.parse(r.base.updatedAt), updatedReadAt: Date.parse(r.base.updatedReadAt) }
      : null,
    baseMissing: r.baseMissing,
    dropout: 率(r.dropout),
    bookmark: 率(r.bookmark),
    rating: 率(r.rating),
  };
}

describe.skipIf(!相手がある)("率の式が統合小説執筆環境と同じ値を出す（同じ入力で比べる）", () => {
  it.each(Object.keys(場面))("%s", async (名) => {
    const { computeReaderRates } = await import(/* @vite-ignore */ 相手の率);
    const { parseReaderStatsEnvelope, readerStatsRecordsFromEnvelope } = await import(/* @vite-ignore */ 相手の読み口);
    const 記録 = [];
    for (const d of 場面[名]) {
      const 受け取り = parseReaderStatsEnvelope(JSON.stringify(d));
      expect(受け取り.ok, 受け取り.ok ? "" : 受け取り.reason).toBe(true);
      記録.push(...readerStatsRecordsFromEnvelope(受け取り.envelope));
    }
    const 相手 = computeReaderRates(記録);
    const こちら = 場面の率(名);
    expect(比べる形(こちら)).toEqual(比べる形(相手));
  });
});

describe("集計の文", () => {
  const h = 記録する([
    データ("2026-09-19T03:00:00.000Z", [全体({ pv: 1000, bookmarks: 20, points: 50 })]),
    データ("2026-09-20T03:00:00.000Z", [
      全体({ pv: 1100, bookmarks: 22, points: 50, reviews: 12 }),
      日("2026-09-19", { pv: 80 }),
      日("2026-09-20", { pv: 20 }),
      月("2026-09", { pv: 667 }),
      話(1, 1000, "2026-09-01T12:00:00+09:00"),
      話(2, 500, "2026-09-05T12:00:00+09:00"),
    ]),
    データ("2026-09-23T03:00:00.000Z", [全体({ pv: 1400, bookmarks: 25, points: 58 })]),
  ]);
  const 文 = History.formatReport(h, [{ siteId: "kakuyomu", workId: 作品ID }], new Date("2026-09-20T05:00:00Z"));

  it("いまの数・今日と今月の数・日ごとの数と棒・記録した日ごとの増え方・率を出す", () => {
    expect(文).toContain(`■ カクヨム　作品ID ${作品ID}`);
    expect(文).toContain("PV 1,400");
    expect(文).toContain("フォロワー 25");
    expect(文).toContain("今日のPV 20");
    expect(文).toContain("今月のPV 667");
    expect(文).toMatch(/9\/19\s+80\s+▇{20}/);
    expect(文).toContain("1,100（+100）");
    // 9/20 から 9/23 は3日空いているので、印を付けて但し書きを出す
    expect(文).toContain("1,400（+300*）");
    expect(文).toContain("* は、前に記録した日から1日より空いている");
    expect(文).toContain("1 − 500 ÷ 1,000 = 50.0%");
    expect(文).toContain("基準の話：第2話");
  });

  it("日ごとの表は棒をライブラリなしで字で描く（ページへ要素を足さない）", () => {
    expect(typeof 文).toBe("string");
    expect(文).not.toMatch(/<[a-z]/i);
  });
});
