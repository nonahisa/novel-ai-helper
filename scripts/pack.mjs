/**
 * Chrome ウェブストアへ上げる zip を作る（`npm run pack`）。
 *
 * 出来上がるのは `dist/novel-ai-helper-<manifest の版>.zip`。中には**拡張の実行に要るファイルだけ**を入れる
 * （manifest.json・background.js・offscreen.*・options.*・common/・content/・icons/）。
 * テスト・node_modules・ストアの材料・README・PRIVACY・package*.json は入れない。
 *
 * ## なぜ Node の標準だけで zip を書くか
 *
 * - 依存を足さない：この拡張は npm をテストのためだけに使う。配る物を作る道具のために、
 *   中身の分からないパッケージを増やしたくない
 * - PowerShell の Compress-Archive に頼らない：Windows でしか動かず、古い版はフォルダーの区切りを
 *   `\` で書いてしまう（zip の決まりは `/`。Chrome ウェブストアが読めないことがある）
 * - 同じ中身なら同じ zip になるように、ファイルの並びを名前順にし、日時を固定の値にする
 *   （作り直すたびに違う zip になると、何が変わったのか比べられない）
 *
 * ## ファイルの拡張子を .mjs にしている理由
 *
 * test/redLine.test.js は、拡張として動くファイル（.js・.html・.css・.json）をフォルダーごと走査して
 * 「しないこと」を見張る。この道具は拡張の中身ではない（zip に入らない）ので、走査の対象に入れない。
 */
import { deflateRawSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 既定のルート = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** zip に入れるもの。ファイル名、または `/` で終わるフォルダー（中を全部）、または `名前.` で始まるもの。 */
export const 入れるもの = [
  "manifest.json",
  "background.js",
  "offscreen.",
  "options.",
  "common/",
  "content/",
  "icons/",
];

/** フォルダーの中にあっても入れないもの（OS が勝手に作るファイルと、隠しファイル）。 */
function 入れない名前か(名前) {
  return 名前.startsWith(".") || 名前 === "Thumbs.db" || 名前 === "desktop.ini";
}

function フォルダーの中身(ルート, 相対) {
  const 結果 = [];
  for (const 項目 of readdirSync(join(ルート, 相対), { withFileTypes: true })) {
    if (入れない名前か(項目.name)) {
      continue;
    }
    const 次 = `${相対}${項目.name}`;
    if (項目.isDirectory()) {
      結果.push(...フォルダーの中身(ルート, `${次}/`));
    } else if (項目.isFile()) {
      結果.push(次);
    }
  }
  return 結果;
}

/** zip に入れるファイルの一覧（ルートからの相対パス、区切りは `/`、名前順）。 */
export function 入れるファイル(ルート = 既定のルート) {
  const 直下 = readdirSync(ルート, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  const 集めた = new Set();
  for (const 指定 of 入れるもの) {
    if (指定.endsWith("/")) {
      for (const f of フォルダーの中身(ルート, 指定)) {
        集めた.add(f);
      }
    } else if (指定.endsWith(".")) {
      for (const f of 直下.filter((n) => n.startsWith(指定) && !入れない名前か(n))) {
        集めた.add(f);
      }
    } else {
      if (!statSync(join(ルート, 指定), { throwIfNoEntry: false })) {
        throw new Error(`${指定} が見つかりません`);
      }
      集めた.add(指定);
    }
  }
  return [...集めた].sort();
}

/**
 * manifest・拡張のページ・裏方が読み込むファイルの一覧。
 * zip に入れ忘れると、ストアから入れたときだけ動かない（手元のフォルダーでは気づけない）ので、
 * 作るときに全部入っているかを確かめる。
 */
export function 読み込まれるファイル(ルート = 既定のルート) {
  const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
  const 一覧 = new Set(["manifest.json"]);
  const 足す = (p) => {
    if (typeof p === "string" && p !== "") {
      一覧.add(p.replace(/^\.?\//, ""));
    }
  };
  Object.values(manifest.icons || {}).forEach(足す);
  Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(足す);
  足す(manifest.background && manifest.background.service_worker);
  足す(manifest.options_ui && manifest.options_ui.page);
  for (const c of manifest.content_scripts || []) {
    (c.js || []).forEach(足す);
    (c.css || []).forEach(足す);
  }
  // 裏方が importScripts で読むもの
  if (manifest.background && manifest.background.service_worker) {
    const 裏方 = readFileSync(join(ルート, manifest.background.service_worker), "utf8");
    const 呼び = /importScripts\(([\s\S]*?)\)/.exec(裏方);
    if (呼び) {
      for (const m of 呼び[1].matchAll(/["']([^"']+)["']/g)) {
        足す(m[1]);
      }
    }
  }
  // 拡張のページ（説明のページと、クリップボードの受け渡しのページ）が読むもの
  const ページ = [manifest.options_ui && manifest.options_ui.page, "offscreen.html"].filter(Boolean);
  for (const p of ページ) {
    const html = readFileSync(join(ルート, p), "utf8");
    for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
      if (!/^[a-z]+:/i.test(m[1])) {
        足す(m[1]);
      }
    }
  }
  return [...一覧].sort();
}

// ---------------------------------------------------------------------------
// zip を書く（決まり：PKWARE APPNOTE。deflate で縮め、フォルダーの項目は置かない）
// ---------------------------------------------------------------------------

const CRC表 = (() => {
  const 表 = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    表[n] = c >>> 0;
  }
  return 表;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC表[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 日時は固定（2026-01-01 00:00）。同じ中身なら同じ zip にするため。 */
const DOS日付 = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS時刻 = 0;

/**
 * @param {{name:string, data:Buffer}[]} 項目たち
 * @returns {Buffer}
 */
export function zipを組む(項目たち) {
  const 本体 = [];
  const 目録 = [];
  let 位置 = 0;
  for (const { name, data } of 項目たち) {
    const 名前 = Buffer.from(name, "utf8");
    const 縮めた = deflateRawSync(data, { level: 9 });
    // 縮まないものは縮めずに入れる（小さな PNG など）
    const 縮める = 縮めた.length < data.length;
    const 中身 = 縮める ? 縮めた : data;
    const 方式 = 縮める ? 8 : 0;
    const crc = crc32(data);

    const 頭 = Buffer.alloc(30);
    頭.writeUInt32LE(0x04034b50, 0);
    頭.writeUInt16LE(20, 4); // 展開に要る版 2.0
    頭.writeUInt16LE(0x0800, 6); // 名前は UTF-8
    頭.writeUInt16LE(方式, 8);
    頭.writeUInt16LE(DOS時刻, 10);
    頭.writeUInt16LE(DOS日付, 12);
    頭.writeUInt32LE(crc, 14);
    頭.writeUInt32LE(中身.length, 18);
    頭.writeUInt32LE(data.length, 22);
    頭.writeUInt16LE(名前.length, 26);
    頭.writeUInt16LE(0, 28);
    本体.push(頭, 名前, 中身);

    const 目 = Buffer.alloc(46);
    目.writeUInt32LE(0x02014b50, 0);
    目.writeUInt16LE(20, 4); // 作った版
    目.writeUInt16LE(20, 6);
    目.writeUInt16LE(0x0800, 8);
    目.writeUInt16LE(方式, 10);
    目.writeUInt16LE(DOS時刻, 12);
    目.writeUInt16LE(DOS日付, 14);
    目.writeUInt32LE(crc, 16);
    目.writeUInt32LE(中身.length, 20);
    目.writeUInt32LE(data.length, 24);
    目.writeUInt16LE(名前.length, 28);
    // 余白の欄・注記・ディスク番号・属性はすべて 0
    目.writeUInt32LE(位置, 42);
    目録.push(目, 名前);

    位置 += 頭.length + 名前.length + 中身.length;
  }
  const 目録の大きさ = 目録.reduce((n, b) => n + b.length, 0);
  const 終わり = Buffer.alloc(22);
  終わり.writeUInt32LE(0x06054b50, 0);
  終わり.writeUInt16LE(項目たち.length, 8);
  終わり.writeUInt16LE(項目たち.length, 10);
  終わり.writeUInt32LE(目録の大きさ, 12);
  終わり.writeUInt32LE(位置, 16);
  return Buffer.concat([...本体, ...目録, 終わり]);
}

/**
 * zip を作る。
 * @param {{ルート?:string, 出力先?:string}} [指定] 出力先の既定は `<ルート>/dist`
 * @returns {{zipPath:string, version:string, files:string[], bytes:number}}
 */
export function pack(指定 = {}) {
  const ルート = 指定.ルート || 既定のルート;
  const 出力先 = 指定.出力先 || join(ルート, "dist");
  const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
  const version = String(manifest.version || "");
  if (!/^\d+(\.\d+){0,3}$/.test(version)) {
    throw new Error(`manifest.json の版の形が合いません：${version}`);
  }
  // 版の揃え忘れを、配る前に止める（package.json だけ上げて manifest を忘れた、など）
  const pkg = JSON.parse(readFileSync(join(ルート, "package.json"), "utf8"));
  if (pkg.version !== version) {
    throw new Error(`版が揃っていません：manifest.json は ${version}、package.json は ${pkg.version}`);
  }

  const files = 入れるファイル(ルート);
  const 足りない = 読み込まれるファイル(ルート).filter((f) => !files.includes(f));
  if (足りない.length > 0) {
    throw new Error(`拡張が読み込むのに zip に入らないファイルがあります：${足りない.join("、")}`);
  }

  const zip = zipを組む(files.map((name) => ({ name, data: readFileSync(join(ルート, name)) })));
  mkdirSync(出力先, { recursive: true });
  const zipPath = join(出力先, `novel-ai-helper-${version}.zip`);
  writeFileSync(zipPath, zip);
  return { zipPath, version, files, bytes: zip.length };
}

// `node scripts/pack.mjs` として呼ばれたとき
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const 結果 = pack();
  console.log(`作りました：${結果.zipPath}`);
  console.log(`版 ${結果.version}／${結果.files.length} ファイル／${結果.bytes.toLocaleString("ja-JP")} バイト`);
}
