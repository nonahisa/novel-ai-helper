import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNGを書く, PNGを読む, ストアのアイコン, 撮影用のページ, 白に重ねる } from "../scripts/storeImages.mjs";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Chrome ウェブストアの画像を作る道具（scripts/storeImages.mjs）のうち、ブラウザを呼ばずに確かめられるところ。
 * 撮影そのもの（Edge のヘッドレス）はテストで走らせない——手元にブラウザが無い環境でも `npm test` が通るように。
 */
describe("撮影用の代役が、本番の説明のページに紛れ込まない", () => {
  it("本物の options.html は、撮影の部品を読み込まない", () => {
    const 本物 = readFileSync(join(ルート, "options.html"), "utf8");
    expect(本物).not.toMatch(/store\/shoot|stub\.js/);
    expect(本物).not.toMatch(/<base\b/);
  });

  it("撮影用の写しは、options.js の前に集計の組み立て・溜まりの上限・代役を読み込む", () => {
    const 本物 = readFileSync(join(ルート, "options.html"), "utf8");
    const 写し = 撮影用のページ(本物, "file:///example/");
    expect(写し).toContain('<base href="file:///example/" />');
    const 位置 = (s) => 写し.indexOf(s);
    expect(位置('<script src="common/history.js">')).toBeGreaterThan(0);
    expect(位置('<script src="common/history.js">')).toBeLessThan(位置('<script src="common/stash.js">'));
    expect(位置('<script src="common/stash.js">')).toBeLessThan(位置('<script src="store/shoot/stub.js">'));
    expect(位置('<script src="store/shoot/stub.js">')).toBeLessThan(位置('<script src="options.js">'));
  });

  it("options.html の形が変わって差し込めないときは、黙って撮らずに止める", () => {
    expect(() => 撮影用のページ("<!doctype html><p>別の形</p>", "file:///example/")).toThrow(/差し込めません/);
  });
});

describe("PNG の読み書き", () => {
  it("書いたものを読むと同じ画素に戻る（透過あり・なし）", () => {
    const 画素 = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255]);
    const 絵 = { 幅: 2, 高さ: 2, 画素 };
    expect(PNGを読む(PNGを書く(絵, true)).画素.equals(画素)).toBe(true);
    const 白 = 白に重ねる(絵);
    const 戻した = PNGを読む(PNGを書く(白, false));
    expect(戻した.幅).toBe(2);
    expect(戻した.画素.equals(白.画素)).toBe(true);
    // 透明な画素は白になる
    expect([...戻した.画素.subarray(8, 12)]).toEqual([255, 255, 255, 255]);
  });
});

describe("ストアの一覧用のアイコン", () => {
  it("128×128 で、絵は 96×96、周りの 16px は透明（manifest のアイコンは元のまま）", () => {
    const 元 = readFileSync(join(ルート, "icons", "icon128.png"));
    const 絵 = PNGを読む(ストアのアイコン(元));
    expect([絵.幅, 絵.高さ]).toEqual([128, 128]);
    const 透過 = (x, y) => 絵.画素[(y * 128 + x) * 4 + 3];
    for (const [x, y] of [[0, 0], [15, 15], [127, 127], [112, 64], [64, 15]]) {
      expect(透過(x, y), `${x},${y}`).toBe(0);
    }
    for (const [x, y] of [[16, 16], [111, 111], [64, 64]]) {
      expect(透過(x, y), `${x},${y}`).toBe(255);
    }
    // manifest が指すアイコンは 128×128 のまま（縮めた版は別のファイル）
    expect(PNGを読む(元).幅).toBe(128);
    const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
    expect(manifest.icons["128"]).toBe("icons/icon128.png");
  });
});
