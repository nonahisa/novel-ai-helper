import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 「越えない一線」（設計書6.79.2）を、文書だけでなく**コードで**確かめる。
 *
 * 目で守る約束は、いつか忘れられる。ここでソースを走査しておけば、
 * うっかり fetch を1行足した時点でテストが落ちる。
 * （テスト自身は走査の対象に入れない——禁止語をここに書く必要があるため）
 */
function 拡張機能のソース() {
  const ファイル = ["manifest.json", "popup.js", "popup.html", "popup.css"];
  for (const フォルダー of ["common", "content"]) {
    for (const 名前 of readdirSync(join(ルート, フォルダー))) {
      ファイル.push(`${フォルダー}/${名前}`);
    }
  }
  return ファイル.map((相対) => ({
     相対,
    中身: コメントを除く(readFileSync(join(ルート, 相対), "utf8")),
  }));
}

/**
 * 走査の前にコメントを落とす。
 * 「fetch は使わない」と**コメントに書いた**だけで落ちてしまうため
 * （実際に最初の実行で落ちた）。見逃すのはコメントアウトされた呼び出しだけで、
 * それは実行されない。
 */
function コメントを除く(中身) {
  return 中身
    .split("\n")
    .map((行) =>
      行
        .replace(/^\s*(\/\/|\*\/|\*|\/\*).*$/, "") // 行コメントとブロックコメントの各行
        .replace(/\s\/\/.*$/, "") // 行末のコメント
        .replace(/<!--.*?-->/g, "") // HTMLのコメント
    )
    .join("\n");
}

/** 与えたソースの中に、禁止の書き方があるかを調べる（走査の本体）。 */
function 違反を探す(ソース群, 禁止) {
  const 見つかった = [];
  for (const { 相対, 中身 } of ソース群) {
    for (const 規則 of 禁止) {
      if (規則.test(中身)) {
        見つかった.push(`${相対}: ${規則}`);
      }
    }
  }
  return 見つかった;
}

describe("越えない一線（コードで強制する）", () => {
  it("HTTPを発する呼び出しが1つも無い", () => {
    // fetch / XHR / WebSocket / ビーコン / SSE。どれも書かないのが一線（6.79.2-1）。
    const 禁止 = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/,
      /\bsendBeacon\b/,
      /\bEventSource\b/,
      /\bnavigator\s*\.\s*serviceWorker\b/,
    ];
    expect(違反を探す(拡張機能のソース(), 禁止)).toEqual([]);

    // 走査そのものが働いていることを、その場で確かめる
    // （コメント除去を入れたあと、何も検知しない検査になっていないか）。
    const 架空のソース = [{ 相対: "架空.js", 中身: 'const r = await fetch("https://example.com");' }];
    expect(違反を探す(架空のソース, 禁止)).toHaveLength(1);
  });

  it("送信操作（クリック・submit・キー入力の合成）のコードが1つも無い", () => {
    // 投稿ボタンは作者が押す（6.79.2-2。なろう第14条23号の一線）。
    const 禁止 = [
      /\.click\s*\(/,
      /\.submit\s*\(/,
      /requestSubmit/,
      /new\s+MouseEvent/,
      /new\s+PointerEvent/,
      /new\s+KeyboardEvent/,
      /dispatchEvent\s*\(\s*new\s+Event\s*\(\s*["']submit["']/,
    ];
    expect(違反を探す(拡張機能のソース(), 禁止)).toEqual([]);

    const 架空のソース = [{ 相対: "架空.js", 中身: 'document.querySelector("#post").click();' }];
    expect(違反を探す(架空のソース, 禁止)).toHaveLength(1);
  });

  it("認証情報（Cookie・セッション）に触るコードが1つも無い", () => {
    const 禁止 = [/document\s*\.\s*cookie/, /chrome\s*\.\s*cookies/, /chrome\s*\.\s*webRequest/];
    expect(違反を探す(拡張機能のソース(), 禁止)).toEqual([]);
  });

  it("権限は最小のまま（増やすときは、この期待値ごと考え直す）", () => {
    const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
    expect(manifest.permissions).toEqual(["clipboardRead", "activeTab"]);
    // host_permissions は置かない。ページへ入る範囲は content_scripts の matches が唯一の指定。
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("ページへ入る範囲は、対応サイトの投稿まわりだけ", () => {
    const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
    const matches = manifest.content_scripts.flatMap((c) => c.matches);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      // 全サイト（<all_urls> や https://*/*）へ入らない。
      expect(m).not.toBe("<all_urls>");
      expect(m.startsWith("https://")).toBe(true);
      expect(/^https:\/\/\*/.test(m)).toBe(false);
    }
  });
});

describe("サイトの表", () => {
  const { SITES, siteById } = require("../content/sites.js");

  it("対応サイトはカクヨムとアルファポリス、なろうは枠だけ", () => {
    expect(SITES.map((s) => s.id)).toEqual(["kakuyomu", "alphapolis", "narou"]);
    expect(siteById("kakuyomu").supported).toBe(true);
    expect(siteById("alphapolis").supported).toBe(true);
    // なろうは規約が最も厳しい。貼り込みの可否は作者の判断待ち（6.79.1）。
    expect(siteById("narou").supported).toBe(false);
  });

  it("対応サイトには本文欄の指定が要る（欄の指定漏れで黙って違う欄に入れない）", () => {
    for (const site of SITES.filter((s) => s.supported)) {
      expect(site.fields.body.selectors.length).toBeGreaterThan(0);
      expect(site.postPagePatterns.length).toBeGreaterThan(0);
      expect(site.workIdPatterns.length).toBeGreaterThan(0);
    }
  });
});
