import { describe, expect, it } from "vitest"

import { isPrivilegedSupabaseKey, readSupabasePublicConfig } from "@/lib/supabase"

function jwt(role: string) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ role })}.signature`
}

describe("supabase public config", () => {
  it("reads the anon key without requiring it", () => {
    expect(readSupabasePublicConfig({})).toBeNull()
    expect(
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: jwt("anon"),
      })
    ).toEqual({
      url: "https://example.supabase.co",
      key: jwt("anon"),
    })
  })

  it("falls back to the publishable key and refuses privileged keys", () => {
    expect(
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      })?.key
    ).toBe("sb_publishable_example")
    expect(isPrivilegedSupabaseKey(jwt("service_role"))).toBe(true)
    expect(isPrivilegedSupabaseKey("sb_secret_example")).toBe(true)
    expect(
      readSupabasePublicConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: jwt("service_role"),
      })
    ).toBeNull()
  })
})
