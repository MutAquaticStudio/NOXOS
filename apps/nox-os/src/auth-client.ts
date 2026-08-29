import type { SupabaseClient } from "@supabase/supabase-js";

export type BrowserAuthConfiguration = {
  url: string;
  publishableKey: string;
};

export function browserAuthConfiguration(
  environment: ImportMetaEnv
): BrowserAuthConfiguration | undefined {
  const url = environment.VITE_SUPABASE_URL;
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return undefined;
  }
  return { url, publishableKey };
}

/** The only browser-to-Supabase path: session and identity lifecycle. */
export async function createBrowserAuthClient(
  configuration: BrowserAuthConfiguration | undefined
): Promise<SupabaseClient | undefined> {
  if (!configuration) {
    return undefined;
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(configuration.url, configuration.publishableKey);
}
