import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { dbInsertPrice, dbLoadPriceHistory } from "./supabase.js";

// ── Config ──────────────────────────────────────────────────────────────────
const FINNHUB_KEY = "d8ongu9r01qn89hse3p0d8ongu9r01qn89hse3pg";
const SYMBOL = "SPCX";
const POLL_MS = 15000; // 15s refresh (Finnhub free: 60 calls/min)

// ── In-memory DB ─────────────────────────────────────────────────────────────
const DB = {
  stocks: [{ id: 1, symbol: SYMBOL, company_name: "SpaceX" }],
  price_history: [],
  nextId: 1,
};

function insertPrice(price, timestamp) {
  const ts = timestamp || new Date().toISOString();
  if (DB.price_history.length > 0) {
    const last = DB.price_history[DB.price_history.length - 1];
    if (last.price === price && last.timestamp.slice(0, 16) === ts.slice(0, 16)) return;
  }
  const record = {
    id: DB.nextId++,
    stock_id: 1,
    symbol: SYMBOL,
    price: parseFloat(price.toFixed(2)),
    timestamp: ts,
  };
  DB.price_history.push(record);
  // Persist to Supabase (fire-and-forget)
  dbInsertPrice(SYMBOL, record.price, ts);
}


function getHistoryForRange(range) {
  const now = Date.now();
  const cutoffs = { "1D": 864e5, "1W": 6048e5, "1M": 2592e6, ALL: Infinity };
  const ms = cutoffs[range] ?? Infinity;
  return DB.price_history.filter(r => now - new Date(r.timestamp).getTime() <= ms);
}

// ── Finnhub API ───────────────────────────────────────────────────────────────
async function fetchQuote() {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${SYMBOL}&token=${FINNHUB_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
  // returns { c: current, d: change, dp: changePct, h: high, l: low, o: open, pc: prevClose, t: timestamp }
}

async function fetchCandles(resolution, from, to) {
  const res = await fetch(
    `https://finnhub.io/api/v1/stock/candle?symbol=${SYMBOL}&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
  // returns { c:[], h:[], l:[], o:[], t:[], v:[], s:"ok"|"no_data" }
}

async function fetchProfile() {
  const res = await fetch(
    `https://finnhub.io/api/v1/stock/profile2?symbol=${SYMBOL}&token=${FINNHUB_KEY}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}


// ── Formatters ────────────────────────────────────────────────────────────────
const fmt2 = n => n?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—";
const fmtDate = iso => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function xTick(iso, range) {
  if (range === "1D") return fmtTime(iso);
  if (range === "ALL") return new Date(iso).toLocaleDateString([], { month: "short", year: "2-digit" });
  return fmtDate(iso);
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, range, startPrice }) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  const delta = startPrice ? val - startPrice : null;
  const deltaUp = delta >= 0;
  return (
    <div style={{ background: "#0b1220", border: "1px solid #1e2d50", borderRadius: 10, padding: "10px 16px", boxShadow: "0 8px 24px #00000066" }}>
      <div style={{ color: "#6b7280", fontSize: 10, marginBottom: 4, letterSpacing: 1 }}>{xTick(label, range)}</div>
      <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 18, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: "-0.5px" }}>${fmt2(val)}</div>
      {delta !== null && (
        <div style={{ fontSize: 11, color: deltaUp ? "#34d399" : "#f87171", marginTop: 3 }}>
          {deltaUp ? "▲" : "▼"} {deltaUp && delta > 0 ? "+" : ""}{fmt2(delta)} from open
        </div>
      )}
    </div>
  );
}


