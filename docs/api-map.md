# Floatboat 0.6.7 接口地图（逆向记录）

来源：解包 `Floatboat-Setup-0.6.7-x64.exe` → `resources/app.asar` → `.vite/build/mainRuntime-*.js`
（javascript-obfuscator 混淆，字符串表用自定义字母表 base64，已解码）
+ `%APPDATA%\floatboat\logs\main-*.log` + 实测打点（2026-11-20，全部返回可复现）。

## 域名

| 用途 | 地址 |
|---|---|
| 业务后端 | `https://floatboat.ai` |
| 模型网关（New API） | `https://newapi.aoe.chat` |
| IM / MQTT | `imapi.floatboat.ai` / `mqttchannel.floatboat.ai:443` |
| 更新 | `release.aoe.chat` |

## 账号 / token

```
POST /api/desktop/auth/exchange        {code, state, deviceId, codeVerifier?}
     → {access_token, refresh_token, expires_in, refresh_expires_in}
POST /api/desktop/auth/refresh         {refresh_token}
     → 同上
GET  /api/desktop/user/me              Bearer access_token
     → user{id,email,name,image,isAdmin} + creditBalance{remainingCredits,state,refreshedAt}
       + hasActiveSubscription / membershipLevel / canUseUnlimitedMode / userContext
POST /api/desktop/newapi/key           Bearer access_token   ← 必须 POST，GET 返回 405
     → {api_key: "sk-…"}
GET  /api/desktop/features/entitlements
GET  /api/desktop/user/context
POST /api/v1/users/me/newapi/signup-credits/claim     新手积分（day 1 = 200，day 2 = 300）
```

设备配对（另一条链路，本插件没用）：
`POST /api/desktop/auth/device-pair/create` → `{pairing_token, pairing_code, qr_payload, expires_at_ms}`，
`GET /api/desktop/auth/device-pair/status?pairing_token=` 轮询，
`POST /api/desktop/auth/device-pair/{approve,reject}`。

## 登录页

```
https://floatboat.ai/desktop-sign-in?state=<uuid>
```
登录成功后回跳 `aoe://…?code=…&state=…`（`deepLinkScheme: "aoe"`，安装包注册）。
渲染层 `handleOAuthCallback` 还会识别 `apikey` / `api_key` 参数。

## 模型网关

标准 New API：
- `POST /v1/chat/completions`（OpenAI 协议）
- `POST /v1/messages`（Anthropic 协议，`x-api-key` + `anthropic-version`）
- `GET /v1/models` → **上游关闭**：`404 {"code":"feature_not_supported"}`
- `/api/*` 走 New API 自己的会话鉴权（`/api/status` 公开，`/api/pricing` 被 nginx 挡）

错误体统一带 `X-Aoe-Error-Code` / `X-Oneapi-Request-Id` 头。

## 其它事实

- 桌面端把数据放在 `%APPDATA%\floatboat\.floatboat\app.db`，**SQLCipher 加密**；
  密钥在 `db-encryption-key.enc`，`v10` + AES-256-GCM，主密钥由 Chromium
  `Local State` 的 `os_crypt.encrypted_key` 经 DPAPI 解开。插件**不碰**这些文件。
- 本地服务端口：`19824`（主版本）/ `19825`（DeepSeek Agent 变体）。
- 客户端模型选择器里的倍率是 New API 的 model ratio，只用于展示。
