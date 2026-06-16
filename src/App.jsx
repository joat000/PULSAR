import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LineChart, Line, Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { dbInsertPrice, dbInsertPattern, dbLoadPriceHistory, dbLoadPatterns } from "./supabase.js";

// ── Config ──────────────────────────────────────────────────────────────────
const FINNHUB_KEY = "d8ongu9r01qn89hse3p0d8ongu9r01qn89hse3pg";
const SYMBOL = "SPCX";
const POLL_MS = 15000; // 15s refresh (Finnhub free: 60 calls/min)

// ── In-memory DB ─────────────────────────────────────────────────────────────
const DB = {
  stocks: [{ id: 1, symbol: SYMBOL, company_name: "SpaceX" }],
  price_history: [], // { id, stock_id, symbol, price, timestamp }
  patterns: [],
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

function insertPattern(p) {
  DB.patterns.unshift({ id: DB.nextId++, stock_id: 1, ...p });
  if (DB.patterns.length > 30) DB.patterns.pop();
  // Persist to Supabase (fire-and-forget)
  dbInsertPattern(p.pattern_name, p.confidence, p.detected_at, p.level ?? null);
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

// ── Pattern analyser ──────────────────────────────────────────────────────────
function analysePatterns(history) {
  if (history.length < 10) return [];
  const prices = history.map(h => h.price);
  const last = prices.slice(-20);
  const results = [];

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const first10 = avg(last.slice(0, Math.min(10, last.length)));
  const last10 = avg(last.slice(-Math.min(10, last.length)));
  const slope = last10 - first10;

  if (slope > 1.5) results.push({ pattern_name: "Uptrend", confidence: Math.min(95, 58 + Math.abs(slope) * 4 | 0), detected_at: new Date().toISOString() });
  if (slope < -1.5) results.push({ pattern_name: "Downtrend", confidence: Math.min(95, 58 + Math.abs(slope) * 4 | 0), detected_at: new Date().toISOString() });

  const max20 = Math.max(...last);
  const min20 = Math.min(...last);
  const currentPrice = last[last.length - 1];

  if ((max20 - min20) > 5 && currentPrice > max20 - 2) {
    results.push({ pattern_name: "Breakout", confidence: 70, detected_at: new Date().toISOString() });
  }

  const support = parseFloat((min20 + 0.3).toFixed(2));
  results.push({ pattern_name: "Support Level", confidence: 63, detected_at: new Date().toISOString(), level: support });

  const resistance = parseFloat((max20 - 0.3).toFixed(2));
  results.push({ pattern_name: "Resistance Level", confidence: 66, detected_at: new Date().toISOString(), level: resistance });

  if (last.length >= 6) {
    const mid = Math.floor(last.length / 2);
    const firstHalf = avg(last.slice(0, mid));
    const secondHalf = avg(last.slice(mid));
    if (Math.abs(firstHalf - secondHalf) < 1.5) {
      results.push({ pattern_name: "Consolidation", confidence: 61, detected_at: new Date().toISOString() });
    }
  }

  return results;
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt2 = n => n?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—";
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = iso => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

function xTick(iso, range) {
  if (range === "1D") return fmtTime(iso);
  if (range === "ALL") return new Date(iso).toLocaleDateString([], { month: "short", year: "2-digit" });
  return fmtDate(iso);
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, range }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#080d18", border: "1px solid #2d1f6e", borderRadius: 8, padding: "8px 14px" }}>
      <div style={{ color: "#8b7fd4", fontSize: 11, marginBottom: 2 }}>{xTick(label, range)}</div>
      <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15 }}>${fmt2(payload[0]?.value)}</div>
    </div>
  );
}

