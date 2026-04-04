// ── RTOFS ocean current fetch (via Netlify proxy — ERDDAP blocks browser CORS) ─
// Deploy netlify/functions/erddap-current.js alongside trc-river.js

export async function fetchOceanCurrent() {
  const lat = -39.05;
  const lon = 173.87;
  const url = `/.netlify/functions/erddap-current?lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ERDDAP proxy HTTP ${res.status}`);
  const js = await res.json();
  if (!js.ok) throw new Error(js.error ?? "proxy error");
  return js; // { u, v, speed, dir, dirLabel, modelTime, ageHrs, valid }
}

// ── TRC River turbidity fetch (via Netlify proxy) ────────────────────────────
// API: /.netlify/functions/trc-river
// Returns live FNU readings for 6 Taranaki river gauges, updated every 5 min.
// Used to refine the river penalty in scoreSpot() with real measured turbidity
// rather than just estimated rain-based impact.

export const TRC_RIVER_SITES = {
  // TRC (Taranaki) — FNU turbidity
  12:  "Mangaehu at Huinga",
  17:  "Mangati at SH3",
  53:  "Waingongoro at SH45",
  117: "Waitaha at SH3",
  166: "Urenui at Okoki Rd",
  167: "Waiokura at No3 Fairway",
  // GWRC (Kāpiti) — Flow proxy (IDs 1000+)
  1001: "Waikanae River at WTP",
  1002: "Otaki River at Pukehinau",
  // USGS (SPI) — Flow proxy (IDs 1000+)
  1003: "Rio Grande at Rio Grande City",
};

// FNU → normalised turbidity score (0=crystal, 100=chocolate milk)
// Taranaki rivers: <5 FNU = clear, 5–50 = elevated, 50–200 = high, >200 = flood
export function fnuToScore(fnu) {
  if (fnu == null) return null;
  if (fnu < 3)   return 0;
  if (fnu < 10)  return Math.round(fnu / 10 * 15);          // 0–15
  if (fnu < 50)  return Math.round(15 + (fnu - 10) / 40 * 35); // 15–50
  if (fnu < 200) return Math.round(50 + (fnu - 50) / 150 * 35); // 50–85
  return Math.min(100, Math.round(85 + (fnu - 200) / 100 * 15)); // 85–100
}

export async function fetchTRCRiverData() {
  // In development (localhost) hit TRC directly (same origin via Vite proxy won't work,
  // so we skip and return null — scoring falls back to rain model).
  const isDev = window.location.hostname === "localhost";
  if (isDev) return null;
  const res = await fetch("/.netlify/functions/trc-river", {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TRC proxy HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "TRC proxy error");
  return json.sites; // { [siteId]: { name, latestFNU, latestTime, trend, recentMax, recentAvg, sparkline } }
}