function StatCard({ label, value, sub, accent, flash }) {
  return (
    <div className={`card${flash === "up" ? " flash-up" : flash === "down" ? " flash-down" : ""}`}
      style={{ padding: "18px 22px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: accent || "radial-gradient(circle,#1e1040,transparent)", opacity: 0.6 }} />
      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LoadingPulse() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 260, gap: 12, color: "#6b7280", fontSize: 13 }}>
      <div style={{ width: 14, height: 14, border: "2px solid #7c3aed", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
      Fetching live data from Finnhub…
    </div>
  );
}

function ErrorBanner({ msg, onRetry }) {
  return (
    <div style={{ background: "#1a0a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "#f87171" }}>⚠ {msg}</span>
      <button onClick={onRetry} style={{ background: "#7f1d1d", border: "none", color: "#fca5a5", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Retry</button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function Pulsar() {
  const [quote, setQuote] = useState(null);           // Finnhub quote object
  const [profile, setProfile] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [range, setRange] = useState("1D");
  const [flash, setFlash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [marketStatus, setMarketStatus] = useState("—");
  const prevPriceRef = useRef(null);
  const pollRef = useRef(null);

  // ── Load candle history for selected range ────────────────────────────────
  const loadCandles = useCallback(async (r) => {
    setChartLoading(true);
    const now = Math.floor(Date.now() / 1000);
    const ranges = {
      "1D": { from: now - 86400,      resolution: "5"  },
      "1W": { from: now - 604800,     resolution: "30" },
      "1M": { from: now - 2592000,    resolution: "D"  },
      "ALL": { from: now - 31536000,  resolution: "W"  },
    };
    const { from, resolution } = ranges[r] || ranges["1D"];
    try {
      const data = await fetchCandles(resolution, from, now);
      if (data.s === "ok" && data.t?.length) {
        const points = data.t.map((ts, i) => ({
          time: new Date(ts * 1000).toISOString(),
          price: parseFloat(data.c[i].toFixed(2)),
        }));
        setChartData(points);
        points.forEach(p => insertPrice(p.price, p.time));
      } else {
        // Fall back to DB history
        const hist = getHistoryForRange(r);
        setChartData(hist.map(h => ({ time: h.timestamp, price: h.price })));
      }
    } catch (e) {
      console.error("Candle fetch failed:", e);
      const hist = getHistoryForRange(r);
      setChartData(hist.map(h => ({ time: h.timestamp, price: h.price })));
    }
    setChartLoading(false);
  }, []);

  // ── Fetch live quote ──────────────────────────────────────────────────────
  const fetchLive = useCallback(async () => {
    try {
      const q = await fetchQuote();
      if (!q?.c) throw new Error("No price data returned");

      const prev = prevPriceRef.current;
      if (prev !== null) {
        setFlash(q.c >= prev ? "up" : "down");
        setTimeout(() => setFlash(null), 800);
      }
      prevPriceRef.current = q.c;

      setQuote(q);
      setError(null);
      setLastUpdated(new Date());

      insertPrice(q.c);

      // Market status
      const hour = new Date().getUTCHours();
      const min = new Date().getUTCMinutes();
      const totalMin = hour * 60 + min;
      // NYSE: 14:30–21:00 UTC
      if (totalMin >= 870 && totalMin <= 1260) setMarketStatus("Open");
      else if (totalMin >= 810 && totalMin < 870) setMarketStatus("Pre-Market");
      else setMarketStatus("After Hours");

    } catch (e) {
      setError(`Failed to fetch price: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);

      const rows = await dbLoadPriceHistory(SYMBOL, 500);
      rows.forEach(r => {
        DB.price_history.push({ id: DB.nextId++, stock_id: 1, symbol: r.symbol, price: parseFloat(r.price), timestamp: r.timestamp });
      });

      try {
        const [, p] = await Promise.all([fetchLive(), fetchProfile()]);
        setProfile(p);
      } catch {}
      await loadCandles("1D");
    })();
  }, [fetchLive, loadCandles]);

  // ── Poll quote every 15s ──────────────────────────────────────────────────
  useEffect(() => {
    pollRef.current = setInterval(fetchLive, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [fetchLive]);

  // ── Range change ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadCandles(range);
  }, [range, loadCandles]);

  // ── Derived values ────────────────────────────────────────────────────────
  const price     = quote?.c ?? null;
  const change    = quote?.d ?? null;
  const changePct = quote?.dp ?? null;
  const open      = quote?.o ?? null;
  const high      = quote?.h ?? null;
  const low       = quote?.l ?? null;
  const prevClose = quote?.pc ?? null;
  const isUp      = (change ?? 0) >= 0;

  const mktCap = profile?.marketCapitalization
    ? `$${(profile.marketCapitalization / 1000).toFixed(1)}T`
    : "—";

  const minP = chartData.length ? Math.min(...chartData.map(d => d.price)) : (price ?? 170) - 10;
  const maxP = chartData.length ? Math.max(...chartData.map(d => d.price)) : (price ?? 170) + 10;
  const pad  = Math.max((maxP - minP) * 0.1, 2);

  const RANGES = ["1D","1W","1M","ALL"];

  const stars = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    key: i,
    size: Math.random() > 0.88 ? 2 : 1,
    opacity: 0.08 + Math.random() * 0.45,
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    dur: `${2.5 + Math.random() * 5}s`,
    delay: `${Math.random() * 5}s`,
  })), []);

  return (
    <div style={{ minHeight: "100vh", background: "#060a12", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif", overflowX: "hidden" }}>

      {/* Stars */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        {stars.map(s => (
          <div key={s.key} style={{
            position: "absolute",
            width: s.size, height: s.size,
            borderRadius: "50%",
            background: "#fff",
            opacity: s.opacity,
            top: s.top, left: s.left,
            animation: `twinkle ${s.dur} ease-in-out infinite`,
            animationDelay: s.delay,
          }} />
        ))}
        <div style={{ position: "absolute", top: "10%", left: "60%", width: 400, height: 300, background: "radial-gradient(ellipse,#7c3aed08,transparent 70%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: "20%", left: "5%", width: 300, height: 200, background: "radial-gradient(ellipse,#1d4ed808,transparent 70%)", borderRadius: "50%" }} />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
        @keyframes twinkle { 0%,100%{opacity:.05} 50%{opacity:.6} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes flash-up   { 0%{background:#064e3b66} 100%{background:transparent} }
        @keyframes flash-down { 0%{background:#7f1d1d55} 100%{background:transparent} }
        @keyframes glow-pulse { 0%,100%{box-shadow:0 0 6px #7c3aed33} 50%{box-shadow:0 0 18px #7c3aed77,0 0 32px #7c3aed22} }
        @keyframes dot-pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:.5} }
        .card { background:linear-gradient(145deg,#0b1220dd,#0e1628dd); border:1px solid #161f35; border-radius:14px; backdrop-filter:blur(8px); transition:border-color .2s; }
        .card:hover { border-color:#1e2d50; }
        .flash-up   { animation:flash-up   .8s ease-out; }
        .flash-down { animation:flash-down .8s ease-out; }
::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:#060a12} ::-webkit-scrollbar-thumb{background:#161f35;border-radius:2px}
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1120, margin: "0 auto", padding: "20px 14px 52px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#6d28d9,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, animation: "glow-pulse 3s ease-in-out infinite", flexShrink: 0 }}>✦</div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.5px", background: "linear-gradient(90deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                PULSAR
              </div>
              <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 2.5, textTransform: "uppercase" }}>Live Market Intelligence</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: marketStatus === "Open" ? "#34d399" : "#fbbf24", boxShadow: `0 0 8px ${marketStatus === "Open" ? "#34d399" : "#fbbf24"}`, animation: "dot-pulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>{marketStatus} · SPCX</span>
          </div>
        </div>

        {error && <ErrorBanner msg={error} onRetry={fetchLive} />}

        {/* ── Price hero ── */}
        <div className={`card${flash === "up" ? " flash-up" : flash === "down" ? " flash-down" : ""}`}
          style={{ padding: "24px 28px", marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: 2 }}>SpaceX · NASDAQ</span>
              <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 5, padding: "1px 8px", fontSize: 10, fontWeight: 700, color: "#6366f1", letterSpacing: 1 }}>SPCX</span>
            </div>
            {loading ? (
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 48, fontWeight: 700, color: "#1e2d50", letterSpacing: "-2px" }}>—</div>
            ) : (
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 48, fontWeight: 700, letterSpacing: "-2px", color: "#f8fafc" }}>
                ${fmt2(price)}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              {change !== null && (
                <>
                  <span style={{ fontSize: 15, fontWeight: 600, color: isUp ? "#34d399" : "#f87171" }}>
                    {isUp ? "▲" : "▼"} {isUp && change > 0 ? "+" : ""}{fmt2(change)} ({isUp && changePct > 0 ? "+" : ""}{changePct?.toFixed(2)}%)
                  </span>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>vs prev close</span>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", textAlign: "right" }}>
            {[["Open", fmt2(open)], ["Prev Close", fmt2(prevClose)], ["High", fmt2(high)], ["Low", fmt2(low)]].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1.2 }}>{l}</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>${v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 20 }}>
          <StatCard label="Market Cap" value={mktCap} sub={profile?.name ?? "Space Exploration Technologies"} accent="radial-gradient(circle,#4c1d9522,transparent)" />
          <StatCard label="Day High" value={quote?.h ? `$${fmt2(quote.h)}` : "—"} sub="Intraday high" accent="radial-gradient(circle,#14532d22,transparent)" />
          <StatCard label="Day Low" value={quote?.l ? `$${fmt2(quote.l)}` : "—"} sub="Intraday low" accent="radial-gradient(circle,#7f1d1d22,transparent)" />
          <StatCard label="Last Update" value={lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} sub={`Polls every ${POLL_MS / 1000}s`} accent="radial-gradient(circle,#1e3a5f22,transparent)" />
        </div>

        {/* ── Chart ── */}
        <div className="card" style={{ padding: "22px 22px 14px", marginBottom: 18 }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>Price Chart · SPCX</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>
                  {price ? `$${fmt2(price)}` : "—"}
                </div>
                {chartData.length >= 2 && (() => {
                  const first = chartData[0].price;
                  const last  = chartData[chartData.length - 1].price;
                  const d = last - first;
                  const dp = (d / first) * 100;
                  const up = d >= 0;
                  return (
                    <span style={{ fontSize: 12, fontWeight: 600, color: up ? "#34d399" : "#f87171" }}>
                      {up ? "▲" : "▼"} {up && d > 0 ? "+" : ""}{fmt2(d)} ({up && dp > 0 ? "+" : ""}{dp.toFixed(2)}%) {range}
                    </span>
                  );
                })()}
              </div>
            </div>
            {/* Range buttons */}
            <div style={{ display: "flex", gap: 6, background: "#080d18", borderRadius: 10, padding: 4 }}>
              {RANGES.map(r => (
                <button key={r} onClick={() => setRange(r)} style={{
                  background: range === r ? "linear-gradient(135deg,#170d38,#0f1a35)" : "transparent",
                  border: range === r ? "1px solid #5b21b6" : "1px solid transparent",
                  color: range === r ? "#a78bfa" : "#4b5563",
                  cursor: "pointer", borderRadius: 7, padding: "5px 14px",
                  fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                  letterSpacing: 0.5, transition: "all .15s",
                  boxShadow: range === r ? "0 0 10px #7c3aed22" : "none",
                }}>{r}</button>
              ))}
            </div>
          </div>

          {chartLoading || loading ? <LoadingPulse /> : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  {/* Dynamic stroke: green if range is up, red if down */}
                  {(() => {
                    const first = chartData[0]?.price ?? 0;
                    const last  = chartData[chartData.length - 1]?.price ?? 0;
                    const up = last >= first;
                    const c1 = up ? "#059669" : "#dc2626";
                    const c2 = up ? "#34d399" : "#f87171";
                    const f1 = up ? "#059669" : "#dc2626";
                    return (
                      <>
                        <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor={c1} />
                          <stop offset="100%" stopColor={c2} />
                        </linearGradient>
                        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={f1} stopOpacity={0.2} />
                          <stop offset="85%" stopColor={f1} stopOpacity={0.02} />
                          <stop offset="100%" stopColor={f1} stopOpacity={0} />
                        </linearGradient>
                      </>
                    );
                  })()}
                </defs>
                <CartesianGrid vertical={false} stroke="#0f172a" strokeDasharray="0" />
                <XAxis dataKey="time" tickFormatter={v => xTick(v, range)} tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={60} dy={6} />
                <YAxis domain={[minP - pad, maxP + pad]} tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} width={56} />
                <Tooltip content={<ChartTooltip range={range} startPrice={chartData[0]?.price} />} cursor={{ stroke: "#1e2d50", strokeWidth: 1, strokeDasharray: "4 3" }} />
                {price && <ReferenceLine y={price} stroke="#1e2d5088" strokeDasharray="3 4" label={{ value: `$${fmt2(price)}`, position: "right", fill: "#4b5563", fontSize: 9 }} />}
                <Area type="monotone" dataKey="price" stroke="url(#strokeGrad)" strokeWidth={2} fill="url(#areaFill)" dot={false} activeDot={{ r: 5, fill: "#a78bfa", stroke: "#1e1040", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}

          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 10, color: "#374151" }}>
            <span>{chartData.length} data points</span>
            <span>Finnhub · 15-min delayed outside market hours</span>
          </div>
        </div>

{/* ── Price history table ── */}
        <div className="card" style={{ padding: "22px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16 }}>◧ Price Record Log</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["ID", "Symbol", "Price", "Timestamp"].map(h => (
                    <th key={h} style={{ textAlign: "left", color: "#6b7280", fontWeight: 600, padding: "7px 12px", borderBottom: "1px solid #1e293b", letterSpacing: 1, fontSize: 10, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...DB.price_history].reverse().slice(0, 15).map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #080d18" }}>
                    <td style={{ padding: "8px 12px", color: "#4b5563", fontVariantNumeric: "tabular-nums" }}>{r.id}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <span style={{ background: "#0f0a2e", color: "#7c6bc4", borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>{r.symbol}</span>
                    </td>
                    <td style={{ padding: "8px 12px", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, color: "#818cf8", fontVariantNumeric: "tabular-nums" }}>${fmt2(r.price)}</td>
                    <td style={{ padding: "8px 12px", color: "#6b7280", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>{r.timestamp.replace("T"," ").slice(0,19)} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: "#4b5563" }}>
            {DB.price_history.length} total records · append-only · no overwrites · sourced from Finnhub
          </div>
        </div>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: "#4b5563", letterSpacing: 1.5 }}>
          PULSAR · SPCX · DATA BY FINNHUB · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
