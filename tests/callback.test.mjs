import test from "node:test"
import assert from "node:assert/strict"
import { parseCallback } from "../src/browser-login.mjs"

test("识别 aoe:// 回调", () => {
  const r = parseCallback("aoe://auth/callback?code=abc&state=st1")
  assert.deepEqual({ code: r.code, state: r.state }, { code: "abc", state: "st1" })
})

test("识别 https 回调（网页先跳自己域名的情况）", () => {
  const r = parseCallback("https://floatboat.ai/desktop-sign-in/done?code=C%2B1&state=s")
  assert.equal(r.code, "C+1")
  assert.equal(r.state, "s")
})

test("裸 code 也能用", () => {
  const r = parseCallback("  raw-code-123  ")
  assert.equal(r.code, "raw-code-123")
  assert.equal(r.state, "")
})

test("没有 code 的内容返回 null，不瞎猜", () => {
  assert.equal(parseCallback("https://floatboat.ai/desktop-sign-in?state=x"), null)
  assert.equal(parseCallback(""), null)
  assert.equal(parseCallback(null), null)
})
