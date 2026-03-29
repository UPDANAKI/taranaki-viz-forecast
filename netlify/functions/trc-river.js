// netlify/functions/trc-river.js
// Proxy for river turbidity/flow data from two regional councils:
//   TRC  (Taranaki Regional Council)  — FNU turbidity readings, 5-min interval
//   GWRC (Greater Wellington RC)      — Flow m³/sec readings, 5-min interval
//
// Endpoint: /.netlify/functions/trc-river
// Returns: { ok, fetched, sites: { [siteId]: { name, latestFNU, latestTime, trend, ... } } }
//
// For GWRC flow sites, m³/sec is converted to an equivalent FNU proxy
// using a flow-turbidity relationship calibrated for Kāpiti Coast rivers.

// ── TRC — Turbidity (FNU) via TRC portal ─────────────────────────────────────
const TRC_BASE    = "https://www.trc.govt.nz/environment/maps-and-data/site-details/LoadGraphAndListData";
const TRC_MEASURE = 19;       // Turbidity measurement ID
const TIME_PERIOD = "2days";  // 2 days of 5-min readings — trend + latest

// ── TRC — Rainfall gauges ─────────────────────────────────────────────────────
// measureID=1 = Rainfall (mm, daily totals from TRC portal)
// These give ground-truth rain for coastal spots — far more accurate than
// Open-Meteo's offshore grid cells which badly underestimate coastal NZ rain.
//
// Gauge-to-spot assignment (see App.jsx spot configs):
//   Site 52 (New Plymouth/Brooklands Zoo)   → Motumahanga, Boarfish Rock
//   Site 48 (Waiwhakaiho at Egmont Village) → Nga Motu (drains directly to Back Beach)
//   Site  8 (Cape Egmont)                   → Fin Fuckers, Metal Reef
//   Site 10 (Kaupokonui at Glenn Rd)        → Opunake
//   Site 27 (Patea)                         → Patea Inshore, Patea Offshore Trap
const TRC_RAIN_MEASURE = 1;
const RAIN_TIME_PERIOD = "14days"; // for direct TRC fallback only

const TRC_RAIN_SITES = {
  52: { name: "New Plymouth (Brooklands Zoo)",     coast: "north",  region: "taranaki" },
  48: { name: "Waiwhakaiho at Egmont Village",     coast: "north",  region: "taranaki" },
   8: { name: "Cape Egmont",                       coast: "mid",    region: "taranaki" },
  10: { name: "Kaupokonui at Glenn Rd",            coast: "south",  region: "taranaki" },
  27: { name: "Patea",                             coast: "patea",  region: "taranaki" },
};

const TRC_SITES = {
  12:  { name: "Mangaehu at Huinga",      coast: "south", region: "taranaki" },
  17:  { name: "Mangati at SH3",           coast: "north", region: "taranaki" },
  53:  { name: "Waingongoro at SH45",      coast: "south", region: "taranaki" },
  117: { name: "Waitaha at SH3",           coast: "south", region: "taranaki" },
  166: { name: "Urenui at Okoki Rd",       coast: "north", region: "taranaki" },
  167: { name: "Waiokura at No3 Fairway",  coast: "south", region: "taranaki" },
};

// ── GWRC — Flow (m³/sec) via Hilltop API ─────────────────────────────────────
// Same Hilltop format as TRC but different domain and measurement.
// Site names are the exact strings used in the GWRC Hilltop server.
const GWRC_BASE = "https://hilltop.gw.govt.nz/Data.hts";

const GWRC_SITES = {
  // ID scheme: 1000+ to avoid collision with TRC numeric IDs
  1001: {
    name:        "Waikanae River at Water Treatment Plant",
    site:        "Waikanae River at Water Treatment Plant",
    measurement: "Flow",
    coast:       "kapiti",
    region:      "kapiti",
    lat:         -40.888,
    lon:         175.073,
    // Flow-turbidity relationship for Waikanae:
    // Baseflow ~1.0-1.5 m³/sec = clear (NTU~5-15)
    // Moderate flood ~3-5 m³/sec = elevated turbidity (NTU~50-150)
    // Major flood ~8+ m³/sec = very turbid (NTU~200+)
    // Calibrated from GWRC field data and regional knowledge
    flowThresholds: { low: 1.5, moderate: 3.0, high: 6.0, veryHigh: 12.0 },
    fnu_at_low:      8,    // FNU proxy at baseflow
    fnu_at_moderate: 60,   // FNU proxy at moderate flow
    fnu_at_high:     150,  // FNU proxy at high flow
    fnu_at_veryHigh: 300,  // FNU proxy at flood flow
  },
  1002: {
    name:        "Otaki River at Pukehinau",
    site:        "Otaki River at Pukehinau",
    measurement: "Flow",
    coast:       "kapiti_north",
    region:      "kapiti",
    lat:         -40.822,
    lon:         175.200,
    // Otaki is a larger river — higher baseflow, stronger flood response
    // Baseflow ~3-5 m³/sec = clear
    // Flood ~15-25 m³/sec = turbid
    flowThresholds: { low: 4.0, moderate: 8.0, high: 18.0, veryHigh: 35.0 },
    fnu_at_low:      5,
    fnu_at_moderate: 50,
    fnu_at_high:     140,
    fnu_at_veryHigh: 280,
  },
};

