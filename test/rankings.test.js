import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

// 読み込みの順番は、ブラウザ（manifest の4つ目の content_scripts）と同じにする
require("../common/match.js");
require("../common/guard.js");
const Rankings = require("../common/rankings.js");
const Stats = require("../content/statsSites.js");
const { readRankings } = require("../content/read.js");
const Stash = require("../common/stash.js");
const AutoRead = require("../common/autoRead.js");
const ContestSites = require("../content/contestSites.js");
const { 要素, 偽ページ } = require("./fakeDom.js");

/**
 * 0.19.0：ランキングの画面に覚えた作品が載っていたらお祝いし、順位を取得して渡す（作者の指示 2026-11-02）。
 *
 * 見本のページは本物の写しではない。要素の形（受け手との取り決めの文書の3章。2026-11-02 に公開の画面を見たもの）だけを
 * 最小限にし、題・作品IDはすべて架空。
 */

const 読んだ日時 = new Date("2026-11-02T12:03:00.000Z"); // 日本時間 21:03
const 自分 = "16816927861924296900";
const 他人1 = "1177354054934574437";
const 他人2 = "16818093000000000000";

/**
 * 文字を読んだかを数える要素（他の方の行の順位・作品名を読んでいないことを確かめる）。
 * fakeDom の要素の textContent を、読んだら数える形に差し替える。
 */
function 見張る(el, 記録, 名) {
  const 元 = Object.getOwnPropertyDescriptor(el, "textContent").get;
  Object.defineProperty(el, "textContent", {
    get() {
      記録.push(名);
      return 元.call(el);
    },
  });
  return el;
}

/** カクヨムの1作品（順位の枠と作品の枠が兄弟）。 */
function カクヨムの行(順位, workId, 題, 記録) {
  const 順位の枠 = 要素("div", { class: "RankingWorkBox_rank__x1Y2z" }, String(順位));
  const リンク = 要素("a", { href: `/works/${workId}` }, 題);
  if (記録) {
    見張る(順位の枠, 記録, `順位:${workId}`);
    見張る(リンク, 記録, `題:${workId}`);
  }
  return 要素("div", { class: "Layout_layout__aB3cD" }, [
    順位の枠,
    要素("div", { class: "RankingWorkBox_contents__q9W8e" }, [
      要素("h3", { class: "Heading_heading__zz" }, [リンク]),
      要素("p", {}, [要素("a", { href: "/users/someone" }, "架空の作者")]),
    ]),
  ]);
}

function カクヨムのページ(行たち, 見出し = "週間異世界ファンタジーの長編ランキング") {
  return 偽ページ([要素("h1", {}, 見出し), 要素("div", { class: "Layout_layout__wrap" }, 行たち)]);
}

/** アルファポリスの1作品（section.c-content）。data-citiid は作者ID。 */
function アルファポリスの行(順位, 作者ID, workId, 題, 記録, 作者の札) {
  const 順位の枠 = 要素("span", { class: "c-content__rank" }, String(順位));
  const リンク = 要素("a", { href: `/novel/${作者ID}/${workId}` }, 題);
  if (記録) {
    見張る(順位の枠, 記録, `順位:${workId}`);
    見張る(リンク, 記録, `題:${workId}`);
  }
  return 要素("section", { class: "c-content", "data-citiid": 作者の札 || 作者ID }, [
    順位の枠,
    要素("h2", { class: "c-content__title" }, [リンク]),
  ]);
}

const カクヨムのURL = "https://kakuyomu.jp/rankings/fantasy/weekly?work_variation=long&page=2";

