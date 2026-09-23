# 審査欄に貼る文（プライバシーへの取り組み）

Chrome ウェブストアのデベロッパー ダッシュボード「プライバシーへの取り組み（Privacy practices）」の各欄へ貼る文です。
manifest.json（0.11.1）の権限・入るページの範囲を**1つ残らず**挙げてあります。権限を足した・減らした日は、ここも直してください
（`test/redLine.test.js` の「権限は最小のまま」が、manifest の権限の並びを見張っています）。

---

## 単一用途の説明（Single purpose）

```
小説の作者が、ご自分の作品の読者の反応（PV・ブックマーク・評価など）を投稿サイトの管理画面から記録して簡単に集計し、あわせて VS Code の拡張機能「統合小説執筆環境」とのあいだで原稿と読者の反応をクリップボードで受け渡すための拡張機能です。どの機能も「自分の作品を投稿サイトで管理する作業」を助けるためのもので、対象はカクヨム・アルファポリスの作品管理と話の作成画面、Narou.fun の作品ページに限られます。
```

---

## 権限ごとの理由（Permission justification）

manifest.json の `permissions` は7つです。

### clipboardRead

```
話の作成画面でツールバーのアイコン（または右クリックの項目）を押したときに、VS Code の拡張機能「統合小説執筆環境」がクリップボードへコピーした原稿（題と本文）を読み、その画面の題と本文の欄へ入れるために使います。読むのは押したときの1回だけで、読んだ原稿は保存も送信もしません。
```

根拠：`background.js` の `貼り込む`（`クリップボードに頼む({ type: "read" })`）、`offscreen.js` の `読む`

### clipboardWrite

```
記録したご自分の作品の読者の反応の数を、VS Code の拡張機能「統合小説執筆環境」へ渡すためにクリップボードへ置きます。この拡張は通信をしないので、手元の別のアプリへ渡す道はクリップボードだけです。置くのは、作者がアイコンや説明のページのボタンを押し、「統合小説執筆環境へ渡す」を入れているときだけです。
```

根拠：`background.js` の `束にして置く`・`もう一度渡す`（`type: "write"`）、どちらも `渡すか()` が偽なら置かない

### activeTab

```
ツールバーのアイコンや右クリックの項目を押したときに、そのタブのURLを見て、その画面でできること（貼り込み・読者の反応の記録・集計を開く）を決めるために使います。作品の取り違えを防ぐため、原稿の作品IDとURLの作品IDも照らし合わせます。tabs 権限は使わず、ほかのタブのURLは読みません。
```

根拠：`background.js` の `実行する`（`tab.url`）、`common/match.js` の `checkTarget`

### notifications

```
アイコンを押した結果（貼り込めた・記録した・渡した・できなかった理由）を Chrome のお知らせで伝えるために使います。この拡張はページの中に表示を差し込まず、ポップアップもないため、結果を伝える場所がお知らせだけです。また、どなたの作品でも開ける画面で「ご自分の作品ですか？」とお尋ねするボタン付きのお知らせにも使います。
```

根拠：`background.js` の `知らせる`・`訊く`（`chrome.notifications.create`、ボタンは `onButtonClicked`）

### contextMenus

```
アイコンを押す代わりに、ページの右クリックからも同じ操作（原稿を貼り込む・読者の反応をまとめて渡す・作品を覚える・集計を開く）を選べるようにするためと、ツールバーのアイコンの右クリックに「読者の反応の集計を見る」を出すために使います。ページの右クリックの項目は、この拡張が動くページにだけ出します。
```

根拠：`background.js` の `onInstalled`（`documentUrlPatterns` は manifest の matches、集計の項目は `contexts: ["action"]`）

### offscreen

```
クリップボードの読み書きのためだけに使います。Manifest V3 の service worker はクリップボードに触れないため、押したときだけ画面に出ない拡張のページ（offscreen.html）を開き、読み書きが終わったらすぐに閉じます。このページは投稿サイトのページには入りません。
```

