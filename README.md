# magpie-Floatboat

把 **Floatboat** 桌面端背后的模型网关接进 magpie。

Floatboat 自己不做模型：它是个 Electron Agent 客户端，模型全走
`https://newapi.aoe.chat`（一个 New API 实例），账号、积分和「发钥匙」在
`https://floatboat.ai`。所以这个插件干的事情很干净：

```
magpie ──► 插件 ──► newapi.aoe.chat/v1/chat/completions   （模型）
             │
             └───► floatboat.ai/api/desktop/*              （登录 / 积分 / 换 sk- key）
```

**不注入任何官方系统提示词。** 网关只做模型转发，system 是 magpie 里那套。

---

## 登录

和桌面端走**同一条路**，不是猜的（0.6.7 解包 + 日志实测）：

1. 插件打开 `https://floatboat.ai/desktop-sign-in?state=<uuid>`；
2. 你在那个窗口里正常登录（手机号 / 邮箱 / 第三方都行）；
3. 网页登录完回跳 `aoe://…?code=…&state=…`（客户端注册的自定义协议）；
4. 插件从受控浏览器里把 `code` 截下来，
   `POST /api/desktop/auth/exchange` 换 `access_token` + `refresh_token`；
5. 拿 access token 取 `GET /api/desktop/user/me`（账号 + 积分）和
   `POST /api/desktop/newapi/key`（网关的 `sk-…` key）；
6. 之后每次对话：`Authorization: Bearer sk-…` 打到网关。

三条登录方式：

| 方式 | 什么时候用 |
|---|---|
| **浏览器登录（推荐）** | 默认。插件自己起一个一次性 profile 的 Chromium，登完自动回跳 |
| **粘贴回调链接 / 授权码** | 浏览器被策略挡住，或你已经在别的浏览器里登过：把那行 `aoe://…` 贴进来 |
| **粘贴 accessToken** | 兜底。没有续期凭据，过期要重贴 |

> 为什么不是 `127.0.0.1` 回调？因为客户端用的就是 `aoe://` 深链。插件注册不了这个协议
> （已经被已安装的 Floatboat 占了），所以在受控浏览器里把 `location.href` /
> `assign` / `replace` / `window.open` / `<a>.click` 的深链**截下来且不放行**，
> 免得把你真正的客户端叫起来。

`refresh_token` 大约能续更久；插件在 `refreshLead`（到期前 5 分钟）自动续，
续完顺手重取一次 `sk-` key。

---

## 模型

13 个，id 就是网关的 model 字段：

| 分组 | 模型 | 客户端里的倍率 |
|---|---|---|
| 默认 | `lite` | 0.1x |
| DeepSeek | `deepseek-v4.1-flash` / `deepseek-v4-pro` | 0.1x / 0.3x |
| Gemini | `gemini-3.8-flash` / `gemini-4-hydrogen` / `gemini-4-argon`（Pro 专属） / `gemini-4-neon` / `gemini-4-carbon` | 0.25x / 0.6x / 0.8x / 1x / 1.5x |
| OpenAI 系 | `gpt-6.2-sol` / `gpt-6.1-sol` / `gpt-6.2-astra` / `gpt-6-astra`（Pro 专属） | 0.8x / 0.8x / 3.2x / 4x |
| Anthropic | `claude-sonnet-5.5`（Pro 专属） | 0.8x |

**事实边界**（重要）：

- **id 和倍率是上游事实** —— 来自客户端的模型选择器；
- **context / output 是插件估计** —— 网关把 `/v1/models` 关了
  （实测 `404 feature_not_supported`），上下文长度只能按家族给保守值；
- **识图能力按家族判断**：Gemini / GPT / Claude 标了 image，DeepSeek 和 lite 没标。
  客户端自己的「图片文字提取」默认也用 `gemini-3.8-flash`，这条算旁证。

倍率只是展示用的账目：真正扣多少是网关按积分算的，插件不参与计费。
不过它照 magpie 的 `rate` 字段给了宿主，所以模型列表里会显示成 `x0.8` 那种倍率胶囊。

模型条目**同时**满足宿主的两条路径：`config` 钩子的静态表读顶层
`reasoning` / `attachment` / `tool_call` / `modalities`，
`provider.models` 的返回值读 `capabilities.*` + `api`。
只写一套不报错，只是能力静默少一块 —— 细节与证据见
[docs/contract-alignment.md](./docs/contract-alignment.md)。

