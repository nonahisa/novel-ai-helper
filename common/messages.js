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
      case "bad-title":
      case "bad-body":
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
  };

  function messageForFilled(filled, skipped) {
    const done = filled.length > 0 ? `${filled.join("と")}を入れました。` : "入れた欄はありません。";
    const skip = skipped.length > 0 ? `（${skipped.join("と")}は入れていません）` : "";
    // 6.79.2-2：送信は必ず作者の手であることを、成功時に毎回伝える。
    return `${done}${skip}内容を確かめてから、投稿ボタンはご自分で押してください。`;
  }

  function confirmOverwrite(fieldLabel) {
    return `${fieldLabel}に、すでに文が入っています。\n貼り込み係の内容で上書きしますか？\n\n［キャンセル］を選ぶと、何もしません。`;
  }

  const api = {
    SITE_LABELS,
    siteLabel,
    messageForEnvelope,
    messageForMatch,
    messageForFilled,
    confirmOverwrite,
    PAGE,
  };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHMessages = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
