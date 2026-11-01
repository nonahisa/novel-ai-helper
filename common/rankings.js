"use strict";

/**
 * ランキングに載ったときの**お祝い**の決め方（0.19.0。作者の指示 2026-11-02「ランキング画面に自作があったら
 * 吹き出しでお祝い、そして取得」「ランキングに入ったり順位が上がった場合、風船とか花火（規模により変動）」）。
 *
 * ## このファイルは Chrome に触れない
 *
 * 保存（chrome.storage.local）の読み書きと吹き出しを出すのは裏方（background.js）だけ。ここは
 * 「もう鳴らしたか」「前に見た順位と比べて、どの演出にするか」を決める関数だけで、テストから直接呼べる。
 * 吹き出し（bubble.js）も、動きを減らす設定のときに演出を出すかを effectToShow で決める。
 *
 * ## 鳴らすのは一度だけ
 *
 * 鳴らした印の鍵は **サイト＋作品ID＋区分（board）＋日付＋順位**。同じ日に同じ順位の画面を何度開いても鳴らさない。
 * 同じ日に順位が動いたら鍵が変わるので、もう一度鳴らす。
 * 鳴らした印は、**吹き出しが実際に出たときだけ**残す（タブが前に無くて出せなかったのに残すと、作者は一度も見ないまま終わる）。
 *
 * ## 前に見た順位（演出の規模を決める材料）
 *
 * サイト＋作品ID＋区分ごとに、**作者に見せた最後の順位**を覚える（鳴らしたときだけ更新する）。
 * 「前に見たときより上がったか」は、作者が体験した順位どうしで比べるのが自然なため。
 */
