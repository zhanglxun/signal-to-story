// @vitest-environment node
import { createHash, webcrypto } from "node:crypto"
import { afterEach, expect, it, vi } from "vitest"
import { generateIntakeCredential } from "@/lib/intake-credentials"
afterEach(() => vi.unstubAllGlobals())
it("generates compatible gateway credentials without SubtleCrypto (HTTP)", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  })
  const first = generateIntakeCredential(),
    second = generateIntakeCredential()
  expect(first.token).toMatch(/^stk_[a-f0-9]{64}$/)
  expect(first.hash).toBe(
    createHash("sha256").update(first.token).digest("hex")
  )
  expect(second.token).not.toBe(first.token)
})
it("keeps the same digest format in secure browsers", () => {
  vi.stubGlobal("crypto", webcrypto)
  const { token, hash } = generateIntakeCredential()
  expect(hash).toBe(createHash("sha256").update(token).digest("hex"))
})
it("fails closed when secure randomness is unavailable", () => {
  vi.stubGlobal("crypto", undefined)
  expect(() => generateIntakeCredential()).toThrow("安全随机数")
})