describe("ランキングの画面の見分け（URL から区分を組む）", () => {
  it("カクヨム：board は rankings/ジャンル/期間/区分。page は鍵に入れず、work_variation が無ければ long", () => {
    const a = Stats.matchRankingPage(カクヨムのURL);
    expect(a).toMatchObject({ ok: true, siteId: "kakuyomu", board: "rankings/fantasy/weekly/long", span: "weekly", genre: "異世界ファンタジー" });
    const b = Stats.matchRankingPage("https://kakuyomu.jp/rankings/fantasy/weekly");
    expect(b.board).toBe(a.board);
    const 短編 = Stats.matchRankingPage("https://kakuyomu.jp/rankings/all/entire?work_variation=short");
    expect(短編).toMatchObject({ board: "rankings/all/entire/short", span: "total", defaultLabel: "累計総合の短編ランキング" });
    // 総合は genre を省く
    expect("genre" in 短編).toBe(false);
  });

  it("カクヨム：期間は daily／weekly／monthly／yearly／entire → daily／weekly／monthly／yearly／total", () => {
    const 期間 = ["daily", "weekly", "monthly", "yearly", "entire"].map((p) => Stats.matchRankingPage(`https://kakuyomu.jp/rankings/all/${p}`).span);
    expect(期間).toEqual(["daily", "weekly", "monthly", "yearly", "total"]);
  });

  it("カクヨム：知らない期間・知らない区分は読まない（鍵が安定しないため）", () => {
    expect(Stats.matchRankingPage("https://kakuyomu.jp/rankings/all/hourly").ok).toBe(false);
    expect(Stats.matchRankingPage("https://kakuyomu.jp/rankings/all/daily?work_variation=xxx").ok).toBe(false);
    expect(Stats.matchRankingPage("https://kakuyomu.jp/rankings").ok).toBe(false);
  });

  it("アルファポリス：hot は 24h、annual は yearly、completed は other。大分けの問い合わせは鍵に足す", () => {
    expect(Stats.matchRankingPage("https://www.alphapolis.co.jp/novel/ranking/hot")).toMatchObject({ ok: true, siteId: "alphapolis", board: "novel/ranking/hot", span: "24h" });
    expect(Stats.matchRankingPage("https://www.alphapolis.co.jp/novel/ranking/annual").span).toBe("yearly");
    expect(Stats.matchRankingPage("https://www.alphapolis.co.jp/novel/ranking/completed").span).toBe("other");
    expect(Stats.matchRankingPage("https://www.alphapolis.co.jp/novel/ranking/hot?category=novel&page=3").board).toBe("novel/ranking/hot?category=novel");
  });

  it("なろう（syosetu.com 系）と Narou.fun のランキングは、ランキングの画面と見なさない（作者の判断 2026-11-02）", () => {
    for (const url of [
      "https://yomou.syosetu.com/rank/list/type/daily_total/",
      "https://yomou.syosetu.com/rank/genrelist/type/weekly_101/",
      "https://ncode.syosetu.com/n1234ab/",
      "https://db.narou.fun/ranking/new",
      "https://db.narou.fun/ranking/digits/3",
    ]) {
      expect(Stats.matchRankingPage(url).ok, url).toBe(false);
    }
  });

  it("順位の字：「12」「12位」「１２」を読み、0・負・字の混ざったものは読まない", () => {
    expect(Stats.parseRank("12")).toBe(12);
    expect(Stats.parseRank(" 12位 ")).toBe(12);
    expect(Stats.parseRank("１２")).toBe(12);
    expect(Stats.parseRank("0")).toBeUndefined();
    expect(Stats.parseRank("-3")).toBeUndefined();
    expect(Stats.parseRank("12 PV")).toBeUndefined();
    expect(Stats.parseRank(null)).toBeUndefined();
  });
});