// ── Flow → FNU proxy conversion ───────────────────────────────────────────────
// Uses a piecewise linear interpolation between calibrated threshold points.
function flowToFNU(flow, siteMeta) {
  const { flowThresholds: t, fnu_at_low: f0, fnu_at_moderate: f1,
          fnu_at_high: f2, fnu_at_veryHigh: f3 } = siteMeta;

  if (flow <= t.low)      return f0;
  if (flow <= t.moderate) return f0 + (f1 - f0) * (flow - t.low) / (t.moderate - t.low);
  if (flow <= t.high)     return f1 + (f2 - f1) * (flow - t.moderate) / (t.high - t.moderate);
  if (flow <= t.veryHigh) return f2 + (f3 - f2) * (flow - t.high) / (t.veryHigh - t.high);
  return f3;
}

// ── Fetch a single TRC site (FNU) ─────────────────────────────────────────────
async function fetchTRCSite(siteId) {
  const url = `${TRC_BASE}/?siteID=${siteId}&measureID=${TRC_MEASURE}&timePeriod=${TIME_PERIOD}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "VizcastNZ/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TRC HTTP ${res.status} site ${siteId}`);
  const json = await res.json();
  if (json.error) throw new Error(`TRC error site ${siteId}`);

  const pts = json.highStockData ?? [];
  if (pts.length === 0) return null;

  const [latestTs, latestFNU] = pts[pts.length - 1];
  const sixHoursAgo = latestTs - 6 * 3600 * 1000;
  const sixHourPt = pts.reduce((best, pt) =>
    Math.abs(pt[0] - sixHoursAgo) < Math.abs(best[0] - sixHoursAgo) ? pt : best
  , pts[0]);
  const trend = latestFNU - sixHourPt[1];
  const oneDayAgo = latestTs - 24 * 3600 * 1000;
  const recent = pts.filter(pt => pt[0] >= oneDayAgo);
  const recentMax = Math.max(...recent.map(pt => pt[1]));
  const recentAvg = recent.reduce((sum, pt) => sum + pt[1], 0) / (recent.length || 1);

  return {
    name:      TRC_SITES[siteId].name,
    coast:     TRC_SITES[siteId].coast,
    region:    TRC_SITES[siteId].region,
    source:    "trc_fnu",
    latestFNU: Math.round(latestFNU * 100) / 100,
    latestFlow: null,
    latestTime: new Date(latestTs).toISOString(),
    trend:      Math.round(trend * 100) / 100,
    recentMax:  Math.round(recentMax * 100) / 100,
    recentAvg:  Math.round(recentAvg * 100) / 100,
    sparkline:  pts.slice(-24).map(pt => Math.round(pt[1] * 10) / 10),
  };
}

