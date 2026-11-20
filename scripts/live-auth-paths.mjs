// 用假 token 打真接口，验证「登录过期」这条降级路径不会挂、也不会把堆栈甩给用户
import { FloatboatPlugin } from "../index.mjs"

const plugin = await FloatboatPlugin({}, {})
const auth = { access: "fake-token", refresh: "", uid: "u1", accountId: "tester", metadata: {} }

const usage = await plugin.auth.usage(async () => auth)
const checkin = await plugin.auth.checkin(async () => auth)
const refreshNoToken = await plugin.auth.refresh({ ...auth, refresh: "" })

console.log(
  JSON.stringify(
    {
      usage: { error: usage.error, signIn: usage.signIn, windows: usage.windows.length },
      checkin: { outcome: checkin.outcome, message: String(checkin.message || "").slice(0, 60) },
      refreshNoToken: refreshNoToken ?? null,
    },
    null,
    1,
  ),
)
