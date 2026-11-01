import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
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
const { 要素, 偽ページ } = require("./fakeDom.js");

/**
 * 0.16.0：読者の反応の1件に、タグ（tags）・連載中／完結（completion）・覚えた理由（ownedVia）を添える。
 * あわせて、説明のページの集計で、作品ごとの見出しの行が右端で切れていた不具合を直す。
 *
 * 見本のページは本物の写しではない。要素の形だけを最小限にし、題・数・タグはすべて架空。
 */

const 読んだ日 = new Date(2026, 10, 1, 10, 0);
const カクヨムの作品ID = "1177354054000000001";
const 作品管理のURL = `https://kakuyomu.jp/my/works/${カクヨムの作品ID}`;
const アクセス数のURL = `https://kakuyomu.jp/works/${カクヨムの作品ID}/accesses`;
const なろうのURL = "https://db.narou.fun/novels/n1234ab";

/** 「読者からの反応」の最小の形（数が読めないと封筒にならないので、1つだけ置く） */
const 反応 = () => 要素("ul", {}, [要素("li", { "aria-label": "フォロワー" }, "フォロワー 23")]);

/** 作品管理の作品情報の dl（dt「タグ」の次の dd にタグのリンク。同じ dl にセルフレイティングもある） */
function 作品情報(タグたち, 足す) {
  const o = 足す || {};
  const 並び = [
    要素("dt", {}, "セルフレイティング"),
    要素("dd", {}, [要素("a", { href: "/tags/残酷描写有り" }, "残酷描写有り")]),
  ];
  if (タグたち !== null) {
    並び.push(要素("dt", {}, "タグ"));
    並び.push(要素("dd", {}, タグたち.map((t) => 要素("a", { href: `/tags/${t}` }, t))));
  }
  if (o.後ろ) 並び.push(...o.後ろ);
  return 要素("dl", { class: "widget-credit" }, 並び);
}

function 作品管理のページ(タグたち, 状態) {
  const 子 = [反応(), 作品情報(タグたち)];
  if (状態) {
    子.unshift(要素("span", { class: `widget-workStatusLabel-${状態.class}` }, 状態.text));
  }
  return 偽ページ(子);
}

describe("カクヨムの作品管理からタグを読む（0.16.0）", () => {
  it("dt「タグ」の次の dd のタグを、画面の並びのまま入れる（セルフレイティングは読まない）", () => {
    const r = readStats(作品管理のページ(["架空の街", "幽霊", "日常"]), 作品管理のURL, 読んだ日);
    expect(r.ok).toBe(true);
    const 封筒 = JSON.parse(r.json);
    expect(封筒.tags).toEqual(["架空の街", "幽霊", "日常"]);
  });

  it("前後の空白を落とし、空と重複は除く", () => {
    const r = readStats(作品管理のページ([" 架空の街 ", "", "幽霊", "幽霊", "　"]), 作品管理のURL, 読んだ日);
    expect(JSON.parse(r.json).tags).toEqual(["架空の街", "幽霊"]);
  });

  it("タグの欄があって0個なら、空の配列にする", () => {
    const r = readStats(作品管理のページ([]), 作品管理のURL, 読んだ日);
    expect(JSON.parse(r.json).tags).toEqual([]);
  });

  it("タグの欄が無いページでは、欄ごと省く（0個とは言わない）", () => {
    const r = readStats(作品管理のページ(null), 作品管理のURL, 読んだ日);
    expect("tags" in JSON.parse(r.json)).toBe(false);
  });

  it("長すぎる字はタグとして読まない（ページのほかの文を拾わない）", () => {
    const 長い = "あ".repeat(Stats.MAX_LABEL_TEXT + 1);
    const r = readStats(作品管理のページ(["幽霊", 長い]), 作品管理のURL, 読んだ日);
    expect(JSON.parse(r.json).tags).toEqual(["幽霊"]);
  });

  it("アクセス数の画面にはタグが無いので、欄ごと省く", () => {
    const ページ = 偽ページ([
      要素("table", { class: "EpisodeStatsList_x" }, [
        要素("tr", { class: "EpisodeStatsListItem_y" }, [
          要素("th", {}, "第1話　架空"),
          要素("td", { class: "EpisodeStatsListItem_pv__z" }, "10PV"),
        ]),
      ]),
      作品情報(["幽霊"]),
    ]);
    const r = readStats(ページ, アクセス数のURL, 読んだ日);
    expect(r.ok).toBe(true);
    expect("tags" in JSON.parse(r.json)).toBe(false);
    expect("completion" in JSON.parse(r.json)).toBe(false);
  });
});

