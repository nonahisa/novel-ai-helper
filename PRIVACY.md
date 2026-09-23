# プライバシーポリシー（統合小説執筆環境ヘルパー）

この文書は、Chrome 拡張機能「統合小説執筆環境ヘルパー」（以下「この拡張」）が扱う情報について説明します。

- 対象の版：0.12.0 以降
- 最終更新：2026-09-23

## まとめ

- この拡張は**通信を一切しません**。扱う情報を、開発者を含めどこへも送りません
- 保存するのは、ご自分の作品の読者の反応の**数**と、その集計に要る最小限の情報だけです。保存場所は、お使いのパソコンの Chrome の中の、この拡張専用の保存場所（`chrome.storage.local`）だけです
- 第三者に渡すこと・売ること・広告に使うことはありません

## 1. 扱う情報

### 保存するもの（`chrome.storage.local` だけ）

保存は次の3つの鍵に分かれています。

**`readerHistory`（集計のための記録）**

- 覚えた作品ごとの、サイトの種類（カクヨム・Narou.fun）と作品ID（カクヨムの作品IDの数字、なろうの Nコード）
- その作品の読者の反応の数：PV、ブックマーク（フォロワー）、星・評価ポイント、レビュー数、応援の数、応援コメントの数、評価者数、週間読者数
  - 作品全体の数を、読んだ日ごと（最大180日）に
  - サイトが出している日ごと・月ごとの数（日ごとは最大180日、月ごとは最大24か月）
  - 話ごとの数（話数と、いちばん新しい数だけ）と、各話の最終更新日時
- 数を読んだ日時
- 上限：20作品・180日・合計150万字。越えたら古いものから消えます

**`helperState`（覚えた作品と、統合小説執筆環境へ渡す分）**

- 覚えた作品：サイトの種類・作品ID・覚えた日時・覚えた理由（作品管理の画面を開けた／ご自分で「覚える」を選んだ）
- 「ご自分の作品ですか？」とお尋ねしている途中の作品：サイトの種類・作品ID・尋ねた日時
- 統合小説執筆環境へ渡す分（「統合小説執筆環境へ渡す」を入れているときだけ）：上と同じ種類の読者の反応の数に、画面の種類・ページ番号・溜めた日時を添えたもの。上限は50画面・200万字
- 渡した分の控え：次に渡すまで、長くても7日

**`helperSettings`（設定）**

- 「統合小説執筆環境へ渡す」の入・切と、それをどう決めたか（入れたとき・更新したとき・ご自分で切り替えたとき など）

### 保存しないもの

- **本文・題・あらすじ・コメントの文章は保存しません。** 管理画面・Narou.fun で読むのは、画面に出ている「ラベルと数の組」だけです
- **公募の一覧は保存しません。** 公募の一覧のページ（下の「動くページ」）で読んだ公募の文は、クリップボードへ置くだけで、この拡張の中には残しません
- **ページのURLは保存しません。** 画面の種類とページ番号だけを取り出して使います
- **ほかの方の作品の数は保存しません。** どなたの作品でも開ける画面（Narou.fun・カクヨムのアクセス数）では、「覚える」を選んだ作品だけを記録します
- お名前・メールアドレス・パスワード・Cookie・ログインの情報には触れません。ログイン画面（パスワード欄のあるページ）では、この拡張は動きません
- 閲覧履歴は集めません。この拡張が入るのは、下の「動くページ」に挙げた画面だけです

### その場で使って、保存しないもの

- **クリップボード**
  - 話の作成画面でアイコンを押したとき、統合小説執筆環境がコピーした原稿（題と本文）を読み、その画面の欄へ入れます。読んだ原稿は保存しません
  - 「統合小説執筆環境へ渡す」を入れているときに読者の反応をまとめて渡すと、保存していた数をクリップボードへ置きます
  - 公募の一覧のページでアイコンを押したとき（0.12.0）、並んでいる公募（名前・締切・賞典・字数・主催・募集作品・応募資格などの、誰でも見られる募集の情報と、公式サイトへのリンク）を読んで、クリップボードへ置きます。開いただけでは読みません
