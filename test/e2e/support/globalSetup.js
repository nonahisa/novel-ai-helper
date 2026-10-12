/**
 * 画面の自動テストの走りの最初と最後に、一時のプロフィール（nph-e2e-*）の残りを消す。
 * 1件ごとの片づけ（withHelper の finally）は、時間切れや途中で止めたときに届かないことがある。
 */
import { sweepProfiles } from "./helperBrowser.js";

export async function setup() {
  await sweepProfiles();
}

export async function teardown() {
  await sweepProfiles();
}
