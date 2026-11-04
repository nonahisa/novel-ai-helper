"use strict";

/**
 * 投稿したあとの話の番号を、統合小説執筆環境へ送り返す（0.20.0。作者の裁定 2026-11-03「C-1」）。
 *
 * 作者が投稿／保存を押し、サイトが話の編集画面（なろうは作品・話の管理画面）へ移ったあと、
 * アイコンを押したときに**アドレス欄の URL の数字**を読んで、封筒 `novelai-posted` 版1 にする。
 * カクヨム・アルファポリスでは、話の編集画面の**題の欄の字**も添える（作者の答え 2026-11-05「題も添える」。
 * 読むのは貼り込み係 content/fill.js の readEpisodeTitle。設計書2章の4の引き直し）。なろうは URL の数字だけ。
 *
 * 決めごとの正は母艦の共有メモ「ヘルパー話IDの封筒-2026-11-03.md」（設計書4章へ写す）。
 *
 * このファイルは判定と組み立てだけ（chrome の API に触らない。テストで確かめられるように）。
 */
(function (global) {
  /** 封筒の版。受け手（統合小説執筆環境 0.125.0〜）と揃える */
  const POSTED_VERSION = 1;

  /**
   * **作者の Chrome で確かめたら差し替える所**（2026-11-04 時点の見込み）。
   *
   * - カクヨム：話の編集画面 `/my/works/{作品ID}/episodes/{話ID}`（2026-11-04 母艦が作者の Chrome で確かめた）。
   *   投稿の直後にこの画面へ移るかは、まだ見ていない
   * - アルファポリス：話の編集画面 `/mypage/novel/save_episode/{作品ID}/{話ID}`（2026-11-01 に URL の形だけ分かった）。
   *   保存・公開のあとにこの画面へ移るかは、まだ見ていない
   * - なろう：作品の管理画面 `/usernovelmanage/top/ncode/{小説番号}/` と、話の編集画面
   *   `/usernoveldatamanage/updateinput/ncode/{小説番号}/noveldataid/{部分の番号}/`（共有メモの見込み。未確認）。
   *   ホストは syosetu.com（manifest には足さない。押したときの activeTab で URL を受け取るだけ）
   *
   * どれも**末尾まで固定**する（`/episodes/new` や、作品 ID だけの save_episode に当てないため）。
   */
  const POSTED_PAGES = [
    {
      site: "kakuyomu",
      hosts: ["kakuyomu.jp"],
      pattern: /^\/my\/works\/(\d+)\/episodes\/(\d+)\/?$/,
      fields: ["workId", "episodeId"],
    },
    {
      site: "alphapolis",
      hosts: ["www.alphapolis.co.jp", "alphapolis.co.jp"],
      pattern: /^\/mypage\/novel\/save_episode\/(\d+)\/(\d+)\/?$/,
      fields: ["workId", "episodeId"],
    },
    {
      site: "narou",
      hosts: ["syosetu.com"],
      pattern: /^\/usernoveldatamanage\/updateinput\/ncode\/(\d+)\/noveldataid\/(\d+)\/?$/,
      fields: ["novelNo", "episodeId"],
    },
    {
      site: "narou",
      hosts: ["syosetu.com"],
      pattern: /^\/usernovelmanage\/top\/ncode\/(\d+)\/?$/,
      fields: ["novelNo"],
    },
  ];

  /** 受け手の検査と揃える（共有メモ 2章・5の2） */
  const EPISODE_ID_RE = /^\d{1,30}$/;
  const NOVEL_NO_RE = /^\d{1,20}$/;
  /** 貼り込みの札（受け手が作る。中身はヘルパーには意味が無い） */
  const POST_REF_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function hostMatches(host, allowed) {
    const lower = String(host).toLowerCase();
    return allowed.some((h) => lower === h || lower.endsWith("." + h));
  }

  /**
   * 押したタブの URL が、話の番号を送り返せる画面か。
   *
   * @param {string} url
   * @returns {{ok:true, site:string, workId?:string, novelNo?:string, episodeId?:string}|{ok:false}}
   */
  function matchPostedPage(url) {
    let u;
    try {
      u = new URL(String(url));
    } catch (_e) {
      return { ok: false };
    }
    if (u.protocol !== "https:") {
      return { ok: false };
    }
    for (const page of POSTED_PAGES) {
      if (!hostMatches(u.hostname, page.hosts)) {
        continue;
      }
      const m = page.pattern.exec(u.pathname);
      if (!m) {
        continue;
      }
      const 結果 = { ok: true, site: page.site };
      page.fields.forEach((name, i) => {
        結果[name] = m[i + 1];
      });
      if (結果.episodeId !== undefined && !EPISODE_ID_RE.test(結果.episodeId)) {
        return { ok: false };
      }
      if (結果.novelNo !== undefined && !NOVEL_NO_RE.test(結果.novelNo)) {
        return { ok: false };
      }
      return 結果;
    }
    return { ok: false };
  }

  /** 札の形が正しいか（英数字と - _ で1〜64字） */
  function isValidPostRef(value) {
    return typeof value === "string" && POST_REF_RE.test(value);
  }

  /** 日本時間の ISO 8601（`+09:00`）。機械の時刻の地域に頼らない */
  function jstIso(now) {
    const d = now instanceof Date ? now : new Date();
    const 日本 = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return 日本.toISOString().replace("Z", "+09:00");
  }

  /**
   * 封筒を組み立てる。
   *
   * - なろうは workId・title・postRef を付けない（台帳の workId は Nコードで、URL から知る道が無い。札も題も無い）
   * - カクヨム・アルファポリスは、同じ作品へ最後に貼り込んだときの札があれば postRef に付ける
   *
   * @param {{ok:true, site:string, workId?:string, novelNo?:string, episodeId?:string}} page matchPostedPage の結果
   * @param {{postRef?:string}|null} lastPaste その作品へ最後に貼り込んだ控え（rememberPaste の1件）
   * @param {Date} [now]
   * @param {string|null} [title] 話の編集画面の題の欄の字（0.20.0。作者の答え 2026-11-05「題も添える」。貼り込み係が読む）
   * @returns {object|null} 送れないとき（カクヨム・アルファポリスで話の番号が無い）は null
   */
  function makePostedEnvelope(page, lastPaste, now, title) {
    if (!page || page.ok !== true) {
      return null;
    }
    const 封筒 = { "novelai-posted": POSTED_VERSION, site: page.site };
    if (page.site === "narou") {
      封筒.novelNo = page.novelNo;
      if (page.episodeId !== undefined) {
        封筒.episodeId = page.episodeId;
      }
    } else {
      if (!page.workId || !page.episodeId) {
        return null;
      }
      封筒.workId = page.workId;
      封筒.episodeId = page.episodeId;
      if (typeof title === "string" && title.trim() !== "") {
        封筒.title = title.trim().slice(0, 200);
      }
      if (lastPaste && isValidPostRef(lastPaste.postRef)) {
        封筒.postRef = lastPaste.postRef;
      }
    }
    封筒.readAt = jstIso(now);
    return 封筒;
  }

  /** 控えの鍵（作品ごとに最後の1件） */
  function pasteKey(site, workId) {
    return `${site}|${workId}`;
  }

  /**
   * 貼り込みが済んだ控えを、作品ごとに最後の1件だけ持つ（chrome.storage.local に置き、7日で捨てる）。
   * **本文は持たない。** 同じ原稿をもう一度押したかを見分けるために、本文の字数だけ持つ。
   *
   * @param {object|null} 前 いまの控え（{ [鍵]: 控え }）
   * @param {{site:string, workId?:string, postRef?:string, title?:string, body?:string}} envelope 貼り込んだ封筒
   * @param {Date} [now]
   * @returns {object} 新しい控え（作品 ID の無い封筒は控えない＝前のまま）
   */
  function rememberPaste(前, envelope, now) {
    const 控え = Object.assign({}, 前 || {});
    if (!envelope || typeof envelope.workId !== "string" || envelope.workId === "") {
      return 控え;
    }
    const 一件 = {
      site: envelope.site,
      workId: envelope.workId,
      title: typeof envelope.title === "string" ? envelope.title.slice(0, 200) : "",
      bodyLength: typeof envelope.body === "string" ? envelope.body.length : 0,
      pastedAt: jstIso(now),
    };
    if (isValidPostRef(envelope.postRef)) {
      一件.postRef = envelope.postRef;
    }
    控え[pasteKey(envelope.site, envelope.workId)] = 一件;
    return 控え;
  }

  /** 控えを使う期間（Chrome を閉じても残る保存に置くので、古いものは捨てる） */
  const PASTE_KEEP_DAYS = 7;

  /** 7日より古い控え・形の崩れた控えを落とす */
  function freshPastes(控え, now) {
    const 今 = (now instanceof Date ? now : new Date()).getTime();
    const 残す = {};
    for (const [鍵, 一件] of Object.entries(控え || {})) {
      const 時 = 一件 && typeof 一件.pastedAt === "string" ? Date.parse(一件.pastedAt) : NaN;
      if (Number.isFinite(時) && 今 - 時 <= PASTE_KEEP_DAYS * 24 * 60 * 60 * 1000 && 今 - 時 >= -60 * 1000) {
        残す[鍵] = 一件;
      }
    }
    return 残す;
  }

  /** その作品の控え（無ければ null） */
  function lastPasteFor(控え, site, workId) {
    if (!控え || !workId) {
      return null;
    }
    return 控え[pasteKey(site, workId)] || null;
  }

  /**
   * クリップボードの原稿が、その作品へ**最後に貼り込んだものと同じか**。
   *
   * 話の編集画面では、アイコンを押すと「貼り込む」と「話の番号を渡す」の2つがあり得る（0.20.0）。
   * **まだ貼っていない原稿がクリップボードにあれば貼り込み、すでに貼った原稿なら番号を渡す**
   * （投稿したあと、クリップボードには貼った原稿が残ったままのため）。札があれば札で、無ければ題と字数で比べる。
   * **この決め方は仮**（作者の確認待ち。引継ぎ書1章8番）
   */
  function isSameAsLastPaste(envelope, last) {
    if (!envelope || !last) {
      return false;
    }
    if (isValidPostRef(envelope.postRef) || isValidPostRef(last.postRef)) {
      return envelope.postRef === last.postRef;
    }
    return (
      String(envelope.title || "").slice(0, 200) === last.title &&
      (typeof envelope.body === "string" ? envelope.body.length : -1) === last.bodyLength
    );
  }

  const api = {
    POSTED_VERSION,
    POSTED_PAGES,
    matchPostedPage,
    isValidPostRef,
    makePostedEnvelope,
    rememberPaste,
    freshPastes,
    PASTE_KEEP_DAYS,
    lastPasteFor,
    isSameAsLastPaste,
    jstIso,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHPosted = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
