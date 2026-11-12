import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PressLog = require("../common/pressLog.js");

const 名を残す = ["kakuyomu.jp", "www.alphapolis.co.jp", "alphapolis.co.jp", "syosetu.com", "db.narou.fun"];
const いま = new Date("2026-11-12T12:00:00.000Z");

describe("押したときの診断の記録（0.21.0）", () => {
  it("アドレスの形：数字は #、Nコードは N#、問い合わせと # 以降は捨てる", () => {
    expect(PressLog.shapeOf("https://kakuyomu.jp/my/works/1177354054800000001/episodes/1177354054800000099?x=1#top", 名を残す)).toEqual({
      place: "kakuyomu.jp",
      shape: "/my/works/#/episodes/#",
    });
    expect(PressLog.shapeOf("https://db.narou.fun/novels/n1234ab", 名を残す)).toEqual({ place: "db.narou.fun", shape: "/novels/N#" });
    expect(PressLog.shapeOf("https://syosetu.com/usernovelmanage/top/ncode/1234567/", 名を残す)).toEqual({
      place: "syosetu.com",
      shape: "/usernovelmanage/top/ncode/#/",
    });
    // サブドメインも名を残す（なろうの別のホスト）
    expect(PressLog.shapeOf("https://yomou.syosetu.com/rank/top/", 名を残す).place).toBe("yomou.syosetu.com");
  });

  it("この拡張に関わらないサイトは、名もアドレスも残さない。Chrome の画面も同じ", () => {
    expect(PressLog.shapeOf("https://example.com/private/page/123", 名を残す)).toEqual({ place: "ほかのサイト", shape: "" });
    expect(PressLog.shapeOf("https://notkakuyomu.jp/x", 名を残す)).toEqual({ place: "ほかのサイト", shape: "" });
    expect(PressLog.shapeOf("chrome://newtab/", 名を残す)).toEqual({ place: "ほかの画面", shape: "" });
    expect(PressLog.shapeOf("", 名を残す)).toEqual({ place: "ほかの画面", shape: "" });
  });

  it("新しいものを末尾に足し、上限を超えたら古いものから消す", () => {
    let 記録 = PressLog.normalizeLog(undefined);
    for (let i = 0; i < PressLog.PRESS_LOG_MAX + 3; i += 1) {
      記録 = PressLog.addPress(記録, { url: `https://kakuyomu.jp/my/works/${i}`, did: "stats" }, 名を残す, new Date(いま.getTime() + i * 1000));
    }
    expect(記録.entries).toHaveLength(PressLog.PRESS_LOG_MAX);
    expect(記録.entries.at(-1).at).toBe(new Date(いま.getTime() + (PressLog.PRESS_LOG_MAX + 2) * 1000).toISOString());
    expect(JSON.stringify(記録)).not.toMatch(/\d{5,}/);
  });

  it("壊れた行は捨てる", () => {
    const 記録 = PressLog.normalizeLog({
      entries: [
        { at: "x", place: "kakuyomu.jp", shape: "/my", did: "stats" },
        { at: 1, place: "kakuyomu.jp", shape: "/my", did: "stats" },
        null,
        { at: "x", place: "kakuyomu.jp", shape: "a".repeat(PressLog.SHAPE_MAX + 1), did: "stats" },
      ],
    });
    expect(記録.entries).toHaveLength(1);
  });

  it("説明のページの字：新しい順に、場所・形・押して何をしたか", () => {
    let 記録 = PressLog.addPress(undefined, { url: "https://kakuyomu.jp/my/works/1", did: "stats" }, 名を残す, いま);
    記録 = PressLog.addPress(
      記録,
      { url: "https://kakuyomu.jp/my/works/1/episodes/2", did: "posted", posted: true },
      名を残す,
      new Date(いま.getTime() + 1000)
    );
    const 字 = PressLog.formatLog(記録, (iso) => iso.slice(11, 19));
    expect(字.split("\n")).toEqual([
      "12:00:01　kakuyomu.jp/my/works/#/episodes/#（話の番号を読む画面）　→ 話の番号を渡す",
      "12:00:00　kakuyomu.jp/my/works/#　→ 読者の反応を読む",
    ]);
    expect(PressLog.formatLog(undefined)).toMatch(/まだ記録はありません/);
  });
});
