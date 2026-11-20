// src/notice.mjs —— 剥掉上游在回复结尾追加的「客户端即将停止维护」提示
//
// 上游在每条回复的末尾固定追加一段 365 字节左右的公告（中英双语），
// 内容与客户端版本无关：实测 UA 取 Floatboat/0.6.7、0.7.0、0.8.0、1.0.0
// 都一样出现。它不影响调用，但会混进模型的回答里，所以做成可关的开关。
//
// 判据：以 `### 💡 Tip:` / `### 💡 提示：` 开头的整块，直到下一个 `### ` 标题或结尾。

const MARKERS = ["### 💡 Tip:", "### 💡 提示：", "### 💡 提示:"]

/** 是否是公告块的起始行 */
function isMarker(line) {
  const t = String(line).trimStart()
  return MARKERS.some((m) => t.startsWith(m))
}

/** 是否是另一个 markdown 标题（公告块到此结束） */
function isHeading(line) {
  return /^#{1,6}\s/u.test(String(line).trimStart())
}

/**
 * 剥掉文本末尾的公告块。只处理「结尾」的那些，正文中间的同形内容不动。
 * @param {string} text
 * @returns {string}
 */
export function stripNotice(text) {
  if (typeof text !== "string" || !text) return text
  const lines = text.split("\n")
  let cut = lines.length
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isMarker(lines[i])) {
      // 从这块起始行到结尾，若中间出现别的标题，说明不是尾巴上的公告
      let ok = true
      for (let j = i + 1; j < lines.length; j += 1) {
        if (isHeading(lines[j])) { ok = false; break }
      }
      if (ok) cut = i
      break
    }
  }
  if (cut === lines.length) return text
  return lines.slice(0, cut).join("\n").replace(/\s+$/u, "")
}

/**
 * 改写非流式 JSON 响应体。认 OpenAI 与 Anthropic 两种形状。
 * @param {string} raw
 * @returns {string} 可能原样返回
 */
export function stripNoticeFromJson(raw) {
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    return raw
  }
  let touched = false
  const strip = (value) => {
    const next = stripNotice(value)
    if (next !== value) touched = true
    return next
  }
  if (Array.isArray(json?.choices)) {
    for (const choice of json.choices) {
      if (typeof choice?.message?.content === "string") {
        choice.message.content = strip(choice.message.content)
      }
      if (typeof choice?.delta?.content === "string") {
        choice.delta.content = strip(choice.delta.content)
      }
    }
  }
  if (Array.isArray(json?.content)) {
    for (const block of json.content) {
      if (block && typeof block.text === "string") block.text = strip(block.text)
    }
  } else if (typeof json?.content === "string") {
    json.content = strip(json.content)
  }
  return touched ? JSON.stringify(json) : raw
}

/** 流式改写时最多滞留的字符数：公告块约 365 字节，512 足够覆盖 */
const HOLD = 512

function frameOf(payload) {
  return `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`
}

/** 把一段文本塞回一条 chunk 的 delta.content 里，保持其它字段不变 */
function withContent(template, text) {
  const chunk = structuredClone(template)
  chunk.choices[0].delta = { ...chunk.choices[0].delta, content: text }
  delete chunk.usage
  return chunk
}

/**
 * 改写一个可能流式的响应。enabled=false 时原样返回。
 * 流式只处理 OpenAI 形状（choices[0].delta.content）—— 本插件只转发 /chat/completions。
 * @param {Response} res
 * @param {{ enabled?: boolean }} [opts]
 * @returns {Promise<Response>}
 */
export async function rewriteResponse(res, { enabled = true } = {}) {
  if (!enabled || !res || !res.body) return res
  const type = String(res.headers.get("content-type") ?? "").toLowerCase()

  if (type.includes("application/json")) {
    const raw = await res.text()
    const next = stripNoticeFromJson(raw)
    if (next === raw) return new Response(raw, { status: res.status, headers: res.headers })
    return new Response(next, { status: res.status, headers: res.headers })
  }

  if (!type.includes("text/event-stream")) return res

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const reader = res.body.getReader()
  let sse = ""
  let pending = ""
  let template = null
  let done = false
  const queue = []

  const emit = (text) => {
    if (!text) return
    queue.push(encoder.encode(frameOf(withContent(template, text))))
  }

  const feed = (text) => {
    pending += text
    while (pending.length > HOLD) {
      const cut = pending.length - HOLD
      emit(pending.slice(0, cut))
      pending = pending.slice(cut)
    }
  }

  const handleFrame = (frame) => {
    const lines = frame.split("\n")
    const dataLines = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    if (!dataLines.length) {
      queue.push(encoder.encode(frame + "\n\n"))
      return
    }
    const payload = dataLines.join("\n")
    if (payload === "[DONE]") {
      done = true
      return
    }
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      queue.push(encoder.encode(frame + "\n\n"))
      return
    }
    const delta = json?.choices?.[0]?.delta
    const text = typeof delta?.content === "string" ? delta.content : ""
    if (text && template === null) template = json
    if (template === null) template = json
    // 非文本块（tool_call / role / finish_reason）先放行
    if (!text) {
      queue.push(encoder.encode(frame + "\n\n"))
      return
    }
    feed(text)
  }

  const stream = new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (queue.length) {
          controller.enqueue(queue.shift())
          return
        }
        if (done) {
          const rest = stripNotice(pending)
          pending = ""
          if (rest && template) controller.enqueue(encoder.encode(frameOf(withContent(template, rest))))
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
          return
        }
        const { value, done: finished } = await reader.read()
        if (finished) {
          done = true
          continue
        }
        sse += decoder.decode(value, { stream: true })
        let idx = sse.indexOf("\n\n")
        while (idx !== -1) {
          const frame = sse.slice(0, idx)
          sse = sse.slice(idx + 2)
          handleFrame(frame)
          idx = sse.indexOf("\n\n")
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })

  const headers = new Headers(res.headers)
  headers.delete("content-length")
  return new Response(stream, { status: res.status, headers })
}
