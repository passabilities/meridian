/**
 * Static Anthropic API list pricing and cost estimation (PURE, no I/O).
 *
 * Meridian proxies Claude Max, so requests are covered by the subscription
 * and never billed per token. The numbers produced here answer a different
 * question: "what would this usage have cost at API list prices?", useful
 * for judging how much value the subscription is delivering.
 *
 * Rates are USD per million tokens, verified against the official pricing
 * docs (platform.claude.com/docs/en/about-claude/pricing, snapshot 2026-07;
 * Haiku 5.5 model overview, released 2026-10-07).
 * Users can override any rate, or add models missing from this table, via
 * the settings page (persisted by pricingStore.ts; overrides win in
 * resolveModelPricing). Cache rates are derived from the input rate unless
 * a model has an explicit exception (Opus 5.5 reads are 0.05×):
 *   - cache read  = 0.10× input
 *   - cache write = 1.25× input (5-minute TTL, the TTL the SDK uses, see
 *     MONITORING.md; 1-hour TTL writes bill at 2×, so if a client opted into
 *     the long TTL this estimate is a floor)
 *
 * Models without a table entry are excluded from the total and surfaced via
 * `unpricedRequestCount` instead of silently costing $0.
 */

import type { RequestMetric, CostEstimate, ModelCostBreakdown } from "./types"

export interface ModelPricing {
  /** USD per 1M uncached input tokens */
  inputPerMTok: number
  /** USD per 1M output tokens */
  outputPerMTok: number
  /** USD per 1M cache-read input tokens */
  cacheReadPerMTok: number
  /** USD per 1M cache-write (creation) input tokens */
  cacheWritePerMTok: number
}

export const CACHE_READ_MULTIPLIER = 0.1
export const CACHE_WRITE_MULTIPLIER = 1.25

/** Normalize a model string for pricing lookup: trimmed, lowercase, [1m] suffix stripped. */
export function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase().replace(/\[1m\]$/, "")
}

function rates(inputPerMTok: number, outputPerMTok: number): ModelPricing {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok: inputPerMTok * CACHE_READ_MULTIPLIER,
    cacheWritePerMTok: inputPerMTok * CACHE_WRITE_MULTIPLIER,
  }
}

const FABLE = rates(10, 50)
const OPUS = rates(5, 25) // Opus 4.5 through 5
// Opus 5.5 cache reads are 5% of input (official model specs, 2026-09-22).
const OPUS_55: ModelPricing = { ...rates(4, 20), cacheReadPerMTok: 0.2 }
const OPUS_LEGACY = rates(15, 75) // Opus 4.1 and earlier
const SONNET_55 = rates(2, 10)
const SONNET = rates(3, 15) // every Sonnet generation to date, standard rate
// Sonnet 5 introductory pricing runs through 2026-08-31; standard 3/15 applies
// from 2026-09-01. Update this entry (or set a settings override) after that.
const SONNET_5_INTRO = rates(2, 10)
// Haiku 5.5 rates apply to the entire request, based on total prompt tokens
// (uncached input + cache reads + cache writes), not input + output tokens.
// Keep the public table/override schema flat; built-in tier selection is internal.
const HAIKU_55: ModelPricing = { ...rates(0.1, 0.5), cacheReadPerMTok: 0.01 }
const HAIKU_55_LONG = rates(0.5, 2.5) // strictly more than 100,000 prompt tokens
const HAIKU = rates(1, 5) // Haiku 4.5 and conservative unknown-family fallback
const HAIKU_35 = rates(0.8, 4)
const HAIKU_3 = rates(0.25, 1.25)

/**
 * Exact-match table. Keys are lowercase, checked after stripping the [1m]
 * suffix. Covers the SDK aliases meridian itself uses (opus, sonnet, ...)
 * plus concrete API model IDs that clients commonly send. Dated snapshot
 * IDs (e.g. claude-haiku-4-5-20251001) fall through to the family rules.
 *
 * Exported for the settings page, which lists these models with their
 * default rates so users can override them. Haiku 5.5 lists its short-prompt
 * rates; estimateRequestCostUsd applies its built-in long-prompt tier.
 */
