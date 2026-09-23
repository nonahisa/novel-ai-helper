import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// ブラウザでは background.js の importScripts の順番がこれを保証している（match.js が表より先）
require("../common/match.js");
const { STATS_SITES, matchReadPage } = require("../content/statsSites.js");
const Stash = require("../common/stash.js");

/**
 * 読者の反応を溜めて、まとめて渡す（0.9.0。作者の依頼、2026-09-23
 * 「ヘルパーの情報収集ですが、キャッシュして渡すことはできないでしょうか？」
 * 「他人の作品の履歴はたまらないですよね？」）。
 *
 * ここで確かめたいのは、
 * - **他人の作品を溜めない**（誰の作品でも開ける画面では、覚えた作品だけ）
 * - 同じ画面を2度読んだら**置き換える**（二重にしない）。アクセス数のページごとは**別の1件**
 * - 上限を越えたら、**前に溜めたものから落とす**
 * - 束の形と、渡したら空にして控えに残すこと
 */

const 作品ID = "1177354054934574437";
const 画面 = {
  作品管理: `https://kakuyomu.jp/my/works/${作品ID}`,
  アクセス数: `https://kakuyomu.jp/works/${作品ID}/accesses`,
  アクセス数2: `https://kakuyomu.jp/works/${作品ID}/accesses?page=2`,
  他人のアクセス数: "https://kakuyomu.jp/works/16816927859000000000/accesses",
  自分のNarouFun: "https://db.narou.fun/works/N1234AB",
  他人のNarouFun: "https://db.narou.fun/works/n9999zz",
};
const 場所 = (url) => matchReadPage(url, STATS_SITES);
const いま = new Date("2026-09-23T05:00:00.000Z");
const 後で = (分) => new Date(いま.getTime() + 分 * 60000);

/** 読み取り係が返す形の結果を作る（封筒は最小の形）。 */
function 読めた(site, workId, entries, counts, source) {
  const 封 = Object.assign({ "novelai-stats": 1, site }, source ? { source } : {}, {
    workId,
    readAt: いま.toISOString(),
    entries: entries || [{ scope: "work", metrics: { pv: 1 } }],
  });
  return { ok: true, json: JSON.stringify(封), counts: counts || { work: 1, day: 0, episode: 0 } };
}

function 溜める(state, url, result, now) {
  const 決め = Stash.stashDecision(場所(url), state.ownWorks);
  if (!決め.stash) {
    return { state, stashed: false, 決め };
  }
  const 作った = Stash.makeItem(result, 場所(url), url, now || いま);
  expect(作った.ok, JSON.stringify(作った)).toBe(true);
  const 覚えた = 決め.learnOwn ? Stash.rememberOwnWork(state, 決め.siteId, 決め.workId, "owner-page", now || いま) : state;
  return { state: Stash.putItem(覚えた, 作った.item).state, stashed: true, 決め };
}

