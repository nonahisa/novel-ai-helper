"use strict";

/**
 * 画面に出す日本語の文言を、ここ1か所にまとめる。
 *
 * 文言をロジック側（envelope.js / match.js）へ埋め込まないのは、
 * 判定の理由（reason）だけをテストで確かめられるようにするため。
 * 「なぜ止まったか」を作者に伝える文は、この表だけを直せば変えられる。
 */
(function (global) {
  /** サイトの表示名。理由の文に混ぜる。 */
  const SITE_LABELS = {
    kakuyomu: "カクヨム",
    narou: "小説家になろう",
    alphapolis: "アルファポリス",
  };

  function siteLabel(site) {
    return SITE_LABELS[site] || String(site);
  }

  /**
   * 封筒の読み取り結果（envelope.js の reason）を文にする。
   *
   * 「クリップボードに貼り込み用のデータがありません」は、
   * 中身が空・JSONでない・封筒の形でない、のすべてで同じ文言にしている。
   * 作者から見れば原因はどれも同じ（母艦側でコピーし直す）ため。
   */
  function messageForEnvelope(result) {
    if (result.ok) {
      return "";
    }
    switch (result.reason) {
      case "empty":
      case "not-json":
      case "not-object":
      case "not-envelope":
      case "bad-body":
        // 長すぎる本文だけは、作者の取るべき次の手が違う（コピーし直しでは直らない）。
        if (typeof result.detail === "string" && result.detail.startsWith("too-long")) {
          return `貼り込もうとしている本文が長すぎます（${
            result.detail.split(":")[1]
          }字）。1話分だけをコピーし直してください。`;
        }
        return "クリップボードに貼り込み用のデータがありません。母艦（統合小説執筆環境）で「貼り込み係へ渡す形でコピー」を実行してから、もう一度押してください。";
      case "bad-title":
      case "bad-workId":
        return "クリップボードに貼り込み用のデータがありません。母艦（統合小説執筆環境）で「貼り込み係へ渡す形でコピー」を実行してから、もう一度押してください。";
      case "bad-version":
        return `この貼り込みデータの版（${result.detail}）には対応していません。母艦側の拡張機能を新しくしてください。`;
      case "unknown-site":
        return `知らないサイト（${result.detail}）宛てのデータです。貼り込み係が対応しているのはカクヨムとアルファポリスです。`;
      default:
        return "クリップボードに貼り込み用のデータがありません。";
    }
  }

  /**
   * 貼り込み先の照合結果（match.js の reason）を文にする。
   */
  function messageForMatch(result) {
    if (result.ok) {
      return "";
    }
    switch (result.reason) {
      case "bad-url":
        return "いま開いているページのURLが読めませんでした。投稿画面のタブを選んでから押してください。";
      case "site-mismatch":
        return `この画面は${siteLabel(result.expectedSite)}の投稿画面ではないようです。${siteLabel(
          result.expectedSite
        )}の話の作成画面を開いてから押してください。`;
      case "unsupported-site":
        // なろうのように、表に枠だけ置いてあるサイト。
        return `${siteLabel(
          result.expectedSite
        )}への貼り込みには、まだ対応していません（規約の確認が済んでいないため）。`;
      case "not-post-page":
        return `${siteLabel(
          result.expectedSite
        )}の話の作成画面ではないようです。新しい話を書く画面を開いてから押してください。`;
      case "work-mismatch":
        return `この画面は作品「${result.expectedWorkId}」の投稿画面ではないようです（開いているのは「${result.actualWorkId}」）。作品を取り違えていないか確かめてください。`;
      case "work-id-not-found":
        return "投稿画面のURLから作品IDが読み取れませんでした。取り違えを防げないため、貼り込みは行いません。";
      default:
        return "この画面には貼り込めません。";
    }
  }

  /** ページ側（content script）から返る結果の文言。 */
  const PAGE = {
    /** 6.79.6-1：認証情報には触れない。ログイン画面では即座に何もしない。 */
    loginPage: "ログイン画面では動きません。ログインを済ませ、話の作成画面を開いてから押してください。",
    /** 6.79.3：欄が見つからないときは、黙って違う欄に入れない。 */
    fieldsNotFound:
      "ページの形が変わったようです。安全のため何もしませんでした（貼り込み係の欄の指定を直す必要があります）。",
    canceled: "何もしませんでした。",
    notReady:
      "ページ側の貼り込み係が動いていません。投稿画面を開き直し（再読み込み）してから、もう一度押してください。",
    /**
     * 作品IDの照合を飛ばしたときの但し書き（match.js の workIdChecked が false）。
     * 「照合した」と誤解させないために、結果の前に必ず付ける。
     */
    workIdUnchecked:
      "【このサイトでは作品の取り違えを機械では確かめられません。開いている画面が目当ての作品かどうか、ご自分で確かめてください】\n",
  };

  /**
   * 読者の反応の読み取り（設計書6.79.7）の文言。
   *
   * 読み取りは**押したのに何も起きない**のが一番困る（貼り込みと違い、画面に痕跡が
   * 残らない）。だから、読めなかったときは必ず理由と、次にどうすればよいかを出す。
   */
  const STATS = {
    /** 読み取れる管理画面の道案内。理由の文の末尾に何度も出るのでまとめておく。 */
    道案内:
      "カクヨムの作品管理（kakuyomu.jp/my/works/作品ID）か、アクセス数（kakuyomu.jp/works/作品ID/accesses）を開いてから押してください。",
    copying: "この画面の読者の反応を読んでいます…",
    notReady:
      "ページ側の読み取り係が動いていません。管理画面を開き直し（再読み込み）してから、もう一度押してください。",
    clipboardFailed: (detail) =>
      `読めましたが、クリップボードへ置けませんでした（${detail}）。ブラウザの許可を確認してください。`,
  };

  /**
   * 次のページがあるときだけ足す但し書き（0.2.2）。
   *
   * カクヨムのアクセス数は50話ずつのページ送りで、219話の作品では5ページある。
   * 件数だけを出していた 0.2.1 までは、「50件コピーしました」を見た作者が
   * **全話が入った**と思うほかなかった。
   *
   * 「繰り返しても二重にはなりません」まで言うのは、**繰り返してよいと分からないと
   * 作者が手を止める**から——母艦の取り込みは追記（同じ話の同じ数字は上書き）なので、
   * ページごとにコピー→取り込みを繰り返せば、正しく積み上がる。
   */
  const 次のページの但し書き =
    "\nこのページの分だけです。「次へ」で次のページを開き、同じようにコピーしてください（繰り返しても二重にはなりません）。";

  /**
   * 読み取った件数を伝える。**何件をどこへ持っていけばよいか**まで言う
   * （コピーしただけでは、作者の作業は終わっていない）。
   *
   * @param {{work:number, episode:number}} counts 読めた件数の内訳
   * @param {boolean} [hasNextPage] 画面に「次へ」があったか（read.js が見つける）
   */
  function messageForStatsCopied(counts, hasNextPage) {
    const work = (counts && counts.work) || 0;
    const episode = (counts && counts.episode) || 0;
    const 内訳 = [];
    if (work > 0) {
      内訳.push(`作品全体 ${work}`);
    }
    if (episode > 0) {
      内訳.push(`話 ${episode}`);
    }
    const 括弧 = 内訳.length > 0 ? `（${内訳.join("・")}）` : "";
    const 続き = hasNextPage === true ? 次のページの但し書き : "";
    return `読者の反応 ${
      work + episode
    }件${括弧}をコピーしました。母艦の「読者の反応を貼り付けて取り込む」で取り込めます。${続き}`;
  }

  /**
   * 読み取りが止まった理由（statsSites.js / read.js の reason）を文にする。
   */
  function messageForStatsRead(result) {
    if (result.ok) {
      return "";
    }
    switch (result.reason) {
      case "bad-url":
        return `いま開いているページのURLが読めませんでした。${STATS.道案内}`;
      case "unknown-site":
        return `このサイトの読者の反応には対応していません（いまはカクヨムだけです）。${STATS.道案内}`;
      case "unsupported-site":
        // アルファポリス。規約の判定は済んでいるが、管理画面を実機で見られていない。
        return `${siteLabel(
          result.siteId
        )}の読者の反応の読み取りには、まだ対応していません（管理画面の形を実機で確かめられていないため）。`;
      case "not-read-page":
        return `この画面は、読者の反応を読める管理画面ではありません。${STATS.道案内}`;
      case "login":
        return PAGE.loginPage;
      case "no-data":
        return "ページの形が変わったようです。読める数字が1つも見つからないので、何も読みませんでした（貼り込み係の読み取りの表を直す必要があります）。";
      case "failed":
        return `読み取りの途中で問題が起きました：${result.detail}`;
      default:
        return `この画面からは、読者の反応を読めませんでした。${STATS.道案内}`;
    }
  }

  /**
   * 入れた欄が「ページのどれ」だったのかを添える。
   * セレクタは推測で書いてあるので、思わぬ欄に入ったときに作者が気づけるようにする。
   */
  function describeField(label, signature) {
    return signature ? `${label}（${signature}）` : label;
  }

  function messageForFilled(filled, skipped) {
    const done = filled.length > 0 ? `${filled.join("と")}を入れました。` : "入れた欄はありません。";
    const skip = skipped.length > 0 ? `（${skipped.join("と")}は入れていません）` : "";
    // 6.79.2-2：送信は必ず作者の手であることを、成功時に毎回伝える。
    return `${done}${skip}内容を確かめてから、投稿ボタンはご自分で押してください。`;
  }

  /**
   * 貼り込む前の確認。理由が2つ（中身がある／欄が確かでない）あるので、
   * 当てはまるものだけを並べて1回で聞く（guard.js の confirmationNeeded が仕分ける）。
   */
  function confirmFill(reasons) {
    const occupied = (reasons && reasons.occupied) || [];
    const uncertain = (reasons && reasons.uncertain) || [];
    const 行 = [];
    if (occupied.length > 0) {
      行.push(`${occupied.join("と")}に、すでに文が入っています。`);
    }
    if (uncertain.length > 0) {
      行.push(
        `${uncertain.join(
          "と"
        )}は、ページの形から見当を付けた欄です。投稿の欄でないかもしれません。`
      );
    }
    行.push("貼り込み係の内容で埋めますか？");
    行.push("");
    行.push("［キャンセル］を選ぶと、何もしません。");
    return 行.join("\n");
  }

  const api = {
    SITE_LABELS,
    siteLabel,
    messageForEnvelope,
    messageForMatch,
    messageForFilled,
    messageForStatsCopied,
    messageForStatsRead,
    STATS,
    describeField,
    confirmFill,
    PAGE,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHMessages = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
