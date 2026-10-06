import { createClient } from "npm:@supabase/supabase-js@2.57.4"
import { createHandler } from "./handler.ts"
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
)
// Custom scoped token authentication is performed atomically by accept_intake.
Deno.serve(
  createHandler(async (hash, input) =>
    admin.rpc("accept_intake", { p_token_hash: hash, p_input: input })
  )
)
