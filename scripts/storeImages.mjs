/**
 * Chrome ウェブストアへ出す画像を、実物の画面から作る（`npm run store:images`）。
 *
 * 作るもの（`store/images/` に置く。台本は store/screenshots.md）
 *   - screenshot-1〜5.png … 1280×800。説明のページ（本物の options.html・options.js）を、
 *                            chrome API の代役（store/shoot/stub.js）と架空の作品の見本で開いて撮る
 *   - tile-small.png       … 440×280。小さなプロモーション タイル（store/shoot/tile.html を撮る）
 *   - icon128-store.png    … 128×128。icons/icon128.png を 96×96 に縮め、周りに 16px の透明な余白を付けたもの
 *                            （Google の推奨の形。manifest のアイコンは変えない）
 *
 * ## 撮り方
 *
 * 手元の Edge（無ければ Chrome）をヘッドレスで呼び、`--screenshot` で撮る。**外の依存を足さない**
 * （この拡張は npm をテストのためだけに使う。撮影のために大きなパッケージを入れない）。
 * ブラウザの場所は環境変数 STORE_IMAGES_BROWSER で指定もできる。
 *
 * - 説明のページは**本物の options.html を書き換えない**。写しを使い捨ての場所（OS の一時フォルダー）に作り、
 *   `<base>` で拡張のフォルダーを指して、`options.js` の前に代役を差し込む。写しをリポジトリの中に置かないのは、
 *   test/redLine.test.js が .html を走査するため（写しには外へのリンクが入っており、「外へのリンクは1本だけ」が落ちる）
 * - 画面の拡大率は 125%（1024×640 の画面を 1280×800 で撮る）。台本の「字が小さいときは 110〜125%」に合わせた。
 *   新しいヘッドレスは窓の枠のぶん狭い幅でページを組むので、代役がページの幅を 1024px に合わせる（stub.js の注）
 * - ストアは透過のある PNG を受け付けないことがあるので（スクリーンショットとタイルは「24ビットの PNG」）、
 *   撮ったあとで白の上に重ねて透過を落とす。大きさが合わなければ止める
 *
 * ## Edge の起動の癖
 *
 * Windows の msedge.exe は、呼ぶとすぐ戻り、撮影は別のプロセスが続ける（戻った時点ではまだ画像が無い）。
 * そのため、画像が出来て大きさが落ち着くまで待つ。
 *
 * ## ファイルの拡張子を .mjs にしている理由
 *
 * scripts/pack.mjs と同じ。拡張の中身ではないので、test/redLine.test.js の走査の対象（.js など）に入れない。
 */
