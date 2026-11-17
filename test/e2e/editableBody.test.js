/**
 * 本文の欄が textarea でなく、字の飾りができる欄（contenteditable）だったら、いまの貼り込みで何が起きるか（画面の自動テスト）。
 *
 * ネオページの貼り込みを作る下ごしらえ（作者の決定 2026-11-17「ネオページを先に作る」）。ネオページのエピソードの編集画面は
 * 公開のヘルプでは「エディタ」と書かれていて、本文の欄が textarea か飾りのできる欄かは、作者の画面を1枚もらうまで分からない。
 * カクヨム・アルファポリスはどちらも textarea で、飾りのできる欄へ入れる道（fill.js の setFieldValue の前半）は
 * 本物の画面で一度も通っていない。**直す前に、いまの振る舞いをここで固定しておく**——ネオページの画面が届いたとき、
 * この結果と比べて直すかを決める（直し方はまだ選ばない）。
 *
 * 見本はこのファイルの中に置く（カクヨムの作成画面の URL に、本文が div[contenteditable] の形を返す）。
 * 本物のページの写しではない。表の起点（#episode-editForm）の中にあり、本文の欄はサイト固有の形（strict）に当たらず、
 * 汎用の形（div[contenteditable="true"]）に当たる——だから確認の窓が1度出る（汎用で当たった欄は空でも確かめる）。
 */
import { describe, expect, it } from "vitest";
import { PAGES, WORK_ID, waitUntil, withHelper } from "./support/helperBrowser.js";

const 見本 = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>飾りのできる本文の欄（見本）</title></head>
<body>
<main>
  <form id="episode-editForm" action="/my/works/${WORK_ID}/episodes/new" method="post">
    <input id="episodeTitle-input" name="title" type="text" value="" />
    <div id="editor" contenteditable="true" style="min-height:4em"></div>
  </form>
</main>
<script>
  // 欄に届いた合図を数える（飾りのできる欄の作り手は、input より先に beforeinput を見ることが多い）
  window.__届いた = [];
  const 欄 = document.getElementById("editor");
  for (const 名前 of ["beforeinput", "input", "change"]) {
    欄.addEventListener(名前, (e) => window.__届いた.push({ 名前, 形: e.constructor.name, inputType: e.inputType || "" }));
  }
</script>
</body></html>`;

const 原稿 = {
  "novelai-post": 1,
  site: "kakuyomu",
  workId: WORK_ID,
  title: "第1話 飾りの欄",
  body: "一行目の本文。\n二行目の本文。\n\n空行のあとの三行目。",
};

/** ページを新しいタブで開き、そのページとタブの番号を返す（tabs の権限が無いので、開く前と後の差で引く） */
async function 開いて番号を引く(h, url) {
  const 番号たち = async () => (await h.inWorker(() => chrome.tabs.query({}))).map((t) => t.id);
  const 前 = new Set(await 番号たち());
  const ページ = await h.open(url);
  const tabId = await waitUntil(async () => (await 番号たち()).filter((id) => !前.has(id)).at(-1) || null, {
    what: `${url} のタブ`,
  });
  return { ページ, tabId };
}

describe("本文の欄が飾りのできる欄（contenteditable）のとき（ネオページの下ごしらえ）", () => {
  it("いまの作りでは、確認のあと字は入るが、改行は段落にならず、beforeinput は届かない", () =>
    withHelper(async (h) => {
      // カクヨムの作成画面の URL に、この見本を返す（後に足した route が先に当たる）
      await h.context.route(
        (u) => u.href === PAGES.kakuyomuNew,
        (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: 見本 })
      );
      const { ページ, tabId } = await 開いて番号を引く(h, PAGES.kakuyomuNew);
      let 窓の文 = "";
      ページ.once("dialog", async (d) => {
        窓の文 = d.message();
        await d.accept();
      });
      await h.inWorker((t) => クリップボードに頼む({ type: "write", text: t }), JSON.stringify(原稿));
      await h.inWorker(({ id, url }) => 実行する({ id, url, active: true }, url), { id: tabId, url: PAGES.kakuyomuNew });

      await ページ.waitForFunction(() => document.getElementById("editor").textContent !== "", null, { timeout: 30_000 });
      const 様子 = await ページ.evaluate(() => {
        const 欄 = document.getElementById("editor");
        return {
          字: 欄.textContent,
          見える字: 欄.innerText,
          子の要素: 欄.children.length,
          届いた: window.__届いた,
        };
      });

      // 汎用の形で当たったので、空でも確認の窓が1度出る（guard.js の confirmationNeeded）
      expect(窓の文).not.toBe("");
      // 題は textarea の作成画面と同じく入る
      expect(await ページ.inputValue("#episodeTitle-input")).toBe(原稿.title);
      // 字そのものは改行ごと入る（textContent で入れているため）
      expect(様子.字).toBe(原稿.body);
      // ただし段落（<p>・<div>・<br>）は作られない——改行は1つの字の並びの中に残るだけ
      expect(様子.子の要素).toBe(0);
      // 欄の飾り（white-space）がふつうなら、見た目では改行が空白につぶれる
      expect(様子.見える字).not.toContain("\n");
      // 届くのは input（ただの Event）1つだけ。beforeinput も change も届かない
      // ——beforeinput を見て中身を持ち直す作りのエディタだと、字を入れたことに気づかないおそれがある
      expect(様子.届いた).toEqual([{ 名前: "input", 形: "Event", inputType: "" }]);
    }));
});
