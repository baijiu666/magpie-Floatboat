import test from "node:test"
import assert from "node:assert/strict"
import { ensureNewApiKey, invalidateKey, keyFromAuth } from "../src/gateway.mjs"

test("优先用 auth.metadata 里登录时抓到的 key", async () => {
  const key = await ensureNewApiKey({ uid: "u-meta", access: "tok", metadata: { newapiKey: "sk-from-login" } })
  assert.equal(key, "sk-from-login")
  assert.equal(keyFromAuth({ metadata: { newapiKey: "sk-x" } }), "sk-x")
  assert.equal(keyFromAuth({}), "")
})

test("没有 token 时给出 401 而不是静默失败", async () => {
  invalidateKey("u-none")
  await assert.rejects(() => ensureNewApiKey({ uid: "u-none", metadata: {} }), (e) => e.status === 401)
})
