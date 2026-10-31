"use strict";

/**
 * テストの偽のDOM（`querySelectorAll`・`textContent`・`getAttribute` だけを持つ最小の構造）。
 *
 * test/readEnvelope.test.js の中にある偽のDOMと同じ作り（0.16.0 から、新しいテストはここを読む）。
 * jsdom を入れていないので、読み取り係（content/read.js）は**この3つしか使わない作り**にしてある。
 * 子孫の選択子（`dl dd`）・兄弟（nextElementSibling）・文字の節は持たない——読み取り係も
 * それらに頼らず、単純な選択子で辿る。
 *
 * 受ける照合は `=`・`^=`・`*=`・クラスの指定（`.名前`）と、カンマの並びだけ。
 * **知らない書き方は当たらない扱いにする**——黙って当てると、表の書き間違いをテストが見逃す。
 */

function 合う(el, 単純) {
  const m = /^((?:[a-zA-Z][a-zA-Z0-9]*)?)((?:\.[\w-]+|\[[^\]]*\]|#[\w-]+)*)$/.exec(単純.trim());
  if (!m || 単純.trim() === "") {
    return false;
  }
  if (m[1] && el.tagName !== m[1].toLowerCase()) {
    return false;
  }
  for (const 条件 of m[2].match(/\.[\w-]+|\[[^\]]*\]|#[\w-]+/g) || []) {
    if (条件.startsWith(".")) {
      const クラス = String(el.getAttribute("class") || "").split(/\s+/);
      if (!クラス.includes(条件.slice(1))) {
        return false;
      }
      continue;
    }
    if (条件.startsWith("#")) {
      if (el.getAttribute("id") !== 条件.slice(1)) {
        return false;
      }
      continue;
    }
    const c = /^\[([\w-]+)(?:([\^*]?=)"([^"]*)")?\]$/.exec(条件);
    if (!c) {
      return false;
    }
    const 値 = el.getAttribute(c[1]);
    if (値 === null) {
      return false;
    }
    if (c[2] === "=" && 値 !== c[3]) return false;
    if (c[2] === "^=" && !値.startsWith(c[3])) return false;
    if (c[2] === "*=" && !値.includes(c[3])) return false;
  }
  return true;
}

/**
 * 要素を作る。
 * @param {string} tag 小文字のタグ名
 * @param {object} attrs 属性
 * @param {string|Array} 中身 文字か、子要素の配列（textContent は子を空白で繋ぐ）
 */
function 要素(tag, attrs, 中身) {
  const 子 = Array.isArray(中身) ? 中身 : [];
  const a = attrs || {};
  const el = {
    tagName: tag,
    attrs: a,
    children: 子,
    type: a.type,
    // input の value・select の選ばれた値（実物の DOM と同じ名前で読めるように）
    get value() {
      if (tag === "select") {
        const 選ばれた = 子.find((c) => c.tagName === "option" && c.getAttribute("selected") !== null);
        return 選ばれた ? 選ばれた.getAttribute("value") || "" : "";
      }
      return Object.prototype.hasOwnProperty.call(a, "value") ? String(a.value) : "";
    },
    get textContent() {
      return Array.isArray(中身) ? 子.map((c) => c.textContent).join(" ") : String(中身 || "");
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    getClientRects() {
      return [{}];
    },
    querySelectorAll(selector) {
      const 結果 = [];
      const 潜る = (親) => {
        for (const c of 親.children) {
          if (selector.split(",").some((単純) => 合う(c, 単純))) {
            結果.push(c);
          }
          潜る(c);
        }
      };
      潜る(el);
      return 結果;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
  };
  return el;
}

/** ページ（root）を作る。title はページの題（document.title）。 */
function 偽ページ(子たち, title) {
  const p = 要素("html", {}, 子たち);
  if (typeof title === "string") p.title = title;
  return p;
}

module.exports = { 要素, 偽ページ, 合う };
