/**
 * 画面の自動テスト（E2E）の土台：**この拡張を読み込んだ Chromium** を画面の外で起こし、
 * 投稿サイトの代わりに手元の見本（test/e2e/fixtures/）を返す（設計書12章）。
 *
 * 作者の裁定（2026-10-12）「Chrome のテストも、拡張機能をアップデートしたら後は自動でできそう」→「今から作る」。
 * README の「実機で確かめること」のうち、**押して起きること**を機械で毎回なぞるためのもの。
 *
 * ## 決めたこと
 *
 * - **ブラウザは Playwright の Chromium**（`channel: "chromium"`）。ブランドの Chrome は 137 から
 *   `--load-extension` を受けないので使えない。`channel: "chromium"` は新しい headless（画面を持たない
 *   本物のブラウザ）で動き、拡張も読み込む。既定の headless（chromium_headless_shell）は拡張を読まない
 * - **窓を出さない**（headless）。作者の画面の前面を取らない（統合小説執筆環境の test/e2e と同じ考え）
 * - **本物のサイトへは1本も行かない。** まず全部の通信を止め（abort）、そのあとに見本を返す道だけを足す
 *   （Playwright は後に足した route を先に当てる）。ログインが要るサイトに、機械がパスワードを入れないため
 * - **製品のコードにテスト専用の口を足さない。** 見るのは裏方（service worker）の chrome API の呼ばれ方で、
 *   テストの側から包んで記録する（下の installWatch）。拡張の保存（chrome.storage.local）も裏方から読む
 * - **起こしたブラウザは必ず閉じ、一時のプロフィールを消す**（withHelper の finally）
 */
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);

/** 拡張のフォルダー（リポジトリの根。manifest.json がある所をそのまま読み込む＝ビルド工程が無い）。 */
export const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(EXTENSION_ROOT, "test", "e2e", "fixtures");

/** 一時のプロフィールの名の頭。走りの最初に、前の走りの残りをこの頭で探して消す（globalSetup.js）。 */
export const PROFILE_PREFIX = "nph-e2e-";

/** 文言と合図は製品と同じファイルから引く（テストに写すと、文言を直した日に食い違う）。 */
export const Messages = require("../../../common/messages.js");
export const Actions = require("../../../common/actions.js");

/** 見本の作品ID（架空）。カクヨムの作品IDの形（数字だけ）にしてある。 */
export const WORK_ID = "1177354054800000001";

/** 見本を返すページ。キーは URL（問い合わせの部分を除く）、値は fixtures/ のファイル名。 */
export const PAGES = {
  kakuyomuWork: `https://kakuyomu.jp/my/works/${WORK_ID}`,
  kakuyomuAccesses: `https://kakuyomu.jp/works/${WORK_ID}/accesses`,
  novelportal: "https://creative-story.net/bungakusyou/",
};

const 見本の表 = new Map([
  [PAGES.kakuyomuWork, "kakuyomu-work.html"],
  [PAGES.kakuyomuAccesses, "kakuyomu-accesses.html"],
  [PAGES.novelportal, "novelportal-bungakusyou.html"],
]);

