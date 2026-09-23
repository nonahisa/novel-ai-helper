import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 裏方（background.js。service worker）を、Chrome の代わりの作り物の中で動かす（0.8.0、0.9.0 で溜まりを足した）。
 *
 * 本物の Chrome で押して確かめるのは実機の領分だが、**つなぎ方**——どの画面で押したら
 * どの処理へ入り、何を知らせ、いつ VS Code を呼び、何を溜めるか——は、ここで確かめられる。
 * 作り物は、裏方が使う chrome.* を記録するだけ（ページにもクリップボードにも触れない）。
 * 保存（chrome.storage.local）は、作り物の中の入れ物に置く。
 */

/**
 * 渡す … 「統合小説執筆環境へ渡す」の設定（0.11.0）。これまでのテストは入っている前提なので、既定は true。
 *        null なら設定を保存に置かない（入れたとき・更新したときの決め方を確かめるため）。
 */
function 作り物のChrome({ クリップボード = "", ページの返事 = {}, 置けるか = true, 保存 = {}, 渡す = true } = {}) {
  const 記録 = {
    知らせ: [],
    問い: [],
    向けたURL: [],
    ページへ: [],
    印: [],
    全体の印: [],
    右クリック: [],
    置いた: undefined,
    開いた: 0,
    閉じた: 0,
    作った項目たち: [],
  };
  const 入れ物 = JSON.parse(JSON.stringify(保存));
  if (渡す !== null && !("helperSettings" in 入れ物)) {
    入れ物.helperSettings = { handToIde: 渡す, decidedBy: "author" };
  }
  const 受け口 = {};
  const 足す = (名) => ({ addListener: (f) => (受け口[名] = f) });
  const 返事を作る = (依頼, tabId) => {
    const r = ページの返事[依頼.type];
    return typeof r === "function" ? r(tabId, 依頼) : r;
  };
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
    storage: {
      local: {
        get: async (鍵) => (鍵 in 入れ物 ? { [鍵]: JSON.parse(JSON.stringify(入れ物[鍵])) } : {}),
        set: async (値) => {
          for (const [k, v] of Object.entries(値)) {
            入れ物[k] = JSON.parse(JSON.stringify(v));
          }
        },
      },
    },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => (記録.閉じた += 1),
    },
    notifications: {
      // 知らせは create(内容, cb)、問いは create(ID, 内容, cb) で呼ばれる
      create: (a, b, c) => {
        if (typeof a === "string") {
          記録.問い.push(Object.assign({ id: a }, b));
          if (c) c();
          return;
        }
        記録.知らせ.push(a);
        if (b) b();
      },
      clear: (_id, cb) => cb && cb(),
      onButtonClicked: 足す("button"),
    },
    tabs: {
      sendMessage: (tabId, 依頼, cb) => {
        記録.ページへ.push(Object.assign({ tabId }, 依頼));
        cb(返事を作る(依頼, tabId));
      },
      update: (tabId, 変更, cb) => (記録.向けたURL.push(変更.url), cb && cb()),
      get: async () => ({}),
      query: (_q, cb) => cb([]),
      onUpdated: 足す("updated"),
      onActivated: 足す("activated"),
      onRemoved: 足す("removed"),
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: 足す("focus") },
    action: {
      onClicked: 足す("clicked"),
      setBadgeText: async (o) => ("tabId" in o ? 記録.印.push(o) : 記録.全体の印.push(o.text)),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    contextMenus: {
      onClicked: 足す("menu"),
      update: (id, o, cb) => (記録.右クリック.push(o), cb && cb()),
      removeAll: (cb) => cb(),
      // 項目は2つ作る（ページの上の項目と、アイコンの右クリックの「集計を見る」。0.10.0）
      create: (o, cb) => {
        記録.作った項目たち.push(o);
        if (o.id === "novelai-helper-run") 記録.作った項目 = o;
        if (cb) cb();
      },
    },
  };
  // 開いてから読むまでの待ち（1.5秒）を、テストでは待たない
  const すぐ = (f) => setTimeout(f, 0);
  const 場 = { chrome, console, setTimeout: すぐ, URL, Date };
  場.globalThis = 場;
  場.importScripts = (...files) => {
    for (const f of files) {
      vm.runInContext(readFileSync(join(ルート, f), "utf8"), 場, { filename: f });
    }
  };
  vm.createContext(場);
  vm.runInContext(readFileSync(join(ルート, "background.js"), "utf8"), 場, { filename: "background.js" });
  const 状態 = () => 入れ物.helperState || { items: [], ownWorks: [] };
  const 集計の記録 = () => 入れ物.readerHistory || { works: [] };
  const 設定 = () => 入れ物.helperSettings;
  return { 記録, 受け口, 状態, 集計の記録, 設定 };
}

