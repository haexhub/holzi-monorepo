/**
 * Plan 27: static per-model pricing for the Insights cost-estimate tile.
 *
 * Cost = tokens * rate / 1e6 (rates are USD per million tokens).
 *
 * Not pulled from any live API — providers don't publish a stable price
 * endpoint and prices change slowly. Users who run an alternative model
 * (Ollama, a self-hosted mirror) can either add an entry here or accept
 * the "—" fallback the Insights page shows for unknown ids.
 *
 * Sources (re-check before bumping numbers):
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - OpenAI:    https://openai.com/api/pricing
 *   - Google:    https://ai.google.dev/pricing
 *
 * last verified: 2026-05-31
 */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  input_per_1m: number
  /** USD per 1M output tokens. */
  output_per_1m: number
}

// Keep keys aligned with whatever string ends up in `agent_runs.model` —
// for Anthropic-OAuth that's the curated short aliases in the backend's
// `provider_models.ANTHROPIC_OAUTH_MODELS`; for API-key providers it's
// whatever the upstream returns. A mismatch silently misses and the
// cost cell renders "—", which is honest but easy to overlook.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude 4.x — Opus tier dropped from 3.x's $15/$75 to $5/$25.
  'claude-opus-4-7': { input_per_1m: 5, output_per_1m: 25 },
  'claude-sonnet-4-6': { input_per_1m: 3, output_per_1m: 15 },
  'claude-haiku-4-5': { input_per_1m: 1, output_per_1m: 5 },

  // OpenAI flagship + smaller siblings. gpt-4o standard rate dropped to
  // $2.50/$10; gpt-4-turbo legacy rate kept for older deployments.
  'gpt-4o': { input_per_1m: 2.5, output_per_1m: 10 },
  'gpt-4o-mini': { input_per_1m: 0.15, output_per_1m: 0.6 },
  'gpt-4-turbo': { input_per_1m: 10, output_per_1m: 30 },

  // Google Gemini 1.5 — using the ≤128k tier (>128k doubles both rates).
  // Newer Gemini 3.x is unlisted here; add when the backend starts
  // surfacing those model ids.
  'gemini-1.5-pro': { input_per_1m: 1.25, output_per_1m: 5 },
  'gemini-1.5-flash': { input_per_1m: 0.075, output_per_1m: 0.3 },
}

/** Strip a trailing `-YYYYMMDD` snapshot suffix so a versioned model id
 *  still matches its short-alias pricing entry. Returns the input
 *  unchanged when no suffix is present. */
function normalisedModelId(model: string): string {
  return model.replace(/-\d{8}$/, '')
}

export function estimateCostUsd(
  model: string,
  input_tokens: number,
  output_tokens: number,
): number | null {
  const rate =
    MODEL_PRICING[model] ?? MODEL_PRICING[normalisedModelId(model)]
  if (!rate) return null
  return (
    (input_tokens * rate.input_per_1m + output_tokens * rate.output_per_1m) /
    1_000_000
  )
}

/**
 * Aggregate a per-model breakdown into a single USD figure. Returns null
 * when no row matches a known model (so the tile renders "—" rather than
 * misleading $0.00).
 */
export function estimateTotalCostUsd(
  breakdown: ReadonlyArray<{
    model: string
    input_tokens: number
    output_tokens: number
  }>,
): number | null {
  let total = 0
  let matched = false
  for (const row of breakdown) {
    const cost = estimateCostUsd(row.model, row.input_tokens, row.output_tokens)
    if (cost !== null) {
      matched = true
      total += cost
    }
  }
  return matched ? total : null
}
