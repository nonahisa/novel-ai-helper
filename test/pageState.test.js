import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// 見立ては両方の表とドメインの照合を借りる（写しを作らない）。
// ブラウザでは popup.html の <script> の順番がこれを保証している。
require("../common/match.js");
const { checkTarget } = require("../common/match.js");
const { SITES } = require("../content/sites.js");
const { STATS_SITES } = require("../content/statsSites.js");
const { describePage } = require("../common/pageState.js");
const { messageForPageState } = require("../common/messages.js");

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 開いている画面の見立て（0.3.0。作者の依頼「開いた画面を認識して、表示するボタンを
 * 調整するとかできないですかね？」）。
 *
 * ここで守りたいのは2つ。
 *   1. **押す前に、使える画面かどうかが分かる**（どの画面でも理由が1行出る）
 *   2. **見立ては守りではない**——見立てが「貼り込める」と言っても、押したあとの
 *      照合（checkTarget）が断れば貼り込まない。二重の守りを外していないこと
 */

const 見立てる = (url) => describePage(url, SITES, STATS_SITES);

// 2026-09-22 実機で確かめた形のURL（作品IDは実機のもの）
const 作品ID = "1177354054934574437";
const 話の作成画面 = `https://kakuyomu.jp/my/works/${作品ID}/episodes/new`;
const 作品管理 = `https://kakuyomu.jp/my/works/${作品ID}`;
const アクセス数 = `https://kakuyomu.jp/works/${作品ID}/accesses`;

/*
  アルファポリスは**貼り込みは使えるが、読み取りは止めてある**（statsSites.js の
  supported: false。管理画面を実機で見られていないため）。URLの形は実機未確認なので、
  sites.js が見当を付けている形を借りる——ここで確かめたいのは URL の正しさではなく、
  「読み取りが止まっているサイトへ、読み取りの道案内をしない」ことである。
*/
const アルファポリスの作品管理 = "https://www.alphapolis.co.jp/manage/novel/123456";
const アルファポリスの話の作成画面 = "https://www.alphapolis.co.jp/manage/novel/123456/episode/new";

