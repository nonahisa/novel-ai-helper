import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 「越えない一線」（設計書6.79.2）を、文書だけでなく**コードで**確かめる。
 *
 * 目で守る約束は、いつか忘れられる。ここでソースを走査しておけば、
 * うっかり fetch を1行足した時点でテストが落ちる。
 * （テスト自身は走査の対象に入れない——禁止語をここに書く必要があるため）
 */

/** 走査から外すフォルダー。**ここを増やすときは、増やした分だけ番人が眠る**と考えること。 */
const 走査から外すフォルダー = ["node_modules", "test", ".git"];

/** 走査する拡張子。ブラウザが読むものだけを見る（.md の説明文は対象外）。 */
const 走査する拡張子 = [".js", ".html", ".css", ".json"];

/**
 * 走査するファイルの一覧を**その場で作る**。
 *
 * 以前はここが手で書いた固定の配列＋2フォルダーの直下だけで、
 * ルートに background.js を足して manifest へ登録しても、番人は何も言わなかった
 * （＝一線を越えるコードを、走査されない場所に置けば通ってしまった）。
 * 一覧を作る側を走査にしたのはそのため。**固定の配列に戻さないこと。**
 */
function ソースの一覧(起点 = ルート) {
  const 結果 = [];
  const 潜る = (絶対, 相対) => {
    for (const 項目 of readdirSync(絶対, { withFileTypes: true })) {
      const 次の相対 = 相対 === "" ? 項目.name : `${相対}/${項目.name}`;
      if (項目.isDirectory()) {
        if (走査から外すフォルダー.includes(項目.name)) {
          continue;
        }
        潜る(join(絶対, 項目.name), 次の相対);
        continue;
      }
      if (!走査する拡張子.includes(extname(項目.name))) {
        continue;
      }
      結果.push(次の相対);
    }
  };
  潜る(起点, "");
  return 結果.sort();
}

function 拡張機能のソース(起点 = ルート) {
  return ソースの一覧(起点).map((相対) => ({
    相対,
    中身: コメントを除く(readFileSync(join(起点, 相対), "utf8")),
  }));
}

/**
 * 「このファイルだけは書いてよい」という形の検査のために、許したファイルを外す。
 *
 * **許す一覧はここへ名指しで書く。** フォルダーごと許すと、隣に新しいファイルを
 * 置いた時点で番人が眠る（走査の一覧を固定の配列から作り直したのと同じ理由）。
 */
function 許したファイルを外す(ソース群, 許す) {
  return ソース群.filter(({ 相対 }) => !許す.includes(相対));
}

/**
 * 走査の前にコメントを落とす。
 * 「fetch は使わない」と**コメントに書いた**だけで落ちてしまうため
 * （実際に最初の実行で落ちた）。見逃すのはコメントアウトされた呼び出しだけで、
 * それは実行されない。
 */
function コメントを除く(中身) {
  return 中身
    .split("\n")
    .map((行) =>
      行
        .replace(/^\s*(\/\/|\*\/|\*|\/\*).*$/, "") // 行コメントとブロックコメントの各行
        .replace(/\s\/\/.*$/, "") // 行末のコメント
        .replace(/<!--.*?-->/g, "") // HTMLのコメント
    )
    .join("\n");
}

/** 与えたソースの中に、禁止の書き方があるかを調べる（走査の本体）。 */
function 違反を探す(ソース群, 禁止) {
  const 見つかった = [];
  for (const { 相対, 中身 } of ソース群) {
    for (const 規則 of 禁止) {
      if (規則.test(中身)) {
        見つかった.push(`${相対}: ${規則}`);
      }
    }
  }
  return 見つかった;
}

/**
 * 禁止の規則ごとに「架空のソースなら検出できる」ことを確かめる。
 *
 * 実ソースが0件なのは、**書いていないから**か**検査が効いていないから**か、
 * 結果だけでは見分けられない。規則を足すときは、必ず検体を対にする。
 */
