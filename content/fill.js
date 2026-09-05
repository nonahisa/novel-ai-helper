"use strict";

/**
 * ページ側の貼り込み係（content script）。
 *
 * ここが唯一、投稿ページのDOMを触る場所。守っていること：
 *
 * 1. **読み込まれただけでは何もしない**。下でメッセージの受け口を登録するだけで、
 *    DOMを見るのは、作者がポップアップのボタンを押してメッセージが届いたときだけ
 *    （設計書6.79.2-4「作者の明示操作1回につき1回」）。
 * 2. **送信しない**。click() も submit() も、Enterキーの合成も、このファイルには無い
 *    （6.79.2-2）。埋めるところで止め、投稿ボタンは作者が押す。
 * 3. **HTTPを1本も発しない**（6.79.2-1）。fetch / XMLHttpRequest / WebSocket は使わない。
 * 4. **ページから集めない**（6.79.2-3）。見るのは「埋める欄が在るか」「その欄が空か」だけで、
 *    中身を外（ポップアップ・クリップボード・どこか）へ持ち出さない。
 * 5. **ログイン画面では何もしない**（6.79.6-1）。パスワード欄があれば、欄を探す前に降りる。
 */
(function () {
  const Sites = globalThis.NPHSites;
  const Guard = globalThis.NPHGuard;
  const Messages = globalThis.NPHMessages;

  /**
   * ページ上の入力欄から、判定に要る情報「だけ」を写し取る。
   * 値（作者が書いた文字）はここに含めない——判定に不要なものは読まない。
   */
  function collectInputDescriptors() {
    const inputs = document.querySelectorAll("input");
    const descriptors = [];
    inputs.forEach((el) => {
      descriptors.push({
        type: el.type,
        autocomplete: el.getAttribute("autocomplete") || "",
        // 隠しのパスワード欄（自動入力よけ）で機能が死なないよう、見えているかを渡す。
        visible: isVisible(el),
      });
    });
    return descriptors;
  }

  function isVisible(el) {
    // getClientRects().length で足りる（display:none も visibility:hidden の親も 0 になる）。
    try {
      return el.getClientRects().length > 0;
    } catch (_e) {
      return true; // 判定できないときは「見えている」側＝安全に倒す。
    }
  }

  function describeElement(el) {
    return {
      type: el.getAttribute("type") || (el.tagName === "TEXTAREA" ? "textarea" : ""),
      autocomplete: el.getAttribute("autocomplete") || "",
      readOnly: el.readOnly === true || el.getAttribute("aria-readonly") === "true",
      disabled: el.disabled === true,
    };
  }

  /**
   * 表のセレクタを上から試し、最初に見つかった「書いてよい欄」を返す。
   * 見つからなければ null（＝ページの形が変わった。何もしない）。
   */
  function findField(fieldSpec) {
    if (!fieldSpec || !Array.isArray(fieldSpec.selectors)) {
      return null;
    }
    for (const selector of fieldSpec.selectors) {
      let el;
      try {
        el = document.querySelector(selector);
      } catch (_e) {
        continue; // セレクタの書き間違いで全体を止めない
      }
      if (!el) {
        continue;
      }
      if (!isVisible(el)) {
        continue;
      }
      // セレクタが思わぬ欄に当たったときの最後の関門（パスワード・隠し・読み取り専用）。
      if (!Guard.isSafeTarget(describeElement(el))) {
        continue;
      }
      return el;
    }
    return null;
  }

  /** いまの中身。空かどうかの判定にだけ使い、外へは出さない。 */
  function currentText(el) {
    return el.isContentEditable ? el.textContent || "" : el.value || "";
  }

  /**
   * 欄へ文字を入れる。
   *
   * value を直接代入するだけでは、React などで作られた画面が変更に気づかず、
   * 投稿時に空のまま送られることがある。ネイティブの setter を通してから
   * input / change を配るのはそのため（**送信のイベントは配らない**）。
   */
  function setFieldValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * 結果をページの隅に数秒出す。
   * 確認ダイアログを出すとポップアップが閉じてしまい、結果が見えなくなるため。
   */
  function toast(text) {
    try {
      const box = document.createElement("div");
      box.textContent = `貼り込み係：${text}`;
      box.style.position = "fixed";
      box.style.zIndex = "2147483647";
      box.style.right = "16px";
      box.style.bottom = "16px";
      box.style.maxWidth = "360px";
      box.style.padding = "12px 14px";
      box.style.borderRadius = "8px";
      box.style.background = "rgba(28,28,30,0.94)";
      box.style.color = "#fff";
      box.style.font = "14px/1.6 system-ui, sans-serif";
      box.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)";
      box.style.whiteSpace = "pre-wrap";
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 8000);
    } catch (_e) {
      // 表示できなくても、貼り込みそのものには影響しない。
    }
  }

  /**
   * 貼り込みの本体。ポップアップからのメッセージ1回につき1回だけ走る。
   */
  function fill(envelope) {
    // 1. ログイン画面なら、欄を探すまでもなく降りる。
    if (Guard.isLoginLikePage(collectInputDescriptors())) {
      return { ok: false, message: Messages.PAGE.loginPage };
    }

    const site = Sites.siteById(envelope.site);
    if (!site || !site.supported) {
      return { ok: false, message: Messages.PAGE.fieldsNotFound };
    }

    // 2. 欄を探す。本文欄が無ければ、ここが「話の作成画面」ではないということ。
    const titleEl = findField(site.fields.title);
    const bodyEl = findField(site.fields.body);
    if (!bodyEl) {
      return { ok: false, message: Messages.PAGE.fieldsNotFound };
    }

    // 3. 空でない欄には、確認してから（6.79.6-3。書きかけを黙って消さない）。
    const willFillTitle = titleEl !== null && envelope.title !== "";
    const occupied = [];
    if (willFillTitle && currentText(titleEl).trim() !== "") {
      occupied.push(site.fields.title.label);
    }
    if (currentText(bodyEl).trim() !== "") {
      occupied.push(site.fields.body.label);
    }
    if (occupied.length > 0) {
      const agreed = window.confirm(Messages.confirmOverwrite(occupied.join("と")));
      if (!agreed) {
        // 断られたら、片方だけ入れることもしない。何もしない。
        toast(Messages.PAGE.canceled);
        return { ok: false, message: Messages.PAGE.canceled };
      }
    }

    // 4. 埋める。ここで終わり——送信はしない。
    const filled = [];
    const skipped = [];
    if (willFillTitle) {
      setFieldValue(titleEl, envelope.title);
      filled.push(site.fields.title.label);
    } else if (titleEl === null) {
      skipped.push(site.fields.title.label);
    } else {
      skipped.push("タイトル（封筒が空）");
    }
    setFieldValue(bodyEl, envelope.body);
    filled.push(site.fields.body.label);

    const message = Messages.messageForFilled(filled, skipped);
    toast(message);
    return { ok: true, message };
  }

  // 受け口の登録だけを行う。ここではDOMを読まない（開いただけでは動かない）。
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!request || request.type !== "fill") {
      return false;
    }
    let result;
    try {
      result = fill(request.envelope);
    } catch (e) {
      // 何が起きても、原稿の側は壊れない（埋める以外のことをしていないため）。
      result = { ok: false, message: `貼り込みの途中で問題が起きました：${e && e.message}` };
    }
    sendResponse(result);
    return false;
  });
})();
