import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// ブラウザでは background.js の importScripts の順番がこれを保証している（表の2つが先）。
const Messages = require("../common/messages.js");
require("../common/match.js");
const { SITES } = require("../content/sites.js");
const { STATS_SITES } = require("../content/statsSites.js");
const { describePage } = require("../common/pageState.js");
const { actionForPage, vscodeLinkAfter, VSCODE_IMPORT_URL, BADGES, stashBadgeText } = require("../common/actions.js");

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const 読む = (名) => readFileSync(join(ルート, 名), "utf8");
const manifest = JSON.parse(読む("manifest.json"));

/**
 * アイコン・右クリックだけで、いまの画面でできる1つのことを実行する（0.8.0。
 * 作者の依頼、2026-09-23）。
 *
 * ここで確かめたいのは、**どのページで何ができるか → 印・右クリックの文言・実行する処理**
 * が1本の判定（describePage）から出ていること。印が「貼」なのに押すと断られる、
 * 右クリックに出ているのに押すと別のことをする、が起きないこと。
 */

const 作品ID = "1177354054934574437";
const 画面 = {
  話の作成画面: `https://kakuyomu.jp/my/works/${作品ID}/episodes/new`,
  作品管理: `https://kakuyomu.jp/my/works/${作品ID}`,
  アクセス数: `https://kakuyomu.jp/works/${作品ID}/accesses`,
  NarouFun: "https://db.narou.fun/works/N1234AB",
  カクヨムの作品ページ: `https://kakuyomu.jp/works/${作品ID}`,
  カクヨムのトップ: "https://kakuyomu.jp/",
  アルファポリスの作品管理: "https://www.alphapolis.co.jp/manage/novel/123456",
  アルファポリスの話の作成画面: "https://www.alphapolis.co.jp/manage/novel/123456/episode/new",
  なろう本体: "https://ncode.syosetu.com/n1234ab/",
  関係の無いサイト: "https://example.com/",
  拡張の設定画面: "chrome://extensions/",
};

const できること = (url) => actionForPage(describePage(url, SITES, STATS_SITES));

