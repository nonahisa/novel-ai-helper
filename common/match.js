"use strict";

/**
 * 貼り込み先の照合（設計書6.79.6-2）。
 *
 * 作者は複数の作品・複数のタブを開いている。**別の作品の投稿画面に貼り込む事故**を
 * 防ぐのがこの層の仕事で、次の3つを順に確かめる。
 *   1. 封筒の site と、いま開いているページのドメインが一致するか
 *   2. そのページが「話の作成画面」か（作品の閲覧ページや管理トップでは動かさない）
 *   3. 封筒に workId があれば、ページURLの作品IDと一致するか
 *
 * どれか1つでも合わなければ**埋めずに理由を返す**。「たぶん合っている」で埋めない。
 * サイトの表は引数で受け取る（content/sites.js が唯一の表。ここへ写さない）。
 */
(function (global) {
  /**
   * ドメインの一致。完全一致か、その下位ドメインのみを認める。
   * 単なる部分一致にすると "evilkakuyomu.jp" のような別サイトを通してしまう。
   */
  function hostMatches(host, allowedHosts) {
    const lower = String(host).toLowerCase();
    return allowedHosts.some((h) => {
      const allowed = h.toLowerCase();
      return lower === allowed || lower.endsWith("." + allowed);
    });
  }

  /** ホスト名から、表の中のサイトを決める。合うものが無ければ null。 */
  function siteForHost(host, sites) {
    return sites.find((s) => hostMatches(host, s.hosts)) || null;
  }

  /** パスが「話の作成画面」の形かどうか。 */
  function isPostPage(pathname, site) {
    return site.postPagePatterns.some((re) => re.test(pathname));
  }

  /** パスから作品IDを取り出す。取れなければ null。 */
  function extractWorkId(pathname, site) {
    for (const re of site.workIdPatterns) {
      const m = re.exec(pathname);
      if (m && m[1]) {
        return m[1];
      }
    }
    return null;
  }

  function fail(reason, extra) {
    return Object.assign({ ok: false, reason }, extra || {});
  }

  /**
   * 封筒と、いま開いているページのURLを突き合わせる。
   *
   * @param {{site:string, workId?:string}} envelope 検証済みの封筒
   * @param {string} url いま開いているタブのURL
   * @param {Array} sites content/sites.js の SITES
   */
  function checkTarget(envelope, url, sites) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (_e) {
      // chrome:// や about:blank、URLを取れないタブがここに来る。
      return fail("bad-url");
    }

    const site = siteForHost(parsed.hostname, sites);
    if (!site || site.id !== envelope.site) {
      return fail("site-mismatch", { expectedSite: envelope.site, actualHost: parsed.hostname });
    }

    if (!site.supported) {
      // 表に枠だけある（なろう）サイト。規約の判断が済むまで貼り込まない。
      return fail("unsupported-site", { expectedSite: envelope.site });
    }

    if (!isPostPage(parsed.pathname, site)) {
      return fail("not-post-page", { expectedSite: envelope.site });
    }

    if (envelope.workId !== undefined) {
      const actualWorkId = extractWorkId(parsed.pathname, site);
      if (actualWorkId === null) {
        // 作品IDが読めないと取り違えを防げない。防げないなら貼り込まない。
        return fail("work-id-not-found", { expectedSite: envelope.site });
      }
      if (actualWorkId !== envelope.workId) {
        return fail("work-mismatch", {
          expectedSite: envelope.site,
          expectedWorkId: envelope.workId,
          actualWorkId,
        });
      }
      return { ok: true, siteId: site.id, workId: actualWorkId };
    }

    return { ok: true, siteId: site.id, workId: extractWorkId(parsed.pathname, site) };
  }

  const api = { hostMatches, siteForHost, isPostPage, extractWorkId, checkTarget };

  if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = api;
  }
  global.NPHMatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
