import Anthropic from "@anthropic-ai/sdk";

/**
 * Cliente Anthropic singleton.
 * O header beta managed-agents-2026-04-01 é setado automaticamente
 * quando você usa client.beta.* — não precisa setar manualmente.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  // Beta header é injetado pelas chamadas .beta.* do SDK.
});

/**
 * Helper: verifica assinatura de webhook usando o signing key.
 * Lança erro se inválida ou fora da janela de freshness.
 */
export async function verifyWebhook(body: string, headers: Headers) {
  // O SDK expõe webhooks.unwrap que valida HMAC + freshness automaticamente.
  // Convertemos Headers → plain object porque o SDK espera Record<string, string>.
  const headerObj: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerObj[key] = value;
  });

  // @ts-expect-error — beta API pode não ter tipos completos ainda
  return anthropic.beta.webhooks.unwrap(body, headerObj);
}