describe("ランキングの画面から、覚えた作品の行だけを読む", () => {
  it("カクヨム：覚えた作品の順位・作品名・区分・日本時間の日付を読み、他の方の行の順位と作品名は読まない", () => {
    const 記録 = [];
    const doc = カクヨムのページ([
      カクヨムの行(111, 他人1, "架空の他人の題1", 記録),
      カクヨムの行(112, 自分, "架空の自分の題", 記録),
      カクヨムの行(113, 他人2, "架空の他人の題2", 記録),
    ]);
    const r = readRankings(doc, カクヨムのURL, [自分], 読んだ日時);
    expect(r.ok).toBe(true);
    expect(r.rows).toBe(3);
    expect(r.rankings).toEqual([
      {
        site: "kakuyomu",
        workId: 自分,
        title: "架空の自分の題",
        board: "rankings/fantasy/weekly/long",
        boardLabel: "週間異世界ファンタジーの長編ランキング",
        span: "weekly",
        genre: "異世界ファンタジー",
        rank: 112,
        date: "2026-11-02",
        readAt: "2026-11-02T12:03:00.000Z",
      },
    ]);
    // 読んだ字は、覚えた作品の行のものだけ
    expect(記録.every((名) => 名.endsWith(自分))).toBe(true);
    expect(記録).toContain(`順位:${自分}`);
  });

  it("覚えた作品が載っていなければ、ok で空の並び（載っていない＝圏外とは限らないので、圏外の件は作らない）", () => {
    const 記録 = [];
    const doc = カクヨムのページ([カクヨムの行(1, 他人1, "架空1", 記録), カクヨムの行(2, 他人2, "架空2", 記録)]);
    const r = readRankings(doc, カクヨムのURL, [自分], 読んだ日時);
    expect(r).toMatchObject({ ok: true, rankings: [], rows: 2 });
    expect(記録).toEqual([]);
  });

  it("覚えた作品が渡されなければ、ページの字を1つも見ずに返す", () => {
    let 触った = 0;
    const doc = { querySelectorAll: () => ((触った += 1), []), querySelector: () => ((触った += 1), null) };
    expect(readRankings(doc, カクヨムのURL, [], 読んだ日時)).toMatchObject({ ok: false, reason: "no-own-works" });
    expect(readRankings(doc, カクヨムのURL, undefined, 読んだ日時)).toMatchObject({ ok: false, reason: "no-own-works" });
    expect(触った).toBe(0);
  });

  it("作品の枠が1つも見つからなければ「ページの形が変わった」（嘘の「載っていない」を返さない）", () => {
    const doc = 偽ページ([要素("h1", {}, "日間総合の長編ランキング"), 要素("div", {}, "何もない")]);
    expect(readRankings(doc, カクヨムのURL, [自分], 読んだ日時)).toMatchObject({ ok: false, reason: "no-data" });
  });

  it("見出しが読めなければ、URL から組んだ見出しを使う。日本時間で日付が変わる時刻をまたぐ", () => {
    const doc = 偽ページ([要素("div", {}, [カクヨムの行(5, 自分, "架空の題")])]);
    const 深夜 = new Date("2026-11-02T15:30:00.000Z"); // 日本時間 11/3 0:30
    const r = readRankings(doc, "https://kakuyomu.jp/rankings/all/daily", [自分], 深夜);
    expect(r.rankings[0]).toMatchObject({ boardLabel: "日間総合の長編ランキング", date: "2026-11-03", rank: 5 });
    expect("genre" in r.rankings[0]).toBe(false);
  });

  it("作品名が読めなければ title を省く（作品IDだけの字は作品名にしない）", () => {
    const doc = カクヨムのページ([カクヨムの行(7, 自分, 自分)]);
    const r = readRankings(doc, カクヨムのURL, [自分], 読んだ日時);
    expect(r.rankings[0].rank).toBe(7);
    expect("title" in r.rankings[0]).toBe(false);
  });

  it("アルファポリス：作品IDはリンクの後ろ。data-citiid（作者ID）は照合に使わない", () => {
    const 記録 = [];
    const doc = 偽ページ([
      要素("h1", {}, "HOTランキング"),
      アルファポリスの行(1, "900000001", "111111111", "架空の他人の題", 記録, "222222222"),
      アルファポリスの行(2, "900000002", "222222222", "架空の自分の題", 記録),
    ]);
    const r = readRankings(doc, "https://www.alphapolis.co.jp/novel/ranking/hot", ["222222222"], 読んだ日時);
    expect(r.rankings).toEqual([
      {
        site: "alphapolis",
        workId: "222222222",
        title: "架空の自分の題",
        board: "novel/ranking/hot",
        boardLabel: "HOTランキング",
        span: "24h",
        rank: 2,
        date: "2026-11-02",
        readAt: "2026-11-02T12:03:00.000Z",
      },
    ]);
    // 1行目は data-citiid が覚えた作品の番号と同じでも、作品ID（リンクの後ろ）が違うので読まない
    expect(記録.every((名) => 名.endsWith("222222222"))).toBe(true);
    expect(記録).not.toContain("順位:111111111");
  });
});

