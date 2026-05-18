import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente Supabase para uso no SERVER (Server Components, Route Handlers).
 * Lê cookies p/ identificar o usuário autenticado.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component context — pode ignorar
          }
        },
      },
    }
  );
}

/**
 * Cliente Supabase com SERVICE ROLE — bypassa RLS.
 * Use só pra orchestrator/webhook que precisam fazer escritas.
 * NUNCA exponha no client-side.
 */
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    }
  );
}
