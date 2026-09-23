import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

// 読み込みの順番は、ブラウザ（manifest の2つ目の content_scripts）と同じにする
require("../content/contestSites.js");
const { readContests, MARKER, ENVELOPE_VERSION } = require("../content/contestRead.js");
const { matchContestPage, CONTEST_SITES } = require("../content/contestSites.js");

/**
 * 公募の一覧の読み取り係（content/contestRead.js。0.12.0）。
 *
 * **見本のページは作り物である。** 実物のページの作り（1件の枠・名前の見出し・リンク・見出しの並び）を
 * 写した短い構造で、公募名・主催・賞典はすべて架空——実物を丸ごと置くと、他人の文章の転載になる。
 *
 * ここで確かめるのは「どの枠を1件と読み、名前・リンク・見出しをどこから取り、封筒のどこへ入れるか」。
 * 1件の中身（締切・字数…）の読み分けは統合小説執筆環境の仕事で、ここでは読まない。
 */

/* ------------------------------------------------------------------ *
 * 作り物のDOM（test/readEnvelope.test.js と同じ作り。innerText は行ごとに改行で繋ぐ）
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

/** ノベルポータルの1件（見出しのリンクが公式サイト）。 */
function ポータルの枠(名前, 行たち, リンク) {
  const 見出し = リンク
    ? 要素("h3", { class: "wp-block-heading" }, [要素("a", { href: リンク }, 名前)])
    : 要素("h3", { class: "wp-block-heading" }, 名前);
  return 要素("div", { class: "wp-block-group contest-card" }, [
    要素("div", { class: "wp-block-group__inner-container" }, [
      見出し,
      要素("table", {}, 行たち.map((行) => 要素("td", {}, 行))),
      要素("div", { class: "cs-contest-like" }, [要素("button", {}, "◇ 気になる！ 3")]),
    ]),
  ]);
}

const ポータル = "https://creative-story.net/bungakusyou/#contest-abc";

const ポータルのページ = 要素("html", {}, [
  要素("main", {}, [
    要素("h2", {}, "2026年10月締切"),
    ポータルの枠("第3回 みずうみ文学賞", ["締切：2026年10月31日（土）", "字数：5,000〜10,000字"], "https://example.com/mizuumi"),
    ポータルの枠("開催予定", ["公式企画 冬の作り物祭 2026年12月10日～"], null),
    要素("h2", {}, "地域限定公募"),
    ポータルの枠("第9回 かわべ市民文芸賞", ["締切：2026年12月1日（火）"], null),
    ポータルの枠("作り物の危ない賞", ["締切：2026年12月1日"], "javascript:alert(1)"),
  ]),
]);

describe("公募の一覧のページの見分け", () => {
  it("決めた3ページだけ（末尾の / と、?page=2 のような問い合わせは問わない）", () => {
    expect(matchContestPage("https://creative-story.net/bungakusyou/", CONTEST_SITES).ok).toBe(true);
    expect(matchContestPage("https://creative-story.net/202111contest", CONTEST_SITES).ok).toBe(true);
    expect(matchContestPage("https://tsukuritemirai.com/kobo/novel/?page=2", CONTEST_SITES).ok).toBe(true);
    expect(matchContestPage("https://creative-story.net/", CONTEST_SITES).ok).toBe(false);
    expect(matchContestPage("https://creative-story.net/bungakusyou/other/", CONTEST_SITES).ok).toBe(false);
    expect(matchContestPage("https://tsukuritemirai.com/kobo/manga/", CONTEST_SITES).ok).toBe(false);
    expect(matchContestPage("http://creative-story.net/bungakusyou/", CONTEST_SITES).ok).toBe(false);
    expect(matchContestPage("https://evil.example/bungakusyou/", CONTEST_SITES).ok).toBe(false);
  });
});

