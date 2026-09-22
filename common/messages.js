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
      // 「話ごと」と言い切る（0.4.0）。作品管理では作品全体と話ごとが同じ画面から
      // 同時に入るので、「話 219」だと**どちらの数え方なのか**が読み取れない
      内訳.push(`話ごと ${episode}`);
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
   * 「どこでなら使えるか」の道案内（0.3.0）。押せないボタンの下には、必ずこれを出す。
   * **できないことだけを言って終わらない**——作者が次にどの画面を開けばよいかまで言う。
   */
  const 使える画面 = {
    貼り込み: "話の作成画面で使えます。",
    読み取り: "作品管理・アクセス数の画面で使えます。",
  };

  /** 対応していないサイト。2つのボタンで言うことが同じなので、1つにまとめる。 */
  const 使えないサイト = "貼り込み係が使える画面ではありません。";

  /**
   * 貼り込みは使えるが、**読み取りは止めてある**サイト（いまはアルファポリス）。
   *
   * ここで「作品管理・アクセス数の画面で使えます」と言うと、**いつまで歩いても
   * 着かない道案内**になる——使えないと言うより悪い。だから、このサイトでは
   * 読めないことと、**代わりの道（母艦の手入力）**を言う。
   *
   * 母艦が同じ場面で言う文（`core/readerStatsEnvelope.ts`：「◯◯の読者の反応は、
   * 貼り付けでは取り込みません（…）。『読者の反応を手入力する』からご記入ください。」）と
   * **向きを揃えてある**。両側で言うことが食い違うと、作者はどちらを信じればよいか分からない。
   * 写しではなく短くしてあるのは、ここがボタンの下の1行だから。
   *
   * **止めている理由は書かない。** 母艦の「規約の判断により」に対して、拡張の側で
   * アルファポリスを止めているのは**管理画面を実機で見られていないから**で、理由が違う
   * （`content/statsSites.js` の supported: false）。片方の理由をもう片方に書くと嘘になる。
   */
  const 読み取れないサイト = (名) =>
    `${名}の読者の反応は、まだ読み取れません（母艦の「読者の反応を手入力する」で記録できます）。`;

  /**
   * 読み取りボタンの道案内を選ぶ。**サイトごと読み取れないなら、道案内をしない。**
   * 判定そのものは見立て（pageState.js の statsSupported）が持っている。
   */
  function 読み取りの道案内(見立て, 使える画面の文) {
    return 見立て.statsSupported === false
      ? 読み取れないサイト(見立て.siteLabel || "このサイト")
      : 使える画面の文;
  }

  /** URLを読めない画面（chrome:// や about:）。こちらも2つのボタンで同じ。 */
  const 読めない画面 = "この画面では使えません。";

  /**
   * 読み取れる画面で、**何がどれだけ読まれるか**を押す前に言う（0.2.2 は押したあとだった）。
   *
   * 2つの画面で読める量が違う——作品管理は全話ぶんが1回で入り、アクセス数は
   * そのページの50話ぶんだけ（2026-09-22 実機。219話の作品で5ページ）。
   * **どちらが得かを、押す前に読み比べられる**のが狙いである（0.4.0）。
   *
   * 出し分けは pageKind（表の側の名前）で行う——表示名で分岐すると、
   * 表の label を直した日にこの但し書きが黙って消える。
   */
  function 読み取る量(見立て) {
    const 頭 = `${見立て.siteLabel || ""}の${見立て.pageLabel || "管理画面"}です。`;
    if (見立て.pageKind === "work") {
      return `${頭}作品全体と、全話ぶんを読みます。`;
    }
    if (見立て.pageKind === "accesses") {
      return `${頭}このページの50話ぶんを読みます。`;
    }
    return 頭;
  }

  /**
   * ボタンの下に出す1行（0.3.0）。**押す前に、使えるか／なぜ使えないかを言う。**
   *
   * 0.2.3 までは、ボタンの上に静的な説明文が2つ並んでいた。開いている画面が何であっても
   * 同じ文なので、**押して断られるまで使えるかどうかが分からない**。
   * ここは見立て（common/pageState.js）の結果をそのまま文にするだけで、判定はしない
   * ——文と判定が別々に条件を持つと、食い違った日に画面が嘘をつく。
   *
   * 押せなくするのは見た目の親切であって守りではないので、**この文が間違っていても
   * 貼り込み先の照合（checkTarget）と読み取り先の照合（matchReadPage）は効いている。**
   *
   * @param {object} state common/pageState.js の describePage の戻り値
   * @returns {{fill:string, stats:string}} 2つのボタンそれぞれに添える1行（**空文字にしない**）
   */
  function messageForPageState(state) {
    const 見立て = state || {};
    const 名 = 見立て.siteLabel || "";
    switch (見立て.kind) {
      case "fill":
        return {
          fill: `${名}の${見立て.pageLabel || "話の作成画面"}です。母艦でコピーしてから押してください。`,
          stats: 読み取りの道案内(見立て, `${名}の作品管理・アクセス数の画面で使えます。`),
        };
      case "stats":
        return {
          fill: 使える画面.貼り込み,
          stats: 読み取る量(見立て),
        };
      case "knownSiteOtherPage":
        return {
          fill: 使える画面.貼り込み,
          stats: 読み取りの道案内(見立て, 使える画面.読み取り),
        };
      case "unknownSite":
        return { fill: 使えないサイト, stats: 使えないサイト };
      case "noUrl":
      default:
        // 拡張の設定画面など、URLを読めない場所。理由を分けても作者にできることは無い
        return { fill: 読めない画面, stats: 読めない画面 };
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
    messageForPageState,
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
