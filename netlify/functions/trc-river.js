// netlify/functions/trc-river.js
// Proxy for river turbidity/flow/rainfall data from two regional councils:
//   TRC  (Taranaki Regional Council)  — FNU turbidity readings, 5-min interval
//   GWRC (Greater Wellington RC)      — Flow m³/sec + Rainfall mm/h, 5-min/hourly interval
//
// Endpoint: /.netlify/functions/trc-river
// Returns: { ok, fetched, sites: { [siteId]: { name, latestFNU, latestTime, trend, ... } } }
//
// For GWRC flow sites, m³/sec is converted to an equivalent FNU proxy
// using a flow-turbidity relationship calibrated for Kāpiti Coast rivers.
//
// For GWRC rainfall sites, hourly mm totals are accumulated to rain_24h, rain_48h
// for direct use in scoring (replaces Open-Meteo rain for Kāpiti spots).

// ── TRC — Turbidity (FNU) via TRC portal ─────────────────────────────────────
const TRC_BASE    = "https://www.trc.govt.nz/environment/maps-and-data/site-details/LoadGraphAndListData";
const TRC_MEASURE = 19;       // Turbidity measurement ID
const TIME_PERIOD = "2days";  // 2 days of 5-min readings — trend + latest

const TRC_SITES = {
  12:  { name: "Mangaehu at Huinga",      coast: "south", region: "taranaki" },
  17:  { name: "Mangati at SH3",           coast: "north", region: "taranaki" },
  53:  { name: "Waingongoro at SH45",      coast: "south", region: "taranaki" },
  117: { name: "Waitaha at SH3",           coast: "south", region: "taranaki" },
  166: { name: "Urenui at Okoki Rd",       coast: "north", region: "taranaki" },
  167: { name: "Waiokura at No3 Fairway",  coast: "south", region: "taranaki" },
};

// ── GWRC — Flow (m³/sec) + Rainfall (mm/h) via Hilltop API ───────────────────
// ID scheme:
//   1000+ = GWRC Flow sites (existing)
//   2000+ = GWRC Rainfall sites (new)
//
// Site and measurement strings must match GWRC Hilltop exactly.
// Confirmed working at: https://hilltop.gw.govt.nz/Data.hts
// Reference graph: https://graphs.gw.govt.nz/envmon?view=tabular-data&collection=Rainfall&site=...
const GWRC_BASE = "https://hilltop.gw.govt.nz/Data.hts";