describe("ノベルポータルの一覧を読む", () => {
  const 結果 = readContests(ポータルのページ, ポータル, new Date(2026, 8, 23, 10, 0, 0));

  it("公募の枠を1件ずつ読み、「開催予定」の表は数えない", () => {
    expect(結果.ok).toBe(true);
    expect(結果.count).toBe(3);
    expect(結果.skipped).toBe(0);
    expect(結果.siteId).toBe("novelportal");
    expect(結果.paged).toBe(false);
  });

  it("封筒の形（目印・版・出どころ・読んだページ・時差つきの日時）", () => {
    const 封筒 = JSON.parse(結果.envelope);
    expect(封筒[MARKER]).toBe(ENVELOPE_VERSION);
    expect(MARKER).toBe("novelai-contests");
    expect(ENVELOPE_VERSION).toBe(1);
    expect(封筒.source).toBe("novelportal");
    // 読んだページの印（#…）は落とす
    expect(封筒.pageUrl).toBe("https://creative-story.net/bungakusyou/");
    expect(封筒.readAt.startsWith("2026-09-23T10:00:00")).toBe(true);
    expect(封筒.readAt).toMatch(/(?:[+-]\d{2}:\d{2})$/);
  });

  it("名前・公式サイトへのリンク・見出し・枠の文を入れる（リンクは http・https だけ）", () => {
    const [一, 二, 三] = JSON.parse(結果.envelope).items;
    expect(一).toMatchObject({
      name: "第3回 みずうみ文学賞",
      url: "https://example.com/mizuumi",
      section: "2026年10月締切",
    });
    expect(一.text).toContain("締切：2026年10月31日（土）");
    expect(一.text).toContain("字数：5,000〜10,000字");
    expect(二).toMatchObject({ name: "第9回 かわべ市民文芸賞", url: null, section: "地域限定公募" });
    expect(三.url).toBeNull();
  });
});

describe("ツクリテミライの一覧を読む", () => {
  const 枠 = (名前, 〆切, 行き先) =>
    要素("div", { class: "bg-surface-card rounded-lg border" }, [
      要素("div", { class: "p-4" }, [
        要素("div", {}, [要素("span", {}, "小説"), 要素("span", {}, `〆切：${〆切}`)]),
        要素("a", { href: 行き先 }, [要素("h2", { class: "text-lg" }, 名前)]),
        要素("p", {}, "作り物の説明です。 応募資格 : 不問 〆切 : WEB応募：2026年10月31日"),
        要素("div", {}, [要素("button", {}, "#WEB応募")]),
      ]),
    ]);
  const ページ = 要素("html", {}, [
    要素("main", {}, [
      要素("div", { class: "filter-panel" }, [要素("h2", {}, "タグから絞り込む")]),
      要素("div", { class: "grid" }, [
        枠("作り物BL大賞", "2026/10/31", "/kobo/abc123"),
        枠("作り物ホラー小説大賞", "2026/12/31", "/kobo/def456"),
      ]),
    ]),
  ]);

  it("枠ごとに読み、リンクはそのサイトの詳しいページ（相対の書き方をページのURLから組む）", () => {
    const 結果 = readContests(ページ, "https://tsukuritemirai.com/kobo/novel/?page=2", new Date());
    expect(結果.ok).toBe(true);
    expect(結果.paged).toBe(true);
    const items = JSON.parse(結果.envelope).items;
    expect(items.map((i) => i.name)).toEqual(["作り物BL大賞", "作り物ホラー小説大賞"]);
    expect(items[0].url).toBe("https://tsukuritemirai.com/kobo/abc123");
    expect(items[0].section).toBeNull();
    expect(items[0].text).toContain("〆切：2026/10/31");
    expect(JSON.parse(結果.envelope).source).toBe("tsukuritemirai");
  });

  it("まだ読み込み中（枠が無い）なら、0件を渡さずに読めなかったと言う", () => {
    const 読み込み中 = 要素("html", {}, [要素("main", {}, [要素("p", {}, "読み込み中...")])]);
    expect(readContests(読み込み中, "https://tsukuritemirai.com/kobo/novel/", new Date())).toEqual({
      ok: false,
      reason: "no-cards",
    });
  });
});

