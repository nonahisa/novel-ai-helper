"use strict";

/**
 * ページ側の貼り込み係（content script）。
 *
 * ここが唯一、投稿ページのDOMを触る場所。守っていること：
 *
 * 1. **読み込まれただけでは何もしない**。下でメッセージの受け口を登録するだけで、
 *    DOMを見るのは、作者がアイコン（または右クリックの項目）を押してメッセージが届いたときだけ
 *    （設計書6.79.2-4「作者の明示操作1回につき1回」）。
 * 2. **送信しない**。click() も submit() も、Enterキーの合成も、このファイルには無い
 *    （6.79.2-2）。埋めるところで止め、投稿ボタンは作者が押す。
 * 3. **HTTPを1本も発しない**（6.79.2-1）。fetch / XMLHttpRequest / WebSocket は使わない。
 * 4. **ページから集めない**（6.79.2-3）。見るのは「埋める欄が在るか」「その欄が空か」だけで、
 *    中身を外（拡張の裏方・クリップボード・どこか）へ持ち出さない。
 *    **例外は1つだけ**（0.20.0。作者の答え 2026-11-05「題も添える」）：話の編集画面の題の欄の字を、
 *    裏方に頼まれたときに返す（readEpisodeTitle。投稿したあとの話の番号の封筒に添える。本文は返さない）。
 * 7. **ページへ要素を差し込まない**（0.8.0）。結果は Chrome の知らせ（通知）で出す。
 *    0.7.x まではページの隅に結果の箱を差し込んでいたが、作者の裁定（2026-09-23）で
 *    「ページへHTMLを差し込まない」を約束にしたので、箱ごと外した。
 * 5. **ログイン画面では何もしない**（6.79.6-1）。パスワード欄があれば、欄を探す前に降りる。
 * 6. **欄を探す範囲は投稿フォームの中だけ**。表の formScopes で起点を決め、その配下を探す。
 *    さらに、`#body` のような汎用のセレクタで当たった欄には、**空でも一度確認を出す**
 *    ——見当違いの欄へ無確認で書き込むのが、いちばん起きてほしくない事故のため。
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
   * 欄を探す起点を決める。
   *
   * `#title` や `div[contenteditable]` をページ全体に掛けると、投稿フォームの外
   * （検索欄、コメント欄、サイドバーの編集領域）に当たりうる。表の formScopes を
   * 上から試し、見つかった要素の**中だけ**を探すのはそのため。
   * どれも見つからなければページ全体に戻すが、そのときに当たった欄は
   * 汎用扱い（＝確認を出す）になるので、無確認で書くことにはならない。
   */
  function findScope(site) {
    if (!Array.isArray(site.formScopes)) {
      return document;
    }
    for (const selector of site.formScopes) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          return el;
        }
      } catch (_e) {
        continue; // セレクタの書き間違いで全体を止めない
      }
    }
    return document;
  }

  /**
   * 起点の中で、表のセレクタを上から試し、最初に見つかった「書いてよい欄」を返す。
   * 見つからなければ null（＝ページの形が変わった。何もしない）。
   *
   * 戻り値に kind（strict / generic）を載せるのは、**当たり方によって
   * 確認の要否が変わる**ため（guard.js の confirmationNeeded）。
   */
  function findField(fieldSpec, scope, scopeFound) {
    for (const { selector, kind } of Guard.selectorPlan(fieldSpec)) {
      let el;
      try {
        el = scope.querySelector(selector);
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
      // 起点が見つからずページ全体を探したときは、厳密なセレクタでも「確かとは言えない」。
      // 投稿フォームの中だと確かめられていないため、汎用へ格下げして確認を出す。
      return { el, kind: scopeFound ? kind : "generic" };
    }
    return null;
  }

  /**
   * 入れた欄が「ページのどれ」だったのかを短く表す。
   * セレクタは推測で書いてあるので、思わぬ欄に入ったときに作者が気づけるようにする。
   */
  function elementSignature(el) {
    try {
      const tag = String(el.tagName || "").toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const name = el.getAttribute && el.getAttribute("name") ? `[name=${el.getAttribute("name")}]` : "";
      return `${tag}${id}${name}`;
    } catch (_e) {
      return "";
    }
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
   * 章を選ぶ（0.15.0。表に chapter の欄を持つサイト＝いまはアルファポリスだけ）。
   *
   * 呼ぶのは、題と本文を入れ終えたあとだけ。ログイン画面・本文欄が無い画面・確認で断られたときは
   * その前に fill が返っているので、章にも触らない。
   * 読むのは選択肢の字だけで、比べるのに使ったら捨てる（外へ持ち出さない。設計書2章の4）。
   *
   * @returns {undefined|{ok:true, label:string}|{ok:false, reason:string, chapter:string, count?:number}}
   *          undefined は「章のことは何も言わない」（封筒に章が無い・表に章の欄が無い）
   */
  function selectChapter(site, scope, scopeFound, chapter) {
    if (typeof chapter !== "string" || chapter.trim() === "" || !site.chapter) {
      return undefined;
    }
    const 見つからない = { ok: false, reason: "not-found", chapter };
    // 起点（投稿フォーム）が見つからないときは探さない。ページ全体の select に当てると、
    // 投稿と関係のない選択（並べ替え・絞り込みなど）を黙って変えかねないため。
    if (!scopeFound) {
      return 見つからない;
    }
    let el = null;
    for (const selector of site.chapter.selectors || []) {
      try {
        const found = scope.querySelector(selector);
        if (found && found.tagName === "SELECT") {
          el = found;
          break;
        }
      } catch (_e) {
        continue; // セレクタの書き間違いで全体を止めない
      }
    }
    if (!el) {
      return 見つからない;
    }
    // 見えているかは問わない。サイトが本物の select を隠して自前の見た目を重ねていることがあり、
    // その場合も change を配れば見た目は追いつく。選べない状態（disabled）だけは触らない。
    if (el.disabled === true) {
      return { ok: false, reason: "disabled", chapter };
    }
    const 選択肢 = Array.from(el.options || []).map((o) => ({
      // 比べるだけなので長さに上限を掛ける（封筒の章の上限より十分長く）
      label: String(o.textContent || "").slice(0, 300),
      value: typeof o.value === "string" ? o.value : "",
    }));
    const 選んだ = Guard.pickChapterOption(選択肢, chapter);
    if (!選んだ.ok) {
      return { ok: false, reason: 選んだ.reason, chapter, count: 選んだ.count };
    }
    setSelectIndex(el, 選んだ.index);
    return { ok: true, label: Guard.normalizeChapterLabel(選択肢[選んだ.index].label) };
  }

  /**
   * select の項目を選ぶ。setFieldValue と同じく、ネイティブの setter を通してから
   * input / change を配る（React などで作られた画面が変更に気づくように。送信のイベントは配らない）。
   */
  function setSelectIndex(el, index) {
    const value = el.options[index].value;
    const descriptor =
      typeof HTMLSelectElement !== "undefined"
        ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
        : undefined;
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    // 同じ value の項目が2つあると value では目当ての位置にならないので、位置で合わせ直す
    if (el.selectedIndex !== index) {
      el.selectedIndex = index;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * 貼り込みの本体。拡張の裏方からのメッセージ1回につき1回だけ走る。
   */
  function fill(envelope, pageKind) {
    // 1. ログイン画面なら、欄を探すまでもなく降りる。
    if (Guard.isLoginLikePage(collectInputDescriptors())) {
      return { ok: false, message: Messages.PAGE.loginPage };
    }

    const site = Sites.siteById(envelope.site);
    if (!site || !site.supported) {
      return { ok: false, message: Messages.PAGE.fieldsNotFound };
    }

    // 2. 欄を探す。探すのは投稿フォームの中だけ（ページ全体を当てにいかない）。
    //    本文欄が無ければ、ここが「話の作成画面」ではないということ。
    const scope = findScope(site);
    const scopeFound = scope !== document;
    const title = findField(site.fields.title, scope, scopeFound);
    const body = findField(site.fields.body, scope, scopeFound);
    if (!body) {
      return { ok: false, message: Messages.PAGE.fieldsNotFound };
    }

    // 3. 入れる欄を決め、それぞれ「中身があるか」「確かな当たり方か」を見る。
    const willFillTitle = title !== null && envelope.title !== "";
    const targets = [];
    if (willFillTitle) {
      targets.push({
        label: Messages.describeField(site.fields.title.label, elementSignature(title.el)),
        matchKind: title.kind,
        occupied: currentText(title.el).trim() !== "",
      });
    }
    targets.push({
      label: Messages.describeField(site.fields.body.label, elementSignature(body.el)),
      matchKind: body.kind,
      occupied: currentText(body.el).trim() !== "",
    });

    // 中身がある欄（6.79.6-3。書きかけを黙って消さない）と、
    // 汎用セレクタで当たった欄（本当にその欄かを機械では確かめられない）は、確認してから。
    const 確認 = Guard.confirmationNeeded(targets);
    if (pageKind === "edit") {
      /*
        0.20.0：話の編集画面。保存済みの本文を置き換えるので、**中身があってもなくても毎回確かめる**
        （作者の答え 2026-11-04「毎回出す」）。字数と、画面の題とコピーした題が違うかを並べる。
        画面の字は比べて数えるだけで、外へは出さない（設計書2章の4）
      */
      const 画面の題 = title ? currentText(title.el) : "";
      const agreed = window.confirm(
        Messages.confirmReplace({
          currentLength: currentText(body.el).length,
          newLength: envelope.body.length,
          screenTitle: 画面の題,
          newTitle: envelope.title,
          uncertain: 確認.uncertain,
        })
      );
      if (!agreed) {
        return { ok: false, message: Messages.PAGE.canceled };
      }
    } else if (確認.needsConfirm) {
      const agreed = window.confirm(Messages.confirmFill(確認));
      if (!agreed) {
        // 断られたら、片方だけ入れることもしない。何もしない。
        return { ok: false, message: Messages.PAGE.canceled };
      }
    }

    // 4. 埋める。ここで終わり——送信はしない。
    const filled = [];
    const skipped = [];
    if (willFillTitle) {
      setFieldValue(title.el, envelope.title);
      filled.push(Messages.describeField(site.fields.title.label, elementSignature(title.el)));
    } else if (title === null) {
      skipped.push(site.fields.title.label);
    } else {
      skipped.push("タイトル（コピーしたデータの題が空）");
    }
    setFieldValue(body.el, envelope.body);
    filled.push(Messages.describeField(site.fields.body.label, elementSignature(body.el)));

    // 5. 章（0.15.0）。題と本文を入れられたときだけ。選べなくても題と本文はそのまま（知らせで言う）。
    const chapter = selectChapter(site, scope, scopeFound, envelope.chapter);

    const message = Messages.messageForFilled(filled, skipped, chapter);
    return { ok: true, message };
  }

  /** 題の上限（字）。受け手の封筒の title と揃える */
  const 題の上限 = 200;

  /**
   * 話の編集画面の題の欄の字を読む（0.20.0。作者の答え 2026-11-05「題も添える」）。
   *
   * **貼り込み係がページの字を外へ出す、ただ1つの道**（設計書2章の4の引き直し）。読むのは次がすべて揃ったときだけ：
   * - いまのページが、表の話の編集画面（editPagePatterns）である
   * - ログイン画面ではない
   * - 投稿フォームの起点（formScopes）が見つかり、その中で**サイト固有の形（strict）**で当たった題の欄
   * 本文の欄は読まない。字は前後の空白を落として200字で切る。読めなければ null（封筒に題を付けない）。
   * 作者がアイコンを押した流れの中で、裏方から頼まれたときに1回だけ読む（開いただけでは読まない）
   */
  function readEpisodeTitle(siteId) {
    const site = Sites.siteById(siteId);
    if (!site || !site.supported || !Array.isArray(site.editPagePatterns)) {
      return null;
    }
    const パス = String((globalThis.location && globalThis.location.pathname) || "");
    if (!site.editPagePatterns.some((re) => re.test(パス))) {
      return null;
    }
    if (Guard.isLoginLikePage(collectInputDescriptors())) {
      return null;
    }
    const scope = findScope(site);
    if (scope === document) {
      return null;
    }
    const title = findField(site.fields.title, scope, true);
    if (!title || title.kind !== "strict") {
      return null;
    }
    const 字 = currentText(title.el).trim();
    return 字 === "" ? null : 字.slice(0, 題の上限);
  }

  // 受け口の登録だけを行う。ここではDOMを読まない（開いただけでは動かない）。
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request && request.type === "read-episode-title") {
      let title = null;
      try {
        title = readEpisodeTitle(request.site);
      } catch (_e) {
        title = null;
      }
      sendResponse({ title });
      return false;
    }
    if (!request || request.type !== "fill") {
      return false;
    }
    /*
      **受け取ったことだけを先に返し、結果はあとから別の知らせで送る**（0.8.0）。

      貼り込みの途中で確認（window.confirm）を出すと、作者が読んで決めるまで止まる。
      0.7.x まではポップアップがその間ずっと返事を待っていた。いまの待ち手は拡張の裏方
      （service worker）で、何もしないまま30秒ほど経つと Chrome に止められることがある
      ——止められると、貼り込めたかどうかの知らせが作者に届かない。
      だから待たせずに返し、終わったら裏方を起こして結果を渡す。
      workIdChecked は裏方が照合したときの印で、ここでは使わずにそのまま返す
      （結果の前に「取り違えを機械で確かめられません」の但し書きを付けるかを、裏方が決める）。
    */
    sendResponse({ accepted: true });
    setTimeout(() => {
      let result;
      try {
        result = fill(request.envelope, request.pageKind === "edit" ? "edit" : "post");
      } catch (e) {
        // 何が起きても、原稿の側は壊れない（埋める以外のことをしていないため）。
        result = { ok: false, message: `貼り込みの途中で問題が起きました：${e && e.message}` };
      }
      try {
        chrome.runtime.sendMessage(
          { type: "fill-result", result, workIdChecked: request.workIdChecked === true },
          () => void chrome.runtime.lastError
        );
      } catch (_e) {
        // 拡張を入れ直した直後の古いページ。結果の知らせは出ないが、欄は画面で確かめられる
      }
    }, 0);
    return false;
  });
})();