describe("お祝いの決め方（common/rankings.js）", () => {
  const 順位 = (rank, 足す) =>
    Object.assign({ site: "kakuyomu", workId: 自分, board: "rankings/all/daily/long", boardLabel: "日間総合の長編ランキング", span: "daily", rank, date: "2026-11-02", readAt: "2026-11-02T12:00:00.000Z" }, 足す || {});

  it("演出の規模：初めて入った・小さな上昇は風船、10位以内・大きな上昇は花火、1位は大きな花火、下がった・同じは無し", () => {
    expect(Rankings.effectFor(50, undefined)).toBe("balloons");
    expect(Rankings.effectFor(40, 50)).toBe("balloons");
    expect(Rankings.effectFor(10, undefined)).toBe("fireworks");
    expect(Rankings.effectFor(11, undefined)).toBe("balloons");
    expect(Rankings.effectFor(50, 100)).toBe("fireworks");
    expect(Rankings.effectFor(15, 30)).toBe("fireworks");
    // 半分にはなったが、上がった数が少ない（10位未満の差）——10位以内でなければ風船
    expect(Rankings.effectFor(12, 21)).toBe("balloons");
    expect(Rankings.effectFor(1, undefined)).toBe("grand");
    expect(Rankings.effectFor(1, 3)).toBe("grand");
    expect(Rankings.effectFor(1, 1)).toBe("none");
    expect(Rankings.effectFor(60, 50)).toBe("none");
    expect(Rankings.effectFor(50, 50)).toBe("none");
  });

  it("線は定数にまとめてある（10位以内・半分かつ10位以上の上昇）", () => {
    expect(Rankings.TOP_RANK_FOR_FIREWORKS).toBe(10);
    expect(Rankings.BIG_RISE_RATIO).toBe(2);
    expect(Rankings.BIG_RISE_MIN_STEPS).toBe(10);
  });

  it("鳴らすのは一度だけ。同じ日に順位が動けば、もう一度鳴らす", () => {
    let 記憶 = Rankings.emptyMemory();
    const 一回目 = Rankings.planCelebration(記憶, [順位(30)]);
    expect(一回目.fresh).toHaveLength(1);
    expect(一回目.effect).toBe("balloons");
    記憶 = Rankings.markRung(記憶, 一回目.fresh, 読んだ日時);
    // 同じ日・同じ順位はもう鳴らさない
    expect(Rankings.planCelebration(記憶, [順位(30)]).fresh).toEqual([]);
    // 同じ日に順位が上がった：前に見た順位と比べて演出を決める
    const 上がった = Rankings.planCelebration(記憶, [順位(8)]);
    expect(上がった.fresh[0]).toMatchObject({ prevRank: 30, effect: "fireworks" });
    // 次の日の同じ順位：鳴らすが、演出は無し（文だけ）
    const 次の日 = Rankings.planCelebration(記憶, [順位(30, { date: "2026-11-03" })]);
    expect(次の日.fresh[0].effect).toBe("none");
    expect(次の日.effect).toBe("none");
  });

  it("複数の作品が同時に載ったら、いちばん大きな演出を出す", () => {
    const 予定 = Rankings.planCelebration(Rankings.emptyMemory(), [順位(40), 順位(1, { workId: "999", board: "rankings/fantasy/daily/long" })]);
    expect(予定.effect).toBe("grand");
    expect(Rankings.largestEffect(["none", "balloons"])).toBe("balloons");
    expect(Rankings.largestEffect([])).toBe("none");
  });

  it("鳴らさなかった順位は、前に見た順位を変えない（作者に見せた順位どうしで比べる）", () => {
    const 記憶 = Rankings.markRung(Rankings.emptyMemory(), Rankings.planCelebration(Rankings.emptyMemory(), [順位(30)]).fresh, 読んだ日時);
    Rankings.planCelebration(記憶, [順位(5)]);
    expect(記憶.seen[Rankings.seenKey(順位(5))].rank).toBe(30);
  });

  it("覚える量には上限があり、古いものから落とす。保存から読むときは形の合わない行を捨てる", () => {
    let 記憶 = Rankings.emptyMemory();
    for (let i = 0; i < Rankings.MAX_RUNG + 5; i += 1) {
      const p = Rankings.planCelebration(記憶, [順位(10 + (i % 5), { board: `b${i}` })]);
      記憶 = Rankings.markRung(記憶, p.fresh, new Date(読んだ日時.getTime() + i * 1000));
    }
    expect(記憶.rung.length).toBe(Rankings.MAX_RUNG);
    expect(Object.keys(記憶.seen).length).toBe(Rankings.MAX_SEEN);
    expect(Rankings.normalizeMemory({ seen: { a: { rank: "x" }, b: { rank: 3, at: "t" } }, rung: [1, "k"] })).toEqual({
      seen: { b: { rank: 3, date: "", at: "t" } },
      rung: ["k"],
    });
  });

  it("動きを減らす設定（prefers-reduced-motion）のときは演出を出さない。知らない名前も出さない", () => {
    expect(Rankings.effectToShow("grand", false)).toBe("grand");
    expect(Rankings.effectToShow("grand", true)).toBe("none");
    expect(Rankings.effectToShow("balloons", true)).toBe("none");
    expect(Rankings.effectToShow("explode", false)).toBe("none");
  });

  it("日本時間の日付は、機械の時刻の地域に頼らない", () => {
    expect(Rankings.jstDate(new Date("2026-11-02T14:59:59.000Z"))).toBe("2026-11-02");
    expect(Rankings.jstDate(new Date("2026-11-02T15:00:00.000Z"))).toBe("2026-11-03");
  });
});

