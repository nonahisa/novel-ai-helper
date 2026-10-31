import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectorPlan, isSafeTarget } = require("../common/guard.js");
const { siteById } = require("../content/sites.js");

/**
 * アルファポリスの新しい話の投稿画面で、表（content/sites.js）の指定が**どの欄に当たるか**を確かめる（0.14.2）。
 *
 * 2026-11-01 に作者の Chrome で投稿画面（/mypage/novel/save_episode/{作品ID}）を読んで分かった形を、
 * 要素の形だけ最小限で置く（本物の写しは置かない。題・作品IDは架空）。
 *
 * 貼り込み係（content/fill.js）はページの document を直に見るので、偽のページを渡せない。
 * そこで fill.js と同じ順番——表の formScopes で起点を決め、selectorPlan の順に当て、
 * 書いてはいけない欄（isSafeTarget）を飛ばす——を、ここで偽のページに当てる。
 *
 * いちばん守りたいのは、**同じフォームの中にあるファイルの欄・章の選択・［保存］［公開］の釦に
 * 当たらないこと**。とくに `input[type=file][name="text"]`（本文をファイルから読む欄）は、
 * 名前が「text」なので、本文の欄の見当（`#text`・`[name="text"]`）に当たりやすい。
 */

/* ---------------- 偽のDOM（id・タグ・属性の一致と含む・前方一致だけを知っている） ---------------- */

/** 単純な選択子1つ（`input#a[name="b"]`・`#a`・`textarea[name="body"]`・`[placeholder*="x"]`）に当たるか */
function 合う(el, 単純) {
  const m = /^([a-zA-Z][a-zA-Z0-9]*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]*\])*)$/.exec(単純.trim());
  if (!m) {
    // 知らない書き方は当たらない扱いにする（黙って当てると、書き間違いをテストが見逃す）
    return false;
  }
  if (m[1] && el.tagName !== m[1].toLowerCase()) {
    return false;
  }
  for (const 条件 of m[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]*\]/g) || []) {
    if (条件.startsWith("#")) {
      if (el.getAttribute("id") !== 条件.slice(1)) return false;
      continue;
    }
    if (条件.startsWith(".")) {
      if (!String(el.getAttribute("class") || "").split(/\s+/).includes(条件.slice(1))) return false;
      continue;
    }
    const c = /^\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]$/.exec(条件);
    if (!c) return false;
    const 値 = el.getAttribute(c[1]);
    if (値 === null) return false;
    if (c[2] === "=" && 値 !== c[3]) return false;
    if (c[2] === "^=" && !値.startsWith(c[3])) return false;
    if (c[2] === "*=" && !値.includes(c[3])) return false;
  }
  return true;
}