// ── Fetch a single GWRC site (Flow → FNU proxy) ───────────────────────────────
async function fetchGWRCSite(siteId) {
  const meta = GWRC_SITES[siteId];
  const now   = new Date();
  const from  = new Date(now - 2 * 24 * 3600 * 1000); // 2 days back
  const fmt   = d => `${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}/${d.getFullYear()} ${d.getHours().toString().padStart(2,"0")}:00:00`;

  const url = `${GWRC_BASE}/?Service=Hilltop&Request=GetData` +
    `&Site=${encodeURIComponent(meta.site)}` +
    `&Measurement=${encodeURIComponent(meta.measurement)}` +
    `&From=${encodeURIComponent(fmt(from))}` +
    `&To=${encodeURIComponent(fmt(now))}` +
    `&ShowQuality=No`;

  const res = await fetch(url, {
    headers: { "User-Agent": "VizcastNZ/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GWRC HTTP ${res.status} site ${meta.site}`);

  const text = await res.text();

  // Parse Hilltop XML: <T>2026-03-27T06:10:00</T><I1>4.611</I1>
  const timeRe  = /<T>([^<]+)<\/T>/g;
  const val1Re  = /<I1>([^<]+)<\/I1>/g;
  const times = [...text.matchAll(timeRe)].map(m => m[1]);
  const vals  = [...text.matchAll(val1Re)].map(m => parseFloat(m[1]));

  if (times.length === 0 || vals.length === 0) return null;

  // Build timestamp-value pairs
  const pts = times.map((t, i) => [new Date(t).getTime(), vals[i]])
    .filter(([ts, v]) => !isNaN(ts) && !isNaN(v));

  if (pts.length === 0) return null;

  const [latestTs, latestFlow] = pts[pts.length - 1];
  const latestFNU = Math.round(flowToFNU(latestFlow, meta));

  // 6-hour trend in FNU units (not flow, so it's comparable to TRC)
  const sixHoursAgo = latestTs - 6 * 3600 * 1000;
  const sixHourPt   = pts.reduce((best, pt) =>
    Math.abs(pt[0] - sixHoursAgo) < Math.abs(best[0] - sixHoursAgo) ? pt : best
  , pts[0]);
  const trendFlow = latestFlow - sixHourPt[1];
  const trendFNU  = flowToFNU(latestFlow, meta) - flowToFNU(sixHourPt[1], meta);

  const oneDayAgo = latestTs - 24 * 3600 * 1000;
  const recent    = pts.filter(pt => pt[0] >= oneDayAgo);
  const recentMaxFlow = Math.max(...recent.map(pt => pt[1]));
  const recentAvgFlow = recent.reduce((sum, pt) => sum + pt[1], 0) / (recent.length || 1);

  return {
    name:       meta.name,
    coast:      meta.coast,
    region:     meta.region,
    source:     "gwrc_flow",
    latestFNU,                                            // FNU proxy from flow
    latestFlow: Math.round(latestFlow * 1000) / 1000,    // actual m³/sec
    latestTime: new Date(latestTs).toISOString(),
    trend:      Math.round(trendFNU * 10) / 10,           // FNU/6h trend
    trendFlow:  Math.round(trendFlow * 1000) / 1000,      // m³/sec/6h trend
    recentMax:  Math.round(flowToFNU(recentMaxFlow, meta)),
    recentAvg:  Math.round(flowToFNU(recentAvgFlow, meta)),
    // Sparkline in FNU proxy units for consistent UI display
    sparkline: recent.slice(-24).map(pt => Math.round(flowToFNU(pt[1], meta))),
  };
}

// ── Supabase config — rain history read ──────────────────────────────────────
// Anon key is safe here — river_rain_daily has public read RLS policy.
// Write access (ingest) uses service role key from local trc-rain-ingest.mjs.
const SUPABASE_URL = "https://mgcwrktuplnjtxkbsypc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY3dya3R1cGxuanR4a2JzeXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MjU2OTcsImV4cCI6MjA1NTUwMTY5N30.EzBxBCRz0pGAOxN9l2MINBJxzGk1QcBdRmFIlZXijCE";

// ── Read rain history from Supabase (accumulated multi-year store) ────────────
// Returns null if table is empty or Supabase unreachable (triggers TRC fallback)
async function fetchRainFromSupabase(siteId, days = 30) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const url = `${SUPABASE_URL}/rest/v1/river_rain_daily` +
    `?site_id=eq.${siteId}&date=gte.${cutoff}&order=date.desc&limit=${days + 2}`;
  const res = await fetch(url, {
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Check freshness — if newest row is more than 8 days old, fall back to TRC direct
  const newestDate = rows[0].date;
  const newestMs   = new Date(newestDate).getTime();
  const ageHours   = (Date.now() - newestMs) / 3600000;
  if (ageHours > 8 * 24) {
    console.log(`[Rain] Supabase site ${siteId} newest row ${newestDate} is ${Math.round(ageHours/24)}d old — falling back to TRC direct`);
    return null;
  }

  return rows; // [{ site_id, date, rain_mm, site_name }, ...]
}

// ── Build rain summary from rows (shared by Supabase + TRC paths) ─────────────
function buildRainSummary(siteId, rows) {
  // rows sorted date DESC — rows[0] is most recent
  // Build dailyRain[0]=today ... [13]=13 days ago
  const NZT_OFFSET = 13 * 3600 * 1000;
  const todayKey   = new Date(Date.now() + NZT_OFFSET).toISOString().split("T")[0];
  const todayMs    = new Date(todayKey).getTime();

  // Index rows by date for fast lookup
  const byDate = {};
  rows.forEach(r => { byDate[r.date] = r.rain_mm ?? 0; });

  const dailyRain = [];
  for (let d = 0; d < 14; d++) {
    const key = new Date(todayMs - d * 86400000).toISOString().split("T")[0];
    dailyRain.push(Math.round((byDate[key] ?? 0) * 10) / 10);
  }

  const rain_24h = dailyRain[0] ?? 0;
  const rain_48h = rain_24h + (dailyRain[1] ?? 0);
  const rain_72h = rain_48h + (dailyRain[2] ?? 0);
  const rain_7d  = dailyRain.slice(0, 7).reduce((a, b) => a + b, 0);
  const rain_14d = dailyRain.reduce((a, b) => a + b, 0);

  let days_since_rain = 0;
  for (let i = 1; i < dailyRain.length; i++) {
    if (dailyRain[i] > 1) break;
    days_since_rain++;
  }

  return {
    name:           TRC_RAIN_SITES[siteId]?.name ?? `Site ${siteId}`,
    coast:          TRC_RAIN_SITES[siteId]?.coast,
    region:         TRC_RAIN_SITES[siteId]?.region,
    dailyRain,
    rain_24h:        Math.round(rain_24h * 10) / 10,
    rain_48h:        Math.round(rain_48h * 10) / 10,
    rain_72h:        Math.round(rain_72h * 10) / 10,
    rain_7d:         Math.round(rain_7d  * 10) / 10,
    rain_14d:        Math.round(rain_14d * 10) / 10,
    days_since_rain,
  };
}

// ── Fetch rain for one site: Supabase primary, TRC direct fallback ────────────
async function fetchRainSite(siteId) {
  // 1. Try Supabase accumulated history
  const sbRows = await fetchRainFromSupabase(siteId, 30).catch(() => null);
  if (sbRows) {
    const summary = buildRainSummary(siteId, sbRows);
    return { ...summary, source: "supabase" };
  }

  // 2. Fall back to TRC direct (14 days only, no history)
  console.log(`[Rain] Supabase unavailable for site ${siteId} — fetching TRC direct`);
  const url = `${TRC_BASE}/?siteID=${siteId}&measureID=${TRC_RAIN_MEASURE}&timePeriod=${RAIN_TIME_PERIOD}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "VizcastNZ/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TRC Rain HTTP ${res.status} site ${siteId}`);
  const json = await res.json();
  if (json.error) throw new Error(`TRC Rain error site ${siteId}`);

  const pts = json.highStockData ?? [];
  if (pts.length === 0) return null;

  const NZT_OFFSET = 13 * 3600 * 1000;
  const byDay = {};
  pts.forEach(([ts, val]) => {
    const key = new Date(ts + NZT_OFFSET).toISOString().split("T")[0];
    byDay[key] = (byDay[key] ?? 0) + (val > 0 ? val : 0);
  });
  // Convert to row format compatible with buildRainSummary
  const rows = Object.entries(byDay)
    .map(([date, rain_mm]) => ({ date, rain_mm }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const summary = buildRainSummary(siteId, rows);
  return { ...summary, source: "trc_direct" };
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":  "application/json",
    "Cache-Control": "public, max-age=300",
  };

  try {
    const trcJobs  = Object.keys(TRC_SITES).map(Number).map(id =>
      fetchTRCSite(id).then(val => [id, val]).catch(e => {
        console.error(`TRC site ${id} failed:`, e.message);
        return [id, null];
      })
    );

    const gwrcJobs = Object.keys(GWRC_SITES).map(Number).map(id =>
      fetchGWRCSite(id).then(val => [id, val]).catch(e => {
        console.error(`GWRC site ${id} failed:`, e.message);
        return [id, null];
      })
    );

    // Rain gauges — Supabase primary, TRC direct fallback
    const rainJobs = Object.keys(TRC_RAIN_SITES).map(Number).map(id =>
      fetchRainSite(id).then(val => [id, val]).catch(e => {
        console.error(`Rain site ${id} failed:`, e.message);
        return [id, null];
      })
    );

    const all = await Promise.all([...trcJobs, ...gwrcJobs]);
    const rainAll = await Promise.all(rainJobs);

    const sites = {};
    for (const [id, val] of all) {
      if (val) sites[id] = val;
    }

    // Rain gauges returned under a separate "rain" key to avoid ID collision
    // with FNU turbidity sites. App.jsx reads riverData.rain[siteId].
    const rain = {};
    for (const [id, val] of rainAll) {
      if (val) rain[id] = val;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, fetched: new Date().toISOString(), sites, rain }),
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