根拠：`background.js` の `クリップボードに頼む`（`reasons: ["CLIPBOARD"]`、`finally` で `closeDocument`）

### storage

```
ご自分の作品として覚えた作品の、読者の反応の数（PV・ブックマーク・評価など）と、覚えた作品の一覧、設定を、この拡張の中の保存（chrome.storage.local）に残すために使います。集計（推移や率）はこの記録から計算します。保存はお使いのパソコンの中だけで、同期（chrome.storage.sync）は使わず、どこへも送りません。量には上限があり（記録は20作品・180日まで）、説明のページから消せます。
```

根拠：`background.js` の `helperState`・`readerHistory`・`helperSettings` の読み書き（保存に触れるのは `background.js` だけ。`test/redLine.test.js` が見張る）

---

## ホストの権限の理由（Host permission justification）

`host_permissions` は**書いていません**。ページへ入る範囲は `content_scripts` の `matches` だけで、ダッシュボードではこれがホストの権限として扱われます。7つあります。

```
この拡張がページの中で動くのは、次の画面だけです。それぞれの理由は次のとおりです。

・https://kakuyomu.jp/my/works/*
　カクヨムの作品管理の画面（ご本人しか開けない）から、ご自分の作品の読者の反応の数を読んで記録するためと、話の作成画面（/my/works/作品ID/episodes/new）で原稿を題と本文の欄へ入れるため。
・https://kakuyomu.jp/works/*/accesses
・https://kakuyomu.jp/works/*/accesses?*
　カクヨムのアクセス数の画面から、話ごとのPVを読むため。2ページ目以降（?page=2 など）もあるので2つ書いています。どなたの作品でも開ける画面なので、作者が「覚える」を選んだ作品だけを記録します。
・https://www.alphapolis.co.jp/manage/*
・https://www.alphapolis.co.jp/author/*
・https://www.alphapolis.co.jp/novel/*
　アルファポリスの話の作成画面で、原稿を題と本文の欄へ入れるため。作成画面の場所が1つに決まっていないため3つ書いていますが、欄を埋めるのは作成画面と判定できたページだけで、それ以外のページでは何も読まず何も書きません。アルファポリスでは読者の反応は読みません。
・https://db.narou.fun/works/*
　小説家になろうの分析サイト Narou.fun の作品のページから、ご自分の作品の読者の反応の数を読むため。どなたの作品でも開ける画面なので、作者が「覚える」を選んだ作品だけを記録します。

どのページでも、読むのは画面に出ている「ラベルと数の組」だけで、本文は読みません。ログイン画面（パスワード欄のあるページ）では動きません。投稿ボタンは押しません。
```

根拠：`manifest.json` の `content_scripts[0].matches`、`content/sites.js`（貼り込み先）、`content/statsSites.js`（読む画面。アルファポリスは `supported: false`）、`common/guard.js`（ログイン画面の検知）

---

## リモートコードの使用（Are you using remote code?）

答え：**いいえ（No, I am not using remote code）**

```
この拡張が実行する JavaScript は、すべて拡張のパッケージに入っているファイルです（background.js、offscreen.js、options.js、common/・content/ の各ファイル）。外部のスクリプト・モジュール・WebAssembly を読み込まず、eval や new Function のように文字列からコードを作って実行することもしません。拡張のページ（options.html・offscreen.html）が読み込むのも、パッケージ内のファイルだけです。
```

根拠：
- `options.html` は `options.css` と `options.js`、`offscreen.html` は `offscreen.js` だけを読み込む（外を指すのは Marketplace へのふつうのリンク1本で、スクリプトではない）
- `background.js` の `importScripts` はパッケージ内の `common/`・`content/` のファイルだけ
- `test/redLine.test.js` の「HTTPを発する呼び出しが1つも無い」「文字列からコードを作って実行するコードが1つも無い」「ページへコードを注入する仕組みを使っていない」

