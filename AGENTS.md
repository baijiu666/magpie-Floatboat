# AGENTS.md — magpie-Floatboat

## 这个仓库在干什么

把 Floatboat 桌面端背后的 New API 网关接进 magpie。只有一个 provider：`floatboat`。

`index.mjs` 只做装配（八个钩子），实现全在 `src/`。

## 事实边界（改之前先看这一段）

| 结论 | 可信度 | 来源 |
|---|---|---|
| 登录页 `/desktop-sign-in?state=` | 实测 | 客户端日志 + 渲染层 bundle |
| 回跳走 `aoe://` 深链 | 实测（推断路径） | `isRegisteredDesktopDeepLinkScheme`、`handleOAuthCallback` |
| `POST /api/desktop/auth/exchange {code,state,deviceId}` | 实测 | bundle + 实打（返回 `invalid or expired code`） |
| `POST /api/desktop/auth/refresh {refresh_token}` | 实测 | 实打（返回 `invalid refresh_token`，说明字段名对） |
| `GET /api/desktop/user/me` | 实测 | 日志里的 `GET /api/desktop/:id/:id` + 实打 401 |
| `POST /api/desktop/newapi/key` | 实测 | **必须是 POST**，GET 会 405 |
| 网关 `newapi.aoe.chat` 同时吃 OpenAI / Anthropic 协议 | 实测 | `/v1/chat/completions` 与 `/v1/messages` 都返回标准 401 |
| `/v1/models` 被上游关掉 | 实测 | 404 `feature_not_supported` |
| 积分领取的请求体 `{day:1|2}` | **未验证** | 只有方法名 `claimSignupCreditDayTwo` 作旁证 |
| 各模型的 context / output | 插件估计 | 网关不给目录 |

改数据前先确认自己在改哪一栏 —— **别把插件常量写成厂商限制**。

## 硬规则

- **不打印 secret**：`sk-`、`access_token`、`refresh_token`、`aoe://…?code=` 一律 redact。
- **不静默降级**：拿不到 key 就抛 401 / 明确错误，不要拿空 key 去打网关。
- **不假装签到成功**：积分接口形状没验证，只能回传上游原话。
- **不注入系统提示词**：网关只做转发，system 由宿主决定。
- **模型表永远不能空**：`config` 钩子在未登录时也要有内容。
- **五个模态键必须显式写布尔**：省略 `image` ≠ 不支持图片。
- **改了代码必须 bump `version`**，否则命中 bun 缓存，重打包行为不变。

## 目录

```
index.mjs            八个钩子的装配
src/config.mjs       上游事实（URL / SDK / UA / 图标）
src/models.mjs       模型目录 + magpie 条目
src/http.mjs         fetch 封装（超时 / 重试 / 错误归一）
src/desktop-api.mjs  floatboat.ai 的桌面端接口
src/auth.mjs         登录编排（拼 state → 换 token → 补齐账号）
src/browser-login.mjs 受控 Chromium + CDP 截深链
src/gateway.mjs      sk- key 管理 + 聊天转发
src/usage.mjs        积分 → usage 卡片
src/checkin.mjs      新手积分领取
```

## 定义完成

- `node scripts/smoke.mjs` 绿
- `node --test tests/*.test.mjs` 绿
- 新增的上游事实要能指出证据（日志行 / 实打返回 / bundle 里的字符串）
