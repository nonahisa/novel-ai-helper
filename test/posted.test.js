import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 0.20.0：投稿したあとの話の番号を送り返す（common/posted.js）・貼り込みの札 postRef（common/envelope.js）・
 * 話の編集画面の置き換えの確認（common/messages.js）・章立ての episodeId（content/chapterRead.js）。
 *
 * 画面の URL の形は見込み（作者の Chrome で確かめたら差し替える。common/posted.js の POSTED_PAGES）。
 */
const require = createRequire(import.meta.url);
const Posted = require("../common/posted.js");
const Envelope = require("../common/envelope.js");
const Messages = require("../common/messages.js");
const Actions = require("../common/actions.js");
const { readChapters } = require("../content/chapterRead.js");

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const カクヨム作品 = "16816927859000000000";
const カクヨム話 = "16816927859000000123";

describe("話の番号を送り返せる画面（URL の数字だけ）", () => {
  it("カクヨム・アルファポリスの話の編集画面、なろうの作品と話の管理画面に当たる", () => {
    expect(Posted.matchPostedPage(`https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`)).toEqual({
      ok: true,
      site: "kakuyomu",
      workId: カクヨム作品,
      episodeId: カクヨム話,
    });
    expect(Posted.matchPostedPage("https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789/987654/")).toEqual({
      ok: true,
      site: "alphapolis",
      workId: "123456789",
      episodeId: "987654",
    });
    expect(Posted.matchPostedPage("https://syosetu.com/usernovelmanage/top/ncode/1234567/")).toEqual({
      ok: true,
      site: "narou",
      novelNo: "1234567",
    });
    expect(
      Posted.matchPostedPage("https://syosetu.com/usernoveldatamanage/updateinput/ncode/1234567/noveldataid/8765432/")
    ).toEqual({ ok: true, site: "narou", novelNo: "1234567", episodeId: "8765432" });
  });

  it("作者の Chrome で見た形に当たる（2026-11-06：カクヨムで下書き保存のあとに移る先と、作品管理で話の題を押した先。数字は伏せて同じ桁にした）", () => {
    // 下書き保存のあと：/my/works/{20桁}/episodes/{20桁}（話の番号は作品IDと頭が違う）
    expect(Posted.matchPostedPage("https://kakuyomu.jp/my/works/16817330660000000013/episodes/11054822660000000029")).toEqual({
      ok: true,
      site: "kakuyomu",
      workId: "16817330660000000013",
      episodeId: "11054822660000000029",
    });
    // 作品管理で話の題を押した先（話の編集の画面）も同じ形
    expect(Posted.matchPostedPage("https://kakuyomu.jp/my/works/16817330660000000013/episodes/16817330660000000049").ok).toBe(true);
  });

  it("新規作成の画面・作品IDだけの画面・話の下のページ・よその場所・http では当たらない", () => {
    for (const url of [
      `https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/new`,
      `https://kakuyomu.jp/my/works/${カクヨム作品}`,
      `https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}/preview`,
      `https://kakuyomu.jp/works/${カクヨム作品}/episodes/${カクヨム話}`,
      "https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789",
      "https://syosetu.com/usernovelmanage/top/",
      "https://ncode.syosetu.com/n1234ab/1/",
      `https://evilkakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`,
      `http://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`,
      "not a url",
    ]) {
      expect(Posted.matchPostedPage(url).ok, url).toBe(false);
    }
    // 31桁の話の番号は受け手の検査（1〜30桁）を越えるので読まない
    expect(Posted.matchPostedPage(`https://kakuyomu.jp/my/works/1/episodes/${"1".repeat(31)}`).ok).toBe(false);
  });
});

