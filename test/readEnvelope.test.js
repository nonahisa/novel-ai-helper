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
 * セレクタ1つ（`td[class^="X"]`・`a[href*="Y"]`・`td.episode-feedback-pv` のような形）に、
 * この要素が当たるか。
 *
 * 受ける照合は `=`（一致）・`^=`（前方一致）・`*=`（含む）と、クラスの指定（`.名前`）だけ。
 * **知らない書き方は当たらない扱いにする**——黙って「当たった」にすると、
 * 表のセレクタを書き間違えた日に、テストだけが通ってしまう。
 *
 * クラスの指定を受けるのは 0.4.0 から。作品管理ページの表はクラス名にハッシュが
 * 付いておらず（`tr.episode`）、前方一致ではなくそのまま当てるため。
 */
function 合う(el, 単純) {
  const m = /^([a-zA-Z]*)((?:\.[\w-]+|\[[^\]]*\])*)$/.exec(単純.trim());
  if (!m) {
    return false;
  }
  if (m[1] && el.tagName !== m[1].toLowerCase()) {
    return false;
  }
  for (const 条件 of m[2].match(/\.[\w-]+|\[[^\]]*\]/g) || []) {
    if (条件.startsWith(".")) {
      // class="a b" のように複数あることがあるので、区切って照合する
      const クラス = String(el.getAttribute("class") || "").split(/\s+/);
      if (!クラス.includes(条件.slice(1))) {
        return false;
      }
      continue;
    }
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
function 大きい作品の作品管理のページ(足す) {
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
    ...(足す || []),
  ]);
}

/* ------------------------------------------------------------------ *
 * 作品管理ページの、話ごとの表（0.4.0。2026-09-22 実機）
 * ------------------------------------------------------------------ */

/** 全角の数字へ（実機の題は「１話　転生」「２１９話　最終回」）。 */
function 全角へ(n) {
  return String(n).replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
}

/**
 * 作品管理ページの話の行（実機のクラス名。ハッシュは付かない）。
 *
 * @param {string} 題 `td.episode-title > a` の字（`１話　転生`）
 * @param {string} 応援 空文字なら、その欄は入らない（0にしない）
 */
function 作品管理の話の行(題, 文字数, 応援, 応援コメント, pv) {
  return 要素("tr", { class: "episode" }, [
    要素("td", { class: "episode-title" }, [要素("a", { title: 題 }, 題)]),
    要素("td", { class: "episode-characterCount" }, 文字数),
    要素("td", { class: "episode-feedback-cheerCount" }, 応援),
    要素("td", { class: "episode-feedback-cheerComment" }, 応援コメント),
    要素("td", { class: "episode-feedback-pv" }, pv),
  ]);
}

/**
 * **控えの表の行。** `td.episode-feedback-pv` を持たないのが、本物との唯一の違い。
 *
 * 実機の控えは題も数字も入っていないが、ここでは**わざと読めてしまう形**（題と応援数）に
 * してある——空の行なら「数が1つも無い行は落とす」既存の網でも落ちてしまい、
 * **rowFilter を外してもテストが通ってしまう**（それでは何も守っていない）。
 */
function 控えの話の行(題, 応援) {
  return 要素("tr", { class: "episode" }, [
    要素("td", { class: "episode-title" }, [要素("a", { title: 題 }, 題)]),
    要素("td", { class: "episode-characterCount" }, "3,697文字"),
    要素("td", { class: "episode-feedback-cheerCount" }, 応援),
  ]);
}

/** 「23299」→「23,299」（実機の表示は桁区切りつき）。 */
function 桁区切り(n) {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ",");
}

/**
 * 実機と同じ219話ぶんの行。
 *
 * 1話と219話は**実機で見えていた形のまま**（`１話　転生`／`２１９話　最終回`。
 * 数字は全角）。4話は応援コメントのセルが空——実機がそうで、**0で埋めない**ことを
 * ここで固定する。
 */
function 全219話の行たち() {
  const 行たち = [作品管理の話の行("１話　転生", "3,697文字", "302", "4", "23,299 PV")];
  for (let i = 2; i <= 219; i += 1) {
    行たち.push(
      作品管理の話の行(
        i === 219 ? "２１９話　最終回" : `${全角へ(i)}話　題${i}`,
        "3,697文字",
        String(400 + i),
        i === 4 ? "" : String(i),
        `${桁区切り(23000 + i)} PV`
      )
    );
  }
  return 行たち;
}

