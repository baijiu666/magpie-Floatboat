// scripts/smoke.mjs —— 不联网的自检：装配、模型表、loader 路由
import { FloatboatPlugin } from "../index.mjs"

const plugin = await FloatboatPlugin({}, {})

const cfg = {}
await plugin.config(cfg)
const provider = cfg.provider?.floatboat
if (!provider) throw new Error("config 钩子没有写出 provider")
const modelCount = Object.keys(provider.models || {}).length
if (modelCount < 10) throw new Error(`模型表太小：${modelCount}`)

const auth = {
  access: "fake-access-token",
  refresh: "fake-refresh-token",
  uid: "u1",
  accountId: "tester",
  metadata: { newapiKey: "sk-fake" },
}

const loader = await plugin.auth.loader(async () => auth, {})
if (!loader.fetch) throw new Error("loader 没有返回 fetch")

const modelsRes = await loader.fetch("https://newapi.aoe.chat/v1/models", { method: "GET" })
const modelsBody = await modelsRes.json()
if (modelsRes.status !== 200 || !Array.isArray(modelsBody.data)) throw new Error("GET /models 失败")

const notImpl = await loader.fetch("https://newapi.aoe.chat/v1/embeddings", { method: "POST", body: "{}" })
if (notImpl.status !== 501) throw new Error(`未实现端点应返回 501，实际 ${notImpl.status}`)

const badJson = await loader.fetch("https://newapi.aoe.chat/v1/chat/completions", {
  method: "POST",
  body: "{not json",
})
if (badJson.status !== 400) throw new Error(`坏 JSON 应返回 400，实际 ${badJson.status}`)

const pinned = await plugin.provider.models({}, { auth })
if (Object.keys(pinned).length !== modelCount) throw new Error("provider.models 与静态表不一致")

console.log(JSON.stringify({ ok: true, models: modelCount, providerName: provider.name, plan: "smoke" }))
