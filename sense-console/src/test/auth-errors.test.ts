import { describe, expect, it } from "vitest"

import { getAuthErrorMessage } from "@/features/auth/auth-errors"

describe("Supabase auth error messages", () => {
  it("uses a safe message for invalid credentials", () => {
    expect(getAuthErrorMessage({ code: "invalid_credentials", status: 400 }, "fallback")).toBe(
      "邮箱或密码不正确。",
    )
  })

  it("does not expose unknown provider errors", () => {
    expect(getAuthErrorMessage({ code: "provider_internal_detail" }, "登录失败，请稍后再试。")).toBe(
      "登录失败，请稍后再试。",
    )
  })
})