---

## データの利用（Data usage）

### どの種類のデータを扱うか（チェックの案）

Chrome ウェブストアの決まりでは、**送らずにパソコンの中だけで扱うデータも開示の対象**です。この拡張は通信しませんが、保存はするので、次のとおり答えます。

| 種類 | 案 | 理由（コードの根拠） |
|---|---|---|
| 個人を特定できる情報（Personally identifiable information） | **チェックしない** | 名前・住所・メールアドレス・電話番号・ID番号を読まない。保存するのはサイトの種類と作品ID（作品を指す番号で、人を指すものではない）と数だけ（`common/stash.js` の `rememberOwnWork`、`common/history.js` の記録の形） |
| 健康に関する情報（Health information） | チェックしない | 扱わない |
| 財務情報と支払い情報（Financial and payment information） | チェックしない | 扱わない |
| 認証情報（Authentication information） | チェックしない | パスワード欄のあるページでは降りる（`common/guard.js` の `isLoginLikePage`）。入力欄の値は読まない（`content/fill.js` の `collectInputDescriptors`・`content/read.js` の `入力欄の素性` が写すのは type と autocomplete と見えているかだけ）。Cookie に触れない（`test/redLine.test.js`） |
| 個人的なコミュニケーション（Personal communications） | チェックしない | コメント・レビューの文章は読まない。数だけ（`content/statsSites.js` の `metric`、長い文字は `MAX_LABEL_TEXT` で落とす） |
| 位置情報（Location） | チェックしない | 扱わない |
| ウェブ履歴（Web history） | **チェックしない**（下の「迷うところ」） | ページのURL・題・訪れた日時の一覧は保存しない。保存するのは覚えた作品の作品IDと、数を読んだ日時だけ（`common/stash.js` の `makeItem` は URL を入れず、ページ番号だけ） |
| ユーザーのアクティビティ（User activity） | チェックしない | クリック・キー入力・スクロールを記録しない。ページを見張らない（`test/redLine.test.js` の「ページを見張らない」） |
| ウェブサイトのコンテンツ（Website content） | **チェックする** | 管理画面・Narou.fun のページに出ている読者の反応の数（PV・ブックマーク・評価など）を読んで保存する（`content/read.js` の `readStats`、`background.js` の `記録に残す`）。話の作成画面では、クリップボードの原稿をページの欄へ入れる（保存しない） |

### 迷うところ（作者の判断）

- **ウェブ履歴**：保存している「作品ID＋数を読んだ日時」を、「どのページをいつ開いたか」と読む審査もありえます。
  より安全に倒すなら、これもチェックしてかまいません（チェックしても、下の3つの約束は同じく守れます）
- **個人を特定できる情報**：カクヨムの作品ID・なろうの Nコードは公開されている作品の番号で、たどれば作者の筆名に行き着きます。
  ただし保存するのは作者ご本人が「自分の作品」とした番号だけで、他人の情報ではありません。チェックしない案にしています

### 3つの約束（すべてチェックする）

- 承認されている用途以外で、ユーザーデータを第三者に販売または転送しない
  → 通信しないので、転送する道がない（`test/redLine.test.js` の「HTTPを発する呼び出しが1つも無い」）
- 拡張機能の単一用途と関係のない目的で、ユーザーデータを使用または転送しない
  → 保存した数は、説明のページの集計と、作者が押したときの統合小説執筆環境への受け渡しにだけ使う
- 信用度の判断や融資の目的で、ユーザーデータを使用または転送しない
  → 使わない

### プライバシーポリシーの URL

```
https://github.com/nonahisa/novel-ai-helper/blob/main/PRIVACY.md
```

（リポジトリ直下の `PRIVACY.md`。GitHub へ push したあとで、上の URL が開けることを確かめてから貼ってください）
