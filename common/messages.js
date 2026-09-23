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
    // 読み取りの表の id（0.9.0。溜まりの一覧で、どこで読んだかを言うため）
    narouFun: "Narou.fun",
  };

  function siteLabel(site) {
    return SITE_LABELS[site] || String(site);
  }

  /**
   * 画面に出す作品ID（0.12.1）。**Nコードは大文字で見せる。**
   *
   * Narou.fun（db.narou.fun/works/…）は大文字の Nコードでしか作品のページを開かず、小文字だと
   * なろう本体へ転送される（2026-09-23 に確かめた）。作者が画面の Nコードを写して開いたときに
   * 迷わないよう、見せるのは大文字にする。
   *
   * 保存・照合・統合小説執筆環境へ渡す値は、これまでどおり小文字に揃えたまま
   * （common/stash.js の normalizeWorkId、common/history.js の 作品IDを揃える）。
   * ここを通すのは**見せるときだけ**——保存の値に使うと、揃えた照合が崩れる。
   *
   * @param {string} siteId 読み取りの表の id（"narouFun"｜"kakuyomu"）
   * @param {string} workId 作品ID
   */
  function displayWorkId(siteId, workId) {
    const id = String(workId == null ? "" : workId);
    return siteId === "narouFun" ? id.toUpperCase() : id;
  }

  /** 「Narou.fun の作品 N1234AB」「カクヨムの作品 1177…」。知らせと説明のページで同じ言い方にする。 */
  function workLabel(siteId, workId) {
    const id = displayWorkId(siteId, workId);
    return siteId === "narouFun" ? `Narou.fun の作品 ${id}` : `カクヨムの作品 ${id}`;
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
        return "クリップボードに貼り込み用のデータがありません。VS Code の拡張機能「統合小説執筆環境」の投稿キットで、ヘルパーへ渡す形のコピーを実行してから、もう一度押してください。";
      case "bad-title":
      case "bad-workId":
        return "クリップボードに貼り込み用のデータがありません。VS Code の拡張機能「統合小説執筆環境」の投稿キットで、ヘルパーへ渡す形のコピーを実行してから、もう一度押してください。";
      case "bad-version":
        // どちらが古いかはここでは決められない（データが新しすぎても古すぎても
        // 同じ失敗になる）ので、両方を新しくしてもらう
        return `この貼り込みデータの版（${result.detail}）には対応していません。統合小説執筆環境ヘルパーと、VS Code の拡張機能「統合小説執筆環境」の片方が古いようです。両方を新しくしてから、もう一度コピーし直してください。`;
      case "unknown-site":
        return `知らないサイト（${result.detail}）宛てのデータです。統合小説執筆環境ヘルパーが貼り込めるのはカクヨムとアルファポリスです。`;
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
      "ページの形が変わったようです。安全のため何もしませんでした。統合小説執筆環境ヘルパーを新しくすると直ることがあります。直らないときは、ヘルパーの開発者へお知らせください。",
    canceled: "何もしませんでした。",
    notReady:
      "この画面の中では、統合小説執筆環境ヘルパーがまだ動いていません。投稿画面を開き直し（再読み込み）してから、もう一度押してください。",
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
      "カクヨムの作品管理（kakuyomu.jp/my/works/作品ID）か、アクセス数（kakuyomu.jp/works/作品ID/accesses）、" +
      "なろうの作品ならご自分の作品の Narou.fun のページ（db.narou.fun/works/Nコード）を開いてから押してください。",
    notReady:
      "この画面の中では、読者の反応を読む部分がまだ動いていません。管理画面を開き直し（再読み込み）してから、もう一度押してください。",
    /** まとめたが、クリップボードへ置けなかった（0.9.0）。溜まりは消していないことまで言う。 */
    clipboardFailed: (detail) =>
      `まとめましたが、クリップボードへ置けませんでした（${detail}）。溜まった分はそのまま残してあります。ブラウザの許可を確認してから、もう一度押してください。`,
    /** 渡すものが無い（0.9.0。説明のページの「まとめて渡す」「もう一度渡す」から）。 */
    nothingToHand: "溜まっている読者の反応がありません。ご自分の作品の管理画面や Narou.fun のページを開くと溜まります。",
    nothingToHandAgain: "もう一度渡せる分がありません（渡した分の控えは、次に渡すまで、長くても7日で消えます）。",
    /** 「統合小説執筆環境へ渡す」を切っているのに、説明のページから渡そうとした（0.11.0）。 */
    handIsOff: "「統合小説執筆環境へ渡す」を切っているので、渡しませんでした。渡すときは、このページで入れてください。",
  };

  /**
   * いま押した画面に、次のページがあるときの但し書き（0.2.2。0.9.0 で溜める形に言い直した）。
   *
   * カクヨムのアクセス数は50話ずつのページ送りで、219話の作品では5ページある。
   * 0.9.0 からは、ご自分の作品のページなら**開くだけで溜まる**ので、「次へ」で開けばよい、と言う。
   * 「二重にはなりません」まで言うのは、**繰り返してよいと分からないと作者が手を止める**から
   * ——同じページは溜まりの中で置き換わり、統合小説執筆環境の取り込みも追記（同じ話の同じ数字は上書き）。
   */
  const 次のページの但し書き =
    "\nこの画面はこのページの分だけです。「次へ」で次のページを開くと、そのページも溜まります（同じページを何度開いても二重にはなりません）。";

  /**
   * Narou.fun の日ごとの表が、画面に出ている行の分だけだったときの但し書き（0.7.0）。
   *
   * この表は10行ずつのページ送りだが、**「次へ」でページごとに取り込むのは勧めない**。
   * 日ごとの数は前の日の累計との差で取るので、ページの境目の日（その前の日が別の
   * ページにある日）の差が取れずに抜ける。表示件数を30にすれば、1回で29日ぶん入る。
   * 開いたときに溜めた分は10行のままなので、30にしたら**もう一度押す**（押すと読み直して置き換える）。
   */
  const 表示件数の但し書き =
    "\n日ごとの表は、画面に出ている行の分だけです。表の下の「表示件数」を30にしてから、もう一度押してください（30日ぶんが1回で入ります。繰り返しても二重にはなりません）。";

  /**
   * 1つの画面から読めた件数の内訳（「作品全体 2・日ごと 30・話ごと 219」）。
   *
   * @param {{work:number, day?:number, episode:number}} counts 読めた件数の内訳
   *        （work と day は重ならない。day は日ごとの件数。0.5.0）
   */
  function 内訳の文(counts) {
    const work = (counts && counts.work) || 0;
    const day = (counts && counts.day) || 0;
    const episode = (counts && counts.episode) || 0;
    const 内訳 = [];
    if (work > 0) {
      内訳.push(`作品全体 ${work}`);
    }
    if (day > 0) {
      // 日のグラフの材料が何日ぶん入ったか。少なければ、作者が統合小説執筆環境のグラフの欠けに気づける
      内訳.push(`日ごと ${day}`);
    }
    if (episode > 0) {
      // 「話ごと」と言い切る（0.4.0）。作品管理では作品全体と話ごとが同じ画面から
      // 同時に入るので、「話 219」だと**どちらの数え方なのか**が読み取れない
      内訳.push(`話ごと ${episode}`);
    }
    return { 合計: work + day + episode, 括弧: 内訳.length > 0 ? `（${内訳.join("・")}）` : "" };
  }

  /**
   * まとめて渡したことを伝える（0.9.0）。**何を渡し、次に何が起きるか**まで言う。
   *
   * @param {{pages:number, works:number, entries:number}} summary 渡した分（common/stash.js の summarize）
   * @param {{counts?:object, hasNextPage?:boolean, nextPageKind?:string}|null} [current]
   *        押した画面を読み直したときの結果（読者の反応の画面で押したときだけ）。
   *        その画面の内訳と、次のページ・表示件数の但し書きを足す
   * @param {boolean} [again] 説明のページの「もう一度渡す」か
   */
  function messageForHanded(summary, current, again) {
    const s = summary || {};
    const 頭 = again ? "前に渡した読者の反応を、もう一度" : "溜まった読者の反応を";
    let 文 = `${頭}まとめて渡しました（${s.pages || 0}画面・${s.works || 0}作品・${s.entries || 0}件）。VS Code の統合小説執筆環境が取り込みます。VS Code が前に出ないときは、統合小説執筆環境の「読者の反応を貼り付けて取り込む」を実行してください（クリップボードに入っています）。`;
    if (current && current.counts) {
      const 内 = 内訳の文(current.counts);
      文 += `\nこの画面からは ${内.合計}件${内.括弧}。`;
    }
    if (current && current.hasNextPage === true) {
      文 += current.nextPageKind === "rowsPerPage" ? 表示件数の但し書き : 次のページの但し書き;
    }
    return 文;
  }

  /**
   * 「ご自分の作品ですか？」の問い（0.9.0。作者の裁定、2026-09-23「他人の作品の履歴はたまらないですよね？」）。
   *
   * 誰の作品のページでも開ける画面（Narou.fun・カクヨムのアクセス数）では、この拡張には
   * 作者の作品かどうかが分からない。だから**作者に1回だけ訊き**、認めた作品だけを以後自動で溜める。
   *
   * @param {string} siteId 表の id（"narouFun"｜"kakuyomu"）
   * @param {string} workId 作品ID（Nコード・カクヨムの作品ID）
   * @returns {{title:string, message:string}}
   */
  function approveQuestion(siteId, workId) {
    const 作品 = workLabel(siteId, workId);
    const 補い =
      siteId === "kakuyomu"
        ? "アクセス数の画面は、どなたの作品でも開けるためお尋ねしています（作品管理の画面を一度開くと、自動で覚えます）。"
        : "Narou.fun は、どなたの作品のページでも開けるためお尋ねしています。";
    return {
      title: "ご自分の作品ですか？",
      message: `${作品}を、ご自分の作品として覚えますか？覚えると、この作品の画面を開いたときに読者の反応を溜めます。ほかの方の作品なら「覚えない」を選んでください。${補い}`,
    };
  }

  /**
   * 溜められなかったとき（0.9.0。common/stash.js の makeItem・stashDecision の reason）。
   */
  function messageForStashFailed(reason) {
    switch (reason) {
      case "too-large":
        return "この画面の読者の反応は大きすぎて溜められませんでした。統合小説執筆環境ヘルパーの開発者へお知らせください。";
      case "not-own":
        return "ご自分の作品として覚えていない作品なので、溜めませんでした。";
      default:
        return messageForStatsRead({ ok: false, reason: "no-data" });
    }
  }

  /**
   * 溜まっている1件を、説明のページの一覧の1行にする（0.9.0）。
   * 「カクヨム 作品管理 1177…（9/23 14:20・作品全体 2・日ごと 30・話ごと 219）」
   */
  function describeStashItem(item) {
    const ページ = item.page && item.page > 1 ? ` ${item.page}ページ目` : "";
    const 日時 = new Date(item.storedAt);
    const いつ = Number.isNaN(日時.getTime())
      ? ""
      : `${日時.getMonth() + 1}/${日時.getDate()} ${String(日時.getHours()).padStart(2, "0")}:${String(日時.getMinutes()).padStart(2, "0")}`;
    const 内 = 内訳の文(item.counts);
    const 括弧の中 = [いつ, 内.括弧.replace(/^（|）$/g, "")].filter((x) => x !== "").join("・");
    return `${siteLabel(item.siteId)} ${item.pageLabel || ""}${ページ} ${displayWorkId(item.siteId, item.workId)}${括弧の中 ? `（${括弧の中}）` : ""}`;
  }

  /** 問いのボタン（通知のボタン）。0 番目が「覚える」。 */
  const APPROVE_BUTTONS = ["覚える", "覚えない"];

  /**
   * 覚えたあとの知らせ（0.9.0）。覚えた直後にその画面を読めたら、溜まった件数まで言う。
   * @param {number|null} stashCount 読めて溜めたなら溜まりの件数、読めなかったら null
   * @param {boolean} [handToIde] 「統合小説執筆環境へ渡す」が入っているか（0.11.0。指定が無ければ入っている扱い）
   */
  function messageForApproved(siteId, workId, stashCount, handToIde) {
    const 作品 = workLabel(siteId, workId);
    // 0.11.0：切っているときは溜めていないので、溜まりの件数も「まとめて渡す」も言わない。アイコンを押せば集計が開く
    if (typeof stashCount === "number" && handToIde === false) {
      return `${作品}を、ご自分の作品として覚え、この画面の読者の反応を記録しました。集計は、アイコンを押すと見られます。`;
    }
    // 0.10.0：統合小説執筆環境を持たない方にも分かるよう、集計の見方を先に言い、「まとめて渡す」は持っている方向けと分かる形にする
    if (typeof stashCount === "number") {
      return `${作品}を、ご自分の作品として覚え、この画面の読者の反応を記録しました。集計は、アイコンを右クリックして「${REPORT_MENU_TITLE}」で見られます。統合小説執筆環境をお使いなら、もう一度アイコンを押すと、溜まった分（いま ${stashCount}件）をまとめて渡します。`;
    }
    return `${作品}を、ご自分の作品として覚えました。次にこの作品の画面を開いたときから記録します。`;
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
        // なろう本体（syosetu.com）と KASASAGI もここへ落ちる——読まないと決めたサイト（6.79.7）
        return `このサイトの読者の反応には対応していません（いまはカクヨムと、なろうの作品の Narou.fun のページだけです）。${STATS.道案内}`;
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
        return "ページの形が変わったようです。読める数字が1つも見つからないので、何も読みませんでした。統合小説執筆環境ヘルパーを新しくすると直ることがあります。直らないときは、ヘルパーの開発者へお知らせください。";
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
  const 使えないサイト = "統合小説執筆環境ヘルパーが使える画面ではありません。";

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
    `${名}の読者の反応は、まだ読み取れません（統合小説執筆環境の「読者の反応を手入力する」で記録できます）。`;

  /**
   * 読み取りボタンの道案内を選ぶ。**サイトごと読み取れないなら、道案内をしない。**
   * 判定そのものは見立て（pageState.js の statsSupported）が持っている。
   */
  function 読み取りの道案内(見立て, 使える画面の文) {
    return 見立て.statsSupported === false
      ? 読み取れないサイト(見立て.siteLabel || "このサイト")
      : 使える画面の文;
  }

  /**
   * 読むだけのサイト（0.6.0。Narou.fun）の道案内。
   *
   * Narou.fun には投稿の画面が無いので、貼り込みのボタンに「話の作成画面で使えます」と
   * 書くと、**このサイトのどこかに話の作成画面がある**ように読める。読み取りのほうも、
   * カクヨムの「作品管理・アクセス数の画面」ではなく作品ページを案内する。
   * 表の id（statsSites.js）で引く——表示名で引くと、label を直した日に黙って外れる。
   */
  const 読むだけのサイト = {
    narouFun: {
      貼り込み: "Narou.fun は読むだけのページです（貼り込みはしません）。",
      読み取り: "ご自分の作品の Narou.fun のページ（db.narou.fun/works/Nコード）で使えます。",
    },
  };

  function 読むだけの案内(見立て, どちら, ふだんの文) {
    const 行 = 見立て && 見立て.siteId ? 読むだけのサイト[見立て.siteId] : undefined;
    return 行 ? 行[どちら] : ふだんの文;
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
      // 各話の更新日と日ごとのPVは、母艦の離脱率・日のグラフの材料（0.5.0）
      return `${頭}作品全体と、全話ぶんを読みます（各話の更新日と、直近の日ごとのPVも）。`;
    }
    if (見立て.pageKind === "accesses") {
      return `${頭}このページの50話ぶんを読みます。`;
    }
    if (見立て.pageKind === "narouFun") {
      /*
        **誰の作品のページかは、この拡張には分からない**（Narou.fun は誰の作品でも開ける）。
        押す前にそう言い、覚えた作品だけを溜めることまで言う（0.9.0。取り込むときには、
        母艦も作品ID（Nコード）で照合する）。
      */
      return (
        `${頭}作品全体の数（総合P・ブクマ・感想・レビュー・評価P・評価者数・週間読者）を読みます。` +
        "どなたの作品のページでも開けるので、ご自分の作品として覚えた作品だけを溜めます（初めての作品では、押すとお尋ねします）。"
      );
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
          fill: `${名}の${見立て.pageLabel || "話の作成画面"}です。統合小説執筆環境でコピーしてから押してください。`,
          stats: 読み取りの道案内(見立て, `${名}の作品管理・アクセス数の画面で使えます。`),
        };
      case "stats":
        return {
          fill: 読むだけの案内(見立て, "貼り込み", 使える画面.貼り込み),
          stats: 読み取る量(見立て),
        };
      case "knownSiteOtherPage":
        return {
          fill: 読むだけの案内(見立て, "貼り込み", 使える画面.貼り込み),
          stats: 読み取りの道案内(見立て, 読むだけの案内(見立て, "読み取り", 使える画面.読み取り)),
        };
      case "contests": {
        // 0.12.0。公募の一覧のページでは、貼り込みも読者の反応も使わない（押すと公募を読む）
        const 公募 = `${名}の公募の一覧です。押すと、並んでいる公募を読みます。`;
        return { fill: 公募, stats: 公募 };
      }
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
    行.push("統合小説執筆環境でコピーした内容で埋めますか？");
    行.push("");
    行.push("［キャンセル］を選ぶと、何もしません。");
    return 行.join("\n");
  }

  /**
   * 拡張の名前（0.8.0。作者の依頼、2026-09-23「名称はわかりやすく、統合小説執筆環境ヘルパーとかに」）。
   * 右クリックの項目・知らせの見出し・アイコンに重ねたときの説明が、同じ名前を言うようにここへ置く
   * （manifest.json の name と揃える。揃っていることは test/actions.test.js が見張る）。
   */
  const APP_NAME = "統合小説執筆環境ヘルパー";

  /** アイコンの右クリックに出す、集計を開く項目の名（0.10.0）。知らせの中の案内も同じ名を言う。 */
  const REPORT_MENU_TITLE = "読者の反応の集計を見る";

  /**
   * いまの画面で「できる1つのこと」の呼び名（0.8.0）。
   * ポップアップの2つのボタンの名前を引き継ぐ——作者がもう覚えている言い方を変えない。
   */
  const ACTION_LABELS = {
    fill: "この画面に貼り込む",
    // 0.9.0：読者の反応は開いたときに溜まるので、押したときは「まとめて渡す」（押した画面は読み直してから）
    stats: "読者の反応をまとめて渡す",
    approve: "この作品を自分の作品として覚える",
    hand: "溜まった読者の反応をまとめて渡す",
    // 0.11.0：「統合小説執筆環境へ渡す」を切っているとき。アイコンの右クリックの項目と同じ名を言う
    report: REPORT_MENU_TITLE,
    // 0.12.0：公募の一覧のページ。切っているときは、コピーだけする（VS Code は呼ばない）
    contests: "公募の一覧を統合小説執筆環境へ渡す",
    contestsCopy: "公募の一覧をコピーする",
  };

  /**
   * 公募の一覧（0.12.0）の文言。
   *
   * **読めなかったときは、読めなかったとはっきり言う**（0件を「渡した」にしない）。
   * ページの作りが変わると、この拡張は読めなくなる——そのときは、作者がページの文を
   * 全部選んでコピーし、統合小説執筆環境へ貼り付ける道がある。それを必ず添える。
   */
  const 貼り付けの道 =
    "読めないときは、ページの文章を全部選んでコピー（Ctrl+A → Ctrl+C）し、" +
    "統合小説執筆環境の「作品目標設定」→「公募の一覧を貼り付けて取り込む」から入れてください。";

  const CONTESTS = {
    貼り付けの道,
    notReady:
      "この画面の中では、公募の一覧を読む部分がまだ動いていません。ページを開き直し（再読み込み）してから、もう一度押してください。" +
      貼り付けの道,
    noCards:
      "この画面から公募を1件も読めませんでした。ページが読み込み終わってから、もう一度押してください。" +
      "ページの作りが変わったのかもしれません。" +
      貼り付けの道,
    notHere: "公募の一覧のページではないようです。",
    clipboardFailed: (detail) =>
      `公募の一覧を読みましたが、クリップボードへ置けませんでした（${detail}）。ブラウザの許可を確認してから、もう一度押してください。`,
  };

  /** 公募の一覧を読めなかったときの文（content/contestRead.js の reason）。 */
  function messageForContestsRead(result) {
    const r = result || {};
    if (r.reason === "no-cards") {
      return CONTESTS.noCards;
    }
    if (r.reason === "not-contest-page") {
      return CONTESTS.notHere;
    }
    return `公募の一覧を読めませんでした${r.detail ? `（${r.detail}）` : ""}。${貼り付けの道}`;
  }

  /**
   * 公募の一覧を置けたときの文（0.12.0）。**読めた数と読めなかった数を両方言う。**
   *
   * @param {{count:number, skipped:number, paged:boolean}} result 読み取り係の結果
   * @param {boolean} handToIde 「統合小説執筆環境へ渡す」が入っているか
   */
  function messageForContestsHanded(result, handToIde) {
    const r = result || {};
    const 読めた = Number(r.count) || 0;
    const 読めない = Number(r.skipped) || 0;
    let 文 = handToIde
      ? `公募 ${読めた}件を統合小説執筆環境へ渡しました。VS Code が前に出て取り込みます。` +
        "VS Code が前に出ないときは、統合小説執筆環境の「作品目標設定」→「公募の一覧を貼り付けて取り込む」を実行してください（クリップボードに入っています）。"
      : `公募 ${読めた}件をクリップボードへコピーしました。統合小説執筆環境の「作品目標設定」→「公募の一覧を貼り付けて取り込む」で取り込めます` +
        "（説明のページで「統合小説執筆環境へ渡す」を入れると、押したときに VS Code が前に出て取り込みます）。";
    if (読めない > 0) {
      文 += `\n名前を読めなかった ${読めない}件は入れていません。${貼り付けの道}`;
    }
    if (r.paged === true) {
      文 += "\nこの一覧はページごとです。「次へ」で次のページを開いて、もう一度押すと、そのページの分も取り込めます（同じ公募は二重になりません）。";
    }
    return 文;
  }

  /**
   * 右クリックの項目と、アイコンに重ねたときの説明（0.8.0）。
   * できることが無い画面では名前だけを言う（右クリックの項目はそもそも出さない）。
   */
  function actionTitle(kind) {
    return ACTION_LABELS[kind] ? `${APP_NAME}：${ACTION_LABELS[kind]}` : APP_NAME;
  }

  /**
   * できることが無い画面で押されたときの文（0.8.0）。
   *
   * ポップアップの頃は、2つのボタンの下にそれぞれ理由が出ていた。いまは押した結果だけが
   * 知らせに出るので、**2つの理由をまとめて1つの知らせにする**——「この画面では使えません」
   * だけで終わらず、どの画面でなら何ができるかまで言う（0.3.0 の道案内をそのまま使う）。
   * 2つの理由が同じ（知らないサイト・URLを読めない画面）なら、1回だけ言う。
   */
  function messageForNothingHere(state) {
    const 理由 = messageForPageState(state);
    if (理由.fill === 理由.stats) {
      return 理由.fill;
    }
    return `貼り込み：${理由.fill}\n読者の反応：${理由.stats}`;
  }

  /**
   * 押した結果の知らせ（chrome.notifications）の見出しと本文（0.8.0）。
   *
   * ポップアップを無くしたので、押した結果はここから出る。本文は、ポップアップに出していた文を
   * **そのまま**使う——同じ場面で別の言い方をすると、README の表と画面が食い違う。
   * 見出しで「できた／できなかった」を先に言うのは、知らせは流し読みされるから
   * （作者の例：「読者の反応 219件をコピーしました」「入れられませんでした：理由」）。
   *
   * @param {"fill"|"stats"|"hand"|"contests"|"approved"|"busy"|"error"|null} kind いまの画面でした（しようとした）こと。
   *        stats と hand は「まとめて渡す」（0.9.0）、approved は自分の作品として覚えたとき。
   *        busy は前の分がまだ終わっていないとき、error はすることが決まる前に思わぬ失敗をしたとき
   * @param {boolean} ok できたか
   * @param {string} message 本文（ここまでに作った文）
   * @returns {{title:string, message:string}}
   */
  function notificationFor(kind, ok, message) {
    let title;
    if (kind === "fill") {
      title = ok ? "貼り込みました" : "入れられませんでした";
    } else if (kind === "stats" || kind === "hand") {
      title = ok ? "読者の反応をまとめて渡しました" : "渡せませんでした";
    } else if (kind === "contests") {
      // 0.12.0。切っているときはコピーだけなので、「渡した」と言わない
      title = ok ? "公募の一覧を読みました" : "公募の一覧を読めませんでした";
    } else if (kind === "approved") {
      title = "ご自分の作品として覚えました";
    } else if (kind === "busy") {
      title = "まだ前の分を処理しています";
    } else if (kind === "error") {
      title = "思わぬ問題が起きました";
    } else {
      title = "この画面ではできることがありません";
    }
    return { title, message: String(message || "") };
  }

  /** クリップボードを読めなかったとき（0.8.0。以前はポップアップの中に直書きしていた）。 */
  const clipboardReadFailed = (detail) =>
    `クリップボードを読めませんでした（${detail}）。ブラウザの許可を確認してください。`;

  /** 前の処理がまだ終わっていないときに、もう一度押された（0.8.0）。 */
  const busy = "前に押した分を、まだ処理しています。終わってから、もう一度押してください。";

  /** 思わぬ失敗（0.8.0。以前はポップアップの中に直書きしていた）。 */
  const unexpected = (detail) => `思わぬ問題が起きました：${detail}`;

  const api = {
    APP_NAME,
    REPORT_MENU_TITLE,
    ACTION_LABELS,
    actionTitle,
    messageForNothingHere,
    notificationFor,
    clipboardReadFailed,
    busy,
    unexpected,
    SITE_LABELS,
    siteLabel,
    displayWorkId,
    workLabel,
    messageForEnvelope,
    messageForMatch,
    messageForFilled,
    messageForHanded,
    approveQuestion,
    APPROVE_BUTTONS,
    messageForApproved,
    messageForStashFailed,
    describeStashItem,
    messageForStatsRead,
    messageForPageState,
    STATS,
    CONTESTS,
    messageForContestsRead,
    messageForContestsHanded,
    describeField,
    confirmFill,
    PAGE,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHMessages = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
