import test from "node:test"
import assert from "node:assert/strict"
import { allModelIds, findModel, modelSupportsVision, resolveModelId, staticModelTable } from "../src/models.mjs"

const MODALITIES = ["text", "image", "audio", "video", "pdf"]

test("目录里的模型都能拿到条目，且五个模态键都是布尔", () => {
  const table = staticModelTable()
  const ids = allModelIds()
  assert.ok(ids.length >= 13)
  for (const id of ids) {
    const m = table[id]
    assert.ok(m, `缺模型 ${id}`)
    assert.equal(m.status, "active")
    assert.equal(typeof m.capabilities.toolcall, "boolean")
    for (const k of MODALITIES) {
      assert.equal(typeof m.capabilities.input[k], "boolean", `${id}.capabilities.input.${k} 必须是布尔`)
      assert.equal(typeof m.capabilities.output[k], "boolean", `${id}.capabilities.output.${k} 必须是布尔`)
    }
    assert.ok(m.limit.context > 0)
  }
})

test("config 钩子那条路径读的顶层平字段都在（写进 capabilities 里宿主不读）", () => {
  for (const [id, m] of Object.entries(staticModelTable())) {
    assert.equal(typeof m.reasoning, "boolean", `${id}.reasoning 要在顶层`)
    assert.equal(typeof m.attachment, "boolean", `${id}.attachment 要在顶层`)
    assert.equal(typeof m.tool_call, "boolean", `${id}.tool_call 是 config 路径的拼写`)
    assert.ok(Array.isArray(m.modalities?.input), `${id}.modalities.input 要在顶层`)
    assert.ok(Array.isArray(m.modalities?.output))
    // 顶层 attachment 与 capabilities.attachment 必须是同一个事实
    assert.equal(m.attachment, m.capabilities.attachment)
    assert.equal(m.reasoning, m.capabilities.reasoning)
  }
})

test("provider.models 那条路径要的是 Model 形状：api / capabilities / rate", () => {
  for (const [id, m] of Object.entries(staticModelTable())) {
    assert.equal(m.api?.id, id, `${id}.api.id 应等于上游 id`)
    assert.match(String(m.api?.npm), /^@ai-sdk\//, `${id}.api.npm 要写清`)
    assert.equal(typeof m.capabilities.temperature, "boolean")
    assert.equal(typeof m.capabilities.interleaved, "boolean")
    assert.equal(typeof m.rate, "number", `${id}.rate 是实测倍率`)
    assert.ok(m.cost && typeof m.cost.cache?.read === "number")
  }
  // 倍率是实测值，抽查两条钉住（别凭想象改）
  const t = staticModelTable()
  assert.equal(t["lite"].rate, 0.1)
  assert.equal(t["gpt-6-astra"].rate, 4)
})

test("识图模型：modalities 与 capabilities 两边都说 yes", () => {
  const t = staticModelTable()
  assert.deepEqual(t["gemini-4-neon"].modalities.input, ["text", "image"])
  assert.equal(t["gemini-4-neon"].capabilities.input.image, true)
  assert.equal(t["deepseek-v4-pro"].capabilities.input.image, false)
  assert.deepEqual(t["deepseek-v4-pro"].modalities.input, ["text"])
})

test("别名收敛到上游 id", () => {
  assert.equal(resolveModelId("deepseek-flash"), "deepseek-v4.1-flash")
  assert.equal(resolveModelId("auto"), "lite")
  assert.equal(resolveModelId("Gemini-4-Argon"), "Gemini-4-Argon") // 只在查表时大小写不敏感
  assert.equal(findModel("GEMINI-4-ARGON")?.id, "gemini-4-argon")
  assert.equal(resolveModelId(undefined), "lite")
})

test("识图能力按家族给", () => {
  assert.equal(modelSupportsVision("gemini-4-neon"), true)
  assert.equal(modelSupportsVision("claude-sonnet-5.5"), true)
  assert.equal(modelSupportsVision("deepseek-v4-pro"), false)
  assert.equal(modelSupportsVision("lite"), false)
})
