// src/desktop-api.mjs —— floatboat.ai 的桌面端接口（账号 / token / newapi key / 积分）
//
// 全部经 app.asar 实测确认存在（0.6.7）：
//   POST /api/desktop/auth/exchange   {code, state, deviceId, codeVerifier?} → {access_token, refresh_token, expires_in, refresh_expires_in}
//   POST /api/desktop/auth/refresh    {refresh_token}                        → 同上
//   GET  /api/desktop/user/me                                               → 用户 + 积分余额
//   GET  /api/desktop/newapi/key                                            → {api_key}
//   GET  /api/desktop/features/entitlements                                 → 会员权益
//   POST /api/v1/users/me/newapi/signup-credits/claim                       → 领取首日/次日积分
//
// ⚠ 响应外层包裹各接口不统一（有的直接给对象，有的套 data / user），一律用 unwrap 归一。

import { WEB_BASE } from "./config.mjs"
import { ApiError, apiFetch, deepFind } from "./http.mjs"

/** 剥掉 {code,message,data} / {success,data} 这类外层 */
export function unwrap(body) {
  if (!body || typeof body !== "object") return body
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) return body.data
  return body
}

/** 生成一个稳定的设备 id（客户端也是这么上报的） */
export function newDeviceId() {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

function tokensOf(raw) {
  const body = unwrap(raw)
  const accessToken = body?.access_token ?? body?.accessToken
  const refreshToken = body?.refresh_token ?? body?.refreshToken
  const expiresIn = Number(body?.expires_in ?? body?.expiresIn ?? 0)
  const refreshExpiresIn = Number(body?.refresh_expires_in ?? body?.refreshExpiresIn ?? 0)
  if (!accessToken || !refreshToken) {
    throw new ApiError(502, "bad_response", "上游 token 响应无效（缺 access_token / refresh_token）", raw)
  }
  return { accessToken, refreshToken, expiresIn, refreshExpiresIn }
}

/** 授权码换 token */
export async function exchangeCode({ code, state, deviceId, codeVerifier, signal }) {
  const raw = await apiFetch(`${WEB_BASE}/api/desktop/auth/exchange`, {
    method: "POST",
    json: { code, state, deviceId: deviceId ?? null, ...(codeVerifier ? { codeVerifier } : {}) },
    signal,
    timeoutMs: 30_000,
  })
  return tokensOf(raw)
}

/** refresh_token 换新 access_token */
export async function refreshTokens({ refreshToken, signal }) {
  const raw = await apiFetch(`${WEB_BASE}/api/desktop/auth/refresh`, {
    method: "POST",
    json: { refresh_token: refreshToken },
    signal,
    timeoutMs: 30_000,
  })
  return tokensOf(raw)
}

/**
 * 当前用户 + 积分余额
 *
 * 实测（2026-11-20，本机账号 3380553142）：user/me 返回 data 下
 *   id / name / email / image / isAdmin / canUseUnlimitedMode / newapiUserId
 *   credits {state, remainingCredits, canUseUnlimitedMode, source:"newapi", refreshedAt}
 *   billing {hasActiveSubscription, membershipLevel, planCode, expiresAt, ...}
 * 积分就是 New API 的 quota（credits.source="newapi"）。
 */
export async function fetchUser(accessToken, { signal } = {}) {
  const raw = await apiFetch(`${WEB_BASE}/api/desktop/user/me`, { token: accessToken, signal })
  const body = unwrap(raw)
  const user = body?.user ?? body

  const id = String(user?.id ?? user?.userId ?? "").trim()
  const email = typeof user?.email === "string" ? user.email : ""
  const name = typeof user?.name === "string" ? user.name : typeof user?.nickname === "string" ? user.nickname : ""
  const image = typeof user?.image === "string" ? user.image : ""

  const creditsObj = body?.credits ?? deepFind(body, "credits") ?? null
  const billing = body?.billing ?? deepFind(body, "billing") ?? null

  return {
    id,
    email,
    name,
    image,
    isAdmin: user?.isAdmin === true,
    credits: numberOrNull(creditsObj?.remainingCredits),
    creditsState: typeof creditsObj?.state === "string" ? creditsObj.state : null,
    creditsRefreshedAt: typeof creditsObj?.refreshedAt === "string" ? creditsObj.refreshedAt : null,
    hasActiveSubscription: billing?.hasActiveSubscription === true,
    membershipLevel: typeof billing?.membershipLevel === "string" ? billing.membershipLevel : null,
    canUseUnlimitedMode: body?.canUseUnlimitedMode === true || creditsObj?.canUseUnlimitedMode === true,
    raw,
  }
}

/** 取模型网关的 sk- key */
export async function fetchNewApiKey(accessToken, { signal } = {}) {
  // ⚠ 这个端点是 POST（GET 会 405）—— 实测 2026-11-20
  const raw = await apiFetch(`${WEB_BASE}/api/desktop/newapi/key`, {
    method: "POST",
    json: {},
    token: accessToken,
    signal,
  })
  const key = extractApiKey(raw)
  if (!key) {
    throw new ApiError(502, "bad_response", "上游没有返回 api_key（账号可能未开通模型网关）", raw)
  }
  return key
}

function extractApiKey(raw) {
  const body = unwrap(raw)
  const candidates = [body?.api_key, body?.apiKey, body?.key, deepFind(raw, "api_key"), deepFind(raw, "apiKey")]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return null
}

function numberOrNull(v) {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

/** 会员权益（失败不影响主流程） */
export async function fetchEntitlements(accessToken, { signal } = {}) {
  try {
    const raw = await apiFetch(`${WEB_BASE}/api/desktop/features/entitlements`, { token: accessToken, signal })
    return unwrap(raw)
  } catch {
    return null
  }
}
