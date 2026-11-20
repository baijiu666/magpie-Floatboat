// 端到端验证「受控浏览器 + 深链截获」这条链路：打开一个会跳 aoe:// 的本地页面
import { chromiumDeepLinkLogin, findBrowser } from "../src/browser-login.mjs"

const browser = findBrowser()
if (!browser) throw new Error("没有浏览器")
const fileUrl = process.argv[2]
const t0 = Date.now()
const hit = await chromiumDeepLinkLogin({ browser, url: fileUrl, timeoutMs: 40_000 })
console.log(JSON.stringify({ ...hit, ms: Date.now() - t0 }))
