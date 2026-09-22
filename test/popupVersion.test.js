import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const 読む = (名) => readFileSync(join(ルート, 名), "utf8");

/**
 * ポップアップに出す版の札（作者の依頼、2026-09-22
 * 「開いたときにバージョンがわかるようどこか邪魔にならないところに」）。
 *
 * **狙いは「入れ直しが効いたか」を開いた瞬間に見分けること。**
 * だから札が古い版を言い続けたら、無いより悪い——版を手で書き写して
 * いないことを、ここで見張る。
 */
describe("ポップアップの版の札", () => {
  it("札の置き場が popup.html にある", () => {
    const html = 読む("popup.html");
    expect(html).toMatch(/id="version"/);
  });

  it("札の字は HTML に書かれていない（空のまま置く）", () => {
    const html = 読む("popup.html");
    const 札 = html.match(/<span id="version"[^>]*>([\s\S]*?)<\/span>/);
    expect(札).not.toBeNull();
    expect(札[1].trim()).toBe("");
  });

  it("popup.js が manifest から版を読む", () => {
    const js = 読む("popup.js");
    expect(js).toMatch(/chrome\.runtime\.getManifest\(\)\.version/);
  });

  // **写しを作っていないことの見張り。**
  // popup.js に版の数字が直書きされたら、上げた日に画面だけが古くなる
  it("popup.js にも popup.html にも版の数字が直書きされていない", () => {
    const 版 = JSON.parse(読む("manifest.json")).version;
    expect(版).toMatch(/^\d+\.\d+\.\d+$/);
    expect(読む("popup.js")).not.toContain(版);
    expect(読む("popup.html")).not.toContain(版);
  });

  it("manifest.json と package.json の版が揃っている", () => {
    expect(JSON.parse(読む("manifest.json")).version).toBe(
      JSON.parse(読む("package.json")).version
    );
  });
});