- **いま開いているタブのURL**：アイコンや右クリックの項目を押したとき、その画面でできることを決めるために見ます。保存しません（公募の一覧をクリップボードへ置くときは、どのページから読んだかを添えます）

## 2. 動くページ

この拡張がページの中で動くのは、次の画面だけです。

- カクヨム：`https://kakuyomu.jp/my/works/*`（作品管理・話の作成画面）、`https://kakuyomu.jp/works/*/accesses`（アクセス数）
- アルファポリス：`https://www.alphapolis.co.jp/manage/*`・`/author/*`・`/novel/*`（話の作成画面での貼り込みのため。読者の反応は読みません）
- Narou.fun：`https://db.narou.fun/works/*`（作品のページ）
- 公募の一覧（0.12.0。応募先を選ぶため。誰でも見られるページです）：
  ノベルポータルの `https://creative-story.net/bungakusyou/`（文学賞・公募一覧）と `https://creative-story.net/202111contest/`（投稿サイトのコンテスト一覧）、
  ツクリテミライの `https://tsukuritemirai.com/kobo/novel/`（小説の公募一覧。ページ送りの `?page=2` なども）

## 3. 外へ送らないこと

- この拡張には、インターネットへ何かを送るプログラムがありません（`fetch`・`XMLHttpRequest`・`WebSocket` などを使っていません。公開しているソースのテスト `test/redLine.test.js` が毎回確かめています）
- 外のプログラムや字体を読み込みません
- Google アカウントを通じた同期の保存（`chrome.storage.sync`）は使いません
- 統合小説執筆環境（VS Code）を呼ぶときは、お手元の VS Code を `vscode://` のリンクで前に出すだけです。リンクにデータは載せません
- 説明のページには、統合小説執筆環境の Visual Studio Marketplace のページへのリンクが1本あります。押したときだけブラウザが開くふつうのリンクで、データは載せません

## 4. 第三者への提供

扱う情報を第三者へ渡すこと・売ること・広告や信用の評価に使うことはありません。開発者にも届きません。

## 5. 消し方

- **集計の記録**：説明のページの「集計の記録を消す」で全部消えます
- **作品ごと**：説明のページの「ご自分の作品として覚えた作品」から行を消して保存すると、その作品は以後記録せず、その作品の記録も消えます
- **統合小説執筆環境へ渡す分**：説明のページの「溜まりを空にする」で消えます
- **すべて**：`chrome://extensions` でこの拡張を削除すると、Chrome が保存していたものをすべて消します

説明のページは、ツールバーのアイコンを右クリックして「読者の反応の集計を見る」を選ぶと開きます。

## 6. クリップボードについての注意

Windows の「クリップボードの履歴」「デバイス間の同期」を有効にしていると、コピーしたもの（原稿や読者の反応の数）が
Microsoft のクラウドを経由することがあります。これはこの拡張ではなく Windows の機能です。

## 7. 変更

この文書を変えるときは、このページを更新し、上の「最終更新」の日付を改めます。

## 8. お問い合わせ

GitHub の Issues へお寄せください。
https://github.com/nonahisa/novel-ai-helper/issues

---

## Summary in English

- This extension makes **no network requests** and sends no data to the developer or anyone else.
- It stores only **numeric reader statistics** (page views, bookmarks, ratings, etc.) of works the user has marked as their own, plus the settings needed to show a simple summary. Everything is kept in `chrome.storage.local` on the user's device.
- It does not store manuscript text, page URLs, names, email addresses, passwords, cookies, or browsing history. It does not run on login pages.
- The clipboard is used only when the user clicks the extension: to read a manuscript copied by the companion VS Code extension and put it into the posting form, (optionally) to hand the stored statistics to that VS Code extension, and to hand the list of writing contests shown on three public contest-listing pages to that VS Code extension. Clipboard contents and contest lists are not stored.
- Data is never sold or transferred to third parties.
- Users can delete the data from the extension's options page, or by removing the extension.
- Contact: https://github.com/nonahisa/novel-ai-helper/issues