export const BUILTIN_MODEL_PRICING: Record<string, ModelPricing> = {
  fable: FABLE,
  "claude-fable-5-1": FABLE,
  "claude-fable-5": FABLE,
  "claude-mythos-5-1": FABLE,
  "claude-mythos-5": FABLE,
  opus: OPUS_55,
  "claude-opus-5-5": OPUS_55,
  "claude-opus-5": OPUS,
  "claude-opus-4-8": OPUS,
  "claude-opus-4-7": OPUS,
  "claude-opus-4-6": OPUS,
  "claude-opus-4-5": OPUS,
  "claude-opus-4-1": OPUS_LEGACY,
  "claude-opus-4-0": OPUS_LEGACY,
  "claude-opus-4-20250514": OPUS_LEGACY,
  "claude-3-opus-20240229": OPUS_LEGACY,
  sonnet: SONNET_55,
  "claude-sonnet-5-5": SONNET_55,
  "claude-sonnet-5": SONNET_5_INTRO,
  "claude-sonnet-4-6": SONNET,
  "claude-sonnet-4-5": SONNET,
  haiku: HAIKU_55,
  "claude-haiku-5-5": HAIKU_55,
  "claude-haiku-4-5": HAIKU,
  "claude-3-5-haiku-20241022": HAIKU_35,
  "claude-3-haiku-20240307": HAIKU_3,
}

/**
 * Resolve a model string to pricing. User-defined overrides win, then the
 * exact built-in table, then family fallback so versioned/dated IDs
 * (claude-opus-4-8, claude-haiku-4-5-20251001) and future releases still
 * price at their family's current rate.
 * Returns null for unrecognized models; callers must not treat that as $0.
 */
export function resolveModelPricing(
  model: string,
  overrides?: Record<string, ModelPricing>,
): ModelPricing | null {
  const normalized = normalizeModelKey(model)

  if (overrides) {
    const override = overrides[normalized]
    // Identity marks the built-in tier policy without adding pricing JSON fields.
    // Even an override reusing the exported built-in object must stay flat.
    if (override) return override === HAIKU_55 ? { ...override } : override
  }

  const exact = BUILTIN_MODEL_PRICING[normalized]
  if (exact) return exact

  if (normalized.includes("fable") || normalized.includes("mythos")) return FABLE
  if (normalized.includes("haiku")) {
    // The official ID is dateless; accept dated family IDs defensively, but
    // do not assign 5.5's discount/tier policy to unknown future Haiku versions.
    if (/^(?:anthropic\.)?claude-haiku-5-5(?:-\d{8})?$/.test(normalized)) return HAIKU_55
    if (normalized.includes("3-5") || normalized.includes("3.5")) return HAIKU_35
    if (/haiku-3\b|3-haiku/.test(normalized)) return HAIKU_3
    return HAIKU
  }
  if (normalized.includes("opus")) {
    if (/opus-4-1\b|opus-4-1-|opus-4-0|opus-4-2025|3-opus/.test(normalized)) return OPUS_LEGACY
    return OPUS
  }
  if (normalized.includes("sonnet")) return SONNET

  return null
}

function resolveRequestPricing(
  metric: RequestMetric,
  overrides?: Record<string, ModelPricing>,
): ModelPricing | null {
  const requestKey = metric.requestModel || metric.model
  // An explicit request-key override remains authoritative, even when a
  // recorded effective pin would select another model's rates.
  if (overrides?.[normalizeModelKey(requestKey)]) return resolveModelPricing(requestKey, overrides)
  if (metric.resolvedModel) {
    const resolvedPricing = resolveModelPricing(metric.resolvedModel, overrides)
    if (resolvedPricing !== null) return resolvedPricing
  }
  // Legacy records lack pin evidence. Preserve current alias valuation rather
  // than guessing a historical served model; unknown pins use this fallback too.
  return resolveModelPricing(requestKey, overrides)
}

