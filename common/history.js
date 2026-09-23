"use strict";

/**
 * 読者の反応の**記録（履歴）と簡易集計**の素の判定（0.10.0）。
 *
 * 作者の方針（2026-09-23）「chromeの拡張はそれ単体でも使えたほうが広報的に有利でしょう。
 * マーケットからダウンロードした場合は、自作IDを登録したら簡易集計できるようにし、
 * 詳しい分析は統合執筆開発環境に誘導しましょう」への答え。
 *
 * 0.9.0 の「溜まり」（common/stash.js）は**統合小説執筆環境へ渡すための一時置き場**で、渡したら空になる。
 * ここで扱う「記録」はそれとは別で、**渡しても消さない**。ご自分の作品として覚えた作品の数を、
 * 読んだ日ごとに畳んで残し、説明のページで「いまの数・日ごとの推移・3つの率」を見せる。
 * 統合小説執筆環境を持っていない方（Chrome ウェブストアから入れた方）でも、これだけで使える。
 *
 * ## このファイルは Chrome に触れない
 *
 * 保存（chrome.storage.local）の読み書きは裏方（background.js）だけがする。ここは
 * 「どう畳むか」「上限でどれを落とすか」「率をどう出すか」「どう見せるか」を決める関数だけで、
 * テストから直接呼べる。
 *
 * ## 記録の形（保存の鍵 readerHistory）
 *
 *   { version: 1, works: [ 作品ごとの記録, … ] }
 *
 *   作品ごとの記録 = {
 *     siteId,      表の id（"kakuyomu"｜"narouFun"）。覚えた作品（ownWorks）と同じ呼び方
 *     site,        読み取り係のデータの site（"kakuyomu"｜"narou"）。評価率の分子を決めるのに使う
 *     workId,      作品ID（Nコードは小文字）
 *     lastReadAt,  最後に記録した、読んだ日時
 *     latest,      欄ごとの、いちばん新しい作品全体の数 { pv: { value, readAt }, … }（率といまの数に使う）
 *     snapshots,   読んだ日ごとの作品全体の数 [{ date: "2026-09-23", readAt, metrics }]（推移に使う）
 *     daily,       サイトが出している日ごとの数 { "2026-09-23": { at, metrics } }（カクヨムの日ごとのPV、
 *                  Narou.fun の日ごとのブクマと評価の増減）
 *     monthly,     サイトが出している月ごとの数 { "2026-09": { at, metrics } }（カクヨムの今月のPV）
 *     episodes,    話ごとの、いちばん新しい数 { "1": { at, pv, pvAt, updatedAt, updatedReadAt } }（率に使う）
 *   }
 *
 * **話ごとの数は、日ごとには残さない。** 219話の作品で1日2万字ほどになり、半年で作品1つが
 * 保存の持ち分を食い尽くす。率に要るのは「話ごとのいちばん新しい数」だけなので、それだけを持つ。
 *
 * ## 率の式は統合小説執筆環境と同じ（src/core/readerRates.ts）
 *
 * - 離脱率 = 1 − 基準の話のPV ÷ 第1話のPV（基準の話＝更新から、読んだ時点までに72時間以上たっていた話のうち、話数がいちばん大きい話）
 * - ブックマーク率 = 作品全体のブックマーク ÷ 第1話のPV
 * - 評価率 = 評価した人数 ÷ 第1話のPV（カクヨムはレビュー、なろうは評価者数）
 *
 * 材料が欠けたら 0% にせず、理由を返す（読めなかったのか本当に0なのか、見分けが付かなくなるため）。
 * 同じ入力で統合小説執筆環境と同じ値になることは test/history.test.js が相手に直接計算させて確かめる。
 */
