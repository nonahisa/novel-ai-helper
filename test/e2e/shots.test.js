/**
 * 作者の目で見てもらう画面の写真を、機械が撮る（実機確認を自動へ寄せる決まりの5。2026-11-12）。
 *
 * **頼んだときだけ流れる**（`NPH_SHOTS=1`）。ふだんの E2E・配布の全件には入れない。写真は `dist/shots/` に置く
 * （dist は git に入らない）。次の版でも同じ絵を撮れるよう、撮り方はここに残す。
 *
 *   NPH_SHOTS=1 NPH_E2E_CHANNEL=msedge npx vitest run --config vitest.e2e.config.mjs test/e2e/shots.test.js
 *
 * 撮るもの（休みの日の一枚の項目）：
 * - D の手順6：入れた直後に開く説明のページ（「はじめに」）
 * - D の手順9：吹き出しの問い（「開いたときに自動で取得しますか？」）
 * - E：お祝いの吹き出しと、風船・花火・大きな花火（動きの途中を3枚ずつ）
 * - B：ツールバーのアイコンと印を、明るいツールバー・暗いツールバーの色の上に並べた絵
 *
 * **これは本物のツールバー・本物の吹き出しの位置ではない。** Playwright はブラウザの枠（ツールバー）を撮れないので、
 * B は拡張の絵（icons/toolbar*.png）を Chrome のツールバーに近い色の上へ置いた見立て、吹き出しは bubble.html を
 * 吹き出しと同じ幅のページとして開いたもの。印の字の形（Chrome が描く）も見立てである。
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import { Actions, EXTENSION_ROOT, Messages, sleep, waitUntil, withHelper } from "./support/helperBrowser.js";

const 置き場 = join(EXTENSION_ROOT, "dist", "shots");

describe.skipIf(!process.env.NPH_SHOTS)("作者に見てもらう写真（頼んだときだけ）", () => {
  it("説明のページ・吹き出し・お祝い・ツールバーのアイコンを撮る", { timeout: 120_000 }, () =>
    withHelper(async (h) => {
      await mkdir(置き場, { recursive: true });

      // D の手順6：入れた直後に開く説明のページ
      const 入れた直後 = await waitUntil(
        async () => h.context.pages().find((p) => p.url().startsWith(h.url("options.html"))) || null,
        { what: "入れた直後の説明のページ" }
      );
      await 入れた直後.setViewportSize({ width: 1000, height: 800 });
      await 入れた直後.waitForLoadState("load");
      await sleep(500);
      await 入れた直後.screenshot({ path: join(置き場, "D6-説明のページ-最初の画面.png") });
      await 入れた直後.screenshot({ path: join(置き場, "D6-説明のページ-全体.png"), fullPage: true });

      // 吹き出し（bubble.html）を、吹き出しと同じ幅のページで開いて撮る
      const 吹き出し = async (名, 問い合わせ, 枚 = [400]) => {
        const p = await h.context.newPage();
        await p.setViewportSize({ width: 320, height: 260 });
        await p.goto(h.url(`bubble.html?${new URLSearchParams(問い合わせ).toString()}`), { waitUntil: "load" });
        let 前 = 0;
        for (const [i, ミリ秒] of 枚.entries()) {
          await sleep(ミリ秒 - 前);
          前 = ミリ秒;
          await p.screenshot({ path: join(置き場, `${名}${枚.length > 1 ? `-${i + 1}` : ""}.png`) });
        }
        await p.close();
      };
      await 吹き出し("D9-吹き出しの問い", {
        mode: "ask",
        key: "kakuyomu|work",
        title: Messages.APP_NAME,
        text: "カクヨムの作品管理を開いたときに、自動で取得しますか？（見本の文）",
      });
      const お祝いの文 = "「画面テストの作品」が「異世界ファンタジー 週間」で 5 位に入っています。おめでとうございます！";
      for (const 演出 of ["balloons", "fireworks", "grand"]) {
        await 吹き出し(`E-お祝い-${演出}`, { mode: "celebrate", effect: 演出, title: "ランキングに入っています", text: お祝いの文 }, [300, 1000, 2000]);
      }

      // B：ツールバーのアイコンと印（見立て）
      const 絵 = (n) => h.url(`icons/toolbar${n}.png`);
      const 印 = [
        { text: "", color: "" },
        { text: "読3", color: Actions.BADGES.stats.color },
        { text: Actions.BADGES.fill.text, color: Actions.BADGES.fill.color },
        { text: Actions.BADGES.contests.text, color: Actions.BADGES.contests.color },
        { text: Actions.BADGES.celebrate.text, color: Actions.BADGES.celebrate.color },
      ];
      const 帯 = (名, 背景, 字) => `
        <section style="background:${背景};color:${字};padding:10px 16px;margin:0 0 12px">
          <div style="font:13px sans-serif;margin-bottom:6px">${名}</div>
          <div style="display:flex;gap:18px;align-items:center">
            ${印
              .map(
                (b) => `<div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center">
                  <img src="${絵(16)}" srcset="${絵(16)} 1x, ${絵(32)} 2x" width="16" height="16">
                  ${b.text ? `<span style="position:absolute;right:-6px;bottom:0;background:${b.color};color:#fff;font:bold 9px sans-serif;border-radius:3px;padding:0 2px;line-height:12px">${b.text}</span>` : ""}
                </div>`
              )
              .join("")}
            <span style="font:12px sans-serif;opacity:.7">← 印なし・読3・貼・募・祝</span>
          </div>
        </section>`;
      // 持ち続けるプロフィールでは、ページごとに画素の倍率を変えられないので、2倍は CSS の zoom で見立てる
      const p = await h.context.newPage();
      await p.setViewportSize({ width: 1040, height: 300 });
      await p.goto(h.url("bubble.html"), { waitUntil: "load" });
      const 二つ = 帯("明るいツールバー（見立て #FFFFFF）", "#ffffff", "#1f1f1f") + 帯("暗いツールバー（見立て #3C3C3C）", "#3c3c3c", "#e8e8e8");
      await p.evaluate(
        (中身) => {
          document.body.removeAttribute("data-mode");
          document.body.innerHTML = 中身;
          document.body.style.cssText = "margin:0;width:auto;display:flex;gap:16px;align-items:flex-start;background:#999";
        },
        `<div style="width:520px">${二つ}</div><div style="zoom:2;width:500px">${二つ}</div>`
      );
      await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      await p.setViewportSize({ width: 1600, height: 330 });
      await p.screenshot({ path: join(置き場, "B-ツールバーのアイコン.png"), fullPage: true });
      await p.close();
      console.info(`写真の置き場：${置き場}`);
    })
  );
});
