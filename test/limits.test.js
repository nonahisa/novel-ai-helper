import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { overLimits } = require("../common/guard.js");
const Messages = require("../common/messages.js");
const { SITES } = require("../content/sites.js");

/**
 * 字数の上限で止める作り（作者の答え 2026-11-18「超えたら入れずに止めて知らせる。後書きは今は足さない」）。
 * ネオページ（題60字・本文10万字未満）の下ごしらえ。表（content/sites.js）の limits に上限を書いたサイトだけで効く。
 * 字は「見える1字」に近い数え方（コードポイント）で数える——絵文字や「𠮷」を2字と数えて、届かない原稿を止めないため。
 */
describe("字数の上限を超えたか（guard.js の overLimits）", () => {
  const 上限 = { title: 60, body: 99999 };

  it("上限の中なら、何も返さない（ちょうど上限の字数も入れてよい）", () => {
    expect(overLimits({ title: "あ".repeat(60), body: "い".repeat(99999) }, 上限)).toEqual([]);
  });

  it("題が超えたら、題の字数と上限を返す", () => {
    expect(overLimits({ title: "あ".repeat(61), body: "本文" }, 上限)).toEqual([{ field: "title", length: 61, max: 60 }]);
  });

  it("本文が超えたら、本文の字数と上限を返す。両方なら題・本文の順", () => {
    expect(overLimits({ title: "あ".repeat(70), body: "い".repeat(100000) }, 上限)).toEqual([
      { field: "title", length: 70, max: 60 },
      { field: "body", length: 100000, max: 99999 },
    ]);
  });

  it("サロゲートペアの字（𠮷・絵文字）は1字と数える", () => {
    expect(overLimits({ title: "𠮷".repeat(60), body: "" }, 上限)).toEqual([]);
    expect(overLimits({ title: "𠮷".repeat(61), body: "" }, 上限)).toEqual([{ field: "title", length: 61, max: 60 }]);
  });

  it("上限を持たないサイト（limits が無い・数でない）では何も止めない", () => {
    const 長い = { title: "あ".repeat(500), body: "い".repeat(300000) };
    expect(overLimits(長い, undefined)).toEqual([]);
    expect(overLimits(長い, {})).toEqual([]);
    expect(overLimits(長い, { title: "60", body: null })).toEqual([]);
  });

  it("題・本文が字でないときは数えない（封筒の形の確かめは別の係）", () => {
    expect(overLimits({ title: undefined, body: 3 }, 上限)).toEqual([]);
  });
});

describe("上限を超えたときの知らせ（messages.js の messageForOverLimit）", () => {
  it("サイトの名前・どの欄が何字で上限が何字か・何もしなかったことを言う", () => {
    const 文 = Messages.messageForOverLimit("ネオページ", [{ field: "title", length: 72, max: 60 }]);
    expect(文).toContain("ネオページ");
    expect(文).toContain("題");
    expect(文).toContain("72字");
    expect(文).toContain("60字");
    expect(文).toContain("何もしませんでした");
  });

  it("両方超えたら、両方を並べる", () => {
    const 文 = Messages.messageForOverLimit("ネオページ", [
      { field: "title", length: 72, max: 60 },
      { field: "body", length: 120000, max: 99999 },
    ]);
    expect(文).toContain("72字");
    expect(文).toContain("120,000字");
    expect(文).toContain("99,999字");
  });
});

describe("いまの対応サイトの表", () => {
  it("カクヨム・アルファポリスは上限を持たない（今の振る舞いを変えない）", () => {
    for (const id of ["kakuyomu", "alphapolis"]) {
      expect(SITES.find((s) => s.id === id).limits).toBeUndefined();
    }
  });
});
