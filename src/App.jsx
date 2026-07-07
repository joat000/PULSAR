import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, BarChart, Bar, Cell } from "recharts";
import { dbInsertPrice, dbLoadPriceHistory } from "./supabase.js";
import { searchTz, tzLabel } from "./countryTz.js";

// ── Config ──────────────────────────────────────────────────────────────────
const FINNHUB_KEY = "d8ongu9r01qn89hse3p0d8ongu9r01qn89hse3pg";
const SYMBOL = "SPCX";
const POLL_MS = 15000;
const LISTING_UNIX = Math.floor(new Date("2026-06-12T13:30:00Z").getTime() / 1000);
const LISTING_MS   = LISTING_UNIX * 1000;

// ── Device detection ─────────────────────────────────────────────────────────
function useDevice() {
  const get = () => {
    const w = window.innerWidth;
    if (w < 640)  return "mobile";
    if (w < 1024) return "tablet";
    return "desktop";
  };
  const [device, setDevice] = useState(get);
  useLayoutEffect(() => {
    const handler = () => setDevice(get());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return device;
}

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
function ChartTooltip({ active, payload, label, range, startPrice, highPrice, lowPrice }) {
  if (!active || !payload?.length) return null;
  const pricePayload = payload.find(p => p.dataKey === "price");
  const ma7Payload   = payload.find(p => p.dataKey === "ma7");
  const ma20Payload  = payload.find(p => p.dataKey === "ma20");
  const val = pricePayload?.value;
  if (val == null) return null;
  const delta = startPrice ? val - startPrice : null;
  const pct   = startPrice ? ((val - startPrice) / startPrice) * 100 : null;
  const up    = (delta ?? 0) >= 0;
  const isHigh = highPrice != null && Math.abs(val - highPrice) < 0.01;
  const isLow  = lowPrice  != null && Math.abs(val - lowPrice)  < 0.01;
  // Plain-English context sentence
  const ctxColor = up ? "#34d399" : "#f87171";
  const ctxMsg = delta == null ? null
    : up && delta > 0
      ? `Price climbed $${fmt2(delta)} (${pct.toFixed(2)}%) since chart started — buyers winning`
      : delta === 0
      ? "Price unchanged from chart start"
      : `Price fell $${fmt2(Math.abs(delta))} (${Math.abs(pct).toFixed(2)}%) since chart start — sellers in control`;
  return (
    <div style={{ background: "#0b1220cc", backdropFilter: "blur(6px)", border: "1px solid #1e2d50", borderRadius: 12, padding: "12px 16px", minWidth: 200 }}>
      <div style={{ color: "#6b7280", fontSize: 10, marginBottom: 6, letterSpacing: 1 }}>{xTick(label, range)}</div>
      <div style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 22, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: "-0.5px" }}>
        ${fmt2(val)}
        {isHigh && <span style={{ marginLeft: 8, fontSize: 10, color: "#34d399", fontWeight: 600, verticalAlign: "middle" }}>▲ PERIOD HIGH</span>}
        {isLow  && <span style={{ marginLeft: 8, fontSize: 10, color: "#f87171", fontWeight: 600, verticalAlign: "middle" }}>▼ PERIOD LOW</span>}
      </div>
      {ctxMsg && <div style={{ fontSize: 11, color: ctxColor, marginTop: 4, lineHeight: 1.4 }}>{ctxMsg}</div>}
      {(ma7Payload?.value != null || ma20Payload?.value != null) && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #1e2d50", display: "flex", flexDirection: "column", gap: 3 }}>
          {ma7Payload?.value  != null && <div style={{ fontSize: 10, color: "#fbbf24" }}>7-period avg: <b>${fmt2(ma7Payload.value)}</b> {val > ma7Payload.value ? "↑ price above — bullish" : "↓ price below — bearish"}</div>}
          {ma20Payload?.value != null && <div style={{ fontSize: 10, color: "#818cf8" }}>20-period avg: <b>${fmt2(ma20Payload.value)}</b> {val > ma20Payload.value ? "↑ price above — bullish" : "↓ price below — bearish"}</div>}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, term, value, sub, accent, flash }) {
  return (
    <div className={`card${flash === "up" ? " flash-up" : flash === "down" ? " flash-down" : ""}`}
      style={{ padding: "16px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: accent || "radial-gradient(circle,#1e1040,transparent)", opacity: 0.6 }} />
      {/* Plain label */}
      <div style={{ fontSize: 11, color: "#c7d2fe", fontWeight: 600, marginBottom: 2 }}>{label}</div>
      {/* Real trader term */}
      {term && <div style={{ fontSize: 9, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>{term}</div>}
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{sub}</div>}
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
  const device = useDevice();
  const isMobile = device === "mobile";
  const isTablet = device === "tablet";

  const [quote, setQuote]       = useState(null);
  const [profile, setProfile]   = useState(null);
  const [metrics, setMetrics]   = useState(null);
  const [news, setNews]         = useState([]);
  const [peers, setPeers]       = useState([]);
  const [chartData, setChartData] = useState([]);
  const [range, setRange]       = useState("1D");
  const [showMA7, setShowMA7]   = useState(true);
  const [showMA20, setShowMA20] = useState(true);

  // UI state
  const [flash, setFlash]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [lastUpdated, setLastUpdated]   = useState(null);
  const [marketStatus, setMarketStatus] = useState("—");
  const [activeTab, setActiveTab] = useState("overview"); // overview | news | table | calculator | trade | learn

  // Price log
  const [priceLog, setPriceLog] = useState([]);

  // Timezone
  const [tz, setTz]           = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [tzSearch, setTzSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-06-12");
  const [dateTo, setDateTo]     = useState(() => new Date().toISOString().slice(0, 10));

  // Comparison
  const [cmpDate, setCmpDate] = useState("2026-06-12");

  // Paper trading — persisted in localStorage
  const [paper, setPaper] = useState(() => {
    try {
      const saved = localStorage.getItem("pulsar_paper");
      return saved ? JSON.parse(saved) : { cash: 10000, shares: 0, avgCost: 0, trades: [] };
    } catch { return { cash: 10000, shares: 0, avgCost: 0, trades: [] }; }
  });
  const [tradeQty, setTradeQty] = useState("1");
  const [tradeMsg, setTradeMsg] = useState(null);

  const savePaper = (next) => {
    setPaper(next);
    try { localStorage.setItem("pulsar_paper", JSON.stringify(next)); } catch {}
  };

  const doPaperBuy = () => {
    const qty = parseFloat(tradeQty);
    if (!qty || qty <= 0 || !price) return;
    const cost = qty * price;
    if (cost > paper.cash) { setTradeMsg({ type: "err", text: "Not enough virtual cash!" }); return; }
    const newAvg = paper.shares === 0 ? price : ((paper.avgCost * paper.shares) + (price * qty)) / (paper.shares + qty);
    const next = { ...paper, cash: paper.cash - cost, shares: paper.shares + qty, avgCost: newAvg,
      trades: [{ type: "BUY", qty, price, total: cost, time: new Date().toISOString() }, ...paper.trades] };
    savePaper(next);
    setTradeMsg({ type: "ok", text: `Bought ${qty} share${qty !== 1 ? "s" : ""} at $${fmt2(price)}` });
    setTimeout(() => setTradeMsg(null), 3000);
  };

  const doPaperSell = () => {
    const qty = parseFloat(tradeQty);
    if (!qty || qty <= 0 || !price) return;
    if (qty > paper.shares) { setTradeMsg({ type: "err", text: "You don't own that many shares!" }); return; }
    const proceeds = qty * price;
    const next = { ...paper, cash: paper.cash + proceeds, shares: paper.shares - qty,
      avgCost: paper.shares - qty === 0 ? 0 : paper.avgCost,
      trades: [{ type: "SELL", qty, price, total: proceeds, time: new Date().toISOString() }, ...paper.trades] };
    savePaper(next);
    setTradeMsg({ type: "ok", text: `Sold ${qty} share${qty !== 1 ? "s" : ""} at $${fmt2(price)}` });
    setTimeout(() => setTradeMsg(null), 3000);
  };

  // Simulator
  const [simMode, setSimMode]         = useState(false);
  const [simDay, setSimDay]           = useState("");
  const [simRunning, setSimRunning]   = useState(false);
  const [simIndex, setSimIndex]       = useState(0);
  const [simTicks, setSimTicks]       = useState([]);
  const [simSpeed, setSimSpeed]       = useState(120000); // ms per tick
  const [simPaper, setSimPaper]       = useState({ cash: 10000, shares: 0, avgCost: 0, trades: [] });
  const [simQty, setSimQty]           = useState("1");
  const [simMsg, setSimMsg]           = useState(null);
  const [simDone, setSimDone]         = useState(false);
  const simIntervalRef                = useRef(null);

  const simPrice = simTicks[simIndex]?.price ?? null;
  const simChartData = simTicks.slice(0, simIndex + 1).map(t => ({ time: t.timestamp, price: t.price }));

  const startSim = () => {
    const ticks = DB.price_history
      .filter(r => r.timestamp.slice(0, 10) === simDay)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (!ticks.length) { setSimMsg({ type: "err", text: "No data for that day." }); return; }
    setSimTicks(ticks);
    setSimIndex(0);
    setSimPaper({ cash: 10000, shares: 0, avgCost: 0, trades: [] });
    setSimDone(false);
    setSimMsg(null);
    setSimRunning(true);
  };

  const stopSim = () => {
    setSimRunning(false);
    clearInterval(simIntervalRef.current);
  };

  const resetSim = () => {
    stopSim();
    setSimTicks([]);
    setSimIndex(0);
    setSimPaper({ cash: 10000, shares: 0, avgCost: 0, trades: [] });
    setSimDone(false);
    setSimMsg(null);
    setSimMode(false);
  };

  useEffect(() => {
    if (!simRunning) { clearInterval(simIntervalRef.current); return; }
    const delay = simSpeed; // simSpeed is now ms per tick directly
    simIntervalRef.current = setInterval(() => {
      setSimIndex(prev => {
        if (prev >= simTicks.length - 1) {
          clearInterval(simIntervalRef.current);
          setSimRunning(false);
          setSimDone(true);
          return prev;
        }
        return prev + 1;
      });
    }, delay);
    return () => clearInterval(simIntervalRef.current);
  }, [simRunning, simSpeed, simTicks.length]);

  const doSimBuy = () => {
    const qty = parseFloat(simQty);
    if (!qty || qty <= 0 || !simPrice) return;
    const cost = qty * simPrice;
    if (cost > simPaper.cash) { setSimMsg({ type: "err", text: "Not enough cash!" }); return; }
    const newAvg = simPaper.shares === 0 ? simPrice : ((simPaper.avgCost * simPaper.shares) + (simPrice * qty)) / (simPaper.shares + qty);
    setSimPaper(p => ({ ...p, cash: p.cash - cost, shares: p.shares + qty, avgCost: newAvg,
      trades: [{ type: "BUY", qty, price: simPrice, total: cost, time: simTicks[simIndex]?.timestamp }, ...p.trades] }));
    setSimMsg({ type: "ok", text: `Bought ${qty} share${qty !== 1 ? "s" : ""} at $${fmt2(simPrice)}` });
    setTimeout(() => setSimMsg(null), 2000);
  };

  const doSimSell = () => {
    const qty = parseFloat(simQty);
    if (!qty || qty <= 0 || !simPrice) return;
    if (qty > simPaper.shares) { setSimMsg({ type: "err", text: "You don't own that many shares!" }); return; }
    const proceeds = qty * simPrice;
    setSimPaper(p => ({ ...p, cash: p.cash + proceeds, shares: p.shares - qty,
      avgCost: p.shares - qty === 0 ? 0 : p.avgCost,
      trades: [{ type: "SELL", qty, price: simPrice, total: proceeds, time: simTicks[simIndex]?.timestamp }, ...p.trades] }));
    setSimMsg({ type: "ok", text: `Sold ${qty} share${qty !== 1 ? "s" : ""} at $${fmt2(simPrice)}` });
    setTimeout(() => setSimMsg(null), 2000);
  };

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

  // Moving averages for chart — 7-period and 20-period
  const chartWithMA = useMemo(() => {
    return chartData.map((pt, i, arr) => {
      const slice7  = arr.slice(Math.max(0, i - 6),  i + 1).map(p => p.price);
      const slice20 = arr.slice(Math.max(0, i - 19), i + 1).map(p => p.price);
      const ma7  = slice7.length  >= 3  ? slice7.reduce((s, v) => s + v, 0)  / slice7.length  : null;
      const ma20 = slice20.length >= 10 ? slice20.reduce((s, v) => s + v, 0) / slice20.length : null;
      return { ...pt, ma7: ma7 ? parseFloat(ma7.toFixed(2)) : null, ma20: ma20 ? parseFloat(ma20.toFixed(2)) : null };
    });
  }, [chartData]);

  // Paper trading derived
  const paperValue  = paper.shares * (price ?? 0);
  const paperTotal  = paper.cash + paperValue;
  const paperPnL    = paperTotal - 10000;
  const paperPnLPct = (paperPnL / 10000) * 100;
  const unrealizedPnL = paper.shares > 0 && price ? (price - paper.avgCost) * paper.shares : 0;

  const stars = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    key: i, size: Math.random() > 0.88 ? 2 : 1, opacity: 0.08 + Math.random() * 0.45,
    top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%`,
    dur: `${2.5 + Math.random() * 5}s`, delay: `${Math.random() * 5}s`,
  })), []);

  // Comparison — find closest prices for selected date vs today
  const cmpResult = useMemo(() => {
    if (!DB.price_history.length) return null;

    // All records on the selected day
    const dayRecords = DB.price_history.filter(r => r.timestamp.slice(0, 10) === cmpDate);

    // Available days for the dropdown
    const availableDays = [...new Set(DB.price_history.map(r => r.timestamp.slice(0, 10)))].sort();

    if (!dayRecords.length) return { availableDays, thenPrice: null, thenTime: null };

    // Use the last price of that day (closing price for the day)
    const sorted = [...dayRecords].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const last = sorted[sorted.length - 1];

    // Today's latest price
    const today = DB.price_history[DB.price_history.length - 1];

    const thenPrice = parseFloat(last.price);
    const nowPrice  = price ?? parseFloat(today?.price ?? 0);
    const delta     = nowPrice - thenPrice;
    const deltaPct  = (delta / thenPrice) * 100;

    return { availableDays, thenPrice, thenTime: last.timestamp, nowPrice, delta, deltaPct, isUp: delta >= 0 };
  }, [cmpDate, price]);

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
        @keyframes twinkle    { 0%,100%{opacity:.05} 50%{opacity:.6} }
        @keyframes spin       { to{transform:rotate(360deg)} }
        @keyframes flash-up   { 0%{background:#064e3b66} 100%{background:transparent} }
        @keyframes flash-down { 0%{background:#7f1d1d55} 100%{background:transparent} }
        @keyframes glow-pulse { 0%,100%{box-shadow:0 0 6px #7c3aed33} 50%{box-shadow:0 0 18px #7c3aed77,0 0 32px #7c3aed22} }
        @keyframes dot-pulse  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:.5} }
        @keyframes slideIn    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

        *, *::before, *::after { box-sizing: border-box; }
        html { -webkit-text-size-adjust: 100%; }

        .card { background:linear-gradient(145deg,#0b1220dd,#0e1628dd); border:1px solid #161f35; border-radius:14px; backdrop-filter:blur(8px); transition:border-color .2s; }
        .card:hover { border-color:#1e2d50; }
        .flash-up   { animation:flash-up   .8s ease-out; }
        .flash-down { animation:flash-down .8s ease-out; }

        /* ── Top tab bar (desktop/tablet) ── */
        .tab-bar { display:flex; gap:0; border-bottom:1px solid #161f35; margin-bottom:20px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
        .tab-bar::-webkit-scrollbar { display:none; }
        .tab-btn { background:transparent; border:none; cursor:pointer; font-family:inherit; padding:10px 18px; font-size:12px; font-weight:600; letter-spacing:.5px; border-bottom:2px solid transparent; transition:all .15s; color:#4b5563; white-space:nowrap; flex-shrink:0; }
        .tab-btn.active { color:#a78bfa; border-bottom-color:#7c3aed; }
        .tab-btn:hover:not(.active) { color:#6b7280; }

        /* ── Bottom tab bar (mobile) ── */
        .bottom-nav { display:none; }

        /* ── News ── */
        .news-card { border-bottom:1px solid #0f172a; padding:14px 0; animation:slideIn .3s ease; }
        .news-card:last-child { border-bottom:none; }
        .news-card:hover .news-headline { color:#a78bfa !important; }

        /* ── Scrollbar ── */
        ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:#060a12} ::-webkit-scrollbar-thumb{background:#161f35;border-radius:2px}

        input[type=date],input[type=time],input[type=number] { color-scheme:dark; }

        /* ════════════════════════════════
           TABLET  640px – 1023px
        ════════════════════════════════ */
        @media (max-width: 1023px) {
          .peers-grid { grid-template-columns: 1fr !important; }
          .ohlc-grid  { grid-template-columns: 1fr 1fr !important; gap: 6px 16px !important; }
        }

        /* ════════════════════════════════
           MOBILE  < 640px
        ════════════════════════════════ */
        @media (max-width: 639px) {
          /* Switch to bottom nav */
          .tab-bar  { display: none; }
          .bottom-nav {
            display: flex;
            position: fixed;
            bottom: 0; left: 0; right: 0;
            background: #080d18;
            border-top: 1px solid #161f35;
            z-index: 100;
            padding: 0;
            padding-bottom: env(safe-area-inset-bottom);
          }
          .bottom-nav button {
            flex: 1;
            background: transparent;
            border: none;
            color: #4b5563;
            font-family: inherit;
            font-size: 9px;
            font-weight: 600;
            letter-spacing: .3px;
            padding: 10px 4px 8px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            transition: color .15s;
          }
          .bottom-nav button.active { color: #a78bfa; }
          .bottom-nav button .nav-icon { font-size: 18px; line-height: 1; }

          /* Add bottom padding so content clears the nav bar */
          .page-content { padding-bottom: 80px !important; }

          /* Hero price */
          .hero-price { font-size: 36px !important; letter-spacing: -1px !important; }
          .hero-card  { padding: 16px !important; }
          .ohlc-grid  { grid-template-columns: 1fr 1fr !important; gap: 8px 12px !important; }

          /* Cards */
          .card { border-radius: 10px; }

          /* Metrics — 2 col on mobile */
          .metrics-grid { grid-template-columns: 1fr 1fr !important; gap: 8px !important; }

          /* Fundamentals + Peers stack vertically */
          .two-col { grid-template-columns: 1fr !important; }

          /* Comparison middle arrow */
          .cmp-grid { grid-template-columns: 1fr !important; gap: 10px !important; }
          .cmp-arrow { display: none !important; }

          /* Chart height */
          .chart-height { height: 200px !important; }

          /* Table: hide # column */
          .col-num { display: none !important; }

          /* Simulator speed buttons */
          .speed-btns { flex-wrap: wrap !important; }

          /* General text size reduction */
          .section-sub { font-size: 10px !important; }

          /* Stat card values */
          .stat-val { font-size: 16px !important; }

          /* Peer bar chart */
          .peer-bar { height: 90px !important; }

          /* Hide footer on mobile */
          .footer { display: none; }
        }
      `}</style>

      <div className="page-content" style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto", padding: isMobile ? "14px 10px 60px" : "20px 14px 60px" }}>

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
          className="hero-card" style={{ padding: "24px 28px", marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: 2 }}>Space Exploration Technologies · NYSE</span>
              <span style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 5, padding: "1px 8px", fontSize: 10, fontWeight: 700, color: "#6366f1", letterSpacing: 1 }}>SPCX</span>
              {profile?.ipo && <span style={{ fontSize: 10, color: "#4b5563" }}>IPO {profile.ipo}</span>}
            </div>
            {loading ? (
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 52, fontWeight: 700, color: "#1e2d50", letterSpacing: "-2px" }}>—</div>
            ) : (
              <div className="hero-price" style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 52, fontWeight: 700, letterSpacing: "-2px", color: "#f8fafc" }}>
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
          <div className="ohlc-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 32px", textAlign: "right" }}>
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
        <div className="metrics-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="Total Company Worth" term="Market Cap" value={fmtMktCap(metrics?.marketCapitalization ?? profile?.marketCapitalization)} sub="What SpaceX is worth if you bought every share today" accent="radial-gradient(circle,#4c1d9522,transparent)" />
          <StatCard label="Best Price This Year" term="52-Week High" value={metrics?.["52WeekHigh"] ? `$${fmt2(metrics["52WeekHigh"])}` : "—"} sub={`Highest it ever traded — ${metrics?.["52WeekHighDate"] ?? ""}`} accent="radial-gradient(circle,#14532d22,transparent)" />
          <StatCard label="Lowest Price This Year" term="52-Week Low" value={metrics?.["52WeekLow"] ? `$${fmt2(metrics["52WeekLow"])}` : "—"} sub={`Cheapest it has been — ${metrics?.["52WeekLowDate"] ?? ""}`} accent="radial-gradient(circle,#7f1d1d22,transparent)" />
          <StatCard label="How Actively Traded" term="Avg Volume (10D)" value={metrics?.["10DayAverageTradingVolume"] ? `${metrics["10DayAverageTradingVolume"].toFixed(1)}M` : "—"} sub="Shares swapped daily — high = easy to buy or sell fast" accent="radial-gradient(circle,#1e3a5f22,transparent)" />
          <StatCard label="Sales Growing?" term="Revenue Growth YoY" value={metrics?.revenueGrowthQuarterlyYoy != null ? fmtPct(metrics.revenueGrowthQuarterlyYoy) : "—"} sub="Making more than last year? Positive = business expanding" accent="radial-gradient(circle,#064e3b22,transparent)" />
          <StatCard label="Profit Kept Per Sale" term="Gross Margin" value={metrics?.grossMarginAnnual != null ? `${metrics.grossMarginAnnual.toFixed(1)}%` : "—"} sub="Of every $1 earned, how much survives after direct costs" accent="radial-gradient(circle,#1e1a4f22,transparent)" />
          <StatCard label="Cheap vs Real Assets?" term="Price-to-Book (P/B)" value={metrics?.pb != null ? `${metrics.pb.toFixed(1)}x` : "—"} sub="How much you pay per $1 of SpaceX's real assets — lower = cheaper" accent="radial-gradient(circle,#2d1b4e22,transparent)" />
          <StatCard label="Last 5 Days" term="5-Day Return" value={metrics?.["5DayPriceReturnDaily"] != null ? fmtPct(metrics["5DayPriceReturnDaily"]) : "—"} sub="Did the stock rise or fall over the past week?" accent="radial-gradient(circle,#0c2a4e22,transparent)" />
        </div>

        {/* ── Tab navigation (desktop/tablet) ── */}
        <div className="tab-bar">
          {[["overview","Overview"],["trade","Paper Trade"],["learn","Learn Trading"],["news","News Feed"],["table","Price Log"],["calculator","Calculator"]].map(([id, label]) => (
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

              {/* ── Trend banner ── */}
              {!chartLoading && !loading && chartData.length >= 2 && (() => {
                const first = chartData[0].price, last = chartData[chartData.length - 1].price;
                const d = last - first, dp = (d / first) * 100, up = d >= 0;
                const lastMA7  = [...chartWithMA].reverse().find(p => p.ma7  != null)?.ma7;
                const lastMA20 = [...chartWithMA].reverse().find(p => p.ma20 != null)?.ma20;
                const aboveMA7  = lastMA7  != null && last > lastMA7;
                const aboveMA20 = lastMA20 != null && last > lastMA20;
                const signal = (aboveMA7 && aboveMA20) ? "Strong bullish" : (!aboveMA7 && !aboveMA20) ? "Strong bearish" : aboveMA7 ? "Mildly bullish" : "Mildly bearish";
                const sigColor = signal.includes("bullish") ? "#34d399" : "#f87171";
                return (
                  <div style={{ marginBottom: 14, borderRadius: 10, padding: "10px 16px", background: up ? "#052e1633" : "#2d0a0a33", border: `1px solid ${up ? "#065f4633" : "#7f1d1d33"}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 12, color: up ? "#6ee7b7" : "#fca5a5", lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 700 }}>{up ? "📈" : "📉"} {range} Trend: </span>
                      SPCX {up ? "rose" : "fell"} <b>${fmt2(Math.abs(d))}</b> ({up ? "+" : ""}{dp.toFixed(2)}%) — price is {aboveMA7 ? "above" : "below"} the short-term average
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: sigColor, background: sigColor + "22", border: `1px solid ${sigColor}44`, borderRadius: 6, padding: "3px 10px" }}>
                      {signal} signal
                    </div>
                  </div>
                );
              })()}

              {chartLoading || loading ? <LoadingPulse /> : (
                <ResponsiveContainer width="100%" height={isMobile ? 220 : 320}>
                  <AreaChart data={chartWithMA} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
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
                              <stop offset="0%" stopColor={c1} stopOpacity={0.22} /><stop offset="85%" stopColor={c1} stopOpacity={0.02} /><stop offset="100%" stopColor={c1} stopOpacity={0} />
                            </linearGradient>
                          </>
                        );
                      })()}
                    </defs>
                    <CartesianGrid vertical={false} stroke="#0f172a" strokeDasharray="0" />
                    <XAxis dataKey="time" tickFormatter={v => xTick(v, range)} tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={60} dy={6} />
                    <YAxis domain={[minP - pad, maxP + pad]} tick={{ fill: "#374151", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(1)}`} width={56} />
                    <Tooltip content={<ChartTooltip range={range} startPrice={chartData[0]?.price} highPrice={maxP} lowPrice={minP} />} cursor={{ stroke: "#334155", strokeWidth: 1, strokeDasharray: "4 3" }} />
                    {/* Period high & low reference lines */}
                    {chartData.length > 1 && <ReferenceLine y={maxP} stroke="#34d39944" strokeDasharray="3 4" label={{ value: `HIGH $${fmt2(maxP)}`, position: "insideTopRight", fill: "#34d39977", fontSize: 9 }} />}
                    {chartData.length > 1 && <ReferenceLine y={minP} stroke="#f8717144" strokeDasharray="3 4" label={{ value: `LOW $${fmt2(minP)}`, position: "insideBottomRight", fill: "#f8717177", fontSize: 9 }} />}
                    {price && <ReferenceLine y={price} stroke="#1e2d5088" strokeDasharray="3 4" label={{ value: `NOW $${fmt2(price)}`, position: "right", fill: "#4b5563", fontSize: 9 }} />}
                    <Area type="monotone" dataKey="price" stroke="url(#strokeGrad)" strokeWidth={2.5} fill="url(#areaFill)" dot={false} activeDot={{ r: 6, fill: "#a78bfa", stroke: "#1e1040", strokeWidth: 2 }} />
                    {showMA7  && <Area type="monotone" dataKey="ma7"  stroke="#fbbf24" strokeWidth={1.5} fill="none" dot={false} connectNulls />}
                    {showMA20 && <Area type="monotone" dataKey="ma20" stroke="#818cf8" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 3" connectNulls />}
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {/* ── MA toggle pills + legend ── */}
              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#374151", paddingTop: 4 }}>{chartData.length} data points · Finnhub</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {/* MA7 toggle */}
                  <button onClick={() => setShowMA7(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: showMA7 ? "#fbbf2422" : "#080d18", border: `1px solid ${showMA7 ? "#fbbf2466" : "#1e293b"}`, borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>
                    <span style={{ display: "inline-block", width: 16, height: 2, background: showMA7 ? "#fbbf24" : "#374151", borderRadius: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: showMA7 ? "#fbbf24" : "#4b5563" }}>MA7</span>
                    <span style={{ fontSize: 9, color: showMA7 ? "#92400e" : "#374151" }}>7-day avg · short trend</span>
                  </button>
                  {/* MA20 toggle */}
                  <button onClick={() => setShowMA20(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: showMA20 ? "#818cf822" : "#080d18", border: `1px solid ${showMA20 ? "#818cf866" : "#1e293b"}`, borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>
                    <span style={{ display: "inline-block", width: 16, height: 2, background: showMA20 ? "#818cf8" : "#374151", borderRadius: 1, flexShrink: 0, borderTop: "2px dashed currentColor" }} />
                    <span style={{ fontSize: 10, fontWeight: 600, color: showMA20 ? "#818cf8" : "#4b5563" }}>MA20</span>
                    <span style={{ fontSize: 9, color: showMA20 ? "#3730a3" : "#374151" }}>20-day avg · long trend</span>
                  </button>
                </div>
              </div>
              {/* MA explanation strip — shown when either is on */}
              {(showMA7 || showMA20) && !chartLoading && chartData.length >= 2 && (() => {
                const last = chartData[chartData.length - 1].price;
                const lastMA7  = [...chartWithMA].reverse().find(p => p.ma7  != null)?.ma7;
                const lastMA20 = [...chartWithMA].reverse().find(p => p.ma20 != null)?.ma20;
                return (
                  <div style={{ marginTop: 8, padding: "8px 14px", background: "#060a12", border: "1px solid #1e293b", borderRadius: 8, fontSize: 11, color: "#4b5563", lineHeight: 1.6 }}>
                    💡 <b style={{ color: "#6b7280" }}>What do averages mean?</b> When the price line is <span style={{ color: "#34d399" }}>above</span> an average, buyers are winning. When it's <span style={{ color: "#f87171" }}>below</span>, sellers are winning.
                    {showMA7  && lastMA7  != null && <span> · MA7 now at <b style={{ color: "#fbbf24" }}>${fmt2(lastMA7)}</b> — price is {last >= lastMA7 ? <span style={{ color: "#34d399" }}>above ↑ bullish</span> : <span style={{ color: "#f87171" }}>below ↓ bearish</span>}</span>}
                    {showMA20 && lastMA20 != null && <span> · MA20 now at <b style={{ color: "#818cf8" }}>${fmt2(lastMA20)}</b> — price is {last >= lastMA20 ? <span style={{ color: "#34d399" }}>above ↑ bullish</span> : <span style={{ color: "#f87171" }}>below ↓ bearish</span>}</span>}
                  </div>
                );
              })()}
            </div>

            {/* Fundamentals + Peers side by side */}
            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>

              {/* Fundamentals */}
              <div className="card" style={{ padding: "22px" }}>
                <SectionTitle icon="◎" title="Company Health" sub="How SpaceX is actually doing financially" />
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {[
                    ["EPS",              "Earnings Per Share — profit made per share owned",          metrics?.epsAnnual != null ? `$${metrics.epsAnnual.toFixed(4)}` : "—"],
                    ["Net Margin",       "Net Profit Margin — % of revenue left after ALL costs",      metrics?.netProfitMarginAnnual != null ? `${metrics.netProfitMarginAnnual.toFixed(2)}%` : "—"],
                    ["Op. Margin",       "Operating Margin — profit before tax & interest payments",   metrics?.operatingMarginAnnual != null ? `${metrics.operatingMarginAnnual.toFixed(2)}%` : "—"],
                    ["ROA",              "Return on Assets — how well SpaceX uses what it owns",       metrics?.roaRfy != null ? `${metrics.roaRfy.toFixed(2)}%` : "—"],
                    ["ROE",              "Return on Equity — profit made from investor money",         metrics?.roeRfy != null ? `${metrics.roeRfy.toFixed(2)}%` : "—"],
                    ["D/E Ratio",        "Debt-to-Equity — how much debt vs investor money (lower = safer)", metrics?.["totalDebt/totalEquityAnnual"] != null ? metrics["totalDebt/totalEquityAnnual"].toFixed(3) : "—"],
                    ["Current Ratio",    "Current Ratio — can it pay short-term bills? Above 1 = yes", metrics?.currentRatioAnnual != null ? metrics.currentRatioAnnual.toFixed(2) : "—"],
                    ["Cash/Share",       "Cash Per Share — liquid cash held for each share",           metrics?.cashPerSharePerShareAnnual != null ? `$${metrics.cashPerSharePerShareAnnual.toFixed(4)}` : "—"],
                    ["YTD Return",       "Year-to-Date Return — gain or loss since Jan 1",             metrics?.yearToDatePriceReturnDaily != null ? fmtPct(metrics.yearToDatePriceReturnDaily) : "—"],
                    ["vs S&P 500",       "Relative Performance — beating the US market? + = yes",     metrics?.["priceRelativeToS&P500Ytd"] != null ? fmtPct(metrics["priceRelativeToS&P500Ytd"]) : "—"],
                  ].map(([term, plain, val]) => {
                    const isNeg = typeof val === "string" && val.startsWith("-") && val.includes("%");
                    const isPos = typeof val === "string" && val.startsWith("+");
                    return (
                      <div key={term} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #0f172a", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#c7d2fe", fontWeight: 600 }}>{term}</div>
                          <div style={{ fontSize: 10, color: "#4b5563", marginTop: 1 }}>{plain}</div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif", color: isPos ? "#34d399" : isNeg ? "#f87171" : "#94a3b8", flexShrink: 0 }}>{val}</span>
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
                    <ResponsiveContainer className="peer-bar" width="100%" height={120}>
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

            {/* Price Comparison */}
            <div className="card" style={{ padding: "22px", marginBottom: 18 }}>
              <SectionTitle icon="⇄" title="Price Comparison" sub="Compare today's price against any previous day" />

              {/* Date selector row */}
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Compare today vs</span>
                <select value={cmpDate} onChange={e => setCmpDate(e.target.value)}
                  style={{ background: "#080d18", border: "1px solid #5b21b6", color: "#a5b4fc", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", outline: "none", appearance: "none" }}>
                  {(cmpResult?.availableDays ?? []).filter(d => d !== new Date().toISOString().slice(0, 10)).map(d => (
                    <option key={d} value={d}>{new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</option>
                  ))}
                </select>
              </div>

              {cmpResult?.thenPrice == null ? (
                <div style={{ textAlign: "center", padding: "20px 0", color: "#374151", fontSize: 13 }}>No price data recorded for that day.</div>
              ) : (
                <>
                  {/* Main comparison display */}
                  <div className="cmp-grid" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center", marginBottom: 20 }}>

                    {/* THEN */}
                    <div className="card" style={{ padding: "20px 24px", background: "#060a12", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>
                        {new Date(cmpResult.thenTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 32, fontWeight: 700, color: "#94a3b8", letterSpacing: "-1px" }}>
                        ${fmt2(cmpResult.thenPrice)}
                      </div>
                      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6 }}>
                        Last recorded price that day
                      </div>
                    </div>

                    {/* Arrow + delta */}
                    <div className="cmp-arrow" style={{ textAlign: "center", minWidth: 100 }}>
                      <div style={{ fontSize: 28, color: cmpResult.isUp ? "#34d399" : "#f87171", lineHeight: 1 }}>
                        {cmpResult.isUp ? "↑" : "↓"}
                      </div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: cmpResult.isUp ? "#34d399" : "#f87171", marginTop: 4 }}>
                        {cmpResult.isUp ? "+" : ""}{fmt2(cmpResult.delta)}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: cmpResult.isUp ? "#059669" : "#dc2626", marginTop: 2 }}>
                        {cmpResult.isUp ? "+" : ""}{cmpResult.deltaPct.toFixed(2)}%
                      </div>
                    </div>

                    {/* NOW */}
                    <div className="card" style={{ padding: "20px 24px", background: "#060a12", textAlign: "center", border: "1px solid #5b21b644" }}>
                      <div style={{ fontSize: 10, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Today · Live</div>
                      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 32, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-1px" }}>
                        ${fmt2(cmpResult.nowPrice)}
                      </div>
                      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6 }}>Current market price</div>
                    </div>
                  </div>

                  {/* Summary banner */}
                  <div style={{ borderRadius: 10, padding: "14px 20px", background: cmpResult.isUp ? "#052e1666" : "#2d0a0a66", border: `1px solid ${cmpResult.isUp ? "#065f4644" : "#7f1d1d44"}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <span style={{ fontSize: 13, color: cmpResult.isUp ? "#6ee7b7" : "#fca5a5" }}>
                      {cmpResult.isUp ? "📈" : "📉"} Since {new Date(cmpResult.thenTime).toLocaleDateString("en-US", { month: "long", day: "numeric" })}, SPCX has {cmpResult.isUp ? "gained" : "dropped"}
                    </span>
                    <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: cmpResult.isUp ? "#34d399" : "#f87171" }}>
                      {cmpResult.isUp ? "+" : ""}{fmt2(cmpResult.delta)} ({cmpResult.isUp ? "+" : ""}{cmpResult.deltaPct.toFixed(2)}%)
                    </span>
                  </div>

                  {/* Share button */}
                  <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => {
                      const text = `SPCX was $${fmt2(cmpResult.thenPrice)} on ${new Date(cmpResult.thenTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — it's now $${fmt2(cmpResult.nowPrice)} (${cmpResult.isUp ? "+" : ""}${cmpResult.deltaPct.toFixed(2)}%) 🚀 via PULSAR`;
                      if (navigator.share) {
                        navigator.share({ title: "SPCX Price Comparison", text });
                      } else {
                        navigator.clipboard.writeText(text);
                        alert("Copied to clipboard!");
                      }
                    }} style={{ background: "linear-gradient(135deg,#4c1d95,#1e3a8a)", border: "none", color: "#c7d2fe", borderRadius: 8, padding: "8px 20px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", letterSpacing: 0.5 }}>
                      Share This Comparison
                    </button>
                  </div>
                </>
              )}
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
                    <th key={h} className={h === "#" ? "col-num" : ""} style={{ textAlign: "left", color: "#6b7280", fontWeight: 600, padding: "8px 14px", borderBottom: "1px solid #1e293b", letterSpacing: 1, fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
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
                        <td className="col-num" style={{ padding: "7px 14px", color: "#374151", fontSize: 11 }}>{filteredLog.length - i}</td>
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

        {/* ══════════════════════ PAPER TRADE TAB ══════════════════════ */}
        {activeTab === "trade" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { resetSim(); setSimMode(false); }} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `2px solid ${!simMode ? "#7c3aed" : "#161f35"}`, background: !simMode ? "linear-gradient(135deg,#170d38,#0f1a35)" : "#0b1220", color: !simMode ? "#a78bfa" : "#4b5563", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all .2s" }}>
                ◈ Live Paper Trade
                <div style={{ fontSize: 10, fontWeight: 400, marginTop: 3, color: !simMode ? "#6d28d9" : "#374151" }}>Buy & sell at today's live price</div>
              </button>
              <button onClick={() => setSimMode(true)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `2px solid ${simMode ? "#7c3aed" : "#161f35"}`, background: simMode ? "linear-gradient(135deg,#170d38,#0f1a35)" : "#0b1220", color: simMode ? "#a78bfa" : "#4b5563", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all .2s" }}>
                ⏵ Time Machine Simulator
                <div style={{ fontSize: 10, fontWeight: 400, marginTop: 3, color: simMode ? "#6d28d9" : "#374151" }}>Replay a past trading day tick by tick</div>
              </button>
            </div>

            {/* ── SIMULATOR MODE ── */}
            {simMode && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Setup screen — shown before sim starts */}
                {!simTicks.length && (
                  <div className="card" style={{ padding: "28px" }}>
                    <SectionTitle icon="⏵" title="Time Machine Simulator" sub="Pick a real trading day — watch the actual SPCX price tick through live. Buy & sell as it happens." />

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", marginBottom: 24 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Choose a trading day</div>
                        <select value={simDay} onChange={e => setSimDay(e.target.value)}
                          style={{ background: "#080d18", border: "1px solid #5b21b6", color: "#a5b4fc", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontFamily: "inherit", cursor: "pointer", outline: "none", appearance: "none", minWidth: 220 }}>
                          <option value="">— select a day —</option>
                          {[...new Set(DB.price_history.map(r => r.timestamp.slice(0, 10)))].sort().map(d => {
                            const count = DB.price_history.filter(r => r.timestamp.slice(0, 10) === d).length;
                            return <option key={d} value={d}>{new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })} — {count} price ticks</option>;
                          })}
                        </select>
                      </div>

                      <div>
                        <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Playback speed</div>
                        <div className="speed-btns" style={{ display: "flex", gap: 6 }}>
                          {[["2 min", 120000], ["30 sec", 30000], ["10 sec", 10000], ["Fast", 2000]].map(([label, val]) => (
                            <button key={val} onClick={() => setSimSpeed(val)} style={{ background: simSpeed === val ? "linear-gradient(135deg,#170d38,#0f1a35)" : "#080d18", border: `1px solid ${simSpeed === val ? "#5b21b6" : "#1e293b"}`, color: simSpeed === val ? "#a78bfa" : "#4b5563", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>{label}</button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {simDay && (
                      <div style={{ marginBottom: 20, padding: "14px 18px", background: "#080d18", borderRadius: 10, border: "1px solid #1e293b" }}>
                        {(() => {
                          const ticks = DB.price_history.filter(r => r.timestamp.slice(0, 10) === simDay).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                          const open = ticks[0]?.price, close = ticks[ticks.length - 1]?.price;
                          const hi = Math.max(...ticks.map(t => t.price)), lo = Math.min(...ticks.map(t => t.price));
                          const pct = open ? ((close - open) / open * 100).toFixed(2) : null;
                          return (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                              <div><div style={{ fontSize: 10, color: "#4b5563", marginBottom: 3 }}>Open</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: "#94a3b8" }}>${fmt2(open)}</div></div>
                              <div><div style={{ fontSize: 10, color: "#4b5563", marginBottom: 3 }}>Close</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>${fmt2(close)}</div></div>
                              <div><div style={{ fontSize: 10, color: "#4b5563", marginBottom: 3 }}>High</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: "#34d399" }}>${fmt2(hi)}</div></div>
                              <div><div style={{ fontSize: 10, color: "#4b5563", marginBottom: 3 }}>Low</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: "#f87171" }}>${fmt2(lo)}</div></div>
                              <div><div style={{ fontSize: 10, color: "#4b5563", marginBottom: 3 }}>Day Move</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: pct >= 0 ? "#34d399" : "#f87171" }}>{pct >= 0 ? "+" : ""}{pct}%</div></div>
                              <div><div style={{ fontSize: 10, color: "#4b5563", marginBottom: 3 }}>Price Ticks</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: "#a5b4fc" }}>{ticks.length}</div></div>
                            </div>
                          );
                        })()}
                        <div style={{ fontSize: 11, color: "#374151", marginTop: 12 }}>You won't see the prices in advance. They'll reveal one by one as the simulation plays — just like real trading.</div>
                      </div>
                    )}

                    {simMsg && <div style={{ marginBottom: 14, padding: "10px 16px", borderRadius: 8, background: "#2d0a0a88", color: "#f87171", fontSize: 13 }}>⚠ {simMsg.text}</div>}

                    <button onClick={startSim} disabled={!simDay}
                      style={{ background: simDay ? "linear-gradient(135deg,#4c1d95,#1e3a8a)" : "#1a1a2e", border: "none", color: simDay ? "#c7d2fe" : "#374151", borderRadius: 10, padding: "14px 36px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: simDay ? "pointer" : "not-allowed", letterSpacing: 0.5, boxShadow: simDay ? "0 0 24px #7c3aed33" : "none" }}>
                      ⏵ Start Simulation
                    </button>
                  </div>
                )}

                {/* Active simulation */}
                {simTicks.length > 0 && (
                  <>
                    {/* Live ticker */}
                    <div className={`card${simPrice && simTicks[simIndex - 1] ? (simPrice >= simTicks[simIndex - 1]?.price ? " flash-up" : " flash-down") : ""}`}
                      style={{ padding: "22px 28px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#7c3aed", textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>
                          Simulating — {new Date(simDay + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                        </div>
                        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 48, fontWeight: 700, color: "#f8fafc", letterSpacing: "-2px" }}>
                          ${fmt2(simPrice)}
                        </div>
                        {simIndex > 0 && (() => {
                          const prev = simTicks[simIndex - 1]?.price;
                          const d = simPrice - prev, up = d >= 0;
                          return <div style={{ fontSize: 14, color: up ? "#34d399" : "#f87171", marginTop: 4 }}>{up ? "▲" : "▼"} {up && d > 0 ? "+" : ""}{fmt2(d)} this tick</div>;
                        })()}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                        <div style={{ fontSize: 11, color: "#4b5563" }}>Tick {simIndex + 1} of {simTicks.length}</div>
                        <div style={{ width: 160, height: 6, background: "#161f35", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${((simIndex + 1) / simTicks.length) * 100}%`, background: "linear-gradient(90deg,#7c3aed,#2563eb)", borderRadius: 3, transition: "width .3s" }} />
                        </div>
                        <div style={{ fontSize: 10, color: "#374151" }}>
                          {simTicks[simIndex] ? new Date(simTicks[simIndex].timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }) + " UTC" : ""}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          {simRunning
                            ? <button onClick={stopSim} style={{ background: "#1e293b", border: "1px solid #374151", color: "#fbbf24", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>⏸ Pause</button>
                            : !simDone && <button onClick={() => setSimRunning(true)} style={{ background: "#052e16", border: "1px solid #059669", color: "#34d399", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>⏵ Resume</button>
                          }
                          <button onClick={resetSim} style={{ background: "none", border: "1px solid #1e293b", color: "#4b5563", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>✕ End</button>
                        </div>
                      </div>
                    </div>

                    {simDone && (
                      <div style={{ padding: "16px 22px", borderRadius: 12, background: "#0b1220", border: "1px solid #7c3aed44", textAlign: "center" }}>
                        <div style={{ fontSize: 14, color: "#a78bfa", fontWeight: 700, marginBottom: 6 }}>Simulation Complete</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>That was the full trading day. See your results below, then try a different day.</div>
                      </div>
                    )}

                    {/* Mini chart */}
                    {simChartData.length > 1 && (
                      <div className="card" style={{ padding: "18px 18px 10px" }}>
                        <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>Price so far</div>
                        <ResponsiveContainer width="100%" height={160}>
                          <AreaChart data={simChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="simFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="time" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#374151", fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                            <YAxis domain={["auto", "auto"]} tick={{ fill: "#374151", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={48} />
                            <Tooltip formatter={v => [`$${fmt2(v)}`, "Price"]} contentStyle={{ background: "#0b1220", border: "1px solid #1e2d50", borderRadius: 8, fontSize: 11 }} />
                            <Area type="monotone" dataKey="price" stroke="#7c3aed" strokeWidth={2} fill="url(#simFill)" dot={false} activeDot={{ r: 4, fill: "#a78bfa" }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* Sim trade panel */}
                    <div className="card" style={{ padding: "22px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#c7d2fe", fontWeight: 600 }}>Simulation Portfolio</div>
                          <div style={{ fontSize: 10, color: "#4b5563" }}>Virtual $10,000 — separate from your live paper trade account</div>
                        </div>
                        <div style={{ display: "flex", gap: 20 }}>
                          {[
                            ["Cash", `$${fmt2(simPaper.cash)}`],
                            ["Shares", simPaper.shares.toFixed(4)],
                            ["Avg Cost", simPaper.shares > 0 ? `$${fmt2(simPaper.avgCost)}` : "—"],
                            ["Open P&L", simPaper.shares > 0 && simPrice ? `${((simPrice - simPaper.avgCost) * simPaper.shares) >= 0 ? "+" : ""}$${fmt2((simPrice - simPaper.avgCost) * simPaper.shares)}` : "—"],
                          ].map(([l, v]) => (
                            <div key={l} style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 9, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1 }}>{l}</div>
                              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: l === "Open P&L" ? (v.startsWith("+") ? "#34d399" : "#f87171") : "#94a3b8" }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 1 }}>Shares</div>
                          <input type="number" min="0.01" step="0.01" value={simQty} onChange={e => setSimQty(e.target.value)}
                            style={{ background: "#080d18", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontFamily: "inherit", outline: "none", width: 110 }} />
                        </div>
                        {simPrice && simQty && <div style={{ fontSize: 12, color: "#4b5563", marginTop: 16 }}>= <span style={{ color: "#94a3b8", fontWeight: 600 }}>${fmt2(parseFloat(simQty) * simPrice)}</span></div>}
                        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                          <button onClick={doSimBuy} disabled={!simPrice} style={{ background: "linear-gradient(135deg,#065f46,#064e3b)", border: "1px solid #059669", color: "#34d399", borderRadius: 8, padding: "8px 24px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>BUY</button>
                          <button onClick={doSimSell} disabled={!simPrice || simPaper.shares <= 0} style={{ background: simPaper.shares > 0 ? "linear-gradient(135deg,#7f1d1d,#6b1414)" : "#1a1a2e", border: `1px solid ${simPaper.shares > 0 ? "#dc2626" : "#374151"}`, color: simPaper.shares > 0 ? "#f87171" : "#374151", borderRadius: 8, padding: "8px 24px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: simPaper.shares > 0 ? "pointer" : "not-allowed" }}>SELL</button>
                        </div>
                      </div>

                      {simMsg && (
                        <div style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, background: simMsg.type === "ok" ? "#052e1688" : "#2d0a0a88", border: `1px solid ${simMsg.type === "ok" ? "#065f46" : "#7f1d1d"}`, color: simMsg.type === "ok" ? "#34d399" : "#f87171", fontSize: 12 }}>
                          {simMsg.type === "ok" ? "✓" : "⚠"} {simMsg.text}
                        </div>
                      )}

                      {/* Trade log */}
                      {simPaper.trades.length > 0 && (
                        <div style={{ marginTop: 18 }}>
                          <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Your trades this simulation</div>
                          {simPaper.trades.map((t, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #0f172a", fontSize: 12 }}>
                              <span style={{ background: t.type === "BUY" ? "#052e16" : "#2d0a0a", color: t.type === "BUY" ? "#34d399" : "#f87171", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{t.type}</span>
                              <span style={{ color: "#6b7280" }}>{t.qty} shares</span>
                              <span style={{ color: "#a5b4fc", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600 }}>${fmt2(t.price)}</span>
                              <span style={{ color: "#4b5563" }}>${fmt2(t.total)}</span>
                              <span style={{ color: "#374151", fontSize: 10 }}>{new Date(t.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</span>
                            </div>
                          ))}
                          {simDone && (
                            <div style={{ marginTop: 14, padding: "14px 18px", borderRadius: 10, background: (() => { const final = simPaper.cash + simPaper.shares * (simTicks[simTicks.length - 1]?.price ?? 0); return final >= 10000 ? "#052e1688" : "#2d0a0a88"; })(), border: "1px solid #1e293b" }}>
                              {(() => {
                                const finalPrice = simTicks[simTicks.length - 1]?.price ?? 0;
                                const finalVal = simPaper.cash + simPaper.shares * finalPrice;
                                const pnl = finalVal - 10000;
                                return (
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                                    <span style={{ fontSize: 13, color: "#94a3b8" }}>Final portfolio value</span>
                                    <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, fontWeight: 700, color: pnl >= 0 ? "#34d399" : "#f87171" }}>
                                      ${fmt2(finalVal)} <span style={{ fontSize: 13, opacity: 0.7 }}>({pnl >= 0 ? "+" : ""}${fmt2(pnl)})</span>
                                    </span>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── LIVE PAPER MODE ── */}
            {!simMode && (
              <>
            {/* Portfolio summary */}
            <div className="card" style={{ padding: "24px 28px" }}>
              <SectionTitle icon="◈" title="Your Virtual Portfolio" sub="Start with $10,000 — practice buying & selling SPCX with no real money at risk" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 }}>
                {[
                  { label: "Total Portfolio Value", term: "Market Value", val: `$${fmt2(paperTotal)}`, color: paperPnL >= 0 ? "#34d399" : "#f87171" },
                  { label: "Cash Available",        term: "Buying Power",  val: `$${fmt2(paper.cash)}`,  color: "#94a3b8" },
                  { label: "Shares Owned",          term: "Position Size", val: paper.shares.toFixed(4), color: "#c7d2fe" },
                  { label: "Avg Buy Price",         term: "Cost Basis",    val: paper.shares > 0 ? `$${fmt2(paper.avgCost)}` : "—", color: "#94a3b8" },
                  { label: "Unrealised Gain/Loss",  term: "Open P&L",      val: paper.shares > 0 ? `${unrealizedPnL >= 0 ? "+" : ""}$${fmt2(unrealizedPnL)}` : "—", color: unrealizedPnL >= 0 ? "#34d399" : "#f87171" },
                  { label: "Overall Return",        term: "Total P&L",     val: `${paperPnL >= 0 ? "+" : ""}$${fmt2(paperPnL)} (${paperPnLPct >= 0 ? "+" : ""}${paperPnLPct.toFixed(2)}%)`, color: paperPnL >= 0 ? "#34d399" : "#f87171" },
                ].map(({ label, term, val, color }) => (
                  <div key={label} className="card" style={{ padding: "14px 16px", background: "#060a12" }}>
                    <div style={{ fontSize: 11, color: "#c7d2fe", fontWeight: 600, marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 9, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>{term}</div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Trade panel */}
              <div className="card" style={{ padding: "20px 24px", background: "#060a12" }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
                  Live price: <span style={{ color: "#f1f5f9", fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif", fontSize: 16 }}>${fmt2(price)}</span>
                  <span style={{ color: isUp ? "#34d399" : "#f87171", marginLeft: 10, fontSize: 12 }}>{isUp ? "▲" : "▼"} {fmtPct(changePct)} today</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 1 }}>Number of Shares</div>
                    <input type="number" min="0.01" step="0.01" placeholder="e.g. 1" value={tradeQty} onChange={e => setTradeQty(e.target.value)}
                      style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontFamily: "inherit", outline: "none", width: 130 }} />
                  </div>
                  {price && tradeQty && (
                    <div style={{ fontSize: 12, color: "#4b5563", marginTop: 18 }}>
                      = <span style={{ color: "#94a3b8", fontWeight: 600 }}>${fmt2(parseFloat(tradeQty) * price)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                    <button onClick={doPaperBuy} style={{ background: "linear-gradient(135deg,#065f46,#064e3b)", border: "1px solid #059669", color: "#34d399", borderRadius: 8, padding: "8px 24px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", letterSpacing: 0.5 }}>
                      BUY
                    </button>
                    <button onClick={doPaperSell} disabled={paper.shares <= 0} style={{ background: paper.shares > 0 ? "linear-gradient(135deg,#7f1d1d,#6b1414)" : "#1a1a2e", border: `1px solid ${paper.shares > 0 ? "#dc2626" : "#374151"}`, color: paper.shares > 0 ? "#f87171" : "#374151", borderRadius: 8, padding: "8px 24px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: paper.shares > 0 ? "pointer" : "not-allowed", letterSpacing: 0.5 }}>
                      SELL
                    </button>
                    <button onClick={() => { if (window.confirm("Reset portfolio to $10,000?")) savePaper({ cash: 10000, shares: 0, avgCost: 0, trades: [] }); }}
                      style={{ background: "none", border: "1px solid #1e293b", color: "#4b5563", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                      Reset
                    </button>
                  </div>
                </div>

                {tradeMsg && (
                  <div style={{ marginTop: 14, padding: "10px 16px", borderRadius: 8, background: tradeMsg.type === "ok" ? "#052e1688" : "#2d0a0a88", border: `1px solid ${tradeMsg.type === "ok" ? "#065f46" : "#7f1d1d"}`, color: tradeMsg.type === "ok" ? "#34d399" : "#f87171", fontSize: 13 }}>
                    {tradeMsg.type === "ok" ? "✓" : "⚠"} {tradeMsg.text}
                  </div>
                )}

                {/* Concept explanation */}
                <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 8, background: "#0b1220", border: "1px solid #161f35" }}>
                  <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginBottom: 4 }}>What just happened?</div>
                  <div style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.7 }}>
                    When you press <strong style={{ color: "#34d399" }}>BUY</strong>, you're paying the <strong style={{ color: "#94a3b8" }}>market price</strong> — whatever SPCX is trading at right now. This is called a <strong style={{ color: "#94a3b8" }}>Market Order</strong> — instant, no haggling.{" "}
                    When you press <strong style={{ color: "#f87171" }}>SELL</strong>, you receive the current price and the money goes back to your cash. The difference between your buy price and sell price is your <strong style={{ color: "#94a3b8" }}>Profit or Loss (P&L)</strong>.
                  </div>
                </div>
              </div>
            </div>

            {/* Trade history */}
            {paper.trades.length > 0 && (
              <div className="card" style={{ padding: "22px" }}>
                <SectionTitle icon="◧" title="Trade History" sub="Every simulated trade you've made" />
                <div style={{ overflowY: "auto", maxHeight: 360 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead style={{ position: "sticky", top: 0, background: "#0b1220" }}>
                      <tr>{["Action", "Shares", "Price", "Total Value", "Time"].map(h => (
                        <th key={h} style={{ textAlign: "left", color: "#6b7280", fontWeight: 600, padding: "8px 14px", borderBottom: "1px solid #1e293b", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {paper.trades.map((t, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #0b1220" }}>
                          <td style={{ padding: "8px 14px" }}>
                            <span style={{ background: t.type === "BUY" ? "#052e16" : "#2d0a0a", color: t.type === "BUY" ? "#34d399" : "#f87171", padding: "2px 10px", borderRadius: 5, fontSize: 11, fontWeight: 700 }}>{t.type}</span>
                          </td>
                          <td style={{ padding: "8px 14px", color: "#94a3b8", fontFamily: "'Space Grotesk',sans-serif" }}>{t.qty}</td>
                          <td style={{ padding: "8px 14px", color: "#a5b4fc", fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600 }}>${fmt2(t.price)}</td>
                          <td style={{ padding: "8px 14px", color: "#6b7280" }}>${fmt2(t.total)}</td>
                          <td style={{ padding: "8px 14px", color: "#374151", fontSize: 11 }}>{new Date(t.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            </>
            )}
          </div>
        )}

        {/* ══════════════════════ LEARN TAB ══════════════════════ */}
        {activeTab === "learn" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              {
                term: "Stock / Share",
                emoji: "🏢",
                plain: "What does owning a share actually mean?",
                body: `When you buy 1 share of SPCX, you own a tiny piece of SpaceX. Right now SpaceX has millions of shares out there. The price of one share is $${fmt2(price)} — that's what the market thinks one tiny piece is worth today. If SpaceX does well, more people want a piece, the price goes up. If it struggles, people sell, price drops.`,
                live: `SPCX current price: $${fmt2(price)} · Company total value: ${fmtMktCap(metrics?.marketCapitalization)}`,
              },
              {
                term: "Market Cap",
                emoji: "💰",
                plain: "How do you measure how big a company is?",
                body: `Market Cap = Share Price × Total Shares. It's the total cost to buy every single share of SpaceX right now. A $2T market cap means SpaceX is worth roughly 2 trillion dollars in the market's eyes. It has nothing to do with how much cash SpaceX actually has in the bank — it's what people are willing to pay for it.`,
                live: `SPCX Market Cap: ${fmtMktCap(metrics?.marketCapitalization)} · Price per share: $${fmt2(price)}`,
              },
              {
                term: "Bull & Bear Market",
                emoji: "🐂🐻",
                plain: "Why do traders talk about bulls and bears?",
                body: `A Bull market means prices are going UP — investors are confident, buying more, pushing prices higher. A Bear market means prices are going DOWN — fear spreads, people sell, prices fall. The terms come from how the animals attack: a bull thrusts UP with its horns, a bear swipes DOWN with its paws. Simple as that.`,
                live: `SPCX is ${(changePct ?? 0) >= 0 ? "up today — short-term bullish signal" : "down today — short-term bearish signal"} (${fmtPct(changePct)} today)`,
              },
              {
                term: "Moving Average (MA)",
                emoji: "📈",
                plain: "What's that extra line on the chart?",
                body: `A Moving Average smooths out price noise. MA7 (yellow line) = average of the last 7 prices. MA20 (purple dashed) = average of the last 20 prices. When the price is ABOVE the MA line, it's trending up — bullish. When price drops BELOW the MA, it may be turning bearish. When the short MA (7) crosses above the long MA (20) — traders call it a "Golden Cross" — a buy signal.`,
                live: `Check the chart — look where the yellow (MA7) and purple (MA20) lines sit vs the price line`,
              },
              {
                term: "Support & Resistance",
                emoji: "🧱",
                plain: "Why does a stock bounce at certain prices?",
                body: `Support is a price floor — where buyers keep stepping in and stopping the fall. Resistance is a ceiling — where sellers keep appearing and stopping the rise. These aren't magic, they form because lots of people made trades at those levels and remember them. SPCX's 52-week low ($${fmt2(metrics?.["52WeekLow"])}) acts as a strong support level.`,
                live: `SPCX 52W Low (support): $${fmt2(metrics?.["52WeekLow"])} · 52W High (resistance): $${fmt2(metrics?.["52WeekHigh"])}`,
              },
              {
                term: "Volume",
                emoji: "📊",
                plain: "Why does it matter how many shares were traded?",
                body: `Volume = number of shares bought and sold. High volume on a price move means the move is real — lots of conviction. Low volume on a move means it might reverse quickly — not many people behind it. If SPCX jumps 5% on high volume, that's a strong signal. If it jumps 5% on very low volume, be careful — it might not last.`,
                live: `SPCX avg daily volume: ${metrics?.["10DayAverageTradingVolume"]?.toFixed(1)}M shares/day`,
              },
              {
                term: "Bid & Ask",
                emoji: "↕️",
                plain: "Why is there always a tiny gap between buy and sell price?",
                body: `The Bid is the highest price a buyer is willing to pay. The Ask is the lowest price a seller is willing to accept. The gap between them is the Spread — it's the market maker's fee for connecting buyer and seller. When you hit BUY, you pay the Ask. When you hit SELL, you get the Bid. For SPCX, this spread is usually just a few cents, but on less popular stocks it can be dollars wide.`,
                live: `Current SPCX price shown is the mid-point between bid and ask`,
              },
              {
                term: "P&L — Profit & Loss",
                emoji: "💸",
                plain: "How do you calculate if you made or lost money?",
                body: `P&L = (Current Price − Your Buy Price) × Number of Shares. If you bought at $150 and it's now $156, your P&L is +$6 per share. If you own 10 shares, that's +$60 unrealised profit. Unrealised means you haven't sold yet — the profit exists on paper but could disappear if the price drops. Once you sell, it becomes Realised P&L — locked in forever.`,
                live: `Go to Paper Trade tab, buy some shares, and watch your Open P&L update live`,
              },
              {
                term: "Risk Management",
                emoji: "🛡️",
                plain: "The rule every trader lives by",
                body: `Never risk more than you can afford to lose. Most professional traders risk only 1-2% of their total capital on any single trade. If you have $10,000, risking $100-$200 per trade. A Stop Loss is an automatic sell order that kicks in if the price drops to a certain level — it caps your downside. With SPCX's 52W range of $${fmt2(metrics?.["52WeekLow"])} to $${fmt2(metrics?.["52WeekHigh"])}, the stock can swing significantly.`,
                live: `SPCX price range this year: $${fmt2(metrics?.["52WeekLow"])} to $${fmt2(metrics?.["52WeekHigh"])} — a ${metrics?.["52WeekHigh"] && metrics?.["52WeekLow"] ? (((metrics["52WeekHigh"] - metrics["52WeekLow"]) / metrics["52WeekLow"]) * 100).toFixed(1) : "—"}% swing`,
              },
              {
                term: "EPS — Earnings Per Share",
                emoji: "📋",
                plain: "Is SpaceX actually making money?",
                body: `EPS = Net Profit ÷ Total Shares. If EPS is positive, the company made money. If negative, it lost money. SpaceX's EPS is currently $${metrics?.epsAnnual?.toFixed(4) ?? "—"} — which means for every share you own, SpaceX's profit/loss per share is that amount. Negative EPS doesn't always mean disaster — growth companies like SpaceX often lose money early while investing heavily in the future.`,
                live: `SPCX EPS: $${metrics?.epsAnnual?.toFixed(4) ?? "—"} · Net margin: ${metrics?.netProfitMarginAnnual?.toFixed(2) ?? "—"}%`,
              },
            ].map(({ term, emoji, plain, body, live }) => (
              <div key={term} className="card" style={{ padding: "22px 24px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>{emoji}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: "#c7d2fe" }}>{term}</span>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>{plain}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.8, marginBottom: 12 }}>{body}</div>
                    <div style={{ background: "#0b1220", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 14px", fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>
                      Live: <span style={{ color: "#6b7280", fontWeight: 400 }}>{live}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="footer" style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: "#4b5563", letterSpacing: 1.5 }}>
          PULSAR · SPCX · DATA BY FINNHUB · {new Date().getFullYear()}
        </div>
      </div>

      {/* Mobile bottom navigation — hidden on tablet/desktop via CSS */}
      <nav className="bottom-nav">
        {[
          ["overview",   "📊", "Overview"],
          ["trade",      "💹", "Trade"],
          ["learn",      "🎓", "Learn"],
          ["news",       "📰", "News"],
          ["table",      "🗃️",  "Log"],
          ["calculator", "🧮", "Calc"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            className={activeTab === id ? "active" : ""}
            onClick={() => setActiveTab(id)}
          >
            <span className="nav-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
