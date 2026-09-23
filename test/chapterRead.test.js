import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readChapters, matchChapterPage, MARKER, ENVELOPE_VERSION } = require("../content/chapterRead.js");
const Messages = require("../common/messages.js");
const Actions = require("../common/actions.js");

/**
 * カクヨムの作品管理の画面から、章立て（大見出しと話の並び）を読む係（content/chapterRead.js。0.13.0）。
 *
 * 作者の問い（2026-09-23）「なろうやカクヨムのバックアップから章立ては読み取れませんでしたか？」——
 * **カクヨムのバックアップには章が入っていない。** 章は作品管理の画面の「大見出し」の行にだけある。
 *
 * **見本のページは作り物である。** 作品管理の画面の作り（話の表・話の行・題の枡・PVの枡、
 * 大見出しの行）を写した短い構造で、題はすべて架空——作者の作品の題は写さない。
 *
 * 話の表の作り（table.episodes が2つあり、本物は PV の枡を持つ行）は、読者の反応の読み取り係
 * （content/statsSites.js）が 2026-09-22 に実機で確かめた形と同じ。**大見出しの行の作りは
 * まだ実機で確かめていない**ので、「大見出し」の字で見分ける（README の実機未確認の一覧）。
 */

/* ------------------------------------------------------------------ *
 * 作り物のDOM（test/contestRead.test.js と同じ作り。innerText は行ごとに改行で繋ぐ）
 * ------------------------------------------------------------------ */

function 合う(el, 単純) {
  const m = /^([a-zA-Z0-9]*)((?:\.[\w-]+|\[[^\]]*\])*)$/.exec(単純.trim());
  if (!m) {
    return false;
  }
  if (m[1] && el.tagName !== m[1].toLowerCase()) {
    return false;
  }
  for (const 条件 of m[2].match(/\.[\w-]+|\[[^\]]*\]/g) || []) {
    if (条件.startsWith(".")) {
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
    if (c[2] === "=" && 値 !== c[3]) return false;
    if (c[2] === "^=" && !値.startsWith(c[3])) return false;
    if (c[2] === "*=" && !値.includes(c[3])) return false;
  }
  return true;
}