describe("他人の作品を溜めない（0.9.0）", () => {
  it("カクヨムの作品管理は本人しか開けないので溜め、その作品IDを覚える", () => {
    const { state, stashed, 決め } = 溜める(Stash.emptyState(), 画面.作品管理, 読めた("kakuyomu", 作品ID));
    expect(stashed).toBe(true);
    expect(決め.learnOwn).toBe(true);
    expect(Stash.countItems(state)).toBe(1);
    expect(Stash.isOwnWork(state.ownWorks, "kakuyomu", 作品ID)).toBe(true);
    expect(state.ownWorks[0].how).toBe("owner-page");
  });

  it("カクヨムのアクセス数は誰の作品でも開けるので、覚えていない作品は溜めず、訊く", () => {
    const 決め = Stash.stashDecision(場所(画面.他人のアクセス数), []);
    expect(決め.stash).toBe(false);
    expect(決め.needsApproval).toBe(true);
  });

  it("作品管理を開いた作品なら、アクセス数も溜まる（ほかの作品のアクセス数は溜まらない）", () => {
    let s = 溜める(Stash.emptyState(), 画面.作品管理, 読めた("kakuyomu", 作品ID)).state;
    s = 溜める(s, 画面.アクセス数, 読めた("kakuyomu", 作品ID)).state;
    const 他人 = 溜める(s, 画面.他人のアクセス数, 読めた("kakuyomu", "16816927859000000000"));
    expect(他人.stashed).toBe(false);
    expect(Stash.countItems(他人.state)).toBe(2);
  });

  it("Narou.fun：他人の作品のページを開いても溜まらない", () => {
    const 結果 = 溜める(Stash.emptyState(), 画面.他人のNarouFun, 読めた("narou", "n9999zz", null, null, "narou.fun"));
    expect(結果.stashed).toBe(false);
    expect(結果.決め.needsApproval).toBe(true);
    expect(Stash.countItems(結果.state)).toBe(0);
  });

  it("Narou.fun：初めての Nコードは溜めず、認めた Nコードだけ溜まる（大文字・小文字は同じ作品）", () => {
    let s = Stash.emptyState();
    expect(溜める(s, 画面.自分のNarouFun, 読めた("narou", "N1234AB")).stashed).toBe(false);
    s = Stash.rememberOwnWork(s, "narouFun", "n1234ab", "approved", いま);
    const 結果 = 溜める(s, 画面.自分のNarouFun, 読めた("narou", "N1234AB", null, null, "narou.fun"));
    expect(結果.stashed).toBe(true);
    // 認めても、学んで覚える（learnOwn）わけではない。覚えたのは作者の「覚える」
    expect(結果.決め.learnOwn).toBe(false);
    expect(溜める(結果.state, 画面.他人のNarouFun, 読めた("narou", "n9999zz")).stashed).toBe(false);
  });

  it("訊いていた作品を覚えたら、訊きかけの印は外れる", () => {
    const s = Object.assign(Stash.emptyState(), { pending: { siteId: "narouFun", workId: "N1234AB", askedAt: いま.toISOString() } });
    const 後 = Stash.rememberOwnWork(s, "narouFun", "n1234ab", "approved", いま);
    expect(後.pending).toBe(null);
    // 同じ作品を2度覚えても増えない
    expect(Stash.rememberOwnWork(後, "narouFun", "N1234AB", "approved", いま).ownWorks).toHaveLength(1);
  });

  it("読めない画面・作品IDの無い見立てでは、溜めもせず訊きもしない", () => {
    for (const url of ["https://kakuyomu.jp/", "https://example.com/", "https://ncode.syosetu.com/n1234ab/"]) {
      const 決め = Stash.stashDecision(場所(url), []);
      expect(決め.stash, url).toBe(false);
      expect(決め.needsApproval, url).toBe(false);
    }
    expect(Stash.stashDecision(null, []).stash).toBe(false);
  });
});

describe("同じ画面は置き換える（二重にしない）", () => {
  it("同じ画面を2度読んだら、新しいほうで置き換える", () => {
    let s = 溜める(Stash.emptyState(), 画面.作品管理, 読めた("kakuyomu", 作品ID, [{ scope: "work", metrics: { pv: 1 } }])).state;
    s = 溜める(s, 画面.作品管理, 読めた("kakuyomu", 作品ID, [{ scope: "work", metrics: { pv: 2 } }]), 後で(5)).state;
    expect(Stash.countItems(s)).toBe(1);
    expect(s.items[0].envelope.entries[0].metrics.pv).toBe(2);
    expect(s.items[0].storedAt).toBe(後で(5).toISOString());
  });

  it("アクセス数のページ送り（?page=2）は、ページごとに別の1件", () => {
    let s = 溜める(Stash.emptyState(), 画面.作品管理, 読めた("kakuyomu", 作品ID)).state;
    s = 溜める(s, 画面.アクセス数, 読めた("kakuyomu", 作品ID)).state;
    s = 溜める(s, 画面.アクセス数2, 読めた("kakuyomu", 作品ID)).state;
    // 1ページ目を ?page=1 で開き直しても、1ページ目の置き換え
    s = 溜める(s, `${画面.アクセス数}?page=1`, 読めた("kakuyomu", 作品ID)).state;
    expect(Stash.countItems(s)).toBe(3);
    expect(s.items.map((i) => i.page).sort()).toEqual([1, 1, 2]);
  });

  it("ページ送りの無い画面は、問い合わせの部分を見ない（Narou.fun の ?x=1 で別の1件にしない）", () => {
    const s = Stash.rememberOwnWork(Stash.emptyState(), "narouFun", "n1234ab", "approved", いま);
    const 一 = 溜める(s, 画面.自分のNarouFun, 読めた("narou", "N1234AB")).state;
    const 二 = 溜める(一, `${画面.自分のNarouFun}?tab=daily`, 読めた("narou", "N1234AB")).state;
    expect(Stash.countItems(二)).toBe(1);
  });
});

