import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 裏方（background.js。service worker）を、Chrome の代わりの作り物の中で動かす（0.8.0）。
 *
 * 本物の Chrome で押して確かめるのは実機の領分だが、**つなぎ方**——どの画面で押したら
 * どの処理へ入り、何を知らせ、いつ VS Code を呼ぶか——は、ここで確かめられる。
 * 作り物は、裏方が使う chrome.* を記録するだけ（ページにもクリップボードにも触れない）。
 */

function 作り物のChrome({ クリップボード = "", ページの返事 = {}, 置けるか = true } = {}) {
  const 記録 = { 知らせ: [], 向けたURL: [], ページへ: [], 印: [], 右クリック: [], 開いた: 0, 閉じた: 0 };
  const 受け口 = {};
  const 足す = (名) => ({ addListener: (f) => (受け口[名] = f) });
  const chrome = {
    runtime: {
      id: "self",
      lastError: undefined,
      getURL: (p) => `chrome-extension://self/${p}`,
      getManifest: () => JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8")),
      getContexts: async () => [],
      sendMessage: async (依頼) => {
        if (依頼.target !== "offscreen-clipboard") {
          return undefined;
        }
        if (依頼.type === "read") {
          return { ok: true, text: クリップボード };
        }
        記録.置いた = 依頼.text;
        return 置けるか ? { ok: true } : { ok: false, detail: "作り物" };
      },
      onMessage: 足す("message"),
      onInstalled: 足す("installed"),
      openOptionsPage: () => (記録.開いた += 1),
    },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => (記録.閉じた += 1),
    },
    notifications: { create: (o, cb) => (記録.知らせ.push(o), cb && cb()) },
    tabs: {
      sendMessage: (tabId, 依頼, cb) => {
        記録.ページへ.push(依頼);
        cb(ページの返事[依頼.type]);
      },
      update: (tabId, 変更, cb) => (記録.向けたURL.push(変更.url), cb && cb()),
      get: async () => ({}),
      query: (_q, cb) => cb([]),
      onUpdated: 足す("updated"),
      onActivated: 足す("activated"),
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: 足す("focus") },
    action: {
      onClicked: 足す("clicked"),
      setBadgeText: async (o) => 記録.印.push(o),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    contextMenus: {
      onClicked: 足す("menu"),
      update: (id, o, cb) => (記録.右クリック.push(o), cb && cb()),
      removeAll: (cb) => cb(),
      create: (o, cb) => ((記録.作った項目 = o), cb && cb()),
    },
  };
  const 場 = { chrome, console, setTimeout, URL };
  場.globalThis = 場;
  場.importScripts = (...files) => {
    for (const f of files) {
      vm.runInContext(readFileSync(join(ルート, f), "utf8"), 場, { filename: f });
    }
  };
  vm.createContext(場);
  vm.runInContext(readFileSync(join(ルート, "background.js"), "utf8"), 場, { filename: "background.js" });
  return { 記録, 受け口 };
}

/** 押したあとの非同期の処理が片付くまで待つ。 */
const 片付くまで = () => new Promise((r) => setTimeout(r, 0));

const 作品ID = "1177354054934574437";
const 話の作成画面 = `https://kakuyomu.jp/my/works/${作品ID}/episodes/new`;
const 作品管理 = `https://kakuyomu.jp/my/works/${作品ID}`;

