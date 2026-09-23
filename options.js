"use strict";

/**
 * 説明のページ（options.html）。
 *
 * - 見出しの脇へ版を入れる。版は **manifest から読む**（作者の依頼、2026-09-22。0.7.x ではポップアップがしていた）
 *   ——ここへ書き写すと、版を上げた日に画面だけが古い版を言い続ける
 * - 溜まっている読者の反応と、ご自分の作品として覚えた作品を見せ、直せるようにする（作者の依頼、2026-09-23）
 * - 覚えた作品ごとの読者の反応の集計を見せる（作者の方針、2026-09-23「単体でも使えたほうがよい」）。
 *   集計の文は裏方が common/history.js で組んで返す。ここは <pre> へ入れるだけ
 * - 「統合小説執筆環境へ渡す」の切り替え（作者の裁定、2026-09-23）。切っている間は、渡す分の欄を隠す
 *
 * **保存には触れない。** 溜まりの読み書きは裏方（background.js）だけがする（test/redLine.test.js が見張る）。
 * このページは裏方へ頼み、返ってきた文字を欄へ入れるだけ。部品は options.html に書いてあり、ここでは作らない。
 */
(function () {
  const 欄 = (id) => document.getElementById(id);

  /** 覚えた作品の欄を、作者が書きかけているか（書きかけを、読み直しで消さないため）。 */
  let 書きかけ = false;

  const versionSlot = 欄("version");
  if (versionSlot && chrome.runtime && chrome.runtime.getManifest) {
    const 版 = chrome.runtime.getManifest().version;
    if (版) versionSlot.textContent = "v" + 版;
  }

  /** 裏方へ頼む。返事が無いときも、ページが止まらないよう形を揃える。 */
  async function 頼む(依頼) {
    try {
      const 返事 = await chrome.runtime.sendMessage(依頼);
      return 返事 || { ok: false };
    } catch (e) {
      return { ok: false, detail: e && e.message };
    }
  }

  function 日時(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP");
  }

  function 作品の名(siteId, workId) {
    return siteId === "narouFun" ? `Narou.fun の作品 ${workId}` : `カクヨムの作品 ${workId}`;
  }

  /**
   * 読者の反応の集計を読み直して、欄へ入れる。
   * 表も棒も裏方が字で組んだものを、そのまま入れる（ページで要素を作らない約束）。
   */
  async function 集計を映す() {
    const 返事 = await 頼む({ type: "options-report" });
    if (!返事.ok) {
      欄("report").textContent = "集計を読めませんでした。拡張を再読み込みしてから、このページを開き直してください。";
      return;
    }
    欄("report").textContent = 返事.text || "";
    const 上限 = 返事.limits || {};
    欄("history-limits").textContent = `${上限.maxWorks}作品・${上限.maxDays}日ぶんまで（全体で${Math.round((上限.maxChars || 0) / 10000)}万字まで）`;
    欄("clear-history").disabled = false;
  }

  /** 溜まりの様子を読み直して、欄へ入れる。 */
  async function 映す() {
    await 集計を映す();
    const 様子 = await 頼む({ type: "options-status" });
    if (!様子.ok) {
      欄("stash-count").textContent = "溜まりの様子を読めませんでした。拡張を再読み込みしてから、このページを開き直してください。";
      return;
    }
    // 「統合小説執筆環境へ渡す」。切っている間は、渡す分の欄を隠す（溜まりは消さない）
    const 渡す = 様子.handToIde === true;
    欄("hand-to-ide").checked = 渡す;
    欄("hand-to-ide").disabled = false;
    欄("hand-section").hidden = !渡す;

    const s = 様子.summary || { pages: 0, works: 0, entries: 0 };
    欄("stash-count").textContent =
      s.pages > 0
        ? `いま ${s.pages}画面ぶん（${s.works}作品・${s.entries}件）溜まっています。`
        : "いま溜まっている読者の反応はありません。";
    欄("stash-list").textContent = (様子.items || []).join("\n");
    欄("hand-now").disabled = s.pages === 0;
    欄("clear-stash").disabled = s.pages === 0;
    欄("limit-items").textContent = String((様子.limits && 様子.limits.maxItems) || "");

    if (様子.handed) {
      const h = 様子.handed.summary;
      欄("handed-summary").textContent = `前に渡した分：${日時(様子.handed.handedAt)}に ${h.pages}画面ぶん（${h.works}作品・${h.entries}件）。`;
      欄("hand-again").disabled = false;
    } else {
      欄("handed-summary").textContent = "もう一度渡せる分はありません。";
      欄("hand-again").disabled = true;
    }

    const 訊きかけ = 様子.pending;
    欄("pending").hidden = !訊きかけ;
    欄("approve-pending").disabled = false;
    欄("decline-pending").disabled = false;
    if (訊きかけ) {
      欄("pending-text").textContent = `${作品の名(訊きかけ.siteId, 訊きかけ.workId)}を、ご自分の作品として覚えますか？（${日時(訊きかけ.askedAt)}にお尋ねしました）`;
    }

    const 覚えた = 様子.ownWorks || [];
    欄("own-narou").value = 覚えた.filter((w) => w.siteId === "narouFun").map((w) => w.workId).join("\n");
    欄("own-kakuyomu").value = 覚えた.filter((w) => w.siteId === "kakuyomu").map((w) => w.workId).join("\n");
  }

  async function 押した(ボタン, 依頼, 結果の欄) {
    ボタン.disabled = true;
    const 返事 = await 頼む(依頼);
    if (結果の欄) {
      結果の欄.textContent = 返事.ok ? "" : 返事.detail || "";
    }
    await 映す();
    return 返事;
  }

  欄("hand-to-ide").addEventListener("change", async () => {
    const チェック = 欄("hand-to-ide");
    チェック.disabled = true;
    const 返事 = await 頼む({ type: "options-set-hand-to-ide", on: チェック.checked });
    欄("toggle-result").textContent = 返事.ok
      ? 返事.handToIde
        ? "入れました。開いているページの印は、ページを開き直すと切り替わります。"
        : "切りました。溜まっていた分は消していません（入れ直せば渡せます）。開いているページの印は、ページを開き直すと切り替わります。"
      : `切り替えられませんでした。${返事.detail || ""}`;
    await 映す();
  });
  欄("refresh-report").addEventListener("click", () => 集計を映す());
  欄("clear-history").addEventListener("click", () => {
    // 記録は消すと戻らない（サイトは過去の日の数を出さないことが多い）。押し間違いで消さないよう、一度だけ確かめる
    if (!window.confirm("集計の記録（日ごとの数）を消します。消した分は戻りません。よろしいですか？（覚えた作品と、統合小説執筆環境へ渡す溜まりは残ります）")) {
      return;
    }
    押した(欄("clear-history"), { type: "options-clear-history" }, 欄("report-result"));
  });
  欄("hand-now").addEventListener("click", () => 押した(欄("hand-now"), { type: "options-hand" }, 欄("action-result")));
  欄("hand-again").addEventListener("click", () =>
    押した(欄("hand-again"), { type: "options-hand-again" }, 欄("action-result"))
  );
  欄("clear-stash").addEventListener("click", () => {
    // 溜まりを消すと、画面を開き直すまで戻らない。押し間違いで消さないよう、一度だけ確かめる
    if (!window.confirm("溜まっている読者の反応を消します。よろしいですか？（渡した分の控えは残ります）")) {
      return;
    }
    押した(欄("clear-stash"), { type: "options-clear" }, 欄("action-result"));
  });
  欄("approve-pending").addEventListener("click", () =>
    押した(欄("approve-pending"), { type: "options-approve-pending" }, 欄("own-result"))
  );
  欄("decline-pending").addEventListener("click", () =>
    押した(欄("decline-pending"), { type: "options-decline-pending" }, 欄("own-result"))
  );
  欄("save-own").addEventListener("click", async () => {
    欄("save-own").disabled = true;
    const 返事 = await 頼む({
      type: "options-save-own-works",
      texts: { narouFun: 欄("own-narou").value, kakuyomu: 欄("own-kakuyomu").value },
    });
    欄("save-own").disabled = false;
    if (返事.ok) {
      書きかけ = false;
      欄("own-result").textContent = "保存しました。";
      await 映す();
      return;
    }
    // 保存できなかったときは、欄を読み直さない（作者が書きかけた行を消さないため）
    欄("own-result").textContent = 返事.bad && 返事.bad.length > 0
      ? `形の合わない行があるので、保存しませんでした：${返事.bad.join("、")}（Nコードは n と4桁の数字と英字1〜2字、カクヨムの作品IDは数字だけです）`
      : `保存できませんでした。${返事.detail || ""}`;
  });

  // ほかのタブで溜まったあとに、このページへ戻ってきたとき。覚えた作品の欄を書きかけのときは
  // 読み直さない（書きかけを消さないため。保存すれば読み直す）
  for (const id of ["own-narou", "own-kakuyomu"]) {
    欄(id).addEventListener("input", () => (書きかけ = true));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !書きかけ) {
      映す();
    }
  });

  映す();
})();
