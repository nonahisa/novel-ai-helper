"use strict";

/**
 * ページ側の読み取り係（content script。設計書6.79.7）。
 *
 * **ここが唯一、管理画面の文字を読む場所**である。貼り込み係（content/fill.js）が
 * 「欄が在るか・空か」しか見ないのに対し、こちらは数を読んで持ち出す——だから、
 * 読んでよいものの線を、このファイルの中で守りきる。
 *
 * 1. **作者がボタンを押したときだけ、1回だけ動く**（6.79.2-4）。下でメッセージの
 *    受け口を登録するだけで、ページを見張らない（MutationObserver も setInterval も無い）。
 * 2. **HTTPを1本も発しない**（6.79.2-1）。次のページへ自動で進まない——月別が欲しければ、
 *    作者が月を切り替えてもう一度押す。
 * 3. **ページのどこにも書かない。** 貼り込み係と違い、読み取りはDOMを1文字も変えない
 *    （表示も出さない。結果はポップアップに出る）。
 * 4. **読むのは「ラベルと数の組」だけ**（6.79.2-3 の例外は 6.79.7 の枠）。
 *    長い文字は表（statsSites.js の MAX_LABEL_TEXT）で落ちる——本文も、
 *    他の方の作品も、ページ全体の文字も読まない。**ツールチップの属性
 *    （`data-ui-tooltip-label`）も同じ枠**で、表に書いた名前の属性から、
 *    表に書いた形に当たる文字だけを読み、同じ長さの上限を掛ける。
 * 5. **ログイン画面では何もしない**（6.79.6-1）。パスワード欄があれば、読む前に降りる。
 * 6. **読めない欄は入れない。** 0で埋めない——母艦の台帳に、読んでいない数字を残さない。
 *
 * 封筒を組み立てるのもこのファイルだけ。作った文字列はポップアップへ返し、
 * 行き先はクリップボードだけである（どこにも保存しない・送らない）。
 *
 * テストから読めるように、判定は readStats(doc, url, now) として外へ出してある
 * （DOMを模した最小の構造で、封筒が組めることを test/readEnvelope.test.js が見る）。
 */