describe("読めなかったものを黙って減らさない", () => {
  it("枠はあるが名前を読めなかったものは、数えて返す", () => {
    const ページ = 要素("html", {}, [
      ポータルの枠("第3回 みずうみ文学賞", ["締切：2026年10月31日"], null),
      ポータルの枠("", ["締切：2026年11月1日"], null),
    ]);
    const 結果 = readContests(ページ, ポータル, new Date());
    expect(結果.count).toBe(1);
    expect(結果.skipped).toBe(1);
  });

  it("枠がすべて名前の無いもの・開催予定だけなら、読めなかったと言う", () => {
    const ページ = 要素("html", {}, [ポータルの枠("開催予定", ["作り物"], null)]);
    expect(readContests(ページ, ポータル, new Date())).toEqual({ ok: false, reason: "no-cards" });
  });

  it("公募の一覧でないページでは読まない", () => {
    expect(readContests(ポータルのページ, "https://kakuyomu.jp/my/works/1", new Date())).toEqual({
      ok: false,
      reason: "not-contest-page",
    });
  });

  it("1件の文が長すぎれば切る（ページ全体を流し込まない）", () => {
    const ページ = 要素("html", {}, [
      ポータルの枠("第3回 みずうみ文学賞", ["締切：2026年10月31日", "あ".repeat(10000)], null),
    ]);
    const 結果 = readContests(ページ, ポータル, new Date());
    expect(JSON.parse(結果.envelope).items[0].text.length).toBeLessThanOrEqual(4000);
  });
});

/* ------------------------------------------------------------------ *
 * 統合小説執筆環境の読み口を、そのまま通してみる（test/readEnvelope.test.js と同じ考え方）
 * ------------------------------------------------------------------ */

/**
 * 統合小説執筆環境（novel-ai-assistant）が隣のフォルダーにあれば、**本物の読み取り**
 * （`core/contestListing.ts` の `parseContestsClipboard`）にこの封筒を読ませる。
 * 封筒は2つのプロジェクトの約束事なので、約束の相手に直接読ませるのがいちばん確かである。
 * 別の作業木（枝）で確かめたいときは、環境変数 NOVELAI_ASSISTANT_DIR で場所を差し替える。
 */
const 読み口 = join(
  process.env.NOVELAI_ASSISTANT_DIR || join(ルート, "..", "novel-ai-assistant"),
  "src",
  "core",
  "contestListing.ts"
);

describe.skipIf(!existsSync(読み口))("統合小説執筆環境の読み口を通る封筒になっているか", () => {
  it("ノベルポータルの封筒を、統合小説執筆環境がそのまま読み、締切・字数・リンク・見出しが入る", async () => {
    const { parseContestsClipboard } = await import(/* @vite-ignore */ 読み口);
    const 結果 = readContests(ポータルのページ, ポータル, new Date(2026, 8, 23, 10, 0, 0));
    const 受け取り = parseContestsClipboard(結果.envelope);
    expect(受け取り.ok, 受け取り.ok ? "" : JSON.stringify(受け取り)).toBe(true);
    expect(受け取り.from).toBe("helper");
    expect(受け取り.pageUrl).toBe("https://creative-story.net/bungakusyou/");
    expect(受け取り.listings.map((l) => l.name)).toEqual([
      "第3回 みずうみ文学賞",
      "第9回 かわべ市民文芸賞",
      "作り物の危ない賞",
    ]);
    expect(受け取り.listings[0]).toMatchObject({
      url: "https://example.com/mizuumi",
      section: "2026年10月締切",
      source: "novelportal",
      deadlines: ["2026-10-31"],
      charLimit: { kind: "range", min: 5000, max: 10000 },
    });
  });
});
