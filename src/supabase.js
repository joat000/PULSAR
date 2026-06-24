import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export async function dbInsertPrice(symbol, price, timestamp) {
  if (!supabase) return;
  await supabase.from("price_history").insert({ symbol, price, timestamp });
}

// Load price history for a specific time range from Supabase.
// Returns rows sorted ascending (oldest first) so they can be appended to DB.
export async function dbLoadPriceHistory(symbol, fromIso, toIso, limit = 5000) {
  if (!supabase) return [];
  let q = supabase
    .from("price_history")
    .select("id, symbol, price, timestamp")
    .eq("symbol", symbol)
    .order("timestamp", { ascending: true })
    .limit(limit);

  if (fromIso) q = q.gte("timestamp", fromIso);
  if (toIso)   q = q.lte("timestamp", toIso);

  const { data, error } = await q;
  if (error) { console.error("supabase price_history:", error.message); return []; }
  return data ?? [];
}
