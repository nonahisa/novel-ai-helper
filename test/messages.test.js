import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Messages = require("../common/messages.js");

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const 読む = (名) => readFileSync(join(ルート, 名), "utf8");

/**
 * 画面に出す作品IDの形（0.12.1。common/messages.js の displayWorkId・workLabel）。
 *
 * Narou.fun は大文字の Nコード（db.narou.fun/works/N1234AB）でしか作品のページを開かず、
 * 小文字だとなろう本体へ転送される（2026-09-23 に確かめた）。だから**見せるのは大文字**。
 * 保存・照合・受け渡しの値は小文字に揃えたまま（common/stash.js の normalizeWorkId）で、
 * ここを通すのは見せるときだけ。
 *
 * 数字・作品ID・Nコードはすべて架空。
 */
describe("作品IDの見せ方", () => {
  it("Narou.fun の Nコードは大文字にする（小文字で覚えていても）", () => {
    expect(Messages.displayWorkId("narouFun", "n1234ab")).toBe("N1234AB");
    expect(Messages.displayWorkId("narouFun", "N1234AB")).toBe("N1234AB");
  });

  it("カクヨムの作品IDは、そのまま", () => {
    expect(Messages.displayWorkId("kakuyomu", "1177354054934570000")).toBe("1177354054934570000");
  });

  it("知らせと説明のページの「〇〇の作品 …」も同じ形", () => {
    expect(Messages.workLabel("narouFun", "n1234ab")).toBe("Narou.fun の作品 N1234AB");
    expect(Messages.workLabel("kakuyomu", "1177354054934570000")).toBe("カクヨムの作品 1177354054934570000");
    expect(Messages.approveQuestion("narouFun", "n1234ab").message).toContain("Narou.fun の作品 N1234AB");
    expect(Messages.messageForApproved("narouFun", "n1234ab", null)).toContain("Narou.fun の作品 N1234AB");
  });

  it("溜まりの一覧の1行も、Nコードは大文字", () => {
    const 行 = Messages.describeStashItem({
      siteId: "narouFun",
      pageLabel: "作品のページ",
      workId: "n1234ab",
      storedAt: "2026-09-23T04:00:00.000Z",
      counts: { work: 1 },
    });
    expect(行).toContain("N1234AB");
    expect(行).not.toContain("n1234ab");
  });
});

describe("説明のページは、見せ方を common/messages.js から引く", () => {
  it("options.html は common/messages.js を options.js より先に読む", () => {
    const html = 読む("options.html");
    const 文言 = html.indexOf('<script src="common/messages.js"></script>');
    const 本体 = html.indexOf('<script src="options.js"></script>');
    expect(文言).toBeGreaterThan(0);
    expect(文言).toBeLessThan(本体);
  });

  it("覚えた作品の Nコードの欄へは、見せる形（displayWorkId）で入れる", () => {
    const js = 読む("options.js");
    const 欄へ入れる = js.slice(js.indexOf('欄("own-narou").value'), js.indexOf('欄("own-kakuyomu").value'));
    expect(欄へ入れる).toContain("displayWorkId");
    // 見せ方の決まりを options.js に写さない（2か所が食い違った日に、画面ごとに形が変わる）
    expect(js).not.toMatch(/toUpperCase/);
  });

  it("入力欄の例も大文字", () => {
    expect(読む("options.html")).toContain("例：N1234AB");
  });
});
