/**
 * Publishes this node's runtime catalog (docs/modules/chat.md 3.4) on startup and every 5 minutes
 * through node_report_capabilities. A failed report is logged and retried on the next tick.
 */
import type { CapabilityReporter, CatalogOptions, RuntimeCatalog, RuntimeRegistry } from "../runtime-registry"

export const CAPABILITY_REPORT_INTERVAL_MS = 5 * 60_000

export interface CapabilityReportingOptions {
  registry: RuntimeRegistry
  reporter: CapabilityReporter
  catalog: CatalogOptions
  intervalMs?: number
  signal?: AbortSignal
  logger?: { info(m: string, d?: Record<string, unknown>): void; warn(m: string, d?: Record<string, unknown>): void }
}

/** Reports once (awaited) and then periodically until `signal` aborts. Returns the first catalog, or null if that report failed. */
export async function startCapabilityReporting(options: CapabilityReportingOptions): Promise<RuntimeCatalog | null> {
  const once = async () => {
    try {
      const catalog = await options.registry.report(options.reporter, options.catalog)
      options.logger?.info("capabilities reported", { runtimes: catalog.runtimes.map((r) => r.id), supports_http_sse: catalog.supports_http_sse })
      return catalog
    } catch (error) {
      options.logger?.warn("capability report failed", { error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }
  const first = await once()
  if (!options.signal?.aborted) {
    const timer = setInterval(() => void once(), options.intervalMs ?? CAPABILITY_REPORT_INTERVAL_MS)
    timer.unref?.()
    options.signal?.addEventListener("abort", () => clearInterval(timer), { once: true })
  }
  return first
}