function 検体で自己検査(検体) {
  for (const [規則, 架空] of 検体) {
    const 見つかった = 違反を探す([{ 相対: "架空.js", 中身: コメントを除く(架空) }], [規則]);
    expect(見つかった, `${規則} が架空のソース「${架空}」を検出しない`).toHaveLength(1);
  }
}

/** 検体の表から、規則だけを取り出す。 */
function 規則だけ(検体) {
  return 検体.map(([規則]) => 規則);
}

function manifestを読む() {
  return JSON.parse(readFileSync(join(ルート, "manifest.json"), "utf8"));
}

describe("走査そのものが働いているか（番人の番人）", () => {
  it("あとから足したファイルも拾う（ルート直下も、深いフォルダーも）", () => {
    const 仮 = mkdtempSync(join(tmpdir(), "nph-redline-"));
    try {
      // ルート直下に足した新顔（固定の一覧だった頃に見逃していたのが、まさにこれ）
      writeFileSync(join(仮, "background.js"), "// 架空\n");
      mkdirSync(join(仮, "common"));
      writeFileSync(join(仮, "common", "新しい部品.js"), "");
      // 2階層より深いところ
      mkdirSync(join(仮, "content", "奥"), { recursive: true });
      writeFileSync(join(仮, "content", "奥", "さらに奥.js"), "");
      writeFileSync(join(仮, "manifest.json"), "{}");
      // 拾わないもの
      writeFileSync(join(仮, "README.md"), 'fetch("https://example.com");');
      mkdirSync(join(仮, "node_modules"));
      writeFileSync(join(仮, "node_modules", "他人.js"), 'fetch("https://example.com");');
      mkdirSync(join(仮, "test"));
      writeFileSync(join(仮, "test", "見本.js"), 'fetch("https://example.com");');

      expect(ソースの一覧(仮)).toEqual([
        "background.js",
        "common/新しい部品.js",
        "content/奥/さらに奥.js",
        "manifest.json",
      ]);
    } finally {
      rmSync(仮, { recursive: true, force: true });
    }
  });

  it("走査した一覧に対して、禁止の検査が実際に走る", () => {
    const 仮 = mkdtempSync(join(tmpdir(), "nph-redline-"));
    try {
      writeFileSync(join(仮, "background.js"), 'const r = await fetch("https://example.com");');
      expect(違反を探す(拡張機能のソース(仮), [/\bfetch\s*\(/])).toEqual([
        "background.js: /\\bfetch\\s*\\(/",
      ]);
    } finally {
      rmSync(仮, { recursive: true, force: true });
    }
  });

  it("いまのソースは、走査の対象が空ではない（除外を増やしすぎて全部消えていない）", () => {
    const 一覧 = ソースの一覧();
    expect(一覧.length).toBeGreaterThan(5);
    expect(一覧).toContain("manifest.json");
    expect(一覧).toContain("popup.js");
  });

  it("manifest とポップアップが読み込むJSは、すべて走査の対象に入っている", () => {
    const manifest = manifestを読む();
    const 参照 = [
      ...manifest.content_scripts.flatMap((c) => c.js || []),
      // background（サービスワーカー）は今は無い。足したときに走査から漏れないよう、
      // ここで一緒に見る。
      ...(manifest.background && manifest.background.service_worker
        ? [manifest.background.service_worker]
        : []),
      // ポップアップの <script src> も、拡張機能として実行されるコード。
      ...[...readFileSync(join(ルート, "popup.html"), "utf8").matchAll(/<script\s+src="([^"]+)"/g)].map(
        (m) => m[1]
      ),
    ];
    expect(参照.length).toBeGreaterThan(0);

    const 一覧 = ソースの一覧();
    for (const js of 参照) {
      expect(一覧, `${js} が走査されていない`).toContain(js);
    }
  });
});