import { spawn } from "node:child_process";
import { deflateSync, inflateSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ルート = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const 出力先 = join(ルート, "store", "images");

/**
 * 撮るスクリーンショット（store/screenshots.md の台本の順）。
 * `at` は、画面の上端に来るものを CSS の選び方で（store/shoot/stub.js がそこまで送る）。
 * `送る` は、そこからさらに下へずらす px（CSS の px）。集計は1つの <pre> なので、続きは px で送る。
 * 1番は下の端が字の行の途中で切れないよう少し戻し、5番は「記録した日ごとの数」の見出しが上に来るよう送る
 * ——**集計の見せ方（common/history.js）や見本（store/shoot/stub.js）を変えたら、撮った絵を見て直す。**
 */
export const スクリーンショット = [
  { 名前: "screenshot-1-集計.png", at: "section:has(#report)", 送る: -12, 何: "読者の反応の集計（いまの数・日ごとのPVの棒）" },
  { 名前: "screenshot-2-はじめに.png", at: "", 何: "説明のページの先頭（見出し・版・はじめにの3つの手順）" },
  { 名前: "screenshot-3-アイコンの印.png", at: "section:has(table)", 何: "アイコンの印と、押したときにすることの表" },
  { 名前: "screenshot-4-しないこと.png", at: ".rules", 何: "この拡張がしないこと" },
  { 名前: "screenshot-5-集計の率.png", at: "#report", 送る: 510, 何: "集計の続き（記録した日ごとの数・3つの率）" },
];

// ---------------------------------------------------------------------------
// PNG の読み書き（8ビットの RGB・RGBA、飛び越し無しだけ。ブラウザの撮影と icons/ の PNG はこの形）
// ---------------------------------------------------------------------------

const PNGの頭 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @returns {{幅:number, 高さ:number, 画素:Buffer}} 画素は RGBA の並び */
export function PNGを読む(buf) {
  if (!buf.subarray(0, 8).equals(PNGの頭)) {
    throw new Error("PNG ではありません");
  }
  let 位置 = 8;
  let 幅 = 0;
  let 高さ = 0;
  let 色 = -1;
  const 中身 = [];
  while (位置 < buf.length) {
    const 長さ = buf.readUInt32BE(位置);
    const 種類 = buf.toString("latin1", 位置 + 4, 位置 + 8);
    const データ = buf.subarray(位置 + 8, 位置 + 8 + 長さ);
    if (種類 === "IHDR") {
      幅 = データ.readUInt32BE(0);
      高さ = データ.readUInt32BE(4);
      const 深さ = データ[8];
      色 = データ[9];
      const 飛び越し = データ[12];
      if (深さ !== 8 || (色 !== 2 && 色 !== 6) || 飛び越し !== 0) {
        throw new Error(`読めない形の PNG です（深さ ${深さ}・色 ${色}・飛び越し ${飛び越し}）`);
      }
    } else if (種類 === "IDAT") {
      中身.push(データ);
    } else if (種類 === "IEND") {
      break;
    }
    位置 += 12 + 長さ;
  }
  const 一画素 = 色 === 6 ? 4 : 3;
  const 行の長さ = 幅 * 一画素;
  const 生 = inflateSync(Buffer.concat(中身));
  const 戻した = Buffer.alloc(行の長さ * 高さ);
  for (let y = 0; y < 高さ; y++) {
    const 型 = 生[y * (行の長さ + 1)];
    const 行 = 生.subarray(y * (行の長さ + 1) + 1, (y + 1) * (行の長さ + 1));
    const 上 = y > 0 ? 戻した.subarray((y - 1) * 行の長さ, y * 行の長さ) : null;
    const 出 = 戻した.subarray(y * 行の長さ, (y + 1) * 行の長さ);
    for (let i = 0; i < 行の長さ; i++) {
      const a = i >= 一画素 ? 出[i - 一画素] : 0;
      const b = 上 ? 上[i] : 0;
      const c = 上 && i >= 一画素 ? 上[i - 一画素] : 0;
      let 予想 = 0;
      if (型 === 1) 予想 = a;
      else if (型 === 2) 予想 = b;
      else if (型 === 3) 予想 = (a + b) >> 1;
      else if (型 === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        予想 = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (型 !== 0) {
        throw new Error(`知らない行の型です：${型}`);
      }
      出[i] = (行[i] + 予想) & 0xff;
    }
  }
  if (一画素 === 4) {
    return { 幅, 高さ, 画素: 戻した };
  }
  const 画素 = Buffer.alloc(幅 * 高さ * 4);
  for (let i = 0, j = 0; i < 戻した.length; i += 3, j += 4) {
    画素[j] = 戻した[i];
    画素[j + 1] = 戻した[i + 1];
    画素[j + 2] = 戻した[i + 2];
    画素[j + 3] = 255;
  }
  return { 幅, 高さ, 画素 };
}

function 塊(種類, データ) {
  const 長さ = Buffer.alloc(4);
  長さ.writeUInt32BE(データ.length, 0);
  const 種類と中身 = Buffer.concat([Buffer.from(種類, "latin1"), データ]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(種類と中身) >>> 0, 0);
  return Buffer.concat([長さ, 種類と中身, crc]);
}

/**
 * PNG を書く。`透過` が false なら RGB（24ビット）で書く——透過を落とすのは呼ぶ側（白の上に重ねてから渡す）。
 * 行の型は Sub にそろえる（写真ではない画面の絵は、これで十分に縮む。毎回同じ中身になる）。
 */
export function PNGを書く({ 幅, 高さ, 画素 }, 透過) {
  const 一画素 = 透過 ? 4 : 3;
  const 行の長さ = 幅 * 一画素;
  const 生 = Buffer.alloc((行の長さ + 1) * 高さ);
  for (let y = 0; y < 高さ; y++) {
    const 頭 = y * (行の長さ + 1);
    生[頭] = 1; // Sub
    for (let x = 0; x < 幅; x++) {
      for (let k = 0; k < 一画素; k++) {
        const 値 = 画素[(y * 幅 + x) * 4 + k];
        const 左 = x > 0 ? 画素[(y * 幅 + x - 1) * 4 + k] : 0;
        生[頭 + 1 + x * 一画素 + k] = (値 - 左) & 0xff;
      }
    }
  }
  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(幅, 0);
  IHDR.writeUInt32BE(高さ, 4);
  IHDR[8] = 8;
  IHDR[9] = 透過 ? 6 : 2;
  return Buffer.concat([
    PNGの頭,
    塊("IHDR", IHDR),
    塊("IDAT", deflateSync(生, { level: 9 })),
    塊("IEND", Buffer.alloc(0)),
  ]);
}

/** 白の上に重ねて、透過を落とす（画素は RGBA のまま、A を 255 にする）。 */
export function 白に重ねる(絵) {
  const 画素 = Buffer.from(絵.画素);
  for (let i = 0; i < 画素.length; i += 4) {
    const a = 画素[i + 3] / 255;
    for (let k = 0; k < 3; k++) {
      画素[i + k] = Math.round(画素[i + k] * a + 255 * (1 - a));
    }
    画素[i + 3] = 255;
  }
  return { 幅: 絵.幅, 高さ: 絵.高さ, 画素 };
}

/**
 * 面積の割合で縮める（縮めた1画素が覆う元の画素を、覆う広さの重みで平均する）。
 * 透過のある絵は、色に透過を掛けてから平均し、あとで割り戻す（縁が黒ずまないように）。
 */
export function 縮める(絵, 新しい幅, 新しい高さ) {
  const 比x = 絵.幅 / 新しい幅;
  const 比y = 絵.高さ / 新しい高さ;
  const 画素 = Buffer.alloc(新しい幅 * 新しい高さ * 4);
  for (let y = 0; y < 新しい高さ; y++) {
    const y0 = y * 比y;
    const y1 = y0 + 比y;
    for (let x = 0; x < 新しい幅; x++) {
      const x0 = x * 比x;
      const x1 = x0 + 比x;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let 広さ = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * wy;
          const i = (sy * 絵.幅 + sx) * 4;
          const 元a = 絵.画素[i + 3] / 255;
          r += 絵.画素[i] * 元a * w;
          g += 絵.画素[i + 1] * 元a * w;
          b += 絵.画素[i + 2] * 元a * w;
          a += 元a * w;
          広さ += w;
        }
      }
      const j = (y * 新しい幅 + x) * 4;
      画素[j] = a > 0 ? Math.round(r / a) : 0;
      画素[j + 1] = a > 0 ? Math.round(g / a) : 0;
      画素[j + 2] = a > 0 ? Math.round(b / a) : 0;
      画素[j + 3] = Math.round((a / 広さ) * 255);
    }
  }
  return { 幅: 新しい幅, 高さ: 新しい高さ, 画素 };
}

