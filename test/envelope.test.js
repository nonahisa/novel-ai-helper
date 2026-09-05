import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

// 拡張機能側のファイルは、ブラウザでそのまま読める素のスクリプト（ビルド工程なし）。
// テストからは Node の require で読む。
const require = createRequire(import.meta.url);
const { parseEnvelope } = require("../common/envelope.js");

/** 正しい封筒（母艦側と同じ形）。 */
function 正しい封筒(上書き = {}) {
  return JSON.stringify(
    Object.assign(
      {
        "novelai-post": 1,
        site: "kakuyomu",
        workId: "16816927859000000000",
        title: "第13話 星の落ちる夜",
        body: "　彼は空を見上げた。\n\n　そして、何も言わなかった。",
      },
      上書き
    )
  );
}

describe("封筒の読み取り", () => {
  it("正しい封筒を読める", () => {
    const result = parseEnvelope(正しい封筒());
    expect(result.ok).toBe(true);
    expect(result.envelope.site).toBe("kakuyomu");
    expect(result.envelope.workId).toBe("16816927859000000000");
    expect(result.envelope.title).toBe("第13話 星の落ちる夜");
    expect(result.envelope.body).toContain("彼は空を見上げた");
  });

  it("余分な欄は無視して読む（母艦が新しい欄を足しても壊れない）", () => {
    const text = JSON.stringify({
      "novelai-post": 1,
      site: "kakuyomu",
      title: "題",
      body: "本文",
      caption: "前書き",
      未来の欄: { なにか: 1 },
    });
    const result = parseEnvelope(text);
    expect(result.ok).toBe(true);
    expect(result.envelope).toEqual({ site: "kakuyomu", title: "題", body: "本文" });
  });

  it("クリップボードが空なら断る", () => {
    expect(parseEnvelope("").reason).toBe("empty");
    expect(parseEnvelope("   \n ").reason).toBe("empty");
    expect(parseEnvelope(undefined).reason).toBe("empty");
  });

  it("ただの本文をコピーしていたら断る", () => {
    const result = parseEnvelope("　彼は空を見上げた。そして、何も言わなかった。");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-json");
  });

  it("JSONではあるが封筒でなければ断る", () => {
    expect(parseEnvelope('{"foo":1}').reason).toBe("not-envelope");
    expect(parseEnvelope("[1,2,3]").reason).toBe("not-object");
    expect(parseEnvelope("null").reason).toBe("not-object");
  });

  it("版数が1でなければ断る（知らない版を推測で読まない）", () => {
    const result = parseEnvelope(正しい封筒({ "novelai-post": 2 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-version");
    expect(result.detail).toBe("2");
    // 文字列の "1" も版数としては認めない（形が変わったということなので）。
    expect(parseEnvelope(正しい封筒({ "novelai-post": "1" })).reason).toBe("bad-version");
  });

  it("知らないサイトの封筒は断る", () => {
    const result = parseEnvelope(正しい封筒({ site: "pixiv" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-site");
    expect(result.detail).toBe("pixiv");
  });

  it("なろう宛ての封筒は、封筒としては正しく読める（貼り込むかは照合側の判断）", () => {
    const result = parseEnvelope(正しい封筒({ site: "narou", workId: "n1234ab" }));
    expect(result.ok).toBe(true);
    expect(result.envelope.site).toBe("narou");
  });

  it("本文が空の封筒は断る（空で上書きする事故を防ぐ）", () => {
    expect(parseEnvelope(正しい封筒({ body: "" })).reason).toBe("bad-body");
    expect(parseEnvelope(正しい封筒({ body: 123 })).reason).toBe("bad-body");
  });

  it("タイトルは空でもよいが、文字列でなければ断る", () => {
    expect(parseEnvelope(正しい封筒({ title: "" })).ok).toBe(true);
    expect(parseEnvelope(正しい封筒({ title: null })).reason).toBe("bad-title");
  });

  it("workId は任意。無ければ持たない", () => {
    const text = JSON.stringify({ "novelai-post": 1, site: "kakuyomu", title: "題", body: "本文" });
    const result = parseEnvelope(text);
    expect(result.ok).toBe(true);
    expect("workId" in result.envelope).toBe(false);
  });

  it("workId の空文字は「無い」と同じに扱う（照合をすり抜けさせない）", () => {
    const result = parseEnvelope(正しい封筒({ workId: "  " }));
    expect(result.ok).toBe(true);
    expect(result.envelope.workId).toBeUndefined();
  });

  it("workId が数値でも文字列として受ける（台帳が数字でIDを持つ場合）", () => {
    const result = parseEnvelope(正しい封筒({ workId: 1177354 }));
    expect(result.ok).toBe(true);
    expect(result.envelope.workId).toBe("1177354");
  });

  it("workId が文字列でも数値でもなければ断る", () => {
    expect(parseEnvelope(正しい封筒({ workId: { id: 1 } })).reason).toBe("bad-workId");
  });
});