function 要素(tag, attrs, 中身) {
  const 子 = Array.isArray(中身) ? 中身 : [];
  const el = {
    tagName: tag,
    attrs: attrs || {},
    children: 子,
    get textContent() {
      return Array.isArray(中身) ? 子.map((c) => c.textContent).join(" ") : String(中身 || "");
    },
    get innerText() {
      return Array.isArray(中身) ? 子.map((c) => c.innerText).join("\n") : String(中身 || "");
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
  };
  return el;
}

/** 話の行（本物の表の行は PV の枡を持つ） */
function 話の行(題, 本物 = true) {
  return 要素("tr", { class: "episode" }, [
    要素("td", { class: "episode-title" }, 本物 ? [要素("a", { href: "/my/works/1/episodes/2" }, 題)] : ""),
    要素("td", { class: "episode-characterCount" }, "3,000文字"),
    ...(本物 ? [要素("td", { class: "episode-feedback-pv" }, "12 PV")] : []),
  ]);
}

/** 大見出しの行（作者の記録：「公開 大見出し 第一章『死の谷』」の並び） */
function 見出しの行(種類, 題) {
  return 要素("tr", { class: "chapter" }, [
    要素("td", {}, "公開"),
    要素("td", {}, 種類),
    要素("td", {}, 題),
  ]);
}

const 作品管理 = "https://kakuyomu.jp/my/works/1177354054000000000";

function ページ(行たち, 控え = true) {
  return 要素("html", {}, [
    要素("main", {}, [
      要素("div", { class: "summary-content" }, "フォロワー 3"),
      要素("table", { class: "episodes" }, 行たち),
      // もう1つの表（題も数字も入っていない控え）。ここの行は読まない
      ...(控え
        ? [要素("table", { class: "episodes" }, [見出しの行("大見出し", ""), 話の行("", false), 話の行("", false)])]
        : []),
    ]),
  ]);
}

const ふつうのページ = ページ([
  話の行("プロローグ"),
  見出しの行("大見出し", "第一章『岬』"),
  話の行("１話　潮の匂い"),
  話の行("２話　古い地図"),
  見出しの行("中見出し", "嵐の前"),
  見出しの行("大見出し", "第二章『灯』"),
  話の行("３話　嵐の夜"),
]);

describe("作品管理の画面の見分け", () => {
  it("カクヨムの作品管理の画面（/my/works/作品ID）だけ", () => {
    expect(matchChapterPage(作品管理)).toEqual({ ok: true, workId: "1177354054000000000" });
    expect(matchChapterPage(`${作品管理}/`).ok).toBe(true);
    expect(matchChapterPage(`${作品管理}?tab=episodes`).ok).toBe(true);
    // 話の編集画面・アクセス数・よその場所では読まない
    expect(matchChapterPage(`${作品管理}/episodes/1`).ok).toBe(false);
    expect(matchChapterPage("https://kakuyomu.jp/works/1177354054000000000/accesses").ok).toBe(false);
    expect(matchChapterPage("http://kakuyomu.jp/my/works/1").ok).toBe(false);
    expect(matchChapterPage("https://evil.example/my/works/1").ok).toBe(false);
  });
});

describe("大見出しと話の並びを読む", () => {
  const 結果 = readChapters(ふつうのページ, 作品管理, new Date(2026, 8, 24, 9, 0, 0));

  it("話の並びと、それぞれが属する大見出しを読む（控えの表は読まない）", () => {
    expect(結果.ok).toBe(true);
    const 封筒 = JSON.parse(結果.envelope);
    expect(封筒.episodes).toEqual([
      { heading: "プロローグ", part: null },
      { heading: "１話　潮の匂い", part: "第一章『岬』" },
      { heading: "２話　古い地図", part: "第一章『岬』" },
      { heading: "３話　嵐の夜", part: "第二章『灯』" },
    ]);
    expect(結果.count).toBe(4);
    expect(結果.chapters).toBe(2);
  });

  it("中見出しは章にしない（統合小説執筆環境の章は1段だけ）。読まなかった数は言う", () => {
    expect(結果.subHeadings).toBe(1);
  });

  it("封筒の形（目印・版・サイト・作品ID・読んだページ・時差つきの日時）", () => {
    const 封筒 = JSON.parse(結果.envelope);
    expect(MARKER).toBe("novelai-chapters");
    expect(ENVELOPE_VERSION).toBe(1);
    expect(封筒[MARKER]).toBe(1);
    expect(封筒.site).toBe("kakuyomu");
    expect(封筒.workId).toBe("1177354054000000000");
    expect(封筒.pageUrl).toBe(作品管理);
    expect(封筒.readAt.startsWith("2026-09-24T09:00:00")).toBe(true);
  });

  it("封筒に入れるのは、題と大見出しの字だけ（数は入れない）", () => {
    const 封筒 = JSON.parse(結果.envelope);
    expect(Object.keys(封筒).sort()).toEqual(
      ["episodes", "novelai-chapters", "pageUrl", "readAt", "site", "workId"].sort()
    );
    for (const 話 of 封筒.episodes) {
      expect(Object.keys(話).sort()).toEqual(["heading", "part"]);
    }
    expect(結果.envelope).not.toContain("PV");
  });
});

describe("読めないとき", () => {
  it("作品管理の画面でなければ読まない", () => {
    expect(readChapters(ふつうのページ, `${作品管理}/episodes/1`, new Date())).toEqual({
      ok: false,
      reason: "not-work-page",
    });
  });

  it("話が1つも無ければ no-episodes（0件を「渡した」にしない）", () => {
    expect(readChapters(ページ([], false), 作品管理, new Date())).toMatchObject({
      ok: false,
      reason: "no-episodes",
    });
  });

  it("大見出しが1つも無ければ no-chapters（章の無い作品か、画面の作りが変わった）", () => {
    expect(
      readChapters(ページ([話の行("１話　潮の匂い"), 話の行("２話　古い地図")]), 作品管理, new Date())
    ).toMatchObject({ ok: false, reason: "no-chapters", count: 2 });
  });

  it("長すぎる題は切る（ページ全体を流し込まない）", () => {
    const 結果 = readChapters(
      ページ([見出しの行("大見出し", "章".repeat(500)), 話の行("１話　潮の匂い")]),
      作品管理,
      new Date()
    );
    expect(結果.ok).toBe(true);
    expect(JSON.parse(結果.envelope).episodes[0].part.length).toBeLessThanOrEqual(200);
  });
});

describe("渡したあと（知らせと VS Code の呼び出し）", () => {
  it("章立てを置けたときだけ、統合小説執筆環境の章立ての口を呼ぶ（データはリンクに載せない）", () => {
    expect(Actions.vscodeLinkAfter({ kind: "chapters", copied: true })).toBe(
      "vscode://nonahisa.novel-ai-assistant/import-chapters"
    );
    expect(Actions.vscodeLinkAfter({ kind: "chapters", copied: false })).toBeNull();
    expect(Actions.VSCODE_CHAPTERS_URL).not.toMatch(/[?#]/);
  });

  it("知らせは、大見出しと話の数を言い、統合小説執筆環境の側の入口を添える", () => {
    const 渡した = Messages.messageForChaptersHanded({ count: 4, chapters: 2, subHeadings: 1 }, true);
    expect(渡した).toContain("大見出し 2個");
    expect(渡した).toContain("4話");
    expect(渡した).toContain("バックアップから章立て");
    expect(渡した).toContain("中見出し 1個は章にしていません");
    const 置いた = Messages.messageForChaptersHanded({ count: 4, chapters: 2, subHeadings: 0 }, false);
    expect(置いた).toContain("コピーしました");
    expect(Messages.notificationFor("chapters", true, "").title).toBe("章立てを読みました");
  });

  it("読めなかったときは、理由ごとに言い分ける（何も渡していない）", () => {
    expect(Messages.messageForChaptersRead({ reason: "no-chapters", count: 3 })).toContain(
      "大見出しが見つかりませんでした"
    );
    expect(Messages.messageForChaptersRead({ reason: "not-work-page" })).toBe(Messages.CHAPTERS.notHere);
  });
});
