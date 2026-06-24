import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export async function dbInsertPrice(symbol, price, timestamp) {
  if (!supabase) return;
  await supabase.from("price_history").insert({ symbol, price, timestamp });
}

// Paginated loader — fetches ALL rows in chunks of 1000
// (Supabase PostgREST silently caps at 1000 per request)
export async function dbLoadPriceHistory(symbol, fromIso, toIso) {
  if (!supabase) return [];

  const PAGE = 1000;
  let all = [];
  let from = 0;

  while (true) {
    let q = supabase
      .from("price_history")
      .select("id, symbol, price, timestamp")
      .eq("symbol", symbol)
      .order("timestamp", { ascending: true })
      .range(from, from + PAGE - 1);

    if (fromIso) q = q.gte("timestamp", fromIso);
    if (toIso)   q = q.lte("timestamp", toIso);

    const { data, error } = await q;
    if (error) { console.error("supabase price_history:", error.message); break; }
    if (!data?.length) break;

    all = all.concat(data);
    if (data.length < PAGE) break; // last page
    from += PAGE;
  }

  return all;
}
