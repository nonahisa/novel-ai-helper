import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const 読む = (名) => readFileSync(join(ルート, 名), "utf8");

/**
 * 説明のページに出す版の札（作者の依頼、2026-09-22
 * 「開いたときにバージョンがわかるようどこか邪魔にならないところに」）。
 * 0.7.x まではポップアップの見出しにあった。0.8.0 でポップアップを外したので、
 * 「この拡張がしないこと」と一緒に説明のページ（options.html）へ移した。
 *
 * **狙いは「入れ直しが効いたか」を見分けること。**
 * だから札が古い版を言い続けたら、無いより悪い——版を手で書き写して
 * いないことを、ここで見張る。
 */
describe("説明のページの版の札", () => {
  it("札の置き場が options.html にある", () => {
    const html = 読む("options.html");
    expect(html).toMatch(/id="version"/);
  });

  it("札の字は HTML に書かれていない（空のまま置く）", () => {
    const html = 読む("options.html");
    const 札 = html.match(/<span id="version"[^>]*>([\s\S]*?)<\/span>/);
    expect(札).not.toBeNull();
    expect(札[1].trim()).toBe("");
  });

  it("options.js が manifest から版を読む", () => {
    const js = 読む("options.js");
    expect(js).toMatch(/chrome\.runtime\.getManifest\(\)\.version/);
  });

  // **写しを作っていないことの見張り。**
  // options.js に版の数字が直書きされたら、上げた日に画面だけが古くなる
  it("options.js にも options.html にも版の数字が直書きされていない", () => {
    const 版 = JSON.parse(読む("manifest.json")).version;
    expect(版).toMatch(/^\d+\.\d+\.\d+$/);
    expect(読む("options.js")).not.toContain(版);
    expect(読む("options.html")).not.toContain(版);
  });

  it("manifest.json と package.json の版が揃っている", () => {
    expect(JSON.parse(読む("manifest.json")).version).toBe(
      JSON.parse(読む("package.json")).version
    );
  });

  it("説明のページが manifest の options_ui に登録されている", () => {
    const manifest = JSON.parse(読む("manifest.json"));
    expect(manifest.options_ui && manifest.options_ui.page).toBe("options.html");
  });
});

/**
 * 版を上げたときに、文書の版もそろえたか（引継ぎ書2章の3。CLAUDE.md の「絶対に守ること」の5）。
 * manifest の版を正として、設計書の version 行・引継ぎ書の「いまの状態」の版・README の「その版から」の段落を見る。
 */
describe("文書の版が manifest とそろっている", () => {
  const 版 = () => JSON.parse(読む("manifest.json")).version;

  it("設計書の3行目の version 行", () => {
    const 行 = 読む("docs/設計書.md").split(/\r?\n/).find((l) => /^version \d+\.\d+\.\d+ \//.test(l));
    expect(行, "設計書に「version X.Y.Z / 日付」の行が無い").toBeTruthy();
    expect(/^version (\d+\.\d+\.\d+)/.exec(行)[1]).toBe(版());
  });

  it("引継ぎ書の「いまの状態」の表の版の行", () => {
    const 行 = 読む("docs/進捗と引継ぎ.md").split(/\r?\n/).find((l) => l.startsWith("| 版 |"));
    expect(行, "引継ぎ書に「| 版 |」の行が無い").toBeTruthy();
    expect(/\*\*(\d+\.\d+\.\d+)\*\*/.exec(行)[1]).toBe(版());
  });

  it("README に、いまの版から何が変わったかの段落がある", () => {
    expect(読む("README.md")).toContain(`${版()} から`);
  });
});