describe("順位を溜めて、束の最上位の rankings で渡す（common/stash.js）", () => {
  const 順位 = (rank, 足す) =>
    Object.assign({ site: "kakuyomu", workId: 自分, board: "rankings/all/daily/long", boardLabel: "日間総合の長編ランキング", span: "daily", rank, date: "2026-11-02", readAt: "2026-11-02T12:00:00.000Z" }, 足す || {});

  it("同じ鍵（サイト＋作品ID＋区分＋日付）は後のもので上書き。日付や区分が違えば別の件", () => {
    let s = Stash.putRankings(Stash.emptyState(), [順位(30)]);
    s = Stash.putRankings(s, [順位(12, { readAt: "2026-11-02T13:00:00.000Z" })]);
    expect(s.rankings.map((r) => r.rank)).toEqual([12]);
    s = Stash.putRankings(s, [順位(40, { date: "2026-11-03", readAt: "2026-11-03T01:00:00.000Z" }), 順位(3, { board: "rankings/fantasy/daily/long" })]);
    expect(s.rankings).toHaveLength(3);
    expect(Stash.countRankings(s)).toBe(3);
    expect(Stash.countItems(s)).toBe(0);
    expect(Stash.countHandable(s)).toBe(3);
  });

  it("溜める件数には上限があり、読んだ日時の古いものから落とす", () => {
    let s = Stash.emptyState();
    for (let i = 0; i < Stash.MAX_RANKINGS + 3; i += 1) {
      s = Stash.putRankings(s, [順位(5, { board: `b${i}`, readAt: new Date(読んだ日時.getTime() + i * 1000).toISOString() })]);
    }
    expect(s.rankings).toHaveLength(Stash.MAX_RANKINGS);
    expect(s.rankings[0].board).toBe("b3");
  });

  it("形の合わない1件だけ捨てる。なろう（narou）の順位は受けない", () => {
    const s = Stash.putRankings(Stash.emptyState(), [
      順位(1),
      順位(2, { site: "narou", workId: "1", source: "narou.fun" }),
      順位(0, { board: "x" }),
      順位(3, { span: "hourly", board: "y" }),
      順位(4, { workId: "n1234ab", board: "z" }),
      順位(5, { date: "11/02", board: "w" }),
    ]);
    expect(s.rankings.map((r) => r.rank)).toEqual([1]);
    // 取り決めに無い欄は写さない
    expect(Object.keys(Stash.normalizeRanking(Object.assign(順位(1), { 余計: 1 })))).not.toContain("余計");
  });

  it("読者の反応の画面が無く順位だけでも束を作り、最上位に rankings を置く", () => {
    const 束 = Stash.makeBundle([], 読んだ日時, [], [], [順位(9)]);
    expect(Object.keys(束)).toEqual(["kind", "version", "handedAt", "items", "rankings"]);
    expect(束.items).toEqual([]);
    expect(束.rankings).toEqual([順位(9)]);
  });

  it("順位が無ければ rankings の欄ごと省く（0.18.x までと同じ形）", () => {
    expect(Object.keys(Stash.makeBundle([], 読んだ日時))).toEqual(["kind", "version", "handedAt", "items"]);
    expect(Object.keys(Stash.makeBundle([], 読んだ日時, [], [], []))).toEqual(["kind", "version", "handedAt", "items"]);
  });

  it("渡したら順位も溜まりから控えへ移る。控えは順位だけでも7日残る", () => {
    const s = Stash.putRankings(Stash.emptyState(), [順位(9)]);
    const 後 = Stash.afterHanded(s, [], 読んだ日時, s.rankings);
    expect(後.rankings).toEqual([]);
    expect(後.handed.rankings).toHaveLength(1);
    expect(Stash.pruneHanded(後, new Date(読んだ日時.getTime() + 86400000)).handed).not.toBe(null);
    // 保存から読み直しても控えの順位は残る
    expect(Stash.normalizeState(JSON.parse(JSON.stringify(後))).handed.rankings).toHaveLength(1);
  });

  it("まとめているあいだに読んだ順位は、渡したことにしない", () => {
    const s = Stash.putRankings(Stash.emptyState(), [順位(9), 順位(3, { board: "x" })]);
    const 後 = Stash.afterHanded(s, [], 読んだ日時, [s.rankings[0]]);
    expect(後.rankings.map((r) => r.board)).toEqual(["x"]);
  });

  it("内訳に順位の件数を添えるのは、順位を渡したときだけ", () => {
    expect(Stash.summarize([], [順位(1)])).toEqual({ pages: 0, works: 0, entries: 0, rankings: 1 });
    expect(Stash.summarize([])).toEqual({ pages: 0, works: 0, entries: 0 });
  });
});

