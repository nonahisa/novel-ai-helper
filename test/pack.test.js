import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { pack, 読み込まれるファイル } from "../scripts/pack.mjs";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Chrome ウェブストアへ上げる zip（scripts/pack.mjs）の中身を確かめる。
 *
 * 手元ではフォルダーをそのまま読み込むので、zip に入れ忘れたファイルがあっても気づけない。
 * ストアから入れた方だけが動かない、を避けるために、作った zip を開いて一覧を見る。
 * 開くのは下の小さな読み手で、作る側（pack.mjs）の書き方を写していない——書き損じがあれば、ここで読めずに落ちる。
 */

/** zip の目録を読み、名前と中身（展開したもの）を返す。 */
function zipを開く(buf) {
  // 終わりの印（EOCD）は末尾から探す
  let 終わり = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      終わり = i;
      break;
    }
  }
  if (終わり < 0) {
    throw new Error("zip の終わりの印がありません");
  }
  const 件数 = buf.readUInt16LE(終わり + 10);
  let p = buf.readUInt32LE(終わり + 16);
  const 項目 = [];
  for (let n = 0; n < 件数; n++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const 方式 = buf.readUInt16LE(p + 10);
    const 縮めた大きさ = buf.readUInt32LE(p + 20);
    const 名前の長さ = buf.readUInt16LE(p + 28);
    const 余白 = buf.readUInt16LE(p + 30);
    const 注記 = buf.readUInt16LE(p + 32);
    const 頭の位置 = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + 名前の長さ);
    expect(buf.readUInt32LE(頭の位置)).toBe(0x04034b50);
    const 頭の名前 = buf.readUInt16LE(頭の位置 + 26);
    const 頭の余白 = buf.readUInt16LE(頭の位置 + 28);
    const 始め = 頭の位置 + 30 + 頭の名前 + 頭の余白;
    const 中身 = buf.subarray(始め, 始め + 縮めた大きさ);
    const data = 方式 === 8 ? inflateRawSync(中身) : Buffer.from(中身);
    項目.push({ name, data });
    p += 46 + 名前の長さ + 余白 + 注記;
  }
  return 項目;
}

describe("配布用の zip（scripts/pack.mjs）", () => {
  let 置き場;
  let 結果;
  let 項目;

  beforeAll(() => {
    // dist/ ではなく使い捨ての場所へ作る（テストのたびに手元の配布物を書き換えない）
    置き場 = mkdtempSync(join(tmpdir(), "nph-pack-"));
    結果 = pack({ 出力先: 置き場 });
    項目 = zipを開く(readFileSync(結果.zipPath));
  });

  afterAll(() => {
    rmSync(置き場, { recursive: true, force: true });
  });

  it("zip の名前の版は manifest の版と同じ", () => {
    const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
    expect(basename(結果.zipPath)).toBe(`novel-ai-helper-${manifest.version}.zip`);
    expect(結果.version).toBe(manifest.version);
  });

  it("manifest.json は zip の直下にあり、中の版も zip の名前と同じ", () => {
    const m = 項目.find((i) => i.name === "manifest.json");
    expect(m).toBeDefined();
    expect(JSON.parse(m.data.toString("utf8")).version).toBe(結果.version);
  });

  it("テスト・依存・ストアの材料・説明の文書・npm の設定は入っていない", () => {
    const 名前 = 項目.map((i) => i.name);
    for (const n of 名前) {
      expect(n.startsWith("test/"), n).toBe(false);
      expect(n.startsWith("node_modules/"), n).toBe(false);
      expect(n.startsWith("store/"), n).toBe(false);
      expect(n.startsWith("scripts/"), n).toBe(false);
      expect(n.startsWith("dist/"), n).toBe(false);
      expect(n.startsWith("."), n).toBe(false);
      expect(n.includes("/."), n).toBe(false);
      expect(n.includes("\\"), n).toBe(false);
    }
    for (const 入れない of ["README.md", "PRIVACY.md", "package.json", "package-lock.json", ".gitignore"]) {
      expect(名前, 入れない).not.toContain(入れない);
    }
  });

  it("入れてよいのは、拡張の実行に要る場所のものだけ", () => {
    const 許す = /^(manifest\.json|background\.js|offscreen\.[a-z]+|options\.[a-z]+|common\/.+|content\/.+|icons\/.+)$/;
    for (const i of 項目) {
      expect(許す.test(i.name), i.name).toBe(true);
    }
  });

  it("manifest・拡張のページ・裏方が読み込むファイルは、1つ残らず入っている", () => {
    const 名前 = 項目.map((i) => i.name);
    const 要る = 読み込まれるファイル(ルート);
    // 一覧づくりそのものが空振りしていないこと（裏方・ページ・ページへ入るファイル・アイコン）
    for (const 必ず of ["background.js", "options.html", "options.js", "offscreen.js", "content/read.js", "common/history.js", "icons/icon128.png"]) {
      expect(要る, 必ず).toContain(必ず);
    }
    for (const f of 要る) {
      expect(名前, f).toContain(f);
    }
  });

  it("zip の中身は、手元のファイルと1バイトも違わない", () => {
    expect(項目.length).toBe(結果.files.length);
    for (const i of 項目) {
      expect(i.data.equals(readFileSync(join(ルート, i.name))), i.name).toBe(true);
    }
  });

  it("同じ中身なら、作り直しても同じ zip になる", () => {
    const 二度目の置き場 = mkdtempSync(join(tmpdir(), "nph-pack-"));
    try {
      const 二度目 = pack({ 出力先: 二度目の置き場 });
      expect(readFileSync(二度目.zipPath).equals(readFileSync(結果.zipPath))).toBe(true);
    } finally {
      rmSync(二度目の置き場, { recursive: true, force: true });
    }
  });
});