/** 周りに透明な余白を付ける。 */
export function 余白を付ける(絵, 余白) {
  const 幅 = 絵.幅 + 余白 * 2;
  const 高さ = 絵.高さ + 余白 * 2;
  const 画素 = Buffer.alloc(幅 * 高さ * 4);
  for (let y = 0; y < 絵.高さ; y++) {
    絵.画素.copy(画素, ((y + 余白) * 幅 + 余白) * 4, y * 絵.幅 * 4, (y + 1) * 絵.幅 * 4);
  }
  return { 幅, 高さ, 画素 };
}

/** ストアの一覧用のアイコン：絵を 96×96 に縮め、周りに 16px の透明な余白（Google の推奨）。 */
export function ストアのアイコン(元のPNG) {
  const 元 = PNGを読む(元のPNG);
  return PNGを書く(余白を付ける(縮める(元, 96, 96), 16), true);
}

// ---------------------------------------------------------------------------
// 撮影
// ---------------------------------------------------------------------------

export function ブラウザを探す() {
  const 候補 = [
    process.env.STORE_IMAGES_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const 見つけた = 候補.find((p) => existsSync(p));
  if (!見つけた) {
    throw new Error("Edge も Chrome も見つかりません。環境変数 STORE_IMAGES_BROWSER にブラウザの場所を入れてください。");
  }
  return 見つけた;
}

const 待つ = (ミリ秒) => new Promise((r) => setTimeout(r, ミリ秒));

/**
 * 1枚撮る。ブラウザはすぐ戻ることがあるので、画像が出来て大きさが2回続けて同じになるまで待つ。
 * プロフィールは毎回使い捨て（ふだんのブラウザの記録を混ぜない・前の撮影の後始末を待たない）。
 */
export async function 撮る(ブラウザ, 作業場, url, 出す先, { 幅, 高さ, 倍率 }) {
  rmSync(出す先, { force: true });
  const プロフィール = mkdtempSync(join(作業場, "profile-"));
  const 引数 = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    // 暗い色の設定のパソコンでも、明るい画面で撮る（説明のページは prefers-color-scheme で色が変わる）
    "--blink-settings=preferredColorScheme=1",
    `--force-device-scale-factor=${倍率}`,
    `--window-size=${幅},${高さ}`,
    // 代役の返事と位置送り（setTimeout）が済むまで、仮想の時計を進めてから撮る
    "--virtual-time-budget=3000",
    `--user-data-dir=${プロフィール}`,
    `--screenshot=${出す先}`,
    url,
  ];
  const env = Object.assign({}, process.env);
  // 拡張機能ホストなどから継いだこの変数は Electron 製のアプリを壊す。ブラウザへは渡さない
  delete env.ELECTRON_RUN_AS_NODE;
  const 子 = spawn(ブラウザ, 引数, { env, stdio: "ignore" });
  const 終わり = new Promise((r) => 子.on("exit", r).on("error", r));
  const 期限 = Date.now() + 60000;
  let 前の大きさ = -1;
  for (;;) {
    if (Date.now() > 期限) {
      throw new Error(`撮れませんでした（60秒待っても画像が出来ない）：${url}`);
    }
    await 待つ(500);
    const 大きさ = existsSync(出す先) ? statSync(出す先).size : -1;
    if (大きさ > 0 && 大きさ === 前の大きさ) {
      break;
    }
    前の大きさ = 大きさ;
  }
  await Promise.race([終わり, 待つ(5000)]);
  // プロフィールはブラウザが閉じ切るまで掴んでいることがある。消せなくても撮影は済んでいる
  try {
    rmSync(プロフィール, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    // 一時フォルダーの中なので、残っても害は無い
  }
}

/** 撮った画像の大きさを確かめ、透過を落として書き直す。 */
function 仕上げる(ファイル, 幅, 高さ) {
  const 絵 = PNGを読む(readFileSync(ファイル));
  if (絵.幅 !== 幅 || 絵.高さ !== 高さ) {
    throw new Error(`${ファイル} の大きさが ${絵.幅}×${絵.高さ} です（${幅}×${高さ} のはず）`);
  }
  writeFileSync(ファイル, PNGを書く(白に重ねる(絵), false));
}

/**
 * 説明のページの写しを作る（本物は書き換えない）。
 * `<base>` で拡張のフォルダーを指し、options.js の前に集計の組み立て・溜まりの上限・代役を読み込む。
 * 本物の形が変わって差し込めなくなったら、黙って違う絵を撮らないよう止める。
 */
export function 撮影用のページ(本物, ルートのURL) {
  const 頭 = '<meta charset="utf-8" />';
  const 本体 = '<script src="options.js"></script>';
  if (本物.split(頭).length !== 2 || 本物.split(本体).length !== 2) {
    throw new Error("options.html の形が変わっていて、撮影用の部品を差し込めません（scripts/storeImages.mjs を直してください）");
  }
  return 本物
    .replace(頭, `${頭}\n<base href="${ルートのURL}" />`)
    .replace(
      本体,
      [
        '<script src="common/history.js"></script>',
        '<script src="common/stash.js"></script>',
        '<script src="store/shoot/stub.js"></script>',
        本体,
      ].join("\n")
    );
}

async function main() {
  const ブラウザ = ブラウザを探す();
  mkdirSync(出力先, { recursive: true });
  const 作業場 = mkdtempSync(join(tmpdir(), "nph-store-images-"));
  try {
    const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
    const ルートのURL = pathToFileURL(ルート + "/").href;
    const ページ = join(作業場, "options-shoot.html");
    writeFileSync(ページ, 撮影用のページ(readFileSync(join(ルート, "options.html"), "utf8"), ルートのURL));
    const ページのURL = pathToFileURL(ページ).href;

    console.log(`撮るブラウザ：${ブラウザ}`);
    for (const 一枚 of スクリーンショット) {
      const 問い = new URLSearchParams({ v: manifest.version, w: "1024", h: "640" });
      if (一枚.at) 問い.set("at", 一枚.at);
      if (一枚.送る) 問い.set("shift", String(一枚.送る));
      const 出す先 = join(出力先, 一枚.名前);
      await 撮る(ブラウザ, 作業場, `${ページのURL}?${問い}`, 出す先, { 幅: 1024, 高さ: 640, 倍率: 1.25 });
      仕上げる(出す先, 1280, 800);
      console.log(`撮りました：store/images/${一枚.名前}（1280×800）${一枚.何}`);
    }

    const タイル = join(出力先, "tile-small.png");
    await 撮る(ブラウザ, 作業場, pathToFileURL(join(ルート, "store", "shoot", "tile.html")).href, タイル, {
      幅: 440,
      高さ: 280,
      倍率: 1,
    });
    仕上げる(タイル, 440, 280);
    console.log("撮りました：store/images/tile-small.png（440×280）小さなプロモーション タイル");

    writeFileSync(join(出力先, "icon128-store.png"), ストアのアイコン(readFileSync(join(ルート, "icons", "icon128.png"))));
    console.log("作りました：store/images/icon128-store.png（128×128。絵は96×96、周りに16pxの透明な余白）");
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