describe("上限と、古いものを落とす決まり", () => {
  function 一件(i, 大きさ, 日時) {
    return {
      key: `k${i}`,
      siteId: "kakuyomu",
      workId: String(i),
      storedAt: 日時.toISOString(),
      size: 大きさ,
      counts: { work: 1 },
      envelope: { "novelai-stats": 1, entries: [{}] },
    };
  }

  it("件数の上限を越えたら、前に溜めたものから落とす", () => {
    let s = Stash.emptyState();
    const 上限 = { maxItems: 3, maxChars: 1e9 };
    let 落ちた = [];
    for (let i = 0; i < 5; i += 1) {
      const r = Stash.putItem(s, 一件(i, 10, 後で(i)), 上限);
      s = r.state;
      落ちた = 落ちた.concat(r.dropped);
    }
    expect(s.items.map((i) => i.key)).toEqual(["k2", "k3", "k4"]);
    expect(落ちた.map((i) => i.key)).toEqual(["k0", "k1"]);
  });

  it("大きさの上限を越えたら、前に溜めたものから落とす", () => {
    let s = Stash.emptyState();
    const 上限 = { maxItems: 100, maxChars: 25 };
    for (let i = 0; i < 3; i += 1) {
      s = Stash.putItem(s, 一件(i, 10, 後で(i)), 上限).state;
    }
    expect(s.items.map((i) => i.key)).toEqual(["k1", "k2"]);
  });

  it("置き換えた画面は、新しいものとして扱う（古い順で先に落ちない）", () => {
    let s = Stash.emptyState();
    const 上限 = { maxItems: 2, maxChars: 1e9 };
    s = Stash.putItem(s, 一件(0, 1, 後で(0)), 上限).state;
    s = Stash.putItem(s, 一件(1, 1, 後で(1)), 上限).state;
    // k0 を読み直した
    s = Stash.putItem(s, 一件(0, 1, 後で(2)), 上限).state;
    s = Stash.putItem(s, 一件(2, 1, 後で(3)), 上限).state;
    expect(s.items.map((i) => i.key)).toEqual(["k0", "k2"]);
  });

  it("既定の上限は、50画面・200万字", () => {
    expect(Stash.LIMITS).toEqual({ maxItems: 50, maxChars: 2000000 });
  });

  it("1件で上限を越えるものは溜めない", () => {
    const 大きい = { ok: true, json: JSON.stringify({ "novelai-stats": 1, entries: [{ x: "あ".repeat(2000001) }] }) };
    expect(Stash.makeItem(大きい, 場所(画面.作品管理), 画面.作品管理, いま)).toEqual({ ok: false, reason: "too-large" });
  });

  it("読者の反応のデータでないもの・空のものは溜めない", () => {
    const m = 場所(画面.作品管理);
    expect(Stash.makeItem({ json: "あ" }, m, 画面.作品管理, いま).reason).toBe("not-json");
    expect(Stash.makeItem({ json: '{"novelai-post":1}' }, m, 画面.作品管理, いま).reason).toBe("not-stats");
    expect(Stash.makeItem({ json: '{"novelai-stats":2,"entries":[{}]}' }, m, 画面.作品管理, いま).reason).toBe("not-stats");
    expect(Stash.makeItem({ json: '{"novelai-stats":1,"entries":[]}' }, m, 画面.作品管理, いま).reason).toBe("empty");
  });
});

