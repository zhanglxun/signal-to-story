import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { ChatMessageList } from "@/modules/chat/components/chat-message-list"
import { PermissionQuestionnaireCard } from "@/modules/chat/components/permission-questionnaire-card"
import { PlanCard } from "@/modules/chat/components/plan-card"
import { StackTraceBlock } from "@/modules/chat/components/stack-trace-block"
import { ToolTaskCard } from "@/modules/chat/components/tool-task-card"
import type { ChatMessage } from "@/modules/chat/types"

beforeAll(() => {
  if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => undefined
  }
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }
  if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

describe("Phase 2 Chat UI components", () => {
  it("renders PlanCard with all 4 step statuses and hides when empty", () => {
    const { container, rerender } = render(<PlanCard steps={[]} />)
    expect(container).toBeEmptyDOMElement()

    rerender(
      <PlanCard
        steps={[
          { id: "1", title: "步骤一", status: "completed" },
          { id: "2", title: "步骤二", status: "in_progress" },
          { id: "3", title: "步骤三", status: "failed" },
          { id: "4", title: "步骤四", status: "pending" },
        ]}
      />
    )

    expect(screen.getByText("执行计划")).toBeInTheDocument()
    expect(screen.getByText("已完成 1 / 4")).toBeInTheDocument()
    expect(screen.getByText("已完成")).toBeInTheDocument()
    expect(screen.getByText("进行中")).toBeInTheDocument()
    expect(screen.getByText("失败")).toBeInTheDocument()
    expect(screen.getByText("待执行")).toBeInTheDocument()
    expect(screen.getByText("步骤二").closest("li")).toHaveAttribute(
      "data-step-status",
      "in_progress"
    )
    expect(screen.getByText("步骤三").closest("li")).toHaveAttribute(
      "data-step-status",
      "failed"
    )
  })

  it("renders ToolTaskCard states, collapsible summaries, and failure error + stack", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ToolTaskCard callId="c1" name="read_work_item" state="running" />
    )
    expect(screen.getByText("运行中")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "详情" })).not.toBeInTheDocument()

    rerender(
      <ToolTaskCard
        callId="c2"
        name="fetch_reference"
        state="failed"
        inputSummary='{"url":"https://example.com"}'
        outputSummary="HTTP 504"
        error="抓取超时"
        stackTrace={"Error: timeout\n  at fetchTool (chat-turn.ts:10)"}
      />
    )

    expect(screen.getByText("失败")).toBeInTheDocument()
    expect(screen.getByText("抓取超时")).toBeInTheDocument()
    expect(screen.queryByText("HTTP 504")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "详情" }))
    expect(screen.getByText('{"url":"https://example.com"}')).toBeVisible()
    expect(screen.getByText("HTTP 504")).toBeVisible()

    await user.click(screen.getByRole("button", { name: /工具错误调用栈/ }))
    expect(screen.getByText(/at fetchTool/)).toBeVisible()
  })

  it("renders StackTraceBlock collapsed by default and copies stack text", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    const { container, rerender } = render(<StackTraceBlock stack="   " />)
    expect(container).toBeEmptyDOMElement()

    rerender(<StackTraceBlock stack={"Error: boom\n  at line 42"} />)
    await user.click(screen.getByRole("button", { name: /Stack Trace/ }))
    expect(screen.getByText(/at line 42/)).toBeVisible()

    await user.click(screen.getByRole("button", { name: "复制调用栈" }))
    expect(writeText).toHaveBeenCalledWith("Error: boom\n  at line 42")
    expect(screen.getByText("已复制")).toBeInTheDocument()
  })

  it("renders PermissionQuestionnaireCard options by kind and shows decision badges including timeout", async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(
      <PermissionQuestionnaireCard
        requestId="req-1"
        action="enqueue_content_draft"
        summary="确认入队出稿任务？"
        options={[
          { id: "allow_once", label: "仅本次允许", kind: "allow" },
          { id: "reject_once", label: "拒绝执行", kind: "deny" },
        ]}
        onAnswer={onAnswer}
      />
    )

    const allowBtn = screen.getByRole("button", { name: "仅本次允许" })
    const denyBtn = screen.getByRole("button", { name: "拒绝执行" })
    expect(allowBtn.className).toContain("bg-primary")
    expect(denyBtn.className).toContain("border-border")

    await user.click(allowBtn)
    expect(onAnswer).toHaveBeenCalledWith("req-1", "allow")

    rerender(
      <PermissionQuestionnaireCard
        requestId="req-1"
        action="enqueue_content_draft"
        summary="确认入队出稿任务？"
        decision="timeout"
      />
    )
    expect(screen.getByText("已超时（按拒绝处理）")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "仅本次允许" })).not.toBeInTheDocument()
  })

  it("keeps at most one PlanCard per message and shows persisted error stack + pending placeholder", async () => {
    const user = userEvent.setup()
    const msg: ChatMessage = {
      id: "m-1",
      organizationId: "org-1",
      sessionId: "s-1",
      seq: 2,
      role: "assistant",
      content: "部分完成",
      parts: [
        {
          type: "plan",
          steps: [{ id: "1", title: "旧计划步骤", status: "pending" }],
        },
        {
          type: "plan",
          steps: [{ id: "1", title: "最新计划步骤", status: "completed" }],
        },
        {
          type: "error",
          code: "upstream_error",
          message: "上游断开",
          stack: "Error: stream dropped\n  at worker.ts:99",
        },
      ],
      status: "error",
      agentJobId: "job-1",
      replyToMessageId: "u-1",
      createdAt: "2026-11-24T10:00:00Z",
    }

    render(
      <MemoryRouter>
        <ChatMessageList
          timeline={[{ kind: "message", message: msg }]}
          selectedVersions={{}}
          onSelectVersion={() => undefined}
          activeTurn={null}
          pendingTurn={{
            sessionId: "s-1",
            jobId: "job-2",
            reason: "stopping",
            runtimeLabel: "Qwen",
          }}
          slashCards={[]}
          isLoading={false}
          onQuickPrompt={() => undefined}
          onRegenerate={() => undefined}
          onAnswerPermission={() => undefined}
        />
      </MemoryRouter>
    )

    expect(screen.queryByText("旧计划步骤")).not.toBeInTheDocument()
    expect(screen.getByText("最新计划步骤")).toBeInTheDocument()
    expect(screen.getByText("正在停止，等待助手回复落库…")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Stack Trace/ }))
    expect(screen.getByText(/at worker.ts:99/)).toBeVisible()
  })
})
