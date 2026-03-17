import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemoMode = !(supabaseUrl && supabaseAnonKey);

// Use a global singleton to prevent multiple client instances competing for Web Locks.
// This can happen with HMR, React re-renders, or dynamic imports creating duplicate clients.
declare global {
  // eslint-disable-next-line no-var
  var __supabaseClient: any;
}

if (!globalThis.__supabaseClient) {
  if (supabaseUrl && supabaseAnonKey) {
    globalThis.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  } else {
    // Demo mode: async load mock client (only in dev without env vars)
    import("./mockClient").then(({ mockSupabase }) => {
      globalThis.__supabaseClient = mockSupabase;
    });
  }
}

export const supabase = new Proxy({} as any, {
  get(_target, prop: string) {
    return globalThis.__supabaseClient?.[prop];
  },
});
