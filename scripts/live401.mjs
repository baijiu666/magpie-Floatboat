import { FloatboatPlugin } from "../index.mjs"
const plugin = await FloatboatPlugin({}, {})
const auth = { access: "fake-access-token", refresh: "", uid: "u1", accountId: "t", metadata: { newapiKey: "sk-fake-key" } }
const loader = await plugin.auth.loader(async () => auth, {})
const t0 = Date.now()
const res = await loader.fetch("https://newapi.aoe.chat/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify({ model: "gemini-4-argon", messages: [{ role: "user", content: "hi" }], max_tokens: 8 }),
})
const text = await res.text()
console.log(JSON.stringify({ status: res.status, ms: Date.now() - t0, body: text.slice(0, 240) }, null, 1))