describe("開いている画面の見立て", () => {
  it("話の作成画面なら、貼り込めて、反応は読めない", () => {
    const 見立て = 見立てる(話の作成画面);
    expect(見立て.kind).toBe("fill");
    expect(見立て.canFill).toBe(true);
    expect(見立て.canReadStats).toBe(false);
    expect(見立て.siteId).toBe("kakuyomu");
    expect(見立て.siteLabel).toBe("カクヨム");
    expect(見立て.pageLabel).toBe("話の作成画面");
  });

  it("作品管理なら、反応を読めて、貼り込めない", () => {
    const 見立て = 見立てる(作品管理);
    expect(見立て.kind).toBe("stats");
    expect(見立て.canFill).toBe(false);
    expect(見立て.canReadStats).toBe(true);
    expect(見立て.pageLabel).toBe("作品管理");
    expect(見立て.pageKind).toBe("work");
  });

  it("アクセス数なら、反応を読めて、ページ送りのある画面だと分かる", () => {
    const 見立て = 見立てる(アクセス数);
    expect(見立て.kind).toBe("stats");
    expect(見立て.canReadStats).toBe(true);
    expect(見立て.pageLabel).toBe("アクセス数");
    // 「このページの50話ぶん」を出し分けるのは、表示名ではなくこちら
    expect(見立て.pageKind).toBe("accesses");
  });

  it("末尾の / が付いていても同じ見立てになる（実機のURLは両方ありうる）", () => {
    expect(見立てる(`${話の作成画面}/`).kind).toBe("fill");
    expect(見立てる(`${作品管理}/`).kind).toBe("stats");
    expect(見立てる(`${アクセス数}/`).kind).toBe("stats");
  });

  it("対応サイトの別のページでは、どちらも使えない（でもサイトは分かる）", () => {
    const 見立て = 見立てる("https://kakuyomu.jp/");
    expect(見立て.kind).toBe("knownSiteOtherPage");
    expect(見立て.canFill).toBe(false);
    expect(見立て.canReadStats).toBe(false);
    expect(見立て.siteId).toBe("kakuyomu");
    expect(見立て.pageLabel).toBeNull();
  });

  it("作品の公開ページ・話の編集画面も、別のページ扱い", () => {
    // 読者として見るページ（/my/ が付かない作品ページ）
    expect(見立てる(`https://kakuyomu.jp/works/${作品ID}`).kind).toBe("knownSiteOtherPage");
    // 既にある話の編集（新規作成ではないので貼り込まない）
    expect(見立てる(`https://kakuyomu.jp/my/works/${作品ID}/episodes/123`).kind).toBe(
      "knownSiteOtherPage"
    );
  });

  it("対応していないサイトでは、サイトも分からない", () => {
    const 見立て = 見立てる("https://example.com/");
    expect(見立て.kind).toBe("unknownSite");
    expect(見立て.siteId).toBeNull();
    expect(見立て.siteLabel).toBeNull();
  });

  it("枠だけ置いてあるサイト（なろう）は、対応していないサイトとして扱う", () => {
    // 表には在るが supported: false。「話の作成画面で使えます」と案内すると、
    // いつまで待っても使えない画面へ作者を歩かせることになる
    expect(見立てる("https://ncode.syosetu.com/n0000aa/").kind).toBe("unknownSite");
  });

  it("URLが無い・読めないときは noUrl", () => {
    for (const url of ["", "chrome://extensions", "about:blank", "edge://settings", null, undefined]) {
      const 見立て = 見立てる(url);
      expect(見立て.kind, String(url)).toBe("noUrl");
      expect(見立て.canFill).toBe(false);
      expect(見立て.canReadStats).toBe(false);
    }
  });

  it("読み取りを止めてあるサイトは、statsSupported が false（カクヨムは true）", () => {
    expect(見立てる(作品管理).statsSupported).toBe(true);
    expect(見立てる("https://kakuyomu.jp/").statsSupported).toBe(true);
    // アルファポリスは貼り込みだけ使える。サイトは分かるが、読み取りは止まっている
    const 見立て = 見立てる(アルファポリスの作品管理);
    expect(見立て.kind).toBe("knownSiteOtherPage");
    expect(見立て.siteId).toBe("alphapolis");
    expect(見立て.canFill).toBe(false);
    expect(見立て.statsSupported).toBe(false);
    // 話の作成画面（貼り込める画面）でも、読み取りが止まっているのは変わらない
    expect(見立てる(アルファポリスの話の作成画面).kind).toBe("fill");
    expect(見立てる(アルファポリスの話の作成画面).statsSupported).toBe(false);
  });

  it("対応していないサイト・読めない画面も statsSupported は false", () => {
    expect(見立てる("https://example.com/").statsSupported).toBe(false);
    expect(見立てる("chrome://extensions").statsSupported).toBe(false);
  });

  it("似たドメインに引っかからない（照合は match.js を借りている）", () => {
    expect(見立てる(`https://evilkakuyomu.jp/my/works/${作品ID}/episodes/new`).kind).toBe(
      "unknownSite"
    );
  });
});

