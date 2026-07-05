import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, BarChart, Bar, Cell } from "recharts";
import { dbInsertPrice, dbLoadPriceHistory } from "./supabase.js";
import { searchTz, tzLabel } from "./countryTz.js";

// ── Config ──────────────────────────────────────────────────────────────────
const FINNHUB_KEY = "d8ongu9r01qn89hse3p0d8ongu9r01qn89hse3pg";
const SYMBOL = "SPCX";
const POLL_MS = 15000;
const LISTING_UNIX = Math.floor(new Date("2026-06-12T13:30:00Z").getTime() / 1000);
const LISTING_MS   = LISTING_UNIX * 1000;

// ── In-memory DB ─────────────────────────────────────────────────────────────
const DB = { price_history: [], nextId: 1 };

function insertPrice(price, timestamp) {
  const ts = timestamp || new Date().toISOString();
  if (DB.price_history.length > 0) {
    const last = DB.price_history[DB.price_history.length - 1];
    if (last.price === price && last.timestamp.slice(0, 16) === ts.slice(0, 16)) return;
  }
  const record = { id: DB.nextId++, symbol: SYMBOL, price: parseFloat(price.toFixed(2)), timestamp: ts };
  DB.price_history.push(record);
  dbInsertPrice(SYMBOL, record.price, ts);
}

function getHistoryForRange(range) {
  const now = Date.now();
  const cutoffs = { "1D": 864e5, "1W": 6048e5, "1M": 2592e6, ALL: Infinity };
  const ms = cutoffs[range] ?? Infinity;
  return DB.price_history.filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t >= LISTING_MS && now - t <= ms;
  });
}

// ── Finnhub API ───────────────────────────────────────────────────────────────
const fh = path => fetch(`https://finnhub.io/api/v1${path}&token=${FINNHUB_KEY}`).then(r => r.json());

