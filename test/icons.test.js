import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNGを読む } from "../scripts/storeImages.mjs";
import { ツールバーの大きさ, 切り出す, 透過を戻す } from "../scripts/icons.mjs";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));

/**
 * ツールバー用のアイコン（0.12.2）。
 *
 * 一覧用のアイコン（濃い角丸の四角に白い絵）をツールバーにも使っていたところ、四角の中の絵が 10px ほどになり、
 * ほかの拡張より小さく見えた。ツールバー用だけ四角を外し、絵を枠いっぱいに描いたものに替えた。
 * 撮り直し（`npm run icons`）で四角が戻ったり、絵が小さくなったりしたら、ここで気づけるようにする。
 * 撮影そのもの（Edge のヘッドレス）はテストで走らせない——手元にブラウザが無い環境でも `npm test` が通るように。
 */
describe("ツールバー用のアイコン", () => {
  it("manifest のツールバーはツールバー用を指し、一覧用（icons）は統合小説執筆環境と同じ四角のまま", () => {
    expect(manifest.action.default_icon).toEqual(
      Object.fromEntries(ツールバーの大きさ.map((n) => [String(n), `icons/toolbar${n}.png`]))
    );
    expect(manifest.icons).toEqual({
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    });
    // 元の絵も一緒に置く（撮り直せるように）
    expect(existsSync(join(ルート, "icons", "toolbar.svg"))).toBe(true);
  });

  for (const n of ツールバーの大きさ) {
    describe(`toolbar${n}.png`, () => {
      const 絵 = PNGを読む(readFileSync(join(ルート, "icons", `toolbar${n}.png`)));
      const 透過 = (x, y) => 絵.画素[(y * n + x) * 4 + 3];
      const 明るさ = (x, y) => 絵.画素[(y * n + x) * 4 + 1];

      it(`${n}×${n} で、四角が無い（左上の角と、左上の広い範囲が透明）`, () => {
        expect([絵.幅, 絵.高さ]).toEqual([n, n]);
        // ペンは左下から右上へ斜めに置くので、左上の三角は何も無い
        const 左上 = Math.floor(n / 4);
        for (let y = 0; y < 左上; y++) {
          for (let x = 0; x < 左上 - y; x++) {
            expect(透過(x, y), `${x},${y}`).toBe(0);
          }
        }
      });

      it("絵が枠いっぱい（見えている画素の広がりが、縦横とも枠の 85% 以上）", () => {
        let 左 = n;
        let 右 = -1;
        let 上端 = n;
        let 下端 = -1;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            if (透過(x, y) > 128) {
              左 = Math.min(左, x);
              右 = Math.max(右, x);
              上端 = Math.min(上端, y);
              下端 = Math.max(下端, y);
            }
          }
        }
        expect(右 - 左 + 1).toBeGreaterThanOrEqual(Math.ceil(n * 0.85));
        expect(下端 - 上端 + 1).toBeGreaterThanOrEqual(Math.ceil(n * 0.85));
      });

      it("濃い線と白い縁の両方がある（明るいツールバーでも暗いツールバーでも見えるように）", () => {
        let 濃い = 0;
        let 白い = 0;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            if (透過(x, y) < 250) continue;
            if (明るさ(x, y) < 80) 濃い++;
            if (明るさ(x, y) > 230) 白い++;
          }
        }
        // 16px で濃い画素が 80 ほど、白い画素が 50 ほど（0.12.2）。どちらかが消えたら（片方の地で見えなくなったら）落ちる
        expect(濃い).toBeGreaterThanOrEqual((n * n) / 8);
        expect(白い).toBeGreaterThanOrEqual((n * n) / 8);
      });
    });
  }
});

describe("撮った2枚から透過を戻す（scripts/icons.mjs）", () => {
  /** 1色の絵を、指定の透過で黒い地・白い地に重ねたものを作る。 */
  const 重ねる = (色, a, 地) => ({
    幅: 1,
    高さ: 1,
    画素: Buffer.from([...色.map((c) => Math.round(c * a + 地 * (1 - a))), 255]),
  });

  it("不透明・半透明・透明を、色と透過に戻す", () => {
    for (const [色, a] of [
      [[34, 39, 51], 1],
      [[255, 255, 255], 1],
      [[34, 39, 51], 0.5],
      [[255, 255, 255], 0.25],
      [[0, 0, 0], 0],
    ]) {
      const 戻した = 透過を戻す(重ねる(色, a, 0), 重ねる(色, a, 255));
      expect(Math.abs(戻した.画素[3] - Math.round(a * 255)), `透過 ${a}`).toBeLessThanOrEqual(1);
      if (a > 0) {
        for (let k = 0; k < 3; k++) {
          expect(Math.abs(戻した.画素[k] - 色[k]), `色 ${色} 透過 ${a}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("大きさの違う2枚は止める", () => {
    const 一 = { 幅: 1, 高さ: 1, 画素: Buffer.alloc(4) };
    const 二 = { 幅: 2, 高さ: 1, 画素: Buffer.alloc(8) };
    expect(() => 透過を戻す(一, 二)).toThrow(/大きさが違います/);
  });

  it("切り出しは、左上から指定の大きさを取る", () => {
    // 3×3 の絵の画素に、位置の番号を入れておく
    const 画素 = Buffer.alloc(3 * 3 * 4);
    for (let i = 0; i < 9; i++) 画素[i * 4] = i;
    const 取った = 切り出す({ 幅: 3, 高さ: 3, 画素 }, 1, 1, 2);
    expect([0, 1, 2, 3].map((i) => 取った.画素[i * 4])).toEqual([4, 5, 7, 8]);
  });
});
