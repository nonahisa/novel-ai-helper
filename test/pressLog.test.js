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

describe("押したときの記録の結果と失敗の種類（1.1.0。障害報告用の記録のため。作者の答え 2026-11-28「残す」）", () => {
  it("結果（済み・止めた・結果待ち）と失敗の種類の札を残す", () => {
    const 記録 = PressLog.addPress(
      PressLog.normalizeLog(undefined),
      { url: "https://kakuyomu.jp/my/works/1/episodes/new", did: "fill", result: "stopped", reason: "match-work-mismatch" },
      名を残す,
      いま
    );
    expect(記録.entries[0]).toMatchObject({ did: "fill", result: "stopped", reason: "match-work-mismatch" });
  });

  it("表に無い札・字の入った札は残さない（行は残す）。知らせの文や detail を札に混ぜても保存されない", () => {
    for (const 悪い of ["pixiv", "too-long:1001", "クリップボードを読めませんでした。", "envelope-unknown-site pixiv", "x".repeat(41)]) {
      const 記録 = PressLog.addPress(PressLog.normalizeLog(undefined), { url: "https://kakuyomu.jp/my", did: "fill", result: "stopped", reason: 悪い }, 名を残す, いま);
      expect(記録.entries).toHaveLength(1);
      expect("reason" in 記録.entries[0], 悪い).toBe(false);
      expect(JSON.stringify(記録)).not.toContain(悪い);
    }
    // 結果も表のものだけ
    const 記録 = PressLog.addPress(PressLog.normalizeLog(undefined), { url: "https://kakuyomu.jp/my", did: "fill", result: "ok?" }, 名を残す, いま);
    expect("result" in 記録.entries[0]).toBe(false);
  });

  it("札の無い前の版の行も、そのまま読める（保存から読み直しても壊れた行に数えない）", () => {
    const 前の版 = { entries: [{ at: いま.toISOString(), place: "kakuyomu.jp", shape: "/my", did: "stats", posted: false }] };
    expect(PressLog.normalizeLog(前の版).entries).toHaveLength(1);
    // 保存の中で札が書き換えられていても、札だけ捨てて行は残す
    const 壊れた = { entries: [{ at: いま.toISOString(), place: "kakuyomu.jp", shape: "/my", did: "stats", result: "done", reason: "本文の字" }] };
    const 読んだ = PressLog.normalizeLog(壊れた).entries;
    expect(読んだ).toHaveLength(1);
    expect(読んだ[0].result).toBe("done");
    expect("reason" in 読んだ[0]).toBe(false);
  });

  it("ページ側の結果があとから届いたら、同じ押しの1件（結果待ち）だけを直す。見つからなければ何もしない", () => {
    let 記録 = PressLog.normalizeLog(undefined);
    記録 = PressLog.addPress(記録, { url: "https://kakuyomu.jp/my/works/1/episodes/new", did: "fill", result: "waiting", id: "abcd1234" }, 名を残す, いま);
    記録 = PressLog.addPress(記録, { url: "https://kakuyomu.jp/my/works/2", did: "stats", result: "done" }, 名を残す, いま);
    const 直した = PressLog.settleResult(記録, "abcd1234", false, "fields-not-found");
    expect(直した.entries[0]).toMatchObject({ result: "stopped", reason: "fields-not-found" });
    expect(直した.entries[1]).toMatchObject({ result: "done" });
    // 2回目は直さない（結果待ちでなくなった）
    expect(PressLog.settleResult(直した, "abcd1234", true).entries[0].result).toBe("stopped");
    // 知らない鍵・形の違う鍵なら、そのまま
    expect(PressLog.settleResult(記録, "zzzz9999", true)).toEqual(記録);
    expect(PressLog.settleResult(記録, "ABC", true)).toEqual(記録);
    // 済んだら札は付けない
    expect("reason" in PressLog.settleResult(記録, "abcd1234", true, "fields-not-found").entries[0]).toBe(false);
  });

  it("説明のページには、札を生で出さず日本語の名前で出す", () => {
    const 記録 = PressLog.addPress(
      PressLog.normalizeLog(undefined),
      { url: "https://kakuyomu.jp/my/works/1/episodes/new", did: "fill", result: "stopped", reason: "clipboard-read" },
      名を残す,
      いま
    );
    const 字 = PressLog.formatLog(記録);
    expect(字).toContain("止めた");
    expect(字).toContain(PressLog.REASON_LABELS["clipboard-read"]);
    expect(字).not.toContain("clipboard-read");
  });

  it("札の表は英小文字・数字・ハイフンだけで、どれにも日本語の名前がある", () => {
    for (const [札, 名] of Object.entries(PressLog.REASON_LABELS)) {
      expect(札).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
      expect(名.length).toBeGreaterThan(0);
    }
  });
});
