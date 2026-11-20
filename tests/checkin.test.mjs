import test from "node:test"
import assert from "node:assert/strict"
import { claimSignupCredits } from "../src/checkin.mjs"

/** 拦掉真实网络 */
function withStubFetch(handler, fn) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => handler(String(url), init)
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original
  })
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

test("领到了 → claimed + credit（契约六值之一）", async () => {
  await withStubFetch(
    () => json({ code: 0, data: { claimed: true, creditsAmount: 200 } }),
    async () => {
      const r = await claimSignupCredits("tok")
      assert.equal(r.outcome, "claimed")
      assert.equal(r.credit, 200)
    },
  )
})

test("上游说已经领过 → done", async () => {
  await withStubFetch(
    () => json({ code: 0, data: { message: "already claimed" } }),
    async () => {
      const r = await claimSignupCredits("tok")
      assert.equal(r.outcome, "done")
    },
  )
})

test("业务层报「已经领过」也认成 done，不当成登录过期", async () => {
  await withStubFetch(
    () => json({ code: -1, message: "signup credit already claimed" }),
    async () => {
      const r = await claimSignupCredits("tok")
      assert.equal(r.outcome, "done")
    },
  )
})

test("端点不存在 → inactive（不是 failed）", async () => {
  await withStubFetch(
    () => json({ message: "not found" }, 404),
    async () => {
      const r = await claimSignupCredits("tok")
      assert.equal(r.outcome, "inactive")
    },
  )
})

test("401 → failed，且不再往下试 day=2", async () => {
  let hits = 0
  await withStubFetch(
    () => {
      hits++
      return json({ error: { message: "invalid token" } }, 401)
    },
    async () => {
      const r = await claimSignupCredits("tok")
      assert.equal(r.outcome, "failed")
      assert.equal(hits, 1)
      assert.match(r.message, /登录已过期/)
    },
  )
})

test("没 token 时直接 failed，不打网络", async () => {
  let hits = 0
  await withStubFetch(
    () => {
      hits++
      return json({})
    },
    async () => {
      const r = await claimSignupCredits("")
      assert.equal(r.outcome, "failed")
      assert.equal(hits, 0)
    },
  )
})