/** 押したあとの非同期の処理が片付くまで待つ。 */
const 片付くまで = async (回 = 12) => {
  for (let i = 0; i < 回; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

const 作品ID = "1177354054934574437";
const 話の作成画面 = `https://kakuyomu.jp/my/works/${作品ID}/episodes/new`;
const 作品管理 = `https://kakuyomu.jp/my/works/${作品ID}`;
const アクセス数 = `https://kakuyomu.jp/works/${作品ID}/accesses`;
const 他人のアクセス数 = "https://kakuyomu.jp/works/16816927859000000000/accesses";
const 自分のNarouFun = "https://db.narou.fun/works/N1234AB";
const 他人のNarouFun = "https://db.narou.fun/works/n9999zz";

/** 読み取り係の返事（読んだURLを添える形）。 */
function 読めた(url, site, workId, counts) {
  return {
    ok: true,
    url,
    json: JSON.stringify({
      "novelai-stats": 1,
      site,
      workId,
      readAt: "2026-09-23T05:00:00.000Z",
      entries: [{ scope: "work", metrics: { pv: 1 } }],
    }),
    counts: counts || { work: 1, day: 0, episode: 0 },
    hasNextPage: false,
  };
}

const 開いた = (受け口, tabId, url) =>
  受け口.message({ type: "page-opened" }, { id: "self", tab: { id: tabId, active: true }, url });

describe("開いたら溜める（0.9.0）", () => {
  it("カクヨムの作品管理を開くと、読んで溜め、その作品を覚える。全体の印は「読1」", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
    expect(状態().items).toHaveLength(1);
    expect(状態().ownWorks.map((w) => w.workId)).toEqual([作品ID]);
    expect(記録.全体の印).toContain("読1");
    // 開いただけでは、知らせも VS Code も出さない
    expect(記録.知らせ).toEqual([]);
    expect(記録.向けたURL).toEqual([]);
    // クリップボードにも触れない
    expect(記録.置いた).toBeUndefined();
  });

  it("他人の Narou.fun のページを開いても、ページへ読みに行かず、何も溜まらない。印は「?」", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      ページの返事: { read: 読めた(他人のNarouFun, "narou", "n9999zz") },
    });
    開いた(受け口, 3, 他人のNarouFun);
    await 片付くまで();
    expect(記録.ページへ).toEqual([]);
    expect(状態().items).toEqual([]);
    expect(記録.印.at(-1)).toEqual({ tabId: 3, text: "?" });
  });

  it("覚えていない作品のカクヨムのアクセス数も、開いても溜まらない（誰の作品でも開けるため）", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      ページの返事: { read: 読めた(他人のアクセス数, "kakuyomu", "16816927859000000000") },
    });
    開いた(受け口, 3, 他人のアクセス数);
    await 片付くまで();
    expect(記録.ページへ).toEqual([]);
    expect(状態().items).toEqual([]);
  });

  it("同じ画面を2度開いても1件（置き換え）。アクセス数の2ページ目は別の1件", async () => {
    let 何回目 = 0;
    const { 受け口, 状態 } = 作り物のChrome({
      ページの返事: {
        read: (tabId) => {
          何回目 += 1;
          if (tabId === 4) return 読めた(`${アクセス数}?page=2`, "kakuyomu", 作品ID);
          if (tabId === 5) return 読めた(アクセス数, "kakuyomu", 作品ID);
          return 読めた(作品管理, "kakuyomu", 作品ID);
        },
      },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    開いた(受け口, 6, 作品管理);
    await 片付くまで();
    開いた(受け口, 5, アクセス数);
    await 片付くまで();
    開いた(受け口, 4, `${アクセス数}?page=2`);
    await 片付くまで();
    expect(何回目).toBe(4);
    expect(状態().items.map((i) => i.key).sort()).toEqual([
      `kakuyomu|accesses|${作品ID}|1`,
      `kakuyomu|accesses|${作品ID}|2`,
      `kakuyomu|work|${作品ID}|1`,
    ]);
  });

  it("どの画面の分かは、読み取り係が添えた「読んだURL」で決める（頼んだあとにURLが変わっても取り違えない）", async () => {
    const { 受け口, 状態 } = 作り物のChrome({
      保存: { helperState: { items: [], ownWorks: [{ siteId: "kakuyomu", workId: 作品ID }] } },
      ページの返事: { read: 読めた(`${アクセス数}?page=3`, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, アクセス数);
    await 片付くまで();
    expect(状態().items.map((i) => i.page)).toEqual([3]);
  });

  it("読めなかったときは何も溜めない（知らせも出さない）", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({ ページの返事: { read: { ok: false, reason: "no-data" } } });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    expect(状態().items).toEqual([]);
    expect(記録.知らせ).toEqual([]);
  });
});

describe("自分の作品か訊く（0.9.0）", () => {
  it("覚えていない Narou.fun のページで押すと、ボタンつきの知らせで訊く（読まない・渡さない）", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      ページの返事: { read: 読めた(自分のNarouFun, "narou", "N1234AB") },
    });
    受け口.clicked({ id: 7, url: 自分のNarouFun });
    await 片付くまで();
    expect(記録.問い).toHaveLength(1);
    expect(記録.問い[0].title).toBe("ご自分の作品ですか？");
    expect(記録.問い[0].message).toContain("n1234ab");
    expect(記録.問い[0].buttons.map((b) => b.title)).toEqual(["覚える", "覚えない"]);
    expect(記録.ページへ).toEqual([]);
    expect(記録.置いた).toBeUndefined();
    expect(記録.向けたURL).toEqual([]);
    expect(状態().pending).toMatchObject({ siteId: "narouFun", workId: "n1234ab" });
  });

  it("「覚える」を押すと覚え、訊いた画面を読んで溜める。以後はその作品だけ、開いたら溜まる", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      ページの返事: {
        read: (tabId) =>
          tabId === 9 ? 読めた(他人のNarouFun, "narou", "n9999zz") : 読めた(自分のNarouFun, "narou", "N1234AB"),
      },
    });
    受け口.clicked({ id: 7, url: 自分のNarouFun });
    await 片付くまで();
    受け口.button(記録.問い[0].id, 0);
    await 片付くまで();
    expect(状態().ownWorks.map((w) => `${w.siteId}:${w.workId}:${w.how}`)).toEqual(["narouFun:n1234ab:approved"]);
    expect(状態().pending).toBe(null);
    expect(状態().items).toHaveLength(1);
    expect(記録.知らせ.at(-1).title).toBe("ご自分の作品として覚えました");
    expect(記録.知らせ.at(-1).message).toContain("いま 1件");

    // 他人の作品は、覚えた作品があっても溜まらない
    開いた(受け口, 9, 他人のNarouFun);
    await 片付くまで();
    expect(状態().items).toHaveLength(1);
  });

  it("「覚えない」を押すと、覚えず、訊きかけの印だけ外す", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome();
    受け口.clicked({ id: 7, url: 自分のNarouFun });
    await 片付くまで();
    受け口.button(記録.問い[0].id, 1);
    await 片付くまで();
    expect(状態().ownWorks).toEqual([]);
    expect(状態().pending).toBe(null);
    expect(状態().items).toEqual([]);
  });

  it("ほかの知らせのボタンには反応しない", async () => {
    const { 受け口, 状態 } = 作り物のChrome();
    受け口.button("なにか別の知らせ", 0);
    await 片付くまで();
    expect(状態().ownWorks).toEqual([]);
  });
});

