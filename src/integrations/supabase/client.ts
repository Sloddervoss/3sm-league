import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isDemoMode = !(supabaseUrl && supabaseAnonKey);

let _supabase: any;

if (supabaseUrl && supabaseAnonKey) {
  _supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // Only import mock in demo mode — avoids auth side effects in production
  const { mockSupabase } = await import("./mockClient");
  _supabase = mockSupabase;
}

export const supabase = _supabase;