(function (global) {
  /** 演出の種類。並びは規模の小さい順（複数の作品が同時に載ったときは、いちばん大きいものを出す）。 */
  const EFFECTS = ["none", "balloons", "fireworks", "grand"];

  /**
   * 花火にする上位の線（10位以内）。
   *
   * カクヨムのランキングは1ページ 110件ほど、アルファポリスの HOT も100件単位で並ぶ。
   * 最初のひと目に入る上位の10件は、どのサイトでも「目立つ所に載った」と言える線として選んだ。
   */
  const TOP_RANK_FOR_FIREWORKS = 10;

  /**
   * 「大きな上昇」の線。**半分以下の順位になり、しかも10位以上上がった**とき。
   *
   * 差だけで決めると、300位→280位（20位の上昇）が大事件になり、比だけで決めると 4位→2位 が同じ扱いになる。
   * 両方を満たすときだけ花火にする（100位→50位、30位→15位 は花火、50位→40位 は風船）。
   */
  const BIG_RISE_RATIO = 2;
  const BIG_RISE_MIN_STEPS = 10;

  /**
   * 覚える量の上限。前に見た順位は区分ごとに1行（作品×区分の組の数）、鳴らした印は鳴らすたびに1行。
   * どちらも古いものから落とす。300 は、作品を10ほど・それぞれ数十の区分に載せても届かない数。
   */
  const MAX_SEEN = 300;
  const MAX_RUNG = 300;

  /** 区分ごとの鍵（前に見た順位）。 */
  function seenKey(entry) {
    return [entry.site, entry.workId, entry.board].join("|");
  }

  /** 鳴らした印の鍵。順位まで入れる——同じ日に順位が動いたら、もう一度鳴らすため。 */
  function celebrationKey(entry) {
    return [entry.site, entry.workId, entry.board, entry.date, String(entry.rank)].join("|");
  }

  /** 何も覚えていない状態。 */
  function emptyMemory() {
    return { seen: {}, rung: [] };
  }

  /** 保存から読んだものを形に揃える。形の合わない行は捨てる（捨てた分は「まだ見ていない」に戻るだけ）。 */
  function normalizeMemory(raw) {
    const m = emptyMemory();
    if (!raw || typeof raw !== "object") {
      return m;
    }
    if (raw.seen && typeof raw.seen === "object") {
      for (const [k, v] of Object.entries(raw.seen)) {
        if (v && Number.isSafeInteger(v.rank) && v.rank >= 1 && typeof v.at === "string") {
          m.seen[k] = { rank: v.rank, date: typeof v.date === "string" ? v.date : "", at: v.at };
        }
      }
    }
    if (Array.isArray(raw.rung)) {
      m.rung = raw.rung.filter((k) => typeof k === "string" && k !== "").slice(-MAX_RUNG);
    }
    return m;
  }

  /**
   * いまの順位と、前に見た順位から、演出を決める。
   *
   * - 下がった・同じ → 演出なし（文だけ）
   * - 1位 → 大きな花火
   * - 10位以内・大きな上昇 → 花火
   * - 初めて入った・小さな上昇 → 風船
   *
   * @param {number} rank いまの順位
   * @param {number|undefined} prevRank 前に見た順位（初めてなら undefined）
   */
  function effectFor(rank, prevRank) {
    const 前 = Number.isSafeInteger(prevRank) && prevRank >= 1 ? prevRank : undefined;
    if (前 !== undefined && rank >= 前) {
      return "none";
    }
    if (rank === 1) {
      return "grand";
    }
    if (rank <= TOP_RANK_FOR_FIREWORKS) {
      return "fireworks";
    }
    if (前 !== undefined && rank * BIG_RISE_RATIO <= 前 && 前 - rank >= BIG_RISE_MIN_STEPS) {
      return "fireworks";
    }
    return "balloons";
  }

  /** いちばん大きな演出を選ぶ。 */
  function largestEffect(effects) {
    let 最大 = 0;
    for (const e of effects || []) {
      最大 = Math.max(最大, EFFECTS.indexOf(e));
    }
    return EFFECTS[最大];
  }

  /**
   * 鳴らす分を決める。まだ鳴らしていない順位だけを、演出つきで返す（同じ鍵が2つあれば1つにまとめる）。
   *
   * @param {object} memory normalizeMemory を通したもの
   * @param {object[]} entries 読んだ順位（覚えた作品の分だけ）
   * @returns {{fresh:{entry:object, prevRank?:number, effect:string}[], effect:string}}
   */
  function planCelebration(memory, entries) {
    const m = memory || emptyMemory();
    const 鳴らした = new Set(m.rung);
    const 見た鍵 = new Set();
    const fresh = [];
    for (const entry of entries || []) {
      const 鍵 = celebrationKey(entry);
      if (鳴らした.has(鍵) || 見た鍵.has(鍵)) {
        continue;
      }
      見た鍵.add(鍵);
      const 前 = m.seen[seenKey(entry)];
      const prevRank = 前 ? 前.rank : undefined;
      fresh.push(Object.assign({ entry, effect: effectFor(entry.rank, prevRank) }, prevRank !== undefined ? { prevRank } : {}));
    }
    return { fresh, effect: largestEffect(fresh.map((f) => f.effect)) };
  }

  /**
   * 鳴らしたことを残す（新しい形を返す。元は変えない）。前に見た順位も、見せた順位へ更新する。
   * 上限を越えたら、鳴らした印は古いものから、前に見た順位は見た日時の古いものから落とす。
   */
  function markRung(memory, fresh, now) {
    const m = memory || emptyMemory();
    const 日時 = (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).toISOString();
    const seen = Object.assign({}, m.seen);
    const rung = m.rung.slice();
    for (const f of fresh || []) {
      const 鍵 = celebrationKey(f.entry);
      if (!rung.includes(鍵)) {
        rung.push(鍵);
      }
      seen[seenKey(f.entry)] = { rank: f.entry.rank, date: f.entry.date, at: 日時 };
    }
    const 並び = Object.entries(seen).sort((a, b) => (a[1].at < b[1].at ? -1 : a[1].at > b[1].at ? 1 : 0));
    const 残す = 並び.slice(Math.max(0, 並び.length - MAX_SEEN));
    return { seen: Object.fromEntries(残す), rung: rung.slice(-MAX_RUNG) };
  }

  /**
   * 吹き出しで実際に出す演出。**動きを減らす設定（prefers-reduced-motion）のときは出さない**
   * （吹き出しの文だけにする。CSS の側でも動きを止めてある——二重の守り）。知らない名前も出さない。
   */
  function effectToShow(effect, reducedMotion) {
    if (reducedMotion === true) {
      return "none";
    }
    return EFFECTS.includes(effect) ? effect : "none";
  }

  /**
   * 日本時間の日付（YYYY-MM-DD）。**機械の時刻の地域に頼らない**——UTC に9時間足してから日付を切る
   * （作者のパソコンが日本時間でも、テストの機械が UTC でも同じ答えになる）。
   */
  function jstDate(now) {
    const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  const api = {
    EFFECTS,
    TOP_RANK_FOR_FIREWORKS,
    BIG_RISE_RATIO,
    BIG_RISE_MIN_STEPS,
    MAX_SEEN,
    MAX_RUNG,
    seenKey,
    celebrationKey,
    emptyMemory,
    normalizeMemory,
    effectFor,
    largestEffect,
    planCelebration,
    markRung,
    effectToShow,
    jstDate,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHRankings = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
