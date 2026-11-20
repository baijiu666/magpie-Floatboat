// tests/contract.test.mjs —— 逐条钉住 magpie 宿主契约（0.1.4445 提取的源码为准）
import test from "node:test"
import assert from "node:assert/strict"
import { FloatboatPlugin } from "../index.mjs"

const METHODS = ["config", "auth", "provider"]

test("八个钩子里只暴露契约里有的，chat.headers 故意不实现", async () => {
  const p = await FloatboatPlugin({}, {})
  for (const k of METHODS) assert.ok(p[k], `缺 ${k}`)
  assert.equal("chat.headers" in p, false, "没有头要加，声明了宿主每请求白跑一次 infoOf")
  assert.equal(typeof p.auth.refresh, "function")
  assert.equal(typeof p.auth.loader, "function")
  assert.equal(typeof p.auth.usage, "function")
  assert.equal(typeof p.auth.checkin, "function")
  assert.equal(typeof p.provider.models, "function")
  assert.equal(p.provider.id, "floatboat")
})

test("config 钩子：用户已有自己的 provider 条目时也要补齐，不能直接 return", async () => {
  const p = await FloatboatPlugin({}, {})

  // 宿主跑 config 前会把这个槽位换成用户自己的那份（可能只有 name）
  const cfg = { provider: { floatboat: { name: "我自己起的名字" } } }
  await p.config(cfg)
  const got = cfg.provider.floatboat
  assert.equal(got.name, "我自己起的名字", "用户的 name 优先")
  assert.equal(got.npm, "@ai-sdk/openai-compatible")
  assert.equal(got.api, "https://newapi.aoe.chat/v1")
  assert.ok(Object.keys(got.models).length >= 13, "模型表必须被补齐")
  assert.equal(got.searches, false)

  // 用户自己的模型覆盖 + disabled 可以关掉某条
  const cfg2 = {
    provider: {
      floatboat: { models: { lite: { name: "我的 Lite", disabled: true } } },
    },
  }
  await p.config(cfg2)
  assert.equal(cfg2.provider.floatboat.models.lite.name, "我的 Lite")
  assert.equal(cfg2.provider.floatboat.models.lite.disabled, true)
  assert.ok(cfg2.provider.floatboat.models["gpt-6.2-sol"], "其它模型不能被用户那一条冲掉")

  // 空 config 也要能建起来
  const cfg3 = {}
  await p.config(cfg3)
  assert.ok(cfg3.provider.floatboat.models)
})

test("auth.methods：oauth 不带 placeholder，api 带；都带 i18n labels", async () => {
  const p = await FloatboatPlugin({}, {})
  const ms = p.auth.methods
  assert.ok(Array.isArray(ms), "methods 必须是静态数组（宿主 .map 它）")
  assert.deepEqual(
    ms.map((m) => m.type),
    ["oauth", "oauth", "api"],
  )
  for (const m of ms) {
    assert.equal(typeof m.label, "string")
    assert.ok(m.labels?.en, `${m.label} 缺英文标签`)
  }
  // oauth 必须有 authorize 自己完成流程；api 类型可以不实现（宿主直接收输入框里的 key）
  for (const m of ms.filter((x) => x.type === "oauth")) {
    assert.equal(typeof m.authorize, "function", `${m.label} 缺 authorize`)
  }
  for (const m of ms.filter((x) => x.type === "oauth")) assert.equal(m.placeholder, undefined)
  assert.equal(typeof ms[2].placeholder, "string")
})

test("粘贴回调那条：method = code，callback 认 code/state", async () => {
  const p = await FloatboatPlugin({}, {})
  const a = await p.auth.methods[1].authorize()
  assert.equal(a.method, "code")
  assert.equal(a.opened, true)
  const bad = await a.callback("这不是链接")
  assert.equal(bad.type, "failed")
})

test("checkin 钩子：返回值里不能漏内部字段（raw），outcome 必须是契约六值之一", async () => {
  const p = await FloatboatPlugin({}, {})
  const r = await p.auth.checkin(async () => ({ access: "" }), "floatboat")
  assert.equal(r.outcome, "failed")
  assert.equal("raw" in r, false)
  const ok = new Set(["claimed", "done", "ineligible", "inactive", "captcha", "failed"])
  assert.ok(ok.has(r.outcome))
})

test("usage：未登录时给 error + signIn，不抛栈", async () => {
  const p = await FloatboatPlugin({}, {})
  const u = await p.auth.usage(async () => ({}), "floatboat", {})
  assert.match(u.error, /未登录/)
  assert.deepEqual(u.windows, [])
})

test("provider.models 拿到的是 Model 形状，且条数与静态表一致", async () => {
  const p = await FloatboatPlugin({}, {})
  const table = await p.provider.models({ id: "floatboat" }, { auth: {} })
  assert.ok(Object.keys(table).length >= 13)
  for (const [id, m] of Object.entries(table)) {
    assert.equal(m.id, id)
    assert.equal(typeof m.capabilities.input.image, "boolean")
    assert.ok(m.api?.npm)
  }
})
