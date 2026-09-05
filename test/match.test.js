import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { checkTarget, hostMatches, siteForHost, extractWorkId } = require("../common/match.js");
const { SITES, siteById } = require("../content/sites.js");

const カクヨムの投稿画面 = "https://kakuyomu.jp/my/works/16816927859000000000/episodes/new";

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
    const result = checkTarget(封筒(), "https://www.alphapolis.co.jp/manage/novel/1/episode/new", SITES);
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

  it("アルファポリスの投稿画面（推測パス）で通る", () => {
    const result = checkTarget(
      { site: "alphapolis", workId: "1177354", title: "題", body: "本文" },
      "https://www.alphapolis.co.jp/manage/novel/1177354/episode/new",
      SITES
    );
    expect(result.ok).toBe(true);
  });
});

describe("作品IDの照合をしないサイト", () => {
  it("表に作品IDの取り出し方が無ければ、照合を飛ばして通す", () => {
    // アルファポリスの作品IDはURL上で2つの数字に分かれており、封筒のIDと
    // 正しく突き合わせられるか実機で確かめられていない。**間違った一致**を
    // 「合っている」と読むほうが、照合しないより危ない（取り違え防止が無効化される）。
    const site = siteById("alphapolis");
    expect(site.workIdPatterns).toEqual([]);

    const result = checkTarget(
      { site: "alphapolis", workId: "1177354", title: "題", body: "本文" },
      "https://www.alphapolis.co.jp/manage/novel/9999999/episode/new",
      SITES
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