function 要素(tag, attrs, 子たち) {
  const el = {
    tagName: tag,
    attrs: attrs || {},
    children: 子たち || [],
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    querySelectorAll(selector) {
      const 結果 = [];
      const 潜る = (親) => {
        for (const c of 親.children) {
          if (selector.split(",").some((単純) => 合う(c, 単純))) 結果.push(c);
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

/** 新しい話の投稿画面（要素の形だけ。2026-11-01 の作者の Chrome の画面に合わせた） */
function 投稿画面() {
  const フォーム = 要素(
    "form",
    {
      id: "ContentBlockEpisodeNovelMypageSaveEpisodeForm",
      action: "/mypage/novel/save_episode/123456789",
      method: "post",
    },
    [
      要素("input", { type: "hidden", name: "_method", value: "POST" }),
      要素("select", { name: "chapter" }, [要素("option", { value: "" })]),
      要素("input", { type: "text", id: "ContentBlockEpisodeNovelTitle", name: "episode_title" }),
      要素("input", { type: "file", id: "TextSelect", name: "text" }),
      要素("textarea", { id: "NovelEpisodeBodyId", name: "body" }),
      要素("input", { type: "file", name: "image_files" }),
      要素("input", { type: "submit", name: "draft", value: "保存" }),
      要素("input", { type: "submit", name: "publish", value: "公開" }),
    ]
  );
  // フォームの外：ページの上の検索欄（起点の外なので当たってはいけない）
  const 検索 = 要素("form", { action: "/search", id: "header-search" }, [
    要素("input", { type: "text", name: "query", placeholder: "タイトル・作者名で検索" }),
  ]);
  return 要素("html", {}, [要素("header", {}, [検索]), 要素("main", {}, [フォーム])]);
}

/** fill.js の findScope と同じ：表の formScopes を上から試し、最初に見つかった要素。無ければページ全体 */
function 起点(ページ, site) {
  for (const selector of site.formScopes) {
    const el = ページ.querySelector(selector);
    if (el) return { el, 見つかった: true };
  }
  return { el: ページ, 見つかった: false };
}

/** fill.js の findField と同じ順番で欄を決める（見えているかは偽のDOMでは問わない） */
function 欄を探す(ページ, site, 欄の名) {
  const { el: 範囲, 見つかった } = 起点(ページ, site);
  for (const { selector, kind } of selectorPlan(site.fields[欄の名])) {
    const el = 範囲.querySelector(selector);
    if (!el) continue;
    const 素性 = { type: el.getAttribute("type") || "", autocomplete: el.getAttribute("autocomplete") || "" };
    if (!isSafeTarget(素性)) continue;
    return { el, kind: 見つかった ? kind : "generic", selector };
  }
  return null;
}

const site = siteById("alphapolis");

describe("アルファポリスの新しい話の投稿画面の欄（0.14.2）", () => {
  it("欄を探す起点は、投稿のフォーム（form#ContentBlockEpisodeNovelMypageSaveEpisodeForm）", () => {
    expect(site.formScopes[0]).toBe("#ContentBlockEpisodeNovelMypageSaveEpisodeForm");
    const { el, 見つかった } = 起点(投稿画面(), site);
    expect(見つかった).toBe(true);
    expect(el.getAttribute("id")).toBe("ContentBlockEpisodeNovelMypageSaveEpisodeForm");
  });

  it("題は input#ContentBlockEpisodeNovelTitle[name=\"episode_title\"] に、サイト固有の当たり方（strict）で入る", () => {
    const 当たり = 欄を探す(投稿画面(), site, "title");
    expect(当たり).not.toBeNull();
    expect(当たり.el.getAttribute("name")).toBe("episode_title");
    expect(当たり.kind).toBe("strict");
  });

  it("本文は textarea#NovelEpisodeBodyId[name=\"body\"] に、strict で入る（textarea なので改行は消えない）", () => {
    const 当たり = 欄を探す(投稿画面(), site, "body");
    expect(当たり).not.toBeNull();
    expect(当たり.el.tagName).toBe("textarea");
    expect(当たり.el.getAttribute("id")).toBe("NovelEpisodeBodyId");
    expect(当たり.kind).toBe("strict");
  });

  it("どの見当も、ファイルの欄・章の選択・［保存］［公開］の釦・隠し欄には当たらない", () => {
    const ページ = 投稿画面();
    const { el: 範囲 } = 起点(ページ, site);
    const 触れてはいけない = 範囲.children.filter(
      (el) =>
        el.tagName === "select" ||
        ["file", "submit", "hidden"].includes(el.getAttribute("type"))
    );
    expect(触れてはいけない).toHaveLength(6);
    for (const 欄の名 of Object.keys(site.fields)) {
      for (const { selector } of selectorPlan(site.fields[欄の名])) {
        // 起点の中でもページ全体でも当たらないこと（起点が見つからない日にも当たらない）
        for (const 探す範囲 of [範囲, ページ]) {
          const 当たった = 探す範囲.querySelectorAll(selector);
          for (const el of 触れてはいけない) {
            expect(当たった, `${欄の名} の ${selector} が ${el.getAttribute("name")} に当たった`).not.toContain(el);
          }
        }
      }
    }
  });

  it("名前が text の欄（ファイルから本文を読む欄）に当たる見当を、表に置かない", () => {
    const 全部 = Object.values(site.fields).flatMap((f) => selectorPlan(f).map((p) => p.selector));
    expect(全部).not.toContain("#text");
    expect(全部.some((s) => /\[name="text"\]/.test(s))).toBe(false);
  });

  it("章の見当（0.15.0）は、フォームの中の章の select だけに当たり、題・本文・ファイル・釦・隠し欄には当たらない", () => {
    const ページ = 投稿画面();
    const { el: 範囲 } = 起点(ページ, site);
    for (const selector of site.chapter.selectors) {
      for (const el of 範囲.querySelectorAll(selector)) {
        expect(el.tagName, `${selector} が ${el.tagName} に当たった`).toBe("select");
        expect(el.getAttribute("name")).toBe("chapter");
      }
    }
    // 少なくとも1つの見当は、いまの画面の章の select に当たる
    expect(site.chapter.selectors.some((s) => 範囲.querySelector(s) !== null)).toBe(true);
  });

  it("ページの上の検索欄（フォームの外）には当たらない", () => {
    const 当たり = 欄を探す(投稿画面(), site, "title");
    expect(当たり.el.getAttribute("name")).not.toBe("query");
  });
});
