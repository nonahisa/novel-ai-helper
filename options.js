"use strict";

/**
 * 説明のページ（options.html）。することは、見出しの脇へ版を入れることだけ。
 *
 * 版は **manifest から読む**（作者の依頼、2026-09-22。0.7.x ではポップアップがしていた）
 * ——ここへ書き写すと、版を上げた日に画面だけが古い版を言い続ける。
 */
(function () {
  const versionSlot = document.getElementById("version");
  if (versionSlot && chrome.runtime && chrome.runtime.getManifest) {
    const 版 = chrome.runtime.getManifest().version;
    if (版) versionSlot.textContent = "v" + 版;
  }
})();