describe("封筒 novelai-posted 版1", () => {
  const 時 = new Date("2026-11-03T12:40:00.000Z");

  it("カクヨム：作品ID・話の番号・札・読んだ時刻（日本時間）。題は付けない", () => {
    const page = Posted.matchPostedPage(`https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`);
    const 封筒 = Posted.makePostedEnvelope(page, { postRef: "a1b2c3d4e5f6a1b2c3d4e5f6" }, 時);
    expect(封筒).toEqual({
      "novelai-posted": 1,
      site: "kakuyomu",
      workId: カクヨム作品,
      episodeId: カクヨム話,
      postRef: "a1b2c3d4e5f6a1b2c3d4e5f6",
      readAt: "2026-11-03T21:40:00.000+09:00",
    });
    // 番号は数字の文字列のまま（数にすると20桁で桁が落ちる）
    expect(typeof 封筒.episodeId).toBe("string");
  });

  it("題を渡されれば添える（前後の空白を落とし200字まで）。空なら付けない。なろうには付けない", () => {
    const page = Posted.matchPostedPage(`https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`);
    expect(Posted.makePostedEnvelope(page, null, 時, " 第13話 星の落ちる夜 ").title).toBe("第13話 星の落ちる夜");
    expect(Posted.makePostedEnvelope(page, null, 時, "長".repeat(300)).title).toHaveLength(200);
    expect(Posted.makePostedEnvelope(page, null, 時, "  ")).not.toHaveProperty("title");
    const top = Posted.matchPostedPage("https://syosetu.com/usernovelmanage/top/ncode/1234567/");
    expect(Posted.makePostedEnvelope(top, null, 時, "題")).not.toHaveProperty("title");
  });

  it("札を覚えていなければ postRef を付けない。形の崩れた札も付けない", () => {
    const page = Posted.matchPostedPage(`https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`);
    expect(Posted.makePostedEnvelope(page, null, 時)).not.toHaveProperty("postRef");
    expect(Posted.makePostedEnvelope(page, { postRef: "../作品フォルダー" }, 時)).not.toHaveProperty("postRef");
  });

  it("なろう：小説番号と（あれば）部分の番号だけ。workId・title・postRef は付けない", () => {
    const top = Posted.matchPostedPage("https://syosetu.com/usernovelmanage/top/ncode/1234567/");
    expect(Posted.makePostedEnvelope(top, { postRef: "abc" }, 時)).toEqual({
      "novelai-posted": 1,
      site: "narou",
      novelNo: "1234567",
      readAt: "2026-11-03T21:40:00.000+09:00",
    });
  });

  it("当たらなかった画面では作らない", () => {
    expect(Posted.makePostedEnvelope({ ok: false }, null, 時)).toBeNull();
  });

  it("受け手を呼ぶリンクは /import-posted（データはリンクに載せない）", () => {
    const リンク = Actions.vscodeLinkAfter({ kind: "posted", copied: true });
    expect(new URL(リンク).pathname).toBe("/import-posted");
    expect(Actions.vscodeLinkAfter({ kind: "posted", copied: false })).toBeNull();
  });
});