(function (global) {
  const HISTORY_VERSION = 1;

  /**
   * 記録の上限。**作品数・日数・大きさ**の3つで見る。
   *
   * - 作品数 20：作者1人が並行して連載する作品の数としては十分。越えたら、いちばん長く開いていない作品から落とす
   * - 日数 180：半年。日ごとの推移を見るには足り、統合小説執筆環境の記録（こちらは消えない）と役割を分ける
   * - 月数 24：月ごとのPVは小さいので長めに残す
   * - 大きさ 150万字：記録全体の文字数。溜まり（200万字）と渡した分の控えと合わせても、
   *   chrome.storage.local の持ち分（10MB）に収まる。越えたら、いちばん古い日の分から落とす
   */
  const HISTORY_LIMITS = { maxWorks: 20, maxDays: 180, maxMonths: 24, maxChars: 1500000 };

  /** 基準の話に要る「更新からの経過」（統合小説執筆環境の READER_RATE_SETTLE_HOURS と同じ）。72時間ちょうどは含む */
  const SETTLE_HOURS = 72;

  /** 推移の表に出す日数。長く出すと、1つの作品が画面を埋めてしまう */
  const TREND_DAYS = 14;

  /** 何も記録していない状態。 */
  function emptyHistory() {
    return { version: HISTORY_VERSION, works: [] };
  }

  function 数か(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function 日時か(v) {
    return typeof v === "string" && !Number.isNaN(Date.parse(v));
  }

  function 素の入れ物か(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  /** 数だけを残す（形の崩れた欄は捨てる）。 */
  function 数の組(raw) {
    const out = {};
    if (!素の入れ物か(raw)) {
      return out;
    }
    for (const [k, v] of Object.entries(raw)) {
      if (数か(v)) {
        out[k] = v;
      }
    }
    return out;
  }

  /** Nコードは大文字でも小文字でも同じ作品（common/stash.js の normalizeWorkId と同じ決まり）。 */
  function 作品IDを揃える(siteId, workId) {
    const id = String(workId || "").trim();
    return siteId === "narouFun" ? id.toLowerCase() : id;
  }

  /**
   * 保存から読んだものを、形を確かめながら記録にする。**壊れた作品・欄は捨てる**
   * （欄ごとに捨てる。保存の形を変えた日に、古い形のせいで集計の画面が出ない、を避ける）。
   */
  function normalizeHistory(raw) {
    const h = emptyHistory();
    if (!素の入れ物か(raw) || !Array.isArray(raw.works)) {
      return h;
    }
    for (const w of raw.works) {
      if (!素の入れ物か(w) || typeof w.siteId !== "string" || typeof w.workId !== "string" || w.workId === "") {
        continue;
      }
      const work = 空の作品(w.siteId, typeof w.site === "string" ? w.site : "", w.workId);
      work.lastReadAt = 日時か(w.lastReadAt) ? w.lastReadAt : "";
      if (素の入れ物か(w.latest)) {
        for (const [k, v] of Object.entries(w.latest)) {
          if (素の入れ物か(v) && 数か(v.value) && 日時か(v.readAt)) {
            work.latest[k] = { value: v.value, readAt: v.readAt };
          }
        }
      }
      if (Array.isArray(w.snapshots)) {
        work.snapshots = w.snapshots
          .filter((s) => 素の入れ物か(s) && typeof s.date === "string" && 日時か(s.readAt))
          .map((s) => ({ date: s.date, readAt: s.readAt, metrics: 数の組(s.metrics) }));
      }
      for (const 欄 of ["daily", "monthly"]) {
        if (素の入れ物か(w[欄])) {
          for (const [key, v] of Object.entries(w[欄])) {
            if (素の入れ物か(v) && 日時か(v.at)) {
              work[欄][key] = { at: v.at, metrics: 数の組(v.metrics) };
            }
          }
        }
      }
      if (素の入れ物か(w.episodes)) {
        for (const [n, e] of Object.entries(w.episodes)) {
          if (!/^[1-9][0-9]*$/.test(n) || !素の入れ物か(e) || !日時か(e.at)) {
            continue;
          }
          const ep = { at: e.at };
          if (数か(e.pv) && 日時か(e.pvAt)) {
            ep.pv = e.pv;
            ep.pvAt = e.pvAt;
          }
          if (日時か(e.updatedAt) && 日時か(e.updatedReadAt)) {
            ep.updatedAt = e.updatedAt;
            ep.updatedReadAt = e.updatedReadAt;
          }
          work.episodes[n] = ep;
        }
      }
      h.works.push(work);
    }
    return h;
  }

  function 空の作品(siteId, site, workId) {
    return {
      siteId,
      site,
      workId: 作品IDを揃える(siteId, workId),
      lastReadAt: "",
      latest: {},
      snapshots: [],
      daily: {},
      monthly: {},
      episodes: {},
    };
  }

  /**
   * 日時を、作者の時計の日付（`2026-09-23`）にする。
   * 読み取り係が「今日のPV」の日付を作者の時計で決めている（statsSites.js の periodKeyFor）ので、揃える。
   */
  function dayKeyOf(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** あとの日時か（同じ日時は「あと」扱い——あとから足したほうを採る。統合小説執筆環境の率と同じ決まり）。 */
  function 以後か(a, b) {
    return b === undefined || b === "" || Date.parse(a) >= Date.parse(b);
  }

  /**
   * 読み取り係のデータ（1件）を、その作品の記録へ畳み込む。
   *
   * **同じ作品・同じ日の作品全体の数は1件に畳み、欄ごとに新しいほうで置き換える**（同じ画面を
   * 開き直すたびに増えないように）。作品管理とアクセス数のように読める欄が違う画面は、
   * 欄ごとに合わさる。**古い読み取りをあとから入れても、新しい数を上書きしない。**
   *
   * 覚えた作品かどうかは、ここでは決めない——呼ぶ側（裏方）が、溜めてよいと決めた作品だけを渡す。
   *
   * @param {object} history normalizeHistory を通した記録
   * @param {object} envelope 読み取り係のデータ（{ site, workId, readAt, entries }）
   * @param {string} siteId 表の id（"kakuyomu"｜"narouFun"）
   * @param {string} workId 作品ID
   * @param {Date} now 読んだ日時が読めないときに使う
   * @param {object} [limits] 上限（テストで小さくする）
   * @returns {object} 新しい記録（渡したものは変えない）
   */
  function recordEnvelope(history, envelope, siteId, workId, now, limits) {
    if (!素の入れ物か(envelope) || !Array.isArray(envelope.entries)) {
      return history;
    }
    const id = 作品IDを揃える(siteId, workId);
    if (id === "") {
      return history;
    }
    const h = normalizeHistory(JSON.parse(JSON.stringify(history)));
    const readAt = 日時か(envelope.readAt)
      ? new Date(Date.parse(envelope.readAt)).toISOString()
      : (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).toISOString();
    let work = h.works.find((w) => w.siteId === siteId && w.workId === id);
    if (!work) {
      work = 空の作品(siteId, typeof envelope.site === "string" ? envelope.site : "", id);
      h.works.push(work);
    }
    if (typeof envelope.site === "string" && envelope.site !== "") {
      work.site = envelope.site;
    }
    const 新しいか = 以後か(readAt, work.lastReadAt);
    if (新しいか) {
      work.lastReadAt = readAt;
    }

    for (const entry of envelope.entries) {
      if (!素の入れ物か(entry)) {
        continue;
      }
      const metrics = 数の組(entry.metrics);
      if (entry.scope === "work" && entry.period === undefined) {
        作品全体を畳む(work, metrics, readAt);
      } else if (entry.scope === "work" && (entry.period === "day" || entry.period === "month")) {
        const 欄 = entry.period === "day" ? "daily" : "monthly";
        if (typeof entry.periodKey === "string" && entry.periodKey !== "" && Object.keys(metrics).length > 0) {
          期間を畳む(work[欄], entry.periodKey, metrics, readAt);
        }
      } else if (entry.scope === "episode" && entry.period === undefined) {
        話を畳む(work, entry, metrics, readAt);
      }
      // 年・その他の期間は読み取り係が作らない。来ても見せる場所が無いので残さない
    }
    return trimHistory(h, limits);
  }

  function 作品全体を畳む(work, metrics, readAt) {
    const 欄たち = Object.keys(metrics);
    if (欄たち.length === 0) {
      return;
    }
    for (const k of 欄たち) {
      const 前 = work.latest[k];
      if (!前 || 以後か(readAt, 前.readAt)) {
        work.latest[k] = { value: metrics[k], readAt };
      }
    }
    const date = dayKeyOf(Date.parse(readAt));
    let snap = work.snapshots.find((s) => s.date === date);
    if (!snap) {
      snap = { date, readAt, metrics: {} };
      work.snapshots.push(snap);
      work.snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
    const 新しいか = 以後か(readAt, snap.readAt);
    for (const k of 欄たち) {
      // 同じ日の古い読み取りは、まだ無い欄だけを埋める（新しい数を古い数で上書きしない）
      if (新しいか || !(k in snap.metrics)) {
        snap.metrics[k] = metrics[k];
      }
    }
    if (新しいか) {
      snap.readAt = readAt;
    }
  }

  function 期間を畳む(入れ物, key, metrics, readAt) {
    const 前 = 入れ物[key];
    if (!前) {
      入れ物[key] = { at: readAt, metrics: Object.assign({}, metrics) };
      return;
    }
    const 新しいか = 以後か(readAt, 前.at);
    for (const [k, v] of Object.entries(metrics)) {
      if (新しいか || !(k in 前.metrics)) {
        前.metrics[k] = v;
      }
    }
    if (新しいか) {
      前.at = readAt;
    }
  }

  /**
   * 話ごとに、その話のいちばん新しい数を持つ（統合小説執筆環境の latestEpisodeValues と同じ拾い方）。
   * PV と最終更新は**別々に**新しいものを採る——アクセス数の画面（更新日なし）をあとから読んでも、
   * 作品管理で読んだ更新日が消えないように。
   */
  function 話を畳む(work, entry, metrics, readAt) {
    const n = entry.episode;
    if (!Number.isSafeInteger(n) || n < 1) {
      return;
    }
    const key = String(n);
    const ep = work.episodes[key] || { at: readAt };
    if (以後か(readAt, ep.at)) {
      ep.at = readAt;
    }
    if (数か(metrics.pv) && 以後か(readAt, ep.pvAt)) {
      ep.pv = metrics.pv;
      ep.pvAt = readAt;
    }
    if (日時か(entry.updatedAt) && 以後か(readAt, ep.updatedReadAt)) {
      ep.updatedAt = entry.updatedAt;
      ep.updatedReadAt = readAt;
    }
    work.episodes[key] = ep;
  }

  /**
   * 上限を越えた分を落とす。
   *
   * 1. 作品ごとに、日ごとの数は新しい方から maxDays 日、月ごとは maxMonths か月だけ残す
   * 2. 作品が maxWorks を越えたら、**いちばん長く記録していない作品**から落とす
   * 3. 全体の大きさが maxChars を越えたら、**全作品を通していちばん古い日の分**から落とす
   *    （どの作品も最後の1日は残す。それでも越えるときは、いちばん長く記録していない作品を落とす）
   */
  function trimHistory(history, limits) {
    const 上限 = Object.assign({}, HISTORY_LIMITS, limits || {});
    const h = history;
    for (const w of h.works) {
      w.snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      if (w.snapshots.length > 上限.maxDays) {
        w.snapshots = w.snapshots.slice(w.snapshots.length - 上限.maxDays);
      }
      w.daily = 新しい鍵だけ(w.daily, 上限.maxDays);
      w.monthly = 新しい鍵だけ(w.monthly, 上限.maxMonths);
    }
    h.works.sort((a, b) => (a.lastReadAt < b.lastReadAt ? 1 : a.lastReadAt > b.lastReadAt ? -1 : 0));
    if (h.works.length > 上限.maxWorks) {
      h.works = h.works.slice(0, 上限.maxWorks);
    }
    while (JSON.stringify(h).length > 上限.maxChars) {
      const 古い日 = いちばん古い日(h);
      if (古い日 !== null) {
        for (const w of h.works) {
          if (w.snapshots.length > 1) {
            w.snapshots = w.snapshots.filter((s) => s.date !== 古い日);
          }
          if (Object.keys(w.daily).length > 1) {
            delete w.daily[古い日];
          }
        }
        continue;
      }
      if (h.works.length > 1) {
        h.works.pop();
        continue;
      }
      // 作品1つ・1日だけで越える（話の数がとても多い）。それ以上は削れないので、そのまま置く
      break;
    }
    return h;
  }

  function 新しい鍵だけ(入れ物, 残す数) {
    const 鍵 = Object.keys(入れ物).sort();
    if (鍵.length <= 残す数) {
      return 入れ物;
    }
    const out = {};
    for (const k of 鍵.slice(鍵.length - 残す数)) {
      out[k] = 入れ物[k];
    }
    return out;
  }

  /** 削れる（その作品の最後の1日ではない）日のうち、いちばん古い日。無ければ null。 */
  function いちばん古い日(h) {
    let 古い = null;
    for (const w of h.works) {
      const 候補 = [];
      if (w.snapshots.length > 1) 候補.push(w.snapshots[0].date);
      const 日 = Object.keys(w.daily).sort();
      if (日.length > 1) 候補.push(日[0]);
      for (const d of 候補) {
        if (古い === null || d < 古い) 古い = d;
      }
    }
    return 古い;
  }

  /**
   * 覚えた作品だけを残す（他人の作品の数は残さない）。
   * 説明のページで覚えた作品から外したら、その作品の記録も消す——外したのは「自分の作品ではなかった」
   * からかもしれないため。
   */
  function keepOnlyOwn(history, ownWorks) {
    const 自分の = new Set(
      (ownWorks || []).map((w) => `${w.siteId}|${作品IDを揃える(w.siteId, w.workId)}`)
    );
    return Object.assign({}, history, {
      works: history.works.filter((w) => 自分の.has(`${w.siteId}|${w.workId}`)),
    });
  }

  // ---------------------------------------------------------------------------
  // 率（統合小説執筆環境の src/core/readerRates.ts と同じ式・同じ言い方）
  // ---------------------------------------------------------------------------

  const RATE_LABELS = { dropout: "離脱率", bookmark: "ブックマーク率", rating: "評価率" };
  const WORK_LABELS = {
    bookmark: "作品全体のブックマーク",
    rating: "作品全体のレビュー（評価した人数）",
  };
  const NAROU_WORK_LABELS = {
    bookmark: "作品全体のブックマーク",
    rating: "作品全体の評価者数（評価した人数）",
  };

  function 件数(value) {
    return value.toLocaleString("ja-JP");
  }

  /** 百分率を小数1桁で。丸めは表示だけ。 */
  function formatPercent(ratio) {
    return `${(ratio * 100).toFixed(1)}%`;
  }

  /**
   * 1つの作品の記録から3つの率を出す。
   *
   * 形は統合小説執筆環境の computeReaderRates と同じ（label・formula・value・percent・expression・
   * operands・missing）。**材料からの割り算だけ**をし、欠けたら理由（missing）を返す。
   */
  function computeRates(work) {
    const episodes = Object.entries(work.episodes || {}).map(([n, e]) => Object.assign({ n: Number(n) }, e));
    let newest;
    for (const e of episodes) {
      const t = Date.parse(e.at);
      if (!Number.isNaN(t) && (newest === undefined || t > newest.time)) {
        newest = { readAt: e.at, time: t };
      }
    }
    // 話ごとのいちばん新しい読み取りと違う回の数にだけ、日時を添える
    const stamp = (readAt) => (newest && Date.parse(readAt) !== newest.time ? { readAt } : {});

    const first = episodes.find((e) => e.n === 1 && 数か(e.pv));
    const firstPv = first ? Object.assign({ label: "第1話のPV", value: first.pv }, stamp(first.pvAt)) : undefined;
    const firstProblem = !newest
      ? "話ごとの記録がありません"
      : firstPv === undefined
        ? "第1話のPVがありません"
        : firstPv.value === 0
          ? "第1話のPVが0です（0では割れません）"
          : undefined;

    const baseResult = newest ? 基準の話を選ぶ(episodes) : { base: null, missing: "話ごとの記録がありません" };
    const base = baseResult.base;
    const baseEp = base ? episodes.find((e) => e.n === base.episode && 数か(e.pv)) : undefined;
    const basePv = base && baseEp
      ? Object.assign({ label: `第${base.episode}話のPV`, value: baseEp.pv }, stamp(baseEp.pvAt))
      : undefined;
    const baseProblem = !base
      ? baseResult.missing
      : basePv === undefined
        ? `第${base.episode}話のPVがありません`
        : undefined;

    const dropoutOperands = [basePv, firstPv].filter((x) => x !== undefined);
    const dropoutProblem = baseProblem !== undefined ? baseProblem : firstProblem;
    const baseEpisode = base ? base.episode : undefined;
    const dropout =
      dropoutProblem !== undefined || !basePv || !firstPv
        ? 出せない率("dropout", baseEpisode, dropoutOperands, dropoutProblem || "材料が足りません", WORK_LABELS)
        : 出せた率(
            "dropout",
            baseEpisode,
            dropoutOperands,
            1 - basePv.value / firstPv.value,
            `1 − ${件数(basePv.value)} ÷ ${件数(firstPv.value)}`,
            WORK_LABELS
          );

    const なろうか = work.site === "narou";
    const labels = なろうか ? NAROU_WORK_LABELS : WORK_LABELS;
    const 作品の数 = (kind) => {
      const key = kind === "bookmark" ? "bookmarks" : なろうか ? "narou_raters" : "reviews";
      const v = work.latest && work.latest[key];
      return v ? Object.assign({ label: labels[kind], value: v.value }, stamp(v.readAt)) : undefined;
    };

    const 結果 = {
      episodeReadAt: newest ? newest.readAt : null,
      base,
      dropout,
      bookmark: 割合の率("bookmark", labels, 作品の数("bookmark"), firstPv, firstProblem),
      rating: 割合の率("rating", labels, 作品の数("rating"), firstPv, firstProblem),
    };
    if (baseResult.missing) {
      結果.baseMissing = baseResult.missing;
    }
    return 結果;
  }

  function 基準の話を選ぶ(episodes) {
    const settleMs = SETTLE_HOURS * 60 * 60 * 1000;
    const 更新の分かる話 = episodes.filter((e) => 日時か(e.updatedAt) && 日時か(e.updatedReadAt));
    let best;
    for (const e of 更新の分かる話) {
      if (Date.parse(e.updatedReadAt) - Date.parse(e.updatedAt) < settleMs) continue;
      if (best === undefined || e.n > best.n) best = e;
    }
    if (best === undefined) {
      return {
        base: null,
        missing:
          更新の分かる話.length > 0 ? `更新から${SETTLE_HOURS / 24}日以上たった話がありません` : "更新日の分かる話がありません",
      };
    }
    const base = { episode: best.n, updatedAt: best.updatedAt, updatedReadAt: best.updatedReadAt };
    if (数か(best.pv)) {
      base.pv = best.pv;
    }
    return { base };
  }

  function 式の言葉(kind, baseEpisode, labels) {
    if (kind === "dropout") {
      const base = baseEpisode === undefined ? "基準の話のPV" : `第${baseEpisode}話のPV`;
      return `1 − ${base} ÷ 第1話のPV`;
    }
    return `${labels[kind]} ÷ 第1話のPV`;
  }

  function 出せない率(kind, baseEpisode, operands, missing, labels) {
    return { label: RATE_LABELS[kind], formula: 式の言葉(kind, baseEpisode, labels), operands, missing };
  }

  function 出せた率(kind, baseEpisode, operands, value, left, labels) {
    const percent = formatPercent(value);
    return {
      label: RATE_LABELS[kind],
      formula: 式の言葉(kind, baseEpisode, labels),
      value,
      percent,
      expression: `${left} = ${percent}`,
      operands,
    };
  }

  function 割合の率(kind, labels, workOperand, firstPv, firstProblem) {
    const operands = [workOperand, firstPv].filter((x) => x !== undefined);
    const problem = workOperand === undefined ? `${labels[kind]}がありません` : firstProblem;
    if (problem !== undefined || !workOperand || !firstPv) {
      return 出せない率(kind, undefined, operands, problem || "材料が足りません", labels);
    }
    return 出せた率(
      kind,
      undefined,
      operands,
      workOperand.value / firstPv.value,
      `${件数(workOperand.value)} ÷ ${件数(firstPv.value)}`,
      labels
    );
  }

  // ---------------------------------------------------------------------------
  // 見せ方（説明のページの「読者の反応の集計」）
  // ---------------------------------------------------------------------------

  /** 欄の呼び名。サイトの画面と同じ呼び方にする（作者が画面と見比べられるように）。 */
  const METRIC_LABELS = {
    kakuyomu: {
      pv: "PV",
      bookmarks: "フォロワー",
      points: "★",
      reviews: "レビュー",
      likes: "応援",
      comments: "応援コメント",
    },
    narou: {
      points: "総合P",
      bookmarks: "ブクマ",
      narou_ratingPoints: "評価P",
      narou_raters: "評価者数",
      reviews: "レビュー",
      comments: "感想数",
      narou_weeklyReaders: "週間読者",
    },
  };

  /** 記録した日ごとの表に出す欄（サイトごとに、いちばん見たい3つ） */
  const TREND_METRICS = {
    kakuyomu: ["pv", "bookmarks", "points"],
    narou: ["points", "bookmarks", "narou_raters"],
  };

  function 欄の呼び名(site, key) {
    const 表 = METRIC_LABELS[site] || METRIC_LABELS.kakuyomu;
    return 表[key] || key;
  }

  function 欄の並び(site) {
    return Object.keys(METRIC_LABELS[site] || METRIC_LABELS.kakuyomu);
  }

  function サイトの名(siteId) {
    return siteId === "narouFun" ? "Narou.fun（なろうの作品）" : "カクヨム";
  }

  function 日時の字(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function 月日(dateKey) {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(dateKey);
    return m ? `${Number(m[1])}/${Number(m[2])}` : dateKey;
  }

  /**
   * 日本語の字体で全角の幅に描かれる、0xff 以下の字（JIS X 0208 にある記号。§ ¨ ° ± ´ ¶ × ÷）。
   * 集計の表の字体（options.css の .report。BIZ UDゴシック・MS ゴシックなど）はこれらを全角で描く。
   * 半角と数えると、「±0」の入った行だけ後ろの列が半角1字ぶん右へずれる（0.11.2 で撮った画像で見つけた）
   */
  const 全角に描かれる記号 = new Set(["§", "¨", "°", "±", "´", "¶", "×", "÷"]);

  /** 見た目の幅（全角は2、半角は1）。等幅の字で表を揃えるため。 */
  function 幅(s) {
    let n = 0;
    for (const ch of String(s)) {
      n += ch.codePointAt(0) > 0xff || 全角に描かれる記号.has(ch) ? 2 : 1;
    }
    return n;
  }

  /**
   * 表の枡に数が無いときの印。半角の「-」にする——「–」（U+2013）は全角と数えるのに、
   * 表の字体では半角に描かれ、その行だけ列がずれた（0.11.2）
   */
  const 無い印 = "-";

  function 右寄せ(s, w) {
    const t = String(s);
    return " ".repeat(Math.max(0, w - 幅(t))) + t;
  }

  function 左寄せ(s, w) {
    const t = String(s);
    return t + " ".repeat(Math.max(0, w - 幅(t)));
  }

  function 増減(n) {
    return n > 0 ? `+${件数(n)}` : n < 0 ? `-${件数(-n)}` : "±0";
  }

  /** 棒（外のライブラリを使わず、字で描く）。最大の数を20字にする。 */
  const 棒の最大 = 20;
  function 棒(value, 最大) {
    if (!(value > 0) || !(最大 > 0)) {
      return "";
    }
    return "▇".repeat(Math.max(1, Math.round((value / 最大) * 棒の最大)));
  }

  /**
   * 1つの作品の集計を組む（文字にする前の形。テストで中身を確かめる）。
   *
   * @param {object|undefined} work その作品の記録（まだ無ければ undefined）
   * @param {{siteId:string, workId:string}} own 覚えた作品
   * @param {Date} now 「今日」「今月」を決める
   */
  function buildWorkReport(work, own, now) {
    const siteId = own.siteId;
    const workId = 作品IDを揃える(siteId, own.workId);
    const 報告 = { siteId, workId, siteName: サイトの名(siteId), recorded: !!work && work.lastReadAt !== "" };
    if (!報告.recorded) {
      return 報告;
    }
    const site = work.site || (siteId === "narouFun" ? "narou" : "kakuyomu");
    報告.site = site;
    報告.lastReadAt = work.lastReadAt;
    報告.days = work.snapshots.length;

    // いまの数（欄ごとのいちばん新しい数）
    報告.current = 欄の並び(site)
      .filter((k) => work.latest[k])
      .map((k) => ({ key: k, label: 欄の呼び名(site, k), value: work.latest[k].value, readAt: work.latest[k].readAt }));
    const 今日 = dayKeyOf(now instanceof Date ? now.getTime() : Date.now());
    const 今月 = 今日.slice(0, 7);
    報告.today = work.daily[今日] ? work.daily[今日].metrics : null;
    報告.thisMonth = work.monthly[今月] ? work.monthly[今月].metrics : null;

    // サイトが出している日ごとの数（直近）
    const 日の鍵 = Object.keys(work.daily).sort().slice(-TREND_DAYS);
    const 日の欄 = 欄の並び(site).filter((k) => 日の鍵.some((d) => k in work.daily[d].metrics));
    報告.daily = { metrics: 日の欄.map((k) => ({ key: k, label: 欄の呼び名(site, k) })), rows: 日の鍵.map((d) => ({ date: d, metrics: work.daily[d].metrics })) };

    // 記録した日ごとの作品全体の数と、前の記録からの増え方
    const 並び = work.snapshots.slice(-(TREND_DAYS + 1));
    const 見せる欄 = (TREND_METRICS[site] || TREND_METRICS.kakuyomu).filter((k) => 並び.some((s) => k in s.metrics));
    const rows = [];
    for (let i = 0; i < 並び.length; i += 1) {
      const s = 並び[i];
      const 前 = i > 0 ? 並び[i - 1] : work.snapshots[work.snapshots.indexOf(s) - 1];
      const 差 = {};
      for (const k of 見せる欄) {
        if (前 && k in 前.metrics && k in s.metrics) {
          差[k] = s.metrics[k] - 前.metrics[k];
        }
      }
      rows.push({ date: s.date, metrics: s.metrics, diffs: 差, gapDays: 前 ? 日の差(前.date, s.date) : null });
    }
    報告.snapshots = {
      metrics: 見せる欄.map((k) => ({ key: k, label: 欄の呼び名(site, k) })),
      rows: rows.slice(-TREND_DAYS),
    };

    報告.rates = computeRates(work);
    return 報告;
  }

  function 日の差(a, b) {
    const ta = Date.parse(`${a}T00:00:00Z`);
    const tb = Date.parse(`${b}T00:00:00Z`);
    return Number.isNaN(ta) || Number.isNaN(tb) ? null : Math.round((tb - ta) / 86400000);
  }

  /**
   * 覚えた作品ごとの集計を組む。**覚えた作品だけ**を出す（記録に他の作品が残っていても出さない）。
   * 並びは、最後に記録した日時の新しい順（まだ記録の無い作品は後ろ）。
   */
  function buildReport(history, ownWorks, now) {
    const h = normalizeHistory(history);
    const 報告 = (ownWorks || [])
      .filter((w) => w && typeof w.siteId === "string" && typeof w.workId === "string")
      .map((own) => {
        const id = 作品IDを揃える(own.siteId, own.workId);
        const work = h.works.find((w) => w.siteId === own.siteId && w.workId === id);
        return buildWorkReport(work, own, now);
      });
    return 報告.sort((a, b) => {
      const ta = a.recorded ? a.lastReadAt : "";
      const tb = b.recorded ? b.lastReadAt : "";
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
  }

  /** 1つの率を、式と実際の数を並べた行にする。 */
  function 率の行(rate) {
    const 字下げ = " ".repeat(16);
    const 頭 = 左寄せ(rate.label, 16);
    if (rate.missing !== undefined) {
      const 行 = [`${頭}出せません：${rate.missing}`, `${字下げ}式：${rate.formula}`];
      if (rate.operands.length > 0) {
        行.push(`${字下げ}読めた数：${rate.operands.map((o) => `${o.label} ${件数(o.value)}${o.readAt ? `（${日時の字(o.readAt)}の数）` : ""}`).join("、")}`);
      }
      return 行;
    }
    const 行 = [`${頭}${rate.percent}`, `${字下げ}式：${rate.formula}`, `${字下げ}実際の数：${rate.expression}`];
    const 違う回 = rate.operands.filter((o) => o.readAt);
    if (違う回.length > 0) {
      行.push(`${字下げ}（${違う回.map((o) => `${o.label}は${日時の字(o.readAt)}に読んだ数`).join("、")}）`);
    }
    return 行;
  }

  /** 1つの作品の集計を、等幅の字の行にする。 */
  function formatWorkReport(r) {
    const 行 = [`■ ${r.siteName}　作品ID ${r.workId}`];
    if (!r.recorded) {
      行.push(
        r.siteId === "narouFun"
          ? "  まだ記録がありません。この作品の Narou.fun のページを開くと記録します。"
          : "  まだ記録がありません。この作品の作品管理の画面（カクヨムの「作品の管理」）を開くと記録します。"
      );
      return 行;
    }
    行.push(`  最後に記録：${日時の字(r.lastReadAt)}　記録した日数：${r.days}日`);

    行.push("", "  いまの数");
    if (r.current.length > 0) {
      行.push(`    ${r.current.map((c) => `${c.label} ${件数(c.value)}`).join("　")}`);
    } else {
      行.push("    作品全体の数はまだ読めていません（作品管理の画面を開くと読みます）");
    }
    const 期間 = [];
    if (r.today) {
      for (const [k, v] of Object.entries(r.today)) 期間.push(`今日の${欄の呼び名(r.site, k)} ${増減の字(k, v)}`);
    }
    if (r.thisMonth) {
      for (const [k, v] of Object.entries(r.thisMonth)) 期間.push(`今月の${欄の呼び名(r.site, k)} ${件数(v)}`);
    }
    if (期間.length > 0) {
      行.push(`    ${期間.join("　")}`);
    }

    if (r.daily.rows.length > 0) {
      行.push("", `  日ごとの数（サイトが出している、その日の数。直近${TREND_DAYS}日まで）`);
      const 列幅 = r.daily.metrics.map((m) => Math.max(幅(m.label), 8));
      行.push(`    ${左寄せ("日付", 6)}${r.daily.metrics.map((m, i) => 右寄せ(m.label, 列幅[i] + 2)).join("")}`);
      const 先頭 = r.daily.metrics[0] ? r.daily.metrics[0].key : null;
      const 最大 = 先頭 ? Math.max(0, ...r.daily.rows.map((row) => (数か(row.metrics[先頭]) ? row.metrics[先頭] : 0))) : 0;
      for (const row of r.daily.rows) {
        const 枡 = r.daily.metrics.map((m, i) =>
          右寄せ(m.key in row.metrics ? 日ごとの字(m.key, row.metrics[m.key], r.site) : 無い印, 列幅[i] + 2)
        );
        const 先頭の値 = 先頭 ? row.metrics[先頭] : undefined;
        行.push(`    ${左寄せ(月日(row.date), 6)}${枡.join("")}  ${棒(先頭の値, 最大)}`.replace(/\s+$/, ""));
      }
    }

    if (r.snapshots.rows.length > 0 && r.snapshots.metrics.length > 0) {
      行.push("", "  記録した日ごとの数（作品全体。括弧は前の記録からの増え方）");
      /*
        数と増え方を別の列にする（0.11.2）。1つの枡に「11,418（+398）」と続けて右寄せにしていた頃は、
        増え方の字数で数の位置が行ごとに動き、数が縦に揃わなかった。数は右寄せ・増え方は左寄せで、
        括弧は半角にする（全角の「）」は字が枡の左半分にしか無く、行の右端が揃って見えない）
      */
      const 欄たち = r.snapshots.metrics;
      const 行たち = r.snapshots.rows;
      const 数の字 = (row, m) => (m.key in row.metrics ? 件数(row.metrics[m.key]) : 無い印);
      const 差の字 = (row, m) =>
        m.key in row.metrics && m.key in row.diffs ? `(${増減(row.diffs[m.key])}${row.gapDays > 1 ? "*" : ""})` : "";
      const 数の幅 = 欄たち.map((m) => Math.max(幅(m.label), ...行たち.map((row) => 幅(数の字(row, m)))));
      const 差の幅 = 欄たち.map((m) => Math.max(0, ...行たち.map((row) => 幅(差の字(row, m)))));
      const 枡 = (数, 差, i) => 右寄せ(数, 数の幅[i] + 2) + (差の幅[i] > 0 ? ` ${左寄せ(差, 差の幅[i])}` : "");
      行.push(`    ${左寄せ("日付", 6)}${欄たち.map((m, i) => 枡(m.label, "", i)).join("")}`.replace(/\s+$/, ""));
      let 間が空いた = false;
      for (const row of 行たち) {
        if (row.gapDays > 1) 間が空いた = true;
        行.push(
          `    ${左寄せ(月日(row.date), 6)}${欄たち.map((m, i) => 枡(数の字(row, m), 差の字(row, m), i)).join("")}`.replace(/\s+$/, "")
        );
      }
      if (間が空いた) {
        行.push("    * は、前に記録した日から1日より空いている（その間の合計の増え方）");
      }
    }

    行.push("", "  率（第1話を読んだ人のうち、何割か。式は統合小説執筆環境と同じ）");
    const 率 = r.rates;
    for (const rate of [率.dropout, 率.bookmark, 率.rating]) {
      for (const l of 率の行(rate)) 行.push(`    ${l}`);
    }
    if (率.base) {
      行.push(
        `    基準の話：第${率.base.episode}話（${日時の字(率.base.updatedAt)} 更新。読んだ時点で更新から${SETTLE_HOURS / 24}日以上たっていた、いちばん新しい話）`
      );
    }
    if (率.episodeReadAt) {
      行.push(`    話ごとの数：${日時の字(率.episodeReadAt)} に読んだ数`);
    } else if (r.siteId === "narouFun") {
      行.push("    Narou.fun には話ごとのPVが無いので、3つの率はどれも出せません（第1話のPVが要ります）");
    } else {
      行.push("    話ごとのPVは、作品管理の画面かアクセス数の画面を開くと読みます");
    }
    return 行;
  }

  /** 今日の数（なろうの日ごとは増減なので符号を付ける。カクヨムのPVはその日の数）。 */
  function 増減の字(key, v) {
    return key === "pv" ? 件数(v) : 増減(v);
  }

  function 日ごとの字(key, v, site) {
    return site === "narou" && key !== "pv" ? 増減(v) : 件数(v);
  }

  /**
   * 集計の全体を文字にする（説明のページの <pre> へそのまま入れる）。
   * ページへ要素を差し込まない約束なので、表も棒も字で描く。
   */
  function formatReport(history, ownWorks, now) {
    const 報告 = buildReport(history, ownWorks, now);
    if (報告.length === 0) {
      return "まだ、ご自分の作品を覚えていません。上の「はじめに」の手順で、ご自分の作品の画面を開いてください。";
    }
    return 報告.map((r) => formatWorkReport(r).join("\n")).join("\n\n");
  }

  const api = {
    HISTORY_VERSION,
    HISTORY_LIMITS,
    SETTLE_HOURS,
    TREND_DAYS,
    emptyHistory,
    normalizeHistory,
    dayKeyOf,
    recordEnvelope,
    trimHistory,
    keepOnlyOwn,
    computeRates,
    formatPercent,
    buildReport,
    formatWorkReport,
    formatReport,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