async function fetchQuote()    { return fh(`/quote?symbol=${SYMBOL}`); }
async function fetchProfile()  { return fh(`/stock/profile2?symbol=${SYMBOL}`); }
async function fetchMetrics()  { return fh(`/stock/metric?symbol=${SYMBOL}&metric=all`); }
async function fetchNews()     {
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  return fh(`/company-news?symbol=${SYMBOL}&from=${from}&to=${to}`);
}
async function fetchPeerQuote(sym) {
  const [q, p] = await Promise.all([
    fh(`/quote?symbol=${sym}`),
    fh(`/stock/profile2?symbol=${sym}`),
  ]);
  return { symbol: sym, name: p?.name ?? sym, price: q?.c, change: q?.dp };
}
async function fetchCandles(resolution, from, to) {
  return fh(`/stock/candle?symbol=${SYMBOL}&resolution=${resolution}&from=${from}&to=${to}`);
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt2   = n => n?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—";
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = iso => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtPct  = n => n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtMktCap = m => {
  if (!m) return "—";
  if (m >= 1_000_000) return `$${(m / 1_000_000).toFixed(2)}T`;
  if (m >= 1_000)     return `$${(m / 1_000).toFixed(2)}B`;
  return `$${m.toFixed(0)}M`;
};

function xTick(iso, range) {
  return range === "1D" ? fmtTime(iso) : fmtDate(iso);
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, range, startPrice }) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  const delta = startPrice ? val - startPrice : null;
  const up = delta >= 0;
  return (
    <div style={{ background: "#0b1220", border: "1px solid #1e2d50", borderRadius: 10, padding: "10px 16px" }}>
      <div style={{ color: "#6b7280", fontSize: 10, marginBottom: 4, letterSpacing: 1 }}>{xTick(label, range)}</div>
      <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 18, fontFamily: "'Space Grotesk',sans-serif" }}>${fmt2(val)}</div>
      {delta !== null && (
        <div style={{ fontSize: 11, color: up ? "#34d399" : "#f87171", marginTop: 3 }}>
          {up ? "▲" : "▼"} {up && delta > 0 ? "+" : ""}{fmt2(delta)} from open
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent, flash, badge }) {
  return (
    <div className={`card${flash === "up" ? " flash-up" : flash === "down" ? " flash-down" : ""}`}
      style={{ padding: "16px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: accent || "radial-gradient(circle,#1e1040,transparent)", opacity: 0.6 }} />
      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>{sub}</div>}
      {badge && <div style={{ position: "absolute", top: 12, right: 12, fontSize: 9, background: "#1e293b", color: "#94a3b8", padding: "2px 6px", borderRadius: 4, letterSpacing: 0.5 }}>{badge}</div>}
    </div>
  );
}

function LoadingPulse({ h = 260, label = "Fetching live data…" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: h, gap: 12, color: "#6b7280", fontSize: 13 }}>
      <div style={{ width: 14, height: 14, border: "2px solid #7c3aed", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
      {label}
    </div>
  );
}

function SectionTitle({ icon, title, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 2, marginBottom: 3 }}>{icon} {title}</div>
      {sub && <div style={{ fontSize: 11, color: "#4b5563" }}>{sub}</div>}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function Pulsar() {
  // Core market data
  const [quote, setQuote]       = useState(null);
  const [profile, setProfile]   = useState(null);
  const [metrics, setMetrics]   = useState(null);
  const [news, setNews]         = useState([]);
  const [peers, setPeers]       = useState([]);
  const [chartData, setChartData] = useState([]);
  const [range, setRange]       = useState("1D");

  // UI state
  const [flash, setFlash]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [lastUpdated, setLastUpdated]   = useState(null);
  const [marketStatus, setMarketStatus] = useState("—");
  const [activeTab, setActiveTab] = useState("overview"); // overview | news | table | calculator

  // Price log
  const [priceLog, setPriceLog] = useState([]);

  // Timezone
  const [tz, setTz]           = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [tzSearch, setTzSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-06-12");
  const [dateTo, setDateTo]     = useState(() => new Date().toISOString().slice(0, 10));

  // Calculator
  const [calcDate, setCalcDate]     = useState("2026-06-12");
  const [calcTime, setCalcTime]     = useState("14:00");
  const [calcAmount, setCalcAmount] = useState("");

  const ALL_TZ      = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const filteredTZ  = useMemo(() => searchTz(ALL_TZ, tzSearch), [ALL_TZ, tzSearch]);
  const prevPriceRef = useRef(null);
  const pollRef      = useRef(null);

  const filteredLog = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + "T00:00:00Z").getTime() : 0;
    const to   = dateTo   ? new Date(dateTo   + "T23:59:59Z").getTime() : Infinity;
    return priceLog.filter(r => {
      const t = new Date(r.timestamp).getTime();
      return t >= from && t <= to;
    });
  }, [priceLog, dateFrom, dateTo]);

  useEffect(() => {
    if (tzSearch.trim() && filteredTZ.length === 1) {
      setTz(filteredTZ[0].tz);
      setTzSearch("");
    }
  }, [filteredTZ, tzSearch]);

  // ── Load candles ──────────────────────────────────────────────────────────
  const loadCandles = useCallback(async (r) => {
    setChartLoading(true);
    const now = Math.floor(Date.now() / 1000);
    const rawFrom = { "1D": now - 86400, "1W": now - 604800, "1M": LISTING_UNIX, "ALL": LISTING_UNIX }[r] ?? LISTING_UNIX;
    const from = Math.max(rawFrom, LISTING_UNIX);
    const resolution = r === "1D" ? "5" : "15";

    try {
      const data = await fetchCandles(resolution, from, now);
      if (data.s === "ok" && data.t?.length) {
        const finnhubPoints = data.t
          .map((ts, i) => ({ time: new Date(ts * 1000).toISOString(), price: parseFloat(data.c[i].toFixed(2)) }))
          .filter(p => new Date(p.time).getTime() >= LISTING_MS);

        const dbHist = getHistoryForRange(r);
        const knownMinutes = new Set(dbHist.map(h => h.timestamp.slice(0, 16)));
        finnhubPoints.forEach(p => {
          if (!knownMinutes.has(p.time.slice(0, 16))) insertPrice(p.price, p.time);
        });
        const allPoints = getHistoryForRange(r)
          .map(h => ({ time: h.timestamp, price: h.price }))
          .sort((a, b) => new Date(a.time) - new Date(b.time));
        setChartData(allPoints);
        setPriceLog([...DB.price_history].reverse());
      } else {
        const dbHist = getHistoryForRange(r).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setChartData(dbHist.map(h => ({ time: h.timestamp, price: h.price })));
      }
    } catch {
      const dbHist = getHistoryForRange(r).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setChartData(dbHist.map(h => ({ time: h.timestamp, price: h.price })));
    }
    setChartLoading(false);
  }, []);

  // ── Live quote ────────────────────────────────────────────────────────────
  const fetchLive = useCallback(async () => {
    try {
      const q = await fetchQuote();
      if (!q?.c) throw new Error("No price");

      const prev = prevPriceRef.current;
      if (prev !== null) {
        setFlash(q.c >= prev ? "up" : "down");
        setTimeout(() => setFlash(null), 800);
      }
      prevPriceRef.current = q.c;
      setQuote(q);
      setLastUpdated(new Date());

      insertPrice(q.c);
      setPriceLog([...DB.price_history].reverse());

      const totalMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      if (totalMin >= 870 && totalMin <= 1260) setMarketStatus("Open");
      else if (totalMin >= 810 && totalMin < 870) setMarketStatus("Pre-Market");
      else setMarketStatus("After Hours");
    } catch (e) {
      console.error("Quote fetch:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      const listingIso = new Date(LISTING_MS).toISOString();
      const rows = await dbLoadPriceHistory(SYMBOL, listingIso, null);
      rows.forEach(r => {
        DB.price_history.push({ id: DB.nextId++, symbol: r.symbol, price: parseFloat(r.price), timestamp: r.timestamp });
      });
      setPriceLog([...DB.price_history].reverse());

      // Load all data in parallel
      const [, p, m, n] = await Promise.all([
        fetchLive(),
        fetchProfile(),
        fetchMetrics(),
        fetchNews(),
      ]);
      setProfile(p);
      setMetrics(m?.metric ?? null);
      setNews(Array.isArray(n) ? n.slice(0, 20) : []);

      // Load peers (top 5 relevant ones)
      const PEER_SYMS = ["ASTS", "GSAT", "IRDM", "LMT", "BA"];
      const peerData = await Promise.all(PEER_SYMS.map(s => fetchPeerQuote(s).catch(() => null)));
      setPeers(peerData.filter(Boolean));

      await loadCandles("1D");
    })();
  }, [fetchLive, loadCandles]);

  useEffect(() => { pollRef.current = setInterval(fetchLive, POLL_MS); return () => clearInterval(pollRef.current); }, [fetchLive]);
  useEffect(() => { loadCandles(range); }, [range, loadCandles]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const price     = quote?.c ?? null;
  const change    = quote?.d ?? null;
  const changePct = quote?.dp ?? null;
  const isUp      = (change ?? 0) >= 0;

  const minP = chartData.length ? Math.min(...chartData.map(d => d.price)) : (price ?? 170) - 10;
  const maxP = chartData.length ? Math.max(...chartData.map(d => d.price)) : (price ?? 170) + 10;
  const pad  = Math.max((maxP - minP) * 0.1, 2);

  const RANGES = ["1D", "1W", "1M", "ALL"];

  const stars = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    key: i, size: Math.random() > 0.88 ? 2 : 1, opacity: 0.08 + Math.random() * 0.45,
    top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`,
    dur: `${2.5 + Math.random() * 5}s`, delay: `${Math.random() * 5}s`,
  })), []);

  // Calculator
  const calcResult = useMemo(() => {
    const target = new Date(`${calcDate}T${calcTime}:00Z`).getTime();
    const sorted = [...DB.price_history].sort((a, b) => Math.abs(new Date(a.timestamp) - target) - Math.abs(new Date(b.timestamp) - target));
    const nearest   = sorted[0] ?? null;
    const buyPrice   = nearest?.price ?? null;
    const invested   = parseFloat(calcAmount);
    if (!buyPrice || !(invested > 0) || !price) return { nearest, buyPrice, invested, hasResult: false };
    const shares   = invested / buyPrice;
    const nowValue = shares * price;
    const profit   = nowValue - invested;
    const pct      = (profit / invested) * 100;
    return { nearest, buyPrice, invested, shares, nowValue, profit, pct, isGain: profit >= 0, hasResult: true };
  }, [calcDate, calcTime, calcAmount, price]);

  return (
    <div style={{ minHeight: "100vh", background: "#060a12", color: "#e2e8f0", fontFamily: "'Inter', system-ui, sans-serif", overflowX: "hidden" }}>

      {/* Stars */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        {stars.map(s => (
          <div key={s.key} style={{ position: "absolute", width: s.size, height: s.size, borderRadius: "50%", background: "#fff", opacity: s.opacity, top: s.top, left: s.left, animation: `twinkle ${s.dur} ease-in-out infinite`, animationDelay: s.delay }} />
        ))}
        <div style={{ position: "absolute", top: "10%", left: "60%", width: 400, height: 300, background: "radial-gradient(ellipse,#7c3aed08,transparent 70%)", borderRadius: "50%" }} />
        <div style={{ position: "absolute", bottom: "20%", left: "5%", width: 300, height: 200, background: "radial-gradient(ellipse,#1d4ed808,transparent 70%)", borderRadius: "50%" }} />
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap');
        @keyframes twinkle { 0%,100%{opacity:.05} 50%{opacity:.6} }
        @keyframes spin     { to{transform:rotate(360deg)} }
        @keyframes flash-up   { 0%{background:#064e3b66} 100%{background:transparent} }
        @keyframes flash-down { 0%{background:#7f1d1d55} 100%{background:transparent} }
        @keyframes glow-pulse { 0%,100%{box-shadow:0 0 6px #7c3aed33} 50%{box-shadow:0 0 18px #7c3aed77,0 0 32px #7c3aed22} }
        @keyframes dot-pulse  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:.5} }
        @keyframes slideIn    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .card { background:linear-gradient(145deg,#0b1220dd,#0e1628dd); border:1px solid #161f35; border-radius:14px; backdrop-filter:blur(8px); transition:border-color .2s; }
        .card:hover { border-color:#1e2d50; }
        .flash-up   { animation:flash-up   .8s ease-out; }
        .flash-down { animation:flash-down .8s ease-out; }
        .tab-btn { background:transparent; border:none; cursor:pointer; font-family:inherit; padding:8px 18px; font-size:12px; font-weight:600; letter-spacing:.5px; border-bottom:2px solid transparent; transition:all .15s; color:#4b5563; }
        .tab-btn.active { color:#a78bfa; border-bottom-color:#7c3aed; }
        .tab-btn:hover:not(.active) { color:#6b7280; }
        .news-card { border-bottom:1px solid #0f172a; padding:14px 0; animation:slideIn .3s ease; }
        .news-card:last-child { border-bottom:none; }
        .news-card:hover .news-headline { color:#a78bfa !important; }
        ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:#060a12} ::-webkit-scrollbar-thumb{background:#161f35;border-radius:2px}
        * { box-sizing:border-box; }
        input[type=date],input[type=time],input[type=number] { color-scheme:dark; }
      `}</style>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: "20px 14px 60px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg,#6d28d9,#2563eb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, animation: "glow-pulse 3s ease-in-out infinite", flexShrink: 0 }}>✦</div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 21, fontWeight: 700, letterSpacing: "-0.5px", background: "linear-gradient(90deg,#a78bfa,#60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>PULSAR</div>
              <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 2.5, textTransform: "uppercase" }}>SpaceX Market Intelligence</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{marketStatus} · SPCX</div>
              {lastUpdated && <div style={{ fontSize: 10, color: "#4b5563" }}>Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>}
            </div>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: marketStatus === "Open" ? "#34d399" : "#fbbf24", boxShadow: `0 0 8px ${marketStatus === "Open" ? "#34d399" : "#fbbf24"}`, animation: "dot-pulse 2s ease-in-out infinite" }} />
          </div>
        </div>

        {/* ── Price Hero ── */}
        <div className={`card${flash === "up" ? " flash-up" : flash === "down" ? " flash-down" : ""}`}
          style={{ padding: "24px 28px", marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: 2 }}>Space Exploration Technologies · NYSE</span>
              <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 5, padding: "1px 8px", fontSize: 10, fontWeight: 700, color: "#6366f1", letterSpacing: 1 }}>SPCX</span>
              {profile?.ipo && <span style={{ fontSize: 10, color: "#4b5563" }}>IPO {profile.ipo}</span>}
            </div>
            {loading ? (
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 52, fontWeight: 700, color: "#1e2d50", letterSpacing: "-2px" }}>—</div>
            ) : (
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 52, fontWeight: 700, letterSpacing: "-2px", color: "#f8fafc" }}>
                ${fmt2(price)}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              {change !== null && (
                <>
                  <span style={{ fontSize: 16, fontWeight: 600, color: isUp ? "#34d399" : "#f87171" }}>
                    {isUp ? "▲" : "▼"} {isUp && change > 0 ? "+" : ""}{fmt2(change)} ({isUp && changePct > 0 ? "+" : ""}{changePct?.toFixed(2)}%)
                  </span>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>today</span>
                </>
              )}
            </div>
          </div>
          {/* OHLC grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 32px", textAlign: "right" }}>
            {[
              ["Opened At",       `$${fmt2(quote?.o)}`],
              ["Yesterday Close", `$${fmt2(quote?.pc)}`],
              ["Today's High",    `$${fmt2(quote?.h)}`],
              ["Today's Low",     `$${fmt2(quote?.l)}`],
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1.2 }}>{l}</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 600, color: "#94a3b8" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Key Metrics ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="Company Value"     value={fmtMktCap(metrics?.marketCapitalization ?? profile?.marketCapitalization)} sub="Total worth of all shares" accent="radial-gradient(circle,#4c1d9522,transparent)" />
          <StatCard label="Highest Price"     value={metrics?.["52WeekHigh"] ? `$${fmt2(metrics["52WeekHigh"])}` : "—"} sub={`Best price — ${metrics?.["52WeekHighDate"] ?? "last 52 weeks"}`} accent="radial-gradient(circle,#14532d22,transparent)" />
          <StatCard label="Lowest Price"      value={metrics?.["52WeekLow"]  ? `$${fmt2(metrics["52WeekLow"])}` : "—"}  sub={`Cheapest point — ${metrics?.["52WeekLowDate"] ?? "last 52 weeks"}`} accent="radial-gradient(circle,#7f1d1d22,transparent)" />
          <StatCard label="Daily Trades"      value={metrics?.["10DayAverageTradingVolume"] ? `${metrics["10DayAverageTradingVolume"].toFixed(1)}M` : "—"} sub="Avg shares bought & sold per day" accent="radial-gradient(circle,#1e3a5f22,transparent)" />
          <StatCard label="Sales Growth"      value={metrics?.revenueGrowthQuarterlyYoy != null ? fmtPct(metrics.revenueGrowthQuarterlyYoy) : "—"} sub="How fast revenue is growing vs last year" accent="radial-gradient(circle,#064e3b22,transparent)" />
          <StatCard label="Profit on Each $"  value={metrics?.grossMarginAnnual != null ? `${metrics.grossMarginAnnual.toFixed(1)}%` : "—"} sub="Kept after direct costs (higher = better)" accent="radial-gradient(circle,#1e1a4f22,transparent)" />
          <StatCard label="Value vs Assets"   value={metrics?.pb != null ? `${metrics.pb.toFixed(1)}×` : "—"} sub="How much you pay per $1 of real assets" accent="radial-gradient(circle,#2d1b4e22,transparent)" />
          <StatCard label="5-Day Gain/Loss"   value={metrics?.["5DayPriceReturnDaily"] != null ? fmtPct(metrics["5DayPriceReturnDaily"]) : "—"} sub="Price change over the last 5 trading days" accent="radial-gradient(circle,#0c2a4e22,transparent)" />
        </div>

        {/* ── Tab navigation ── */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #161f35", marginBottom: 20 }}>
          {[["overview","Overview"],["news","News Feed"],["table","Price Log"],["calculator","Calculator"]].map(([id, label]) => (
            <button key={id} className={`tab-btn${activeTab === id ? " active" : ""}`} onClick={() => setActiveTab(id)}>{label}</button>
          ))}
        </div>

        {/* ══════════════════════ OVERVIEW TAB ══════════════════════ */}
        {activeTab === "overview" && (
          <>
            {/* Chart */}
            <div className="card" style={{ padding: "22px 22px 14px", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
                <div>
                  <SectionTitle icon="◈" title="Price Chart · SPCX" />
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: -10 }}>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color: "#f1f5f9" }}>{price ? `$${fmt2(price)}` : "—"}</div>
                    {chartData.length >= 2 && (() => {
                      const first = chartData[0].price, last = chartData[chartData.length - 1].price;
                      const d = last - first, dp = (d / first) * 100, up = d >= 0;
                      return <span style={{ fontSize: 12, fontWeight: 600, color: up ? "#34d399" : "#f87171" }}>{up ? "▲" : "▼"} {up && d > 0 ? "+" : ""}{fmt2(d)} ({up && dp > 0 ? "+" : ""}{dp.toFixed(2)}%) {range}</span>;
                    })()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, background: "#080d18", borderRadius: 10, padding: 4 }}>
                  {RANGES.map(r => (
                    <button key={r} onClick={() => setRange(r)} style={{ background: range === r ? "linear-gradient(135deg,#170d38,#0f1a35)" : "transparent", border: range === r ? "1px solid #5b21b6" : "1px solid transparent", color: range === r ? "#a78bfa" : "#4b5563", cursor: "pointer", borderRadius: 7, padding: "5px 14px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", letterSpacing: 0.5, transition: "all .15s" }}>{r}</button>
                  ))}
                </div>
              </div>

              {chartLoading || loading ? <LoadingPulse /> : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      {(() => {
                        const first = chartData[0]?.price ?? 0, last = chartData[chartData.length - 1]?.price ?? 0, up = last >= first;
                        const c1 = up ? "#059669" : "#dc2626", c2 = up ? "#34d399" : "#f87171";
                        return (
                          <>
                            <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor={c1} /><stop offset="100%" stopColor={c2} />
                            </linearGradient>
                            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={c1} stopOpacity={0.2} /><stop offset="85%" stopColor={c1} stopOpacity={0.02} /><stop offset="100%" stopColor={c1} stopOpacity={0} />
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
                <span>Finnhub · live + historical</span>
              </div>
            </div>

            {/* Fundamentals + Peers side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>

              {/* Fundamentals */}
              <div className="card" style={{ padding: "22px" }}>
                <SectionTitle icon="◎" title="Company Health" sub="How SpaceX is actually doing financially" />
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {[
                    ["Earnings Per Share",        metrics?.epsAnnual != null ? `$${metrics.epsAnnual.toFixed(4)}` : "—"],
                    ["Profit After All Costs",     metrics?.netProfitMarginAnnual != null ? `${metrics.netProfitMarginAnnual.toFixed(2)}%` : "—"],
                    ["Profit Before Tax & Interest", metrics?.operatingMarginAnnual != null ? `${metrics.operatingMarginAnnual.toFixed(2)}%` : "—"],
                    ["Return on Assets",           metrics?.roaRfy != null ? `${metrics.roaRfy.toFixed(2)}%` : "—"],
                    ["Return on Shareholder Money", metrics?.roeRfy != null ? `${metrics.roeRfy.toFixed(2)}%` : "—"],
                    ["Debt vs Equity",             metrics?.["totalDebt/totalEquityAnnual"] != null ? metrics["totalDebt/totalEquityAnnual"].toFixed(3) : "—"],
                    ["Can Pay Short-Term Bills",   metrics?.currentRatioAnnual != null ? metrics.currentRatioAnnual.toFixed(2) : "—"],
                    ["Cash Per Share",             metrics?.cashPerSharePerShareAnnual != null ? `$${metrics.cashPerSharePerShareAnnual.toFixed(4)}` : "—"],
                    ["Gain Since Jan 1",           metrics?.yearToDatePriceReturnDaily != null ? fmtPct(metrics.yearToDatePriceReturnDaily) : "—"],
                    ["vs S&P 500 This Year",       metrics?.["priceRelativeToS&P500Ytd"] != null ? fmtPct(metrics["priceRelativeToS&P500Ytd"]) : "—"],
                  ].map(([label, val]) => {
                    const isNeg = typeof val === "string" && val.startsWith("-") && val.includes("%");
                    const isPos = typeof val === "string" && val.startsWith("+");
                    return (
                      <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #0f172a" }}>
                        <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif", color: isPos ? "#34d399" : isNeg ? "#f87171" : "#94a3b8" }}>{val}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Peer Comparison */}
              <div className="card" style={{ padding: "22px" }}>
                <SectionTitle icon="⊞" title="How SPCX Compares" sub="Other space & aerospace stocks today" />
                {peers.length === 0 ? <LoadingPulse h={120} label="Loading peers…" /> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {/* SPCX row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", marginBottom: 4, background: "#0f172a", borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#a78bfa" }}>SPCX</div>
                        <div style={{ fontSize: 10, color: "#4b5563" }}>SpaceX — the stock you're tracking</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>${fmt2(price)}</div>
                        <div style={{ fontSize: 11, color: isUp ? "#34d399" : "#f87171" }}>{fmtPct(changePct)}</div>
                      </div>
                    </div>
                    {peers.map(p => {
                      const pUp = (p.change ?? 0) >= 0;
                      return (
                        <div key={p.symbol} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #0f172a" }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#c7d2fe" }}>{p.symbol}</div>
                            <div style={{ fontSize: 10, color: "#4b5563", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>${fmt2(p.price)}</div>
                            <div style={{ fontSize: 11, color: pUp ? "#34d399" : "#f87171" }}>{fmtPct(p.change)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Peer bar chart */}
                {peers.length > 0 && price && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 10, color: "#4b5563", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Who gained & who lost today</div>
                    <ResponsiveContainer width="100%" height={120}>
                      <BarChart data={[{ symbol: "SPCX", pct: changePct ?? 0 }, ...peers.map(p => ({ symbol: p.symbol, pct: p.change ?? 0 }))]} margin={{ top: 0, right: 0, bottom: 0, left: -30 }}>
                        <XAxis dataKey="symbol" tick={{ fill: "#4b5563", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#374151", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `${v.toFixed(1)}%`} />
                        <Tooltip formatter={(v) => [`${v.toFixed(2)}%`, "Change"]} contentStyle={{ background: "#0b1220", border: "1px solid #1e2d50", borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                          {[{ symbol: "SPCX", pct: changePct ?? 0 }, ...peers.map(p => ({ symbol: p.symbol, pct: p.change ?? 0 }))].map((entry, i) => (
                            <Cell key={i} fill={entry.pct >= 0 ? "#059669" : "#dc2626"} opacity={entry.symbol === "SPCX" ? 1 : 0.6} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Top news preview */}
            <div className="card" style={{ padding: "22px", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <SectionTitle icon="◉" title="Latest News" sub="What's happening with SpaceX right now" />
                <button onClick={() => setActiveTab("news")} style={{ background: "none", border: "1px solid #1e293b", color: "#6b7280", cursor: "pointer", fontSize: 11, padding: "4px 12px", borderRadius: 6, fontFamily: "inherit" }}>View all →</button>
              </div>
              {news.slice(0, 4).map((item, i) => (
                <div key={i} className="news-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <a className="news-headline" href={item.url} target="_blank" rel="noreferrer"
                        style={{ fontSize: 13, fontWeight: 600, color: "#c7d2fe", textDecoration: "none", lineHeight: 1.4, display: "block", marginBottom: 5 }}>
                        {item.headline}
                      </a>
                      <div style={{ fontSize: 11, color: "#4b5563", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {item.summary?.replace(/&amp;/g, "&")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600, marginBottom: 2 }}>{item.source}</div>
                      <div style={{ fontSize: 10, color: "#374151" }}>{fmtDate(new Date(item.datetime * 1000).toISOString())}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ══════════════════════ NEWS TAB ══════════════════════ */}
        {activeTab === "news" && (
          <div className="card" style={{ padding: "22px" }}>
            <SectionTitle icon="◉" title="News Feed" sub={`${news.length} articles · Last 14 days`} />
            {news.length === 0 ? <LoadingPulse h={200} label="Loading news…" /> : (
              <div style={{ overflowY: "auto", maxHeight: 680 }}>
                {news.map((item, i) => (
                  <div key={i} className="news-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                      <div style={{ flex: 1 }}>
                        <a className="news-headline" href={item.url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 14, fontWeight: 600, color: "#c7d2fe", textDecoration: "none", lineHeight: 1.5, display: "block", marginBottom: 6 }}>
                          {item.headline}
                        </a>
                        <div style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.6 }}>
                          {item.summary?.replace(/&amp;/g, "&")}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 70 }}>
                        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 3 }}>{item.source}</div>
                        <div style={{ fontSize: 10, color: "#374151" }}>{new Date(item.datetime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                        <div style={{ fontSize: 10, color: "#4b5563" }}>{new Date(item.datetime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════ TABLE TAB ══════════════════════ */}
        {activeTab === "table" && (
          <div className="card" style={{ padding: "22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <SectionTitle icon="◧" title="Price Record Log" sub={filteredLog.length === priceLog.length ? `${priceLog.length} records · ${POLL_MS / 1000}s interval` : `${filteredLog.length} of ${priceLog.length} records · filtered`} />
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                {/* Date filter */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>From</span>
                  <input type="date" value={dateFrom} min="2026-06-12" max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)}
                    style={{ background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 7, padding: "4px 8px", fontSize: 11, fontFamily: "inherit", outline: "none" }} />
                  <span style={{ fontSize: 10, color: "#6b7280" }}>To</span>
                  <input type="date" value={dateTo} min={dateFrom || "2026-06-12"} onChange={e => setDateTo(e.target.value)}
                    style={{ background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 7, padding: "4px 8px", fontSize: 11, fontFamily: "inherit", outline: "none" }} />
                  {(dateFrom !== "2026-06-12" || dateTo !== new Date().toISOString().slice(0,10)) && (
                    <button onClick={() => { setDateFrom("2026-06-12"); setDateTo(new Date().toISOString().slice(0,10)); }}
                      style={{ background: "#1e293b", border: "none", color: "#94a3b8", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>Clear</button>
                  )}
                </div>
                {/* Timezone picker */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, pointerEvents: "none" }}>🔍</span>
                    <input type="text" placeholder="Country or timezone…" value={tzSearch} onChange={e => setTzSearch(e.target.value)}
                      style={{ background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 7, padding: "4px 10px 4px 26px", fontSize: 11, fontFamily: "inherit", outline: "none", width: 170 }} />
                    {tzSearch && <span onClick={() => setTzSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#4b5563", cursor: "pointer" }}>✕</span>}
                  </div>
                  {filteredTZ.length > 1 && (
                    <select value={filteredTZ.find(r => r.tz === tz)?.tz ?? filteredTZ[0]?.tz ?? tz} onChange={e => { setTz(e.target.value); setTzSearch(""); }}
                      style={{ background: "#080d18", border: "1px solid #5b21b6", color: "#a5b4fc", borderRadius: 7, padding: "4px 10px 4px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", outline: "none", maxWidth: 220, appearance: "none" }}>
                      {filteredTZ.map(({ tz: z, label }) => <option key={z} value={z}>{label}</option>)}
                    </select>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#080d18", border: "1px solid #1e293b", borderRadius: 7, padding: "4px 10px", fontSize: 11 }}>
                    <span style={{ fontSize: 10 }}>🌐</span>
                    <span style={{ color: "#a5b4fc", fontWeight: 600 }}>
                      {new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: tz }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ overflowY: "auto", maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: "#0b1220", zIndex: 1 }}>
                  <tr>{["#", "Price", "Change", "Date", "Time"].map(h => (
                    <th key={h} style={{ textAlign: "left", color: "#6b7280", fontWeight: 600, padding: "8px 14px", borderBottom: "1px solid #1e293b", letterSpacing: 1, fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filteredLog.map((r, i) => {
                    const prev = filteredLog[i + 1];
                    const delta = prev ? r.price - prev.price : null;
                    const up = delta >= 0;
                    const ts = new Date(r.timestamp);
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #0b1220", background: i === 0 ? "#0f172a44" : "transparent" }}>
                        <td style={{ padding: "7px 14px", color: "#374151", fontSize: 11 }}>{filteredLog.length - i}</td>
                        <td style={{ padding: "7px 14px", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, color: "#a5b4fc" }}>${fmt2(r.price)}</td>
                        <td style={{ padding: "7px 14px", fontSize: 11 }}>
                          {delta !== null ? <span style={{ color: up ? "#34d399" : "#f87171", fontWeight: 600 }}>{up ? "▲" : "▼"} {up && delta > 0 ? "+" : ""}{fmt2(delta)}</span> : <span style={{ color: "#374151" }}>—</span>}
                        </td>
                        <td style={{ padding: "7px 14px", color: "#6b7280", fontSize: 11, whiteSpace: "nowrap" }}>
                          {ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz })}
                        </td>
                        <td style={{ padding: "7px 14px", color: "#6b7280", fontSize: 11, whiteSpace: "nowrap" }}>
                          {ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz })}
                          <span style={{ color: "#374151", marginLeft: 4, fontSize: 10 }}>
                            {new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: tz }).formatToParts(ts).find(p => p.type === "timeZoneName")?.value}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredLog.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: "24px 14px", color: "#374151", fontSize: 13 }}>{priceLog.length === 0 ? "No price records yet…" : "No records match the selected date range."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════ CALCULATOR TAB ══════════════════════ */}
        {activeTab === "calculator" && (
          <div className="card" style={{ padding: "28px" }}>
            <SectionTitle icon="◎" title="Profit Calculator" sub="What if you invested in SPCX on a specific date?" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
              <div style={{ flex: "1 1 140px" }}>
                <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>Investment Date</div>
                <input type="date" value={calcDate} min="2026-06-12" max={new Date().toISOString().slice(0,10)} onChange={e => setCalcDate(e.target.value)}
                  style={{ width: "100%", background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div style={{ flex: "1 1 120px" }}>
                <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>Time (UTC)</div>
                <input type="time" value={calcTime} onChange={e => setCalcTime(e.target.value)}
                  style={{ width: "100%", background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" }}>Amount Invested (USD)</div>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#4b5563", fontSize: 13 }}>$</span>
                  <input type="number" min="1" placeholder="e.g. 1000" value={calcAmount} onChange={e => setCalcAmount(e.target.value)}
                    style={{ width: "100%", background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 8, padding: "8px 12px 8px 24px", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                </div>
              </div>
            </div>

            {calcResult.nearest && (
              <div style={{ fontSize: 11, color: "#4b5563", marginBottom: 20 }}>
                Nearest recorded price: <span style={{ color: "#a5b4fc", fontWeight: 700 }}>${fmt2(calcResult.buyPrice)}</span>
                {" "}at <span style={{ color: "#6b7280" }}>{new Date(calcResult.nearest.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</span>
              </div>
            )}

            {calcResult.hasResult ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 20 }}>
                  {[
                    { label: "Shares Bought",  value: calcResult.shares.toFixed(4),             color: "#c7d2fe", prefix: "" },
                    { label: "Buy Price",       value: fmt2(calcResult.buyPrice),                 color: "#c7d2fe", prefix: "$" },
                    { label: "Current Price",   value: fmt2(price),                               color: "#c7d2fe", prefix: "$" },
                    { label: "Current Value",   value: fmt2(calcResult.nowValue),                 color: "#f1f5f9", prefix: "$" },
                    { label: "Profit / Loss",   value: (calcResult.isGain ? "+" : "") + fmt2(calcResult.profit), color: calcResult.isGain ? "#34d399" : "#f87171", prefix: "$" },
                    { label: "Return",          value: (calcResult.isGain ? "+" : "") + calcResult.pct.toFixed(2) + "%", color: calcResult.isGain ? "#34d399" : "#f87171", prefix: "" },
                  ].map(({ label, value, color, prefix }) => (
                    <div key={label} className="card" style={{ padding: "14px 18px", background: "#060a12" }}>
                      <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{prefix}{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderRadius: 12, padding: "18px 24px", background: calcResult.isGain ? "#052e1688" : "#2d0a0a88", border: `1px solid ${calcResult.isGain ? "#065f4666" : "#7f1d1d66"}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ fontSize: 13, color: calcResult.isGain ? "#6ee7b7" : "#fca5a5" }}>
                    {calcResult.isGain ? "🚀" : "📉"} A <span style={{ fontWeight: 700 }}>${fmt2(calcResult.invested)}</span> investment on {new Date(`${calcDate}T${calcTime}:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} would be worth
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, color: calcResult.isGain ? "#34d399" : "#f87171", letterSpacing: "-1px" }}>
                    ${fmt2(calcResult.nowValue)} <span style={{ fontSize: 14, opacity: 0.7 }}>({calcResult.isGain ? "+" : ""}{calcResult.pct.toFixed(2)}%)</span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "28px 0", color: "#374151", fontSize: 13 }}>
                {!calcAmount ? "Enter an investment amount to see your result." : !calcResult.buyPrice ? "No price data found for that date — try a different date or time." : "Enter a valid amount greater than $0."}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: "#4b5563", letterSpacing: 1.5 }}>
          PULSAR · SPCX · DATA BY FINNHUB · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