describe("カクヨムの作品管理から連載中／完結を読む（0.16.0）", () => {
  it("「連載中」は ongoing", () => {
    const r = readStats(作品管理のページ(["幽霊"], { class: "running", text: "連載中" }), 作品管理のURL, 読んだ日);
    expect(JSON.parse(r.json).completion).toBe("ongoing");
  });

  it("「完結」を含む字は completed（クラス名は知らない名でも字で決める）", () => {
    const r = readStats(作品管理のページ(["幽霊"], { class: "somethingNew", text: "完結済" }), 作品管理のURL, 読んだ日);
    expect(JSON.parse(r.json).completion).toBe("completed");
  });

  it("それ以外の字・印が無いときは欄ごと省く", () => {
    const r1 = readStats(作品管理のページ(["幽霊"], { class: "running", text: "休載中" }), 作品管理のURL, 読んだ日);
    expect("completion" in JSON.parse(r1.json)).toBe(false);
    const r2 = readStats(作品管理のページ(["幽霊"]), 作品管理のURL, 読んだ日);
    expect("completion" in JSON.parse(r2.json)).toBe(false);
  });

  it("字で決める関数そのもの", () => {
    expect(Stats.completionFromText("連載中")).toBe("ongoing");
    expect(Stats.completionFromText("連載中・全219話")).toBe("ongoing");
    expect(Stats.completionFromText("完結済")).toBe("completed");
    expect(Stats.completionFromText("完結済・全12話")).toBe("completed");
    expect(Stats.completionFromText("短編")).toBeUndefined();
    expect(Stats.completionFromText("")).toBeUndefined();
    expect(Stats.completionFromText(null)).toBeUndefined();
  });
});

/** なろうファンDB の作品ページの最小の形（数1つ・形式・キーワード） */
function なろうのページ(キーワード, 形式) {
  const 基本 = [];
  if (形式 !== null) {
    基本.push(要素("div", {}, [要素("dt", { class: "font-bold" }, "形式"), 要素("dd", {}, 形式)]));
  }
  if (キーワード !== null) {
    基本.push(
      要素("div", {}, [
        要素("dt", { class: "sr-only" }, "キーワード"),
        要素("dd", {}, [
          要素("ul", { "aria-label": "キーワード" }, キーワード.map((k) => 要素("li", {}, [要素("a", { href: "https://db.narou.fun/search?word=x" }, k)]))),
        ]),
      ])
    );
  }
  return 偽ページ([
    要素("section", { "aria-labelledby": "react" }, [
      要素("dl", {}, [要素("div", {}, [要素("dt", {}, "ブクマ"), 要素("dd", {}, "300")])]),
    ]),
    要素("section", { "aria-labelledby": "spec" }, [要素("dl", {}, 基本)]),
  ]);
}

