// Supabase browser client initializer for ORLIXA AI
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function getRuntimeConfig() {
  const cfg = window.ORLIXA_CONFIG || {};
  return {
    supabaseUrl: (cfg.SUPABASE_URL || "").trim(),
    supabaseAnonKey: (cfg.SUPABASE_ANON_KEY || "").trim(),
    backendApiUrl: (cfg.BACKEND_API_URL || "").trim().replace(/\/+$/, ""),
  };
}

export function isSupabaseConfigured() {
  const { supabaseUrl, supabaseAnonKey } = getRuntimeConfig();
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseAnonKey) &&
    !supabaseUrl.includes("your-project-ref") &&
    !supabaseAnonKey.includes("your-supabase-anon")
  );
}

let cachedClient = null;

export function getSupabaseClient() {
  if (cachedClient) return cachedClient;
  const { supabaseUrl, supabaseAnonKey } = getRuntimeConfig();
  if (!isSupabaseConfigured()) {
    return null;
  }
  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cachedClient;
}
