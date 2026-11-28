import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const IssueReport = require("../common/issueReport.js");
const PressLog = require("../common/pressLog.js");

const 名を残す = ["kakuyomu.jp", "www.alphapolis.co.jp", "alphapolis.co.jp", "syosetu.com", "db.narou.fun"];
const いま = new Date(2026, 10, 28, 10, 0, 0);

/** 目印：どれも記録に出てはいけない（作品の番号・Nコード・ユーザー名・タグの名・問い合わせ・題） */
const 出ない = ["1177354054934574437", "16816927859000000000", "n1234ab", "N1234AB", "secretuser", "maboroshi", "token=", "星の落ちる夜", "123456789"];

function 押しの記録() {
  let 記録 = PressLog.normalizeLog(undefined);
  const 押し = [
    { url: "https://kakuyomu.jp/my/works/1177354054934574437/episodes/new", did: "fill", result: "stopped", reason: "match-work-mismatch" },
    { url: "https://kakuyomu.jp/users/secretuser/works?token=abc", did: "nothing", result: "stopped", reason: "nothing-here" },
    { url: "https://kakuyomu.jp/tags/maboroshi", did: "nothing", result: "stopped", reason: "nothing-here" },
    { url: "https://db.narou.fun/novels/n1234ab", did: "stats", result: "done" },
    { url: "https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789", did: "fill", result: "waiting", id: "abcd1234" },
    { url: "https://example.com/private/page", did: "nothing", result: "stopped", reason: "nothing-here" },
  ];
  押し.forEach((p, i) => {
    記録 = PressLog.addPress(記録, p, 名を残す, new Date(いま.getTime() - (押し.length - i) * 60000));
  });
  return 記録;
}

function 入力(上書き = {}) {
  return Object.assign(
    {
      now: いま,
      reportId: "NAI-20261128-ab12",
      version: "1.1.0",
      install: "store",
      browser: "Google Chrome 131",
      os: "Windows",
      handToIde: true,
      ownWorks: [
        { label: "カクヨム", count: 2 },
        { label: "アルファポリス", count: 1 },
      ],
      stashCount: 3,
      autoRead: [
        { label: "カクヨムの作品管理", choice: "auto" },
        { label: "カクヨムのアクセス数", choice: "manual" },
        { label: "ノベルアップ＋のランキング", choice: "undecided" },
      ],
      pressLog: 押しの記録(),
      labels: { did: PressLog.DID_LABELS, result: PressLog.RESULT_LABELS, reason: PressLog.REASON_LABELS },
      toLocal: (iso) => iso.slice(0, 16).replace("T", " "),
    },
    上書き
  );
}

