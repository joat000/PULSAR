// Scheduled Netlify function — runs every 15 min Mon–Fri during NYSE hours
// Schedule: */15 13-20 * * 1-5  (13:00–20:59 UTC = ~9:00am–4:59pm ET)
import { createClient } from "@supabase/supabase-js";

const FINNHUB_KEY = process.env.VITE_FINNHUB_KEY || "d8ongu9r01qn89hse3p0d8ongu9r01qn89hse3pg";
const SYMBOL = "SPCX";

export const config = {
  schedule: "*/15 13-20 * * 1-5",
};

export default async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env vars");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch current quote from Finnhub
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${SYMBOL}&token=${FINNHUB_KEY}`
  );
  if (!res.ok) {
    console.error(`Finnhub error: ${res.status}`);
    return;
  }

  const data = await res.json();
  const price = data?.c;
  if (!price) {
    console.error("No price in Finnhub response", data);
    return;
  }

  const timestamp = new Date().toISOString();
  const { error } = await supabase
    .from("price_history")
    .insert({ symbol: SYMBOL, price: parseFloat(price.toFixed(2)), timestamp });

  if (error) {
    console.error("Supabase insert error:", error.message);
  } else {
    console.log(`Stored ${SYMBOL} $${price} at ${timestamp}`);
  }
};
