// ============================================================
// Tabela de preços oficiais da Anthropic (USD por 1M tokens)
// Verificado em abril/2026.
// ============================================================
// Fontes: páginas de pricing oficiais da Anthropic; valores estáveis
// em todo 2026. Output custa 5x input em toda a geração atual.
// ============================================================

export type PricingUSD = { in: number; out: number; family: string };

export const MODEL_PRICING_USD: Record<string, PricingUSD> = {
  // Geração atual
  "claude-opus-4-7":             { in: 5.0,  out: 25.0, family: "Opus" },
  "claude-opus-4-6":             { in: 5.0,  out: 25.0, family: "Opus" },
  "claude-sonnet-4-6":           { in: 3.0,  out: 15.0, family: "Sonnet" },
  "claude-haiku-4-5":            { in: 1.0,  out: 5.0,  family: "Haiku" },
  "claude-haiku-4-5-20251001":   { in: 1.0,  out: 5.0,  family: "Haiku" },
  // Geração anterior (legado)
  "claude-opus-4-5":             { in: 5.0,  out: 25.0, family: "Opus" },
  "claude-sonnet-4-5":           { in: 3.0,  out: 15.0, family: "Sonnet" },
  "claude-opus-4-1":             { in: 15.0, out: 75.0, family: "Opus" },
  "claude-opus-4":               { in: 15.0, out: 75.0, family: "Opus" },
  "claude-sonnet-4":             { in: 3.0,  out: 15.0, family: "Sonnet" },
};

// Fallback conservador quando o modelo não está mapeado
const FALLBACK: PricingUSD = { in: 5.0, out: 25.0, family: "Opus (fallback)" };

export function priceForModel(model: string | null | undefined): PricingUSD {
  if (!model) return FALLBACK;
  if (MODEL_PRICING_USD[model]) return MODEL_PRICING_USD[model];
  // tenta casar por família (qualquer claude-opus-* etc.)
  const m = model.toLowerCase();
  if (m.includes("haiku")) return { in: 1.0, out: 5.0, family: "Haiku" };
  if (m.includes("sonnet")) return { in: 3.0, out: 15.0, family: "Sonnet" };
  if (m.includes("opus")) return { in: 5.0, out: 25.0, family: "Opus" };
  return FALLBACK;
}

// Custo em USD para um par (tokens_in, tokens_out) sob um modelo
export function computeCostUSD(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  const p = priceForModel(model);
  return (
    (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out
  );
}
