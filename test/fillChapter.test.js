import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 貼り込み係（content/fill.js）を偽のページの上で動かし、章の欄の扱いを確かめる（0.15.0）。
 *
 * 判定そのもの（ならし・1つだけ当たったら選ぶ）は test/chapterPick.test.js が見る。ここで見るのは
 * fill.js の**順番**：題・本文を入れられたときだけ章に触る、封筒に章が無ければ章に触らない、
 * ログイン画面・本文欄が無い画面・確認で断ったときは章にも触らない、選んだら input/change を配る。
 *
 * 偽のページは、アルファポリスの投稿画面の要素の形だけを最小限に置く（題・作品IDは架空）。
 */

/* ---------------- 偽のDOM ---------------- */

/** 単純な選択子1つ（`select#a[name="b"]`・`#a`・`[placeholder*="x"]` など）に当たるか */
function 合う(el, 単純) {
  const m = /^([a-zA-Z][a-zA-Z0-9]*)?((?:#[\w-]+|\[[^\]]*\])*)$/.exec(単純.trim());
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const 条件 of m[2].match(/#[\w-]+|\[[^\]]*\]/g) || []) {
    if (条件.startsWith("#")) {
      if (el.getAttribute("id") !== 条件.slice(1)) return false;
      continue;
    }
    const c = /^\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]$/.exec(条件);
    if (!c) return false;
    const 値 = el.getAttribute(c[1]);
    if (値 === null) return false;
    if (c[2] === "=" && 値 !== c[3]) return false;
    if (c[2] === "*=" && !値.includes(c[3])) return false;
    if (c[2] === "^=" && !値.startsWith(c[3])) return false;
  }
  return true;
}

function 要素(tag, attrs = {}, 子たち = [], 字 = "") {
  const el = {
    tagName: tag.toUpperCase(),
    attrs,
    children: 子たち,
    textContent: 字,
    value: attrs.value !== undefined ? attrs.value : "",
    id: attrs.id || "",
    type: attrs.type || "",
    readOnly: false,
    disabled: attrs.disabled === true,
    isContentEditable: false,
    配った: [],
    getAttribute(name) {
      if (name === "disabled") return null;
      return Object.prototype.hasOwnProperty.call(attrs, name) ? String(attrs[name]) : null;
    },
    getClientRects() {
      return [{}];
    },
    dispatchEvent(ev) {
      el.配った.push(ev.type);
      return true;
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
  if (el.tagName === "SELECT") {
    // 本物の select と同じく、options・selectedIndex・value がつながって動く
    el.options = 子たち;
    let 選んだ = 0;
    Object.defineProperty(el, "selectedIndex", {
      get: () => 選んだ,
      set: (i) => {
        選んだ = i;
      },
    });
    Object.defineProperty(el, "value", {
      get: () => (el.options[選んだ] ? el.options[選んだ].value : ""),
      set: (v) => {
        const i = el.options.findIndex((o) => o.value === v);
        選んだ = i;
      },
    });
  }
  return el;
}

const 選択肢 = (字, value) => 要素("option", { value }, [], 字);

/** アルファポリスの新しい話の投稿画面（要素の形だけ） */
function 投稿画面({ 章の欄 = true, 章の選択肢, 章の欄を止める = false, パスワード欄 = false, 本文欄 = true } = {}) {
  const 章 = 要素(
    "select",
    { id: "ContentBlockEpisodeNovelChapter", name: "chapter", disabled: 章の欄を止める },
    章の選択肢 || [
      選択肢("章を選択しない", ""),
      選択肢("第一章『白い港』", "101"),
      選択肢("第二章　霧の街", "102"),
    ]
  );
  const 題 = 要素("input", { type: "text", id: "ContentBlockEpisodeNovelTitle", name: "episode_title" });
  const 本文 = 要素("textarea", { id: "NovelEpisodeBodyId", name: "body" });
  const フォームの子 = [
    要素("input", { type: "hidden", name: "_method", value: "POST" }),
    ...(章の欄 ? [章] : []),
    題,
    要素("input", { type: "file", id: "TextSelect", name: "text" }),
    ...(本文欄 ? [本文] : []),
    要素("input", { type: "submit", name: "draft", value: "保存" }),
    要素("input", { type: "submit", name: "publish", value: "公開" }),
  ];
  if (パスワード欄) {
    フォームの子.push(要素("input", { type: "password", name: "password" }));
  }
  const フォーム = 要素(
    "form",
    { id: "ContentBlockEpisodeNovelMypageSaveEpisodeForm", action: "/mypage/novel/save_episode/123456789" },
    フォームの子
  );
  const ページ = 要素("html", {}, [要素("main", {}, [フォーム])]);
  return { ページ, 章, 題, 本文 };
}

/** content script を偽のページの上で起こし、「埋めて」を1回届けて結果を返す */
function 貼り込む(画面, 封筒, { 確認の答え = true, pageKind, 確認の文 = [] } = {}) {
  let 受け口 = null;
  const 返事 = [];
  const 場 = {
    console,
    Event,
    setTimeout: (f) => f(),
    document: 画面.ページ,
    window: { confirm: (文) => (確認の文.push(文), 確認の答え) },
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    chrome: {
      runtime: {
        onMessage: { addListener: (f) => (受け口 = f) },
        sendMessage: (m) => 返事.push(m),
        lastError: undefined,
      },
    },
  };
  場.globalThis = 場;
  vm.createContext(場);
  for (const f of ["common/messages.js", "common/guard.js", "content/sites.js", "content/fill.js"]) {
    vm.runInContext(readFileSync(join(ルート, f), "utf8"), 場, { filename: f });
  }
  受け口({ type: "fill", envelope: 封筒, workIdChecked: true, pageKind }, {}, () => {});
  return 返事[0].result;
}

const 封筒 = (上書き = {}) => ({
  site: "alphapolis",
  workId: "123456789",
  title: "第3話 鐘の鳴る朝",
  body: "　港に霧が出ていた。",
  ...上書き,
});

describe("アルファポリスの章を選ぶ（content/fill.js。0.15.0）", () => {
  it("題が1つだけ当たれば選び、input と change を配り、知らせに「章：◯◯」を添える", () => {
    const 画面 = 投稿画面();
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }));
    expect(結果.ok).toBe(true);
    expect(画面.章.selectedIndex).toBe(1);
    expect(画面.章.value).toBe("101");
    expect(画面.章.配った).toEqual(["input", "change"]);
    expect(結果.message).toContain("章：第一章『白い港』");
    expect(画面.本文.value).toBe("　港に霧が出ていた。");
  });

  it("全角の空白と半角の空白の違いはならして選ぶ", () => {
    const 画面 = 投稿画面();
    貼り込む(画面, 封筒({ chapter: "第二章 霧の街" }));
    expect(画面.章.value).toBe("102");
  });

  it("当たらなければ選ばず、題と本文は入れたうえで「章は選べませんでした」と添える", () => {
    const 画面 = 投稿画面();
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第三章『鐘』" }));
    expect(結果.ok).toBe(true);
    expect(画面.章.selectedIndex).toBe(0);
    expect(画面.章.配った).toEqual([]);
    expect(画面.本文.value).not.toBe("");
    expect(結果.message).toContain("章は選べませんでした");
  });

  it("同じ題が2つあれば選ばない", () => {
    const 画面 = 投稿画面({
      章の選択肢: [選択肢("章を選択しない", ""), 選択肢("第一章『白い港』", "101"), 選択肢("第一章『白い港』", "201")],
    });
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }));
    expect(画面.章.selectedIndex).toBe(0);
    expect(画面.章.配った).toEqual([]);
    expect(結果.message).toContain("章は選べませんでした");
  });

  it("封筒に章が無ければ、章の欄に触らず、知らせにも章を書かない", () => {
    const 画面 = 投稿画面();
    const 結果 = 貼り込む(画面, 封筒());
    expect(画面.章.selectedIndex).toBe(0);
    expect(画面.章.配った).toEqual([]);
    expect(結果.message).not.toContain("章");
  });

  it("章の欄が見つからなければ選ばず、そう添える（題と本文は入れる）", () => {
    const 画面 = 投稿画面({ 章の欄: false });
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }));
    expect(結果.ok).toBe(true);
    expect(結果.message).toContain("章は選べませんでした（章の欄が見つかりません）");
  });

  it("章の欄が選べない状態（disabled）なら触らない", () => {
    const 画面 = 投稿画面({ 章の欄を止める: true });
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }));
    expect(画面.章.selectedIndex).toBe(0);
    expect(画面.章.配った).toEqual([]);
    expect(結果.message).toContain("章は選べませんでした");
  });

  it("ログイン画面（パスワード欄がある）では章にも触らない", () => {
    const 画面 = 投稿画面({ パスワード欄: true });
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }));
    expect(結果.ok).toBe(false);
    expect(画面.章.selectedIndex).toBe(0);
    expect(画面.章.配った).toEqual([]);
  });

  it("本文欄が無い画面（投稿画面でない）では章にも触らない", () => {
    const 画面 = 投稿画面({ 本文欄: false });
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }));
    expect(結果.ok).toBe(false);
    expect(画面.章.配った).toEqual([]);
  });

  it("確認で［キャンセル］を選んだら章にも触らない", () => {
    const 画面 = 投稿画面();
    画面.本文.value = "書きかけ";
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }), { 確認の答え: false });
    expect(結果.ok).toBe(false);
    expect(画面.章.selectedIndex).toBe(0);
    expect(画面.章.配った).toEqual([]);
  });

  it("カクヨム宛ての封筒に章が載っていても、章の欄を探さない（表に章の欄が無い）", () => {
    // アルファポリスの形のページにカクヨムの封筒を当てることは実際には照合で止まるが、
    // 表に章の欄が無いサイトでは fill.js が章を探さないことだけをここで確かめる
    const 画面 = 投稿画面();
    貼り込む(画面, 封筒({ site: "kakuyomu", chapter: "第一章『白い港』" }));
    expect(画面.章.配った).toEqual([]);
  });
});

