/**
 * Per-turn cost and round limits (docs/modules/chat.md 2.6, DB3b requirement 0 §4–5).
 * The database clamps budget_cents to 1–500 and max_rounds to ≤ 20; this re-clamps defensively.
 */
import type { ModelCallGate } from "./driver"
import { TURN_ERROR_CODES } from "./events"

export const DEFAULT_TURN_BUDGET_CENTS = 50
export const MAX_TURN_BUDGET_CENTS = 500
export const DEFAULT_TURN_MAX_ROUNDS = 8
export const MAX_TURN_MAX_ROUNDS = 20

const clamp = (v: number | null | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v as number), min), max) : fallback

export class TurnBudget {
  readonly budgetCents: number
  readonly maxRounds: number
  private spent = 0
  private rounds = 0

  constructor(limits: { budgetCents?: number | null; maxRounds?: number | null } = {}) {
    this.budgetCents = clamp(limits.budgetCents, DEFAULT_TURN_BUDGET_CENTS, 1, MAX_TURN_BUDGET_CENTS)
    this.maxRounds = clamp(limits.maxRounds, DEFAULT_TURN_MAX_ROUNDS, 1, MAX_TURN_MAX_ROUNDS)
  }

  get spentCents(): number {
    return this.spent
  }
  get roundsUsed(): number {
    return this.rounds
  }

  recordCost(costCents: number): void {
    if (Number.isFinite(costCents) && costCents > 0) this.spent += costCents
  }

  /** Call before each model request; a successful gate counts one round. */
  beforeModelCall(): ModelCallGate {
    if (this.spent >= this.budgetCents) {
      return { ok: false, code: TURN_ERROR_CODES.budgetExceeded, message: `本轮已达费用上限（${this.budgetCents} 分）` }
    }
    if (this.rounds >= this.maxRounds) {
      return { ok: false, code: TURN_ERROR_CODES.maxRounds, message: `本轮已达模型调用轮次上限（${this.maxRounds} 轮）` }
    }
    this.rounds += 1
    return { ok: true }
  }
}