describe("まとめて渡す（0.9.0）", () => {
  const 溜まった = () => ({
    helperState: {
      items: [
        {
          key: `kakuyomu|accesses|${作品ID}|2`,
          siteId: "kakuyomu",
          pageKind: "accesses",
          pageLabel: "アクセス数",
          workId: 作品ID,
          page: 2,
          storedAt: "2026-09-23T04:00:00.000Z",
          size: 10,
          counts: { work: 0, day: 0, episode: 50 },
          envelope: { "novelai-stats": 1, site: "kakuyomu", workId: 作品ID, readAt: "x", entries: [{}] },
        },
      ],
      ownWorks: [{ siteId: "kakuyomu", workId: 作品ID, how: "owner-page", addedAt: "x" }],
    },
  });

  it("読者の反応の画面で押すと、その画面を読み直して溜め、溜まった分を束にしてクリップボードへ置き、VS Code を呼ぶ", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      保存: 溜まった(),
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID, { work: 2, day: 30, episode: 219 }) },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
    const 束 = JSON.parse(記録.置いた);
    expect(束.kind).toBe("novelai-stats-bundle");
    expect(束.version).toBe(1);
    expect(typeof 束.handedAt).toBe("string");
    // 前に溜まっていたアクセス数の2ページ目と、いま読み直した作品管理（溜めた順）
    expect(束.items).toHaveLength(2);
    expect(束.items.every((i) => i["novelai-stats"] === 1)).toBe(true);
    expect(記録.知らせ.at(-1).title).toBe("読者の反応をまとめて渡しました");
    expect(記録.知らせ.at(-1).message).toContain("2画面・1作品・301件");
    expect(記録.知らせ.at(-1).message).toContain("この画面からは 251件");
    expect(記録.向けたURL).toEqual(["vscode://nonahisa.novel-ai-assistant/import-reader-stats"]);
    // 渡したら溜まりは空、控えに残る。全体の印は消える
    expect(状態().items).toEqual([]);
    expect(状態().handed.items).toHaveLength(2);
    expect(記録.全体の印.at(-1)).toBe("");
    // 受け渡しのページは、用が済んだら閉じる
    expect(記録.閉じた).toBe(1);
  });

  it("クリップボードへ置けなかったときは、溜まりを消さず、VS Code を呼ばない", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      置けるか: false,
      保存: 溜まった(),
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    expect(記録.知らせ.at(-1).title).toBe("渡せませんでした");
    expect(記録.知らせ.at(-1).message).toContain("溜まった分はそのまま残してあります");
    expect(記録.向けたURL).toEqual([]);
    expect(状態().items).toHaveLength(2);
    expect(状態().handed == null).toBe(true);
  });

  it("押した画面が読めなかったときは、渡さない（この画面の分が入ったと思われないように）", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      保存: 溜まった(),
      ページの返事: { read: { ok: false, reason: "no-data" } },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    expect(記録.知らせ.at(-1).title).toBe("渡せませんでした");
    expect(記録.知らせ.at(-1).message).toContain("ページの形が変わったようです");
    expect(記録.置いた).toBeUndefined();
    expect(記録.向けたURL).toEqual([]);
    expect(状態().items).toHaveLength(1);
  });

  it("溜まりがあれば、ほかの画面で押しても渡す（ページへは触れない）", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({ 保存: 溜まった() });
    受け口.clicked({ id: 7, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.ページへ).toEqual([]);
    expect(JSON.parse(記録.置いた).items).toHaveLength(1);
    expect(記録.向けたURL).toEqual(["vscode://nonahisa.novel-ai-assistant/import-reader-stats"]);
    expect(状態().items).toEqual([]);
  });

  it("溜まりが無ければ、できることの無い画面では理由を知らせる（ページへも VS Code へも触れない）", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.clicked({ id: 7, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.ページへ).toHaveLength(0);
    expect(記録.向けたURL).toEqual([]);
    expect(記録.置いた).toBeUndefined();
    expect(記録.知らせ[0].title).toBe("この画面ではできることがありません");
  });

  it("話の作成画面では、溜まりがあっても貼り込み（渡さない）", async () => {
    const 封 = JSON.stringify({ "novelai-post": 1, site: "kakuyomu", workId: 作品ID, title: "題", body: "本文" });
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      保存: 溜まった(),
      クリップボード: 封,
      ページの返事: { fill: { accepted: true } },
    });
    受け口.clicked({ id: 7, url: 話の作成画面 });
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["fill"]);
    expect(記録.置いた).toBeUndefined();
    expect(状態().items).toHaveLength(1);
  });
});

