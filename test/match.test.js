import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { checkTarget, hostMatches, siteForHost, extractWorkId } = require("../common/match.js");
const { SITES, siteById } = require("../content/sites.js");

const カクヨムの投稿画面 = "https://kakuyomu.jp/my/works/16816927859000000000/episodes/new";
// アルファポリスの新しい話の投稿画面（2026-11-01 作者の Chrome で読んだ形。作品IDは架空の9桁）
const アルファポリスの投稿画面 = "https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789";

function 封筒(上書き = {}) {
  return Object.assign({ site: "kakuyomu", title: "題", body: "本文" }, 上書き);
}

describe("ドメインの照合", () => {
  it("完全一致と下位ドメインだけを認める", () => {
    expect(hostMatches("kakuyomu.jp", ["kakuyomu.jp"])).toBe(true);
    expect(hostMatches("www.kakuyomu.jp", ["kakuyomu.jp"])).toBe(true);
    expect(hostMatches("KAKUYOMU.JP", ["kakuyomu.jp"])).toBe(true);
  });

  it("よく似た別ドメインは通さない", () => {
    expect(hostMatches("evilkakuyomu.jp", ["kakuyomu.jp"])).toBe(false);
    expect(hostMatches("kakuyomu.jp.example.com", ["kakuyomu.jp"])).toBe(false);
    expect(hostMatches("kakuyomu.co.jp", ["kakuyomu.jp"])).toBe(false);
  });

  it("ホスト名から表のサイトを引ける", () => {
    expect(siteForHost("kakuyomu.jp", SITES).id).toBe("kakuyomu");
    expect(siteForHost("www.alphapolis.co.jp", SITES).id).toBe("alphapolis");
    expect(siteForHost("example.com", SITES)).toBeNull();
  });
});

describe("作品IDの取り出し", () => {
  it("カクヨムのパスから作品IDを取れる", () => {
    const site = siteById("kakuyomu");
    expect(extractWorkId("/my/works/16816927859000000000/episodes/new", site)).toBe(
      "16816927859000000000"
    );
  });

  it("作品IDの無いパスでは null", () => {
    const site = siteById("kakuyomu");
    expect(extractWorkId("/my/works", site)).toBeNull();
  });
});

