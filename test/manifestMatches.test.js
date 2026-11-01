import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));

/**
 * manifest の content_scripts の matches が、**入るべき画面を覆い、入らなくてよい画面を覆わない**かを確かめる（0.14.2）。
 *
 * 2026-11-01 に、アルファポリスの投稿画面（/mypage/novel/save_episode/…）と、リニューアル後の
 * なろうファンDB の作品ページ（/novels/…）が matches の外で、拡張がそもそも入っていなかったと分かった。
 * 表（sites.js・statsSites.js）が正しくても、ここが外れていると何も起きない——それを見張る。
 * URL の作品ID・Nコードは架空。
 */

/** Chrome の match pattern（`https://host/path*`）を正規表現にする。ここで使う形（ホストは固定、パスに *）だけを受ける */
function 型を正規表現に(型) {
  const m = /^(https):\/\/([^/*]+)(\/.*)$/.exec(型);
  if (!m) {
    throw new Error(`この試験が知らない形の match pattern: ${型}`);
  }
  const 逃がす = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${m[1]}://${逃がす(m[2])}${逃がす(m[3]).replace(/\*/g, ".*")}$`);
}

/** そのURLに、指定の JS を読む content_scripts が入るか */
function 入るか(url, js) {
  return manifest.content_scripts.some(
    (c) => (c.js || []).includes(js) && (c.matches || []).some((型) => 型を正規表現に(型).test(url))
  );
}

describe("ページへ入る範囲（manifest の matches）", () => {
  it("アルファポリスの新しい話の投稿画面に、貼り込み係が入る", () => {
    expect(入るか("https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789", "content/fill.js")).toBe(true);
  });

  it("アルファポリスのマイページのほかの画面（作品管理の一覧・作品の管理画面）には入らない", () => {
    for (const url of [
      "https://www.alphapolis.co.jp/mypage/content",
      "https://www.alphapolis.co.jp/mypage/content/detail/123456789",
      "https://www.alphapolis.co.jp/mypage/",
      // 作品の公開ページ（読者が読む画面）
      "https://www.alphapolis.co.jp/novel/111111111/123456789",
    ]) {
      expect(入るか(url, "content/fill.js"), url).toBe(false);
    }
  });

  it("リニューアル後のなろうファンDB の作品ページに、読み取り係が入る", () => {
    expect(入るか("https://db.narou.fun/novels/n1234ab", "content/read.js")).toBe(true);
  });

  it("なろうファンDB の作品ページ以外（トップ・検索）には入らない", () => {
    for (const url of ["https://db.narou.fun/", "https://db.narou.fun/search?word=x", "https://db.narou.fun/works/N1234AB"]) {
      expect(入るか(url, "content/read.js"), url).toBe(false);
    }
  });

  it("カクヨム・アルファポリスのランキングの画面に、読み取り係が入る（問い合わせ・ページ送り付きも。0.19.0）", () => {
    for (const url of [
      "https://kakuyomu.jp/rankings/all/daily",
      "https://kakuyomu.jp/rankings/fantasy/weekly?work_variation=short&page=2",
      "https://www.alphapolis.co.jp/novel/ranking/hot",
      "https://www.alphapolis.co.jp/novel/ranking/annual?page=2",
    ]) {
      expect(入るか(url, "content/read.js"), url).toBe(true);
      expect(入るか(url, "content/announce.js"), url).toBe(true);
      // 貼り込み係・公募と章立ての読み取り係は入らない
      for (const js of ["content/fill.js", "content/contestRead.js", "content/chapterRead.js"]) {
        expect(入るか(url, js), `${url} ${js}`).toBe(false);
      }
    }
  });

  it("小説家になろう（syosetu.com 系）と Narou.fun のランキングには、どの部分も入らない（作者の判断 2026-11-02）", () => {
    const どれでも = manifest.content_scripts.flatMap((c) => c.js || []);
    for (const url of [
      "https://yomou.syosetu.com/rank/list/type/daily_total/",
      "https://yomou.syosetu.com/rank/top/",
      "https://ncode.syosetu.com/n1234ab/",
      "https://syosetu.com/",
      "https://db.narou.fun/ranking/new",
      "https://db.narou.fun/ranking/digits/3",
    ]) {
      for (const js of どれでも) {
        expect(入るか(url, js), `${url} ${js}`).toBe(false);
      }
    }
    // 範囲の指定そのものにも、なろうのドメインと Narou.fun のランキングを書いていない
    const 範囲 = manifest.content_scripts.flatMap((c) => c.matches || []);
    expect(範囲.filter((m) => /syosetu\.com|db\.narou\.fun\/ranking/.test(m))).toEqual([]);
  });

  it("カクヨムの話の作成画面・作品管理・アクセス数には、これまでどおり入る", () => {
    expect(入るか("https://kakuyomu.jp/my/works/16816927859000000000/episodes/new", "content/fill.js")).toBe(true);
    expect(入るか("https://kakuyomu.jp/my/works/16816927859000000000", "content/read.js")).toBe(true);
    expect(入るか("https://kakuyomu.jp/works/16816927859000000000/accesses?page=2", "content/read.js")).toBe(true);
  });
});
