# 与 magpie 插件契约的逐项对齐

> 核对对象：本机实际安装的 **magpie 0.1.4445**（`C:\Users\baijiuya\AppData\Local\Programs\magpie\magpie.exe`）。
> 方法：`python extract-contract.py <magpie.exe>` 从宿主二进制里把内嵌的插件契约源码抽出来
> （27 章 / 333,391 字符），逐条对 `index.mjs` 与 `src/`。
> 没有登录账号、没有调用任何上游接口 —— 这一份是**静态契约核对**。
>
> 交叉参考：`magpie-tianxi-free/HOOKS.md`（基线 0.1.1327）。它和当前宿主的差异见文末
> 「四、HOOKS.md 已经过期的三条」——那几条正是这次改动的由来。

## 结论先说

改了 7 处**会静默出错**的地方（宿主不报错、只是能力少一块或显示错）：

| # | 位置 | 原来的后果 |
|---|---|---|
| 1 | `config` 钩子「已有就 return」 | 用户自己的 config 里有一条 `floatboat`，整个 provider 就少 npm/api/模型表 → 空卡片 |
| 2 | `auth.checkin` 返回 `"success"` / `"none"` | 契约只认六个值，其它一律改写成 `failed` → 签到永远显示失败 |
| 3 | `auth.usage` 顶层 `balance` 给数字 | 宿主 `text()` 只认字符串 → 余额被丢成 `""` |
| 4 | `auth.usage` 上游没余额时报 `balance: 0` | 「上游没说」被写成「钱包空了」，等于谎报 |
| 5 | 模型条目只写 `capabilities.*` | config 钩子那条路径**不读** `capabilities` → `tool_call` / `attachment` / `reasoning` 全部静默为假 |
| 6 | 模型条目缺 Model 形状（`api` / `capabilities` 全套） | `provider.models` 那条路径**不归一化**，条目会被原样当 Model 用 |
| 7 | `chat.headers` 空实现 | 每个请求宿主都白跑一次 `infoOf(provider)`，一个头也没加 |

顺带修了两个「不报错但会误导」的：`apiId`（当前宿主不读，删）、`registry-entry.json` 缺 `icon`（补）。

---

## 一、逐钩子核对

### ① `config(cfg)`

| | |
|---|---|
| **契约** | 宿主先 `config = {provider:{}, ...userConfig}`，然后对每个「要登录的 provider」把槽位换成**用户自己那份** `structuredClone(userConfig.provider[id])`（没有就删掉），再跑钩子；跑完把结果记进 `ownConfig`。钩子输出的 `models` 用 `m.id` 当上游 id（`api.id`），`m.limit`/`m.cost`/`m.reasoning`/`m.attachment`/`m.tool_call`/`m.modalities` 逐字段读。 |
| **原状** | `if (cfg.provider[PROVIDER]) return` —— 宿主刚把用户那份塞进来，这里必然「已有」，于是 `npm` / `api` / `models` 一个都不写。用户 config 里只要有一条 `floatboat`，卡片就是空的。 |
| **现在** | 逐字段 `??=` 补齐，`models` 取并集（用户写的覆盖我们的）。用户想关掉某一条用官方开关 `disabled: true`（宿主 `for (const [k,m] of Object.entries(cfg.models)) if (m?.disabled) delete out.models[k]`）。 |
| **状态** | ✅ 已修 + `tests/contract.test.mjs` 钉住 |

### ② `auth.methods`

| | |
|---|---|
| **契约** | 必须是**静态数组**（宿主 `methods(auth)` 直接 `.map()` 它，给函数会炸）；每个方法只读 `{type,label,labels,keyless,keyAsked,placeholder}`；`authorize(inputs, {signal})` 在调用时才从同一个对象上取，`inputs` 只在有 `prompts` 时传；返回值读 `{url,instructions,method,opened,callback}`；`method === "code"` 时宿主调 `callback(code, {signal})`，否则 `callback(undefined, {signal})`。 |
| **原状** | 数组 ✓；两个 oauth 方法无 `prompts` → 我们的 `authorize()` 忽略参数 ✓；`method` 值（`auto` / `code`）✓；`opened: true`（插件自己开浏览器）✓；`placeholder` 只在 api 方法上 ✓。 |
| **改动** | 加 `labels.en`（宿主支持多语言标签，最多 16 种）；没找到浏览器时改成**返回** `{type:"failed", error}`（契约原话：start 不了可以 say why 而不是 throw，界面上是干净的失败原因而不是堆栈）。 |
| **状态** | ✅ 已修（小改） |