describe("貼り込み先の照合", () => {
  it("サイトも画面も作品も合っていれば通る", () => {
    const result = checkTarget(封筒({ workId: "16816927859000000000" }), カクヨムの投稿画面, SITES);
    expect(result.ok).toBe(true);
    expect(result.siteId).toBe("kakuyomu");
    expect(result.workId).toBe("16816927859000000000");
  });

  it("別のサイトを開いていたら止める", () => {
    const result = checkTarget(封筒(), アルファポリスの投稿画面, SITES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("site-mismatch");
  });

  it("まったく関係ないページでも止める", () => {
    const result = checkTarget(封筒(), "https://example.com/", SITES);
    expect(result.reason).toBe("site-mismatch");
  });

  it("URLが読めないタブでは止める", () => {
    expect(checkTarget(封筒(), "", SITES).reason).toBe("bad-url");
    expect(checkTarget(封筒(), "chrome://extensions", SITES).reason).not.toBe("ok");
  });

  it("同じサイトでも、話の作成画面でなければ止める", () => {
    const 作品の管理画面 = "https://kakuyomu.jp/my/works/16816927859000000000";
    const result = checkTarget(封筒(), 作品の管理画面, SITES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not-post-page");
  });

  it("別の作品の投稿画面なら止める（複数タブでの取り違え）", () => {
    const result = checkTarget(封筒({ workId: "999" }), カクヨムの投稿画面, SITES);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("work-mismatch");
    expect(result.expectedWorkId).toBe("999");
    expect(result.actualWorkId).toBe("16816927859000000000");
  });

  it("封筒に作品IDが無ければ、サイトと画面の一致だけで通す", () => {
    const result = checkTarget(封筒(), カクヨムの投稿画面, SITES);
    expect(result.ok).toBe(true);
  });

  it("枠だけ置いてあるサイト（なろう）には貼り込まない", () => {
    const result = checkTarget(
      封筒({ site: "narou" }),
      "https://syosetu.com/usernovelmanage/top/",
      SITES
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported-site");
  });

  it("アルファポリスの新しい話の投稿画面で通り、作品IDも照合する（0.14.2）", () => {
    const result = checkTarget(
      { site: "alphapolis", workId: "123456789", title: "題", body: "本文" },
      アルファポリスの投稿画面,
      SITES
    );
    expect(result.ok).toBe(true);
    expect(result.siteId).toBe("alphapolis");
    expect(result.workId).toBe("123456789");
    expect(result.workIdChecked).toBe(true);
    // 末尾のスラッシュがあっても同じ
    expect(checkTarget({ site: "alphapolis", workId: "123456789", body: "本文" }, アルファポリスの投稿画面 + "/", SITES).ok).toBe(true);
  });

  it("アルファポリスの別の作品の投稿画面なら止める（取り違え）", () => {
    const result = checkTarget(
      { site: "alphapolis", workId: "987654321", title: "題", body: "本文" },
      アルファポリスの投稿画面,
      SITES
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("work-mismatch");
  });

  it("アルファポリスの話の編集画面・作品の管理画面・推測で書いていた古いパスでは貼り込まない", () => {
    for (const url of [
      "https://www.alphapolis.co.jp/mypage/content/detail/123456789",
      "https://www.alphapolis.co.jp/mypage/content",
      "https://www.alphapolis.co.jp/manage/novel/123456789/episode/new",
      "https://www.alphapolis.co.jp/novel/123456789/episode/new",
    ]) {
      const result = checkTarget({ site: "alphapolis", body: "本文" }, url, SITES);
      expect(result.ok, url).toBe(false);
      expect(result.reason, url).toBe("not-post-page");
    }
  });

  it("0.20.0：話の編集画面にも貼り込める。どちらの画面かを pageKind で返し、作品IDの照合はそのまま効く", () => {
    const 編集 = [
      ["kakuyomu", "https://kakuyomu.jp/my/works/1177354054800000001/episodes/16816927859000000123", "1177354054800000001"],
      ["alphapolis", "https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789/987654", "123456789"],
    ];
    for (const [site, url, workId] of 編集) {
      const 合う = checkTarget({ site, workId, body: "本文" }, url, SITES);
      expect(合う.ok, url).toBe(true);
      expect(合う.pageKind, url).toBe("edit");
      expect(合う.workIdChecked, url).toBe(true);
      // 同じ作品の編集画面でも、作品IDが違えば止まる
      const 違う = checkTarget({ site, workId: "999", body: "本文" }, url, SITES);
      expect(違う.reason, url).toBe("work-mismatch");
    }
    // 新規作成の画面は post
    expect(checkTarget({ site: "kakuyomu", body: "本文" }, "https://kakuyomu.jp/my/works/1/episodes/new", SITES).pageKind).toBe("post");
    // 末尾が固定されている（話の下のページでは貼らない）
    expect(checkTarget({ site: "kakuyomu", body: "本文" }, "https://kakuyomu.jp/my/works/1/episodes/2/preview", SITES).reason).toBe("not-post-page");
  });
});

describe("作品IDの照合をしないサイト", () => {
  it("表に作品IDの取り出し方が無ければ、照合を飛ばして通す", () => {
    // 作品IDの形が分からないサイトでは、**間違った一致**を「合っている」と読むほうが、
    // 照合しないより危ない（取り違え防止が無効化される）。0.14.1 まではアルファポリスがこの形だった。
    // アルファポリスに取り出し方を書いた（0.14.2）ので、架空のサイトの表で確かめる
    const 架空のサイト = [
      {
        id: "alphapolis",
        label: "架空",
        supported: true,
        hosts: ["www.alphapolis.co.jp"],
        postPagePatterns: [/^\/mypage\/novel\/save_episode\/\d+\/?$/],
        workIdPatterns: [],
        fields: {},
      },
    ];
    const result = checkTarget(
      { site: "alphapolis", workId: "1177354", title: "題", body: "本文" },
      "https://www.alphapolis.co.jp/mypage/novel/save_episode/999999999",
      架空のサイト
    );
    // 作品IDが違っていても止まらない。代わりに「照合していない」ことを持ち帰る。
    expect(result.ok).toBe(true);
    expect(result.workIdChecked).toBe(false);
    expect(result.workId).toBeNull();
  });

  it("照合できるサイトでは、照合したことを持ち帰る", () => {
    const result = checkTarget(封筒({ workId: "16816927859000000000" }), カクヨムの投稿画面, SITES);
    expect(result.ok).toBe(true);
    expect(result.workIdChecked).toBe(true);
  });

  it("取り出し方が在るのにIDが読めないときは、これまで通り止める", () => {
    // 表に workIdPatterns が在る＝突き合わせられるはずのサイト。
    // それで読めないのはページの形が変わったということなので、貼り込まない。
    const 架空のサイト = [
      {
        id: "kakuyomu",
        label: "架空",
        supported: true,
        hosts: ["kakuyomu.jp"],
        postPagePatterns: [/^\/my\/works\/new$/],
        workIdPatterns: [/^\/my\/works\/(\d+)\//],
        fields: {},
      },
    ];
    const result = checkTarget(封筒({ workId: "1" }), "https://kakuyomu.jp/my/works/new", 架空のサイト);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("work-id-not-found");
  });
});