describe("貼り込みの札 postRef と控え", () => {
  const 封 = (extra) =>
    JSON.stringify(Object.assign({ "novelai-post": 1, site: "kakuyomu", workId: "1", title: "題", body: "本文" }, extra));

  it("札は英数字と - _ で1〜64字。通れば封筒に載り、崩れていれば封筒ごと断る", () => {
    expect(Envelope.parseEnvelope(封({ postRef: "k7Qm2xP9" })).envelope.postRef).toBe("k7Qm2xP9");
    expect(Envelope.parseEnvelope(封({ postRef: "a".repeat(64) })).ok).toBe(true);
    for (const 悪い of ["", "a".repeat(65), "札", "a/b", "a b", 123, true]) {
      const r = Envelope.parseEnvelope(封({ postRef: 悪い }));
      expect(r.ok, String(悪い)).toBe(false);
      expect(r.reason).toBe("bad-postRef");
    }
    // 無い・null は「札なし」
    expect(Envelope.parseEnvelope(封({})).envelope).not.toHaveProperty("postRef");
    expect(Envelope.parseEnvelope(封({ postRef: null })).ok).toBe(true);
    // 断ったときの文は、ほかの崩れと同じ（コピーし直しを勧める）
    expect(Messages.messageForEnvelope({ ok: false, reason: "bad-postRef" })).toContain("投稿キット");
  });

  it("控えは作品ごとに最後の1件。本文は持たず字数だけ。7日より古い控えは捨てる", () => {
    const 今 = new Date("2026-11-04T00:00:00.000Z");
    let 控え = Posted.rememberPaste({}, { site: "kakuyomu", workId: "1", title: "第1話", body: "あいう", postRef: "r1" }, 今);
    控え = Posted.rememberPaste(控え, { site: "kakuyomu", workId: "1", title: "第2話", body: "かき", postRef: "r2" }, 今);
    const 一件 = Posted.lastPasteFor(控え, "kakuyomu", "1");
    expect(一件).toMatchObject({ site: "kakuyomu", workId: "1", title: "第2話", bodyLength: 2, postRef: "r2" });
    expect(JSON.stringify(控え)).not.toContain("かき");
    // 作品IDの無い封筒は控えない
    expect(Posted.rememberPaste({}, { site: "kakuyomu", title: "t", body: "b" }, 今)).toEqual({});
    const 八日後 = new Date(今.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(Posted.freshPastes(控え, 八日後)).toEqual({});
    expect(Object.keys(Posted.freshPastes(控え, 今))).toHaveLength(1);
  });

  it("同じ原稿か：札があれば札で、無ければ題と字数で比べる", () => {
    const 控え = { postRef: "r1", title: "第1話", bodyLength: 3 };
    expect(Posted.isSameAsLastPaste({ postRef: "r1", title: "x", body: "y" }, 控え)).toBe(true);
    // 受け手はコピーのたびに新しい札を作る（novel-ai-assistant の postingKit の newPostRef）——直してコピーし直せば別の原稿
    expect(Posted.isSameAsLastPaste({ postRef: "r2", title: "第1話", body: "あいう" }, 控え)).toBe(false);
    expect(Posted.isSameAsLastPaste({ title: "第1話", body: "あいう" }, { title: "第1話", bodyLength: 3 })).toBe(true);
    expect(Posted.isSameAsLastPaste({ title: "第1話", body: "あいうえ" }, { title: "第1話", bodyLength: 3 })).toBe(false);
    expect(Posted.isSameAsLastPaste({ title: "t", body: "b" }, null)).toBe(false);
  });
});

describe("話の編集画面の置き換えの確認（毎回出す）", () => {
  it("字数・保存されないこと・戻し方を言う。題が違えば両方を並べる", () => {
    const 文 = Messages.confirmReplace({ currentLength: 4210, newLength: 4260, screenTitle: "第5話 雨", newTitle: "第6話 晴れ" });
    expect(文).toContain("4,210字");
    expect(文).toContain("4,260字");
    expect(文).toContain("サイトにはまだ保存されません");
    expect(文).toContain("「第5話 雨」");
    expect(文).toContain("「第6話 晴れ」");
    expect(文).toContain("置き換えますか？");
    // 同じ題なら並べない
    expect(Messages.confirmReplace({ currentLength: 1, newLength: 2, screenTitle: "第5話", newTitle: "第5話" })).not.toContain("題が違います");
  });
});

describe("章立ての episodeId（作品管理の話の行の、編集画面へのリンク）", () => {
  function 要素(tag, attrs, 中身) {
    const 子 = Array.isArray(中身) ? 中身 : [];
    const el = {
      tagName: tag.toUpperCase(),
      attrs: attrs || {},
      children: 子,
      get textContent() {
        return Array.isArray(中身) ? 子.map((c) => c.textContent).join(" ") : String(中身 || "");
      },
      get innerText() {
        return this.textContent;
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
      },
      querySelectorAll(selector) {
        const 結果 = [];
        const 合う = (c) => {
          if (selector === "a[href]") return c.tagName === "A" && c.getAttribute("href") !== null;
          const [t, cls] = selector.split(".");
          return c.tagName === t.toUpperCase() && (!cls || String(c.getAttribute("class") || "").split(" ").includes(cls));
        };
        const 潜る = (親) => {
          for (const c of 親.children) {
            if (合う(c)) 結果.push(c);
            潜る(c);
          }
        };
        潜る(el);
        return 結果;
      },
    };
    return el;
  }
  const 作品 = "1177354054000000000";
  const 行 = (題, hrefs) =>
    要素("tr", {}, [
      要素("td", { class: "episode-title" }, hrefs.length > 0 ? hrefs.map((h) => 要素("a", { href: h }, 題)) : 題),
      要素("td", { class: "episode-feedback-pv" }, "1 PV"),
    ]);
  const 見出し = (題) => 要素("tr", {}, [要素("td", {}, "大見出し"), 要素("td", {}, 題)]);

  it("リンクのある行に番号、無い行・違う作品・番号が2つある行には欄を付けない", () => {
    const ページ = 要素("html", {}, [
      要素("table", { class: "episodes" }, [
        見出し("第一章"),
        行("１話", [`/my/works/${作品}/episodes/111`]),
        行("２話", []),
        行("３話", [`/my/works/999/episodes/333`]),
        行("４話", [`/my/works/${作品}/episodes/444`, `/my/works/${作品}/episodes/445`]),
        行("５話", [`https://kakuyomu.jp/my/works/${作品}/episodes/555?x=1`, `/my/works/${作品}/episodes/555`]),
      ]),
    ]);
    const 結果 = readChapters(ページ, `https://kakuyomu.jp/my/works/${作品}`, new Date(2026, 10, 4));
    expect(結果.ok).toBe(true);
    const 話 = JSON.parse(結果.envelope).episodes;
    expect(話.map((e) => e.episodeId)).toEqual(["111", undefined, undefined, undefined, "555"]);
    expect(話[1]).not.toHaveProperty("episodeId");
  });
});

/*
  受け手（統合小説執筆環境）が隣のフォルダーにあれば、本物の読み口に封筒を食わせる（test/readEnvelope.test.js と同じ考え）。
*/
const 受け手 = process.env.NOVELAI_ASSISTANT_DIR || join(ルート, "..", "novel-ai-assistant");
const 読み口 = (名) => join(受け手, "src", "core", 名);
const 受け手がある = existsSync(読み口("postedEnvelope.ts"));

describe.skipIf(!受け手がある)("受け手の本物の読み口を通るか（0.20.0）", () => {
  it("novelai-posted（カクヨム・なろう）を受け手がそのまま受け取る", async () => {
    const { parsePostedClipboard } = await import(/* @vite-ignore */ 読み口("postedEnvelope.ts"));
    const 時 = new Date("2026-11-03T12:40:00.000Z");
    const カクヨム = Posted.makePostedEnvelope(
      Posted.matchPostedPage(`https://kakuyomu.jp/my/works/${カクヨム作品}/episodes/${カクヨム話}`),
      { postRef: "a1b2c3d4e5f6a1b2c3d4e5f6" },
      時,
      "第13話 星の落ちる夜"
    );
    const r1 = parsePostedClipboard(JSON.stringify(カクヨム));
    expect(r1.ok, r1.ok ? "" : r1.reason).toBe(true);
    expect(r1.envelope).toMatchObject({ site: "kakuyomu", workId: カクヨム作品, episodeId: カクヨム話, postRef: "a1b2c3d4e5f6a1b2c3d4e5f6", title: "第13話 星の落ちる夜" });

    const なろう = Posted.makePostedEnvelope(
      Posted.matchPostedPage("https://syosetu.com/usernoveldatamanage/updateinput/ncode/1234567/noveldataid/8765432/"),
      null,
      時
    );
    const r2 = parsePostedClipboard(JSON.stringify(なろう));
    expect(r2.ok, r2.ok ? "" : r2.reason).toBe(true);
    expect(r2.envelope).toMatchObject({ site: "narou", novelNo: "1234567", episodeId: "8765432" });
  });

  it("受け手が作る novelai-post の札を、ヘルパーの検査が通す", async () => {
    const posting = 読み口("postingEnvelope.ts");
    const mod = await import(/* @vite-ignore */ posting);
    const 札 = mod.newPostRef();
    expect(Posted.isValidPostRef(札)).toBe(true);
    const 封 = mod.buildPostingEnvelope({ site: "kakuyomu", workId: "1", title: "題", body: "本文", postRef: 札 });
    const 読んだ = Envelope.parseEnvelope(typeof 封 === "string" ? 封 : JSON.stringify(封));
    expect(読んだ.ok).toBe(true);
    expect(読んだ.envelope.postRef).toBe(札);
  });

  it("章立ての episodeId を受け手がそのまま受け取る", async () => {
    const { parseChaptersClipboard } = await import(/* @vite-ignore */ 読み口("chapterEnvelope.ts"));
    const 封 = {
      "novelai-chapters": 1,
      site: "kakuyomu",
      workId: "1177354054000000000",
      pageUrl: "https://kakuyomu.jp/my/works/1177354054000000000",
      readAt: "2026-11-04T09:00:00.000+09:00",
      episodes: [
        { heading: "１話　潮の匂い", part: "第一章『岬』", episodeId: "16816927859000000123" },
        { heading: "２話　古い地図", part: "第一章『岬』" },
      ],
    };
    const r = parseChaptersClipboard(JSON.stringify(封));
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    expect(r.droppedEpisodeIds).toBe(0);
    expect(JSON.stringify(r.outline)).toContain("16816927859000000123");
  });
});
