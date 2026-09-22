import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

// 読み込みの順番は、ブラウザ（manifest / popup.html）と同じにする。
require("../common/match.js");
require("../common/guard.js");
require("../content/statsSites.js");
const { readStats } = require("../content/read.js");

/**
 * 読み取り（content/read.js）が、管理画面から**封筒を組めるか**を確かめる。
 *
 * jsdom を入れていないので、DOMは最小の偽物で代える（`querySelectorAll` と
 * `textContent` と `getAttribute` しか使わない作りにしてあるのはそのため）。
 * 見た目や当たり判定そのものは実機の領分だが、**拾った数が封筒のどこへ入るか**は
 * ここで固定できる——母艦の台帳へ入る形なので、崩れると数字が化ける。
 */

/* ------------------------------------------------------------------ *
 * 偽のDOM（`querySelectorAll` を持つだけの最小の構造）
 * ------------------------------------------------------------------ */

/**
 * セレクタ1つ（`td[class^="X"]`・`a[href*="Y"]` のような形）に、この要素が当たるか。
 *
 * 受ける照合は `=`（一致）・`^=`（前方一致）・`*=`（含む）の3つだけ。
 * **知らない書き方は当たらない扱いにする**——黙って「当たった」にすると、
 * 表のセレクタを書き間違えた日に、テストだけが通ってしまう。
 */
function 合う(el, 単純) {
  const m = /^([a-zA-Z]*)((?:\[[^\]]*\])*)$/.exec(単純.trim());
  if (!m) {
    return false;
  }
  if (m[1] && el.tagName !== m[1].toLowerCase()) {
    return false;
  }
  for (const 条件 of m[2].match(/\[[^\]]*\]/g) || []) {
    const c = /^\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]$/.exec(条件);
    if (!c) {
      return false;
    }
    const 値 = el.getAttribute(c[1]);
    if (値 === null) {
      return false;
    }
    if (c[2] === "=" && 値 !== c[3]) {
      return false;
    }
    if (c[2] === "^=" && !値.startsWith(c[3])) {
      return false;
    }
    if (c[2] === "*=" && !値.includes(c[3])) {
      return false;
    }
  }
  return true;
}

/**
 * 要素を作る。
 * @param {string} tag 小文字のタグ名
 * @param {object} attrs 属性（class・aria-label・title・type）
 * @param {string|Array} 中身 文字か、子要素の配列
 */
