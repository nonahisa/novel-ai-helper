import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectorPlan, confirmationNeeded } = require("../common/guard.js");
const { confirmFill, describeField, messageForHanded } = require("../common/messages.js");
const { siteById } = require("../content/sites.js");

/**
 * 欄探しの「判定」の部分だけを確かめる（DOMを触る部分は実機の領分）。
 *
 * ここで守りたいのは1つ。**汎用のセレクタで当たった欄には、空でも必ず一度断りを入れる。**
 * `#title` や `div[contenteditable]` は、投稿フォームの外にもいくらでもある形で、
 * それが本当に入れてよい欄かは機械では確かめられない。
 * 「空だから黙って入れてよい」を汎用にも許すと、見当違いの欄に無確認で書き込む。
 */
describe("セレクタを試す順番", () => {
  it("厳密（サイト固有）を先に、汎用をあとに試す", () => {
    const 計画 = selectorPlan({
      selectors: { strict: ['textarea[name="body"]'], generic: ["#body"] },
    });
    expect(計画).toEqual([
      { selector: 'textarea[name="body"]', kind: "strict" },
      { selector: "#body", kind: "generic" },
    ]);
  });

  it("片方しか無くても、もう片方が無いだけで壊れない", () => {
    expect(selectorPlan({ selectors: { strict: ["#a"] } })).toEqual([
      { selector: "#a", kind: "strict" },
    ]);
    expect(selectorPlan({ selectors: { generic: ["#a"] } })).toEqual([
      { selector: "#a", kind: "generic" },
    ]);
  });

  it("欄の指定が無ければ、試す先も無い（＝何もしない側へ倒れる）", () => {
    expect(selectorPlan(null)).toEqual([]);
    expect(selectorPlan({})).toEqual([]);
    expect(selectorPlan({ selectors: [] })).toEqual([]); // 昔の形（ただの配列）は受け付けない
  });

  it("実際の表も、この順番で読める", () => {
    const 計画 = selectorPlan(siteById("kakuyomu").fields.body);
    expect(計画.length).toBeGreaterThan(0);
    expect(計画[0].kind).toBe("strict");
    // 汎用が厳密より先に来ることは無い
    const 汎用の最初 = 計画.findIndex((c) => c.kind === "generic");
    const 厳密の最後 = 計画.map((c) => c.kind).lastIndexOf("strict");
    expect(汎用の最初).toBeGreaterThan(厳密の最後);
  });
});

describe("確認を出すかどうか", () => {
  it("厳密なセレクタで当たった空欄は、黙って埋めてよい", () => {
    const 結果 = confirmationNeeded([
      { label: "本文欄", matchKind: "strict", occupied: false },
      { label: "タイトル欄", matchKind: "strict", occupied: false },
    ]);
    expect(結果.needsConfirm).toBe(false);
    expect(結果.occupied).toEqual([]);
    expect(結果.uncertain).toEqual([]);
  });

  it("汎用のセレクタで当たった欄は、空でも確認する", () => {
    const 結果 = confirmationNeeded([{ label: "本文欄", matchKind: "generic", occupied: false }]);
    expect(結果.needsConfirm).toBe(true);
    expect(結果.uncertain).toEqual(["本文欄"]);
    expect(結果.occupied).toEqual([]);
  });

  it("中身のある欄は、どちらのセレクタで当たっても確認する（書きかけを消さない）", () => {
    const 厳密 = confirmationNeeded([{ label: "本文欄", matchKind: "strict", occupied: true }]);
    expect(厳密.needsConfirm).toBe(true);
    expect(厳密.occupied).toEqual(["本文欄"]);

    const 汎用 = confirmationNeeded([{ label: "本文欄", matchKind: "generic", occupied: true }]);
    expect(汎用.needsConfirm).toBe(true);
    // 中身があるほうが強い理由なので、二重には並べない
    expect(汎用.occupied).toEqual(["本文欄"]);
    expect(汎用.uncertain).toEqual([]);
  });

  it("欄ごとに理由が違っても、まとめて1回の確認になる", () => {
    const 結果 = confirmationNeeded([
      { label: "タイトル欄", matchKind: "strict", occupied: true },
      { label: "本文欄", matchKind: "generic", occupied: false },
    ]);
    expect(結果.needsConfirm).toBe(true);
    expect(結果.occupied).toEqual(["タイトル欄"]);
    expect(結果.uncertain).toEqual(["本文欄"]);
  });

  it("知らない種別は「確かめられていない」側に倒す", () => {
    // 表の書き方を変えたときに、判定が黙って甘くならないように。
    const 結果 = confirmationNeeded([{ label: "本文欄", matchKind: undefined, occupied: false }]);
    expect(結果.needsConfirm).toBe(true);
  });

  it("入れる欄が1つも無ければ、確認も要らない", () => {
    expect(confirmationNeeded([]).needsConfirm).toBe(false);
    expect(confirmationNeeded(null).needsConfirm).toBe(false);
  });
});

