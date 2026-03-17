import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemoMode = !(supabaseUrl && supabaseAnonKey);

// Module-level singleton — only one instance ever created per page load.
// In production: env vars are baked in by Vite, the else branch is dead code
// and eliminated by Rollup, so no top-level await remains in the bundle.
let _supabase: any;

if (supabaseUrl && supabaseAnonKey) {
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn(),
    },
  });
} else {
  const { mockSupabase } = await import("./mockClient");
  _supabase = mockSupabase;
}

export const supabase = _supabase;