> ⚠ 返回值里的 `close` **宿主不读**。0.1.4445 的 `authorize()` 只取
> `url / instructions / method / opened`；用户取消走的是传进来的 `signal`（宿主 abort 它，
> 我们的 `callback` 里挂了 listener 去 abort 受控浏览器）。保留 `close` 无害，
> 但它是**兜底手写**、不是契约字段 —— 真正的取消路径是 `signal`。

### ③ `auth.refresh(auth, provider)`

| | |
|---|---|
| **契约** | 返回的字段**覆盖**到旧账号上（`{...was, ...fields, type:"oauth"}`）；返回空 → 记作「这次没续上」，按 30s→30min 退避重试；抛错 → 失败，`err.signIn === "expired"` 才会把这个账号永久标成要重新登录。续期只在 `stored.expires` 是**有限正数**时才会发生（`renewAt` 否则返回 0 = 永不续期）。 |
| **原状** | 返回 `{access, refresh, expires, accountId, uid, metadata}` ✓；失败 `return undefined` ✓；`expires = expires_in ? now + s*1000 : 0` ✓（0 就是「没有到期时间」，宿主不续期，靠 401 兜底 —— 这是**降级**，不是 bug，已注释）。 |
| **改动** | 只补注释（`refresh(auth, _provider)`）。 |
| **状态** | ✅ 本来合规 |

### ④ `auth.loader(getAuth, provider)`

| | |
|---|---|
| **契约** | **每个账号只跑一次**，结果缓存在 `loaders` 里直到登录变化；返回 `{baseURL, apiKey, headers, fetch}`；`apiKey` 会按 npm 包自动加头（`sdkHeaders`），`headers` 后覆盖它；`fetch(url, init)` 必须返回 `Response`。 |
| **原状** | 四个字段齐 ✓；`apiKey: ""` + 鉴权放进 `fetch`（`sk-` key 是现取现用的，不能静态）✓；只转发 `/chat/completions`，其余 501 ✓；401 换 key 重试一次，仍 401 就带 `x-magpie-sign-in: expired`（宿主认这个头，也认抛出的 `err.signIn`）✓。 |
| **改动** | 补注释 + 参数名 `_provider`。 |
| **状态** | ✅ 本来合规 |

### ⑤ `auth.usage(getAuth, provider, {signal})`

| | |
|---|---|
| **契约**（`usageOf` 原文） | 顶层 `balance` 走 `text(u.balance)` —— **只认字符串**，数字会被丢成 `""`；窗口 `used` 现在是 `w?.used == null ? null : num(...)` —— **`null` = 没说**（不是 0）；窗口 `balance` 是 `typeof === "number"` —— **只认数字**，且契约注释写明：`sent without used, it is no share, yet routing knows the account and puts the one with the most left first among the provider's accounts in the same unit (#3950)`；`error` 会顶掉 windows；`signIn` 只认 `expired/kept/renewed`。 |
| **原状** | 顶层 `balance` 给的是**数字** → 被丢掉；窗口多了个契约里没有的 `note`；上游没给余额时写 `balance: 0`（= 谎报「钱包空了」）。 |
| **现在** | 顶层 `balance` 改 `"3,291 积分"`（字符串）；窗口就是 `{name: "积分", balance: <number>, unit: "积分"}` —— 没有 `used`/`limit`，因为上游给的是「没有总量的预付钱包」，硬凑分母只会画一条永远 100% 的假进度条；上游没给余额时输出一条 `{used: 0, aside: true, display: "上游没有返回余额"}` 的纯文本窗口（宿主不当它是占比，路由按「未读」处理，不撒谎）。 |
| **状态** | ✅ 已修 + `tests/usage.test.mjs` 钉住 |

### ⑥ `auth.checkin(getAuth, provider)`

| | |
|---|---|
| **契约** | `outcome` 只能是 `claimed / done / ineligible / inactive / captcha / failed`，**别的字符串被改写成 `failed`** 并把原话贴出来（「插件答了 X」）；`credit` / `streak` 只认有限数字；`message` 原样展示；`until` 可选；**`signIn` 宿主不读**（`checkinOf` 只取那五项）。 |
| **原状** | 返回 `outcome: "success"` 或 `"none"` —— **两个都不是合法值**，等于每次签到都显示失败。 |
| **现在** | `claimed`（领到了）/ `done`（上游说已领过，含业务层报「已经领过」）/ `inactive`（端点 404，活动下线）/ `failed`（401 或真失败，message 带上游原文）。内部调试字段 `raw` 在钩子出口处剥掉。 |
| **状态** | ✅ 已修 + `tests/checkin.test.mjs` 钉住 |