describe("アイコンを押したとき（作り物の Chrome で）", () => {
  it("読者の反応の画面：読んで、クリップボードへ置き、知らせて、VS Code を呼ぶ", async () => {
    const { 記録, 受け口 } = 作り物のChrome({
      ページの返事: { read: { ok: true, json: '{"x":1}', counts: { work: 2, day: 0, episode: 219 }, hasNextPage: false } },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
    expect(記録.置いた).toBe('{"x":1}');
    expect(記録.知らせ).toHaveLength(1);
    expect(記録.知らせ[0].title).toBe("読者の反応をコピーしました");
    expect(記録.知らせ[0].message).toContain("読者の反応 221件");
    expect(記録.向けたURL).toEqual(["vscode://nonahisa.novel-ai-assistant/import-reader-stats"]);
    // 受け渡しのページは、用が済んだら閉じる
    expect(記録.閉じた).toBe(1);
  });

  it("クリップボードへ置けなかったときは、VS Code を呼ばない", async () => {
    const { 記録, 受け口 } = 作り物のChrome({
      置けるか: false,
      ページの返事: { read: { ok: true, json: "{}", counts: { work: 1 }, hasNextPage: false } },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    await 片付くまで();
    expect(記録.知らせ[0].title).toBe("コピーできませんでした");
    expect(記録.向けたURL).toEqual([]);
  });

  it("ページが読めなかったときも、VS Code を呼ばない", async () => {
    const { 記録, 受け口 } = 作り物のChrome({ ページの返事: { read: { ok: false, reason: "no-data" } } });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    expect(記録.知らせ[0].title).toBe("コピーできませんでした");
    expect(記録.知らせ[0].message).toContain("ページの形が変わったようです");
    expect(記録.向けたURL).toEqual([]);
  });

  it("話の作成画面：クリップボードの原稿を照合してから、ページへ渡す。VS Code は呼ばない", async () => {
    const 封 = JSON.stringify({ "novelai-post": 1, site: "kakuyomu", workId: 作品ID, title: "題", body: "本文" });
    const { 記録, 受け口 } = 作り物のChrome({ クリップボード: 封, ページの返事: { fill: { accepted: true } } });
    受け口.clicked({ id: 7, url: 話の作成画面 });
    await 片付くまで();
    await 片付くまで();
    expect(記録.ページへ).toHaveLength(1);
    expect(記録.ページへ[0].type).toBe("fill");
    expect(記録.ページへ[0].envelope.body).toBe("本文");
    expect(記録.ページへ[0].workIdChecked).toBe(true);
    // 結果はページ側から "fill-result" で届くまで知らせない
    expect(記録.知らせ).toHaveLength(0);
    expect(記録.向けたURL).toEqual([]);

    受け口.message(
      { type: "fill-result", result: { ok: true, message: "本文欄を入れました。" }, workIdChecked: true },
      { id: "self", tab: { id: 7, active: true }, url: 話の作成画面 }
    );
    expect(記録.知らせ[0].title).toBe("貼り込みました");
    expect(記録.知らせ[0].message).toBe("本文欄を入れました。");
  });

  it("別の作品の原稿なら、ページへ渡さずに理由を知らせる", async () => {
    const 封 = JSON.stringify({ "novelai-post": 1, site: "kakuyomu", workId: "999", title: "題", body: "本文" });
    const { 記録, 受け口 } = 作り物のChrome({ クリップボード: 封 });
    受け口.clicked({ id: 7, url: 話の作成画面 });
    await 片付くまで();
    await 片付くまで();
    expect(記録.ページへ).toHaveLength(0);
    expect(記録.知らせ[0].title).toBe("入れられませんでした");
    expect(記録.知らせ[0].message).toContain("作品「999」の投稿画面ではないようです");
  });

  it("できることが無い画面：ページへも VS Code へも触れず、理由を知らせる", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.clicked({ id: 7, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.ページへ).toHaveLength(0);
    expect(記録.向けたURL).toEqual([]);
    expect(記録.知らせ[0].title).toBe("この画面ではできることがありません");
  });

  it("右クリックの項目からも、同じ処理へ入る（タブのURLが無いときはページのURLを使う）", async () => {
    const { 記録, 受け口 } = 作り物のChrome({ ページの返事: { read: { ok: false, reason: "login" } } });
    受け口.menu({ menuItemId: "novelai-helper-run", pageUrl: 作品管理 }, { id: 7 });
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
  });
});

describe("アイコンの印と右クリックの項目（作り物の Chrome で）", () => {
  it("ページが開いた知らせで、そのタブに印を付け、選ばれているタブなら右クリックも合わせる", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.message({ type: "page-opened" }, { id: "self", tab: { id: 3, active: true }, url: 話の作成画面 });
    await 片付くまで();
    expect(記録.印).toEqual([{ tabId: 3, text: "貼" }]);
    expect(記録.右クリック).toEqual([
      { title: "統合小説執筆環境ヘルパー：この画面に貼り込む", visible: true },
    ]);
  });

  it("できることの無いページでは印を外し、右クリックの項目を隠す", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.message(
      { type: "page-opened" },
      { id: "self", tab: { id: 3, active: true }, url: `https://kakuyomu.jp/my/works/${作品ID}/episodes/123` }
    );
    await 片付くまで();
    expect(記録.印).toEqual([{ tabId: 3, text: "" }]);
    expect(記録.右クリック[0].visible).toBe(false);
  });

  it("ほかの拡張から届いた知らせは受けない", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.message({ type: "page-opened" }, { id: "other", tab: { id: 3, active: true }, url: 話の作成画面 });
    受け口.message(
      { type: "fill-result", result: { ok: true, message: "x" } },
      { id: "other", tab: { id: 3 }, url: 話の作成画面 }
    );
    await 片付くまで();
    expect(記録.印).toEqual([]);
    expect(記録.知らせ).toEqual([]);
  });

  it("入れた直後：右クリックの項目を隠した状態で作り、説明のページを1回だけ開く", () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.installed({ reason: "install" });
    expect(記録.作った項目.visible).toBe(false);
    expect(記録.作った項目.documentUrlPatterns).toContain("https://db.narou.fun/works/*");
    expect(記録.開いた).toBe(1);
    受け口.installed({ reason: "update" });
    expect(記録.開いた).toBe(1);
  });
});