describe("説明のページからの頼み（0.9.0）", () => {
  const 説明のページ = { id: "self", tab: { id: 11, active: true }, url: "chrome-extension://self/options.html" };
  const 頼む = (受け口, 依頼, 送り手 = 説明のページ) =>
    new Promise((resolve) => {
      const 待つ = 受け口.message(依頼, 送り手, resolve);
      if (待つ !== true) resolve("返事なし");
    });

  it("溜まりの様子を返す（一覧は文になっている）", async () => {
    const { 受け口 } = 作り物のChrome({
      保存: {
        helperState: {
          items: [
            {
              key: "k",
              siteId: "kakuyomu",
              pageLabel: "作品管理",
              workId: 作品ID,
              page: 1,
              storedAt: "2026-09-23T04:00:00.000Z",
              counts: { work: 2, day: 30, episode: 219 },
              envelope: { entries: [{}] },
            },
          ],
          ownWorks: [{ siteId: "narouFun", workId: "n1234ab" }],
        },
      },
    });
    const 様子 = await 頼む(受け口, { type: "options-status" });
    expect(様子.ok).toBe(true);
    expect(様子.summary).toEqual({ pages: 1, works: 1, entries: 251 });
    expect(様子.items[0]).toContain("カクヨム 作品管理");
    expect(様子.items[0]).toContain(作品ID);
    expect(様子.ownWorks).toHaveLength(1);
    expect(様子.limits.maxItems).toBe(50);
  });

  it("もう一度渡す：控えを束にして置き、VS Code を呼ぶ（控えは消さない）", async () => {
    const 控え = {
      key: "k",
      siteId: "kakuyomu",
      workId: 作品ID,
      storedAt: "2026-09-23T04:00:00.000Z",
      counts: { work: 1 },
      envelope: { "novelai-stats": 1, entries: [{}] },
    };
    const { 記録, 受け口, 状態 } = 作り物のChrome({
      保存: { helperState: { items: [], handed: { handedAt: new Date().toISOString(), items: [控え] } } },
    });
    const 返事 = await 頼む(受け口, { type: "options-hand-again" });
    expect(返事.ok).toBe(true);
    expect(JSON.parse(記録.置いた).items).toHaveLength(1);
    expect(記録.向けたURL).toEqual(["vscode://nonahisa.novel-ai-assistant/import-reader-stats"]);
    expect(記録.知らせ.at(-1).message).toContain("もう一度");
    expect(状態().handed.items).toHaveLength(1);
  });

  it("覚えた作品を直す：形の合わない行があれば保存しない", async () => {
    const { 受け口, 状態 } = 作り物のChrome();
    const 悪い = await 頼む(受け口, { type: "options-save-own-works", texts: { narouFun: "なろう", kakuyomu: "" } });
    expect(悪い).toEqual({ ok: false, bad: ["なろう"] });
    expect(状態().ownWorks).toEqual([]);
    const 良い = await 頼む(受け口, { type: "options-save-own-works", texts: { narouFun: "N1234AB", kakuyomu: 作品ID } });
    expect(良い.ok).toBe(true);
    expect(状態().ownWorks.map((w) => w.workId).sort()).toEqual([作品ID, "n1234ab"].sort());
  });

  it("訊きかけの作品を、説明のページから覚えられる", async () => {
    const { 受け口, 状態 } = 作り物のChrome({
      保存: { helperState: { items: [], pending: { siteId: "narouFun", workId: "n1234ab", askedAt: "x" } } },
    });
    const 返事 = await 頼む(受け口, { type: "options-approve-pending" });
    expect(返事.ok).toBe(true);
    expect(状態().ownWorks.map((w) => w.workId)).toEqual(["n1234ab"]);
    expect(状態().pending).toBe(null);
  });

  it("説明のページ以外（投稿サイトのページ）から同じ頼みが来ても受けない", async () => {
    const { 受け口, 状態 } = 作り物のChrome();
    const 返事 = await 頼む(
      受け口,
      { type: "options-save-own-works", texts: { narouFun: "n9999zz", kakuyomu: "" } },
      { id: "self", tab: { id: 3 }, url: 他人のNarouFun }
    );
    expect(返事).toBe("返事なし");
    expect(状態().ownWorks).toEqual([]);
  });
});