(function (global) {
  /** 封筒の目印と版（母艦の core/readerStatsEnvelope.ts と揃える）。 */
  const MARKER = "novelai-stats";
  const ENVELOPE_VERSION = 1;

  /** 話の見出しから話数を読むときだけ、長めに見る（題は読み捨て、数だけ使う）。 */
  const 見出しの上限 = 200;

  function 部品() {
    return {
      Stats: global.NPHStatsSites,
      Guard: global.NPHGuard,
    };
  }

  /** 見えているか。判定できないときは「見えている」＝安全に倒す（fill.js と同じ）。 */
  function 見えている(el) {
    try {
      return el.getClientRects().length > 0;
    } catch (_e) {
      return true;
    }
  }

  /**
   * ログイン画面かを見るための、入力欄の素性だけを写す。
   * 値（作者が打った文字）は読まない——判定に要らないものは読まない。
   */
  function 入力欄の素性(doc) {
    const 結果 = [];
    for (const el of 要素たち(doc, "input")) {
      結果.push({
        type: el.type,
        autocomplete: (el.getAttribute && el.getAttribute("autocomplete")) || "",
        visible: 見えている(el),
      });
    }
    return 結果;
  }

  /** querySelectorAll を配列で返す（偽のDOMでも同じ形で扱えるように）。 */
  function 要素たち(root, selector) {
    try {
      const 一覧 = root.querySelectorAll(selector);
      return 一覧 ? Array.from(一覧) : [];
    } catch (_e) {
      // セレクタの書き間違いで全体を止めない
      return [];
    }
  }

  /** 候補のセレクタを上から試し、最初に見つかった要素を返す。 */
  function 最初の要素(root, selectors) {
    if (!Array.isArray(selectors)) {
      return null;
    }
    for (const selector of selectors) {
      const 一覧 = 要素たち(root, selector);
      if (一覧.length > 0) {
        return 一覧[0];
      }
    }
    return null;
  }

  /**
   * 要素の文字を、読んでよい長さの範囲で取り出す。長すぎれば null（読まない）。
   * ここが「集めない」の実体である。
   */
  function 短いテキスト(el, 上限) {
    const raw = el && el.textContent;
    if (typeof raw !== "string") {
      return null;
    }
    const text = raw.replace(/\s+/g, " ").trim();
    if (text === "" || text.length > 上限) {
      return null;
    }
    return text;
  }

  /** アクセシビリティの名前（aria-label／title）が、拾い方の名前と合うか。 */
  function 名前が合う(el, names) {
    if (!Array.isArray(names) || names.length === 0 || !el.getAttribute) {
      return false;
    }
    const 名前 = String(el.getAttribute("aria-label") || el.getAttribute("title") || "")
      .replace(/\s+/g, " ")
      .trim();
    if (名前 === "") {
      return false;
    }
    // 「星/レビュー」のように、1つの名前に2つ入っていることがある
    const 部分 = 名前.split(/[/／・]/).map((s) => s.trim());
    return names.some((n) => 名前 === n || 部分.indexOf(n) >= 0);
  }

  /** 1つのテキストへ、拾い方を当てる。当たらなければ undefined。 */
  function 当てる(text, 拾い方, 名前で当たった, Stats) {
    if (拾い方.exclude && 拾い方.exclude.test(text)) {
      return undefined;
    }
    for (const 形 of 拾い方.patterns || []) {
      const m = 形.exec(text);
      if (m) {
        const 値 = Stats.parseExactCount(m[1]);
        if (値 !== undefined) {
          return 値;
        }
      }
    }
    // 名前で当たった要素に数が1つしか無いと分かっているものだけ、最初の数を採る
    if (名前で当たった && 拾い方.soleNumber === true) {
      return Stats.parseExactCount(text);
    }
    return undefined;
  }

  /**
   * ツールチップの属性から数を拾う（**表示文字より先に見る道**）。
   *
   * カクヨムは、数が大きくなると表示を省略形（`1.05M`・`27.5K`）にし、
   * フォロワーに至っては表示にラベルの文字すら無い。正確な数は
   * `data-ui-tooltip-label` にしか無いので、まずそこを見る。
   *
   * **最初に当たった1つだけを採る。** 同じラベルが2度出るページで、
   * あとのほうを採ると、どちらの数字を書いたのかが分からなくなる。
   */
  function ツールチップから拾う(doc, 拾い方, Stats) {
    const 指定 = 拾い方.tooltip;
    if (!指定 || !指定.attr || !指定.pattern) {
      return undefined;
    }
    for (const el of 要素たち(doc, `[${指定.attr}]`)) {
      const raw = el.getAttribute ? el.getAttribute(指定.attr) : null;
      if (typeof raw !== "string") {
        continue;
      }
      const text = raw.replace(/\s+/g, " ").trim();
      // 読んでよい長さの線は、表示文字と同じものを属性にも掛ける
      if (text === "" || text.length > Stats.MAX_LABEL_TEXT) {
        continue;
      }
      const m = 指定.pattern.exec(text);
      if (!m) {
        continue;
      }
      const 値 = Stats.parseExactCount(m[1]);
      if (値 !== undefined) {
        return 値;
      }
    }
    return undefined;
  }

  /**
   * ページから1つの数を拾う。道は3つあり、**上から順に試して、最初に取れたもので決める**。
   *
   *   1. ツールチップの属性（正確な数がここにある。取れたら表示文字で上書きしない）
   *   2. アクセシビリティの名前（画面の見た目が変わっても残りやすい）
   *   3. 表示のテキスト
   *
   * 2・3は残してある——小さい作品では表示文字も正確な数で、ツールチップの
   * 属性名が変わった日には、こちらが逃げ道になる。
   */
  function 拾う(doc, 拾い方, Stats) {
    const ツールチップ = ツールチップから拾う(doc, 拾い方, Stats);
    if (ツールチップ !== undefined) {
      return ツールチップ;
    }
    for (const el of 要素たち(doc, Stats.NAMED_SELECTOR)) {
      if (!名前が合う(el, 拾い方.names)) {
        continue;
      }
      const text = 短いテキスト(el, Stats.MAX_LABEL_TEXT);
      if (text === null) {
        continue;
      }
      const 値 = 当てる(text, 拾い方, true, Stats);
      if (値 !== undefined) {
        return 値;
      }
    }
    for (const el of 要素たち(doc, Stats.TEXT_SELECTOR)) {
      const text = 短いテキスト(el, Stats.MAX_LABEL_TEXT);
      if (text === null) {
        continue;
      }
      const 値 = 当てる(text, 拾い方, false, Stats);
      if (値 !== undefined) {
        return 値;
      }
    }
    return undefined;
  }

  /**
   * 作品管理ページ（/my/works/{作品ID}）を読む。
   *
   * 作品全体の数が1つも読めなければ**何も返さない**——ページの形が変わったときに、
   * 期間の行だけを渡すと、作者には「取り込めた」としか見えない。
   */
  function 作品管理を読む(doc, site, 日時, Stats) {
    const 全体 = {};
    for (const 拾い方 of site.workMetrics) {
      const 値 = 拾う(doc, 拾い方, Stats);
      if (値 !== undefined) {
        全体[拾い方.metric] = 値;
      }
    }
    if (Object.keys(全体).length === 0) {
      return [];
    }
    const entries = [{ scope: "work", metrics: 全体 }];
    for (const 拾い方 of site.periodMetrics) {
      const 値 = 拾う(doc, 拾い方, Stats);
      if (値 === undefined) {
        continue;
      }
      const periodKey = Stats.periodKeyFor(拾い方.period, 日時);
      if (!periodKey) {
        continue;
      }
      entries.push({
        scope: "work",
        period: 拾い方.period,
        periodKey,
        metrics: { [拾い方.metric]: 値 },
      });
    }
    return entries;
  }

  /**
   * アクセス数ページ（/works/{作品ID}/accesses）の、話ごとの表を読む。
   *
   * 話数は**見出しの「第N話」から読む**。読めない行は「その表の何行目か」で代える
   * ——順番も読めなければ、どの話の数字か分からないまま台帳へ入ることになる。
   */
  function 話ごとを読む(doc, site, Stats) {
    const 表の指定 = site.episodeTable;
    if (!表の指定) {
      return [];
    }
    const 表 = 最初の要素(doc, 表の指定.tables);
    // 表そのものが見つからなくても、行のクラスで当たることがある（囲いだけ変わった場合）
    const 起点 = 表 || doc;
    const 行たち = [];
    for (const selector of 表の指定.rows) {
      const 一覧 = 要素たち(起点, selector);
      if (一覧.length > 0) {
        行たち.push(...一覧);
        break;
      }
    }

    const entries = [];
    for (const 行 of 行たち) {
      const metrics = {};
      for (const 列 of 表の指定.columns) {
        const 枡 = 最初の要素(行, 列.selectors);
        if (!枡) {
          continue;
        }
        const 値 = Stats.parseCount(短いテキスト(枡, Stats.MAX_LABEL_TEXT) || "");
        if (値 !== undefined) {
          metrics[列.metric] = 値;
        }
      }
      if (Object.keys(metrics).length === 0) {
        // 見出しの行（「話」「応援」…）はここで落ちる
        continue;
      }
      const 見出し = 最初の要素(行, 表の指定.heading);
      const 読めた話数 = 見出し
        ? Stats.parseEpisodeNumber(短いテキスト(見出し, 見出しの上限) || "")
        : undefined;
      entries.push({
        scope: "episode",
        episode: 読めた話数 === undefined ? entries.length + 1 : 読めた話数,
        metrics,
      });
    }
    return entries;
  }

  /**
   * 「次のページがある」ことを見つける（0.2.2）。
   *
   * カクヨムのアクセス数は**50話ずつのページ送り**で、219話の作品では5ページある。
   * 読めるのは画面に出ている50話ぶんだけなので、これを見つけて作者へ伝えないと、
   * 「50件コピーしました」を見て**全話が入った**と思われる。
   *
   * **見るだけである——押さないし、href も開かないし、次のページを読みにもいかない**
   * （6.79.2-1・2-2）。次のページを開くのは作者の手で、この関数が返すのは真偽だけ。
   * href の値そのものも持ち出さない（当てるのはセレクタの仕事で、JS側は触らない）。
   *
   * セレクタと文言の**両方**に当たったものだけを「次へ」と見なす（表の nextPage を参照）。
   */
  function 次のページがあるか(doc, 表の指定, Stats) {
    const 指定 = 表の指定 && 表の指定.nextPage;
    if (!指定 || !Array.isArray(指定.selectors) || !指定.text) {
      return false;
    }
    for (const selector of 指定.selectors) {
      for (const el of 要素たち(doc, selector)) {
        // 読む文字には、他と同じ長さの上限を掛ける（「集めない」の線は緩めない）
        const text = 短いテキスト(el, Stats.MAX_LABEL_TEXT);
        if (text !== null && 指定.text.test(text)) {
          return true;
        }
      }
    }
    return false;
  }

  /** 封筒を組み立てる（母艦の parseReaderStatsEnvelope が読む形）。 */
  function 封筒(siteId, workId, 日時, entries) {
    const 中身 = Object.assign(
      { [MARKER]: ENVELOPE_VERSION, site: siteId },
      workId ? { workId: String(workId) } : {},
      { readAt: 日時.toISOString(), entries }
    );
    return JSON.stringify(中身);
  }

  /**
   * 読み取りの本体。ポップアップからのメッセージ1回につき1回だけ走る。
   *
   * @param {Document} doc 読むページ（テストでは、これを模した最小の構造）
   * @param {string} url そのページのURL
   * @param {Date} [now] 読み取った日時（テストで固定するため。既定はいま）
   * @returns {{ok:true, json:string, counts:{work:number, episode:number}, hasNextPage:boolean}
   *          |{ok:false, reason:string, siteId?:string}}
   *
   * `hasNextPage` は**封筒に入れない**。母艦の parseReaderStatsEnvelope は
   * 知らない欄を受け付けない形なので、これはポップアップに出す文の材料でしかない。
   */
  function readStats(doc, url, now) {
    const { Stats, Guard } = 部品();
    const 場所 = Stats.matchReadPage(url, Stats.STATS_SITES);
    if (!場所.ok) {
      return 場所;
    }
    // ログイン画面では、欄を探すまでもなく降りる（6.79.6-1）
    if (Guard.isLoginLikePage(入力欄の素性(doc))) {
      return { ok: false, reason: "login" };
    }

    const site = Stats.statsSiteById(場所.siteId);
    const 日時 = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const entries =
      場所.page.kind === "work"
        ? 作品管理を読む(doc, site, 日時, Stats)
        : 話ごとを読む(doc, site, Stats);
    if (entries.length === 0) {
      // 読めた数が1つも無い＝ページの形が変わった。嘘の0を返すより、何も返さない
      return { ok: false, reason: "no-data", siteId: site.id };
    }

    return {
      ok: true,
      json: 封筒(site.id, 場所.workId, 日時, entries),
      counts: {
        work: entries.filter((e) => e.scope === "work").length,
        episode: entries.filter((e) => e.scope === "episode").length,
      },
      // ページ送りがあるのは話ごとの表だけ。作品管理の画面では探しにいかない
      hasNextPage:
        場所.page.kind === "work" ? false : 次のページがあるか(doc, site.episodeTable, Stats),
    };
  }

  // 受け口の登録だけを行う。ここではDOMを読まない（開いただけでは動かない）。
  // テストから require されたときは chrome が無いので、登録そのものを飛ばす。
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (!request || request.type !== "read") {
        return false;
      }
      let result;
      try {
        result = readStats(document, location.href);
      } catch (e) {
        result = { ok: false, reason: "failed", detail: e && e.message };
      }
      sendResponse(result);
      return false;
    });
  }

  const api = { MARKER, ENVELOPE_VERSION, readStats };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHRead = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
