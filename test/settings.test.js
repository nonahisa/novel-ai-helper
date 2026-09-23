import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ルート = join(dirname(fileURLToPath(import.meta.url)), "..");
const 読む = (名) => readFileSync(join(ルート, 名), "utf8");
const Stash = require("../common/stash.js");
const Settings = require("../common/settings.js");

/**
 * 「統合小説執筆環境へ渡す」の切り替え（0.11.0。作者の裁定、2026-09-23）。
 *
 * 新しく入れた方は切った状態で始め、既に使っている方（更新で入った・渡していた形跡がある）は
 * 入ったままにする。ここは、その決め方（保存に触れない素の関数）を確かめる。
 */

const 空 = Stash.normalizeState(null);
const 覚えた作品あり = Stash.normalizeState({ items: [], ownWorks: [{ siteId: "kakuyomu", workId: "1" }] });
const 溜まりあり = Stash.normalizeState({ items: [{ key: "k", storedAt: "x", envelope: {} }] });
const 控えあり = Stash.normalizeState({ items: [], handed: { handedAt: "x", items: [{ key: "k", storedAt: "x", envelope: {} }] } });
const 訊きかけあり = Stash.normalizeState({ items: [], pending: { siteId: "narouFun", workId: "n1234ab" } });

describe("保存から読んだ設定の形", () => {
  it("形の合うものだけを設定として読む（壊れていれば無いものとして扱う）", () => {
    expect(Settings.normalizeSettings({ handToIde: true, decidedBy: "update" })).toEqual({ handToIde: true, decidedBy: "update" });
    expect(Settings.normalizeSettings({ handToIde: false, decidedBy: "author" })).toEqual({ handToIde: false, decidedBy: "author" });
    expect(Settings.normalizeSettings({ handToIde: "yes" })).toBe(null);
    expect(Settings.normalizeSettings(null)).toBe(null);
    expect(Settings.normalizeSettings(undefined)).toBe(null);
    // 決めた理由が分からないものは「形跡から推した」扱い（入れたとき・更新したときに決め直せる）
    expect(Settings.normalizeSettings({ handToIde: true })).toEqual({ handToIde: true, decidedBy: "traces" });
  });
});

describe("統合小説執筆環境へ渡していた形跡", () => {
  it("溜まり・渡した分の控え・覚えた作品・訊きかけの作品のどれかがあれば、形跡あり", () => {
    expect(Settings.hasHandTraces(空)).toBe(false);
    expect(Settings.hasHandTraces(覚えた作品あり)).toBe(true);
    expect(Settings.hasHandTraces(溜まりあり)).toBe(true);
    expect(Settings.hasHandTraces(控えあり)).toBe(true);
    expect(Settings.hasHandTraces(訊きかけあり)).toBe(true);
  });
});

describe("入れたとき・更新したときの決め方", () => {
  it("新しく入れた方は、切った状態で始まる", () => {
    expect(Settings.settingsOnInstalled(null, "install", 空)).toEqual({ handToIde: false, decidedBy: "install" });
  });

  it("更新で入った方は、入ったまま（形跡が無くても）", () => {
    expect(Settings.settingsOnInstalled(null, "update", 空)).toEqual({ handToIde: true, decidedBy: "update" });
    expect(Settings.settingsOnInstalled(null, "update", 覚えた作品あり)).toEqual({ handToIde: true, decidedBy: "update" });
  });

  it("作者が決めた・入れたときに決めた設定は、更新しても変えない", () => {
    expect(Settings.settingsOnInstalled({ handToIde: false, decidedBy: "author" }, "update", 覚えた作品あり)).toBe(null);
    expect(Settings.settingsOnInstalled({ handToIde: true, decidedBy: "author" }, "install", 空)).toBe(null);
    // 新しく入れた方が、あとで新しい版へ更新しても、切ったまま
    expect(Settings.settingsOnInstalled({ handToIde: false, decidedBy: "install" }, "update", 覚えた作品あり)).toBe(null);
    expect(Settings.settingsOnInstalled({ handToIde: true, decidedBy: "update" }, "update", 空)).toBe(null);
  });

  it("形跡から推しただけの設定は、入れたとき・更新したときの理由で決め直す", () => {
    expect(Settings.settingsOnInstalled({ handToIde: false, decidedBy: "traces" }, "update", 空)).toEqual({
      handToIde: true,
      decidedBy: "update",
    });
  });

  it("Chrome の更新など、この拡張を入れた・更新したのではないときは、設定が無ければ形跡で決める", () => {
    expect(Settings.settingsOnInstalled(null, "chrome_update", 空)).toEqual({ handToIde: false, decidedBy: "traces" });
    expect(Settings.settingsOnInstalled(null, "chrome_update", 溜まりあり)).toEqual({ handToIde: true, decidedBy: "traces" });
    expect(Settings.settingsOnInstalled({ handToIde: true, decidedBy: "traces" }, "chrome_update", 空)).toBe(null);
  });

  it("設定が保存に無いときは、形跡で推す（形跡があれば入れておく）", () => {
    expect(Settings.settingsWhenMissing(空)).toEqual({ handToIde: false, decidedBy: "traces" });
    expect(Settings.settingsWhenMissing(覚えた作品あり)).toEqual({ handToIde: true, decidedBy: "traces" });
    expect(Settings.settingsWhenMissing(控えあり)).toEqual({ handToIde: true, decidedBy: "traces" });
  });

  it("作者が切り替えた設定", () => {
    expect(Settings.settingsByAuthor(true)).toEqual({ handToIde: true, decidedBy: "author" });
    expect(Settings.settingsByAuthor(false)).toEqual({ handToIde: false, decidedBy: "author" });
  });
});

describe("説明のページの切り替え", () => {
  it("options.html に切り替えのチェックと、短い説明がある", () => {
    const html = 読む("options.html");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*id="hand-to-ide"|<input[^>]*id="hand-to-ide"[^>]*type="checkbox"/);
    expect(html).toContain("統合小説執筆環境へ渡す");
    expect(html).toContain("統合小説執筆環境（VS Code の拡張機能）をお使いの方は入れてください");
  });

  it("options.js は切り替えを裏方へ頼む（保存には触れない）", () => {
    const js = 読む("options.js");
    expect(js).toContain('type: "options-set-hand-to-ide"');
    expect(js).not.toMatch(/chrome\s*\.\s*storage/);
  });

  it("裏方は、設定の決め方を common/settings.js から読む（写しを作らない）", () => {
    const js = 読む("background.js");
    expect(js).toMatch(/importScripts\([\s\S]*?"common\/settings\.js"[\s\S]*?\)/);
    expect(js).toContain("Settings.settingsOnInstalled(");
  });
});
