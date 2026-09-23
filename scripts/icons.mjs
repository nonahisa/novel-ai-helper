/**
 * ツールバー用のアイコンを、icons/toolbar.svg から作る（`npm run icons`）。
 *
 * 作るもの：icons/toolbar16.png・toolbar24.png・toolbar32.png（manifest の action.default_icon）。
 * ストアや拡張機能の一覧に出る大きいアイコン（manifest の icons、icon16〜128.png）は作らない・変えない。
 *
 * - 16 は等倍の画面、32 は2倍の画面、24 は1.5倍の画面（Windows でよくある 150%）のため。
 *   24 が無いと Chrome は 32 を縮めて使い、線が滲む
 *
 * ## 作り方
 *
 * scripts/storeImages.mjs と同じく、手元の Edge（無ければ Chrome）をヘッドレスで呼んで撮る。**外の依存を足さない。**
 * ブラウザの場所は環境変数 STORE_IMAGES_BROWSER で指定もできる。
 *
 * - SVG を、それぞれの大きさそのままで（拡大率 1 で）描かせて撮る。大きく描いて縮めると、
 *   16px で1画素に合わせた縁やキーがぼやける
 * - ヘッドレスの撮影は透明な地を残せないことがあるので、**同じ絵を黒い地と白い地の上に描いて撮り、
 *   2つの差から透過を戻す**（黒の上で c·a、白の上で c·a + 255·(1−a) になるので、差が 255·(1−a)）
 *
 * ## ファイルの拡張子を .mjs にしている理由
 *
 * scripts/pack.mjs と同じ。拡張の中身ではないので、test/redLine.test.js の走査の対象（.js など）に入れない。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNGを書く, PNGを読む, ブラウザを探す, 撮る } from "./storeImages.mjs";

const ルート = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 作る大きさ。manifest の action.default_icon と揃える（test/actions.test.js が見張る）。 */
export const ツールバーの大きさ = [16, 24, 32];

/** 撮影のページの中での、それぞれの大きさの置き場（左上）。黒い地は上の段、白い地は下の段。 */
const 段の高さ = 60;
const 置き場 = { 16: 10, 24: 40, 32: 80 };
const 上 = 10;

/**
 * 黒い地と白い地の上に撮った同じ絵から、透過のある絵を戻す。
 * 黒の上：c·a、白の上：c·a + 255·(1−a) なので、a = 1 − (白 − 黒)/255、c = 黒 / a。
 * 3色の差の平均を使う（色ごとの丸めの揺れをならす）。
 */
export function 透過を戻す(黒の上, 白の上) {
  if (黒の上.幅 !== 白の上.幅 || 黒の上.高さ !== 白の上.高さ) {
    throw new Error("黒い地と白い地の絵の大きさが違います");
  }
  const 画素 = Buffer.alloc(黒の上.幅 * 黒の上.高さ * 4);
  for (let i = 0; i < 画素.length; i += 4) {
    let 差 = 0;
    for (let k = 0; k < 3; k++) {
      差 += Math.max(0, 白の上.画素[i + k] - 黒の上.画素[i + k]);
    }
    const a = Math.min(1, Math.max(0, 1 - 差 / 3 / 255));
    const A = Math.round(a * 255);
    for (let k = 0; k < 3; k++) {
      画素[i + k] = A === 0 ? 0 : Math.min(255, Math.round(黒の上.画素[i + k] / a));
    }
    画素[i + 3] = A;
  }
  return { 幅: 黒の上.幅, 高さ: 黒の上.高さ, 画素 };
}

/** 撮った絵から、左上 (x, y) の 大きさ×大きさ を切り出す。 */
export function 切り出す(絵, x, y, 大きさ) {
  const 画素 = Buffer.alloc(大きさ * 大きさ * 4);
  for (let dy = 0; dy < 大きさ; dy++) {
    絵.画素.copy(画素, dy * 大きさ * 4, ((y + dy) * 絵.幅 + x) * 4, ((y + dy) * 絵.幅 + x + 大きさ) * 4);
  }
  return { 幅: 大きさ, 高さ: 大きさ, 画素 };
}

/** 撮影のページ。上の段が黒い地、下の段が白い地で、同じ SVG をそれぞれの大きさで並べる。 */
function 撮影のページ(SVGのURL) {
  const 絵 = (地の上) =>
    ツールバーの大きさ
      .map(
        (n) =>
          `<img src="${SVGのURL}" width="${n}" height="${n}" style="position:absolute;left:${置き場[n]}px;top:${地の上 + 上}px" />`
      )
      .join("\n");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8" />',
    "<style>html,body{margin:0;padding:0;background:#000}</style></head><body>",
    `<div style="position:absolute;left:0;top:0;width:400px;height:${段の高さ}px;background:#000"></div>`,
    `<div style="position:absolute;left:0;top:${段の高さ}px;width:400px;height:${段の高さ}px;background:#fff"></div>`,
    絵(0),
    絵(段の高さ),
    "</body></html>",
  ].join("\n");
}

async function main() {
  const ブラウザ = ブラウザを探す();
  const 作業場 = mkdtempSync(join(tmpdir(), "nph-icons-"));
  try {
    const ページ = join(作業場, "icons-shoot.html");
    writeFileSync(ページ, 撮影のページ(pathToFileURL(join(ルート, "icons", "toolbar.svg")).href));
    const 撮った = join(作業場, "shot.png");
    console.log(`撮るブラウザ：${ブラウザ}`);
    await 撮る(ブラウザ, 作業場, pathToFileURL(ページ).href, 撮った, { 幅: 400, 高さ: 段の高さ * 2 + 20, 倍率: 1 });
    const 全体 = PNGを読む(readFileSync(撮った));
    for (const n of ツールバーの大きさ) {
      const 黒 = 切り出す(全体, 置き場[n], 上, n);
      const 白 = 切り出す(全体, 置き場[n], 段の高さ + 上, n);
      const 絵 = 透過を戻す(黒, 白);
      // 四隅は透明のはず（四角を外した絵）。撮影の位置がずれて地を拾ったら、黙って変な絵を置かずに止める
      for (const [x, y] of [[0, 0], [n - 1, 0]]) {
        if (絵.画素[(y * n + x) * 4 + 3] !== 0) {
          throw new Error(`toolbar${n}.png の角 (${x}, ${y}) が透明ではありません。撮影の位置がずれています`);
        }
      }
      writeFileSync(join(ルート, "icons", `toolbar${n}.png`), PNGを書く(絵, true));
      console.log(`作りました：icons/toolbar${n}.png（${n}×${n}、透明な地）`);
    }
  } finally {
    try {
      rmSync(作業場, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      // 一時フォルダーの中なので、残っても害は無い
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  });
}
