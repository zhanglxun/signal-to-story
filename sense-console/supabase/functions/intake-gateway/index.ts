import { createClient } from "npm:@supabase/supabase-js@2.57.4"
import { createHandler } from "./handler.ts"
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
)
// Custom scoped token authentication is performed atomically by the RPC.
// capture -> accept_intake (unchanged); auto_draft -> quick_capture_for_connection, which acts as
// the connection creator and enqueues content_draft jobs (see docs/quick-capture.md).
Deno.serve(
  createHandler(async (hash, input) =>
    input.intent === "auto_draft"
      ? admin.rpc("quick_capture_for_connection", {
          p_token_hash: hash,
          p_input: input,
        })
      : admin.rpc("accept_intake", { p_token_hash: hash, p_input: input })
  )
)