describe("束の形と、渡したあと", () => {
  function 二つ溜めた() {
    let s = 溜める(Stash.emptyState(), 画面.アクセス数2, 読めた("kakuyomu", 作品ID), 後で(1)).state;
    s = Stash.rememberOwnWork(s, "kakuyomu", 作品ID, "approved", いま);
    s = 溜める(s, 画面.作品管理, 読めた("kakuyomu", 作品ID, null, { work: 2, day: 30, episode: 219 }), 後で(0)).state;
    s = 溜める(s, 画面.アクセス数2, 読めた("kakuyomu", 作品ID, null, { work: 0, day: 0, episode: 50 }), 後で(2)).state;
    return s;
  }

  it("束は { kind, version, handedAt, items }。items は1件ずつのデータそのもので、溜めた順", () => {
    const s = 二つ溜めた();
    const 束 = Stash.makeBundle(s.items, 後で(10));
    expect(Object.keys(束)).toEqual(["kind", "version", "handedAt", "items"]);
    expect(束.kind).toBe("novelai-stats-bundle");
    expect(束.version).toBe(1);
    expect(束.handedAt).toBe(後で(10).toISOString());
    expect(束.items).toHaveLength(2);
    for (const 一件 of 束.items) {
      expect(一件["novelai-stats"]).toBe(1);
      expect(一件.site).toBe("kakuyomu");
      expect(一件.workId).toBe(作品ID);
      expect(Array.isArray(一件.entries)).toBe(true);
      // 溜めるための印（鍵・日時・大きさ）は、束へ持ち出さない
      expect(一件.key).toBeUndefined();
      expect(一件.storedAt).toBeUndefined();
    }
    // JSON にしても形が崩れない
    expect(JSON.parse(JSON.stringify(束))).toEqual(束);
  });

  it("渡したら溜まりは空になり、渡した分は控えに残る（前の控えは捨てる）", () => {
    const s = 二つ溜めた();
    const 後 = Stash.afterHanded(s, s.items, 後で(10));
    expect(Stash.countItems(後)).toBe(0);
    expect(後.handed.items).toHaveLength(2);
    expect(後.handed.handedAt).toBe(後で(10).toISOString());
    // 覚えた作品は消えない
    expect(後.ownWorks).toEqual(s.ownWorks);
    const 次 = Stash.afterHanded(Object.assign({}, 後, { items: [s.items[0]] }), [s.items[0]], 後で(20));
    expect(次.handed.items).toHaveLength(1);
  });

  it("まとめているあいだに溜まった分は、渡したことにしない", () => {
    const s = 二つ溜めた();
    const 渡した分 = [s.items[0]];
    const 後 = Stash.afterHanded(s, 渡した分, 後で(10));
    expect(後.items).toEqual([s.items[1]]);
  });

  it("控えは7日で消える", () => {
    const s = Stash.afterHanded(二つ溜めた(), 二つ溜めた().items, いま);
    expect(Stash.pruneHanded(s, new Date(いま.getTime() + 6 * 86400000)).handed).not.toBe(null);
    expect(Stash.pruneHanded(s, new Date(いま.getTime() + 8 * 86400000)).handed).toBe(null);
  });

  it("内訳：画面の数・作品の数・件数", () => {
    expect(Stash.summarize(二つ溜めた().items)).toEqual({ pages: 2, works: 1, entries: 301 });
  });
});

describe("保存から読んだものの扱い", () => {
  it("形の崩れた欄は捨てる（押しても何も起きない、を避ける）", () => {
    const s = Stash.normalizeState({
      items: [null, { key: "a" }, { key: "b", storedAt: いま.toISOString(), envelope: {} }],
      handed: "壊れた",
      ownWorks: [{ siteId: "narouFun", workId: "n1234ab" }, { workId: 1 }],
      pending: 3,
    });
    expect(s.items.map((i) => i.key)).toEqual(["b"]);
    expect(s.handed).toBe(null);
    expect(s.ownWorks).toHaveLength(1);
    expect(s.pending).toBe(null);
    expect(Stash.normalizeState(undefined)).toEqual(Stash.emptyState());
  });
});

describe("覚えた作品を説明のページで直す", () => {
  it("1行に1つ。形の合う行だけなら、そのとおりに置き換える（前からの作品は覚えた日を残す）", () => {
    const 前 = Stash.rememberOwnWork(Stash.emptyState(), "kakuyomu", 作品ID, "owner-page", いま);
    const r = Stash.replaceOwnWorksFromText(
      前,
      { narouFun: "N1234AB\n\n n5678c \nn1234ab", kakuyomu: 作品ID },
      後で(1)
    );
    expect(r.ok).toBe(true);
    expect(r.state.ownWorks.map((w) => `${w.siteId}:${w.workId}`)).toEqual([
      `kakuyomu:${作品ID}`,
      "narouFun:n1234ab",
      "narouFun:n5678c",
    ]);
    expect(r.state.ownWorks[0].how).toBe("owner-page");
    expect(r.state.ownWorks[0].addedAt).toBe(いま.toISOString());
  });

  it("消した行の作品は、覚えた一覧から外れる", () => {
    const 前 = Stash.rememberOwnWork(Stash.emptyState(), "narouFun", "n1234ab", "approved", いま);
    const r = Stash.replaceOwnWorksFromText(前, { narouFun: "", kakuyomu: "" }, いま);
    expect(r.ok).toBe(true);
    expect(r.state.ownWorks).toEqual([]);
  });

  it("形の合わない行が1つでもあれば、何も変えずに、その行を返す", () => {
    const 前 = Stash.rememberOwnWork(Stash.emptyState(), "narouFun", "n1234ab", "approved", いま);
    const r = Stash.replaceOwnWorksFromText(前, { narouFun: "n1234ab\nなろう", kakuyomu: "abc" }, いま);
    expect(r.ok).toBe(false);
    expect(r.bad).toEqual(["abc", "なろう"]);
  });
});
