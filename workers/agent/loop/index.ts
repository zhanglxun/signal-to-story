/**
 * Agent loop core (moved from sense-console/src/harness in R2, 2026-11-24).
 * Pure logic: no process.env, no network, no imports from ../drivers or ../entry
 * (enforced by eslint no-restricted-imports). Real model / CLI implementations live in ../drivers.
 */
export * from "./context-pack"
export * from "./injection"
export * from "./job-store"
export * from "./llm"
export * from "./llm-evaluator"
export * from "./loop-controller"
export * from "./mandate"
export * from "./precheck"
export * from "./providers"
