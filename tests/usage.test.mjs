import test from "node:test"
import assert from "node:assert/strict"
import { buildUsage, usageError } from "../src/usage.mjs"

test("有积分时出钱包型窗口（balance + unit，不带 used/limit）", () => {
  const u = buildUsage(
    { credits: 200, membershipLevel: "free", hasActiveSubscription: false, email: "a@b.c" },
    { accountId: "a@b.c" },
  )
  assert.equal(u.plan, "Free")
  // 顶层不再给 balance：它和窗口余额会渲染成两条重复信息（截图确认）
  assert.equal(u.balance, undefined)
  assert.equal(u.windows.length, 1)
  // 窗口 balance 宿主走 typeof === "number"，只认数字
  assert.equal(typeof u.windows[0].balance, "number")
  assert.equal(u.windows[0].balance, 200)
  assert.equal(u.windows[0].unit, "积分")
  // 钱包型窗口不能带 used/limit，否则会渲染成假进度条
  assert.equal(u.windows[0].used, undefined)
  assert.equal(u.windows[0].limit, undefined)
  assert.equal(u.windows[0].aside, undefined)
})

test("上游没说余额时不报 0，给一条 aside 文本窗口", () => {
  const u = buildUsage({}, {})
  assert.equal(u.balance, undefined) // 顶层不给：0 会变成「钱包空了」的谎
  assert.equal(u.windows.length, 1)
  assert.equal(u.windows[0].aside, true)
  assert.equal(u.windows[0].used, 0)
  assert.equal(u.windows[0].balance, undefined)
  assert.match(u.windows[0].display, /没有返回余额/)
})

test("会员等级映射到 plan", () => {
  assert.equal(buildUsage({ credits: 1, membershipLevel: "pro" }).plan, "Pro")
  assert.equal(buildUsage({ credits: 1, hasActiveSubscription: true }).plan, "会员")
  assert.equal(buildUsage({ credits: 1 }).plan, "免费")
})

test("错误卡片不夹带 token，signIn 只认契约三个值", () => {
  const u = usageError("登录过期了", { signIn: "expired" })
  assert.equal(u.error, "登录过期了")
  assert.equal(u.signIn, "expired")
  assert.deepEqual(u.windows, [])
  assert.equal(usageError("x", { signIn: "whatever" }).signIn, undefined)
})