describe("欄の正体の見せ方", () => {
  it("どの欄へ入れたのかが分かる形にする", () => {
    expect(describeField("本文欄", 'textarea[name="body"]')).toBe("本文欄（textarea[name=\"body\"]）");
  });

  it("正体が分からないときは、ラベルだけを出す", () => {
    expect(describeField("本文欄", "")).toBe("本文欄");
    expect(describeField("本文欄", null)).toBe("本文欄");
  });

  it("確認の文には、なぜ聞かれているのかが両方入る", () => {
    const 文 = confirmFill({ occupied: ["タイトル欄"], uncertain: ["本文欄（div#editor）"] });
    expect(文).toContain("タイトル欄");
    expect(文).toContain("本文欄（div#editor）");
    expect(文).toContain("キャンセル");
  });
});

/**
 * まとめて渡したときの伝え方（0.2.2 の「読み取った件数の伝え方」を、0.9.0 で溜める形に言い直した）。
 *
 * アクセス数は50話ずつのページ送りなので、押した画面の件数だけでは
 * **全話が入ったと誤解される**。次のページがあるときだけ、そのことと、
 * 繰り返して構わないこと（同じページは置き換わり、統合小説執筆環境も追記する）を添える。
 */
describe("まとめて渡したときの伝え方", () => {
  it("何画面・何作品・何件を渡し、次に何が起きるかを言う", () => {
    const 文 = messageForHanded({ pages: 3, works: 2, entries: 300 }, null);
    expect(文).toContain("3画面・2作品・300件");
    expect(文).toContain("VS Code");
    // VS Code が前に出ないときの道も言う
    expect(文).toContain("読者の反応を貼り付けて取り込む");
    expect(文).not.toContain("この画面からは");
  });

  it("押した画面の内訳は、作品全体・日ごと・話ごとを分けて言う（0.5.0）", () => {
    const 文 = messageForHanded({ pages: 1, works: 1, entries: 250 }, { counts: { work: 1, day: 30, episode: 219 } });
    expect(文).toContain("この画面からは 250件（作品全体 1・日ごと 30・話ごと 219）");
    // 日ごとが0件なら言わない（アクセス数の画面や、グラフの無い作品）
    expect(messageForHanded({ pages: 1 }, { counts: { work: 2, day: 0, episode: 5 } })).not.toContain("日ごと");
  });

  it("次のページがあるときだけ、「このページの分だけ」と、開けば溜まることを言い足す", () => {
    const 続く = messageForHanded({ pages: 1 }, { counts: { work: 0, episode: 50 }, hasNextPage: true });
    expect(続く).toContain("このページの分だけ");
    expect(続く).toContain("次へ");
    expect(続く).toContain("そのページも溜まります");
    // 繰り返してよいことまで言う（同じページは置き換わる）
    expect(続く).toContain("二重にはなりません");
  });

  it("次のページが無いときは、増やさない", () => {
    const 最後 = messageForHanded({ pages: 1 }, { counts: { work: 0, episode: 19 }, hasNextPage: false });
    expect(最後).not.toContain("このページの分だけ");
    expect(最後).not.toContain("二重");
  });

  it("Narou.fun の日ごとの表が途中までのときは、「表示件数」を30にしてもう一度押すよう言う（0.7.0）", () => {
    const 文 = messageForHanded(
      { pages: 1 },
      { counts: { work: 1, day: 9, episode: 0 }, hasNextPage: true, nextPageKind: "rowsPerPage" }
    );
    expect(文).toContain("日ごと 9");
    expect(文).toContain("表示件数");
    expect(文).toContain("30");
    expect(文).toContain("もう一度押してください");
    // 「次へ」でページごとに取り込むと、ページの境目の日の差が取れない。だから次へは勧めない
    expect(文).not.toContain("「次へ」で次のページを開く");
    expect(文).toContain("二重にはなりません");
  });

  it("もう一度渡したときは、そう言う", () => {
    expect(messageForHanded({ pages: 2, works: 1, entries: 10 }, null, true)).toContain("前に渡した読者の反応を、もう一度");
  });
});