/** 待つ（肯定の確かめは、固定の時間ではなくこれで待つ）。 */
export async function waitUntil(調べる, { timeout = 15_000, interval = 200, what = "条件" } = {}) {
  const 期限 = Date.now() + timeout;
  let 最後 = null;
  for (;;) {
    try {
      最後 = await 調べる();
      if (最後) {
        return 最後;
      }
    } catch (e) {
      最後 = e;
    }
    if (Date.now() > 期限) {
      throw new Error(`${what}を ${timeout}ms 待ったが満たされなかった（最後の値：${String(最後 && 最後.message ? 最後.message : 最後)}）`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

export function sleep(ミリ秒) {
  return new Promise((r) => setTimeout(r, ミリ秒));
}

/** Windows はブラウザを閉じた直後にファイルを掴んだままのことがある（EBUSY）。少し待って数回やり直す。 */
async function 消す(フォルダー) {
  for (let i = 0; i < 10; i += 1) {
    try {
      await rm(フォルダー, { recursive: true, force: true });
      return;
    } catch (_e) {
      await sleep(300);
    }
  }
}

/**
 * 前の走りが途中で止まって残した一時のプロフィールを消す（globalSetup から呼ぶ）。
 * **作って間もないものは消さない**——別の作業場で同時に走っているテストのプロフィールかもしれない
 * （使っている最中のフォルダーを消しにかかると、消せたファイルだけ消えて、そちらのブラウザが壊れる）。
 */
const 残りと見なす古さ = 30 * 60 * 1000;

export async function sweepProfiles() {
  let 名前たち = [];
  try {
    名前たち = await readdir(tmpdir());
  } catch (_e) {
    return;
  }
  for (const 名 of 名前たち.filter((n) => n.startsWith(PROFILE_PREFIX))) {
    const 場所 = join(tmpdir(), 名);
    try {
      const 様子 = await stat(場所);
      if (様子.isDirectory() && Date.now() - 様子.mtimeMs > 残りと見なす古さ) {
        await 消す(場所);
      }
    } catch (_e) {
      // 動いているブラウザが掴んでいる。次の走りで消える
    }
  }
}

/**
 * 拡張を読み込んだ Chromium を起こし、終わったら必ず閉じて消す。
 *
 * @param {(h: HelperSession) => Promise<void>} 本体
 */
export async function withHelper(本体) {
  const プロフィール = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
  let context = null;
  try {
    context = await chromium.launchPersistentContext(プロフィール, {
      channel: "chromium",
      headless: true,
      // Playwright は既定で --disable-extensions を付ける。拡張を読むので外す
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${EXTENSION_ROOT}`, `--load-extension=${EXTENSION_ROOT}`],
    });
    await 通信を止めて見本を返す(context);
    const session = await HelperSession.start(context, プロフィール);
    await 本体(session);
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (_e) {
        // もう閉じている
      }
    }
    await 消す(プロフィール);
  }
}

/**
 * 全部の通信を止め、見本の URL にだけ手元の HTML を返す。
 * 先に止める道を置き、あとから見本の道を足す（Playwright は後に足した route を先に当てる）。
 * 見本に無い URL（画像・別のページ）は止まったまま——本物のサイトへ行かないことを、機械で保つ。
 */
async function 通信を止めて見本を返す(context) {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    // 拡張の中のページ（chrome-extension://）と about:blank は通信ではないので素通し
    if (!/^https?:/i.test(url)) {
      return route.continue();
    }
    return route.abort("blockedbyclient");
  });
  for (const [url, ファイル] of 見本の表) {
    const 本文 = await readFile(join(FIXTURES, ファイル), "utf8");
    const 道 = new URL(url);
    // 問い合わせの部分（?page=2 など）が付いても同じ見本を返す
    await context.route(
      (u) => u.origin === 道.origin && (u.pathname === 道.pathname || u.pathname === `${道.pathname}/`),
      (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: 本文 })
    );
  }
}

/**
 * 裏方（service worker）の chrome API を包んで、呼ばれ方を記録する。**テストの側からだけ**入れる
 * （製品のコードは変えない）。記録は裏方の globalThis.__nphE2E に、起きた順に積む。
 *
 * - `chrome.notifications.create`：**記録だけして、出さない。** 新しい headless は本物の Chrome なので、
 *   出すと作者の画面の隅に Windows の通知が出うる。文言はここで確かめる（getAll は ID しか返さない）
 * - `chrome.action.setPopup`／`openPopup`：記録して、本物も呼ぶ。openPopup が通ったか断られたかで、
 *   吹き出しが出たのか、お知らせへ回ったのかが分かる
 * - `chrome.tabs.update`：`vscode://` へ向けるものは**記録だけして、向けない**（ノートPCの VS Code を
 *   起こさないため。Playwright の route は http/https しか捕まえないので、合図はここで止める）。ほかは本物へ
 * - `chrome.runtime.sendMessage`：クリップボードへ置く頼み（offscreen へ）の中身を記録して、本物も呼ぶ
 *
 * 裏方は Chrome が止めて起こし直すことがある（MV3）。起こし直すと包みが外れるので、
 * 操作の直前に入れ、読むときに外れていないかを確かめる（readWatch）。
 */
async function installWatch(sw) {
  await sw.evaluate(() => {
    if (globalThis.__nphE2E) {
      return;
    }
    const 記録 = [];
    // 包めたかを確かめる。黙って包めていないと、お知らせが本当に出て（作者の画面の隅に出うる）、記録は空のまま
    // 「何も出なかった」ことになる
    const 包む = (入れ物, 名, 代わり) => {
      try {
        入れ物[名] = 代わり;
      } catch (_e) {
        // 書けない場合は下で定義し直す
      }
      if (入れ物[名] !== 代わり) {
        Object.defineProperty(入れ物, 名, { value: 代わり, configurable: true, writable: true });
      }
      if (入れ物[名] !== 代わり) {
        throw new Error(`chrome API（${名}）を包めなかった`);
      }
    };

    包む(chrome.notifications, "create", (...args) => {
      const id = typeof args[0] === "string" ? args[0] : null;
      const 中身 = typeof args[0] === "string" ? args[1] : args[0];
      記録.push({
        kind: "notify",
        id,
        title: 中身 && 中身.title,
        message: 中身 && 中身.message,
        buttons: ((中身 && 中身.buttons) || []).map((b) => b.title),
      });
    });

    const 元のsetPopup = chrome.action.setPopup.bind(chrome.action);
    包む(chrome.action, "setPopup", (details, ...rest) => {
      記録.push({ kind: "setPopup", tabId: details && details.tabId, popup: details && details.popup });
      return 元のsetPopup(details, ...rest);
    });
    const 元のopenPopup = chrome.action.openPopup.bind(chrome.action);
    包む(chrome.action, "openPopup", async (...rest) => {
      try {
        const r = await 元のopenPopup(...rest);
        記録.push({ kind: "openPopup", ok: true });
        return r;
      } catch (e) {
        記録.push({ kind: "openPopup", ok: false, error: String((e && e.message) || e) });
        throw e;
      }
    });

    const 元のupdate = chrome.tabs.update.bind(chrome.tabs);
    包む(chrome.tabs, "update", (...args) => {
      const [tabId, props, callback] = args;
      if (props && typeof props.url === "string" && /^vscode:/i.test(props.url)) {
        記録.push({ kind: "signal", tabId, url: props.url });
        if (typeof callback === "function") {
          callback();
        }
        return Promise.resolve();
      }
      return 元のupdate(...args);
    });

    const 元のsendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    包む(chrome.runtime, "sendMessage", (...args) => {
      const 頼み = args[0];
      if (頼み && 頼み.target === "offscreen-clipboard" && 頼み.type === "write") {
        記録.push({ kind: "clipboardWrite", text: String(頼み.text) });
      }
      return 元のsendMessage(...args);
    });

    // 全部包めてから置く（途中で落ちたら、次の installWatch でやり直せるように）
    globalThis.__nphE2E = 記録;
  });
}

/**
 * 記録から「作者に見えたもの」を組み立てる。
 * - 吹き出し：setPopup（空でないもの）のあとに openPopup が通ったもの
 * - お知らせ：notifications.create
 */
export function shownFrom(記録) {
  const 見えた = [];
  let 直前の吹き出し = null;
  for (const e of 記録) {
    if (e.kind === "setPopup") {
      直前の吹き出し = e.popup ? e.popup : 直前の吹き出し;
    } else if (e.kind === "openPopup") {
      if (e.ok && 直前の吹き出し) {
        const q = new URLSearchParams(直前の吹き出し.split("?")[1] || "");
        見えた.push({ via: "bubble", mode: q.get("mode"), key: q.get("key"), tab: q.get("tab"), title: q.get("title"), text: q.get("text"), popup: 直前の吹き出し });
      }
      直前の吹き出し = null;
    } else if (e.kind === "notify") {
      見えた.push({ via: "notification", id: e.id, title: e.title, text: e.message, buttons: e.buttons });
    }
  }
  return 見えた;
}

/** 自動取得の問いの知らせのID（background.js の 自動取得の問いのID と同じ形）を読む。 */
function 問いの知らせを読む(id) {
  const 部分 = String(id || "").split("#");
  if (部分.length !== 3 || 部分[0] !== "novelai-helper-autoread") {
    return null;
  }
  return { key: 部分[1], tab: 部分[2] };
}

/**
 * 「開いたときに自動で取得しますか？」の問いを、記録から拾う。
 * 吹き出しで出たか、お知らせで出たかを via に入れて返す（作者の画面でどちらが出るかは環境で決まる）。
 */
export function asksFrom(記録) {
  return shownFrom(記録)
    .map((s) => {
      if (s.via === "bubble" && s.mode === "ask") {
        return { via: "bubble", key: s.key, tab: s.tab };
      }
      if (s.via === "notification") {
        const 問い = 問いの知らせを読む(s.id);
        return 問い ? { via: "notification", key: 問い.key, tab: 問い.tab, buttons: s.buttons } : null;
      }
      return null;
    })
    .filter(Boolean);
}

/** 「取得しました」の知らせ（吹き出しかお知らせ）を、記録から拾う。 */
export function gotFrom(記録) {
  return shownFrom(記録).filter(
    (s) => (s.via === "bubble" && s.mode === "got") || (s.via === "notification" && !問いの知らせを読む(s.id) && /^取得しました/.test(String(s.title)))
  );
}

export class HelperSession {
  /** @param {import("playwright").BrowserContext} context */
  constructor(context, profile, extensionId) {
    this.context = context;
    this.profile = profile;
    this.extensionId = extensionId;
  }

  static async start(context, profile) {
    const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
    const extensionId = new URL(sw.url()).host;
    const s = new HelperSession(context, profile, extensionId);
    // 入れた直後の決め（onInstalled：「統合小説執筆環境へ渡す」の入・切と、自動取得の答えの空の形）が
    // 保存に書かれるまで待つ。書かれる前にページを開くと、決めの前の状態で動いたことになる
    await waitUntil(async () => {
      const 保存 = await s.storage(["helperSettings", "autoReadConsent"]);
      return 保存.helperSettings && 保存.autoReadConsent;
    }, { what: "入れた直後の決めが保存に書かれる" });
    await s.watch();
    return s;
  }

  /** 見張りを入れる（裏方を起こし直した〔拡張を再読み込みした〕あとは、入れ直す）。 */
  async watch() {
    await installWatch(await this.sw());
  }

  /** いまの裏方。Chrome が止めて起こし直していれば、新しいほうを返す。 */
  async sw() {
    /*
      **合図を1回待つのではなく、一覧を繰り返し見る。** 拡張を読み込み直したあと（chrome.runtime.reload）、
      新しい裏方の "serviceworker" の合図が届かず30秒待って落ちた（ノートPC、2026-10-12。8件中この1件だけ）。
      合図を待ち始める前に起き直していれば取りこぼすし、読み込み直しのあと MV3 の裏方は何かが起こすまで
      寝ていることもある。10秒見て見つからなければ、拡張の説明のページを開いて裏方を起こし、また見る
    */
    const 探す = () =>
      this.context.serviceWorkers().filter((w) => w.url().startsWith(`chrome-extension://${this.extensionId}/`));
    const 待つ = async (ms) => {
      const 期限 = Date.now() + ms;
      while (Date.now() < 期限) {
        const 裏方たち = 探す();
        if (裏方たち.length > 0) return 裏方たち[裏方たち.length - 1];
        await new Promise((r) => setTimeout(r, 200));
      }
      return undefined;
    };
    const 先に = await 待つ(10_000);
    if (先に) return 先に;
    const 起こし役 = await this.context.newPage();
    try {
      await 起こし役.goto(`chrome-extension://${this.extensionId}/options.html`).catch(() => undefined);
      const あとで = await 待つ(20_000);
      if (あとで) return あとで;
    } finally {
      await 起こし役.close().catch(() => undefined);
    }
    throw new Error("拡張の裏方（service worker）が30秒見つからなかった（説明のページを開いて起こしても出ない）");
  }

  /** 拡張の保存（chrome.storage.local）を裏方から読む。 */
  async storage(keys) {
    const sw = await this.sw();
    return sw.evaluate((k) => chrome.storage.local.get(k), keys);
  }

  /** 見張りの記録。包みが外れていたら（裏方が起き直した）、そう言って落とす——黙って空を返さない。 */
  async readWatch() {
    const sw = await this.sw();
    const 記録 = await sw.evaluate(() => globalThis.__nphE2E || null);
    if (!記録) {
      throw new Error("裏方の見張りが外れている（service worker が起き直した）。記録を読めない");
    }
    return 記録;
  }

  /** 裏方の中で式を走らせる（製品の関数をそのまま呼ぶとき。新しい口は足さない）。 */
  async inWorker(fn, arg) {
    const sw = await this.sw();
    return sw.evaluate(fn, arg);
  }

  url(path) {
    return `chrome-extension://${this.extensionId}/${path}`;
  }

  /** 見本のページを新しいタブで開く（同じタブで開き直すと、裏方の「続けて2度読まない」の10秒に当たる）。 */
  async open(url) {
    const page = await this.context.newPage();
    await page.goto(url, { waitUntil: "load" });
    return page;
  }

  /** 説明のページ（options.html）を開き、裏方から様子を読み終えるまで待つ。 */
  async openOptions() {
    const page = await this.context.newPage();
    await page.goto(this.url("options.html"), { waitUntil: "load" });
    await page.waitForFunction(() => {
      const 欄 = document.getElementById("hand-to-ide");
      return 欄 && !欄.disabled;
    });
    return page;
  }

  /**
   * 問いに答える。吹き出し（bubble.html）を**問いと同じ問い合わせの部分で新しいタブに開き**、ボタンを押す。
   *
   * 吹き出しがアイコンから出たときも、Playwright からはアイコンの吹き出しの中を押せない（Chrome の窓の
   * 部品で、ページではない）。お知らせのボタンも押せない。だから同じ bubble.html を開いて押す——
   * bubble.js が裏方へ答えを送る道（"bubble-answer"）は、アイコンから出た吹き出しで押したときと同じ。
   * お知らせのボタンで答える道（notifications.onButtonClicked）は、同じ「自動取得に答えた」を呼ぶが、ここでは通らない。
   *
   * @param {{key:string, tab:string}} 問い asksFrom の1件
   * @param {"auto"|"manual"} choice
   */
  async answer(問い, choice) {
    const q = new URLSearchParams({ mode: "ask", key: 問い.key, tab: 問い.tab, title: "", text: "" });
    const page = await this.context.newPage();
    await page.goto(this.url(`bubble.html?${q}`), { waitUntil: "load" });
    await page.click(choice === "auto" ? "#answer-auto" : "#answer-manual");
    await page.waitForFunction(() => (document.getElementById("result").textContent || "") !== "");
    const 返事 = await page.textContent("#result");
    await page.close();
    return 返事;
  }
}