function pricingForRequest(metric: RequestMetric, pricing: ModelPricing): ModelPricing {
  // Only resolved built-in Haiku 5.5 pricing carries the tier policy. Custom
  // flat rates (even equal-valued ones) must not acquire it from the model ID.
  if (pricing !== HAIKU_55) return pricing
  const promptTokens = (metric.inputTokens ?? 0) +
    (metric.cacheReadInputTokens ?? 0) + (metric.cacheCreationInputTokens ?? 0)
  return promptTokens > 100_000 ? HAIKU_55_LONG : pricing
}

/**
 * Estimated USD for a single request's token usage. Resolved built-in Haiku
 * 5.5 rates include its prompt tier; overrides and other rates remain flat.
 */
export function estimateRequestCostUsd(metric: RequestMetric, pricing: ModelPricing): number {
  pricing = pricingForRequest(metric, pricing)
  return (
    ((metric.inputTokens ?? 0) / 1e6) * pricing.inputPerMTok +
    ((metric.outputTokens ?? 0) / 1e6) * pricing.outputPerMTok +
    ((metric.cacheReadInputTokens ?? 0) / 1e6) * pricing.cacheReadPerMTok +
    ((metric.cacheCreationInputTokens ?? 0) / 1e6) * pricing.cacheWritePerMTok
  )
}

/** Round to micro-dollars to keep JSON output free of float noise. */
function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * Aggregate estimated cost per model across a set of metrics.
 * Grouping key is requestModel || model, matching computeSummary's byModel.
 * Pricing uses a request-key override first, then a known recorded effective
 * SDK pin (resolvedModel), then the request key. Legacy aliases without a pin
 * retain current alias valuation, not actual historical served-model costs.
 * SDK-aggregate prompt tokens select Haiku's tier; this is not exact API billing.
 * Pass overrides (from pricingStore) to apply user-defined rates.
 */
export function computeCostEstimate(
  metrics: RequestMetric[],
  overrides?: Record<string, ModelPricing>,
): CostEstimate {
  const byModel: Record<string, ModelCostBreakdown> = {}
  const byProfile: Record<string, { requests: number; estimatedUsd: number }> = {}
  let totalUsd = 0
  let unpricedRequestCount = 0

  for (const metric of metrics) {
    const modelKey = metric.requestModel || metric.model
    const pricing = resolveRequestPricing(metric, overrides)
    const profileEntry = byProfile[metric.profileId ?? "default"] ??= { requests: 0, estimatedUsd: 0 }
    profileEntry.requests++
    const entry = byModel[modelKey] ??= {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      estimatedUsd: pricing === null ? null : 0,
    }

    entry.requests++
    entry.inputTokens += metric.inputTokens ?? 0
    entry.outputTokens += metric.outputTokens ?? 0
    entry.cacheReadTokens += metric.cacheReadInputTokens ?? 0
    entry.cacheCreationTokens += metric.cacheCreationInputTokens ?? 0

    if (pricing === null) {
      unpricedRequestCount++
      continue
    }
    const cost = estimateRequestCostUsd(metric, pricing)
    entry.estimatedUsd = (entry.estimatedUsd ?? 0) + cost
    profileEntry.estimatedUsd += cost
    totalUsd += cost
  }

  for (const entry of Object.values(byProfile)) {
    entry.estimatedUsd = roundUsd(entry.estimatedUsd)
  }

  for (const entry of Object.values(byModel)) {
    if (entry.estimatedUsd !== null) entry.estimatedUsd = roundUsd(entry.estimatedUsd)
  }

  return { totalUsd: roundUsd(totalUsd), byModel, unpricedRequestCount, byProfile }
}
