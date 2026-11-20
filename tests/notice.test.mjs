// tests/notice.test.mjs —— 上游公告的剥离
import { test } from "node:test"
import assert from "node:assert/strict"

import { stripNotice, stripNoticeFromJson, rewriteResponse } from "../src/notice.mjs"

const TIP_EN = [
  "### 💡 Tip: Your current client version will soon stop receiving maintenance.",
  "",
  "To avoid disruptions to your service, please visit https://floatboat.ai/download to upgrade.",
].join("\n")

const TIP_ZH = [
  "### 💡 提示：您当前的客户端版本即将停止维护。",
  "",
  "请使用浏览器访问官网 https://floatboat.ai/download 下载并升级至最新版。",
].join("\n")

test("剥掉英文公告尾巴，正文不动", () => {
  assert.equal(stripNotice("PONG\n\n" + TIP_EN), "PONG")
})

test("剥掉中文公告尾巴", () => {
  assert.equal(stripNotice("答案正文\n\n" + TIP_ZH), "答案正文")
})

test("正文里同形标题后还有别的小标题时不动", () => {
  const text = "### 💡 Tip: 这不是尾巴\n\n### 正经标题\n正文"
  assert.equal(stripNotice(text), text)
})

test("没有公告时原样返回", () => {
  assert.equal(stripNotice("PONG"), "PONG")
  assert.equal(stripNotice(""), "")
})

test("非流式 JSON：OpenAI 形状被改写", () => {
  const raw = JSON.stringify({
    choices: [{ message: { role: "assistant", content: "PONG\n\n" + TIP_EN } }],
  })
  const out = JSON.parse(stripNoticeFromJson(raw))
  assert.equal(out.choices[0].message.content, "PONG")
})

test("非流式 JSON：没有公告时不改字节", () => {
  const raw = JSON.stringify({ choices: [{ message: { content: "PONG" } }] })
  assert.equal(stripNoticeFromJson(raw), raw)
})

test("非 JSON 原样返回", () => {
  assert.equal(stripNoticeFromJson("not json"), "not json")
})

function sseResponse(frames) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

function chunk(text) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`
}

test("流式：公告跨多个 chunk 也能剥掉", async () => {
  const full = "PONG\n\n" + TIP_EN
  const frames = []
  for (let i = 0; i < full.length; i += 40) frames.push(chunk(full.slice(i, i + 40)))
  frames.push("data: [DONE]\n\n")

  const out = await rewriteResponse(sseResponse(frames), { enabled: true })
  const text = await out.text()
  assert.ok(!text.includes("maintenance"), "公告应被剥掉")
  assert.ok(text.includes("PONG"), "正文应保留")
})

test("流式：开关关闭时原样透传", async () => {
  const full = "PONG\n\n" + TIP_EN
  const res = sseResponse([chunk(full), "data: [DONE]\n\n"])
  const out = await rewriteResponse(res, { enabled: false })
  const text = await out.text()
  assert.ok(text.includes("maintenance"))
})