describe("ボタンの下の1行", () => {
  /** 6つの場面を、実際の見立てから作る（文言のテストだけ架空の形を使わない）。 */
  const 場面 = {
    話の作成画面: 見立てる(話の作成画面),
    作品管理: 見立てる(作品管理),
    アクセス数: 見立てる(アクセス数),
    対応サイトの別のページ: 見立てる("https://kakuyomu.jp/"),
    対応していないサイト: 見立てる("https://example.com/"),
    URLが読めない: 見立てる("chrome://extensions"),
  };

  it("どの場面でも、2つのボタンの両方に理由が出る（空にしない）", () => {
    for (const [名, 見立て] of Object.entries(場面)) {
      const 理由 = messageForPageState(見立て);
      expect(理由.fill.length, `${名} の貼り込みの理由が空`).toBeGreaterThan(0);
      expect(理由.stats.length, `${名} の読み取りの理由が空`).toBeGreaterThan(0);
    }
  });

  it("見立てが無くても（null）落ちずに理由が出る", () => {
    const 理由 = messageForPageState(null);
    expect(理由.fill.length).toBeGreaterThan(0);
    expect(理由.stats.length).toBeGreaterThan(0);
  });

  it("話の作成画面では、サイト名と「母艦でコピーしてから」を言う", () => {
    const 理由 = messageForPageState(場面.話の作成画面);
    expect(理由.fill).toContain("カクヨム");
    expect(理由.fill).toContain("母艦");
    // 使えないほうは、どこでなら使えるかを言う
    expect(理由.stats).toContain("作品管理");
  });

  it("作品管理では、読み取りが使えると言い、貼り込みは道案内をする", () => {
    const 理由 = messageForPageState(場面.作品管理);
    expect(理由.stats).toContain("作品管理");
    expect(理由.fill).toBe("話の作成画面で使えます。");
  });

  it("アクセス数では、**押す前に**「このページの50話ぶん」と言う（0.2.2 は押したあとだった）", () => {
    expect(messageForPageState(場面.アクセス数).stats).toContain("50話ぶん");
    // 作品管理では言わない（ページ送りがあるのはアクセス数だけ）
    expect(messageForPageState(場面.作品管理).stats).not.toContain("50話");
  });

  /*
    **どちらが得かを、押す前に読み比べられるようにする**（0.4.0）。
    作品管理は1回で全話ぶんが入り、アクセス数は50話ずつ5回かかる。
    0.3.0 までは作品管理で「カクヨムの作品管理です。」としか言わず、
    全話ぶんが読めること自体が画面のどこにも出ていなかった。
  */
  it("作品管理では、作品全体と全話ぶんを読むと言う", () => {
    const 文 = messageForPageState(場面.作品管理).stats;
    expect(文).toContain("作品全体");
    expect(文).toContain("全話ぶん");
    // 0.5.0：離脱率と日のグラフの材料も読むことを、押す前に言う
    expect(文).toContain("各話の更新日");
    expect(文).toContain("直近の日ごとのPV");
    // アクセス数では読まないので言わない
    expect(messageForPageState(場面.アクセス数).stats).not.toContain("更新日");
  });

  /*
    **いつまで歩いても着かない道案内をしない。** アルファポリスは読み取りを止めてあるので、
    「作品管理・アクセス数の画面で使えます」と言うと、その画面を開いた作者が
    もう一度同じ場所で断られる。使えないと言うより悪い。
  */
  it("読み取りを止めてあるサイトでは、読み取りの道案内をしない", () => {
    for (const url of [アルファポリスの作品管理, アルファポリスの話の作成画面]) {
      const 理由 = messageForPageState(見立てる(url));
      expect(理由.stats, url).not.toContain("作品管理・アクセス数の画面で使えます");
      expect(理由.stats, url).toContain("アルファポリス");
      expect(理由.stats, url).toContain("まだ読み取れません");
      // できないことだけ言って終わらない。代わりの道（母艦の手入力）まで言う
      expect(理由.stats, url).toContain("手入力");
    }
  });

  it("読み取りを止めてあるサイトでも、貼り込みの案内は今までどおり出る", () => {
    // 読み取りが止まっていることと、貼り込めることは別の話（巻き添えにしない）
    expect(messageForPageState(見立てる(アルファポリスの話の作成画面)).fill).toContain("母艦");
    expect(messageForPageState(見立てる(アルファポリスの作品管理)).fill).toBe(
      "話の作成画面で使えます。"
    );
  });

  it("カクヨムでは、これまでどおり読み取りの道案内を出す（止めすぎていない）", () => {
    expect(messageForPageState(場面.話の作成画面).stats).toContain("作品管理");
    expect(messageForPageState(場面.対応サイトの別のページ).stats).toBe(
      "作品管理・アクセス数の画面で使えます。"
    );
  });

  it("対応していない画面では、2つとも同じことを言う", () => {
    for (const 見立て of [場面.対応していないサイト, 場面.URLが読めない]) {
      const 理由 = messageForPageState(見立て);
      expect(理由.fill).toBe(理由.stats);
    }
  });

  it("表示名を持たない見立てでも、文が壊れない（undefined が出ない）", () => {
    const 理由 = messageForPageState({ kind: "fill", canFill: true });
    expect(理由.fill).not.toContain("undefined");
    expect(理由.fill).toContain("話の作成画面");
  });
});