function 要素(tag, attrs, 中身) {
  const 子 = Array.isArray(中身) ? 中身 : [];
  const el = {
    tagName: tag,
    attrs: attrs || {},
    children: 子,
    type: (attrs || {}).type,
    get textContent() {
      return Array.isArray(中身) ? 子.map((c) => c.textContent).join(" ") : String(中身 || "");
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    querySelectorAll(selector) {
      const 結果 = [];
      const 潜る = (親) => {
        for (const c of 親.children) {
          if (selector.split(",").some((単純) => 合う(c, 単純))) {
            結果.push(c);
          }
          潜る(c);
        }
      };
      潜る(el);
      return 結果;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
  };
  return el;
}

/** ページ（root）を作る。 */
function 偽ページ(子たち) {
  return 要素("html", {}, 子たち);
}

/** 読み取った日時を固定する（期間のキーがこの日付で作られる）。 */
const 読んだ日 = new Date(2026, 8, 22, 10, 0);

/* ------------------------------------------------------------------ *
 * 実機（2026-09-22）で見えていた形を、そのまま小さく写したページ
 * ------------------------------------------------------------------ */

function 作品管理のページ() {
  return 偽ページ([
    要素("ul", {}, [
      要素("li", { "aria-label": "フォロワー" }, "フォロワー 23"),
      要素("li", { "aria-label": "PV" }, "PV 1,269"),
      要素("li", { "aria-label": "星/レビュー" }, "★18 ・ レビュー 6"),
      要素("li", { "aria-label": "応援/応援コメント" }, "応援 33 ・ 応援コメント –"),
    ]),
    要素("div", {}, [
      要素("span", {}, "今日 0 PV"),
      要素("span", {}, "今週 0 PV"),
      要素("span", {}, "今月 2 PV"),
    ]),
  ]);
}

/** 話ごとの表の1行（実機のクラス名。末尾のハッシュは架空）。 */
function 話の行(話, 応援, pv) {
  return 要素("tr", { class: "EpisodeStatsListItem_episodeStatsListItem__aB3" }, [
    要素("th", {}, [要素("a", {}, 話)]),
    要素("td", { class: "EpisodeStatsListItem_cheer__xY7" }, 応援),
    要素("td", { class: "EpisodeStatsListItem_pv__zQ1" }, pv),
  ]);
}

function アクセス数のページ() {
  const 行 = 話の行;
  return 偽ページ([
    要素("table", { class: "EpisodeStatsList_episodeStatsList__Kd9" }, [
      // 見出しの行（数が無いので、読み取りからは落ちる）
      要素("tr", { class: "EpisodeStatsList_head__p2" }, [
        要素("th", {}, "エピソード"),
        要素("th", {}, "応援"),
        要素("th", {}, "PV"),
      ]),
      行("第1話　気がついたら幽霊に", "4", "102PV"),
      行("第2話　夜の校舎", "0", "87PV"),
      // 「第N話」と書かれていない話。順番で代える
      行("あとがき", "1", "12PV"),
    ]),
  ]);
}

/**
 * 50話ちょうどのアクセス数ページ（2026-09-22 実機。219話の作品は5ページに分かれる）。
 *
 * @param {Array} ページ送り 表の下に並ぶリンク（実機のまま。「次へ」が無い最後のページも作れる）
 */
function アクセス数のページ50話(ページ送り) {
  const 行たち = [];
  for (let i = 1; i <= 50; i += 1) {
    行たち.push(話の行(`第${i}話　題`, "1", `${i}PV`));
  }
  return 偽ページ([
    要素("table", { class: "EpisodeStatsList_episodeStatsList__Kd9" }, 行たち),
    要素("nav", {}, ページ送り || []),
  ]);
}

/** ページ送りのリンク（実機：文言は「次へ」「前へ」、行き先は `…/accesses?page=N`）。 */
function ページ送りのリンク(文言, ページ) {
  return 要素("a", { href: `/works/16816927859000000000/accesses?page=${ページ}` }, 文言);
}

/**
 * 大きい作品（219話）の作品管理ページ。2026-09-22 に実機で見えていた形。
 *
 * ここが 0.2.0 で落ちていた形である——**表示の文字が省略形**（`1.05M`・`27.5K`）で、
 * フォロワーに至っては表示にラベルの文字が無い（`2,814` だけ）。正確な数は
 * `data-ui-tooltip-label` にしか無く、実機では ★・今日PV・今月PV の3つしか取れなかった。
 * 数は実機のまま写してある（丸めない——丸めた数で通るテストは、何も守らない）。
 */
function 大きい作品の作品管理のページ() {
  return 偽ページ([
    要素("div", { class: "summary-content" }, [
      要素("ul", {}, [
        要素(
          "li",
          { class: "ui-tooltip", "data-ui-tooltip-label": "フォロワー数 2,814" },
          // アイコンの隣に数があるだけで、「フォロワー」の文字はどこにも無い
          [要素("span", {}, "2,814")]
        ),
        要素("li", { class: "ui-tooltip", "data-ui-tooltip-label": "PV数 1,053,339" }, [
          要素("span", {}, "1.05M"),
        ]),
      ]),
      要素(
        "span",
        { class: "feedback-points ui-tooltip", "data-ui-tooltip-label": "★数 1,612" },
        "★1,612"
      ),
      要素(
        "span",
        { class: "feedback-comments ui-tooltip", "data-ui-tooltip-label": "レビュー人数 611" },
        "611"
      ),
      要素(
        "span",
        { class: "feedback-points ui-tooltip", "data-ui-tooltip-label": "応援数 27,534" },
        "27.5K"
      ),
      要素(
        "span",
        { class: "feedback-comments ui-tooltip", "data-ui-tooltip-label": "コメント数 258" },
        "258"
      ),
      // 期間つきのPVは、ツールチップも表示と同じ文字（こちらは表示文字の道で拾う）
      要素("div", { class: "ui-tooltip", "data-ui-tooltip-label": "今日 1 PV" }, "今日 1 PV"),
      要素("div", { class: "ui-tooltip", "data-ui-tooltip-label": "今週 2 PV" }, "今週 2 PV"),
      要素("div", { class: "ui-tooltip", "data-ui-tooltip-label": "今月 667 PV" }, "今月 667 PV"),
    ]),
  ]);
}

const 作品管理のURL = "https://kakuyomu.jp/my/works/16816927859000000000";
const アクセス数のURL = "https://kakuyomu.jp/works/16816927859000000000/accesses";

/* ------------------------------------------------------------------ *
 * 封筒を組めるか
 * ------------------------------------------------------------------ */

describe("作品管理の画面から封筒を組む", () => {
  const 結果 = readStats(作品管理のページ(), 作品管理のURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;

  it("封筒の外側は、母艦と約束した形", () => {
    expect(結果.ok).toBe(true);
    expect(封筒["novelai-stats"]).toBe(1);
    expect(封筒.site).toBe("kakuyomu");
    // URLから読めた作品ID。母艦はこれを台帳と突き合わせて取り違えを止める
    expect(封筒.workId).toBe("16816927859000000000");
    expect(封筒.readAt).toBe(読んだ日.toISOString());
  });

  it("作品全体の数を、母艦の欄へ写す", () => {
    const 全体 = 封筒.entries.find((e) => e.scope === "work" && e.period === undefined);
    expect(全体.metrics).toEqual({
      bookmarks: 23, // フォロワー
      pv: 1269, // 桁区切りを落とす
      points: 18, // ★の数
      reviews: 6,
      likes: 33, // 応援
    });
    // 応援コメントは「–」。**欄ごと入れない**（0と書かない）
    expect(全体.metrics.comments).toBeUndefined();
  });

  it("今日と今月のPVは期間つきで入れ、今週は読まない", () => {
    const 期間 = 封筒.entries.filter((e) => e.period !== undefined);
    expect(期間).toEqual([
      { scope: "work", period: "day", periodKey: "2026-09-22", metrics: { pv: 0 } },
      { scope: "work", period: "month", periodKey: "2026-09", metrics: { pv: 2 } },
    ]);
  });

  it("件数の内訳を返す（作者へ「何件コピーしたか」を出すため）", () => {
    expect(結果.counts).toEqual({ work: 3, episode: 0 });
  });
});

describe("大きい作品の作品管理（表示が省略形）から封筒を組む", () => {
  const 結果 = readStats(大きい作品の作品管理のページ(), 作品管理のURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;

  it("読者からの反応の6欄が、すべて正確な数で入る", () => {
    expect(結果.ok, 結果.ok ? "" : 結果.reason).toBe(true);
    const 全体 = 封筒.entries.find((e) => e.scope === "work" && e.period === undefined);
    expect(全体.metrics).toEqual({
      bookmarks: 2814, // フォロワー数（表示にはラベルの文字が無い）
      pv: 1053339, // PV数（表示は 1.05M。丸めた数を書かない）
      points: 1612, // ★数
      reviews: 611, // レビュー人数
      likes: 27534, // 応援数（表示は 27.5K）
      comments: 258, // コメント数
    });
  });

  it("今日と今月のPVは、これまでどおり表示の文字から入る", () => {
    const 期間 = 封筒.entries.filter((e) => e.period !== undefined);
    expect(期間).toEqual([
      { scope: "work", period: "day", periodKey: "2026-09-22", metrics: { pv: 1 } },
      { scope: "work", period: "month", periodKey: "2026-09", metrics: { pv: 667 } },
    ]);
  });
});

describe("正確な数がどこにも無いとき", () => {
  /**
   * ツールチップが無く、表示が省略形だけの画面。
   * **その欄は入れない**——1.05M を 1,050,000 として台帳へ書くと、
   * あとから見て本当の数と見分けが付かなくなる。
   */
  function 省略形しか無いページ() {
    return 偽ページ([
      要素("ul", {}, [
        要素("li", { "aria-label": "PV" }, "PV 1.05M"),
        要素("li", { "aria-label": "応援/応援コメント" }, "応援 27.5K"),
        // 正確な数が1つは要る（1つも無いと no-data になり、欄の出入りを確かめられない）
        要素("li", { "aria-label": "フォロワー" }, "フォロワー 2,814"),
      ]),
    ]);
  }

  it("省略形の欄は入れず、正確な数の欄だけを入れる", () => {
    const 結果 = readStats(省略形しか無いページ(), 作品管理のURL, 読んだ日);
    expect(結果.ok).toBe(true);
    const 全体 = JSON.parse(結果.json).entries[0];
    expect(全体.metrics).toEqual({ bookmarks: 2814 });
    expect(全体.metrics.pv).toBeUndefined();
    expect(全体.metrics.likes).toBeUndefined();
  });
});

describe("アクセス数の画面から封筒を組む", () => {
  const 結果 = readStats(アクセス数のページ(), アクセス数のURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;

  it("話ごとの行を、話数つきで入れる", () => {
    expect(結果.ok).toBe(true);
    expect(封筒.entries).toEqual([
      { scope: "episode", episode: 1, metrics: { likes: 4, pv: 102 } },
      { scope: "episode", episode: 2, metrics: { likes: 0, pv: 87 } },
      // 「第N話」と読めない見出しは、その表の何番目かで代える
      { scope: "episode", episode: 3, metrics: { likes: 1, pv: 12 } },
    ]);
    expect(結果.counts).toEqual({ work: 0, episode: 3 });
  });

  it("見出しの行（数が無い行）は入らない", () => {
    expect(封筒.entries.length).toBe(3);
  });

  it("ページ送りの無い画面では、次のページは無い", () => {
    expect(結果.hasNextPage).toBe(false);
  });
});

/**
 * アクセス数は**50話ずつのページ送り**（2026-09-22 実機。219話の作品で5ページ）。
 *
 * 読めるのは画面に出ている50話ぶんだけなのに、0.2.1 までは「◯件コピーしました」としか
 * 言わなかった——作者は全話が入ったと思う。**次のページが在ることを見つけて伝える**のが
 * 0.2.2 の仕事で、押すことも href を開くこともしない。
 */
describe("次のページがあることに気づく", () => {
  it("50話ぶんと「次へ」がある画面では、次のページがあると分かる", () => {
    const 結果 = readStats(
      アクセス数のページ50話([
        ページ送りのリンク("前へ", 1),
        ページ送りのリンク("次へ", 3),
      ]),
      アクセス数のURL,
      読んだ日
    );
    expect(結果.ok).toBe(true);
    expect(結果.counts).toEqual({ work: 0, episode: 50 });
    expect(結果.hasNextPage).toBe(true);
  });

  it("最後のページ（「前へ」しかない）では、次のページは無い", () => {
    // 「前へ」も href に page= を持つ。ここで true にすると、最後のページで嘘を言う
    const 結果 = readStats(
      アクセス数のページ50話([ページ送りのリンク("前へ", 4)]),
      アクセス数のURL,
      読んだ日
    );
    expect(結果.ok).toBe(true);
    expect(結果.hasNextPage).toBe(false);
  });

  it("マイページや話へのリンクを、次のページと取り違えない", () => {
    const 結果 = readStats(
      アクセス数のページ50話([
        要素("a", { href: "/my" }, "マイページ"),
        // 題に「次へ」が入っていても、行き先がページ送りでなければ当たらない
        要素("a", { href: "/works/16816927859000000000/episodes/9" }, "第51話　次へ"),
      ]),
      アクセス数のURL,
      読んだ日
    );
    expect(結果.ok).toBe(true);
    expect(結果.hasNextPage).toBe(false);
  });

  it("封筒の中身には入れない（母艦は知らない欄を受け付けない）", () => {
    const 結果 = readStats(
      アクセス数のページ50話([ページ送りのリンク("次へ", 2)]),
      アクセス数のURL,
      読んだ日
    );
    const 封筒 = JSON.parse(結果.json);
    expect(Object.keys(封筒)).not.toContain("hasNextPage");
    expect(結果.json).not.toContain("hasNextPage");
  });

  it("作品管理の画面では、次のページを探さない", () => {
    // ページ送りがあるのはアクセス数の表だけ。表の指定が無い画面では常に false
    const 結果 = readStats(作品管理のページ(), 作品管理のURL, 読んだ日);
    expect(結果.hasNextPage).toBe(false);
  });
});

describe("読まないとき", () => {
  it("ログイン画面では何も読まない（見えているパスワード欄がある）", () => {
    const ページ = 偽ページ([
      要素("form", {}, [
        要素("input", { type: "text", autocomplete: "username" }, ""),
        要素("input", { type: "password", autocomplete: "current-password" }, ""),
      ]),
      要素("ul", {}, [要素("li", { "aria-label": "PV" }, "PV 1,269")]),
    ]);
    expect(readStats(ページ, 作品管理のURL, 読んだ日)).toEqual({ ok: false, reason: "login" });
  });

  it("数が1つも読めなければ、何も返さない（嘘の0を作らない）", () => {
    const ページ = 偽ページ([要素("div", {}, "ここには数がありません")]);
    const 結果 = readStats(ページ, 作品管理のURL, 読んだ日);
    expect(結果.ok).toBe(false);
    expect(結果.reason).toBe("no-data");
  });

  it("話の表が見つからなければ、何も返さない", () => {
    const ページ = 偽ページ([要素("table", { class: "Other_table__1" }, [])]);
    expect(readStats(ページ, アクセス数のURL, 読んだ日).reason).toBe("no-data");
  });

  it("読める管理画面でないページには、そもそも触れない", () => {
    const 結果 = readStats(作品管理のページ(), "https://kakuyomu.jp/works/168/episodes/9", 読んだ日);
    expect(結果.ok).toBe(false);
    expect(結果.reason).toBe("not-read-page");
  });
});

/* ------------------------------------------------------------------ *
 * 母艦の読み口を、そのまま通してみる
 * ------------------------------------------------------------------ */

/**
 * 母艦（novel-ai-assistant）が隣のフォルダーにあれば、**本物の検証器**に封筒を食わせる。
 *
 * ここを写しで書くと、片方だけが変わったときに気づけない——封筒は2つのプロジェクトの
 * 約束事なので、約束の相手に直接読ませるのがいちばん確かである。
 * 母艦が無い環境（この拡張だけを配った先）では、この組だけを飛ばす。
 */
const 母艦の読み口 = join(
  ルート,
  "..",
  "novel-ai-assistant",
  "src",
  "core",
  "readerStatsEnvelope.ts"
);
const 母艦がある = existsSync(母艦の読み口);

describe.skipIf(!母艦がある)("母艦の読み口を通る封筒になっているか", () => {
  it("作品管理の封筒を、母艦がそのまま受け取る", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(作品管理のページ(), 作品管理のURL, 読んだ日);
    const 受け取り = parseReaderStatsEnvelope(結果.json);
    expect(受け取り.ok, 受け取り.ok ? "" : 受け取り.reason).toBe(true);
    expect(受け取り.envelope.entries.length).toBe(3);
  });

  it("アクセス数の封筒を、母艦がそのまま受け取る", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(アクセス数のページ(), アクセス数のURL, 読んだ日);
    const 受け取り = parseReaderStatsEnvelope(結果.json);
    expect(受け取り.ok, 受け取り.ok ? "" : 受け取り.reason).toBe(true);
    expect(受け取り.envelope.entries[0]).toEqual({
      scope: "episode",
      episode: 1,
      metrics: { likes: 4, pv: 102 },
    });
  });

  it("ツールチップから読んだ6欄の封筒も、母艦がそのまま受け取る", async () => {
    // 大きい数（1,053,339）や、6欄すべてが揃った形でも、母艦の検証を通ること
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(大きい作品の作品管理のページ(), 作品管理のURL, 読んだ日);
    const 受け取り = parseReaderStatsEnvelope(結果.json);
    expect(受け取り.ok, 受け取り.ok ? "" : 受け取り.reason).toBe(true);
    const 全体 = 受け取り.envelope.entries[0];
    expect(全体.metrics.pv).toBe(1053339);
    expect(全体.metrics.comments).toBe(258);
  });

  it("クリップボードに改行が付いても受け取られる（母艦側が前後を落とす）", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(作品管理のページ(), 作品管理のURL, 読んだ日);
    expect(parseReaderStatsEnvelope(`\n${結果.json}\n`).ok).toBe(true);
  });
});