describe("アイコンの印と行い", () => {
  require("../common/messages.js");
  const Sites = require("../content/sites.js");
  const PageState = require("../common/pageState.js");
  const Actions = require("../common/actions.js");

  it("ランキングの画面は「位」の印で、押すと順位を取得する（「統合小説執筆環境へ渡す」を切っていても同じ）", () => {
    const 見立て = PageState.describePage(カクヨムのURL, Sites.SITES, Stats.STATS_SITES);
    expect(見立て).toMatchObject({ kind: "rankings", siteId: "kakuyomu", pageKind: "rankings" });
    for (const handToIde of [true, false]) {
      const 行い = Actions.actionForPage(見立て, { stashCount: 3, handToIde });
      expect(行い).toMatchObject({ kind: "rankings", badgeText: "位", menuTitle: "順位を取得", menuVisible: true });
    }
    expect(PageState.describePage("https://www.alphapolis.co.jp/novel/ranking/hot", Sites.SITES, Stats.STATS_SITES).kind).toBe("rankings");
  });

  it("順位だけ溜まっていても、ほかの画面では「まとめて渡す」になる（「読3」の印には数えない）", () => {
    const 見立て = PageState.describePage("https://example.com/", Sites.SITES, Stats.STATS_SITES);
    expect(Actions.actionForPage(見立て, { stashCount: 0, rankingCount: 2 }).kind).toBe("hand");
    expect(Actions.actionForPage(見立て, { stashCount: 0, rankingCount: 0 }).kind).toBe(null);
    const 作品管理 = PageState.describePage(`https://kakuyomu.jp/my/works/${自分}`, Sites.SITES, Stats.STATS_SITES);
    expect(Actions.actionForPage(作品管理, { stashCount: 1, rankingCount: 5 }).badgeText).toBe("読1");
  });
});

