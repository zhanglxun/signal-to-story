import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { CaptureEntryGenerator } from "@/components/quick-capture/capture-entry-generator"
import { buildBookmarklet, captureRawFromParams, intakeEndpoint } from "@/lib/capture-entry"

describe("capture entry builders", () => {
  it("derives the gateway endpoint from the Supabase URL", () => {
    expect(intakeEndpoint("https://abc.supabase.co/")).toBe("https://abc.supabase.co/functions/v1/intake-gateway")
  })
  it("bookmarklet targets the console /capture page and embeds no token", () => {
    const b = buildBookmarklet("https://story.example.cn/")
    expect(b.startsWith("javascript:")).toBe(true)
    expect(b).toContain("https://story.example.cn")
    expect(b).not.toMatch(/stk_|Bearer|apikey/i)
  })
  it("prefills capture text only from http(s) urls", () => {
    expect(captureRawFromParams(new URLSearchParams("u=https://a.com/x&t=Hi"))).toBe("https://a.com/x\nHi")
    expect(captureRawFromParams(new URLSearchParams("u=javascript:alert(1)"))).toBe("")
  })
})

describe("CaptureEntryGenerator", () => {
  it("fills the pasted token into the shortcut config only", async () => {
    render(<CaptureEntryGenerator supabaseUrl="https://abc.supabase.co" consoleOrigin="https://story.example.cn" />)
    expect(screen.getByTestId("shortcut-config")).toHaveTextContent("https://abc.supabase.co/functions/v1/intake-gateway")
    expect(screen.getByTestId("shortcut-config")).toHaveTextContent("stk_<在外部接入页创建的收录令牌>")
    await userEvent.type(screen.getByLabelText("收录令牌"), "stk_secret123")
    expect(screen.getByTestId("shortcut-config")).toHaveTextContent("Bearer stk_secret123")
    expect(screen.getByTestId("bookmarklet-link").getAttribute("href")).not.toContain("stk_secret123")
    expect(localStorage.length).toBe(0)
  })
})
