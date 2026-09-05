import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isLoginLikePage, isSafeTarget } = require("../common/guard.js");

describe("ログイン画面の検知", () => {
  it("見えているパスワード欄があれば、ログイン画面とみなす", () => {
    const 欄 = [
      { type: "text", autocomplete: "username", visible: true },
      { type: "password", autocomplete: "current-password", visible: true },
    ];
    expect(isLoginLikePage(欄)).toBe(true);
  });

  it("type を text にして自前で伏せ字にしている画面も捕まえる", () => {
    const 欄 = [{ type: "text", autocomplete: "new-password", visible: true }];
    expect(isLoginLikePage(欄)).toBe(true);
  });

  it("投稿画面（パスワード欄なし）では動いてよい", () => {
    const 欄 = [
      { type: "text", autocomplete: "", visible: true },
      { type: "checkbox", autocomplete: "", visible: true },
    ];
    expect(isLoginLikePage(欄)).toBe(false);
  });

  it("隠しのパスワード欄（自動入力よけ）では止めない", () => {
    // 投稿画面に隠しパスワード欄を置くサイトがあり、これで止めると機能が死ぬ。
    // 本物のログイン画面のパスワード欄は必ず見えているので、取り逃さない。
    const 欄 = [{ type: "password", autocomplete: "", visible: false }];
    expect(isLoginLikePage(欄)).toBe(false);
  });

  it("欄の情報が取れないときは「触らない」側に倒す", () => {
    expect(isLoginLikePage(null)).toBe(true);
    expect(isLoginLikePage(undefined)).toBe(true);
  });

  it("欄が1つも無いページでは、ログイン画面とはみなさない", () => {
    expect(isLoginLikePage([])).toBe(false);
  });
});

describe("書き込んでよい欄かの最後の関門", () => {
  it("普通のテキスト欄には書いてよい", () => {
    expect(isSafeTarget({ type: "textarea" })).toBe(true);
    expect(isSafeTarget({ type: "text" })).toBe(true);
  });

  it("パスワード欄には何があっても書かない", () => {
    expect(isSafeTarget({ type: "password" })).toBe(false);
    expect(isSafeTarget({ type: "text", autocomplete: "current-password" })).toBe(false);
  });

  it("隠し欄・読み取り専用・使用不可の欄には書かない", () => {
    expect(isSafeTarget({ type: "hidden" })).toBe(false);
    expect(isSafeTarget({ type: "text", readOnly: true })).toBe(false);
    expect(isSafeTarget({ type: "text", disabled: true })).toBe(false);
  });

  it("欄が無ければ書かない", () => {
    expect(isSafeTarget(null)).toBe(false);
  });
});
