import test from "node:test"
import assert from "node:assert/strict"
import { FloatboatPlugin } from "../index.mjs"

/** 拦掉真实网络：把 globalThis.fetch 换成一个记录器 */
function withStubFetch(handler, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original
  })
}

const sseResponse = () =>
  new Response('data: {"id":"x","choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })

test("聊天请求被改写成上游 id，并带上 sk- key", async () => {
  const plugin = await FloatboatPlugin({}, {})
  const auth = { access: "tok", uid: "u", accountId: "t", metadata: { newapiKey: "sk-abc" } }
  const loader = await plugin.auth.loader(async () => auth, {})

  await withStubFetch(
    () => sseResponse(),
    async (calls) => {
      const res = await loader.fetch("https://newapi.aoe.chat/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "hi" }], stream: true }),
      })
      assert.equal(res.status, 200)
      // SSE 必须原样透传
      assert.match(await res.text(), /data: \[DONE\]/)

      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, "https://newapi.aoe.chat/v1/chat/completions")
      assert.equal(calls[0].init.headers.get("authorization"), "Bearer sk-abc")
      const sent = JSON.parse(calls[0].init.body)
      assert.equal(sent.model, "deepseek-v4.1-flash")
      assert.equal(sent.stream, true)
    },
  )
})

test("网关 401 时会重取 key 并重试一次，仍失败则回 401 + sign-in 头", async () => {
  const plugin = await FloatboatPlugin({}, {})
  const auth = { access: "tok", uid: "u-retry", accountId: "t", metadata: { newapiKey: "sk-stale" } }
  const loader = await plugin.auth.loader(async () => auth, {})

  let gatewayHits = 0
  await withStubFetch(
    (url) => {
      if (url.includes("newapi.aoe.chat")) {
        gatewayHits++
        return new Response(JSON.stringify({ error: { message: "Authentication failed." } }), { status: 401 })
      }
      // floatboat 取 key 的接口
      if (url.includes("/api/desktop/newapi/key")) {
        return new Response(JSON.stringify({ api_key: "sk-fresh" }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    },
    async (calls) => {
      const res = await loader.fetch("https://newapi.aoe.chat/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "lite", messages: [] }),
      })
      assert.equal(res.status, 401)
      assert.equal(res.headers.get("x-magpie-sign-in"), "expired")
      // 第一次用旧 key，第二次用重取到的新 key
      assert.equal(gatewayHits, 2)
      const authz = calls.filter((c) => c.url.includes("newapi.aoe.chat")).map((c) => c.init.headers.get("authorization"))
      assert.deepEqual(authz, ["Bearer sk-stale", "Bearer sk-fresh"])
    },
  )
})

test("baseURL 被宿主重复拼 /v1 也能收敛", async () => {
  const plugin = await FloatboatPlugin({}, {})
  const auth = { access: "tok", uid: "u2", metadata: { newapiKey: "sk-x" } }
  const loader = await plugin.auth.loader(async () => auth, {})
  await withStubFetch(
    () => sseResponse(),
    async (calls) => {
      const res = await loader.fetch("https://newapi.aoe.chat/v1/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "lite", messages: [] }),
      })
      assert.equal(res.status, 200)
      assert.equal(calls[0].url, "https://newapi.aoe.chat/v1/chat/completions")
    },
  )
})