describe("いまの画面でできる1つのこと（0.8.0）", () => {
  it("話の作成画面なら、貼り込み。印は「貼」", () => {
    const 行い = できること(画面.話の作成画面);
    expect(行い.kind).toBe("fill");
    expect(行い.badgeText).toBe("貼");
    expect(行い.badgeColor).toBe(BADGES.fill.color);
    expect(行い.title).toBe("統合小説執筆環境ヘルパー：この画面に貼り込む");
  });

  it("読者の反応を読める画面なら、まとめて渡す（0.9.0）。印は「読」、溜まっていれば「読3」", () => {
    for (const url of [画面.作品管理, 画面.アクセス数, 画面.NarouFun]) {
      const 行い = できること(url);
      expect(行い.kind, url).toBe("stats");
      expect(行い.badgeText, url).toBe("読");
      expect(行い.badgeColor, url).toBe(BADGES.stats.color);
      expect(行い.title, url).toBe("統合小説執筆環境ヘルパー：読者の反応をまとめて渡す");
      const 溜まって = actionForPage(describePage(url, SITES, STATS_SITES), { stashCount: 3 });
      expect(溜まって.badgeText, url).toBe("読3");
    }
  });

  it("まだ覚えていない作品の画面なら、自分の作品か訊く（0.9.0）。印は「?」", () => {
    const 行い = actionForPage(describePage(画面.NarouFun, SITES, STATS_SITES), { needsApproval: true, stashCount: 2 });
    expect(行い.kind).toBe("approve");
    expect(行い.badgeText).toBe("?");
    expect(行い.badgeColor).toBe(BADGES.approve.color);
    expect(行い.title).toBe("統合小説執筆環境ヘルパー：この作品を自分の作品として覚える");
  });

  it("溜まりがあれば、ほかの画面では「まとめて渡す」。このタブだけの印は付けない（全体の印が出る）", () => {
    for (const url of [画面.カクヨムの作品ページ, 画面.関係の無いサイト, 画面.拡張の設定画面]) {
      const 行い = actionForPage(describePage(url, SITES, STATS_SITES), { stashCount: 2 });
      expect(行い.kind, url).toBe("hand");
      expect(行い.badgeText, url).toBe(null);
      expect(行い.title, url).toBe("統合小説執筆環境ヘルパー：溜まった読者の反応をまとめて渡す");
    }
    // 話の作成画面では、溜まりがあっても貼り込み
    expect(actionForPage(describePage(画面.話の作成画面, SITES, STATS_SITES), { stashCount: 2 }).kind).toBe("fill");
  });

  it("全体の印の字：溜まりの件数（無ければ空。100件からは 99+）", () => {
    expect(stashBadgeText(0)).toBe("");
    expect(stashBadgeText(1)).toBe("読1");
    expect(stashBadgeText(50)).toBe("読50");
    expect(stashBadgeText(120)).toBe("読99+");
    // 印に収まる4字まで
    expect([...stashBadgeText(120)].length).toBeLessThanOrEqual(4);
  });

  it("アルファポリスの話の作成画面は貼り込み（読み取りは止めてあるので、作品管理では何もしない）", () => {
    expect(できること(画面.アルファポリスの話の作成画面).kind).toBe("fill");
    expect(できること(画面.アルファポリスの作品管理).kind).toBe(null);
  });

  it("できることが無い画面では、このタブだけの印を付けず、名前だけを言う", () => {
    for (const url of [
      画面.カクヨムの作品ページ,
      画面.カクヨムのトップ,
      画面.アルファポリスの作品管理,
      画面.なろう本体,
      画面.関係の無いサイト,
      画面.拡張の設定画面,
      "",
    ]) {
      const 行い = できること(url);
      expect(行い.kind, url).toBe(null);
      expect(行い.badgeText, url).toBe(null);
      expect(行い.badgeColor, url).toBe(null);
      expect(行い.title, url).toBe("統合小説執筆環境ヘルパー");
    }
    // 見立てが無い（null）ときも同じ
    expect(actionForPage(null).kind).toBe(null);
  });

  it("印・右クリックの文言と実行は、見立て（describePage）の可否と食い違わない", () => {
    for (const url of Object.values(画面)) {
      const 見立て = describePage(url, SITES, STATS_SITES);
      const 行い = actionForPage(見立て);
      if (行い.kind === "fill") {
        expect(見立て.canFill, url).toBe(true);
      }
      if (行い.kind === "stats") {
        expect(見立て.canReadStats, url).toBe(true);
      }
      if (行い.kind === null) {
        expect(見立て.canFill && 見立て.canReadStats, url).toBe(false);
      }
    }
  });

  it("印は1文字で、3つは字も色も違う", () => {
    const 印たち = [BADGES.fill, BADGES.stats, BADGES.approve];
    for (const 印 of 印たち) {
      expect([...印.text]).toHaveLength(1);
    }
    expect(new Set(印たち.map((b) => b.text)).size).toBe(3);
    expect(new Set(印たち.map((b) => b.color)).size).toBe(3);
  });
});

