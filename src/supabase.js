import { createClient } from "@supabase/supabase-js";

const url  = import.meta.env.VITE_SUPABASE_URL;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export async function dbInsertPrice(symbol, price, timestamp) {
  if (!supabase) return;
  await supabase.from("price_history").insert({ symbol, price, timestamp });
}

export async function dbInsertPattern(pattern_name, confidence, detected_at, level = null) {
  if (!supabase) return;
  await supabase.from("patterns").insert({ pattern_name, confidence, detected_at, level: level ?? undefined });
}

export async function dbLoadPriceHistory(symbol, limit = 500) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("price_history")
    .select("id, symbol, price, timestamp")
    .eq("symbol", symbol)
    .order("timestamp", { ascending: true })
    .limit(limit);
  if (error) { console.error("supabase price_history:", error.message); return []; }
  return data ?? [];
}

export async function dbLoadPatterns(limit = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("patterns")
    .select("id, pattern_name, confidence, level, detected_at")
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("supabase patterns:", error.message); return []; }
  return data ?? [];
}
