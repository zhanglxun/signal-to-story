import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"

/** HTTP supports getRandomValues, but not SubtleCrypto. Keep 256-bit entropy
 * and the same SHA-256 digest accepted by the gateway on either origin. */
export function generateIntakeCredential() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("当前浏览器不支持安全随机数，请使用新版浏览器。")
  }
  const token = "stk_" + bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
  return { token, hash: bytesToHex(sha256(new TextEncoder().encode(token))) }
}
