import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemoMode = !(supabaseUrl && supabaseAnonKey);

// In production: env vars are constant strings baked in by Vite.
// Rollup eliminates the else branch (dead code), so no top-level await remains.
// In demo mode: mock client loaded via dynamic import (no side effects in production).
let _supabase: any;

if (supabaseUrl && supabaseAnonKey) {
  _supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  const { mockSupabase } = await import("./mockClient");
  _supabase = mockSupabase;
}

export const supabase = _supabase;