/** 欄の中身（見出しの下から、次の見出しの手前まで。空行は除く） */
function 欄(要約, 見出し) {
  const 行 = 要約.split("\n");
  const 始め = 行.indexOf(見出し);
  let 終わり = 行.findIndex((l, n) => n > 始め && /^##\s/.test(l));
  if (終わり < 0) 終わり = 行.length;
  return 行.slice(始め + 1, 終わり).filter((l) => l !== "");
}

describe("障害報告用の記録の形（記録の形 1。統合と同じ見出し・同じ並び）", () => {
  it("報告ID は NAI-YYYYMMDD-xxxx。ファイル名は報告ID.md", () => {
    const id = IssueReport.makeReportId(いま, (a) => a.fill(1));
    expect(id).toBe("NAI-20261128-bbbb");
    expect(IssueReport.REPORT_ID_PATTERN.test(IssueReport.makeReportId(いま))).toBe(true);
    expect(IssueReport.fileNameFor(id)).toBe("NAI-20261128-bbbb.md");
  });

  it("見出し5つが統合と1字も違わず、この順に並ぶ。# 要約 と # 詳細 で前後に分かれる", () => {
    const r = IssueReport.buildIssueReport(入力());
    const 見出し = r.document.split("\n").filter((l) => /^##\s/.test(l));
    expect(見出し).toEqual(["## 環境", "## 何をしたら（再現手順）", "## 期待した動き", "## 実際の動き", "## 記録（任意）"]);
    const 行 = r.document.split("\n");
    expect(行.indexOf("# 要約")).toBeLessThan(行.indexOf("## 環境"));
    expect(行.indexOf("## 記録（任意）")).toBeLessThan(行.indexOf("# 詳細"));
  });

  it("環境の欄は、報告ID → 記録の形 1 → 製品: 投稿ヘルパー → ヘルパーの行の順", () => {
    const r = IssueReport.buildIssueReport(入力());
    expect(欄(r.summary, "## 環境")).toEqual([
      "報告ID: NAI-20261128-ab12",
      "記録の形 1",
      "製品: 投稿ヘルパー",
      "ヘルパー: 1.1.0",
      "入れ方: Chrome ウェブストア",
      "ブラウザ: Google Chrome 131",
      "OS: Windows",
      "統合小説執筆環境へ渡す: 入",
      "覚えた作品: カクヨム 2・アルファポリス 1",
      "溜まり: 3件",
      "開いたときの自動取得: 自動 1種類・押したときだけ 1種類・まだ決めていない 1種類",
    ]);
  });

  it("作者が書く3つの欄は、案内の一文（「（ここに、」で始まり「）」で終わる1行）だけ", () => {
    const r = IssueReport.buildIssueReport(入力());
    for (const 見出し of ["## 何をしたら（再現手順）", "## 期待した動き", "## 実際の動き"]) {
      const 中 = 欄(r.summary, 見出し);
      expect(中).toHaveLength(1);
      expect(中[0].startsWith("（ここに、") && 中[0].endsWith("）")).toBe(true);
    }
  });

  it("読めなかったものは 0 と書かず、行ごと省く", () => {
    const r = IssueReport.buildIssueReport(
      入力({ browser: undefined, os: undefined, handToIde: undefined, ownWorks: undefined, stashCount: undefined, autoRead: undefined, install: undefined })
    );
    expect(欄(r.summary, "## 環境")).toEqual(["報告ID: NAI-20261128-ab12", "記録の形 1", "製品: 投稿ヘルパー", "ヘルパー: 1.1.0"]);
  });

  it("記録（任意）には、押したときの記録を新しい順に、日本語の名前で並べる（札は詳細だけ）", () => {
    const r = IssueReport.buildIssueReport(入力());
    const 中 = 欄(r.summary, "## 記録（任意）");
    expect(中[0]).toBe("報告ID NAI-20261128-ab12 の記録ファイル（NAI-20261128-ab12.md）を添付");
    expect(中[1]).toBe("押したときの記録: 6件（新しい順）・止めた 4件");
    expect(中[2]).toContain("ほかのサイト");
    expect(中.at(-1)).toContain("kakuyomu.jp/my/works/#/episodes/new");
    expect(中.at(-1)).toContain("止めた（別の作品の原稿）");
    expect(r.summary).not.toContain("match-work-mismatch");
    expect(r.document).toContain("match-work-mismatch");
  });

  it("字数はボットとの約束の中（環境1000字・記録4000字・ファイル1MB）", () => {
    const r = IssueReport.buildIssueReport(入力());
    expect(欄(r.summary, "## 環境").join("\n").length).toBeLessThanOrEqual(1000);
    expect(欄(r.summary, "## 記録（任意）").join("\n").length).toBeLessThanOrEqual(4000);
    expect(new TextEncoder().encode(r.document).byteLength).toBeLessThan(1000000);
  });

  it("報告ID の形が違えば作らない", () => {
    expect(() => IssueReport.buildIssueReport(入力({ reportId: "RIT-20261128-ab12" }))).toThrow();
  });
});

describe("伏せ方（作品の番号・名前・URL を入れない）", () => {
  it("作品の番号・Nコード・ユーザー名・タグの名・問い合わせ・題は、どこにも出ない", () => {
    const r = IssueReport.buildIssueReport(入力());
    for (const 目印 of 出ない) {
      expect(r.document, 目印).not.toContain(目印);
    }
    expect(r.document).toContain("kakuyomu.jp/users/〈語〉/works");
    expect(r.document).toContain("kakuyomu.jp/tags/〈語〉");
    expect(r.maskedWords).toBe(2);
    expect(r.document).toContain("2か所 → 〈語〉");
  });

  it("http(s):// の URL は1つも入らない（アドレスは形だけ）", () => {
    const r = IssueReport.buildIssueReport(入力());
    expect(r.document).not.toMatch(/https?:\/\//);
  });

  it("決まった語と # だけの形はそのまま、ほかの語は〈語〉にする", () => {
    expect(IssueReport.maskShape("/my/works/#/episodes/new")).toEqual({ shape: "/my/works/#/episodes/new", masked: 0 });
    expect(IssueReport.maskShape("/novels/N#")).toEqual({ shape: "/novels/N#", masked: 0 });
    expect(IssueReport.maskShape("/users/someone/news")).toEqual({ shape: "/users/〈語〉/〈語〉", masked: 2 });
  });

  it("この拡張が扱う画面のアドレスの形は、1か所も伏せない（表と伏せ方がずれたら止める）", () => {
    const 画面 = [
      "https://kakuyomu.jp/my/works/1177354054934574437",
      "https://kakuyomu.jp/my/works/1177354054934574437/episodes/new",
      "https://kakuyomu.jp/my/works/1177354054934574437/episodes/1177354054934574499",
      "https://kakuyomu.jp/works/1177354054934574437/accesses",
      "https://kakuyomu.jp/rankings/fantasy/weekly",
      "https://kakuyomu.jp/rankings/all/daily",
      "https://www.alphapolis.co.jp/mypage/content",
      "https://www.alphapolis.co.jp/mypage/content/detail/123456789",
      "https://www.alphapolis.co.jp/mypage/novel/save/123456789",
      "https://www.alphapolis.co.jp/mypage/novel/save_episode/123456789/987654321",
      "https://www.alphapolis.co.jp/novel/ranking/hot",
      "https://db.narou.fun/novels/n1234ab",
      "https://syosetu.com/usernovelmanage/top/ncode/1234567/",
      "https://syosetu.com/usernoveldatamanage/updateinput/ncode/1234567/noveldataid/7654321/",
      "https://yomou.syosetu.com/rank/genrelist/type/weekly_101/",
      "https://creative-story.net/bungakusyou/",
      "https://creative-story.net/202111contest/",
      "https://tsukuritemirai.com/kobo/novel/",
    ];
    const 名 = [...名を残す, "yomou.syosetu.com", "creative-story.net", "tsukuritemirai.com"];
    for (const url of 画面) {
      const { shape } = PressLog.shapeOf(url, 名);
      expect(IssueReport.maskShape(shape).masked, `${url} → ${shape}`).toBe(0);
    }
  });

  it("users・tags の次の部分は、決まった語と同じ字でも必ず伏せる（ユーザー名が novel や top の人）", () => {
    expect(IssueReport.maskShape("/users/novel/works")).toEqual({ shape: "/users/〈語〉/works", masked: 1 });
    expect(IssueReport.maskShape("/tags/top")).toEqual({ shape: "/tags/〈語〉", masked: 1 });
    // ランキングの次の語でも、字でないもの（日本語・大文字の混ざった名）は伏せる
    expect(IssueReport.maskShape("/rankings/山田/weekly").masked).toBe(1);
  });

  it("ブラウザと OS は決まった名前だけを書く（知らない名前は書かない）", () => {
    expect(
      IssueReport.browserFromUAData({ brands: [{ brand: "Not=A?Brand", version: "99" }, { brand: "Google Chrome", version: "131" }], platform: "Windows" })
    ).toEqual({ browser: "Google Chrome 131", os: "Windows" });
    expect(IssueReport.browserFromUAData({ brands: [{ brand: "Microsoft Edge", version: "131" }, { brand: "Chromium", version: "131" }], platform: "macOS" }).browser).toBe(
      "Microsoft Edge 131"
    );
    expect(IssueReport.browserFromUAData({ brands: [{ brand: "誰かのブラウザ", version: "1" }], platform: "なにか" })).toEqual({ browser: undefined, os: undefined });
    expect(IssueReport.browserFromUAData(undefined)).toEqual({ browser: undefined, os: undefined });
  });
});

/*
  ボットが添付を読み分ける形の写し（novel-ai-community-bot の src/features/bugReportFile.ts、2026-11-28）。
  **写しはこのテストの中だけに置く。** 製品が満たすべき約束：# 要約 の中の見出しで5欄に分かれ、
  環境に「記録の形 1」と「製品: 投稿ヘルパー」があり、作者の欄は案内の一文のままなら空とみなされる
*/
function ボットが読む(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const summaryStart = lines.findIndex((l) => l.trim() === "# 要約");
  let end = lines.findIndex((l, n) => n > summaryStart && l.trim() === "# 詳細");
  if (end < 0) end = lines.length;
  const body = lines.slice(summaryStart < 0 ? 0 : summaryStart + 1, end);
  const 名 = { environment: "環境", steps: "何をしたら（再現手順）", expected: "期待した動き", actual: "実際の動き", record: "記録（任意）" };
  const headingOf = new Map(Object.entries(名).map(([f, l]) => [`## ${l}`, f]));
  const raw = new Map();
  let current = null;
  for (const line of body) {
    const t = line.trim();
    const field = headingOf.get(t);
    if (field) {
      if (raw.has(field)) return null;
      current = field;
      raw.set(field, []);
      continue;
    }
    if (t === "---" || /^#{1,2}\s/.test(t)) {
      current = null;
      continue;
    }
    if (current) raw.get(current).push(line);
  }
  if (raw.size !== 5) return null;
  const env = raw.get("environment");
  const format = env.map((l) => /^記録の形\s*(\d+)\s*$/.exec(l.trim())).find((m) => m);
  const product = env.map((l) => /^製品:\s*(.+?)\s*$/.exec(l.trim())).find((m) => m);
  const unfilled = ["steps", "expected", "actual"].filter((f) => raw.get(f).every((l) => l.trim() === "" || /^（ここに、.*）$/.test(l.trim())));
  const id = env.map((l) => /^報告ID:\s*((?:NAI|RIT)-\d{8}-[a-z0-9]{4})\s*$/.exec(l.trim())).find((m) => m);
  return { format: format ? Number(format[1]) : null, product: product ? product[1] : null, unfilled, reportId: id ? id[1] : null, record: raw.get("record").join("\n").trim() };
}

/*
  ボットが「原稿の疑い」で差し戻す規則の写し（novel-ai-community-bot の src/core/manuscript.ts、2026-11-28 に読んだもの）。
  写しはこのテストの中だけに置く。数字が変わったら、ここを向こうに合わせて直し、製品が当たらないかを見る
*/
const BOT_JA = /[぀-ヿ㐀-鿿豈-﫿々ー]/u;
const BOT_END = /[。！？!?」』…]$/u;
const BOT_DIALOGUE = /^[「『][^\n]*[」』]$/u;
const BOT_RUBY = /[|｜][^《\n]{1,20}《[^》\n]{1,20}》|[㐀-鿿]《[぀-ゟ゠-ヿ]{1,20}》/u;
const 詰める = (l) => l.replace(/[\s　]/g, "");
const 割合 = (t) => ([...t].length === 0 ? 0 : [...t].filter((c) => BOT_JA.test(c)).length / [...t].length);
function ボットの疑い(text) {
  if (BOT_RUBY.test(text)) return "ruby";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const s = 詰める(line);
    if ([...s].length > 200 && 割合(s) >= 0.6 && /[。、]/u.test(s)) return `long: ${line}`;
  }
  let d = 0;
  for (const line of lines) {
    if (BOT_DIALOGUE.test(詰める(line))) d++;
    if (d >= 2) return "dialogue";
  }
  let n = 0;
  let c = 0;
  for (const line of lines) {
    const s = 詰める(line);
    if (s.length === 0) continue;
    if (割合(s) >= 0.6 && BOT_END.test(s)) {
      n++;
      c += [...s].length;
      if (n >= 7 && c >= 150) return `prose: ${line}`;
    } else {
      n = 0;
      c = 0;
    }
  }
  return null;
}

describe("Discord のボットとの約束（写しで確かめる）", () => {
  it("ボットは、記録の形 1・製品: 投稿ヘルパー・報告ID を読み、作者の3欄を「まだ書いていない」とみなす", () => {
    const r = IssueReport.buildIssueReport(入力());
    const 読んだ = ボットが読む(r.document);
    expect(読んだ).not.toBeNull();
    expect(読んだ.format).toBe(1);
    expect(読んだ.product).toBe("投稿ヘルパー");
    expect(読んだ.reportId).toBe("NAI-20261128-ab12");
    expect(読んだ.unfilled).toEqual(["steps", "expected", "actual"]);
    expect(読んだ.record).toContain("押したときの記録");
    // 要約だけを写したもの（［要約をコピー］）も同じに読める
    expect(ボットが読む(r.summary).product).toBe("投稿ヘルパー");
  });

  it("写しの規則は、原稿らしい文を実際に拾う（写しが壊れていないことの確かめ）", () => {
    expect(ボットの疑い("|漢字《かんじ》")).toBe("ruby");
    expect(ボットの疑い("「おはよう」\n「こんにちは」")).toBe("dialogue");
    expect(ボットの疑い(Array.from({ length: 8 }, () => "彼女は坂道を上っていった。風が強い日だった。").join("\n"))).toMatch(/^prose/);
  });

  it("書き出したファイルと要約は、原稿の疑いに当たらない（記録が10件のときも、なにも無いときも）", () => {
    let 記録 = PressLog.normalizeLog(undefined);
    const 理由 = Object.keys(PressLog.REASON_LABELS);
    for (let i = 0; i < PressLog.PRESS_LOG_MAX; i += 1) {
      記録 = PressLog.addPress(
        記録,
        { url: `https://kakuyomu.jp/my/works/${i}/episodes/new`, did: "fill", result: "stopped", reason: 理由[i % 理由.length] },
        名を残す,
        いま
      );
    }
    for (const 入 of [入力({ pressLog: 記録 }), 入力({ pressLog: { entries: [] } })]) {
      const r = IssueReport.buildIssueReport(入);
      expect(ボットの疑い(r.document)).toBeNull();
      expect(ボットの疑い(r.summary)).toBeNull();
    }
  });
});