function ConfBar({ value }) {
  const color = value >= 80 ? "#34d399" : value >= 65 ? "#a78bfa" : "#60a5fa";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 3, background: "#111827", borderRadius: 2 }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 2, transition: "width .8s ease" }} />
      </div>
      <span style={{ fontSize: 11, color, minWidth: 32, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{value}%</span>
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
  const [patterns, setPatterns] = useState([]);
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
        // Seed DB from candle history (inserts only)
        points.forEach(p => insertPrice(p.price, p.time));
        const pats = analysePatterns(DB.price_history);
        pats.forEach(p => insertPattern(p));
        setPatterns([...DB.patterns.slice(0, 6)]);
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

      // Insert into DB
      insertPrice(q.c);

      // Update patterns periodically
      if (DB.price_history.length % 3 === 0) {
        const pats = analysePatterns(DB.price_history);
        pats.forEach(p => insertPattern(p));
        setPatterns([...DB.patterns.slice(0, 6)]);
      }

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

      // Seed in-memory DB from Supabase persisted history
      const [rows, savedPatterns] = await Promise.all([
        dbLoadPriceHistory(SYMBOL, 500),
        dbLoadPatterns(30),
      ]);
      rows.forEach(r => {
        DB.price_history.push({ id: DB.nextId++, stock_id: 1, symbol: r.symbol, price: parseFloat(r.price), timestamp: r.timestamp });
      });
      savedPatterns.forEach(p => {
        DB.patterns.push({ id: DB.nextId++, stock_id: 1, pattern_name: p.pattern_name, confidence: p.confidence, level: p.level, detected_at: p.detected_at });
      });
      if (savedPatterns.length) setPatterns([...DB.patterns.slice(0, 6)]);

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

  const patternIcon  = n => ({ Uptrend:"↑", Downtrend:"↓", Breakout:"⚡", "Support Level":"▬", "Resistance Level":"▬", Consolidation:"↔" }[n] ?? "◈");
  const patternColor = n => ({ Uptrend:"#34d399", Downtrend:"#f87171", Breakout:"#fbbf24", "Support Level":"#60a5fa", "Resistance Level":"#a78bfa", Consolidation:"#94a3b8" }[n] ?? "#e2e8f0");
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
        .range-btn { background:transparent; border:1px solid #161f35; color:#4b5563; cursor:pointer; border-radius:8px; padding:5px 13px; font-size:12px; font-weight:600; font-family:inherit; transition:all .18s; letter-spacing:.5px; }
        .range-btn.active { background:#170d38; border-color:#5b21b6; color:#a78bfa; box-shadow:0 0 10px #7c3aed33; }
        .range-btn:hover:not(.active) { border-color:#1e2d50; color:#6b7280; }
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
        <div className="card" style={{ padding: "22px 22px 18px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 2, marginBottom: 3 }}>Price Chart · SPCX</div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600, color: "#c7d2fe" }}>
                {price ? `$${fmt2(price)}` : "Loading…"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              {RANGES.map(r => (
                <button key={r} className={`range-btn${range === r ? " active" : ""}`} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
          </div>

          {chartLoading || loading ? <LoadingPulse /> : (
            <ResponsiveContainer width="100%" height={248}>
              <AreaChart data={chartData} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#6d28d9" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6d28d9" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tickFormatter={v => xTick(v, range)} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={55} />
                <YAxis domain={[minP - pad, maxP + pad]} tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={50} />
                <Tooltip content={<ChartTooltip range={range} />} />
                {price && <ReferenceLine y={price} stroke="#312e8155" strokeDasharray="3 4" />}
                <Area type="monotone" dataKey="price" stroke="url(#lg)" strokeWidth={2} fill="url(#areaFill)" dot={false} activeDot={{ r: 4, fill: "#a78bfa", strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}

          <div style={{ marginTop: 10, fontSize: 10, color: "#4b5563", textAlign: "right" }}>
            {chartData.length} data points · Finnhub · 15-min delayed outside market hours
          </div>
        </div>

        {/* ── Patterns ── */}
        <div className="card" style={{ padding: "22px", marginBottom: 18 }}>
          <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 2, marginBottom: 18 }}>⬡ Pattern Recognition</div>
          {patterns.length === 0 ? (
            <div style={{ color: "#6b7280", fontSize: 13 }}>Accumulating price data for pattern analysis…</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
              {patterns.slice(0, 6).map((p, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, color: patternColor(p.pattern_name) }}>{patternIcon(p.pattern_name)}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#c7d2fe" }}>{p.pattern_name}</span>
                      {p.level && <span style={{ fontSize: 11, color: "#374151" }}>${fmt2(p.level)}</span>}
                    </div>
                    <span style={{ fontSize: 10, color: "#6b7280" }}>{fmtTime(p.detected_at)}</span>
                  </div>
                  <ConfBar value={p.confidence} />
                </div>
              ))}
            </div>
          )}
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
