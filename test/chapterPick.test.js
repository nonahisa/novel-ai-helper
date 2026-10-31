import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeChapterLabel, pickChapterOption } = require("../common/guard.js");
const { messageForFilled } = require("../common/messages.js");
const { siteById, SITES } = require("../content/sites.js");

/**
 * アルファポリスの章の選び方（0.15.0）。DOM を受け取らない判定の部分だけを確かめる。
 *
 * 守りたいのは「**ちょうど1つ当たったときだけ選ぶ**」。0件で近いものを選んだり、
 * 2件以上で先頭を選んだりすると、作者が気づかないまま別の章へ話を入れることになる。
 * 選択肢の題はすべて架空。
 */

/** 投稿画面の章の選択肢（先頭は「選ばない」。value が空） */
const 選択肢 = [
  { label: "章を選択しない", value: "" },
  { label: "第一章『白い港』", value: "101" },
  { label: "第二章　霧の街", value: "102" },
  { label: "Chapter 3 Blue", value: "103" },
];

describe("章の名前のならし", () => {
  it("前後の空白を落とし、続く空白を1つにする", () => {
    expect(normalizeChapterLabel("  第二章   霧の街 \n")).toBe("第二章 霧の街");
  });

  it("全角の空白と全角の英数は半角にそろえる", () => {
    expect(normalizeChapterLabel("第二章　霧の街")).toBe("第二章 霧の街");
    expect(normalizeChapterLabel("Ｃｈａｐｔｅｒ　３　Ｂｌｕｅ")).toBe("Chapter 3 Blue");
  });

  it("英数と空白のほかは変えない（かぎ括弧・漢数字・かなはそのまま）", () => {
    expect(normalizeChapterLabel("第一章『白い港』")).toBe("第一章『白い港』");
    // 大文字小文字はそろえない（別の章の題と区別がつかなくなるため）
    expect(normalizeChapterLabel("chapter 3 blue")).not.toBe(normalizeChapterLabel("Chapter 3 Blue"));
  });

  it("文字列でなければ空にする", () => {
    expect(normalizeChapterLabel(null)).toBe("");
    expect(normalizeChapterLabel(3)).toBe("");
  });
});

describe("章を選ぶ（ちょうど1つ当たったときだけ）", () => {
  it("同じ題が1つあれば、その位置を返す", () => {
    expect(pickChapterOption(選択肢, "第一章『白い港』")).toEqual({ ok: true, index: 1 });
  });

  it("空白・全角半角の違いはならして比べる", () => {
    expect(pickChapterOption(選択肢, " 第二章 霧の街 ")).toEqual({ ok: true, index: 2 });
    expect(pickChapterOption(選択肢, "Ｃｈａｐｔｅｒ　３　Ｂｌｕｅ")).toEqual({ ok: true, index: 3 });
  });

  it("当たらなければ選ばない（近い題・一部が同じ題も選ばない）", () => {
    expect(pickChapterOption(選択肢, "第三章『鐘』")).toEqual({ ok: false, reason: "none", count: 0 });
    expect(pickChapterOption(選択肢, "第一章").reason).toBe("none");
    expect(pickChapterOption(選択肢, "白い港").reason).toBe("none");
  });

  it("同じ題が2つ以上あれば選ばない", () => {
    const 重なり = [...選択肢, { label: "第一章　『白い港』".replace("　", ""), value: "104" }];
    expect(pickChapterOption(重なり, "第一章『白い港』")).toEqual({ ok: false, reason: "many", count: 2 });
  });

  it("value が空の選択肢（「章を選択しない」など）は、題が同じでも選ばない", () => {
    expect(pickChapterOption(選択肢, "章を選択しない").reason).toBe("none");
  });

  it("章が空・選択肢が無いときは選ばない", () => {
    expect(pickChapterOption(選択肢, "").ok).toBe(false);
    expect(pickChapterOption([], "第一章『白い港』").reason).toBe("none");
    expect(pickChapterOption(null, "第一章『白い港』").reason).toBe("none");
  });
});

describe("章の欄の表（content/sites.js）", () => {
  it("章の欄を持つのはアルファポリスだけ（カクヨムの投稿画面には章の欄が無い）", () => {
    expect(SITES.filter((s) => s.chapter).map((s) => s.id)).toEqual(["alphapolis"]);
  });

  it("アルファポリスの章の見当は select だけに当たる形（汎用の見当を持たない）", () => {
    const 章 = siteById("alphapolis").chapter;
    expect(章.selectors[0]).toBe('select#ContentBlockEpisodeNovelChapter[name="chapter"]');
    for (const s of 章.selectors) {
      expect(s.startsWith("select")).toBe(true);
    }
    // 題・本文の欄（fields）には混ぜない（fields の見当は select に当たらないことを別のテストが見張る）
    expect(Object.keys(siteById("alphapolis").fields)).toEqual(["title", "body"]);
  });
});

describe("結果の知らせに章を添える", () => {
  const 入れた = ["タイトル欄", "本文欄"];

  it("選べたら「章：◯◯」を添える", () => {
    const 文 = messageForFilled(入れた, [], { ok: true, label: "第一章『白い港』" });
    expect(文).toContain("章：第一章『白い港』");
    expect(文).toContain("投稿ボタンはご自分で押してください");
  });

  it("当たらなければ「章は選べませんでした（◯◯）」を添える", () => {
    const 文 = messageForFilled(入れた, [], { ok: false, reason: "none", chapter: "第三章『鐘』", count: 0 });
    expect(文).toMatch(/章は選べませんでした（[^）]*第三章『鐘』[^）]*）/);
  });

  it("2つ以上当たったときも「章は選べませんでした」で、数を言う", () => {
    const 文 = messageForFilled(入れた, [], { ok: false, reason: "many", chapter: "第一章『白い港』", count: 2 });
    expect(文).toContain("章は選べませんでした");
    expect(文).toContain("2つ");
  });

  it("章の欄が見つからないとき・選べない状態のときも、選べなかったと言う", () => {
    expect(messageForFilled(入れた, [], { ok: false, reason: "not-found", chapter: "第一章" })).toContain(
      "章は選べませんでした（章の欄が見つかりません）"
    );
    expect(messageForFilled(入れた, [], { ok: false, reason: "disabled", chapter: "第一章" })).toContain(
      "章は選べませんでした"
    );
  });

  it("章の指定が無ければ、これまでと同じ文（章に触れない）", () => {
    expect(messageForFilled(入れた, [])).toBe(messageForFilled(入れた, [], undefined));
    expect(messageForFilled(入れた, [])).not.toContain("章");
  });
});
