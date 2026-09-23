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
const { actionForPage, vscodeLinkAfter, VSCODE_IMPORT_URL, BADGES } = require("../common/actions.js");

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

  it("読者の反応を読める画面なら、読み取り。印は「読」", () => {
    for (const url of [画面.作品管理, 画面.アクセス数, 画面.NarouFun]) {
      const 行い = できること(url);
      expect(行い.kind, url).toBe("stats");
      expect(行い.badgeText, url).toBe("読");
      expect(行い.badgeColor, url).toBe(BADGES.stats.color);
      expect(行い.title, url).toBe("統合小説執筆環境ヘルパー：この画面の読者の反応をコピーする");
    }
  });

  it("アルファポリスの話の作成画面は貼り込み（読み取りは止めてあるので、作品管理では何もしない）", () => {
    expect(できること(画面.アルファポリスの話の作成画面).kind).toBe("fill");
    expect(できること(画面.アルファポリスの作品管理).kind).toBe(null);
  });

  it("できることが無い画面では、印を付けず、名前だけを言う", () => {
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
      expect(行い.badgeText, url).toBe("");
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

  it("印は1文字で、2つは字も色も違う", () => {
    expect([...BADGES.fill.text]).toHaveLength(1);
    expect([...BADGES.stats.text]).toHaveLength(1);
    expect(BADGES.fill.text).not.toBe(BADGES.stats.text);
    expect(BADGES.fill.color).not.toBe(BADGES.stats.color);
  });
});

describe("読み取りのあとに VS Code を呼ぶか（0.8.0）", () => {
  it("読者の反応をクリップボードへ置けたときだけ呼ぶ", () => {
    expect(vscodeLinkAfter({ kind: "stats", copied: true })).toBe(VSCODE_IMPORT_URL);
  });

  it("置けなかったとき・貼り込みのあと・何もしなかったときは呼ばない", () => {
    expect(vscodeLinkAfter({ kind: "stats", copied: false })).toBe(null);
    expect(vscodeLinkAfter({ kind: "fill", copied: true })).toBe(null);
    expect(vscodeLinkAfter({ kind: null, copied: true })).toBe(null);
    expect(vscodeLinkAfter(null)).toBe(null);
  });

  it("リンクは統合小説執筆環境の取り込み口で、データを載せない", () => {
    expect(VSCODE_IMPORT_URL).toBe("vscode://nonahisa.novel-ai-assistant/import-reader-stats");
    expect(VSCODE_IMPORT_URL).not.toMatch(/[?#]/);
  });

  it("裏方は、読み取りでクリップボードへ置けたあとにだけリンクを求める", () => {
    // 呼ぶ条件（vscodeLinkAfter）を通さずにタブを向けていないことを、ソースで見張る
    const js = 読む("background.js");
    const 置けた位置 = js.indexOf("const 置けた = await クリップボードに頼む({ type: \"write\"");
    const 求める位置 = js.indexOf("Actions.vscodeLinkAfter({ kind: \"stats\", copied: true })");
    expect(置けた位置).toBeGreaterThan(0);
    expect(求める位置).toBeGreaterThan(置けた位置);
    // タブを向けるのは VSCodeを呼ぶ の中の1か所だけ
    expect(js.match(/chrome\.tabs\.update\(/g)).toHaveLength(1);
  });
});

describe("押した結果の知らせ（0.8.0）", () => {
  it("見出しで、できた・できなかったを先に言う", () => {
    expect(Messages.notificationFor("fill", true, "x").title).toBe("貼り込みました");
    expect(Messages.notificationFor("fill", false, "x").title).toBe("入れられませんでした");
    expect(Messages.notificationFor("stats", true, "x").title).toBe("読者の反応をコピーしました");
    expect(Messages.notificationFor("stats", false, "x").title).toBe("コピーできませんでした");
    expect(Messages.notificationFor(null, false, "x").title).toBe("この画面ではできることがありません");
    // 処理中・思わぬ失敗を「この画面ではできることがありません」と言わない
    expect(Messages.notificationFor("busy", false, "x").title).toBe("まだ前の分を処理しています");
    expect(Messages.notificationFor("error", false, "x").title).toBe("思わぬ問題が起きました");
  });

  it("本文は、ポップアップの頃に出していた文をそのまま使う", () => {
    const 文 = Messages.messageForStatsCopied({ work: 1, day: 29, episode: 0 }, false);
    expect(Messages.notificationFor("stats", true, 文).message).toBe(文);
    expect(文).toContain("読者の反応 30件");
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

  it("アイコンは 16・32・48・128 の4つで、どれも実在し、その大きさの PNG", () => {
    for (const 置き場 of [manifest.icons, manifest.action.default_icon]) {
      expect(Object.keys(置き場).sort()).toEqual(["128", "16", "32", "48"]);
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

  it("印と右クリックの項目は、どちらも actionForPage から作る（判定を写さない）", () => {
    const 印 = js.slice(js.indexOf("async function 印を付ける"), js.indexOf("function 右クリックを合わせる"));
    const 右 = js.slice(js.indexOf("function 右クリックを合わせる"), js.indexOf("async function タブのURL"));
    expect(印).toContain("Actions.actionForPage(見立てる(url))");
    expect(右).toContain("Actions.actionForPage(見立てる(url))");
    expect(右).toContain("visible: 行い.kind !== null");
  });

  it("右クリックの項目は、この拡張の入るページだけに出す（範囲は manifest から読む）", () => {
    expect(js).toContain("documentUrlPatterns: 入るページの範囲()");
    expect(js).toMatch(/content_scripts[\s\S]*?\.matches/);
  });

  it("説明のページは、入れた直後に1回だけ開く（更新のたびには開かない）", () => {
    expect(js).toMatch(/if \(details\.reason === "install"\) \{\s*chrome\.runtime\.openOptionsPage\(\);/);
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