describe("越えない一線（コードで強制する）", () => {
  it("HTTPを発する呼び出しが1つも無い", () => {
    // fetch / XHR / WebSocket / ビーコン / SSE。どれも書かないのが一線（6.79.2-1）。
    const 検体 = [
      [/\bfetch\s*\(/, 'const r = await fetch("https://example.com");'],
      [/\bXMLHttpRequest\b/, "const x = new XMLHttpRequest();"],
      [/\bWebSocket\b/, 'const s = new WebSocket("wss://example.com");'],
      [/\bsendBeacon\b/, 'navigator.sendBeacon("/log", d);'],
      [/\bEventSource\b/, 'const e = new EventSource("/sse");'],
      [/\bnavigator\s*\.\s*serviceWorker\b/, 'navigator.serviceWorker.register("sw.js");'],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("送信操作（クリック・submit・キー入力の合成）のコードが1つも無い", () => {
    // 投稿ボタンは作者が押す（6.79.2-2。なろう第14条23号の一線）。
    const 検体 = [
      [/\.click\s*\(/, 'document.querySelector("#post").click();'],
      [/\.submit\s*\(/, "form.submit();"],
      [/requestSubmit/, "form.requestSubmit();"],
      [/new\s+MouseEvent/, 'el.dispatchEvent(new MouseEvent("click"));'],
      [/new\s+PointerEvent/, 'el.dispatchEvent(new PointerEvent("pointerdown"));'],
      [/new\s+KeyboardEvent/, 'el.dispatchEvent(new KeyboardEvent("keydown"));'],
      [
        /dispatchEvent\s*\(\s*new\s+Event\s*\(\s*["']submit["']/,
        'form.dispatchEvent(new Event("submit"));',
      ],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("認証情報（Cookie・セッション）に触るコードが1つも無い", () => {
    const 検体 = [
      [/document\s*\.\s*cookie/, "const c = document.cookie;"],
      [/chrome\s*\.\s*cookies/, "chrome.cookies.getAll({}, f);"],
      [/chrome\s*\.\s*webRequest/, "chrome.webRequest.onBeforeRequest.addListener(f);"],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("文字列からコードを作って実行するコードが1つも無い", () => {
    // 封筒（＝母艦から来たJSON）の中身を、うっかり「実行できるもの」として扱わないため。
    // 貼り込み係がすることは、文字を欄へ入れることだけで、コードを作る必要はどこにも無い。
    const 検体 = [
      [/\beval\s*\(/, 'eval("1 + 1");'],
      [/new\s+Function\b/, 'const f = new Function("return 1");'],
      [/\bsetTimeout\s*\(\s*["'`]/, 'setTimeout("doIt()", 100);'],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("HTMLを組み立ててページへ差し込むコードが1つも無い", () => {
    // 本文には作者が書いた任意の文字が入る。HTMLとして差し込むと、
    // 「<script>」を含む原稿が投稿ページの中で走ることになる（そしてページも壊れる）。
    // 貼り込み係は textContent と value しか使わない。
    const 検体 = [
      [/\.innerHTML\s*=/, "box.innerHTML = text;"],
      [/\.outerHTML\s*=/, "box.outerHTML = text;"],
      [/insertAdjacentHTML/, 'box.insertAdjacentHTML("beforeend", text);'],
      [/document\s*\.\s*write/, 'document.write("<b>x</b>");'],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("ページへコードを注入する仕組みを使っていない", () => {
    // content_scripts（manifest の matches で範囲が見える形）だけが、ページへ入る道。
    // chrome.scripting は「どのページへでも後から入れる」道なので、使わない。
    const 検体 = [
      [/chrome\s*\.\s*scripting/, "chrome.scripting.executeScript({ target });"],
      [/executeScript/, "browser.tabs.executeScript({ code });"],
      [/chrome\s*\.\s*debugger/, "chrome.debugger.attach(t, v);"],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("ページと窓越しにやり取りするコードが1つも無い", () => {
    // postMessage はページ側のスクリプトと会話する口。
    // 送れば原稿がページのJavaScriptへ渡り（＝集めない約束が崩れ）、
    // 受ければページ側から貼り込みを起こせてしまう（＝作者の明示操作1回の約束が崩れる）。
    const 検体 = [
      [/postMessage\s*\(/, 'window.postMessage({ body }, "*");'],
      [
        /addEventListener\s*\(\s*["']message["']/,
        'window.addEventListener("message", (e) => fill(e.data));',
      ],
      [/\bonmessage\s*=/, "window.onmessage = (e) => fill(e.data);"],
      [/chrome\s*\.\s*runtime\s*\.\s*connect/, 'chrome.runtime.connect({ name: "x" });'],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("権限は最小のまま（増やすときは、この期待値ごと考え直す）", () => {
    const manifest = manifestを読む();
    /*
      0.2.0 で clipboardWrite が増えた。**意図して増やした**もので、
      読者の反応（6.79.7）を母艦へ渡す道がクリップボードしか無いため
      ——通信を1本も発しない約束を保ったまま渡すには、これが唯一の口である。
      増やすときは、この期待値と README の権限の表を必ず一緒に直すこと。
    */
    expect(manifest.permissions).toEqual(["clipboardRead", "clipboardWrite", "activeTab"]);
    // host_permissions は置かない。ページへ入る範囲は content_scripts の matches が唯一の指定。
    expect(manifest.host_permissions).toBeUndefined();
    // 外のサイトやページから、この拡張へ話しかけられる口を開けない。
    expect(manifest.externally_connectable).toBeUndefined();
    // 拡張の中のファイルを、ページから読める場所に置かない。
    expect(manifest.web_accessible_resources).toBeUndefined();
  });

  it("ページへ入る範囲は、対応サイトの投稿まわりだけ", () => {
    const manifest = manifestを読む();
    const matches = manifest.content_scripts.flatMap((c) => c.matches);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      // 全サイト（<all_urls> や https://*/*）へ入らない。
      expect(m).not.toBe("<all_urls>");
      expect(m.startsWith("https://")).toBe(true);
      expect(/^https:\/\/\*/.test(m)).toBe(false);
    }
  });
});

describe("ページから集めない（6.79.7 の枠に言い直した一線）", () => {
  /*
    0.1.0 の約束は「ページから何も集めない」だった。0.2.0 で、設計書6.79.7 が
    許した**作者自身の管理画面の読み取り**を足したので、言い直す。

      集めてよいのは content/read.js だけ／読むのはラベルと数の組だけ／
      読んだものの行き先はクリップボードだけ（保存もしない・送らないは従来どおり）

    「読み取りを足した」を口実に、他のファイルがページの文字を読み始めていないか、
    読んだものが別の行き先へ流れていないかを、ここで見張る。
  */

  it("封筒（novelai-stats）を組み立てるのは、読み取り係だけ", () => {
    const 検体 = [[/novelai-stats/, 'const e = { "novelai-stats": 1 };']];
    expect(
      違反を探す(許したファイルを外す(拡張機能のソース(), ["content/read.js"]), 規則だけ(検体))
    ).toEqual([]);
    検体で自己検査(検体);
  });

  it("ページの文字を読むのは、読み取り係と貼り込み係だけ", () => {
    /*
      貼り込み係（fill.js）が読むのは「欄が空か」の判定だけで、外へは出さない。
      読み取り係（read.js）だけが、読んだ数を封筒にして持ち出す。
      ここに3つ目のファイルが増えたら、それは一線の引き直しであって、
      「ついでの実装」ではない。
    */
    /*
      代入（`el.textContent = "…"`）は読み取りではないので外す。
      **空白を否定の先読みの中へ入れておく**——外に出すと、`\s*` が0文字に
      戻れてしまい、代入まで「読み取り」として拾ってしまう（最初に書いたとき、
      実際に popup.js の `status.textContent = text;` で落ちた）。
    */
    const 読み取りの形 = /\.(?:textContent|innerText)(?!\s*=[^=])/;
    const 検体 = [[読み取りの形, 'const t = el.textContent;']];
    expect(
      違反を探す(
        許したファイルを外す(拡張機能のソース(), ["content/read.js", "content/fill.js"]),
        規則だけ(検体)
      )
    ).toEqual([]);
    検体で自己検査(検体);
    // 書き込み（画面に文字を出す）は禁じていない——出すのは自分の文言だけなので
    expect(読み取りの形.test("status.textContent = text;")).toBe(false);
  });

  it("読んだものの行き先は、クリップボードだけ", () => {
    // クリップボードへ置くのはポップアップ（作者がボタンを押した流れの中）だけ。
    const 検体 = [
      [/navigator\s*\.\s*clipboard\s*\.\s*writeText/, "navigator.clipboard.writeText(json);"],
    ];
    expect(違反を探す(許したファイルを外す(拡張機能のソース(), ["popup.js"]), 規則だけ(検体))).toEqual(
      []
    );
    検体で自己検査(検体);
  });

  it("読んだものを、どこにも溜めない", () => {
    // 溜めれば、あとから別の何かが持ち出せる。封筒はその場で作って、その場で渡すだけ。
    const 検体 = [
      [/chrome\s*\.\s*storage/, 'chrome.storage.local.set({ stats });'],
      [/\blocalStorage\b/, 'localStorage.setItem("stats", json);'],
      [/\bsessionStorage\b/, 'sessionStorage.setItem("stats", json);'],
      [/\bindexedDB\b/, 'const db = indexedDB.open("stats");'],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });

  it("ページを見張らない（作者の操作1回につき1回だけ動く）", () => {
    // 開いているだけで数字を拾い続ける作りは、6.79.2-4 の一線を越える。
    const 検体 = [
      [/\bMutationObserver\b/, "new MutationObserver(f).observe(document.body, {});"],
      [/\bsetInterval\s*\(/, "setInterval(read, 1000);"],
      [/\brequestIdleCallback\s*\(/, "requestIdleCallback(read);"],
    ];
    expect(違反を探す(拡張機能のソース(), 規則だけ(検体))).toEqual([]);
    検体で自己検査(検体);
  });
});

describe("サイトの表", () => {
  const { SITES, siteById } = require("../content/sites.js");

  it("対応サイトはカクヨムとアルファポリス、なろうは枠だけ", () => {
    expect(SITES.map((s) => s.id)).toEqual(["kakuyomu", "alphapolis", "narou"]);
    expect(siteById("kakuyomu").supported).toBe(true);
    expect(siteById("alphapolis").supported).toBe(true);
    // なろうは規約が最も厳しい。貼り込みの可否は作者の判断待ち（6.79.1）。
    expect(siteById("narou").supported).toBe(false);
  });

  it("対応サイトには本文欄の指定が要る（欄の指定漏れで黙って違う欄に入れない）", () => {
    for (const site of SITES.filter((s) => s.supported)) {
      expect(site.fields.body.selectors.strict.length).toBeGreaterThan(0);
      expect(site.postPagePatterns.length).toBeGreaterThan(0);
    }
  });

  it("欄のセレクタは、厳密と汎用に分けてある（汎用で当たったら確認を出すため）", () => {
    for (const site of SITES.filter((s) => s.supported)) {
      for (const 欄 of Object.values(site.fields)) {
        expect(Array.isArray(欄.selectors.strict)).toBe(true);
        expect(Array.isArray(欄.selectors.generic)).toBe(true);
      }
    }
  });

  it("欄を探す起点が決めてある（ページ全体を当てにいかない）", () => {
    for (const site of SITES.filter((s) => s.supported)) {
      expect(Array.isArray(site.formScopes)).toBe(true);
      expect(site.formScopes.length).toBeGreaterThan(0);
    }
  });
});
