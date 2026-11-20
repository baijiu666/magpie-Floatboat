# 实测记录（2026-11-20，本机真实账号）

> 方法：从本机 Floatboat 桌面端 `%APPDATA%\floatboat\.floatboat\app.db` 解出真实凭据，
> 直接打上游接口 + 通过本机 magpie 0.1.4445 实测。**全部是实测，没有推断。**
> 账号：3380553142@qq.com（free，无订阅）。

## 一、凭据是怎么拿到的（不用用户重新登录）

桌面端把登录态存在 SQLCipher 加密的 `app.db` 里，链路是三层：

```
Chromium Local State.os_crypt.encrypted_key
  ──DPAPI(CurrentUser)──► 32 字节主密钥
  ──AES-256-GCM──► 解 .floatboat/db-encryption-key.enc（v10 格式）→ SQLCipher 的 key（64 hex）
  ──SQLCipher──► 打开 app.db
       ├─ user_auth 表：access_token / refresh_token / api_key（v2:nonce:tag:ct，AES-256-GCM）
       └─ db_metadata.credential_master_key_v1（v10 格式）
            ──主密钥 AES-256-GCM──► 44 字符 base64 → 32 字节凭据密钥
                 ──解 v2:──► 明文：JWT access_token、refresh_token、sk- api_key
```

所以插件**可以**做到「从本机客户端导入」，不用弹浏览器。当前版本先用手动导入的凭据验证，
「从本机客户端导入」作为后续增强（需要引入 better-sqlite3-multiple-ciphers 原生依赖）。

## 二、user/me 的真实字段

`GET /api/desktop/user/me` 返回 `{code:0,data:{...}}`，data 下：

- `id / name / email / image / isAdmin / canUseUnlimitedMode / newapiUserId`
- **`credits`**：`{state:"available", remainingCredits:195, canUseUnlimitedMode:false, source:"newapi", refreshedAt}`
- **`billing`**：`{hasActiveSubscription:false, membershipLevel:"free", planCode:null, expiresAt:null,...}`

⚠ 之前按 `creditBalance` 猜是错的，真实是 `credits`。已修。
`credits.source="newapi"` 说明**积分就是 New API 的 quota**。

## 三、模型可用性（13 个全扫）

| 模型 | 实测 | 说明 |
|---|---|---|
| lite | 503 upstream_busy | 免费档，但当前上游忙 |
| deepseek-v4.1-flash | 503 upstream_busy | 同上 |
| deepseek-v4-pro | 200 可用 | reasoning 模型（reasoning_tokens） |
| gemini-3.8-flash | 200 可用 | |
| gemini-4-hydrogen | 200「exclusive to Pro」 | **Pro 专属** |
| gemini-4-argon | 200「exclusive to Pro」 | **Pro 专属** |
| gemini-4-neon | 200 可用 | |
| gemini-4-carbon | 200 可用 | |
| gpt-6.2-sol | 200 可用 | reasoning |
| gpt-6.1-sol | 200 可用 | reasoning |
| gpt-6.2-astra | 200 可用 | |
| gpt-6-astra | 200「exclusive to Pro」 | **Pro 专属** |
| claude-sonnet-5.5 | 200「exclusive to Pro」 | **Pro 专属** |

## 四、积分消耗（用户最关心的问题）

用「前后各查一次 `credits.remainingCredits`」的方式实测：

| 调用 | before | after | delta | 说明 |
|---|---|---|---|---|
| gpt-6.1-sol（26 tokens） | 186 | 185 | **1** | 按 token 扣 |
| deepseek-v4-pro（28 tokens） | 185 | 184 | **1** | 按 token 扣 |
| gemini-4-argon（Pro 专属） | 184 | 184 | **0** | 没真正调用模型，只回提示 |
| lite（upstream_busy） | 184 | 184 | **0** | 请求失败，不扣 |

**结论：能用的模型都按 token 扣积分，没有「免费用」的通道。**
不扣分只有两种情况，都意味着**没用上模型**：① Pro 专属被拒之门外；② 上游 busy 失败。

## 五、接入 magpie 实测

- `magpie plugin list` → `floatboat (Floatboat, 13 models) signed in as 3380553142@qq.com` ✓
- 重启后 `GET 127.0.0.1:3425/v1/models` → 出现全部 13 个 `floatboat/*` ✓
- `POST 127.0.0.1:3425/v1/chat/completions`（model=`floatboat/gpt-6.1-sol`）
  → 问「1+1等于几」回答「2」，usage 正常 ✓

## 六、两个上游现象（不是插件 bug）

1. **content 末尾被注入提示**：每次响应都带
   `### 💡 Tip: Your current client version will soon stop receiving maintenance...`。
   这是上游针对非官方客户端注入的文本，插件不剥离（保持响应真实），在此说明。
2. **access_token 只有 15 分钟**（refresh 返回 `expires_in=900`）。
   magpie 靠 `auth.refresh` 自动续期；对话本身只用 sk- key，token 过期不影响已发的对话。