/**
 * 219話の作品の、作品管理ページ全体（2026-09-22 実機）。
 *
 * **`table.episodes` が2つある**。`tr.episode` は合わせて438行で、拾うと
 * 全話が二重に母艦の台帳へ入る——台帳は追記なので、入ってしまえば作者には
 * 見分けが付かない。本物は `td.episode-feedback-pv` を持つ219行だけ。
 */
function 全話つきの作品管理のページ() {
  return 大きい作品の作品管理のページ([
    要素("table", { class: "episodes" }, 全219話の行たち()),
    // 控えの表（同じ table.episodes / tr.episode を持つ）
    要素(
      "table",
      { class: "episodes" },
      [...Array(219).keys()].map((i) => 控えの話の行(`${全角へ(i + 1)}話　題${i + 1}`, "999"))
    ),
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
    // 0.5.0 から、日ごとのPV（ここでは「今日」の1件）は work と分けて day で数える
    expect(結果.counts).toEqual({ work: 2, day: 1, episode: 0 });
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

/**
 * 作品管理ページからは、**作品全体と全話ぶんが1回で読める**（0.4.0。作者の指摘
 * 「作品管理ページなら50話縛りが無いのでは」）。
 *
 * ここでいちばん怖いのは**控えの表**である。同じページに `tr.episode` を持つ表が
 * 2つあり（合わせて438行）、拾うと全話が二重に母艦の台帳へ入る。台帳は追記なので、
 * **入ってしまえば作者には見分けが付かない**——だから件数を固定する。
 */
describe("作品管理の画面から、全話ぶんも読む", () => {
  const 結果 = readStats(全話つきの作品管理のページ(), 作品管理のURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;
  const 話ごと = 結果.ok ? 封筒.entries.filter((e) => e.scope === "episode") : [];

  it("控えの表を拾わない（438ではなく219件）", () => {
    expect(結果.ok, 結果.ok ? "" : 結果.reason).toBe(true);
    expect(話ごと.length).toBe(219);
    expect(結果.counts).toEqual({ work: 2, day: 1, episode: 219 });
    // 同じ話が2回入っていない（二重に入ると、ここで重複が出る）
    expect(new Set(話ごと.map((e) => e.episode)).size).toBe(219);
  });

  it("1話の3欄が、実機の数のまま入る", () => {
    expect(話ごと[0]).toEqual({
      scope: "episode",
      episode: 1,
      metrics: { likes: 302, comments: 4, pv: 23299 },
    });
  });

  it("全角の話番号を読む（１話→1、２１９話→219）", () => {
    expect(話ごと[0].episode).toBe(1);
    expect(話ごと[218].episode).toBe(219);
  });

  it("応援コメントが空の話には、comments を入れない（0にしない）", () => {
    const 四話 = 話ごと.find((e) => e.episode === 4);
    expect(四話.metrics.comments).toBeUndefined();
    // 空なのは応援コメントだけ。他の欄はいつもどおり入る
    expect(四話.metrics.likes).toBe(404);
    expect(四話.metrics.pv).toBe(23004);
  });

  it("文字数は読まない（反応ではない）", () => {
    // 3,697文字 が、どこかの欄の数として封筒に入り込んでいないこと
    expect(結果.json).not.toContain("3697");
    for (const 行 of 話ごと) {
      for (const 欄 of Object.keys(行.metrics)) {
        expect(["likes", "comments", "pv"], `${欄} は話ごとに読む欄ではない`).toContain(欄);
      }
    }
  });

  it("作品全体の6欄は、今までどおり同時に入る", () => {
    const 全体 = 封筒.entries.find((e) => e.scope === "work" && e.period === undefined);
    expect(全体.metrics).toEqual({
      bookmarks: 2814,
      pv: 1053339,
      points: 1612,
      reviews: 611,
      likes: 27534,
      comments: 258,
    });
    // 今日・今月のPVも、これまでどおり
    expect(封筒.entries.filter((e) => e.period !== undefined).length).toBe(2);
  });

  it("作品管理にはページ送りが無い（「このページの分だけです」と言わない）", () => {
    expect(結果.hasNextPage).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 各話の更新日と、日ごとのPV（0.5.0。2026-09-23 実機）
 * ------------------------------------------------------------------ */

/**
 * 最終更新の枡つきの話の行。実機の `td.episode-date` は
 * `2022年4月25日15:07 最終更新`（日付と時刻のあいだに空白が無いこともある）。
 */
function 更新日つきの話の行(題, 更新日, pv) {
  return 要素("tr", { class: "episode" }, [
    要素("td", { class: "episode-title" }, [要素("a", { title: 題 }, 題)]),
    要素("td", { class: "episode-date" }, 更新日),
    要素("td", { class: "episode-characterCount" }, "3,697文字"),
    要素("td", { class: "episode-feedback-cheerCount" }, "3"),
    要素("td", { class: "episode-feedback-cheerComment" }, ""),
    要素("td", { class: "episode-feedback-pv" }, pv),
  ]);
}

/** 日ごとのグラフの1本（実機：`li.feedbackGraph-graph.ui-tooltip`、表示の文字は無い）。 */
function グラフの1本(ラベル) {
  return 要素("li", { class: "feedbackGraph-graph ui-tooltip", "data-ui-tooltip-label": ラベル }, "");
}

/**
 * 直近30日ぶんのグラフ（2026-08-24〜09-22）。値はその日の通し番号（1〜30）。
 * **最後の1本（今日 09-22）は「今日 1 PV」と違う値（999）にしてある**——重なったときに
 * 表示文字の側を採ることを、値の違いで確かめるため（同じ値では、どちらを採っても通る）。
 */
function 直近30日のグラフ() {
  const 本たち = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(2026, 7, 24 + i);
    const 値 = i === 29 ? 999 : i + 1;
    本たち.push(グラフの1本(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日：${値}PV`));
  }
  return 本たち;
}

function 更新日とグラフつきの作品管理のページ(グラフに足す) {
  return 大きい作品の作品管理のページ([
    要素("ul", { class: "feedbackGraph" }, [...直近30日のグラフ(), ...(グラフに足す || [])]),
    要素("table", { class: "episodes" }, [
      // 空白なし（実機のテキストのまま）
      更新日つきの話の行("１話　転生", "2022年4月25日15:07 最終更新", "23,299 PV"),
      // 空白あり・時刻の時が2桁
      更新日つきの話の行("２話　題2", "2024年7月31日 08:13 最終更新", "1,398 PV"),
      // 読めない枡。**欄ごと入れない**
      更新日つきの話の行("３話　題3", "–", "1,200 PV"),
      // 改行を挟んだ形（textContent には改行が入りうる）
      更新日つきの話の行("４話　題4", "2026年9月20日\n 9:05\n 最終更新", "20 PV"),
    ]),
    // 控えの表（更新日の枡を持っていても、PVの枡が無いので読まない）
    要素("table", { class: "episodes" }, [
      要素("tr", { class: "episode" }, [
        要素("td", { class: "episode-title" }, "１話　転生"),
        要素("td", { class: "episode-date" }, "2022年4月25日15:07 最終更新"),
        要素("td", { class: "episode-feedback-cheerCount" }, "999"),
      ]),
    ]),
  ]);
}

describe("各話の更新日を読む（0.5.0）", () => {
  const 結果 = readStats(更新日とグラフつきの作品管理のページ(), 作品管理のURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;
  const 話ごと = 結果.ok ? 封筒.entries.filter((e) => e.scope === "episode") : [];

  it("話ごとに updatedAt が日本時間のISOで入る（空白の有無を問わない）", () => {
    expect(結果.ok, 結果.ok ? "" : 結果.reason).toBe(true);
    expect(話ごと.length).toBe(4);
    expect(話ごと[0]).toEqual({
      scope: "episode",
      episode: 1,
      metrics: { likes: 3, pv: 23299 },
      updatedAt: "2022-04-25T15:07:00+09:00",
    });
    expect(話ごと[1].updatedAt).toBe("2024-07-31T08:13:00+09:00");
    expect(話ごと[3].updatedAt).toBe("2026-09-20T09:05:00+09:00");
  });

  it("読めない枡の話には、updatedAt の欄そのものを入れない（空文字や null にしない）", () => {
    const 三話 = 話ごと.find((e) => e.episode === 3);
    expect(Object.keys(三話)).not.toContain("updatedAt");
    expect(結果.json).not.toContain('"updatedAt":null');
    expect(結果.json).not.toContain('"updatedAt":""');
    // 数はいつもどおり入る（更新日が読めないせいで、話ごと落とさない）
    expect(三話.metrics.pv).toBe(1200);
  });

  it("アクセス数の表には更新日の枡が無い（updatedAt を入れない）", () => {
    const アクセス数 = JSON.parse(readStats(アクセス数のページ(), アクセス数のURL, 読んだ日).json);
    for (const 行 of アクセス数.entries) {
      expect(Object.keys(行)).not.toContain("updatedAt");
    }
  });
});

describe("直近の日ごとのPVを読む（0.5.0）", () => {
  const 結果 = readStats(更新日とグラフつきの作品管理のページ(), 作品管理のURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;
  const 日ごと = 結果.ok ? 封筒.entries.filter((e) => e.period === "day") : [];

  it("グラフの1本ずつが、日の期間の行として入る", () => {
    expect(結果.ok, 結果.ok ? "" : 結果.reason).toBe(true);
    expect(日ごと[0]).toEqual({
      scope: "work",
      period: "day",
      periodKey: "2026-08-24",
      metrics: { pv: 1 },
    });
    // 月をまたいでも、日付のまま（8月31日の次は9月1日）
    expect(日ごと.find((e) => e.periodKey === "2026-09-01").metrics.pv).toBe(9);
  });

  it("今日が2件にならない（「今日 ◯ PV」とグラフの今日を1件にし、表示文字の側を採る）", () => {
    const 今日 = 日ごと.filter((e) => e.periodKey === "2026-09-22");
    expect(今日.length).toBe(1);
    // グラフの今日は 999、表示の「今日 1 PV」は 1。約束どおり表示の側
    expect(今日[0].metrics.pv).toBe(1);
    // 30日ぶんで30件（今日を重ねて31件にしない）
    expect(日ごと.length).toBe(30);
    expect(new Set(日ごと.map((e) => e.periodKey)).size).toBe(30);
  });

  it("日の行は日付の順に並び、今月の行はそのあとに残る", () => {
    const キー = 日ごと.map((e) => e.periodKey);
    expect(キー).toEqual([...キー].sort());
    expect(封筒.entries.filter((e) => e.period === "month")).toEqual([
      { scope: "work", period: "month", periodKey: "2026-09", metrics: { pv: 667 } },
    ]);
  });

  it("件数は、作品全体・日ごと・話ごとに分けて数える", () => {
    expect(結果.counts).toEqual({ work: 2, day: 30, episode: 4 });
  });

  it("同じ日が2本あれば最初の1本を採り、読めない1本は入れない", () => {
    const 足した = readStats(
      更新日とグラフつきの作品管理のページ([
        // 8月24日の2本目（値が違う）。あとから上書きしない
        グラフの1本("2026年8月24日：77PV"),
        // 略記・暦に無い日・形の違う文言は、どれも入れない
        グラフの1本("2026年8月10日：1.2KPV"),
        グラフの1本("2026年2月30日：3PV"),
        グラフの1本("読み込み中"),
      ]),
      作品管理のURL,
      読んだ日
    );
    const 日 = JSON.parse(足した.json).entries.filter((e) => e.period === "day");
    expect(日.length).toBe(30);
    expect(日.find((e) => e.periodKey === "2026-08-24").metrics.pv).toBe(1);
    expect(日.map((e) => e.periodKey)).not.toContain("2026-08-10");
  });

  it("グラフが無い作品管理では、これまでどおり今日の1件だけ", () => {
    const 無し = readStats(大きい作品の作品管理のページ(), 作品管理のURL, 読んだ日);
    expect(無し.counts).toEqual({ work: 2, day: 1, episode: 0 });
  });

  it("アクセス数の画面では、日ごとのPVを探さない", () => {
    expect(readStats(アクセス数のページ(), アクセス数のURL, 読んだ日).counts.day).toBe(0);
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
    expect(結果.counts).toEqual({ work: 0, day: 0, episode: 3 });
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
    expect(結果.counts).toEqual({ work: 0, day: 0, episode: 50 });
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

  it("作品管理の全話ぶん（219話）の封筒も、母艦がそのまま受け取る", async () => {
    // 0.4.0 で入るようになった形。**母艦の検証には件数の上限が無い**ことも、ここで分かる
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(全話つきの作品管理のページ(), 作品管理のURL, 読んだ日);
    const 受け取り = parseReaderStatsEnvelope(結果.json);
    expect(受け取り.ok, 受け取り.ok ? "" : 受け取り.reason).toBe(true);
    const 話ごと = 受け取り.envelope.entries.filter((e) => e.scope === "episode");
    expect(話ごと.length).toBe(219);
    expect(話ごと[0]).toEqual({
      scope: "episode",
      episode: 1,
      metrics: { likes: 302, comments: 4, pv: 23299 },
    });
  });

  it("更新日と日ごとのPVが入った封筒も、母艦がそのまま受け取る（0.5.0）", async () => {
    /*
      約束（読者の反応の封筒 v1b）：封筒の版は 1 のまま、`updatedAt` は省いてよい欄。
      **古い母艦は updatedAt を読み飛ばす**ので、ここでは「断られないこと」を確かめる。
      読むようになった母艦なら、入れたとおりの値で届いていること。
    */
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(更新日とグラフつきの作品管理のページ(), 作品管理のURL, 読んだ日);
    expect(JSON.parse(結果.json)["novelai-stats"]).toBe(1);
    const 受け取り = parseReaderStatsEnvelope(結果.json);
    expect(受け取り.ok, 受け取り.ok ? "" : 受け取り.reason).toBe(true);

    const 日ごと = 受け取り.envelope.entries.filter((e) => e.period === "day");
    expect(日ごと.length).toBe(30);
    expect(日ごと[0]).toEqual({
      scope: "work",
      period: "day",
      periodKey: "2026-08-24",
      metrics: { pv: 1 },
    });

    const 一話 = 受け取り.envelope.entries.find((e) => e.scope === "episode" && e.episode === 1);
    expect(一話.metrics).toEqual({ likes: 3, pv: 23299 });
    if ("updatedAt" in 一話) {
      expect(一話.updatedAt).toBe("2022-04-25T15:07:00+09:00");
    }
  });

  it("クリップボードに改行が付いても受け取られる（母艦側が前後を落とす）", async () => {
    const { parseReaderStatsEnvelope } = await import(/* @vite-ignore */ 母艦の読み口);
    const 結果 = readStats(作品管理のページ(), 作品管理のURL, 読んだ日);
    expect(parseReaderStatsEnvelope(`\n${結果.json}\n`).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Narou.fun の作品ページ（0.6.0。母艦の残課題 B11）
 * ------------------------------------------------------------------ */

/**
 * Narou.fun の作品ページ（2026-09-23 に母艦のセッションが読んだ実物の形）を小さく写す。
 * **数字・題・あらすじ・Nコードはすべて架空**（作品の本文や、ほかの方の作品は入れない）。
 *
 * 実物では、ラベルの枡の中は「アイコンの svg ＋ 文字」で、文字は要素ではなく
 * 文字の節である。偽のDOMは文字の節を持たないので、`t` という名前の要素で代える
 * （表のセレクタは div.flex-1・div.uppercase・div.text-sm だけなので、当たらない）。
 */
function 札(ラベル, 数, 値の属性) {
  return 要素("div", { class: "w-1/3 sm:w-1/6 p-1" }, [
    要素("div", { class: "border rounded shadow p-2" }, [
      要素("div", { class: "flex-1" }, [
        要素("div", { class: "uppercase text-gray-500" }, [
          要素("svg", { class: "inline mr-1 text-blue-400 w-3" }, ""),
          要素("t", {}, ラベル),
        ]),
        要素("div", Object.assign({ class: "text-sm" }, 値の属性 || {}), 数),
      ]),
    ]),
  ]);
}

const 架空のあらすじ =
  "（架空のあらすじ）少年が教科書の知識だけを頼りに異世界で成り上がる物語。" +
  "第2章に突入しました。※小説家になろう12万PV突破！※ここは読まれてはいけない文。";

function NarouFunのページ(差し替え) {
  const 数 = Object.assign(
    {
      日間P: "-",
      総合P: "1,200",
      ブクマ: "300",
      平均評価: "8.57",
      感想数: "12",
      レビュー: "1",
      評価頻度: "23.33%",
      評価P: "600",
      評価者数: "70",
      週間読者: "45",
      日間イン: "0回",
      ベスト: "圏外",
    },
    差し替え || {}
  );
  return 偽ページ([
    要素("h1", { class: "font-bold mb-1" }, [
      要素("a", { href: "https://ncode.syosetu.com/N1234AB/" }, [要素("span", {}, "（架空の題）")]),
    ]),
    要素("ul", { class: "flex underline" }, [
      要素("li", {}, [要素("a", { href: "https://ncode.syosetu.com/N1234AB/1" }, "1話目")]),
      要素("li", {}, [要素("a", { href: "https://novelcom.syosetu.com/impression/list/ncode/1/" }, "感想")]),
      要素("li", {}, [要素("a", { href: "https://novelcom.syosetu.com/novelreview/list/ncode/1/" }, "レビュー")]),
      // KASASAGI への導線。辿らない（そもそも辿る機能が無い）
      要素("li", {}, [要素("a", { href: "https://kasasagi.hinaproject.com/access/top/ncode/N1234AB/" }, "解析")]),
    ]),
    要素("p", { class: "mb-4 tracking-wider leading-7" }, 架空のあらすじ),
    要素("div", {}, [
      要素("span", { class: "mr-1" }, [要素("span", {}, "全12話連載中")]),
      要素("span", { class: "mr-1" }, "2024/07/31 08:15更新"),
    ]),
    要素(
      "div",
      { class: "flex flex-wrap text-center font-bold" },
      Object.keys(数).map((ラベル) => 札(ラベル, 数[ラベル]))
    ),
    要素("div", { class: "text-gray-500 text-right" }, "最終取得日時：2026/09/22 01:26"),
  ]);
}

const NarouFunのURL = "https://db.narou.fun/works/N1234AB";

describe("Narou.fun の作品ページから封筒を組む（0.6.0）", () => {
  const 結果 = readStats(NarouFunのページ(), NarouFunのURL, 読んだ日);
  const 封筒 = 結果.ok ? JSON.parse(結果.json) : null;

  it("封筒のサイトは narou、出どころは narou.fun、作品IDは URL の Nコード", () => {
    expect(結果.ok).toBe(true);
    expect(封筒["novelai-stats"]).toBe(1);
    expect(封筒.site).toBe("narou");
    expect(封筒.source).toBe("narou.fun");
    expect(封筒.workId).toBe("N1234AB");
    expect(封筒.readAt).toBe(読んだ日.toISOString());
  });

  it("作品全体の1行に、表に書いた7つの数が入る", () => {
    expect(封筒.entries).toEqual([
      {
        scope: "work",
        metrics: {
          points: 1200,
          bookmarks: 300,
          comments: 12,
          reviews: 1,
          narou_ratingPoints: 600,
          narou_raters: 70,
          narou_weeklyReaders: 45,
        },
      },
    ]);
  });

  it("平均評価・評価頻度・日間P・日間イン・ベストは入れない", () => {
    const 欄 = Object.keys(封筒.entries[0].metrics);
    // 8.57 や 23.33% や 0回 が、どの欄にも化けて入っていないこと
    for (const 値 of Object.values(封筒.entries[0].metrics)) {
      expect([8, 857, 23, 2333, 0]).not.toContain(値);
    }
    expect(欄).not.toContain("narou_ratingAverage");
  });

  it("あらすじ・題・話数・更新日時・最終取得日時は封筒に入らない", () => {
    expect(結果.json).not.toContain("架空");
    expect(結果.json).not.toContain("読まれてはいけない");
    expect(結果.json).not.toContain("全12話");
    expect(結果.json).not.toContain("2024");
    expect(結果.json).not.toContain("最終取得");
  });

  it("件数は作品全体の1件だけ（日ごと・話ごとは読まない）", () => {
    expect(結果.counts).toEqual({ work: 1, day: 0, episode: 0 });
    expect(結果.hasNextPage).toBe(false);
  });

  it("数が「-」の札は、欄ごと入れない（0にしない）", () => {
    const 途中 = readStats(NarouFunのページ({ 週間読者: "-", レビュー: "" }), NarouFunのURL, 読んだ日);
    const 中身 = JSON.parse(途中.json).entries[0].metrics;
    expect(中身).not.toHaveProperty("narou_weeklyReaders");
    expect(中身).not.toHaveProperty("reviews");
    expect(中身.bookmarks).toBe(300);
  });

  it("ラベルは完全一致で当てる（似た名前の札を取り違えない）", () => {
    // 「総合P」の札が無い日に、「評価P」「日間P」を総合Pとして拾わない。
    // 名前を含むだけの札（架空の「評価者数（前日）」）が先にあっても、それを評価者数として拾わない
    const ページ = 偽ページ([
      要素("div", {}, [
        札("評価P", "600"),
        札("日間P", "5"),
        札("評価者数（前日）", "3"),
        札("評価者数", "70"),
        札("評価頻度", "23.33%"),
      ]),
    ]);
    const 中身 = JSON.parse(readStats(ページ, NarouFunのURL, 読んだ日).json).entries[0].metrics;
    expect(中身).toEqual({ narou_ratingPoints: 600, narou_raters: 70 });
  });

  it("同じラベルの札が2枚あれば、最初の1枚を採る", () => {
    const ページ = 偽ページ([要素("div", {}, [札("ブクマ", "300"), 札("ブクマ", "999")])]);
    const 中身 = JSON.parse(readStats(ページ, NarouFunのURL, 読んだ日).json).entries[0].metrics;
    expect(中身.bookmarks).toBe(300);
  });

  it("札が1枚も読めなければ、何も返さない（ページの形が変わった）", () => {
    const ページ = 偽ページ([要素("div", { class: "flex-1" }, "ここには数がありません")]);
    expect(readStats(ページ, NarouFunのURL, 読んだ日).reason).toBe("no-data");
  });

  it("作品ページ以外の Narou.fun のページには触れない", () => {
    expect(readStats(NarouFunのページ(), "https://db.narou.fun/search?userid=1", 読んだ日).reason).toBe(
      "not-read-page"
    );
  });

  it("カクヨムの封筒には、出どころの欄を書かない（0.5.0 までと同じ形）", () => {
    const カクヨム = JSON.parse(readStats(作品管理のページ(), 作品管理のURL, 読んだ日).json);
    expect(カクヨム).not.toHaveProperty("source");
    expect(カクヨム.site).toBe("kakuyomu");
  });
});

describe.skipIf(!母艦がある)("Narou.fun の封筒を、母艦の読み口と照合に通す（0.6.0）", () => {
  const 台帳 = (siteProfiles) => ({
    schemaVersion: "1",
    sites: [],
    siteProfiles,
    posts: [],
    rankings: [],
  });

  it("母艦が受け取り、台帳のNコードと合えば照合も通る", async () => {
    const { parseReaderStatsEnvelope, matchReaderStatsEnvelope } = await import(
      /* @vite-ignore */ 母艦の読み口
    );
    const 受け取り = parseReaderStatsEnvelope(readStats(NarouFunのページ(), NarouFunのURL, 読んだ日).json);
    expect(受け取り.ok).toBe(true);
    expect(受け取り.envelope.source).toBe("narou.fun");
    expect(受け取り.envelope.entries[0].metrics.narou_weeklyReaders).toBe(45);
    // 台帳のNコードは小文字（なろうのURLとバックアップの形）でも合う
    expect(
      matchReaderStatsEnvelope(受け取り.envelope, 台帳([{ site: "narou", workId: "n1234ab" }]))
    ).toBeNull();
  });

  it("ほかの作品のページ（台帳に無いNコード）の封筒は、母艦が断る", async () => {
    const { parseReaderStatsEnvelope, matchReaderStatsEnvelope } = await import(
      /* @vite-ignore */ 母艦の読み口
    );
    const 受け取り = parseReaderStatsEnvelope(
      readStats(NarouFunのページ(), "https://db.narou.fun/works/N9999ZZ", 読んだ日).json
    );
    expect(受け取り.ok).toBe(true);
    expect(
      matchReaderStatsEnvelope(受け取り.envelope, 台帳([{ site: "narou", workId: "n1234ab" }]))
    ).toContain("N9999ZZ");
  });
});