const GWRC_FLOW_SITES = {
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
    flowThresholds: { low: 1.5, moderate: 3.0, high: 6.0, veryHigh: 12.0 },
    fnu_at_low:      8,
    fnu_at_moderate: 60,
    fnu_at_high:     150,
    fnu_at_veryHigh: 300,
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

const GWRC_RAIN_SITES = {
  // Rainfall is measured as mm per hour (hourly interval).
  // We accumulate to rain_24h, rain_48h, rain_7d for scoring.
  // Fetching 9 days to match Open-Meteo historical window.
  2001: {
    name:        "Waikanae River at Water Treatment Plant — Rainfall",
    site:        "Waikanae River at Water Treatment Plant",
    measurement: "Rainfall",
    coast:       "kapiti",
    region:      "kapiti",
    lat:         -40.888,
    lon:         175.073,
    // This gauge is co-located with the flow gauge — same physical station.
    // Assigned spots: aeroplane_island, tokahaki (closest gauge to those spots)
    assigned_spots: ["aeroplane_island", "tokahaki", "kapiti_west"],
  },
  // NOTE: If GWRC has a dedicated rain gauge closer to Ōtaki/Aeroplane Island,
  // add it here as 2002. Check via:
  // https://hilltop.gw.govt.nz/Data.hts?Service=Hilltop&Request=SiteList
  // Then filter for sites with Rainfall measurement near -40.86, 174.94
};

// Keep a unified GWRC_SITES for the handler loop (backwards compatibility)
const GWRC_SITES = { ...GWRC_FLOW_SITES };

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

// ── Hilltop XML parser ────────────────────────────────────────────────────────
// Shared by both Flow and Rainfall fetchers.
// Returns array of [timestampMs, value] pairs, sorted ascending.
function parseHilltopXML(text) {
  const timeRe = /<T>([^<]+)<\/T>/g;
  const val1Re = /<I1>([^<]+)<\/I1>/g;
  const times = [...text.matchAll(timeRe)].map(m => m[1]);
  const vals  = [...text.matchAll(val1Re)].map(m => parseFloat(m[1]));
  return times
    .map((t, i) => [new Date(t).getTime(), vals[i]])
    .filter(([ts, v]) => !isNaN(ts) && !isNaN(v))
    .sort((a, b) => a[0] - b[0]);
}

// ── Hilltop date formatter ─────────────────────────────────────────────────────
// GWRC Hilltop requires DD/MM/YYYY HH:MM:SS format.
function fmtHilltop(d) {
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
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

// ── Fetch a single GWRC Flow site (Flow → FNU proxy) ─────────────────────────
async function fetchGWRCFlowSite(siteId) {
  const meta = GWRC_FLOW_SITES[siteId];
  const now  = new Date();
  const from = new Date(now - 2 * 24 * 3600 * 1000); // 2 days back

  const url = `${GWRC_BASE}/?Service=Hilltop&Request=GetData` +
    `&Site=${encodeURIComponent(meta.site)}` +
    `&Measurement=${encodeURIComponent(meta.measurement)}` +
    `&From=${encodeURIComponent(fmtHilltop(from))}` +
    `&To=${encodeURIComponent(fmtHilltop(now))}` +
    `&ShowQuality=No`;

  const res = await fetch(url, {
    headers: { "User-Agent": "VizcastNZ/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GWRC HTTP ${res.status} site ${meta.site}`);

  const pts = parseHilltopXML(await res.text());
  if (pts.length === 0) return null;

  const [latestTs, latestFlow] = pts[pts.length - 1];
  const latestFNU = Math.round(flowToFNU(latestFlow, meta));

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
    latestFNU,
    latestFlow: Math.round(latestFlow * 1000) / 1000,
    latestTime: new Date(latestTs).toISOString(),
    trend:      Math.round(trendFNU * 10) / 10,
    trendFlow:  Math.round(trendFlow * 1000) / 1000,
    recentMax:  Math.round(flowToFNU(recentMaxFlow, meta)),
    recentAvg:  Math.round(flowToFNU(recentAvgFlow, meta)),
    sparkline:  recent.slice(-24).map(pt => Math.round(flowToFNU(pt[1], meta))),
  };
}

// ── Fetch a single GWRC Rainfall site ────────────────────────────────────────
// Rainfall is hourly mm totals. We accumulate to rain_24h, rain_48h, rain_7d.
// These values feed directly into Kāpiti scoring in place of Open-Meteo rain.
//
// Fetching 9 days to match Open-Meteo's past_days=9 historical window,
// so the scoring model has the same rain window available.
async function fetchGWRCRainSite(siteId) {
  const meta = GWRC_RAIN_SITES[siteId];
  const now  = new Date();
  const from = new Date(now - 9 * 24 * 3600 * 1000); // 9 days back

  const url = `${GWRC_BASE}/?Service=Hilltop&Request=GetData` +
    `&Site=${encodeURIComponent(meta.site)}` +
    `&Measurement=${encodeURIComponent(meta.measurement)}` +
    `&From=${encodeURIComponent(fmtHilltop(from))}` +
    `&To=${encodeURIComponent(fmtHilltop(now))}` +
    `&ShowQuality=No`;

  const res = await fetch(url, {
    headers: { "User-Agent": "VizcastNZ/1.0" },
    signal: AbortSignal.timeout(10000), // slightly longer — 9 days of data
  });
  if (!res.ok) throw new Error(`GWRC Rain HTTP ${res.status} site ${meta.site}`);

  const pts = parseHilltopXML(await res.text());
  if (pts.length === 0) return null;

  const latestTs = pts[pts.length - 1][0];
  const latestTime = new Date(latestTs).toISOString();

  // Accumulate rainfall over windows
  function sumRain(windowMs) {
    const cutoff = latestTs - windowMs;
    return pts
      .filter(([ts]) => ts >= cutoff)
      .reduce((sum, [, mm]) => sum + (mm > 0 ? mm : 0), 0);
  }

  const rain_1h  = Math.round(sumRain(1  * 3600 * 1000) * 10) / 10;
  const rain_24h = Math.round(sumRain(24 * 3600 * 1000) * 10) / 10;
  const rain_48h = Math.round(sumRain(48 * 3600 * 1000) * 10) / 10;
  const rain_72h = Math.round(sumRain(72 * 3600 * 1000) * 10) / 10;
  const rain_7d  = Math.round(sumRain( 7 * 24 * 3600 * 1000) * 10) / 10;

  // Days since last meaningful rain.
  // Hilltop rainfall is stored at sub-hourly intervals (5 or 15 min),
  // so individual readings are typically 0.2–0.4mm even during active rain.
  // Threshold: >= 0.1mm in any single reading = rain is occurring.
  // Walk backwards to find the most recent wet reading.
  let daysSinceRain = null;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i][1] >= 0.1) {
      daysSinceRain = Math.round((latestTs - pts[i][0]) / (24 * 3600 * 1000) * 10) / 10;
      break;
    }
  }
  if (daysSinceRain === null) daysSinceRain = 9; // no rain in 9-day window

  // Peak hourly rain in last 24h (intensity indicator)
  const last24 = pts.filter(([ts]) => ts >= latestTs - 24 * 3600 * 1000);
  const peakHourly24h = last24.length > 0
    ? Math.round(Math.max(...last24.map(([, v]) => v)) * 10) / 10
    : 0;

  // Sparkline — last 48 hours of hourly totals for UI display
  const sparkline = pts
    .filter(([ts]) => ts >= latestTs - 48 * 3600 * 1000)
    .map(([, v]) => Math.round(v * 10) / 10);

  return {
    name:            meta.name,
    coast:           meta.coast,
    region:          meta.region,
    source:          "gwrc_rain",
    assigned_spots:  meta.assigned_spots,
    latestTime,
    // Rainfall accumulations — these feed directly into score-full
    rain_1h,
    rain_24h,
    rain_48h,
    rain_72h,
    rain_7d,
    daysSinceRain,
    peakHourly24h,
    sparkline,
    // FNU not applicable for rain gauge — set null for consistent shape
    latestFNU:  null,
    latestFlow: null,
    trend:      null,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async () => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":  "application/json",
    "Cache-Control": "public, max-age=300", // 5-min cache
  };

  try {
    const trcJobs = Object.keys(TRC_SITES).map(Number).map(id =>
      fetchTRCSite(id).then(val => [id, val]).catch(e => {
        console.error(`TRC site ${id} failed:`, e.message);
        return [id, null];
      })
    );

    const gwrcFlowJobs = Object.keys(GWRC_FLOW_SITES).map(Number).map(id =>
      fetchGWRCFlowSite(id).then(val => [id, val]).catch(e => {
        console.error(`GWRC Flow site ${id} failed:`, e.message);
        return [id, null];
      })
    );

    const gwrcRainJobs = Object.keys(GWRC_RAIN_SITES).map(Number).map(id =>
      fetchGWRCRainSite(id).then(val => [id, val]).catch(e => {
        console.error(`GWRC Rain site ${id} failed:`, e.message);
        return [id, null];
      })
    );

    const all = await Promise.all([...trcJobs, ...gwrcFlowJobs, ...gwrcRainJobs]);

    const sites = {};
    for (const [id, val] of all) {
      if (val) sites[id] = val;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, fetched: new Date().toISOString(), sites }),
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};