describe("なろうファンDB の作品ページからキーワードと連載の状態を読む（0.16.0）", () => {
  it("キーワードの並びのまま tags に入れる", () => {
    const r = readStats(なろうのページ(["架空の学園", "ハイファンタジー", "架空の学園"], "連載中・全12話"), なろうのURL, 読んだ日);
    expect(r.ok).toBe(true);
    const 封筒 = JSON.parse(r.json);
    expect(封筒.tags).toEqual(["架空の学園", "ハイファンタジー"]);
    expect(封筒.completion).toBe("ongoing");
  });

  it("キーワードの欄が0個なら空の配列、欄が無ければ省く", () => {
    expect(JSON.parse(readStats(なろうのページ([], "連載中"), なろうのURL, 読んだ日).json).tags).toEqual([]);
    expect("tags" in JSON.parse(readStats(なろうのページ(null, "連載中"), なろうのURL, 読んだ日).json)).toBe(false);
  });

  it("形式が「完結済」で始まれば completed、短編・形式の欄が無ければ省く", () => {
    expect(JSON.parse(readStats(なろうのページ([], "完結済・全30話"), なろうのURL, 読んだ日).json).completion).toBe("completed");
    expect("completion" in JSON.parse(readStats(なろうのページ([], "短編"), なろうのURL, 読んだ日).json)).toBe(false);
    expect("completion" in JSON.parse(readStats(なろうのページ([], null), なろうのURL, 読んだ日).json)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 溜まり・束
 * ------------------------------------------------------------------ */

const 作品管理の場所 = () => Stats.matchReadPage(作品管理のURL);

describe("溜まりと束で、タグと連載の状態が落ちない・混ざらない（0.16.0）", () => {
  it("同じ画面を読み直したら、新しいほうのタグで置き換わる（古いタグが残らない）", () => {
    let s = Stash.emptyState();
    const 古い = readStats(作品管理のページ(["幽霊"], { class: "running", text: "連載中" }), 作品管理のURL, 読んだ日);
    s = Stash.putItem(s, Stash.makeItem(古い, 作品管理の場所(), 作品管理のURL, 読んだ日).item).state;
    const 新しい = readStats(作品管理のページ(["日常"], { class: "x", text: "完結済" }), 作品管理のURL, new Date(2026, 10, 2));
    s = Stash.putItem(s, Stash.makeItem(新しい, 作品管理の場所(), 作品管理のURL, new Date(2026, 10, 2)).item).state;
    expect(s.items).toHaveLength(1);
    expect(s.items[0].envelope.tags).toEqual(["日常"]);
    expect(s.items[0].envelope.completion).toBe("completed");
  });

  it("束の1件ずつが、自分の画面のタグだけを持つ（作品管理のタグがアクセス数の件へ移らない）", () => {
    let s = Stash.emptyState();
    const 作品管理 = readStats(作品管理のページ(["幽霊"]), 作品管理のURL, 読んだ日);
    s = Stash.putItem(s, Stash.makeItem(作品管理, 作品管理の場所(), 作品管理のURL, 読んだ日).item).state;
    const アクセス数 = readStats(
      偽ページ([
        要素("table", { class: "EpisodeStatsList_x" }, [
          要素("tr", { class: "EpisodeStatsListItem_y" }, [要素("th", {}, "第1話"), 要素("td", { class: "EpisodeStatsListItem_pv__z" }, "10PV")]),
        ]),
      ]),
      アクセス数のURL,
      読んだ日
    );
    s = Stash.putItem(s, Stash.makeItem(アクセス数, Stats.matchReadPage(アクセス数のURL), アクセス数のURL, new Date(2026, 10, 1, 11)).item).state;
    const 束 = Stash.makeBundle(s.items, 読んだ日);
    expect(束.items[0].tags).toEqual(["幽霊"]);
    expect("tags" in 束.items[1]).toBe(false);
  });
});

describe("束に、その作品を覚えた理由（ownedVia）を添える（0.16.0）", () => {
  function 溜まり() {
    let s = Stash.emptyState();
    const r = readStats(作品管理のページ(["幽霊"]), 作品管理のURL, 読んだ日);
    s = Stash.putItem(s, Stash.makeItem(r, 作品管理の場所(), 作品管理のURL, 読んだ日).item).state;
    const n = readStats(なろうのページ([], "連載中"), なろうのURL, 読んだ日);
    s = Stash.putItem(s, Stash.makeItem(n, Stats.matchReadPage(なろうのURL), なろうのURL, new Date(2026, 10, 1, 11)).item).state;
    return s;
  }

  it("本人しか開けない画面で覚えた作品は owner-page、作者が認めた作品は approved", () => {
    let s = 溜まり();
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "owner-page", 読んだ日);
    s = Stash.rememberOwnWork(s, "narouFun", "N1234AB", "approved", 読んだ日);
    const 束 = Stash.makeBundle(s.items, 読んだ日, s.ownWorks);
    expect(束.items[0].ownedVia).toBe("owner-page");
    expect(束.items[1].ownedVia).toBe("approved");
  });

  it("覚えた作品でなければ欄ごと省く。覚えた作品を渡さない呼び方でも省く", () => {
    const s = 溜まり();
    expect("ownedVia" in Stash.makeBundle(s.items, 読んだ日, []).items[0]).toBe(false);
    expect("ownedVia" in Stash.makeBundle(s.items, 読んだ日).items[0]).toBe(false);
  });

  it("認めた作品（approved）でも、本人しか開けない画面で読めたら owner-page に上げる（覚えた日は変えない。0.17.1）", () => {
    let s = 溜まり();
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "approved", new Date(2026, 9, 1));
    const 覚えた日 = s.ownWorks[0].addedAt;
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "owner-page", 読んだ日);
    expect(s.ownWorks).toHaveLength(1);
    expect(s.ownWorks[0].how).toBe("owner-page");
    expect(s.ownWorks[0].addedAt).toBe(覚えた日);
    expect(Stash.makeBundle(s.items, 読んだ日, s.ownWorks).items[0].ownedVia).toBe("owner-page");
  });

  it("owner-page の作品は、あとで「覚える」と答えても approved に下がらない（0.17.1）", () => {
    let s = Stash.emptyState();
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "owner-page", 読んだ日);
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "approved", 読んだ日);
    expect(s.ownWorks[0].how).toBe("owner-page");
  });

  it("説明のページで保存し直しても、覚えた理由と覚えた日を保つ（0.17.1）", () => {
    let s = Stash.emptyState();
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "approved", new Date(2026, 9, 1));
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "owner-page", 読んだ日);
    const r = Stash.replaceOwnWorksFromText(s, { kakuyomu: カクヨムの作品ID, narouFun: "N1234AB" }, 読んだ日);
    expect(r.ok).toBe(true);
    expect(r.state.ownWorks.find((w) => w.siteId === "kakuyomu")).toEqual(s.ownWorks[0]);
    expect(r.state.ownWorks.find((w) => w.siteId === "narouFun").how).toBe("approved");
  });

  it("溜まりの中の封筒そのものは書き換えない（束にするときだけ添える）", () => {
    let s = 溜まり();
    s = Stash.rememberOwnWork(s, "kakuyomu", カクヨムの作品ID, "owner-page", 読んだ日);
    Stash.makeBundle(s.items, 読んだ日, s.ownWorks);
    expect("ownedVia" in s.items[0].envelope).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 記録と集計
 * ------------------------------------------------------------------ */

function 封筒(readAt, extra) {
  return Object.assign(
    { "novelai-stats": 1, site: "kakuyomu", workId: カクヨムの作品ID, readAt, entries: [{ scope: "work", metrics: { pv: 10 } }] },
    extra || {}
  );
}

describe("集計の記録に、その作品の今のタグと連載の状態を残す（0.16.0）", () => {
  it("いちばん新しく読めたタグと状態を残し、古い読み取りでは上書きしない", () => {
    let h = History.emptyHistory();
    h = History.recordEnvelope(h, 封筒("2026-11-02T00:00:00Z", { tags: ["新しい"], completion: "completed" }), "kakuyomu", カクヨムの作品ID, 読んだ日);
    h = History.recordEnvelope(h, 封筒("2026-11-01T00:00:00Z", { tags: ["古い"], completion: "ongoing" }), "kakuyomu", カクヨムの作品ID, 読んだ日);
    const w = h.works[0];
    expect(w.tags).toEqual(["新しい"]);
    expect(w.completion).toBe("completed");
  });

  it("タグの無い画面（アクセス数）を読んでも、前に読めたタグを消さない", () => {
    let h = History.emptyHistory();
    h = History.recordEnvelope(h, 封筒("2026-11-01T00:00:00Z", { tags: ["幽霊"] }), "kakuyomu", カクヨムの作品ID, 読んだ日);
    h = History.recordEnvelope(h, 封筒("2026-11-02T00:00:00Z"), "kakuyomu", カクヨムの作品ID, 読んだ日);
    expect(h.works[0].tags).toEqual(["幽霊"]);
  });

  it("保存から読み直しても残り、形の崩れた欄は捨てる（記録の版は1のまま）", () => {
    let h = History.emptyHistory();
    h = History.recordEnvelope(h, 封筒("2026-11-01T00:00:00Z", { tags: ["幽霊"], completion: "ongoing" }), "kakuyomu", カクヨムの作品ID, 読んだ日);
    const 読み直し = History.normalizeHistory(JSON.parse(JSON.stringify(h)));
    expect(読み直し.version).toBe(1);
    expect(読み直し.works[0].tags).toEqual(["幽霊"]);
    expect(読み直し.works[0].completion).toBe("ongoing");
    const 崩れ = History.normalizeHistory({
      works: [{ siteId: "kakuyomu", workId: "1", tags: "幽霊", tagsAt: "2026-11-01T00:00:00Z", completion: "休載", completionAt: "2026-11-01T00:00:00Z" }],
    });
    expect("tags" in 崩れ.works[0]).toBe(false);
    expect("completion" in 崩れ.works[0]).toBe(false);
  });

  it("集計の見出しの下に、連載の状態とタグを1行で出す", () => {
    let h = History.emptyHistory();
    h = History.recordEnvelope(h, 封筒("2026-11-01T00:00:00Z", { tags: ["幽霊", "日常"], completion: "ongoing" }), "kakuyomu", カクヨムの作品ID, 読んだ日);
    const 文 = History.formatReport(h, [{ siteId: "kakuyomu", workId: カクヨムの作品ID }], 読んだ日);
    expect(文).toContain("連載中　タグ：幽霊、日常");
  });

  it("タグが0個と分かっている作品は「タグ：なし」、分からない作品はタグの行を出さない", () => {
    let h = History.emptyHistory();
    h = History.recordEnvelope(h, 封筒("2026-11-01T00:00:00Z", { tags: [], completion: "completed" }), "kakuyomu", カクヨムの作品ID, 読んだ日);
    expect(History.formatReport(h, [{ siteId: "kakuyomu", workId: カクヨムの作品ID }], 読んだ日)).toContain("完結　タグ：なし");
    let h2 = History.emptyHistory();
    h2 = History.recordEnvelope(h2, 封筒("2026-11-01T00:00:00Z"), "kakuyomu", カクヨムの作品ID, 読んだ日);
    expect(History.formatReport(h2, [{ siteId: "kakuyomu", workId: カクヨムの作品ID }], 読んだ日)).not.toContain("タグ：");
  });
});

/* ------------------------------------------------------------------ *
 * 不具合：集計の見出しの行が右端で切れる
 * ------------------------------------------------------------------ */

/** 見た目の幅（全角は2、半角は1）。common/history.js と同じ数え方 */
function 幅(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.codePointAt(0) > 0xff ? 2 : 1;
  return n;
}

describe("不具合：集計の作品ごとの見出しが、長い題で枠の右端からはみ出す（0.16.0）", () => {
  const 長い題 = "架空の受験生が教科書だけで成り上がる長い長い物語　～その知識、学校で習いましたよね？～";
  function 見出しの行たち(siteId, workId, title, extra) {
    let h = History.emptyHistory();
    const site = siteId === "narouFun" ? "narou" : "kakuyomu";
    h = History.recordEnvelope(h, Object.assign(封筒("2026-11-01T00:00:00Z", extra), { site, workId }), siteId, workId, 読んだ日);
    h = History.rememberTitle(h, siteId, workId, title, "2026-11-01T00:00:00Z");
    const 行たち = History.formatReport(h, [{ siteId, workId }], 読んだ日).split("\n");
    const 終わり = 行たち.findIndex((l) => l.startsWith("  最後に記録"));
    return 行たち.slice(0, 終わり);
  }

  it("見出しの行は、どれも集計の表の幅（HEADING_WIDTH）に収まる", () => {
    const 行たち = 見出しの行たち("narouFun", "n2600zz", 長い題, { tags: ["架空のタグ".repeat(3), "学園", "成り上がり", "教科書", "受験", "異世界", "勘違い"], completion: "ongoing" });
    expect(行たち.length).toBeGreaterThan(1);
    for (const 行 of 行たち) {
      expect(幅(行)).toBeLessThanOrEqual(History.HEADING_WIDTH);
    }
  });

  it("折り返しても、題・作品ID・閉じ括弧が欠けない", () => {
    const 行たち = 見出しの行たち("narouFun", "n2600zz", 長い題);
    const 繋いだ = 行たち.map((l) => l.trim()).join("");
    expect(繋いだ).toContain(長い題.replace(/\s/g, "").slice(0, 10));
    expect(繋いだ.replace(/\s/g, "")).toContain(長い題.replace(/\s/g, ""));
    expect(繋いだ).toContain("作品ID N2600ZZ）");
  });

  it("短い題は、これまでどおり1行で出る", () => {
    const 行たち = 見出しの行たち("kakuyomu", カクヨムの作品ID, "架空の題");
    expect(行たち).toEqual([`■ カクヨム　架空の題（作品ID ${カクヨムの作品ID}）`]);
  });

  it("画面に出すサイトの名は、リニューアル後の「なろうファンDB」", () => {
    const 行たち = 見出しの行たち("narouFun", "n2600zz", "架空の題");
    expect(行たち[0]).toBe("■ なろうファンDB（なろうの作品）　架空の題（作品ID N2600ZZ）");
  });
});

/* ------------------------------------------------------------------ *
 * 受け手の本物に読ませる（版を上げずに足せることの裏付け）
 * ------------------------------------------------------------------ */

const 母艦の読み口 = join(
  process.env.NOVELAI_ASSISTANT_DIR || join(ルート, "..", "novel-ai-assistant"),
  "src",
  "core",
  "readerStatsEnvelope.ts"
);

describe.skipIf(!existsSync(母艦の読み口))("タグ・連載の状態・覚えた理由の入った封筒を、受け手がそのまま受け取る", () => {
  it("カクヨムの作品管理", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const r = readStats(作品管理のページ(["幽霊"], { class: "running", text: "連載中" }), 作品管理のURL, 読んだ日);
    const 封筒 = Object.assign(JSON.parse(r.json), { ownedVia: "owner-page" });
    expect(parseReaderStatsEnvelope(JSON.stringify(封筒)).ok).toBe(true);
  });

  it("なろうファンDB（タグが空の配列）", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const r = readStats(なろうのページ([], "完結済・全3話"), なろうのURL, 読んだ日);
    const 封筒 = Object.assign(JSON.parse(r.json), { ownedVia: "approved" });
    expect(parseReaderStatsEnvelope(JSON.stringify(封筒)).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 不具合：「いまの数」の行が、欄の多いサイトで枠の右端からはみ出す（2026-11-01 作者の画面の写し）
 * ------------------------------------------------------------------ */

describe("不具合：集計の「いまの数」の行が、アルファポリスで右端からはみ出す（0.17.2）", () => {
  // 作者の画面の写し：「累計ポイント 249,812　お気に入り 264　24時間のポイント 28　ハート 23　累計の順位 17,716　24時間の順位 26,」で切れた
  function いまの数の行たち() {
    const 作品ID = "637000000";
    let h = History.emptyHistory();
    const 封 = {
      "novelai-stats": 1,
      site: "alphapolis",
      workId: 作品ID,
      readAt: "2026-11-01T01:47:00Z",
      entries: [
        {
          scope: "work",
          metrics: { points: 249812, bookmarks: 264, alphapolis_points24h: 28, alphapolis_hearts: 23, alphapolis_rankTotal: 17716, alphapolis_rank24h: 26458 },
        },
      ],
    };
    h = History.recordEnvelope(h, 封, "alphapolis", 作品ID, 読んだ日);
    const 行たち = History.formatReport(h, [{ siteId: "alphapolis", workId: 作品ID }], 読んだ日).split("\n");
    const 始め = 行たち.findIndex((l) => l.trim() === "いまの数");
    let 終わり = 始め + 1;
    while (終わり < 行たち.length && 行たち[終わり].trim() !== "") 終わり += 1;
    return 行たち.slice(始め + 1, 終わり);
  }

  it("どの行も集計の表の幅（HEADING_WIDTH）に収まる", () => {
    const 行たち = いまの数の行たち();
    expect(行たち.length).toBeGreaterThan(1);
    for (const 行 of 行たち) {
      expect(幅(行), 行).toBeLessThanOrEqual(History.HEADING_WIDTH);
    }
  });

  it("折り返しても、欄の名前と数を途中で切らない", () => {
    const 行たち = いまの数の行たち();
    for (const 字 of ["累計ポイント 249,812", "お気に入り 264", "24時間のポイント 28", "ハート 23", "累計の順位 17,716", "24時間の順位 26,458"]) {
      expect(行たち.some((l) => l.includes(字)), 字).toBe(true);
    }
  });
});