### ⑦ `provider.models(providerInfo, {auth, signal})`

| | |
|---|---|
| **契约** | 返回值**原样**当 OpenCode 的 `Model` 用（宿主只补 `id` / `providerID`），所以要有 `api` / `capabilities` / `cost` / `limit`；条目**每账号**列一次，`given.models` 是同一个引用时才算「回退」（我们每次新建对象，永远不会误判 `fellBack`）。 |
| **原状** | 返回的是 config 钩子那张静态表 —— 形状是「config 条目」，缺 Model 那一半。 |
| **现在** | 条目改成**两套形状的并集**（宿主各读自己那套，多余的键一律忽略）：顶层 `reasoning`/`attachment`/`tool_call`/`modalities` 给 config 路径，`api` + `capabilities.{temperature,reasoning,attachment,toolcall,input,output,interleaved}` 给 Model 路径。 |
| **状态** | ✅ 已修 + `tests/models.test.mjs` 钉住 |

### ⑧ `chat.headers`

| | |
|---|---|
| **契约** | `(input, output)`，往 `output.headers` 里塞；**只要声明了**，宿主每个请求都会先 `infoOf(provider)` 再调一遍。 |
| **原状** | `async () => {}` —— 一个头不加，纯空转。 |
| **现在** | 删掉。网关不认 magpie 的会话头，没有头要加。 |
| **状态** | ✅ 已修 |

---

## 二、`package.json` 与 `registry-entry.json`

| 字段 | 契约 | 现状 |
|---|---|---|
| `magpie.icon` | `https://` 或 `data:image/` 开头，≤ 1MB（`3 << 19`） | ✅ `data:image/svg+xml;base64,…`（418 字符）。`auth.icon` 到不了**插件卡片**，只到供应商卡片 —— 所以两处都写了 |
| `magpie.maxConcurrency` | 1–1000 的整数，用户设置会盖过它 | ✅ `4`（`auth.maxConcurrency` 也给了同一个值） |
| `magpie.maxAccounts` | 同上，限制同时跑的账号数 | 不设（未实测上游对并发账号的限制，不编） |
| `magpie.name` | **宿主不读**。0.1.4445 只读 `magpie.icon` / `maxConcurrency` / `maxAccounts`；插件卡片标题来自 `plugin.Name()`（npm 包名 / git dependencies 的键名 / 路径） | ⚠ 保留但**没有任何效果**。想让卡片叫「Floatboat」得改包名或装的时候起名，改这个字段没用 |
| `registry-entry.json` | **宿主完全不读**（提取文本里 0 命中）。这是提交给 registry 的条目形状：`package` / `name` / `providers` / `summary`（多语言）/ `icon` | ✅ 补上了 `icon`（和 `package.json` 同一份 SVG） |
| `main` / `exports` | `entries()` 依次找 `exports["./server"]` → `main` → `exports["."]` → index 文件 | ✅ `main` + 字符串型 `exports` 都指向 `./index.mjs`（去重后一个） |

---

## 三、模型条目

当前宿主 `info()` 对 config 模型只读这些键（其余丢弃）：
`id / name / reasoning / attachment / tool_call / modalities.input / modalities.output /
limit / cost / options / headers / variants / temperature / decides / searches / also`。

