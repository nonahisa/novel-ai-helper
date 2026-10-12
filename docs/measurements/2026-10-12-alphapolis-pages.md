# アルファポリスの管理画面の形（2026-10-12、作者の Chrome で読んだ）

作者がログインした Chrome で、統合小説執筆環境の母艦（Claude）が画面の字と要素の名前だけを読んだ。押す・書く操作はしていない。作品は「転生受験生の教科書チート生活」の1つ。

## 作品IDの形

- 作品のページ：`/novel/{作者ID}/{作品ID}`（例 `/novel/972593502/637622366`）
- 作品の管理画面：`/mypage/content/detail/{作品ID}`（作品IDだけ）
- 新しい話を書く画面：`/mypage/novel/save_episode/{作品ID}`
- 話の編集：`/mypage/novel/save_episode/{作品ID}/{話ID}`
- 章の設定：`/mypage/content/manage_chapter/{作品ID}`

作品IDは数字だけ（9桁）。作者IDとは別。

## 作品管理の一覧（`/mypage/content`）

作品ごとの枠（`div.main`）に次が並ぶ。

| 中身 | 要素 | 例 |
|---|---|---|
| 題と作品のページ | `div.info h2.title a` | 転生受験生の教科書チート生活 … |
| ハートの数 | `div.favorite div.heart span.icon-heart` | 23 |
| お気に入り数 | 字の上では「お気に入り数：265」（要素は未確認） | 265 |
| 公開文字数・非公開文字数 | `div.text-count div.published span.value`／`div.draft span.value` | 627,545／0 |
| 累計ポイントと順位 | `div.manage div.notes`（1つ目） | 累計 249,728 pt (17,639位) |
| 24時間のポイントと順位 | `div.manage div.notes`（2つ目） | 24h. 7 pt (40,259位) |
| 管理画面へ | `div.manage a.button`（字「管理画面」） | |

## 作品の管理画面（`/mypage/content/detail/{作品ID}`）

- 章の見出し：`div.chapter`（字「第一章『死の谷』」）
- 話の行：`div.content`
  - 題：`div.title h3`（**全文で出る。カクヨムのように「…」で切れていない**）。例「１話　転生」
  - しおり：`span.bookmark span.count`
  - 3つの数：`p.yell-count` の中の `span.icon-emendation`・`span.icon-heart`・`span.icon-yell`（アイコンの名前からそれぞれ誤字報告・いいね・エールと読める。字は「0回 |」「10回 |」「0 回 |」）
  - 文字数（字「3,697文字」）
- 話ごとの閲覧数（PV）はこの画面に無い

## まだ見ていないもの

- 話ごとの閲覧数を出す画面があるか（アクセス解析の類）
- ハートの数とお気に入り数が何を数えているか（一覧のハート 23 とお気に入り数 265）
- 作品が2つ以上あるときの一覧の並び