describe("ページの種類と範囲", () => {
  it("開いたときの自動取得の種類に、サイトごとのランキングが1つずつ入る（更新しただけでは自動にしない）", () => {
    const 一覧 = AutoRead.listPageTypes(Stats.STATS_SITES, ContestSites.CONTEST_SITES, Stats.RANKING_SITES);
    const 順位 = 一覧.filter((t) => t.group === "rankings");
    expect(順位.map((t) => [t.key, t.label])).toEqual([
      ["kakuyomu|rankings", "カクヨムのランキング"],
      ["alphapolis|rankings", "アルファポリスのランキング"],
    ]);
    expect(順位.every((t) => t.askFirst === true)).toBe(true);
    const 更新 = AutoRead.consentOnInstalled(null, "update", 一覧, 読んだ日時);
    expect(Object.keys(更新.pages)).not.toContain("kakuyomu|rankings");
    expect(AutoRead.consentWhenMissing(true, 一覧, 読んだ日時).pages["alphapolis|rankings"]).toBeUndefined();
    // 区分（日間・週間・ジャンル）が違っても同じ種類
    expect(AutoRead.pageTypeForRanking(Stats.matchRankingPage(カクヨムのURL))).toBe("kakuyomu|rankings");
    expect(AutoRead.pageTypeForRanking(Stats.matchRankingPage("https://kakuyomu.jp/rankings/all/daily"))).toBe("kakuyomu|rankings");
    expect(AutoRead.pageTypeForRanking(Stats.matchRankingPage("https://db.narou.fun/ranking/new"))).toBeNull();
  });

  it("説明のページに、ランキングの種類を選ぶ欄が置いてある", () => {
    const html = readFileSync(join(ルート, "options.html"), "utf8");
    for (const t of AutoRead.listPageTypes(Stats.STATS_SITES, ContestSites.CONTEST_SITES, Stats.RANKING_SITES)) {
      expect(html, t.key).toContain(`data-auto-read="${t.key}"`);
    }
  });

  it("吹き出しの演出は、部品を HTML に書いておき、動きを減らす設定では止める（外の画像を読み込まない）", () => {
    const html = readFileSync(join(ルート, "bubble.html"), "utf8");
    const css = readFileSync(join(ルート, "bubble.css"), "utf8");
    const js = readFileSync(join(ルート, "bubble.js"), "utf8");
    expect(html).toContain('id="effect"');
    expect((html.match(/class="balloon"/g) || []).length).toBe(6);
    expect((html.match(/class="burst /g) || []).length).toBe(3);
    expect(html).toContain('<script src="common/rankings.js"></script>');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation: none !important;[\s\S]*?display: none !important;/);
    expect(css).not.toMatch(/url\(/);
    // 動きを減らす設定を見てから、演出を決める
    expect(js).toContain("prefers-reduced-motion: reduce");
    expect(js).toContain("effectToShow");
  });
});