describe("これまでの動き（0.8.0）", () => {
  it("話の作成画面：クリップボードの原稿を照合してから、ページへ渡す。VS Code は呼ばない", async () => {
    const 封 = JSON.stringify({ "novelai-post": 1, site: "kakuyomu", workId: 作品ID, title: "題", body: "本文" });
    const { 記録, 受け口 } = 作り物のChrome({ クリップボード: 封, ページの返事: { fill: { accepted: true } } });
    受け口.clicked({ id: 7, url: 話の作成画面 });
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
    expect(記録.ページへ).toHaveLength(0);
    expect(記録.知らせ[0].title).toBe("入れられませんでした");
    expect(記録.知らせ[0].message).toContain("作品「999」の投稿画面ではないようです");
  });

  it("右クリックの項目からも、同じ処理へ入る（タブのURLが無いときはページのURLを使う）", async () => {
    const { 記録, 受け口 } = 作り物のChrome({ ページの返事: { read: { ok: false, reason: "login" } } });
    受け口.menu({ menuItemId: "novelai-helper-run", pageUrl: 作品管理 }, { id: 7 });
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
  });

  it("ページが開いた知らせで、そのタブに印を付け、選ばれているタブなら右クリックも合わせる", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    開いた(受け口, 3, 話の作成画面);
    await 片付くまで();
    expect(記録.印).toEqual([{ tabId: 3, text: "貼" }]);
    expect(記録.右クリック).toEqual([{ title: "統合小説執筆環境ヘルパー：この画面に貼り込む", visible: true }]);
  });

  it("できることの無いページでは、このタブだけの印を消し（全体の印が出る）、右クリックの項目を隠す", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    開いた(受け口, 3, `https://kakuyomu.jp/my/works/${作品ID}/episodes/123`);
    await 片付くまで();
    expect(記録.印).toEqual([{ tabId: 3, text: null }]);
    expect(記録.右クリック[0].visible).toBe(false);
  });

  it("ほかの拡張から届いた知らせは受けない", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.message({ type: "page-opened" }, { id: "other", tab: { id: 3, active: true }, url: 作品管理 });
    受け口.message(
      { type: "fill-result", result: { ok: true, message: "x" } },
      { id: "other", tab: { id: 3 }, url: 話の作成画面 }
    );
    await 片付くまで();
    expect(記録.印).toEqual([]);
    expect(記録.知らせ).toEqual([]);
    expect(記録.ページへ).toEqual([]);
  });

  it("入れた直後：右クリックの項目を隠した状態で作り、説明のページを1回だけ開く", () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.installed({ reason: "install" });
    expect(記録.作った項目.visible).toBe(false);
    expect(記録.作った項目.documentUrlPatterns).toContain("https://db.narou.fun/works/*");
    expect(記録.作った項目.documentUrlPatterns).toContain("https://kakuyomu.jp/works/*/accesses?*");
    expect(記録.開いた).toBe(1);
    受け口.installed({ reason: "update" });
    expect(記録.開いた).toBe(1);
  });

  it("裏方が起きたとき、溜まりの件数を全体の印へ戻す", async () => {
    const { 記録 } = 作り物のChrome({
      保存: {
        helperState: {
          items: [
            { key: "a", storedAt: "2026-09-23T00:00:00.000Z", envelope: {} },
            { key: "b", storedAt: "2026-09-23T00:00:00.000Z", envelope: {} },
          ],
        },
      },
    });
    await 片付くまで();
    expect(記録.全体の印).toEqual(["読2"]);
  });
});