describe("「統合小説執筆環境へ渡す」を切っているとき（0.11.0）", () => {
  const 切って = (url, 様子) => actionForPage(describePage(url, SITES, STATS_SITES), Object.assign({ handToIde: false }, 様子));

  it("読者の反応の画面では、押すと集計を開く。印は件数の無い「読」", () => {
    for (const url of [画面.作品管理, 画面.アクセス数, 画面.NarouFun]) {
      const 行い = 切って(url, { stashCount: 3 });
      expect(行い.kind, url).toBe("report");
      expect(行い.badgeText, url).toBe("読");
      expect(行い.badgeColor, url).toBe(BADGES.stats.color);
      expect(行い.title, url).toBe("統合小説執筆環境ヘルパー：読者の反応の集計を見る");
      expect(行い.menuVisible, url).toBe(true);
    }
  });

  it("まだ覚えていない作品の画面では、これまでどおり自分の作品か訊く（記録するために要る）", () => {
    const 行い = 切って(画面.NarouFun, { needsApproval: true });
    expect(行い.kind).toBe("approve");
    expect(行い.badgeText).toBe("?");
    expect(行い.menuVisible).toBe(true);
  });

  it("話の作成画面では、切っていても貼り込む（0.11.1。作者の裁定）。印は「貼」、右クリックの項目も出す", () => {
    const 行い = 切って(画面.話の作成画面, { stashCount: 3 });
    expect(行い.kind).toBe("fill");
    expect(行い.badgeText).toBe("貼");
    expect(行い.badgeColor).toBe(BADGES.fill.color);
    expect(行い.title).toBe("統合小説執筆環境ヘルパー：この画面に貼り込む");
    expect(行い.menuVisible).toBe(true);
  });

  it("ほかの画面では、溜まりがあっても渡さない。印も右クリックの項目も出さず、押すと集計を開く", () => {
    for (const url of [画面.カクヨムの作品ページ, 画面.関係の無いサイト, 画面.拡張の設定画面, ""]) {
      const 行い = 切って(url, { stashCount: 5 });
      expect(行い.kind, url).toBe("report");
      expect(行い.badgeText, url).toBe(null);
      expect(行い.menuVisible, url).toBe(false);
    }
  });

  it("入っているとき（指定が無いときも）は、これまでどおり。右クリックの項目は、できることがあれば出す", () => {
    expect(actionForPage(describePage(画面.作品管理, SITES, STATS_SITES), { handToIde: true, stashCount: 2 })).toMatchObject({
      kind: "stats",
      badgeText: "読2",
      menuVisible: true,
    });
    expect(できること(画面.話の作成画面).menuVisible).toBe(true);
    expect(できること(画面.関係の無いサイト).menuVisible).toBe(false);
  });

  it("切っているときは、VS Code を呼ばない", () => {
    expect(vscodeLinkAfter({ kind: "report", copied: true })).toBe(null);
  });
});

