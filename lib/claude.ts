import Anthropic from "@anthropic-ai/sdk";

/**
 * Cliente Anthropic singleton.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

/**
 * Namespace beta como `any`. Os types da Managed Agents beta ainda
 * estão evoluindo no SDK; use este export em vez de `anthropic.beta.*`
 * para evitar erros de TypeScript sem perder funcionalidade em runtime.
 */
export const beta: any = anthropic.beta;

/**
 * Verifica assinatura HMAC do webhook.
 * Throws se inválida ou expirada.
 */
export async function verifyWebhook(body: string, headers: Headers) {
  const headerObj: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerObj[key] = value;
  });
  return beta.webhooks.unwrap(body, headerObj);
}