describe("集計のための記録（0.10.0）", () => {
  const 説明のページ = { id: "self", tab: { id: 11, active: true }, url: "chrome-extension://self/options.html" };
  const 頼む = (受け口, 依頼, 送り手 = 説明のページ) =>
    new Promise((resolve) => {
      const 待つ = 受け口.message(依頼, 送り手, resolve);
      if (待つ !== true) resolve("返事なし");
    });

  it("自分の作品の画面を開くと、溜まりとは別に記録にも残る", async () => {
    const { 受け口, 集計の記録 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    expect(集計の記録().works.map((w) => `${w.siteId}:${w.workId}`)).toEqual([`kakuyomu:${作品ID}`]);
    expect(集計の記録().works[0].latest.pv.value).toBe(1);
  });

  it("他人の作品の画面を開いても、記録に残らない", async () => {
    const { 受け口, 集計の記録 } = 作り物のChrome({
      ページの返事: { read: 読めた(他人のNarouFun, "narou", "n9999zz") },
    });
    開いた(受け口, 3, 他人のNarouFun);
    await 片付くまで();
    開いた(受け口, 4, 他人のアクセス数);
    await 片付くまで();
    expect(集計の記録().works).toEqual([]);
  });

  it("まとめて渡しても、記録は消えない（溜まりだけが空になる）", async () => {
    const { 受け口, 状態, 集計の記録 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    expect(状態().items).toEqual([]);
    expect(状態().handed.items).toHaveLength(1);
    expect(集計の記録().works).toHaveLength(1);
  });

  it("「溜まりを空にする」でも、記録は消えない", async () => {
    const { 受け口, 集計の記録 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    await 頼む(受け口, { type: "options-clear" });
    expect(集計の記録().works).toHaveLength(1);
  });

  it("説明のページへ、覚えた作品だけの集計を字で返す", async () => {
    const { 受け口 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    const 返事 = await 頼む(受け口, { type: "options-report" });
    expect(返事.ok).toBe(true);
    expect(返事.text).toContain(`作品ID ${作品ID}`);
    expect(返事.text).toContain("PV 1");
    expect(返事.limits.maxWorks).toBe(20);
  });

  it("覚えた作品から外すと、その作品の記録も消える", async () => {
    const { 受け口, 集計の記録 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    const 返事 = await 頼む(受け口, { type: "options-save-own-works", texts: { kakuyomu: "", narouFun: "n1234ab" } });
    expect(返事.ok).toBe(true);
    expect(集計の記録().works).toEqual([]);
  });

  it("「集計の記録を消す」で、記録だけが空になる（覚えた作品は残る）", async () => {
    const { 受け口, 状態, 集計の記録 } = 作り物のChrome({
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    await 頼む(受け口, { type: "options-clear-history" });
    expect(集計の記録().works).toEqual([]);
    expect(状態().ownWorks).toHaveLength(1);
  });

  it("アイコンの右クリックに「読者の反応の集計を見る」を作り、選ぶと説明のページを開く", async () => {
    const { 記録, 受け口 } = 作り物のChrome();
    受け口.installed({ reason: "update" });
    const 集計の項目 = 記録.作った項目たち.find((o) => o.id === "novelai-helper-report");
    expect(集計の項目).toEqual({ id: "novelai-helper-report", title: "読者の反応の集計を見る", contexts: ["action"] });
    expect(記録.開いた).toBe(0);
    受け口.menu({ menuItemId: "novelai-helper-report" }, { id: 3, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.開いた).toBe(1);
    // ページへは触れず、知らせも出さない
    expect(記録.ページへ).toEqual([]);
    expect(記録.知らせ).toEqual([]);
  });
});

describe("「統合小説執筆環境へ渡す」を切っているとき（0.11.0）", () => {
  const 説明のページ = { id: "self", tab: { id: 11, active: true }, url: "chrome-extension://self/options.html" };
  const 頼む = (受け口, 依頼, 送り手 = 説明のページ) =>
    new Promise((resolve) => {
      const 待つ = 受け口.message(依頼, 送り手, resolve);
      if (待つ !== true) resolve("返事なし");
    });
  const 溜まり2件 = () => ({
    helperState: {
      items: [
        { key: "a", siteId: "kakuyomu", workId: 作品ID, storedAt: "2026-09-23T00:00:00.000Z", envelope: { entries: [{}] } },
        { key: "b", siteId: "kakuyomu", workId: 作品ID, storedAt: "2026-09-23T00:00:00.000Z", envelope: { entries: [{}] } },
      ],
      ownWorks: [{ siteId: "kakuyomu", workId: 作品ID }],
    },
  });

  it("自分の作品の画面を開くと、記録には残し、溜まりには溜めない（作品は覚える）。印は件数の無い「読」", async () => {
    const { 記録, 受け口, 状態, 集計の記録 } = 作り物のChrome({
      渡す: false,
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
    expect(状態().items).toEqual([]);
    expect(状態().ownWorks.map((w) => w.workId)).toEqual([作品ID]);
    expect(集計の記録().works.map((w) => w.workId)).toEqual([作品ID]);
    expect(記録.全体の印.every((t) => t === "")).toBe(true);
    expect(記録.印.at(-1)).toEqual({ tabId: 3, text: "読" });
    expect(記録.知らせ).toEqual([]);
  });

  it("読者の反応の画面で押すと、読み直して記録し、集計（説明のページ）を開く。VS Code もクリップボードも使わない", async () => {
    const { 記録, 受け口, 状態, 集計の記録 } = 作り物のChrome({
      渡す: false,
      保存: 溜まり2件(),
      ページの返事: { read: 読めた(作品管理, "kakuyomu", 作品ID) },
    });
    受け口.clicked({ id: 7, url: 作品管理 });
    await 片付くまで();
    expect(記録.ページへ.map((r) => r.type)).toEqual(["read"]);
    expect(集計の記録().works).toHaveLength(1);
    expect(記録.開いた).toBe(1);
    expect(記録.置いた).toBeUndefined();
    expect(記録.向けたURL).toEqual([]);
    expect(記録.知らせ).toEqual([]);
    // 溜まっていた分は消さない（入れ直せば渡せる）
    expect(状態().items).toHaveLength(2);
  });

  it("ほかの画面で押すと、溜まりがあっても渡さず、集計を開く", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({ 渡す: false, 保存: 溜まり2件() });
    受け口.clicked({ id: 7, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.開いた).toBe(1);
    expect(記録.ページへ).toEqual([]);
    expect(記録.置いた).toBeUndefined();
    expect(記録.向けたURL).toEqual([]);
    expect(記録.知らせ).toEqual([]);
    expect(状態().items).toHaveLength(2);
  });

  it("話の作成画面で押しても貼り込まず（クリップボードも読まない）、集計を開く", async () => {
    const 封 = JSON.stringify({ "novelai-post": 1, site: "kakuyomu", workId: 作品ID, title: "題", body: "本文" });
    const { 記録, 受け口 } = 作り物のChrome({ 渡す: false, クリップボード: 封, ページの返事: { fill: { accepted: true } } });
    受け口.clicked({ id: 7, url: 話の作成画面 });
    await 片付くまで();
    expect(記録.ページへ).toEqual([]);
    expect(記録.開いた).toBe(1);
    expect(記録.閉じた).toBe(0);
  });

  it("まだ覚えていない作品の画面では、これまでどおり訊く。覚えたら記録し、「まとめて渡す」の案内は出さない", async () => {
    const { 記録, 受け口, 状態, 集計の記録 } = 作り物のChrome({
      渡す: false,
      ページの返事: { read: 読めた(自分のNarouFun, "narou", "N1234AB") },
    });
    受け口.clicked({ id: 7, url: 自分のNarouFun });
    await 片付くまで();
    expect(記録.問い).toHaveLength(1);
    expect(記録.開いた).toBe(0);
    受け口.button(記録.問い[0].id, 0);
    await 片付くまで();
    expect(状態().ownWorks.map((w) => w.workId)).toEqual(["n1234ab"]);
    expect(状態().items).toEqual([]);
    expect(集計の記録().works).toHaveLength(1);
    expect(記録.知らせ.at(-1).message).toContain("記録しました");
    expect(記録.知らせ.at(-1).message).not.toContain("まとめて渡");
  });

  it("右クリックの項目：読者の反応の画面では「集計を見る」、ほかの画面では出さない", async () => {
    const { 記録, 受け口 } = 作り物のChrome({ 渡す: false, 保存: 溜まり2件(), ページの返事: { read: { ok: false } } });
    開いた(受け口, 3, 作品管理);
    await 片付くまで();
    expect(記録.右クリック.at(-1)).toEqual({ title: "統合小説執筆環境ヘルパー：読者の反応の集計を見る", visible: true });
    開いた(受け口, 4, 話の作成画面);
    await 片付くまで();
    expect(記録.右クリック.at(-1).visible).toBe(false);
    expect(記録.印.at(-1)).toEqual({ tabId: 4, text: null });
  });

  it("右クリックの「集計を見る」を選ぶと、集計を開く（まとめて渡さない）", async () => {
    const { 記録, 受け口, 状態 } = 作り物のChrome({ 渡す: false, 保存: 溜まり2件(), ページの返事: { read: { ok: false } } });
    受け口.menu({ menuItemId: "novelai-helper-run", pageUrl: 作品管理 }, { id: 7 });
    await 片付くまで();
    expect(記録.開いた).toBe(1);
    expect(記録.置いた).toBeUndefined();
    expect(状態().items).toHaveLength(2);
  });

  it("裏方が起きたとき、溜まりがあっても全体の印を出さない", async () => {
    const { 記録 } = 作り物のChrome({ 渡す: false, 保存: 溜まり2件() });
    await 片付くまで();
    expect(記録.全体の印).toEqual([""]);
  });

  it("説明のページの「まとめて渡す」「もう一度渡す」も断る（クリップボードも VS Code も使わない）", async () => {
    const 保存 = 溜まり2件();
    保存.helperState.handed = { handedAt: new Date().toISOString(), items: 保存.helperState.items.slice() };
    const { 記録, 受け口, 状態 } = 作り物のChrome({ 渡す: false, 保存 });
    const 返事 = await 頼む(受け口, { type: "options-hand" });
    expect(返事.ok).toBe(false);
    expect(返事.detail).toContain("統合小説執筆環境へ渡す");
    const もう一度 = await 頼む(受け口, { type: "options-hand-again" });
    expect(もう一度.ok).toBe(false);
    expect(記録.置いた).toBeUndefined();
    expect(記録.向けたURL).toEqual([]);
    expect(状態().items).toHaveLength(2);
  });
});

describe("「統合小説執筆環境へ渡す」の切り替え（0.11.0）", () => {
  const 説明のページ = { id: "self", tab: { id: 11, active: true }, url: "chrome-extension://self/options.html" };
  const 頼む = (受け口, 依頼, 送り手 = 説明のページ) =>
    new Promise((resolve) => {
      const 待つ = 受け口.message(依頼, 送り手, resolve);
      if (待つ !== true) resolve("返事なし");
    });
  const 溜まり1件 = () => ({
    helperState: {
      items: [{ key: "a", siteId: "kakuyomu", workId: 作品ID, storedAt: "2026-09-23T00:00:00.000Z", envelope: { entries: [{}] } }],
      ownWorks: [{ siteId: "kakuyomu", workId: 作品ID }],
    },
  });

  it("説明のページへ、いまの設定を返す", async () => {
    const { 受け口 } = 作り物のChrome({ 渡す: false });
    expect((await 頼む(受け口, { type: "options-status" })).handToIde).toBe(false);
    const 入り = 作り物のChrome({ 渡す: true });
    expect((await 頼む(入り.受け口, { type: "options-status" })).handToIde).toBe(true);
  });

  it("入れると溜まりの件数が印に出る。切ると印は消え、溜まりは残る", async () => {
    const { 記録, 受け口, 状態, 設定 } = 作り物のChrome({ 渡す: false, 保存: 溜まり1件() });
    await 片付くまで();
    const 入れた = await 頼む(受け口, { type: "options-set-hand-to-ide", on: true });
    expect(入れた).toEqual({ ok: true, handToIde: true });
    expect(設定()).toEqual({ handToIde: true, decidedBy: "author" });
    expect(記録.全体の印.at(-1)).toBe("読1");
    const 切った = await 頼む(受け口, { type: "options-set-hand-to-ide", on: false });
    expect(切った).toEqual({ ok: true, handToIde: false });
    expect(設定()).toEqual({ handToIde: false, decidedBy: "author" });
    expect(記録.全体の印.at(-1)).toBe("");
    expect(状態().items).toHaveLength(1);
  });

  it("形の合わない頼み（入・切が真偽でない）は受けない", async () => {
    const { 受け口, 設定 } = 作り物のChrome({ 渡す: false });
    const 返事 = await 頼む(受け口, { type: "options-set-hand-to-ide", on: "yes" });
    expect(返事.ok).toBe(false);
    expect(設定().handToIde).toBe(false);
  });

  it("新しく入れたときは、切った状態で始まる", async () => {
    const { 受け口, 設定, 記録 } = 作り物のChrome({ 渡す: null });
    受け口.installed({ reason: "install" });
    await 片付くまで();
    expect(設定()).toEqual({ handToIde: false, decidedBy: "install" });
    expect(記録.開いた).toBe(1);
  });

  it("更新で入ったときは、入ったまま（溜まりがあれば印も出る）", async () => {
    const { 受け口, 設定, 記録 } = 作り物のChrome({ 渡す: null, 保存: 溜まり1件() });
    受け口.installed({ reason: "update" });
    await 片付くまで();
    expect(設定()).toEqual({ handToIde: true, decidedBy: "update" });
    expect(記録.全体の印.at(-1)).toBe("読1");
    expect(記録.開いた).toBe(0);
  });

  it("作者が切った設定は、更新しても入らない", async () => {
    const { 受け口, 設定 } = 作り物のChrome({ 渡す: false, 保存: 溜まり1件() });
    受け口.installed({ reason: "update" });
    await 片付くまで();
    expect(設定()).toEqual({ handToIde: false, decidedBy: "author" });
  });

  it("設定が保存に無くても、渡していた形跡（溜まり・覚えた作品）があれば、入っているものとして動く", async () => {
    const { 記録, 受け口 } = 作り物のChrome({ 渡す: null, 保存: 溜まり1件() });
    await 片付くまで();
    expect(記録.全体の印).toEqual(["読1"]);
    受け口.clicked({ id: 7, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.開いた).toBe(0);
    expect(JSON.parse(記録.置いた).items).toHaveLength(1);
  });

  it("設定も形跡も無ければ、切っているものとして動く（押すと集計を開く）", async () => {
    const { 記録, 受け口 } = 作り物のChrome({ 渡す: null });
    受け口.clicked({ id: 7, url: "https://example.com/" });
    await 片付くまで();
    expect(記録.開いた).toBe(1);
    expect(記録.知らせ).toEqual([]);
  });
});