describe("渡したあとに VS Code を呼ぶか（0.8.0、0.9.0 で「まとめて渡す」）", () => {
  it("読者の反応をクリップボードへ置けたときだけ呼ぶ", () => {
    expect(vscodeLinkAfter({ kind: "stats", copied: true })).toBe(VSCODE_IMPORT_URL);
    expect(vscodeLinkAfter({ kind: "hand", copied: true })).toBe(VSCODE_IMPORT_URL);
  });

  it("置けなかったとき・貼り込みのあと・訊いたとき・何もしなかったときは呼ばない", () => {
    expect(vscodeLinkAfter({ kind: "stats", copied: false })).toBe(null);
    expect(vscodeLinkAfter({ kind: "hand", copied: false })).toBe(null);
    expect(vscodeLinkAfter({ kind: "approve", copied: true })).toBe(null);
    expect(vscodeLinkAfter({ kind: "fill", copied: true })).toBe(null);
    expect(vscodeLinkAfter({ kind: null, copied: true })).toBe(null);
    expect(vscodeLinkAfter(null)).toBe(null);
  });

  it("リンクは統合小説執筆環境の取り込み口で、データを載せない", () => {
    expect(VSCODE_IMPORT_URL).toBe("vscode://nonahisa.novel-ai-assistant/import-reader-stats");
    expect(VSCODE_IMPORT_URL).not.toMatch(/[?#]/);
  });

  it("裏方は、クリップボードへ置けたあとにだけリンクを求める", () => {
    // 呼ぶ条件（vscodeLinkAfter）を通さずにタブを向けていないことを、ソースで見張る。
    // リンクを求める場所（まとめて渡す・もう一度渡す）は、どれも「置けた」のあとにある
    const js = 読む("background.js");
    const 求める = js.split('Actions.vscodeLinkAfter({ kind: "hand", copied: true })').length - 1;
    expect(求める).toBe(2);
    const まとめて = js.slice(js.indexOf("async function まとめて渡す"), js.indexOf("async function もう一度渡す"));
    expect(まとめて.indexOf("if (!置いた.ok)")).toBeGreaterThan(0);
    expect(まとめて.indexOf("Actions.vscodeLinkAfter")).toBeGreaterThan(まとめて.indexOf("if (!置いた.ok)"));
    const もう一度 = js.slice(js.indexOf("async function もう一度渡す"), js.indexOf("async function 読み直して渡す"));
    expect(もう一度.indexOf("if (!置けた.ok)")).toBeGreaterThan(0);
    expect(もう一度.indexOf("Actions.vscodeLinkAfter")).toBeGreaterThan(もう一度.indexOf("if (!置けた.ok)"));
    // タブを向けるのは VSCodeを呼ぶ の中の1か所だけ
    expect(js.match(/chrome\.tabs\.update\(/g)).toHaveLength(1);
  });
});

describe("押した結果の知らせ（0.8.0）", () => {
  it("見出しで、できた・できなかったを先に言う", () => {
    expect(Messages.notificationFor("fill", true, "x").title).toBe("貼り込みました");
    expect(Messages.notificationFor("fill", false, "x").title).toBe("入れられませんでした");
    expect(Messages.notificationFor("stats", true, "x").title).toBe("読者の反応をまとめて渡しました");
    expect(Messages.notificationFor("stats", false, "x").title).toBe("渡せませんでした");
    expect(Messages.notificationFor("hand", true, "x").title).toBe("読者の反応をまとめて渡しました");
    expect(Messages.notificationFor("hand", false, "x").title).toBe("渡せませんでした");
    expect(Messages.notificationFor("approved", true, "x").title).toBe("ご自分の作品として覚えました");
    expect(Messages.notificationFor(null, false, "x").title).toBe("この画面ではできることがありません");
    // 処理中・思わぬ失敗を「この画面ではできることがありません」と言わない
    expect(Messages.notificationFor("busy", false, "x").title).toBe("まだ前の分を処理しています");
    expect(Messages.notificationFor("error", false, "x").title).toBe("思わぬ問題が起きました");
  });

  it("本文は、作った文をそのまま使う", () => {
    const 文 = Messages.messageForHanded({ pages: 1, works: 1, entries: 30 }, { counts: { work: 1, day: 29, episode: 0 } });
    expect(Messages.notificationFor("hand", true, 文).message).toBe(文);
    expect(文).toContain("この画面からは 30件");
  });

  it("できることが無い画面では、どこでなら何ができるかまで言う", () => {
    const 文 = Messages.messageForNothingHere(describePage(画面.カクヨムの作品ページ, SITES, STATS_SITES));
    expect(文).toContain("貼り込み：");
    expect(文).toContain("話の作成画面");
    expect(文).toContain("読者の反応：");
    expect(文).toContain("作品管理");
  });

  it("理由が2つとも同じなら、1回だけ言う", () => {
    const 知らないサイト = Messages.messageForNothingHere(
      describePage(画面.関係の無いサイト, SITES, STATS_SITES)
    );
    expect(知らないサイト).toBe("統合小説執筆環境ヘルパーが使える画面ではありません。");
    const 設定画面 = Messages.messageForNothingHere(describePage(画面.拡張の設定画面, SITES, STATS_SITES));
    expect(設定画面).toBe("この画面では使えません。");
  });
});

describe("名前とアイコン（0.8.0）", () => {
  it("manifest の名前と、ツールバーの説明が「統合小説執筆環境ヘルパー」", () => {
    expect(manifest.name).toBe(Messages.APP_NAME);
    expect(manifest.name).toBe("統合小説執筆環境ヘルパー");
    expect(manifest.action.default_title).toBe(Messages.APP_NAME);
  });

  it("ポップアップは無い（アイコンを押すと、いまの画面でできることを実行する）", () => {
    expect(manifest.action.default_popup).toBeUndefined();
    expect(manifest.background.service_worker).toBe("background.js");
    expect(existsSync(join(ルート, "popup.html"))).toBe(false);
  });

  it("アイコンはどれも実在し、その大きさの PNG（一覧用は 16・32・48・128、ツールバー用は 16・24・32。0.12.2）", () => {
    expect(Object.keys(manifest.icons).sort()).toEqual(["128", "16", "32", "48"]);
    expect(Object.keys(manifest.action.default_icon).sort()).toEqual(["16", "24", "32"]);
    for (const 置き場 of [manifest.icons, manifest.action.default_icon]) {
      for (const [大きさ, 相対] of Object.entries(置き場)) {
        const 中身 = readFileSync(join(ルート, 相対));
        // PNG の見出し（8バイト）と、IHDR の幅・高さ
        expect(中身.subarray(1, 4).toString("latin1"), 相対).toBe("PNG");
        expect(中身.readUInt32BE(16), 相対).toBe(Number(大きさ));
        expect(中身.readUInt32BE(20), 相対).toBe(Number(大きさ));
      }
    }
  });

  it("知らせの絵は、実在するアイコンを使う", () => {
    const js = 読む("background.js");
    const 絵 = js.match(/getURL\("([^"]+\.png)"\)/);
    expect(絵).not.toBeNull();
    expect(existsSync(join(ルート, 絵[1]))).toBe(true);
  });
});

describe("裏方のつなぎ（0.8.0）", () => {
  const js = 読む("background.js");

  it("アイコン・右クリックの両方から、同じ実行へ入る", () => {
    expect(js).toMatch(/chrome\.action\.onClicked\.addListener\(\(tab\) => \{\s*実行する\(tab\);/);
    expect(js).toMatch(/chrome\.contextMenus\.onClicked\.addListener[\s\S]*?実行する\(tab, info\.pageUrl\)/);
  });

  it("印と右クリックの項目は、どちらも同じ決め方（できることを決める）から作る（判定を写さない）", () => {
    const 印 = js.slice(js.indexOf("async function 印を付ける"), js.indexOf("async function 右クリックを合わせる"));
    const 右 = js.slice(js.indexOf("async function 右クリックを合わせる"), js.indexOf("async function タブのURL"));
    const 実行 = js.slice(js.indexOf("async function 実行する"), js.indexOf("chrome.action.onClicked"));
    for (const 部分 of [印, 右, 実行]) {
      expect(部分).toContain("await できることを決める(url)");
    }
    // 0.11.0：出す・出さないも決める関数の答え（menuVisible）をそのまま使う
    expect(右).toContain("visible: 行い.menuVisible");
    // actionForPage を呼ぶのは、決める関数の1か所だけ
    expect(js.split("Actions.actionForPage(").length - 1).toBe(1);
  });

  it("右クリックの項目は、この拡張の入るページだけに出す（範囲は manifest から読む）", () => {
    expect(js).toContain("documentUrlPatterns: 入るページの範囲()");
    expect(js).toMatch(/content_scripts[\s\S]*?\.matches/);
  });

  it("説明のページは、入れた直後に1回だけ開く（更新のたびには開かない）", () => {
    expect(js).toMatch(/if \(details\.reason === "install"\) \{\s*chrome\.runtime\.openOptionsPage\(\);/);
  });

  it("切っているときにアイコンを押したら、集計を開く（0.11.0。できることを決めた答えの report から）", () => {
    const 実行 = js.slice(js.indexOf("async function 実行する"), js.indexOf("chrome.action.onClicked"));
    expect(実行).toMatch(/kind === "report"[\s\S]*?集計を開く\(\)/);
  });

  it("「開いた」の知らせを送るのは、この拡張が入るページだけ（content script の最後）", () => {
    const js一覧 = manifest.content_scripts.flatMap((c) => c.js);
    expect(js一覧[js一覧.length - 1]).toBe("content/announce.js");
  });
});

/**
 * 画面に出す文言に、開発中の内輪の呼び名を使わない（作者の指示）。
 * 見るのは**文字列とHTMLの本文だけ**——コメントや名前（関数の「封筒」など）は開発の言葉のままでよい。
 */
describe("画面の文言に内輪の呼び名を使わない", () => {
  const 内輪の呼び名 = /母艦|封筒|台帳|貼り込み係/;

  /** JavaScript からコメントを落とし、文字列の中身だけを集める（正規表現の直書きは無い前提のファイルだけに使う）。 */
  function 文字列だけ(src) {
    const 集め = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      const 次 = src[i + 1];
      if (c === "/" && 次 === "/") {
        const 行末 = src.indexOf("\n", i);
        i = 行末 < 0 ? src.length : 行末;
        continue;
      }
      if (c === "/" && 次 === "*") {
        const 閉じ = src.indexOf("*/", i + 2);
        i = 閉じ < 0 ? src.length : 閉じ + 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        let 中身 = "";
        while (j < src.length && src[j] !== c) {
          if (src[j] === "\\") {
            中身 += src[j + 1];
            j += 2;
            continue;
          }
          中身 += src[j];
          j += 1;
        }
        集め.push(中身);
        i = j + 1;
        continue;
      }
      i += 1;
    }
    return 集め;
  }

  it("文言の表・裏方・受け渡しのページ・説明のページの文字列", () => {
    for (const 名 of ["common/messages.js", "common/actions.js", "background.js", "offscreen.js", "options.js"]) {
      for (const 文 of 文字列だけ(読む(名))) {
        expect(文, `${名}：${文}`).not.toMatch(内輪の呼び名);
      }
    }
  });

  it("説明のページと受け渡しのページの本文（HTMLのコメントは除く）", () => {
    for (const 名 of ["options.html", "offscreen.html"]) {
      const 本文 = 読む(名).replace(/<!--[\s\S]*?-->/g, "");
      expect(本文, 名).not.toMatch(内輪の呼び名);
    }
  });

  it("manifest の名前・説明・ツールバーの説明", () => {
    for (const 文 of [manifest.name, manifest.description, manifest.action.default_title]) {
      expect(文).not.toMatch(内輪の呼び名);
    }
  });

  it("検査そのものが働いている（コメントは外し、文字列は拾う）", () => {
    expect(文字列だけ('// 母艦\nconst a = "封筒"; /* 台帳 */')).toEqual(["封筒"]);
  });
});

/**
 * ページへ入る範囲（0.9.0）。アクセス数のページ送り（`?page=2`）にも入ること。
 *
 * Chrome の一致の決まり（match pattern）は、**パスと問い合わせ（`?` から後ろ）をまとめて**照合する
 * （Chromium の URLPattern は GURL::PathForRequest と照合する。これはパス＋問い合わせ）。
 * だから `…/accesses` だけでは `…/accesses?page=2` に入らない。前の版の注記どおり、
 * 2ページ目以降では印も付かず、押しても「動いていません」になっていたはず。
 * ここでは、その決まりを写した小さな照合で、manifest の範囲を確かめる。
 */
describe("ページへ入る範囲（0.9.0）", () => {
  /** Chrome の match pattern を、この拡張で使う形（https・固定のホスト・* だけ）に限って照合する。 */
  function 入るか(パターン, url) {
    const m = /^https:\/\/([^/]+)(\/.*)$/.exec(パターン);
    const u = new URL(url);
    if (!m || u.protocol !== "https:" || u.host !== m[1]) {
      return false;
    }
    const 形 = new RegExp("^" + m[2].split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return 形.test(u.pathname + u.search);
  }
  const 範囲 = manifest.content_scripts.flatMap((c) => c.matches);
  const 入る = (url) => 範囲.some((p) => 入るか(p, url));

  it("照合そのものが、問い合わせを含めて見ている", () => {
    expect(入るか("https://kakuyomu.jp/works/*/accesses", "https://kakuyomu.jp/works/1/accesses")).toBe(true);
    expect(入るか("https://kakuyomu.jp/works/*/accesses", "https://kakuyomu.jp/works/1/accesses?page=2")).toBe(false);
  });

  it("アクセス数の1ページ目にも、2ページ目以降にも入る", () => {
    expect(入る(`https://kakuyomu.jp/works/${作品ID}/accesses`)).toBe(true);
    expect(入る(`https://kakuyomu.jp/works/${作品ID}/accesses?page=2`)).toBe(true);
    expect(入る(`https://kakuyomu.jp/works/${作品ID}/accesses?page=5`)).toBe(true);
  });

  it("広げすぎていない（作品の公開ページ・話の本文のページには入らない）", () => {
    expect(入る(`https://kakuyomu.jp/works/${作品ID}`)).toBe(false);
    expect(入る(`https://kakuyomu.jp/works/${作品ID}/episodes/123`)).toBe(false);
    expect(入る(`https://kakuyomu.jp/works/${作品ID}/accesses_x`)).toBe(false);
  });

  it("公募の一覧の3ページに入り、ツクリテミライのページ送り（?page=2）にも入る（0.12.0）", () => {
    expect(入る("https://creative-story.net/bungakusyou/")).toBe(true);
    expect(入る("https://creative-story.net/202111contest/")).toBe(true);
    expect(入る("https://tsukuritemirai.com/kobo/novel/")).toBe(true);
    expect(入る("https://tsukuritemirai.com/kobo/novel/?page=2")).toBe(true);
    // 同じサイトのほかのページ（記事・漫画の公募・詳しいページ）には入らない
    expect(入る("https://creative-story.net/")).toBe(false);
    expect(入る("https://creative-story.net/bungakusyou/some-article/")).toBe(false);
    expect(入る("https://tsukuritemirai.com/kobo/manga/")).toBe(false);
    expect(入る("https://tsukuritemirai.com/kobo/abc123")).toBe(false);
  });
});

describe("公募の一覧のページ（0.12.0）", () => {
  // ブラウザでは background.js の importScripts が、pageState より先にこの表を読む
  require("../content/contestSites.js");
  const { VSCODE_CONTESTS_URL } = require("../common/actions.js");
  const 一覧 = [
    "https://creative-story.net/bungakusyou/",
    "https://creative-story.net/202111contest/",
    "https://tsukuritemirai.com/kobo/novel/?page=3",
  ];

  it("押すと公募の一覧を渡す。印は「募」", () => {
    for (const url of 一覧) {
      const 見立て = describePage(url, SITES, STATS_SITES);
      expect(見立て.kind, url).toBe("contests");
      const 行い = actionForPage(見立て, { stashCount: 3 });
      expect(行い.kind, url).toBe("contests");
      expect(行い.badgeText).toBe("募");
      expect(行い.badgeColor).toBe(BADGES.contests.color);
      expect(行い.title).toBe("統合小説執筆環境ヘルパー：公募の一覧を統合小説執筆環境へ渡す");
      expect(行い.menuVisible).toBe(true);
    }
  });

  it("「統合小説執筆環境へ渡す」を切っていても、コピーはする（集計は開かない）", () => {
    const 行い = actionForPage(describePage(一覧[0], SITES, STATS_SITES), { handToIde: false });
    expect(行い.kind).toBe("contests");
    expect(行い.title).toBe("統合小説執筆環境ヘルパー：公募の一覧をコピーする");
  });

  it("渡したあとに呼ぶのは公募の取り込み口（データはリンクに載せない）", () => {
    expect(vscodeLinkAfter({ kind: "contests", copied: true })).toBe(VSCODE_CONTESTS_URL);
    expect(VSCODE_CONTESTS_URL).toBe("vscode://nonahisa.novel-ai-assistant/import-contests");
    expect(VSCODE_CONTESTS_URL).not.toMatch(/[?#]/);
    // 置けなかったときは呼ばない
    expect(vscodeLinkAfter({ kind: "contests", copied: false })).toBeNull();
    // 読者の反応の取り込み口は、これまでどおり
    expect(vscodeLinkAfter({ kind: "hand", copied: true })).toBe(VSCODE_IMPORT_URL);
  });

  it("読めた数と読めなかった数を両方言い、読めないときの貼り付けの道を添える", () => {
    const 文 = Messages.messageForContestsHanded({ count: 18, skipped: 2, paged: true }, true);
    expect(文).toContain("公募 18件");
    expect(文).toContain("名前を読めなかった 2件");
    expect(文).toContain("公募の一覧を貼り付けて取り込む");
    expect(文).toContain("次のページ");
    const 切 = Messages.messageForContestsHanded({ count: 5, skipped: 0, paged: false }, false);
    expect(切).toContain("クリップボードへコピーしました");
    expect(切).not.toContain("VS Code が前に出て取り込みます。");
    expect(Messages.messageForContestsRead({ ok: false, reason: "no-cards" })).toContain("1件も読めませんでした");
    expect(Messages.messageForContestsRead({ ok: false, reason: "no-cards" })).toContain("全部選んでコピー");
  });
});
