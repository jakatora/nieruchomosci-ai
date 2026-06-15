/**
 * Cennik modeli Claude (USD za 1 mln tokenów) — do monitoringu kosztów AI.
 * Wartości orientacyjne; zweryfikuj z aktualnym cennikiem Anthropic.
 */
export const MODEL_PRICING = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
};

const DEFAULT_PRICING = MODEL_PRICING['claude-haiku-4-5'];

/** Koszt pojedynczego wywołania AI w USD. */
export function costUsd(model, inputTokens = 0, outputTokens = 0) {
  const price = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * price.input
    + (outputTokens / 1_000_000) * price.output;
}