describe("押せなくするのは見た目であって、守りではない", () => {
  /*
    0.3.0 で足したのは「押す前に分かる」ことだけで、**押したあとの確かめは1つも
    外していない**。見立ては開いているURLしか見ないので、クリップボードの封筒が
    別の作品・別のサイト宛てでも canFill は true になる。そこを断るのは checkTarget。
  */
  it("見立てが「貼り込める」と言っても、別の作品の封筒は checkTarget が断る", () => {
    expect(見立てる(話の作成画面).canFill).toBe(true);
    const 結果 = checkTarget(
      { site: "kakuyomu", workId: "9999999999999999999", title: "題", body: "本文" },
      話の作成画面,
      SITES
    );
    expect(結果.ok).toBe(false);
    expect(結果.reason).toBe("work-mismatch");
  });

  it("見立てが「貼り込める」と言っても、別サイト宛ての封筒は checkTarget が断る", () => {
    const 結果 = checkTarget(
      { site: "alphapolis", title: "題", body: "本文" },
      話の作成画面,
      SITES
    );
    expect(結果.ok).toBe(false);
    expect(結果.reason).toBe("site-mismatch");
  });

  it("popup.js は、押したあとの照合を今も通している", () => {
    // 見立てを足したついでに「もう要らない」と外されていないことを、ソースで見張る。
    // ここが消えた日は、取り違え防止そのものが消えた日である
    const js = readFileSync(join(ルート, "popup.js"), "utf8");
    expect(js).toContain("Match.checkTarget(");
    expect(js).toContain("StatsSites.matchReadPage(");
  });

  it("見立てが付かないときは、ボタンを押せるままにする（守りは押したあとにある）", () => {
    // popup.js の 見立てどおりにする() が、見立て null のとき disabled を外すこと。
    // 押せなくして黙るより、押させて既存の守りに理由を言わせるほうが作者は困らない
    const js = readFileSync(join(ルート, "popup.js"), "utf8");
    expect(js).toMatch(/if\s*\(!見立て\)\s*\{[\s\S]*?button\.disabled\s*=\s*false/);
  });
});

/**
 * Narou.fun の作品ページ（0.6.0。母艦の残課題 B11）。
 *
 * 読むだけのサイトなので、貼り込みのボタンに「話の作成画面で使えます」と書かない
 * （このサイトのどこかに話の作成画面があるように読める）。読み取りの道案内は、
 * カクヨムの「作品管理・アクセス数」ではなく作品ページを指す。
 */
describe("Narou.fun の作品ページの見立て（0.6.0）", () => {
  // Nコードは架空
  const 作品ページ = "https://db.narou.fun/works/N1234AB";

  it("作品ページなら、反応を読めて、貼り込めない", () => {
    const 見立て = 見立てる(作品ページ);
    expect(見立て.kind).toBe("stats");
    expect(見立て.canReadStats).toBe(true);
    expect(見立て.canFill).toBe(false);
    expect(見立て.siteId).toBe("narouFun");
    expect(見立て.siteLabel).toBe("Narou.fun");
    expect(見立て.pageKind).toBe("narouFun");
  });

  it("押す前に、何を読むかと、照合は母艦がすることを言う", () => {
    const 理由 = messageForPageState(見立てる(作品ページ));
    expect(理由.stats).toContain("Narou.fun");
    expect(理由.stats).toContain("週間読者");
    expect(理由.stats).toContain("ご自分の作品");
    // カクヨムの作品管理の但し書き（全話ぶん・50話ぶん）を言わない
    expect(理由.stats).not.toContain("全話ぶん");
    expect(理由.stats).not.toContain("50話");
    // 読むだけのサイト。話の作成画面へ案内しない
    expect(理由.fill).toContain("貼り込みはしません");
    expect(理由.fill).not.toContain("話の作成画面");
  });

  it("Narou.fun の別のページでは、作品ページを案内する（カクヨムの画面を案内しない）", () => {
    const 見立て = 見立てる("https://db.narou.fun/search?userid=1");
    expect(見立て.kind).toBe("knownSiteOtherPage");
    const 理由 = messageForPageState(見立て);
    expect(理由.stats).toContain("db.narou.fun/works/");
    expect(理由.stats).not.toContain("アクセス数");
    expect(理由.fill).not.toContain("話の作成画面");
  });

  it("なろう本体と KASASAGI は、これまでどおり使えないサイト", () => {
    for (const url of [
      "https://ncode.syosetu.com/n1234ab/",
      "https://kasasagi.hinaproject.com/access/top/ncode/N1234AB/",
    ]) {
      expect(見立てる(url).kind, url).toBe("unknownSite");
      expect(見立てる(url).canReadStats, url).toBe(false);
    }
  });
});
