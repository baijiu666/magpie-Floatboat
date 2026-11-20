// 确认受控浏览器能正常打开真实登录页（不登录，只看标题/地址/是否登录态）
import { spawn, execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:net"
import { findBrowser } from "../src/browser-login.mjs"
import { buildSignInUrl, newState } from "../src/auth.mjs"

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer()
    s.on("error", rej)
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })

const evalOn = (wsUrl, expression) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener("open", () => {
      ws.addEventListener("message", (ev) => {
        const m = JSON.parse(String(ev.data))
        if (m.id !== 1) return
        ws.close()
        resolve(m.result?.result?.value ?? null)
      })
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }))
    })
    ws.addEventListener("error", reject)
    setTimeout(() => { try { ws.close() } catch {}; resolve(null) }, 8000)
  })

const browser = findBrowser()
const profile = mkdtempSync(join(tmpdir(), "probe-"))
const port = await freePort()
const url = buildSignInUrl(newState())
const child = spawn(browser.path, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", url], {
  stdio: "ignore",
})

try {
  let page = null
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
    page = list.find((t) => t.type === "page" && /floatboat\.ai/.test(t.url || "")) ?? null
    if (page) break
  }
  if (!page) throw new Error("没等到 floatboat.ai 页面")

  let info = null
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 600))
    const raw = await evalOn(
      page.webSocketDebuggerUrl,
      "JSON.stringify({title: document.title, href: location.href, ready: document.readyState, text: (document.body ? document.body.innerText : '').slice(0, 120)})",
    )
    if (!raw) continue
    info = JSON.parse(raw)
    if (info.ready === "complete" && info.text) break
  }
  console.log(JSON.stringify({ url, page: info }, null, 1))
} finally {
  try { child.kill() } catch {}
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }) } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