---

## 积分 / 签到

界面里那个「首日积分已到账 200 积分，明天可领取 300 积分」是**新手两笔奖励**，
不是每天刷新的签到。插件把 `auth.checkin` 指到
`POST /api/v1/users/me/newapi/signup-credits/claim`，按 `day=1 → day=2` 依次尝试。

⚠ **这条的请求体形状没有实机抓包**：客户端里只有
`claimSignupCreditDayTwo` / `getSignupCreditClaimStatus` 两个方法名，
`day` 是最合理的推断。所以这里刻意不假装成功 —— 猜错时用户看到的是上游原话，
`outcome` 会按 magpie 的契约六值老实返回 `claimed` / `done` / `inactive` / `failed`
（不能随手编 `success` —— 宿主只认那六个，别的会被改写成失败）。

额度卡片用的是**钱包型**窗口（`balance` + 单位「积分」，不给 `used`），不硬凑百分比，
不会出现一条永远 100% 的假进度条；上游没回余额时给一条「上游没有返回余额」的
文本窗口，而不是报 0 假装钱包空了。

---

## 安装

```bash
DST=~/.config/magpie/plugins/node_modules/magpie-floatboat
mkdir -p "$DST"
cp -r index.mjs src package.json registry-entry.json README.md "$DST"/
```

然后 `plugins.json` 的 `plugins` 数组加 `{"spec": "magpie-floatboat"}`，
`plugins/package.json` 的 `dependencies` 加 `"magpie-floatboat": "file:./node_modules/magpie-floatboat"`，
最后 `magpie-bun install`。

> `magpie plugin add xxx.tgz` 有 bug（把 tgz 当 JS `import()`），别用它。

---

## 实测：请求扣不扣积分？（2026-11-20，真实账号）

**扣。能用的模型都按 token 扣积分，没有「免费用」的通道。**

| 调用 | 积分变化 |
|---|---|
| gpt-6.1-sol（26 tokens） | 186 → 185，扣 1 |
| deepseek-v4-pro（28 tokens） | 185 → 184，扣 1 |
| gemini-4-argon（Pro 专属） | 不变（没真正调用模型，只回「exclusive to Pro」） |
| lite（upstream_busy） | 不变（请求失败） |

**不扣分只有两种情况，都意味着没用上模型**：Pro 专属被拒之门外、上游 busy 失败。
完整证据见 [docs/live-findings.md](docs/live-findings.md)。

## 实测接入（2026-11-20，magpie 0.1.4445）

- `magpie plugin list` → `floatboat (Floatboat, 13 models) signed in` ✓
- `GET 127.0.0.1:3425/v1/models` → 13 个 `floatboat/*` ✓
- 通过 gateway 发「1+1等于几」→ 回答「2」✓
- 与 magpie 真实契约逐项对齐见 [docs/contract-alignment.md](docs/contract-alignment.md)（改了 7 处静默错误）

## 已知限制

- **`/v1/models` 不可用**：目录只能在插件里。上游若加了新模型，改 `src/models.mjs`。
- **`sk-` key 可能轮换**：插件缓存 30 分钟，遇到 401 会重取一次；还失败就标登录失效。
- **accessToken 方式没有续期**：过期只能重贴。
- **浏览器登录依赖 Chromium 内核**：Chrome / Edge / 360 / QQ / Brave 都行；没有就退回粘贴。
- **Windows / macOS / Linux** 都能跑（浏览器探测三个平台都写了），但只在 Windows 上实测过。
- 首次登录会顺带取一次 `sk-` key；如果账号还没开通网关，卡片能出来但第一次对话会报没 key。

---

## 自检

```bash
node scripts/smoke.mjs          # 不联网：装配 / 模型表 / loader 路由
node --test tests/*.test.mjs    # 32 项：契约形状 + 网关 + 额度 + 签到
node scripts/live-auth-paths.mjs # 联网：用假 token 验证「登录过期」降级路径
```

契约对齐的逐项清单（对 magpie 0.1.4445 的宿主源码）在
[docs/contract-alignment.md](./docs/contract-alignment.md)。

---

## License

MIT