| 字段 | 结论 |
|---|---|
| `id` / `name` | ✅ key 就是上游 id，`api.id` 会回落到 key |
| ~~`apiId`~~ | ❌ **删了**。`apiId` 在 0.1.4445 的归一化里 0 命中（`api: { id: m.id ?? was?.api.id ?? key }` 读的是 `m.id`）。HOOKS.md 说它是「上游 id 与 id 不同时才写」——那条在当前宿主已经不对了。我们 id 本来就等于上游 id，删掉零影响 |
| `status` | ✅ 保留（`provider.models` 那条路径要它，`deprecated` 会被过滤）。config 路径不归一它，不报错 |
| `rate` | ✅ 新加。契约里 `rateOf` 认数字（`0.5`）或字符串（`"x0.03"`），**倍率胶囊**就靠它。值是客户端模型选择器上的实测倍率，不是估算 |
| `cost` | ✅ 全 0 + `cache:{read,write}`：拿不到美元价就不编，倍率另有 `rate` |
| `limit.context` / `limit.output` | ⚠ **插件估计值**（上游关掉了 `/v1/models`）。契约允许缺省（0 = 去模型库查），但我们的 id 不在模型库里，查不到还是 0（=未知），所以给保守估计并在源码里写明「不是上游事实」 |
| `modalities` | ✅ 顶层显式写，`image` 是布尔（省掉 ≠ 不支持，而是「未表态」，宿主会拿 models.dev 同名模型投票） |
| `capabilities.input` / `.output` | ✅ 五个模态键全给布尔（Model 路径读这套） |
| `reasoning` / `attachment` / `tool_call` | ✅ 顶层给一份（config 路径读这套），`capabilities` 里再给一份（Model 路径读 `toolcall`，无下划线） |
| `free` | 不给。契约判据是「花不花这份订阅的额度」；这里所有能用的模型都按 token 扣积分 → 缺省 `false` 就是事实 |
| `access: "pro"` | ❌ 非契约字段，**已从返回表里删掉**，只留在 `CATALOG` 源码里当注释（Pro 专属是实测结论，但没有对应 UI 字段可挂） |
| `api` | ✅ 新加 `{id, url, npm}` —— Model 路径不归一化，缺了它 `sdkHeaders` / 协议的 npm 解析会退化 |

---

## 四、HOOKS.md 已经过期的三条（基线 0.1.1327 → 现在 0.1.4445）

| HOOKS.md 的说法 | 0.1.4445 的实际源码 | 影响 |
|---|---|---|
| `used` 必填，缺了归一成 0（「耗尽的账号被排到队首」） | `used: w?.used == null ? null : Math.max(0, num(w?.used))`，注释写 `null: not said` | 「缺 used = 0% = 排最前」这条**不再成立**；钱包型窗口还被专门加了 `balance` 字段（#3950：同一 unit 里余额多的排前面） |
| `apiId` 是模型条目字段 | `info()` 读 `m.id`，`apiId` 0 命中 | 写了没用 |
| `package.json` 的 `magpie.name` 之类 | 只读 `icon` / `maxConcurrency` / `maxAccounts` | 写了没用 |

> 这三条都不影响功能正确性（写多了只是死字段），但**会误导下一个改插件的人**，
> 所以记在这里。HOOKS.md 的其余部分（`checkin` 六值、`usage` 窗口语义、`loader`
> 四字段、`settle`/`whoOf`、`iconOf`、`concurrencyOf`）与当前宿主逐条对得上。

---

## 五、明确没做的事（未验证 / 不编）

| 项 | 为什么 |
|---|---|
| `auth.rotating` | 「refresh token 一次性」没实测过。声明错了会让宿主不敢跨机器带这个登录；不声明只是可能多一次 `invalid_grant` —— 选后者 |
| `auth.single` | 不声明 = 允许同一 provider 多账号。多开 Floatboat 账号是合理用法，没有理由锁死 |
| `auth.options`（provider 级开关） | 没有「值得做成开关」的行为。`signInTimeoutMs` / `maxConcurrency` 走的是 magpie 的插件 options（`fn(input, options)` 第二个参数），不是 `auth.options` 那套布尔开关 |
| 模型 `limit.context` 改成真实值 | 拿不到：网关 `/v1/models` 被上游关闭（404 `feature_not_supported`）。**不改，也不假装** |
| `auth.import`（从文件导入账号） | 上游没有可批量兑换的凭据格式，不做 |
| 签到请求体形状 | 仍然没有实机抓包（见 `src/checkin.mjs` 头部的边界说明）。**这次只修了返回值的契约形状，没有动猜测的请求体** |

---

## 六、自查怎么跑

```bash
cd D:/AI/magpie/magpie-Floatboat
node scripts/smoke.mjs          # 装配 + 模型表 + loader 路由（不联网）
node --test tests/*.test.mjs    # 32 项，含契约形状
```

宿主侧（装好插件、重启后）：

```bash
curl -s http://127.0.0.1:3425/v1/magpie/trace    | jq '.providers.floatboat'
curl -s http://127.0.0.1:3425/v1/magpie/quotas   | jq '.floatboat'
```

- 模型列表里每条都该有 `capabilities.input.image` 是**布尔**、`rate` 有值；
- 额度卡片：积分那条窗口 `used` 应是 `null`（钱包型），不是 0；
- 签到按钮按一次：结果应该是「已签到 +N」或「今天已签到」，**不该**出现「插件答了 success」。