describe("話の編集画面（0.20.0）：置き換えの確認を毎回出し、章も選ぶ", () => {
  it("欄が空でも確認を出す。答えれば題・本文・章を入れる", () => {
    const 画面 = 投稿画面();
    const 確認の文 = [];
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }), { pageKind: "edit", 確認の文 });
    expect(確認の文).toHaveLength(1);
    expect(確認の文[0]).toContain("置き換えます");
    expect(結果.ok).toBe(true);
    expect(画面.本文.value).not.toBe("");
    expect(画面.章.selectedIndex).toBe(1);
  });

  it("断れば何も入れない（章も変えない）", () => {
    const 画面 = 投稿画面();
    画面.本文.value = "保存してある本文";
    const 結果 = 貼り込む(画面, 封筒({ chapter: "第一章『白い港』" }), { pageKind: "edit", 確認の答え: false });
    expect(結果.ok).toBe(false);
    expect(画面.本文.value).toBe("保存してある本文");
    expect(画面.章.selectedIndex).toBe(0);
  });

  it("画面の題とコピーした題が違えば、確認の文に両方を並べる。字数も言う", () => {
    const 画面 = 投稿画面();
    画面.題.value = "第2話 別の話";
    画面.本文.value = "あいうえお";
    const 確認の文 = [];
    貼り込む(画面, 封筒(), { pageKind: "edit", 確認の文 });
    expect(確認の文[0]).toContain("「第2話 別の話」");
    expect(確認の文[0]).toContain("5字");
  });

  it("新規作成の画面では、空の欄なら今までどおり確認を出さない", () => {
    const 確認の文 = [];
    貼り込む(投稿画面(), 封筒(), { 確認の文 });
    expect(確認の文).toHaveLength(0);
  });
});
