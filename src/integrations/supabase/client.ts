import { createClient } from "@supabase/supabase-js";
import { mockSupabase } from "./mockClient";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Use real Supabase when env vars are set, otherwise fall back to demo/mock mode
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (mockSupabase as any);

export const isDemoMode = !(supabaseUrl && supabaseAnonKey);
