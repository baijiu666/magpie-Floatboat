// src/checkin.mjs —— 领取 Floatboat 的新手积分（首日 200 / 次日 300）
//
// 实测（2026-11-20，本机账号）：POST /api/v1/users/me/newapi/signup-credits/claim
// 请求体**不需要 day 参数**（{day:1} 与 {} 返回一致），直接 POST {}。
//
// 真实响应：{code:0, data:{enqueued, delivered, reason, deliveryError,
//            creditBalance:{state, remainingCredits, source:"newapi", refreshedAt}}}
//   · enqueued/delivered = true → 入账了
//   · reason = "already_processed" → 新手两笔已领完
//
// ⚠ 这是「新手首日/次日」两笔奖励，**不是每天刷新的签到**。
//
// outcome 用 magpie 契约认的值（docs/contract-alignment.md）：
//   claimed 领到了 / done 已领过或今天已处理 / inactive 没有签到接口 / failed 失败。

import { WEB_BASE } from "./config.mjs"
import { apiFetch } from "./http.mjs"

const CLAIM_PATH = "/api/v1/users/me/newapi/signup-credits/claim"

function numberOrNull(v) {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * 领取新手积分。
 * @param {string} accessToken
 * @param {{signal?: AbortSignal}} [o]
 */
export async function claimSignupCredits(accessToken, { signal } = {}) {
  if (!accessToken) return { outcome: "failed", message: "Floatboat 未登录" }

  let raw
  try {
    raw = await apiFetch(`${WEB_BASE}${CLAIM_PATH}`, {
      method: "POST",
      token: accessToken,
      json: {},
      signal,
      retries: 0,
    })
  } catch (e) {
    const msg = String(e?.message ?? e)
    // 业务层报「已经领过」也算 inactive（没有每日签到），不当成登录过期
    if (/already|claimed|已领取|重复/i.test(msg)) {
      return { outcome: "inactive", message: "Floatboat 没有每日签到（新手两笔已领完）" }
    }
    if (e?.status === 404) {
      return { outcome: "inactive", message: "该账号没有新手积分领取接口" }
    }
    if (e?.status === 401) {
      return { outcome: "failed", message: "Floatboat 登录已过期，请重新登录", signIn: "expired" }
    }
    return { outcome: "failed", message: msg }
  }

  const body = raw?.data && typeof raw.data === "object" ? raw.data : raw

  // 真的入账了
  if (body?.enqueued === true || body?.delivered === true || body?.claimed === true) {
    const credit =
      numberOrNull(body?.creditBalance?.remainingCredits) ??
      numberOrNull(body?.creditsAmount) ??
      numberOrNull(body?.amount)
    return {
      outcome: "claimed",
      ...(credit !== null ? { credit } : {}),
      message: credit !== null ? `领取成功，当前余额 ${credit} 积分` : "领取成功",
    }
  }

  // 已领过 / 今天已处理。
  // ⚠ Floatboat 没有每日签到（只有新手两笔），已领过时返回 inactive，
  // 让宿主**隐藏签到入口** —— 不要每天显示「今日已签到」却一分不涨（2026-11-20 截图反馈）。
  const reason = body?.reason ?? body?.message ?? raw?.message ?? ""
  if (reason === "already_processed" || /already|claimed|已领取|重复/i.test(String(reason))) {
    return {
      outcome: "inactive",
      message: "Floatboat 没有每日签到（新手首日 200 / 次日 300 已领完）",
    }
  }

  return { outcome: "inactive", message: String(reason || "Floatboat 没有每日签到可领") }
}
