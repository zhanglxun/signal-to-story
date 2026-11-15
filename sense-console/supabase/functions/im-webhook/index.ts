// Thin Deno wrapper. Protocol logic is synced from ../../../adapters/im/ (pure TS, tested with vitest).
// Secrets (set with `supabase secrets set`, never in the repo or the browser):
//   FEISHU_VERIFICATION_TOKEN, FEISHU_ENCRYPT_KEY (optional), FEISHU_APP_ID, FEISHU_APP_SECRET,
//   WECOM_BOT_TOKEN, WECOM_ENCODING_AES_KEY, CONSOLE_BASE_URL (optional, default https://story.susense.cn)
// Configured in supabase/config.toml with verify_jwt = false (authenticity is the platform signature).
import { createClient } from "npm:@supabase/supabase-js@2.57.4"
import { createFeishuSender } from "./adapters/feishu.ts"
import { createImHandler } from "./adapters/handler.ts"

const env = (k: string) => Deno.env.get(k)?.trim() || ""
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })

const feishuToken = env("FEISHU_VERIFICATION_TOKEN")
const wecomToken = env("WECOM_BOT_TOKEN")
const wecomKey = env("WECOM_ENCODING_AES_KEY")

const handler = createImHandler({
  feishu: feishuToken ? { verificationToken: feishuToken, encryptKey: env("FEISHU_ENCRYPT_KEY") || undefined } : null,
  wecom: wecomToken && wecomKey ? { token: wecomToken, encodingAesKey: wecomKey } : null,
  feishuSender:
    env("FEISHU_APP_ID") && env("FEISHU_APP_SECRET")
      ? createFeishuSender({ appId: env("FEISHU_APP_ID"), appSecret: env("FEISHU_APP_SECRET"), fetch: (u, i) => fetch(u, i) })
      : null,
  consoleBaseUrl: env("CONSOLE_BASE_URL") || "https://story.susense.cn",
  capture: async (connectionId, replyTarget, input) => {
    const { data, error } = await admin.rpc("im_quick_capture", {
      p_connection_id: connectionId,
      p_reply_target: replyTarget,
      p_input: input,
    })
    return { data, error }
  },
  background: (work) => {
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt = (globalThis as any).EdgeRuntime
    if (rt?.waitUntil) rt.waitUntil(work)
  },
  log: (event, fields) => console.warn(JSON.stringify({ event, ...fields })),
})

Deno.serve(handler)
