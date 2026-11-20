# CHANGELOG

## 0.1.5 — 2026-11-21

**新增开关：剥掉上游在回复结尾追加的客户端公告**

上游（`newapi.aoe.chat`）会在每条回复末尾固定追加一段中英双语的
「客户端即将停止维护」公告，实测与客户端版本无关：UA 取
`Floatboat/0.6.7`、`0.7.0`、`0.8.0`、`1.0.0` 四档全部会出现，
改 UA 消不掉。

- 新增 `src/notice.mjs`：`stripNotice` / `stripNoticeFromJson` / `rewriteResponse`。
  公告块判据是「以 `### 💡 Tip:` 或 `### 💡 提示：` 开头的整块」，
  且只处理**结尾**那一段——正文中间同形内容、或后面还跟着别的 `### ` 标题的，原样保留。
- 新增插件选项 `stripUpstreamNotice`（默认开启）：关掉则原样透传。
- 流式响应同样处理：滞留最后 512 字符（公告约 365 字节，足够覆盖），
  流结束时剥掉再补发，SSE 分帧与 `[DONE]` 顺序保持不变；非流式直接改 JSON。
- 测试：`tests/notice.test.mjs` 9 项（英文/中文公告、正文中同形标题、非流式 JSON、
  跨 chunk 的流式剥离、开关关闭透传）。

## 0.1.1 — 2026-11-20

与 magpie 插件契约全面对齐（核对面：本机 magpie **0.1.4445** 的内嵌契约源码，
逐项清单见 [docs/contract-alignment.md](./docs/contract-alignment.md)）。全部是
**静态**修正，没有改任何实测出来的上游事实（模型 id / 倍率 / 接口路径）。

修掉 7 处「宿主不报错、只是能力少一块或显示错」的地方：

- **`config` 钩子不再「已有就 return」**：宿主跑钩子前会先用用户自己的
  `config.provider.floatboat` 覆盖槽位，原来那一句会让 provider 永远缺 npm/api/模型表。
  改成逐字段 `??=` + `models` 取并集（用户的优先，可用 `disabled: true` 关掉单条）。
- **`auth.checkin` 的 outcome** 从自造的 `success` / `none` 改成契约六值里的
  `claimed` / `done` / `inactive` / `failed`；原来每次签到都会被宿主改写成失败。
  401 与 404 分开归类，内部调试字段 `raw` 不再漏出去。
- **`auth.usage` 顶层 `balance` 改字符串**（宿主 `text()` 只认字符串，数字会被丢成 `""`）。
- **上游没余额时不再报 `balance: 0`**：改一条 `aside` 文本窗口，不假装钱包空了。
- **模型条目补两套形状**：`config` 路径读顶层 `reasoning`/`attachment`/`tool_call`/`modalities`，
  `provider.models` 路径读 `capabilities.*` + `api`。原来只写 `capabilities`，
  于是 config 路径上工具调用/收图/思考档全部静默为假。
- **删掉空转的 `chat.headers`**：没有头要加，声明了只会让宿主每个请求多跑一次 `infoOf`。
- **`registry-entry.json` 补 `icon`**；`package.json` 版本 0.1.0 → 0.1.1。

另外：

- 模型条目新增 `rate`（客户端实测倍率），宿主据此画倍率胶囊；
- 删掉不是契约字段的 `apiId` 与 `access`（后者只留在源码注释里）；
- 登录方式补 `labels.en`；找不到 Chromium 时按契约返回 `{type:"failed"}` 而不是抛异常；
- 新增 `tests/contract.test.mjs` / `tests/checkin.test.mjs`，测试 16 → 32 项。

## 0.1.0 — 2026-11-20

首个版本。基于 Floatboat 桌面端 0.6.7 的逆向结果。

- 登录：浏览器登录（受控 Chromium + CDP 截 `aoe://` 深链）、粘贴回调链接、粘贴 accessToken
- 续期：`refresh_token` + 到期前 5 分钟
- 模型：13 个（lite / DeepSeek / Gemini 4 档 / GPT 4 档 / Claude）
- 请求：`/v1/chat/completions` 原样转发，SSE 透传，401 时重取 `sk-` key 重试一次
- 额度：积分余额（钱包型窗口）
- 签到：新手首日/次日积分领取（请求体形状未实机验证）
