import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════════════
// REGION HELPERS — derive SPOTS and W from active region
// ══════════════════════════════════════════════════════════════════════════════
function getSPOTS(regionId) { return REGIONS[regionId]?.spots ?? []; }
function getW(regionId) { return REGIONS[regionId]?.W ?? REGIONS.taranaki.W; }

// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG — Community Shared Logging
// ══════════════════════════════════════════════════════════════════════════════
// Supabase is now per-region — see REGIONS config
const SUPABASE_URL = "https://mgcwrktuplnjtxkbsypc.supabase.co"; // Taranaki default
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY3dya3R1cGxuanR4a2JzeXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjA3MzgsImV4cCI6MjA4ODA5NjczOH0.vk_ylXl3wny0NjIUD9D89324muA74bXx3Mg6Syq8yMA";

async function sbFetch(path, options = {}) {
  const url = SUPABASE_URL + "/rest/v1" + path;
  const res = await fetch(url, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Supabase ${res.status}: ${err}`); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}
async function fetchCommunityLogs() { return sbFetch("/dive_logs?order=created_at.desc&limit=500"); }
async function insertLog(entry) { return sbFetch("/dive_logs", { method: "POST", body: JSON.stringify(entry), prefer: "return=representation" }); }

// ── Webcam morning readings — Supabase persistence ────────────────────────────
// Stores one morning (peak solar) webcam turbidity reading per spot per day.
// Table: webcam_readings  columns: date, spot_name, turbidity, surface_state,
//                                  cam_name, r, g, b, solar_confidence, fetched_at
// See webcam_readings_migration.sql to create the table.

function todayNZ() {
  // Returns NZ local date string YYYY-MM-DD (UTC+12 approx; close enough for daily granularity)
  const now = new Date();
  const nz = new Date(now.getTime() + 13 * 3600 * 1000); // NZ is UTC+12/+13, use +13 (NZDT) as safe offset
  return nz.toISOString().split("T")[0];
}

async function fetchStoredWebcamReadings(date) {
  // Returns today's stored readings: { [spotName]: { turbidity, surfaceState, camName, r, g, b, solarConfidence, fetchedAt } }
  try {
    const rows = await sbFetch(`/webcam_readings?date=eq.${date}&select=*`);
    const result = {};
    for (const row of rows) {
      result[row.spot_name] = {
        turbidity: row.turbidity,
        surfaceState: row.surface_state,
        camName: row.cam_name,
        r: row.r, g: row.g, b: row.b,
        solarConfidence: row.solar_confidence,
        fetchedAt: new Date(row.fetched_at).getTime(),
        ageMinutes: (Date.now() - new Date(row.fetched_at).getTime()) / 60000,
        solarLabel: "☀️ morning (cached)",
        source: "supabase",
      };
    }
    return result;
  } catch(e) {
    console.warn("[Webcam] Failed to load stored readings:", e.message);
    return {};
  }
}

async function upsertWebcamReading(date, spotName, data) {
  // Upsert a single spot's morning reading into Supabase
  // Uses ON CONFLICT (date, spot_name) DO UPDATE via Supabase prefer header
  try {
    await sbFetch("/webcam_readings", {
      method: "POST",
      body: JSON.stringify({
        date,
        spot_name: spotName,
        turbidity: data.turbidity,
        surface_state: data.surfaceState ?? "unknown",
        cam_name: data.camName ?? null,
        r: data.r ?? null,
        g: data.g ?? null,
        b: data.b ?? null,
        solar_confidence: data.solarConfidence ?? null,
        fetched_at: new Date(data.fetchedAt).toISOString(),
      }),
      prefer: "resolution=merge-duplicates",
    });
    console.log(`[Webcam] Upserted morning reading for ${spotName}: turbidity=${data.turbidity}`);
  } catch(e) {
    console.warn(`[Webcam] Failed to upsert reading for ${spotName}:`, e.message);
  }
}

// ── Seed initial dive logs if table is empty ──────────────────────────────────
const SEED_LOGS = [
  { diver_name: "Mike", date: "2026-03-03", spot: "Motumahanga (Saddleback Is.)", observed_vis: 20, tide: "mid", model_score: 100, notes: "" },
  { diver_name: "Mike", date: "2026-03-02", spot: "Nga Motu — Inshore (Port Taranaki)", observed_vis: 3, tide: "low", model_score: 68, notes: "" },
  { diver_name: "Mike", date: "2026-02-23", spot: "Nga Motu — Inshore (Port Taranaki)", observed_vis: 3, tide: "high", model_score: 68, notes: "Affected by swell, dirty in close" },
  { diver_name: "Mike", date: "2026-02-13", spot: "Patea — Offshore Trap", observed_vis: 9.6, tide: "high", model_score: 100, notes: "Dirty layer on top, but clear underneath" },
  { diver_name: "Mike", date: "2026-01-27", spot: "Motumahanga (Saddleback Is.)", observed_vis: 15, tide: "low", model_score: 99, notes: "" },
];

async function seedLogsIfEmpty() {
  try {
    const existing = await fetchCommunityLogs();
    if (existing.length === 0) {
      console.log("[Seed] No community logs found — inserting seed data");
      for (const entry of SEED_LOGS) {
        await insertLog(entry);
      }
      console.log(`[Seed] Inserted ${SEED_LOGS.length} seed observations`);
      return true;
    }
    return false;
  } catch(e) {
    console.warn("[Seed] Could not seed logs:", e);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// REGIONS CONFIG — all per-region differences live here
// Pipeline-calibrated seasonal data (5yr MODIS satellite observations)
// Wind direction scoring replaces legacy nw_push for Taranaki
// ══════════════════════════════════════════════════════════════════════════════

const REGIONS = {

  taranaki: {
    id: "taranaki",
    label: "Taranaki",
    emoji: "🌋",
    subtitle: "Sugar Loafs to Patea",
    mapCenter: [-39.2, 174.05],
    mapZoom: 9,
    cloudTile: { zoom: 9, x: 504, y: 319 },
    rtofs: { lat: -39.10, lon: 173.90 },
    supabaseUrl: "https://mgcwrktuplnjtxkbsypc.supabase.co",
    supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY3dya3R1cGxuanR4a2JzeXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MjU2OTcsImV4cCI6MjA1NTUwMTY5N30.EzBxBCRz0pGAOxN9l2MINBJxzGk1QcBdRmFIlZXijCE",
    logKey: "taranaki_dive_log",
    sessionName: "diver_name",
    sessionWelcome: "welcomed",
    footer: "Kāpiti Viz Forecast · Open-Meteo · NOAA RTOFS · NASA GIBS · Supabase · Built for Kāpiti divers 🐟",

    // Scoring weights — Taranaki-calibrated
    W: {
      w_swell: 0.45, w_wind: 0.25, w_rain: 0.30,
      push_mult: 14.0,   // replaces nw_push_mult — per-spot wind dir scoring
      rain_pen_mult: 20.0,
      cur_north: 14.0, cur_south: 18.0, bight_mult: 22.0,
      sst_warm: 8.0, sst_cold: -16.0,
      tide_mult: 1.0,
      shelter_mult: 0.10, river_mult: 0.15,
      hist_2_5: 0.60, hist_2_0: 0.75, hist_1_5: 0.88,
      seasonal_mult: 1.0,
    },

    // Seasonal bias per month — derived from pipeline (clear% relative to annual mean)
    // Each spot has its own curve because Nga Motu is inverted vs the rest
    // Applied as: score += seasonal[month] * W.seasonal_mult
    // (null = use spot.seasonal override if defined)

    // Seasonal data by spot name (pipeline-calibrated)
    spotSeasonal: {
      // Real pipeline deltas: clear_pct[month] - annual_avg, from 668+ MODIS obs each
      "Motumahanga (Saddleback Is.)":
        {1:+11,2:+7,3:+16,4:+4,5:+5,6:-21,7:-4,8:-2,9:-9,10:-3,11:-2,12:-4},
      "Nga Motu — Inshore (Port Taranaki)":
        {1:-14,2:-10,3:-14,4:0,5:+4,6:+4,7:+2,8:+6,9:+8,10:+16,11:-4,12:+2},
      "Fin Fuckers (Cape Egmont / Warea)":
        {1:+1,2:+1,3:-1,4:+1,5:-1,6:-4,7:-4,8:-2,9:+1,10:+1,11:+1,12:+1},
      "Opunake":
        {1:+2,2:-2,3:-3,4:+1,5:-2,6:-1,7:+2,8:-1,9:+6,10:+2,11:-4,12:+5},
      "Patea — Inshore":
        {1:-16,2:-14,3:-21,4:-4,5:+2,6:+21,7:+5,8:+4,9:+15,10:+3,11:-2,12:+6},
      "Patea — Offshore Trap":
        {1:+2,2:+2,3:+2,4:+2,5:-3,6:-6,7:0,8:-1,9:0,10:+2,11:+2,12:+2},
      "The Metal Reef":
        {1:+9,2:+7,3:+5,4:-6,5:-1,6:-3,7:-10,8:+2,9:-1,10:-5,11:-3,12:+6},
    },

    // Seasonal chart data for UI (pipeline clear% by month)
    seasonalChart: [
      { month:"Jan", clear:55, blueIdx:9 },
      { month:"Feb", clear:51, blueIdx:6 },
      { month:"Mar", clear:60, blueIdx:6 },
      { month:"Apr", clear:48, blueIdx:4 },
      { month:"May", clear:49, blueIdx:3 },
      { month:"Jun", clear:23, blueIdx:1 },
      { month:"Jul", clear:40, blueIdx:1 },
      { month:"Aug", clear:42, blueIdx:1 },
      { month:"Sep", clear:35, blueIdx:1 },
      { month:"Oct", clear:41, blueIdx:2 },
      { month:"Nov", clear:42, blueIdx:5 },
      { month:"Dec", clear:40, blueIdx:4 },
    ],
    seasonalNote: "668 cloud-free MODIS observations · Motumahanga reference spot",

    spots: [
      {
        name: "Motumahanga (Saddleback Is.)",
        lat: -39.043, lon: 174.022,
        marine_lat: -39.10, marine_lon: 173.90,
        weather_lat: -39.055, weather_lon: 174.04,
        shelter: 0.6,  river_impact: 0.2,  papa_risk: 0.2,  swell_exposure: 0.15,
        // Pipeline: best=S,SE,SW — worst=N,NW,E. NW push myth busted.
        best_wind_dirs: [135, 90, 180],  // SE, E, S
        worst_wind_dirs: [315, 270, 225],  // NW, W, SW
        wind_push: 0.7,
        nw_rain_penalty: 0.5, southerly_bight: 0.0, tide_sensitive: 0.3,
        plume_reach: 0.7,
        trc_sites: [166, 17], // Urenui (primary), Mangati (secondary)
        note: "Outermost Sugar Loaf, ~1.5km offshore. Andesite rock, no papa. Pipeline: clean water from S/SE, not NW. Fast recovery (~1 day). Post-rain plume can still reach island.",
        river: false,
      },
      {
        name: "Nga Motu — Inshore (Port Taranaki)",
        lat: -39.058, lon: 174.035,
        marine_lat: -39.10, marine_lon: 173.90,
        weather_lat: -39.07, weather_lon: 174.08,
        shelter: 0.85, river_impact: 0.9,  papa_risk: 0.9,  swell_exposure: 0.85,
        // Pipeline: best=N,NE,NW — worst=S,SE,SW. Inverted seasonal — winter best.
        best_wind_dirs: [0, 315, 45],    // N, NW, NE
        worst_wind_dirs: [135, 180, 225], // SE, S, SW
        wind_push: 0.3,
        nw_rain_penalty: 0.9, southerly_bight: 0.0, tide_sensitive: 1.0,
        trc_sites: [166, 17], // Urenui + Mangati — Waiwhakaiho is ungauged but correlates
        note: "Poor flushing. Heavy stormwater/Waiwhakaiho impact. Pipeline: Oct/Sep best, Jan/Feb worst — inverted vs all other spots. Only good after extended dry calm spells.",
        river: true,
      },
      {
        name: "Fin Fuckers (Cape Egmont / Warea)",
        lat: -39.283, lon: 173.748,
        marine_lat: -39.30, marine_lon: 173.65,
        weather_lat: -39.29, weather_lon: 173.76,
        // Cape Egmont point — westernmost tip of Taranaki.
        // Landmark: replica lighthouse 1 & 2 at Warea Boat Club (Bayly Rd).
        // West-facing exposure. Benefits from N/NE wind (offshore). Open to SW swell.
        // No significant rivers nearby — rain effect mainly via direct runoff/papa.
        shelter: 0.25, river_impact: 0.10, papa_risk: 0.35, swell_exposure: 0.55,
        best_wind_dirs: [0, 270, 315],    // N, W, NW
        worst_wind_dirs: [90, 45, 225],   // E, NE, SW
        wind_push: 0.6,
        nw_rain_penalty: 0.15, southerly_bight: 0.1, tide_sensitive: 0.5,
        plume_reach: 0.2,
        trc_sites: [53, 117], // Waingongoro (closest) + Waitaha
        note: "West-facing cape. Replica lighthouse (Warea Boat Club) is the landmark. Very exposed to westerly swell but clears quickly after rain with no major river input.",
        river: false,
      },
      {
        name: "Opunake",
        lat: -39.458, lon: 173.858,
        marine_lat: -39.50, marine_lon: 173.70,
        weather_lat: -39.45, weather_lon: 173.88,
        shelter: 0.4,  river_impact: 0.15, papa_risk: 0.2,  swell_exposure: 0.45,
        // Pipeline: best=N,W,NE — worst=E,SE,S. NW partially valid.
        best_wind_dirs: [315, 270, 0],    // NW, W, N
        worst_wind_dirs: [180, 135, 90],  // S, SE, E
        wind_push: 0.4,
        nw_rain_penalty: 0.2, southerly_bight: 0.0, tide_sensitive: 0.4,
        trc_sites: [53, 167], // Waingongoro + Waiokura
        note: "Low papa + rain shadow under NW. Clears fastest after rain. Best fallback when other spots blown out.",
        river: true,
      },
      {
        name: "Patea — Inshore",
        lat: -39.751, lon: 174.478,
        marine_lat: -39.80, marine_lon: 174.35,
        weather_lat: -39.75, weather_lon: 174.50,
        shelter: 0.3,  river_impact: 0.85, papa_risk: 0.85, swell_exposure: 0.90,
        best_wind_dirs: [0, 270, 315],    // N, W, NW
        worst_wind_dirs: [135, 225, 180], // SE, SW, S
        wind_push: 0.15,
        nw_rain_penalty: 0.75, southerly_bight: 0.9, tide_sensitive: 0.85,
        trc_sites: [12], // Mangaehu at Huinga — closest to Patea
        note: "Papa + persistently muddy Patea River + bight exposure. Triple threat in bad conditions.",
        river: true,
      },
      {
        name: "Patea — Offshore Trap",
        lat: -39.80, lon: 174.35,
        marine_lat: -39.80, marine_lon: 174.20,
        weather_lat: -39.75, weather_lon: 174.47,
        shelter: 0.2,  river_impact: 0.25, papa_risk: 0.3,  swell_exposure: 0.20,
        // Pipeline: best=SW,E,S — worst=N,SE,NE
        best_wind_dirs: [180, 225, 135],  // S, SW, SE
        worst_wind_dirs: [45, 270, 0],    // NE, W, N
        wind_push: 0.5,
        nw_rain_penalty: 0.3, southerly_bight: 0.95, tide_sensitive: 0.2,
        trc_sites: [12], // Mangaehu — same catchment influence
        note: "Clean on calm days. Pipeline: SW/E/S best — Whanganui water floods in on N/NE.",
        river: false,
      },
      {
        name: "The Metal Reef",
        lat: -38.9756, lon: 174.2769,
        marine_lat: -38.97, marine_lon: 174.27,
        weather_lat: -39.00, weather_lon: 174.23,
        shelter: 0.15,  river_impact: 0.55, papa_risk: 0.60, swell_exposure: 0.15,
        // Pipeline: best=E,NE,N — worst=S,W,SW. NE not NW.
        best_wind_dirs: [0, 315, 45],     // N, NW, NE
        worst_wind_dirs: [180, 135, 270], // S, SE, W
        wind_push: 0.6,
        nw_rain_penalty: 0.55, southerly_bight: 0.3, tide_sensitive: 0.2,
        trc_sites: [17, 166], // Mangati + Urenui — Waitara area rivers
        note: "Reef at 30m. Pipeline: clean water from NE not NW. Waitara runoff impact. Most consistent year-round (60-79% clear).",
        river: true,
      },
    ],
  },

  kapiti: {
    id: "kapiti",
    label: "Kāpiti",
    emoji: "🐠",
    subtitle: "Kāpiti Island & Cook Strait",
    mapCenter: [-40.86, 174.92],
    mapZoom: 10,
    cloudTile: { zoom: 9, x: 504, y: 335 },
    rtofs: { lat: -40.85, lon: 174.95 },
    supabaseUrl: "",  // TODO: new Supabase project
    supabaseKey: "",
    logKey: "kapiti_dive_log",
    sessionName: "kapiti_diver_name",
    sessionWelcome: "kapiti_welcomed",
    footer: "Kāpiti Viz Forecast · Open-Meteo · NOAA RTOFS · NASA GIBS · Supabase · Built for Kāpiti divers 🐟",

    W: {
      w_swell: 0.40, w_wind: 0.20, w_rain: 0.40,
      push_mult: 16.0,
      rain_pen_mult: 14.0,
      cur_north: 12.0, cur_south: 10.0, bight_mult: 8.0,
      sst_warm: 6.0, sst_cold: -12.0,
      tide_mult: 1.2,
      shelter_mult: 0.08, river_mult: 0.18,
      hist_2_5: 0.55, hist_2_0: 0.70, hist_1_5: 0.85,
      seasonal_mult: 1.0,
    },

    spotSeasonal: {
      // Real pipeline deltas: clear_pct[month] - annual_avg, from 649-670 MODIS obs each
      "Aeroplane Island":    {1:-20,2:-19,3:-13,4:+4,5:+2,6:+12,7:+13,8:+18,9:+13,10:-4,11:-8,12:-1},
      "Tokahaki (North Tip)":{1:+1,2:+1,3:+1,4:+1,5:-4,6:+1,7:-3,8:-1,9:+1,10:+1,11:+1,12:+1},
      "Kāpiti West Face":    {1:+1,2:+1,3:+1,4:+1,5:-2,6:-2,7:-3,8:+1,9:+1,10:+1,11:+1,12:+1},
    },

    seasonalChart: [
      { month:"Jan", clear:45, blueIdx:2 },
      { month:"Feb", clear:46, blueIdx:3 },
      { month:"Mar", clear:52, blueIdx:4 },
      { month:"Apr", clear:69, blueIdx:5 },
      { month:"May", clear:67, blueIdx:5 },
      { month:"Jun", clear:77, blueIdx:3 },
      { month:"Jul", clear:78, blueIdx:4 },
      { month:"Aug", clear:83, blueIdx:4 },
      { month:"Sep", clear:78, blueIdx:4 },
      { month:"Oct", clear:61, blueIdx:3 },
      { month:"Nov", clear:57, blueIdx:2 },
      { month:"Dec", clear:64, blueIdx:1 },
    ],
    seasonalNote: "649 cloud-free MODIS observations · Aeroplane Island reference spot",

    spots: [
      {
        name: "Aeroplane Island",
        lat: -40.868, lon: 174.938,
        marine_lat: -40.860, marine_lon: 174.960,
        sat_lat: -40.868, sat_lon: 174.910,
        shelter: 0.3, river_impact: 0.3, papa_risk: 0.0, swell_exposure: 0.35,
        best_wind_dirs: [0, 45, 315],    // N, NE, NW
        worst_wind_dirs: [225, 270, 180], // SW, W, S
        wind_push: 0.9,
        sw_flush: 0.9, sw_rain_penalty: 0.3, strait_squeeze: 0.7, tide_sensitive: 0.8,
        rain_recovery_days: 2,
        note: "East face of Kāpiti. Pipeline: May-Aug best (76-84%), Jan-Feb worst (41-45%). SW Cook Strait flush drives visibility.",
        river: false,
      },
      {
        name: "Tokahaki (North Tip)",
        lat: -40.840, lon: 174.890,
        marine_lat: -40.840, marine_lon: 174.910,
        sat_lat: -40.840, sat_lon: 174.870,
        shelter: 0.2, river_impact: 0.2, papa_risk: 0.0, swell_exposure: 0.45,
        best_wind_dirs: [0, 180, 225],   // N, S, SW
        worst_wind_dirs: [135, 90, 270],  // SE, E, W
        wind_push: 1.0,
        sw_flush: 1.0, sw_rain_penalty: 0.2, strait_squeeze: 0.9, tide_sensitive: 1.0,
        rain_recovery_days: 2,
        note: "Most exposed — strongest tidal flushing. Ground truth: 10m vis Feb 28 2026.",
        river: false,
      },
      {
        name: "Kāpiti West Face",
        lat: -40.860, lon: 174.882,
        marine_lat: -40.860, marine_lon: 174.860,
        sat_lat: -40.860, sat_lon: 174.862,
        shelter: 0.5, river_impact: 0.5, papa_risk: 0.0, swell_exposure: 0.6,
        best_wind_dirs: [0, 225, 270],   // N, SW, W
        worst_wind_dirs: [90, 135, 180],  // E, SE, S
        wind_push: 0.4,
        sw_flush: 0.4, sw_rain_penalty: 0.5, strait_squeeze: 0.5, tide_sensitive: 0.6,
        rain_recovery_days: 3,
        note: "West face — more Waikanae river influence, less Cook Strait flushing.",
        river: true,
      },
    ],
  },
};


function safe(v) { return (v != null && !isNaN(v)) ? v : 0; }

function dirName(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Scoring functions ──────────────────────────────────────────────────────────

function swellScore(h, p, spot) {
  const exposure = spot?.swell_exposure ?? 0.5;
  let s;
  if (exposure >= 0.75) {
    s = h < 0.5 ? 100 : h < 0.75 ? 72 : h < 1.05 ? 40 : h < 1.35 ? 18 : h < 1.65 ? 6 : 0;
  } else if (exposure >= 0.4) {
    s = h < 0.6 ? 96 : h < 1.1 ? 84 : h < 1.6 ? 70 : h < 2.1 ? 54 : h < 2.6 ? 32 : h < 3.1 ? 12 : 3;
  } else {
    s = h < 0.5 ? 100 : h < 1.0 ? 96 : h < 1.5 ? 88 : h < 2.0 ? 76 : h < 2.5 ? 58 : h < 3.0 ? 34 : 12;
  }
  if (p > 14) s *= 0.80;
  else if (p > 11) s *= 0.90;
  const penaltyMult = exposure >= 0.75 ? 0.55 : 0.0;
  const extraPenalty = exposure * (100 - s) * penaltyMult;
  return Math.max(0, s - extraPenalty);
}

function windScore(spd, dir) {
  let b = spd < 5 ? 100 : spd < 10 ? 88 : spd < 15 ? 68 : spd < 20 ? 45 : spd < 25 ? 25 : 10;
  if (dir >= 60 && dir <= 150) b = Math.min(100, b * 1.15);
  if (dir >= 200 && dir <= 270) b *= 0.80;
  return b;
}

function rainDecay(mm, days, spot) {
  const base = mm > 50 ? 60 : mm > 30 ? 45 : mm > 15 ? 25 : mm > 5 ? 12 : 0;
  const pm = 0.4 + spot.papa_risk * 0.9;
  const cr = 5.0 - spot.papa_risk * 2.0;
  return Math.max(0, 100 - base * pm * Math.max(0, 1 - days / cr));
}

function plumeReachFactor(rainHistory) {
  if (!rainHistory) return 0;
  const halfLife = 4.0;
  let weighted = 0;
  rainHistory.forEach((mm, dayAgo) => {
    weighted += mm * Math.pow(0.5, dayAgo / halfLife);
  });
  if (weighted <= 5)  return 0.0;
  if (weighted >= 30) return 1.0;
  return (weighted - 5) / 25;
}

function rainPenalty14(rainHistory, papaRisk) {
  const halfLife = 2.0 + papaRisk * 10.0;
  const penaltyMult = 1.2 + papaRisk * 2.0;
  let weightedRain = 0;
  rainHistory.forEach((mm, dayAgo) => {
    weightedRain += mm * Math.pow(0.5, dayAgo / halfLife);
  });
  const penalty = Math.min(95, weightedRain * penaltyMult);
  return Math.max(0, 100 - penalty);
}

function swellHistoryMultiplier(swellHistory) {
  const halfLife = 2.5;
  let weightedSwell = 0;
  swellHistory.forEach((h, dayAgo) => {
    weightedSwell += h * Math.pow(0.5, dayAgo / halfLife);
  });
  const avg = weightedSwell / swellHistory.length;
  if (avg > 2.5) return W.hist_2_5;
  if (avg > 2.0) return W.hist_2_0;
  if (avg > 1.5) return W.hist_1_5;
  return 1.0;
}

function recoveryBonus(rainHistory, swellHistory) {
  let cleanDays = 0;
  const maxCheck = Math.min(rainHistory.length, swellHistory.length, 14);
  for (let d = 0; d < maxCheck; d++) {
    if (rainHistory[d] < 1.5 && swellHistory[d] < 1.2) cleanDays++;
    else break;
  }
  if (cleanDays >= 7) return 12;
  if (cleanDays >= 5) return 8;
  if (cleanDays >= 3) return 4;
  return 0;
}

function scoreSpot(cond, spot, W) {
  const s  = swellScore(cond.swell_h, cond.swell_p, spot);
  const wn = windScore(cond.wind_spd, cond.wind_dir);

  let papaRiskEffective = spot.papa_risk;
  let riverImpactEffective = spot.river_impact;

  let plumeReach = 0;
  if (spot.plume_reach && cond.rainHistory) {
    plumeReach = plumeReachFactor(cond.rainHistory);
    if (plumeReach > 0) {
      const blendStrength = plumeReach * spot.plume_reach;
      papaRiskEffective    = spot.papa_risk    + blendStrength * (0.85 - spot.papa_risk);
      riverImpactEffective = spot.river_impact + blendStrength * (0.85 - spot.river_impact);
    }
  }

  const r = cond.rainHistory
    ? rainPenalty14(cond.rainHistory, papaRiskEffective)
    : rainDecay(cond.rain_48h, cond.days_since_rain, spot);

  const hp = cond.swellHistory
    ? swellHistoryMultiplier(cond.swellHistory)
    : (cond.swell_hist_72h > 2.5 ? W.hist_2_5 : cond.swell_hist_72h > 2.0 ? W.hist_2_0 : cond.swell_hist_72h > 1.5 ? W.hist_1_5 : 1.0);

  const base = (s * W.w_swell + wn * W.w_wind + r * W.w_rain) * hp;

  const recovery = (cond.rainHistory && cond.swellHistory)
    ? recoveryBonus(cond.rainHistory, cond.swellHistory) * (1 - plumeReach * 0.8)
    : 0;

  // Pipeline-calibrated per-spot wind direction scoring (replaces global NW push)
  let nw = 0;
  if (spot.best_wind_dirs && cond.wind_spd > 3) {
    const bestStr = spot.best_wind_dirs.reduce((max, dir) => {
      const diff = Math.abs(((cond.wind_dir - dir + 360) % 360));
      const angularMatch = Math.max(0, 1 - Math.min(diff, 360 - diff) / 60);
      return Math.max(max, angularMatch);
    }, 0);
    const worstStr = (spot.worst_wind_dirs || []).reduce((max, dir) => {
      const diff = Math.abs(((cond.wind_dir - dir + 360) % 360));
      const angularMatch = Math.max(0, 1 - Math.min(diff, 360 - diff) / 60);
      return Math.max(max, angularMatch);
    }, 0);
    const windSpeedFactor = Math.min(cond.wind_spd / 15, 1);
    const push = bestStr * (spot.wind_push ?? 0.5) * windSpeedFactor * W.push_mult;
    const rpen = cond.rain_48h > 10
      ? bestStr * (spot.nw_rain_penalty ?? 0.3) * (papaRiskEffective ?? 0.3) * W.rain_pen_mult
      : 0;
    const drag = worstStr * windSpeedFactor * (spot.wind_push ?? 0.5) * W.push_mult * 0.6;
    nw = push - rpen - drag;
  }

  const cv = cond.current_vel, cd = cond.current_dir;
  const spd = Math.min(cv / 0.5, 1.0);
  const ss = Math.max(0, 1 - Math.abs(((cd - 180 + 360) % 360)) / 50);
  const ns = Math.max(0, 1 - Math.abs(((cd + 360) % 360)) / 60);
  const cur = ns * spd * W.cur_north - ss * spd * W.cur_south
              - ss * spd * (spot.southerly_bight ?? 0) * W.bight_mult;

  const sst = cond.sst;
  const sstAdj = sst > 18 ? W.sst_warm : sst > 17 ? W.sst_warm * 0.5 : sst > 16 ? 0
               : sst > 15 ? W.sst_cold * 0.5 : sst > 14 ? W.sst_cold : W.sst_cold * 1.5;

  const tl = cond.tide_h;
  const tideSens = spot.tide_sensitive ?? 0.5;
  const tideBase = tl > 0.8 ? 18 : tl > 0.3 ? 10 : tl > -0.3 ? 0 : tl > -0.8 ? -12 : -20;
  const tideAdj = tideBase * tideSens * W.tide_mult;

  const shelter = spot.shelter * Math.max(0, 100 - s) * W.shelter_mult;
  const river   = -riverImpactEffective * (100 - r) * W.river_mult;

  // ── Live river turbidity adjustment (TRC gauge data) ─────────────────────
  // When we have real FNU readings from TRC gauges, use them to amplify or
  // reduce the rain-based river penalty. High FNU (murky river) = extra penalty.
  // Low FNU (clear river despite rain) = small relief on the river component.
  let riverFNUAdj = 0;
  if (cond.riverTurbScore != null && spot.river_impact > 0.1) {
    const rts = cond.riverTurbScore; // 0–100 normalised turbidity score
    const sensitivity = spot.river_impact; // more sensitive spots feel it more
    if (rts > 60) {
      // Murky river: add extra penalty proportional to turbidity and river_impact
      riverFNUAdj = -sensitivity * (rts - 40) * 0.25;
    } else if (rts < 15) {
      // Surprisingly clear river: slight relief (river isn't the problem right now)
      riverFNUAdj = sensitivity * (15 - rts) * 0.12;
    }
    // Cap: don't let river gauge swing scores too wildly
    riverFNUAdj = Math.max(-20, Math.min(8, riverFNUAdj));
  }

  // ── CHANGE 1: Satellite turbidity adjustment ──────────────────────────────
  // cond.satTurbidity: 0–100 index from MODIS TrueColor pixel sampling
  // High satellite turbidity directly suppresses the rain score component,
  // providing ground-truth correction when satellite data is fresh (< 2 days old).
  let satAdj = 0;
  if (cond.satTurbidity != null && cond.satTurbidityAge != null) {
    // Weight satellite confidence by age: full weight at 0 days, zero at 3+ days
    const satConfidence = Math.max(0, 1 - cond.satTurbidityAge / 3);
    if (satConfidence > 0) {
      // Map turbidity index (0–100) to a rain-equivalent penalty (0–95)
      // High turbidity (>60) overrides rain model with strong penalty
      // Low turbidity (<20) provides a small clarity bonus
      const satPenalty = cond.satTurbidity > 60
        ? Math.min(95, cond.satTurbidity * 1.2) * satConfidence
        : cond.satTurbidity > 20
        ? cond.satTurbidity * 0.6 * satConfidence
        : 0;
      const satBonus = cond.satTurbidity < 20
        ? (20 - cond.satTurbidity) * 0.3 * satConfidence
        : 0;
      satAdj = satBonus - satPenalty;
    }
  }

  // ── Webcam turbidity adjustment ───────────────────────────────────────────
  // cond.webcamTurbidity: 0–100 from Primo live camera pixel sampling
  // Fresh live reads decay over 2 hours. Stored morning reads decay over 12 hours
  // (captured at peak solar reliability, valid as a "today's baseline").
  // Also modulated by solar angle — morning light (east sun) dramatically
  // improves colour contrast and turbidity visibility in west-facing cameras.
  // Webcam and satellite adjustments are complementary — both can apply.
  let webcamAdj = 0;
  if (cond.webcamTurbidity != null && cond.webcamAgeMinutes != null) {
    const isCached = cond.webcamSource === "supabase";
    const decayWindow = isCached ? 720 : 120; // 12h for morning cache, 2h for live
    const ageFade = Math.max(0, 1 - cond.webcamAgeMinutes / decayWindow);
    const solar = cond.webcamSolarConfidence ?? 0.5; // default moderate if not set
    const webcamConfidence = ageFade * solar;
    if (webcamConfidence > 0) {
      const wt = cond.webcamTurbidity;
      const penalty = wt > 60
        ? Math.min(80, wt * 1.0) * webcamConfidence
        : wt > 25
        ? wt * 0.5 * webcamConfidence
        : 0;
      const bonus = wt < 20 ? (20 - wt) * 0.25 * webcamConfidence : 0;
      webcamAdj = bonus - penalty;
    }
  }

  const total = base + nw + cur + sstAdj + tideAdj + shelter + river + riverFNUAdj + recovery + satAdj + webcamAdj;
  return {
    score: Math.max(0, Math.min(100, Math.round(total))),
    plumeReach: Math.round(plumeReach * 100),
    factors: { swell: s, wind: wn, rain: r, nw, current: cur, sst: sstAdj, tide: tideAdj, recovery, satellite: satAdj, webcam: webcamAdj, riverGauge: riverFNUAdj },
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

function scoreToColor(score) {
  if (score >= 80) return "#00e5a0";
  if (score >= 60) return "#7dd64f";
  if (score >= 40) return "#f0a030";
  if (score >= 20) return "#f07040";
  return "#e03030";
}

function scoreToLabel(score) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Crays/Paua";
  if (score >= 20) return "Poor";
  return "Not Diveable";
}

function visLabel(score) {
  if (score >= 80) return "10m+ 🤿";
  if (score >= 60) return "5–10m";
  if (score >= 40) return "3–5m 🦞";
  if (score >= 20) return "1–3m";
  return "< 1m";
}

function scoreToVis(score) {
  if (score >= 80) return 12;
  if (score >= 60) return 7;
  if (score >= 40) return 4;
  if (score >= 20) return 2;
  return 0.5;
}

function parseDateLocal(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day);
}

// ── Satellite pixel sampling ─────────────────────────────────────────────────

function latLonToTilePx(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return {
    tileX:  Math.floor(x),
    tileY:  Math.floor(y),
    pixelX: Math.floor((x % 1) * 256),
    pixelY: Math.floor((y % 1) * 256),
  };
}

// ── Pixel quality classification ─────────────────────────────────────────────
// Works for BOTH TrueColor (R=red vis, G=green vis, B=blue vis) and
// Bands721 (R=SWIR band7 2.1µm, G=NIR band2 0.86µm, B=red band1 0.65µm).
// Cloud/glint detection is band-agnostic (brightness + saturation).
function classifyPixel(r, g, b, a) {
  if (a < 10) return "transparent";
  const brightness = (r + g + b) / 3;
  // Nearly black: shadow, bad data, or land edge — not valid water
  if (brightness < 8) return "invalid";
  const maxCh = Math.max(r, g, b);
  const minCh = Math.min(r, g, b);
  const saturation = maxCh > 0 ? (maxCh - minCh) / maxCh : 0;
  // Cloud: very bright AND low saturation (white/grey in both composites)
  if (brightness > 195 && saturation < 0.12) return "cloud";
  // Sun glint: extremely bright regardless of colour
  if (brightness > 215) return "glint";
  // Land in TrueColor: green/brown with low blue
  // Land in Bands721: vegetation = very high NIR (green channel), low blue
  if (g > 160 && b < 80) return "land";               // vegetation (NIR-bright in B721)
  if (r > b * 1.5 && g > b * 1.2 && b < 90) return "land"; // bare/brown land in TC
  return "water";
}

// Normalised ocean turbidity index from TrueColor pixel — illumination-independent
// Returns 0 (clear deep blue) → 100 (very turbid brown/green)
function calcTurbidity(r, g, b) {
  const total = r + g + b;
  if (total < 10) return null;
  // Normalised band fractions — divide out overall brightness/illumination
  const rn = r / total;
  const gn = g / total;
  const bn = b / total;
  // Clear offshore ocean: bn ≈ 0.40–0.50 (blue dominates)
  // Turbid river plume: rn + gn high (0.55–0.70), bn low (0.25–0.35)
  // Sediment index: weighted red+green vs blue ratio
  const sedimentIdx = (rn * 0.65 + gn * 0.35) / Math.max(0.01, bn);
  // Blue bonus: extra clear-water credit when blue fraction is high
  const bluenessBonus = Math.max(0, bn - 0.38) * 80;
  const raw = sedimentIdx * 55 - bluenessBonus;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

async function sampleGibsTile(layer, date, zoom, fmt, spots) {
  const results = {};
  const tiles = {};
  for (const spot of spots) {
    const t = latLonToTilePx(spot.lat, spot.lon, zoom);
    const key = t.tileX + "," + t.tileY;
    if (!tiles[key]) tiles[key] = { tileX: t.tileX, tileY: t.tileY, spots: [] };
    tiles[key].spots.push({ ...spot, pixelX: t.pixelX, pixelY: t.pixelY });
  }

  const matrixSet = zoom <= 7
    ? "GoogleMapsCompatible_Level7"
    : "GoogleMapsCompatible_Level9";

  for (const [, tile] of Object.entries(tiles)) {
    const url = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
      layer + "/default/" + date + "/" + matrixSet +
      "/" + zoom + "/" + tile.tileY + "/" + tile.tileX + "." + fmt;

    try {
      // Sample a 5×5 neighbourhood (radius=2) around the spot pixel to reduce
      // single-pixel noise and give cloud masking more pixels to work with
      const sampleNeighbourhood = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 256; c.height = 256;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve((px, py, radius = 2) => {
            const pixels = [];
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const x = Math.max(0, Math.min(255, px + dx));
                const y = Math.max(0, Math.min(255, py + dy));
                const d = ctx.getImageData(x, y, 1, 1).data;
                pixels.push([d[0], d[1], d[2], d[3]]);
              }
            }
            return pixels;
          });
        };
        img.onerror = reject;
        img.src = url;
      });

      for (const spot of tile.spots) {
        try {
          const allPixels = sampleNeighbourhood(spot.pixelX, spot.pixelY, 2);

          // Keep only valid water pixels — reject cloud, glint, land, transparent
          const waterPixels = allPixels.filter(([r, g, b, a]) =>
            classifyPixel(r, g, b, a) === "water"
          );

          if (waterPixels.length === 0) {
            console.warn(`[Satellite] ${spot.name} ${date}: all ${allPixels.length} pixels invalid (cloud/glint/land) — skipping`);
            continue;
          }

          // Use median-brightness water pixel to avoid outliers
          waterPixels.sort((a, b) => (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]));
          const [r, g, b] = waterPixels[Math.floor(waterPixels.length / 2)];

          const turbidity = layer.includes("TrueColor") ? calcTurbidity(r, g, b) : null;

          console.log(`[Satellite] ${spot.name} ${date}: rgb(${r},${g},${b}) turbidity=${turbidity} (${waterPixels.length}/${allPixels.length} valid px)`);

          results[spot.name] = { r, g, b, turbidity };
        } catch(e) {}
      }
    } catch(e) {}
  }
  return results;
}

// ── Primo Webcam sampling ─────────────────────────────────────────────────────
// Samples pixel regions from Primo's live coastal webcams to infer surface
// turbidity and sea state. Images are CORS-open JPEGs, updated ~every 2 min.
//
// Water regions are defined as fractional bounding boxes [x0,y0,x1,y1] over
// the full image, chosen to cover open sea while avoiding sky, land, and
// camera housing. Each cam maps to one or more spots.
//
// Returns { [spotName]: { turbidity: 0-100, surfaceState: 'calm'|'choppy'|'rough',
//                         camName, fetchedAt, ageMinutes } }

const PRIMO_CAMS = [
  {
    name: "Chimney West",
    url: "https://www.primo.nz/webcameras/snapshot_chimney_sth.jpg",
    // Right half of image: open sea beyond Sugar Loafs, y=20-50% avoids sky/land
    waterRegion: { x0: 0.50, y0: 0.22, x1: 0.95, y1: 0.50 },
    spots: ["Motumahanga", "Nga Motu / Sugar Loafs"],
  },
  {
    name: "East End SLSC",
    url: "https://www.primo.nz/webcameras/snapshot_eastend_slsc.jpg",
    // Upper portion shows open water horizon; avoid sandy beach at bottom
    waterRegion: { x0: 0.05, y0: 0.10, x1: 0.90, y1: 0.45 },
    spots: ["Nga Motu / Sugar Loafs"],
  },
  {
    name: "Fitzroy East",
    url: "https://www.primo.nz/webcameras/snapshot_fitzboardriders.jpg",
    // Sea visible in upper-right past beach
    waterRegion: { x0: 0.40, y0: 0.10, x1: 0.90, y1: 0.45 },
    spots: [],   // NP city beach, not a dive spot — used for sea state reference only
  },
];

function calcWebcamTurbidity(r, g, b) {
  // Similar to calcTurbidity but tuned for real-world camera colour balance.
  // Clear water is blue-dominant; turbid (plume/silt) shifts toward brown/grey.
  // Returns 0 (crystal) – 100 (very turbid).
  const brightness = (r + g + b) / 3;
  const blueDom = b - Math.max(r, g);           // positive = blue water
  const brownIndex = (r - b) / (brightness + 1); // positive = brown/turbid
  const greyFlat = 1 - Math.abs(r - g) / (Math.max(r, g, 1));

  // High brightness + low blue dominance = whitewash/glint — unreliable
  if (brightness > 200 && blueDom < 10) return null;  // glint
  // Very dark = night or shadow — skip
  if (brightness < 20) return null;

  // Score: brownIndex drives turbidity; grey flat water (overcast) is neutral ~40
  let turb = 50 + brownIndex * 80 - blueDom * 0.5;
  turb = Math.max(0, Math.min(100, Math.round(turb)));
  return turb;
}

function calcWebcamSurfaceState(pixelVariance) {
  // Pixel brightness variance over the water region indicates surface roughness
  if (pixelVariance > 800) return "rough";
  if (pixelVariance > 300) return "choppy";
  return "calm";
}

// ── Solar angle / time-of-day webcam confidence ──────────────────────────────
// Key observation: morning sun (east) backlights the water from behind the viewer
// (cameras face west toward the sea from Taranaki coast), making turbidity much
// more visible in the image. Afternoon glare (sun moving west, toward camera)
// washes out colour contrast and reduces pixel analysis reliability.
//
// NZ/Taranaki (UTC+12/+13): Best webcam reads are roughly 6am–11am local time.
// After noon the sun approaches the camera's west-facing direction and glare
// increases. We encode this as a solar confidence multiplier applied to the
// webcam turbidity score weight.

function solarConfidence() {
  // Returns 0.0–1.0 based on local time of day (NZ timezone approx)
  // Uses local browser time — user is in Taranaki so this is correct
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60; // 0–24 local
  // Best window: 6–11am (sun east, backlighting the sea)
  // Acceptable: 11am–1pm (overhead, neutral)
  // Poor: 1pm–5pm (sun moving west, toward camera, glare)
  // Night: unusable
  if (hour < 5.5 || hour > 19.5) return 0.0;   // dark
  if (hour >= 6 && hour <= 11)   return 1.0;    // peak morning window
  if (hour > 11 && hour <= 13)   return 0.7;    // near noon, acceptable
  if (hour > 13 && hour <= 16)   return 0.35;   // afternoon glare building
  if (hour > 16 && hour <= 19.5) return 0.15;   // late afternoon, low sun glare
  if (hour >= 5.5 && hour < 6)   return 0.4;    // pre-dawn/early light
  return 0.5;
}

function solarWindowLabel() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < 5.5 || hour > 19.5) return "🌙 dark";
  if (hour >= 6 && hour <= 11)   return "☀️ ideal";
  if (hour > 11 && hour <= 13)   return "🌤 ok";
  if (hour > 13)                 return "😎 glare";
  return "🌅 low light";
}

async function samplePrimoCams(SPOTS) {
  const results = {};
  const fetchedAt = Date.now();
  const solConf = solarConfidence();
  const solLabel = solarWindowLabel();

  for (const cam of PRIMO_CAMS) {
    try {
      const { r, g, b, variance } = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const W = img.naturalWidth, H = img.naturalHeight;
            const c = document.createElement("canvas");
            c.width = W; c.height = H;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);

            const { x0, y0, x1, y1 } = cam.waterRegion;
            const rx = Math.round(x0 * W), ry = Math.round(y0 * H);
            const rw = Math.round((x1 - x0) * W), rh = Math.round((y1 - y0) * H);

            // Sample a grid of ~60 points across the water region
            const samples = [];
            const cols = 10, rows = 6;
            for (let row = 0; row < rows; row++) {
              for (let col = 0; col < cols; col++) {
                const sx = rx + Math.round((col / (cols - 1)) * rw);
                const sy = ry + Math.round((row / (rows - 1)) * rh);
                const px = ctx.getImageData(sx, sy, 1, 1).data;
                const brightness = (px[0] + px[1] + px[2]) / 3;
                // Reject very bright (glint/sky) and very dark (shadow) pixels
                if (brightness > 210 || brightness < 15) continue;
                samples.push([px[0], px[1], px[2]]);
              }
            }

            if (samples.length < 6) { reject(new Error("insufficient valid pixels")); return; }

            // Median pixel
            samples.sort((a, b) => (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]));
            const med = samples[Math.floor(samples.length / 2)];

            // Variance of brightness across samples
            const brightnesses = samples.map(s => (s[0]+s[1]+s[2]) / 3);
            const mean = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
            const variance = brightnesses.reduce((acc, v) => acc + (v - mean) ** 2, 0) / brightnesses.length;

            resolve({ r: med[0], g: med[1], b: med[2], variance });
          } catch(e) { reject(e); }
        };
        img.onerror = () => reject(new Error("load failed"));
        img.src = cam.url + "?t=" + fetchedAt;
        setTimeout(() => reject(new Error("timeout")), 8000);
      });

      const turbidity = calcWebcamTurbidity(r, g, b);
      if (turbidity === null) continue;
      const surfaceState = calcWebcamSurfaceState(variance);

      console.log(`[Webcam] ${cam.name}: rgb(${r},${g},${b}) turb=${turbidity} surf=${surfaceState} var=${Math.round(variance)}`);

      for (const spotName of cam.spots) {
        // If multiple cams cover a spot, blend by taking the worse (higher) turbidity
        if (results[spotName]) {
          results[spotName].turbidity = Math.round((results[spotName].turbidity + turbidity) / 2);
        } else {
          results[spotName] = { turbidity, surfaceState, camName: cam.name, r, g, b, fetchedAt, ageMinutes: 0, solarConfidence: solConf, solarLabel: solLabel };
        }
      }
    } catch(e) {
      console.warn(`[Webcam] ${cam.name} failed:`, e.message);
    }
  }
  return results;
}

// ── Data extraction helpers ───────────────────────────────────────────────────

function nowIdx(times) {
  const now = Date.now();
  let best = 0, bd = Infinity;
  times.forEach((t, i) => {
    const d = Math.abs(new Date(t).getTime() - now);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function dailyRainHistory(times, vals, maxDays = 14) {
  const now = Date.now();
  const byDay = {};
  times.forEach((t, i) => {
    const hrs = (now - new Date(t).getTime()) / 3600000;
    if (hrs < 0 || hrs > maxDays * 24) return;
    const dayAgo = Math.floor(hrs / 24);
    byDay[dayAgo] = (byDay[dayAgo] ?? 0) + safe(vals[i]);
  });
  const result = [];
  for (let d = 0; d < maxDays; d++) result.push(byDay[d] ?? 0);
  return result;
}

function dailySwellHistory(times, vals, maxDays = 7) {
  const now = Date.now();
  const byDay = {};
  times.forEach((t, i) => {
    const hrs = (now - new Date(t).getTime()) / 3600000;
    if (hrs < 0 || hrs > maxDays * 24) return;
    const dayAgo = Math.floor(hrs / 24);
    byDay[dayAgo] = Math.max(byDay[dayAgo] ?? 0, safe(vals[i]));
  });
  const result = [];
  for (let d = 0; d < maxDays; d++) result.push(byDay[d] ?? 0);
  return result;
}

function rain48h(times, vals) {
  const now = Date.now();
  return times.reduce((sum, t, i) => {
    const hrs = (now - new Date(t).getTime()) / 3600000;
    return (hrs >= 0 && hrs <= 48) ? sum + safe(vals[i]) : sum;
  }, 0);
}

function daysSinceRain(vals) {
  const daily = [];
  let bucket = 0;
  vals.forEach((v, i) => {
    bucket += safe(v);
    if ((i + 1) % 24 === 0) { daily.push(bucket); bucket = 0; }
  });
  let days = 0;
  for (let i = daily.length - 2; i >= 0; i--) {
    if (daily[i] > 5) break;
    days++;
  }
  return days;
}

function maxSwellPast(times, vals, hours) {
  const now = Date.now();
  return times.reduce((mx, t, i) => {
    const hrs = (now - new Date(t).getTime()) / 3600000;
    return (hrs >= 0 && hrs <= hours) ? Math.max(mx, safe(vals[i])) : mx;
  }, 0);
}

function condFromHourly(marine, weather, mIdx, wIdx, r48, dsr, hist) {
  // Check for null/undefined BEFORE calling safe() so we can distinguish
  // "genuinely calm (0)" from "missing data (null)" — safe(null) returns 0
  // which would make missing data look like calm conditions.
  const hourlyWindRaw = weather.hourly?.wind_speed_10m?.[wIdx];
  const hourlyDirRaw  = weather.hourly?.wind_direction_10m?.[wIdx];
  const currentWindRaw = weather.current?.wind_speed_10m;
  const currentDirRaw  = weather.current?.wind_direction_10m;

  const hourlyValid  = hourlyWindRaw  != null && !isNaN(hourlyWindRaw);
  const currentValid = currentWindRaw != null && !isNaN(currentWindRaw);

  // Prioritise: current block first (most recent real observation),
  // then hourly forecast, then zero as last resort.
  let windSpd, windDir, windSource;
  if (currentValid) {
    windSpd = safe(currentWindRaw);
    windDir = safe(currentDirRaw);
    windSource = "current";
  } else if (hourlyValid) {
    windSpd = safe(hourlyWindRaw);
    windDir = safe(hourlyDirRaw);
    windSource = "hourly";
  } else {
    windSpd = 0;
    windDir = 0;
    windSource = "none";
  }

  return {
    swell_h:        safe(marine.hourly?.wave_height?.[mIdx]),
    swell_p:        safe(marine.hourly?.wave_period?.[mIdx]),
    swell_dir:      safe(marine.hourly?.wave_direction?.[mIdx]),
    swell_hist_72h: hist,
    wind_spd:       windSpd,
    wind_dir:       windDir,
    wind_source:    windSource,
    rain_48h:       r48,
    days_since_rain: dsr,
    sst:            safe(marine.hourly?.sea_surface_temperature?.[mIdx]),
    current_vel:    safe(marine.hourly?.ocean_current_velocity?.[mIdx]),
    current_dir:    safe(marine.hourly?.ocean_current_direction?.[mIdx]),
    tide_h:         0,
  };
}

// ── Forecast builder ──────────────────────────────────────────────────────────

function getDailyScores(marine, weather, spot, W) {
  const mTimes = marine?.hourly?.time ?? [];
  const wTimes = weather?.hourly?.time ?? [];

  const mByDate = {};
  mTimes.forEach((t, i) => {
    const date = t.split("T")[0];
    if (!mByDate[date]) mByDate[date] = { waveH: [], waveP: [], sst: [], curVel: [], curDir: [] };
    mByDate[date].waveH.push(safe(marine.hourly.wave_height?.[i]));
    mByDate[date].waveP.push(safe(marine.hourly.wave_period?.[i]));
    mByDate[date].sst.push(safe(marine.hourly.sea_surface_temperature?.[i]));
    mByDate[date].curVel.push(safe(marine.hourly.ocean_current_velocity?.[i]));
    mByDate[date].curDir.push(safe(marine.hourly.ocean_current_direction?.[i]));
  });

  const wByDate = {};
  wTimes.forEach((t, i) => {
    const date = t.split("T")[0];
    if (!wByDate[date]) wByDate[date] = { wind: [], windDir: [], precip: [] };
    wByDate[date].wind.push(safe(weather.hourly.wind_speed_10m?.[i]));
    wByDate[date].windDir.push(safe(weather.hourly.wind_direction_10m?.[i]));
    wByDate[date].precip.push(safe(weather.hourly.precipitation?.[i]));
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  const allDates = [...new Set([...Object.keys(mByDate), ...Object.keys(wByDate)])].sort();
  const todayStr = new Date().toLocaleDateString("en-CA");

  const dailyRainMap = {};
  const dailySwellMaxMap = {};
  const dailySwellAvgMap = {};
  allDates.forEach(d => {
    const w = wByDate[d];
    dailyRainMap[d] = w ? sum(w.precip) : 0;
    const m = mByDate[d];
    dailySwellMaxMap[d] = m ? Math.max(...m.waveH, 0) : 0;
    dailySwellAvgMap[d] = m ? avg(m.waveH) : 0;
  });

  const futureDates = allDates.filter(d => d >= todayStr).slice(0, 7);

  return futureDates.map((date, dayIdx) => {
    const m = mByDate[date];
    const w = wByDate[date] ?? { wind: [0], windDir: [270], precip: [0] };

    const dateIdx = allDates.indexOf(date);
    let rain48h = dailyRainMap[date] || 0;
    if (dateIdx > 0) rain48h += dailyRainMap[allDates[dateIdx - 1]] || 0;

    let daysSinceRainVal = 0;
    for (let i = dateIdx; i >= 0; i--) {
      if ((dailyRainMap[allDates[i]] || 0) > 3) break;
      daysSinceRainVal++;
    }

    let swellHist72 = 0;
    for (let i = Math.max(0, dateIdx - 3); i < dateIdx; i++) {
      swellHist72 = Math.max(swellHist72, dailySwellMaxMap[allDates[i]] || 0);
    }
    if (dayIdx === 0) swellHist72 = Math.max(swellHist72, dailySwellMaxMap[date] || 0);

    const rainHistory = [];
    for (let i = 0; i < 14; i++) {
      const idx = dateIdx - i;
      if (idx >= 0) rainHistory.push(dailyRainMap[allDates[idx]] || 0);
      else rainHistory.push(0);
    }

    const swellHistory = [];
    for (let i = 0; i < 7; i++) {
      const idx = dateIdx - i;
      if (idx >= 0) swellHistory.push(dailySwellAvgMap[allDates[idx]] || 0);
      else swellHistory.push(0);
    }

    const cond = {
      swell_h:         avg(m?.waveH ?? [0]),
      swell_p:         avg(m?.waveP ?? [0]),
      swell_dir:       0,
      swell_hist_72h:  swellHist72,
      wind_spd:        avg(w.wind),
      wind_dir:        avg(w.windDir),
      rain_48h:        rain48h,
      days_since_rain: daysSinceRainVal,
      sst:             avg(m?.sst ?? [0]),
      current_vel:     avg(m?.curVel ?? [0]),
      current_dir:     avg(m?.curDir ?? [0]),
      tide_h:          0,
      rainHistory,
      swellHistory,
    };
    const { score, factors } = scoreSpot(cond, spot, W);
    return { date, score, factors, cond };
  });
}

// ── Advice generator ──────────────────────────────────────────────────────────

function getAdvice(cond, results, region = "taranaki") {
  const best = results[0];
  const tips = [];

  if (best.score >= 80) tips.push({ e: "🤿", t: `Excellent — 10m+ vis expected at ${best.spot.name}. Get in the water.` });
  else if (best.score >= 60) tips.push({ e: "🐟", t: `Good spearfishing vis (5–10m) at ${best.spot.name}. Worth the dive.` });
  else if (best.score >= 40) tips.push({ e: "🦞", t: `Crays/paua conditions only (3–5m) at ${best.spot.name}. Not great for spearing.` });
  else tips.push({ e: "🚫", t: "Under 3m across all spots — not worth diving. Wait for conditions to settle." });

  // Wind direction advice — uses best spot's pipeline-calibrated dirs
  if (best.spot && best.spot.best_wind_dirs && cond.wind_spd > 5) {
    const bestStr = best.spot.best_wind_dirs.reduce((max, dir) => {
      const diff = Math.abs(((cond.wind_dir - dir + 360) % 360));
      return Math.max(max, Math.max(0, 1 - Math.min(diff, 360-diff) / 60));
    }, 0);
    if (bestStr > 0.5) {
      if (cond.rain_48h > 15)
        tips.push({ e: "🌀", t: `Favourable wind direction for ${best.spot.name} — but recent rain may outweigh it. Check satellite data.` });
      else
        tips.push({ e: "🌀", t: `Wind direction ideal for ${best.spot.name} — clean water push active.` });
    }
  }

  if (cond.sst < 15.5)
    tips.push({ e: "🧊", t: `Cold SST (${cond.sst.toFixed(1)}°C) — active upwelling, expect turbid water.` });

  if (cond.swell_hist_72h > 2.0)
    tips.push({ e: "🌊", t: `Swell peaked ${cond.swell_hist_72h.toFixed(1)}m in the past 72h — water may still be dirty.` });

  if (cond.rain_48h > 20 && cond.days_since_rain < 2) {
    if (region === "taranaki")
      tips.push({ e: "🌧️", t: "Recent heavy rain — avoid Waitara and Patea river mouths." });
    else if (region === "kapiti")
      tips.push({ e: "🌧️", t: "Recent heavy rain — expect reduced viz near river outlets and the Waikanae estuary." });
    else
      tips.push({ e: "🌧️", t: "Recent heavy rain — expect reduced viz near river mouths and inshore spots." });
  }

  if (region === "taranaki" && cond.rainHistory) {
    const plumePct = Math.round(plumeReachFactor(cond.rainHistory) * 100);
    if (plumePct >= 80)
      tips.push({ e: "🟤", t: `Heavy turbidity plume reaching Motumahanga (${plumePct}% impact) — offshore buffer fully overwhelmed. All Nga Motu spots affected. Check satellite imagery before heading out.` });
    else if (plumePct >= 40)
      tips.push({ e: "🟤", t: `Turbidity plume partially reaching Motumahanga (${plumePct}% impact) — offshore advantage significantly reduced. Check satellite imagery before heading out.` });
    else if (plumePct > 0)
      tips.push({ e: "🟡", t: `Minor plume influence at Motumahanga (${plumePct}%) — mostly still buffered but watch the satellite.` });
  }

  if (cond.current_vel > 0.3 && cond.current_dir >= 130 && cond.current_dir <= 230)
    tips.push({ e: "🌊", t: "Southerly current running — upwelling risk on exposed spots." });

  if (cond.rainHistory && cond.swellHistory) {
    const rb = recoveryBonus(cond.rainHistory, cond.swellHistory);
    const cleanDays = cond.rainHistory.filter((mm, i) => i < 14 && mm < 3).length;
    if (rb >= 8)
      tips.push({ e: "✨", t: `${cleanDays}+ days of clean conditions — water clarity should be building nicely.` });
    else if (rb >= 4)
      tips.push({ e: "📈", t: `${cleanDays} clean days so far — visibility improving but may not be fully clear yet.` });
    const recentHeavy = cond.rainHistory.slice(2, 10).reduce((a, b) => a + b, 0);
    if (recentHeavy > 40 && rb < 4)
      tips.push({ e: "⏳", t: `Heavy rain in the past week (${recentHeavy.toFixed(0)}mm) — allow more time for water to clear, especially at papa spots.` });
  }

  return tips;
}

// ── Dive log helpers ──────────────────────────────────────────────────────────

const LOG_KEY = "taranaki_dive_log";

function loadLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLog(entries) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch {}
}

// ── Community log hook (Supabase) ──────────────────────────────────────────────
function useCommunityLogs() {
  const [logs, setLogs] = useState([]);
  const [logStatus, setLogStatus] = useState("idle");
  const isConfigured = SUPABASE_KEY !== "YOUR_KEY_HERE" && SUPABASE_KEY.length > 10;

  const load = useCallback(async () => {
    if (!isConfigured) { setLogStatus("unconfigured"); return; }
    setLogStatus("loading");
    try {
      await seedLogsIfEmpty();
      const data = await fetchCommunityLogs();
      setLogs(data);
      setLogStatus("ok");
    } catch(e) {
      console.error("Supabase fetch error:", e);
      setLogStatus("error");
    }
  }, [isConfigured]);

  useEffect(() => { load(); }, [load]);

  const addLog = useCallback(async (entry) => {
    if (!isConfigured) throw new Error("Supabase not configured");
    const [inserted] = await insertLog(entry);
    setLogs(prev => [inserted, ...prev]);
    return inserted;
  }, [isConfigured]);

  return { logs, logStatus, addLog, refresh: load, isConfigured };
}

function spotBiasMultiplier(spotName, entries) {
  const spotEntries = entries
    .filter(e => {
      const ms = e.modelScore ?? e.model_score ?? 0;
      const ov = e.observedVis ?? e.observed_vis ?? 0;
      return e.spot === spotName && ms > 0 && ov > 0;
    })
    .slice(0, 20);
  if (spotEntries.length < 2) return 1.0;
  let weightedRatio = 0, totalWeight = 0;
  spotEntries.forEach((e, i) => {
    const weight = Math.pow(0.93, i);
    const predicted = scoreToVis(e.modelScore ?? e.model_score);
    const ratio = (e.observedVis ?? e.observed_vis) / predicted;
    weightedRatio += ratio * weight;
    totalWeight += weight;
  });
  const mult = weightedRatio / totalWeight;
  return Math.max(0.6, Math.min(1.4, mult));
}

function applyBias(score, biasMult) {
  if (Math.abs(biasMult - 1.0) < 0.03) return score;
  const vis = scoreToVis(score) * biasMult;
  if (vis >= 10) return Math.min(100, score + 10);
  if (vis >= 7)  return Math.min(100, score + 5);
  if (vis >= 4)  return score;
  if (vis >= 2)  return Math.max(0, score - 10);
  if (vis >= 1)  return Math.max(0, score - 20);
  return Math.max(0, score - 30);
}

// ── RTOFS ocean current fetch (via Netlify proxy — ERDDAP blocks browser CORS) ─
// Deploy netlify/functions/erddap-current.js alongside trc-river.js

async function fetchOceanCurrent() {
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

const TRC_RIVER_SITES = {
  12:  "Mangaehu at Huinga",
  17:  "Mangati at SH3",
  53:  "Waingongoro at SH45",
  117: "Waitaha at SH3",
  166: "Urenui at Okoki Rd",
  167: "Waiokura at No3 Fairway",
};

// FNU → normalised turbidity score (0=crystal, 100=chocolate milk)
// Taranaki rivers: <5 FNU = clear, 5–50 = elevated, 50–200 = high, >200 = flood
function fnuToScore(fnu) {
  if (fnu == null) return null;
  if (fnu < 3)   return 0;
  if (fnu < 10)  return Math.round(fnu / 10 * 15);          // 0–15
  if (fnu < 50)  return Math.round(15 + (fnu - 10) / 40 * 35); // 15–50
  if (fnu < 200) return Math.round(50 + (fnu - 50) / 150 * 35); // 50–85
  return Math.min(100, Math.round(85 + (fnu - 200) / 100 * 15)); // 85–100
}

async function fetchTRCRiverData() {
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

// ══════════════════════════════════════════════════════════════════════════════
// CONSOLIDATED DATA HOOK
// ══════════════════════════════════════════════════════════════════════════════

function useAllSpotsData(logEntries, SPOTS, W, region) {
  // ── Shared ocean data ────────────────────────────────────────────────────
  const [currentData, setCurrentData]     = useState(null);
  const [currentStatus, setCurrentStatus] = useState("idle");

  // ── CHANGE 2: Satellite turbidity state ──────────────────────────────────
  const [satData, setSatData]     = useState({});   // { [spotName]: { turbidity, r, g, b, date, agedays } }
  const [satStatus, setSatStatus] = useState("idle");
  const satRef = useRef({});

  const [webcamData, setWebcamData]     = useState({});  // { [spotName]: { turbidity, surfaceState, camName, fetchedAt, ageMinutes } }
  const [webcamStatus, setWebcamStatus] = useState("idle");
  const webcamRef = useRef({});

  const [riverData, setRiverData]     = useState({});  // { [siteId]: { name, latestFNU, latestTime, trend, ... } }
  const [riverStatus, setRiverStatus] = useState("idle");
  const riverRef = useRef({});

  // ── Per-spot scored data ─────────────────────────────────────────────────
  const [spotDataMap, setSpotDataMap]     = useState({});
  const [loading, setLoading]             = useState(true);
  const [errors, setErrors]               = useState({});

  const currentRef  = useRef(null);

  useEffect(() => { currentRef.current  = currentData;  }, [currentData]);
  // CHANGE 2: Keep satRef in sync
  useEffect(() => { satRef.current = satData; }, [satData]);
  useEffect(() => { webcamRef.current = webcamData; }, [webcamData]);
  useEffect(() => { riverRef.current  = riverData;  }, [riverData]);

  const computeSpotResult = useCallback((spot, marine, weather, rtofs, entries) => {
    const mTimes = marine.hourly?.time ?? [];
    const wTimes = weather.hourly?.time ?? [];
    const mIdx = nowIdx(mTimes);
    const wIdx = nowIdx(wTimes);

    const r48  = rain48h(wTimes, weather.hourly?.precipitation ?? []);
    const dsr  = daysSinceRain(weather.hourly?.precipitation ?? []);
    const hist = maxSwellPast(mTimes, marine.hourly?.wave_height ?? [], 72);
    const rainHist  = dailyRainHistory(wTimes, weather.hourly?.precipitation ?? [], 14);
    const swellHist = dailySwellHistory(mTimes, marine.hourly?.wave_height ?? [], 7);

    const condBase = condFromHourly(marine, weather, mIdx, wIdx, r48, dsr, hist);

    const rtofsOverride = rtofs?.valid
      ? { current_vel: rtofs.speed / 1.944, current_dir: rtofs.dir }
      : {};

    // CHANGE 2: Pull satellite turbidity for this spot if available
    const satSpot = satRef.current?.[spot.name];
    const satOverride = satSpot
      ? { satTurbidity: satSpot.turbidity, satTurbidityAge: satSpot.agedays }
      : {};

    // Webcam turbidity for this spot if available
    const webcamSpot = webcamRef.current?.[spot.name];
    const webcamOverride = webcamSpot
      ? { webcamTurbidity: webcamSpot.turbidity, webcamAgeMinutes: webcamSpot.ageMinutes, webcamSolarConfidence: webcamSpot.solarConfidence ?? 0.5, webcamSource: webcamSpot.source ?? "live" }
      : {};

    // River turbidity from TRC gauges — blend primary + secondary site readings
    // weighted by river_impact. Higher FNU → amplify river penalty in scoreSpot.
    let riverOverride = {};
    if (spot.trc_sites && riverRef.current && Object.keys(riverRef.current).length > 0) {
      const sites = spot.trc_sites.map(id => riverRef.current[id]).filter(Boolean);
      if (sites.length > 0) {
        // Weighted average: primary site (first) gets 70%, secondary gets 30%
        const weights = sites.length === 1 ? [1] : [0.7, 0.3];
        const weightedFNU = sites.reduce((sum, site, i) => sum + (site.latestFNU ?? 0) * (weights[i] ?? 0.15), 0);
        const maxFNU = Math.max(...sites.map(s => s.recentMax ?? s.latestFNU ?? 0));
        // Rising trend amplifies impact (river hasn't peaked yet)
        const trendFactor = sites[0].trend > 5 ? 1.3 : sites[0].trend > 1 ? 1.1 : 1.0;
        riverOverride = {
          riverFNU: weightedFNU,
          riverMaxFNU: maxFNU,
          riverTrendFactor: trendFactor,
          riverTurbScore: fnuToScore(weightedFNU * trendFactor),
        };
      }
    }

    const cond = {
      ...condBase,
      ...rtofsOverride,
      ...satOverride,
      ...webcamOverride,
      ...riverOverride,
      rainHistory: rainHist,
      swellHistory: swellHist,
    };

    const { score: rawScore, factors, plumeReach } = scoreSpot(cond, spot, W);

    const biasMult = spotBiasMultiplier(spot.name, entries || []);
    let score = applyBias(rawScore, biasMult);

    const forecast = getDailyScores(marine, weather, spot, W);

    return {
      cond, score, rawScore, factors, forecast, biasMult,
      plumeReach: plumeReach ?? 0,
      satData: satRef.current?.[spot.name] ?? null,
      webcamData: webcamRef.current?.[spot.name] ?? null,
    };
  }, []);

  const rawApiRef = useRef({});

  const rescoreAll = useCallback(() => {
    const raw = rawApiRef.current;
    if (Object.keys(raw).length === 0) return;

    const rtofs  = currentRef.current;

    const updated = {};
    for (const spot of SPOTS) {
      const api = raw[spot.name];
      if (!api) continue;
      try {
        updated[spot.name] = computeSpotResult(spot, api.marine, api.weather, rtofs, logEntries);
      } catch(e) {}
    }
    if (Object.keys(updated).length > 0) {
      setSpotDataMap(prev => ({ ...prev, ...updated }));
    }
  }, [logEntries, computeSpotResult]);

  // Rescore when ocean data arrives (RTOFS)
  useEffect(() => { rescoreAll(); }, [currentData, logEntries, rescoreAll]);

  // CHANGE 3: Rescore when satellite turbidity arrives
  useEffect(() => { rescoreAll(); }, [satData, rescoreAll]);
  // Rescore when webcam data arrives
  useEffect(() => { rescoreAll(); }, [webcamData, rescoreAll]);
  // Rescore when river data arrives
  useEffect(() => { rescoreAll(); }, [riverData, rescoreAll]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);

      // Fire RTOFS in background
      const rtofsPromise = fetchOceanCurrent()
        .then(data  => { if (!cancelled) { setCurrentData(data); setCurrentStatus("ok"); } })
        .catch(err  => { if (!cancelled) { setCurrentStatus("error"); setCurrentData({ valid: false, error: err.message }); } });

      // CHANGE 3: Fire satellite turbidity fetch in background
      setSatStatus("loading");
      const satPromise = (async () => {
        try {
          // Walk back up to 14 days to find a cloud-free MODIS Aqua tile.
          // Uses classifyPixel() to count valid water pixels — if >30% of sampled
          // pixels are water (not cloud/glint/land) we consider the tile usable.
          // Each probe has a 5s timeout so a hanging image can't stall the chain.
          let tcDate = null;
          for (let n = 1; n <= 14; n++) {
            const d = new Date();
            d.setDate(d.getDate() - n);
            const dateStr = d.toISOString().split("T")[0];
            const hasData = await Promise.race([
              new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                // Probe tile centred on Taranaki coast (zoom 5, tile x=31 y=19 in WMTS coords)
                img.src = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/5/19/31.jpg`;
                img.onload = () => {
                  try {
                    const c = document.createElement("canvas");
                    c.width = 64; c.height = 64;
                    const ctx = c.getContext("2d");
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const data = ctx.getImageData(0, 0, 64, 64).data;
                    let waterCount = 0, total = 0;
                    for (let i = 0; i < data.length; i += 4) {
                      const [r, g, b, a] = [data[i], data[i+1], data[i+2], data[i+3]];
                      if (a < 10) continue;
                      total++;
                      if (classifyPixel(r, g, b, a) === "water") waterCount++;
                    }
                    const waterFraction = total > 0 ? waterCount / total : 0;
                    console.log(`[Satellite probe] ${dateStr}: ${waterCount}/${total} water pixels (${(waterFraction*100).toFixed(0)}%)`);
                    resolve(waterFraction > 0.25); // need at least 25% valid ocean pixels
                  } catch { resolve(true); }
                };
                img.onerror = () => resolve(false);
              }),
              new Promise(resolve => setTimeout(() => resolve(false), 5000)), // 5s timeout per probe
            ]);
            if (hasData) { tcDate = dateStr; break; }
          }
          if (!tcDate) tcDate = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().split("T")[0]; })();

          // Fetch both layers in parallel:
          //   TrueColor  → display swatch shown to user (natural looking)
          //   Bands721   → turbidity scoring (bands 7-2-1 false colour;
          //                sediment/turbid water = bright red/magenta,
          //                clear deep water = dark blue/black, cloud = white)
          //                The red channel (band 7, 2.1µm SWIR) is a direct
          //                proxy for suspended sediment — illumination-independent
          //                and much less affected by sun glint than visible bands.
          const [tcPixels, b721Pixels] = await Promise.all([
            sampleGibsTile("MODIS_Aqua_CorrectedReflectance_TrueColor", tcDate, 9, "jpg", SPOTS),
            sampleGibsTile("MODIS_Aqua_CorrectedReflectance_Bands721",   tcDate, 9, "jpg", SPOTS),
          ]);

          const today = new Date();
          const imgDate = new Date(tcDate + "T00:00:00");
          const agedays = Math.round((today - imgDate) / 86400000);

          const result = {};
          SPOTS.forEach(s => {
            const tc   = tcPixels[s.name];
            const b721 = b721Pixels[s.name];

            // Need at least the TrueColor pixel to show a swatch
            if (!tc && !b721) return;

            let turbidity = null;
            let turbiditySource = null;

            if (b721) {
              // Bands 7-2-1 turbidity: in this composite, band 7 (SWIR 2.1µm)
              // maps to the RED channel. High red = high suspended sediment.
              // Band 2 (NIR 0.86µm) maps to GREEN. Band 1 (red 0.65µm) maps to BLUE.
              // We use normalised red fraction as the sediment index — this is
              // essentially a SWIR-based NDTI analogue, robust to sun glint and
              // atmospheric haze which mostly affect visible wavelengths.
              const { r, g, b } = b721;
              const total = r + g + b;
              if (total > 30) {  // >10 allows near-black garbage through; require meaningful signal
                const swirFraction  = r / total;   // band 7 SWIR — sediment proxy
                const nirFraction   = g / total;   // band 2 NIR
                const redFraction   = b / total;   // band 1 red
                // Clear water: swirFraction low (~0.20), nirFraction moderate
                // Turbid/sediment: swirFraction high (0.45–0.70)
                // Scale 0.20–0.65 range to 0–100
                const raw = (swirFraction - 0.18) / (0.60 - 0.18) * 100;
                turbidity = Math.min(100, Math.max(0, Math.round(raw)));
                turbiditySource = "bands721";
                console.log(`[Satellite B721] ${s.name}: rgb(${r},${g},${b}) swirFrac=${swirFraction.toFixed(3)} → turbidity=${turbidity}`);
              }
            }

            // Fall back to TrueColor turbidity if Bands721 pixel was rejected
            if (turbidity === null && tc?.turbidity != null) {
              turbidity = tc.turbidity;
              turbiditySource = "truecolor";
              console.log(`[Satellite TC fallback] ${s.name}: turbidity=${turbidity}`);
            }

            result[s.name] = {
              turbidity,
              turbiditySource,
              // Display swatch uses TrueColor RGB (natural looking) with B721 as fallback
              r: tc?.r ?? b721?.r ?? 0,
              g: tc?.g ?? b721?.g ?? 0,
              b: tc?.b ?? b721?.b ?? 0,
              date: tcDate,
              agedays,
            };
          });

          if (!cancelled) {
            satRef.current = result;
            setSatData(result);
            setSatStatus("ok");
            console.log(`[Satellite] Turbidity data loaded from ${tcDate} (${agedays} days old):`,
              Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.turbidity]))
            );
          }
        } catch(e) {
          console.warn("[Satellite] Turbidity fetch failed:", e);
          if (!cancelled) setSatStatus("error");
        }
      })();

      // ── Webcam: morning-cache strategy ──────────────────────────────────────
      // 1. Always try to load today's stored morning reading from Supabase first.
      // 2. If it's the morning solar window (6–11am) AND no reading exists yet
      //    for today, do a live camera fetch and store the result.
      // 3. Outside the morning window, use stored reading only (avoids glare).
      // Only runs for Taranaki — cams are NP-based.
      let webcamPromise = Promise.resolve();
      if (region === "taranaki") {
        setWebcamStatus("loading");
        webcamPromise = (async () => {
          try {
            const today = todayNZ();
            const hour = new Date().getHours() + new Date().getMinutes() / 60;
            const isMorningWindow = hour >= 6 && hour <= 11;

            // Step 1: check for an existing stored reading today
            let stored = await fetchStoredWebcamReadings(today);
            const hasStoredToday = Object.keys(stored).length > 0;

            if (hasStoredToday) {
              // Use stored morning reading — update age but keep original turbidity
              const now = Date.now();
              Object.values(stored).forEach(v => {
                v.ageMinutes = (now - v.fetchedAt) / 60000;
                v.solarLabel = "☀️ morning (cached)";
              });
              if (!cancelled) {
                webcamRef.current = stored;
                setWebcamData(stored);
                setWebcamStatus("ok");
                console.log(`[Webcam] Loaded ${Object.keys(stored).length} stored morning readings for ${today}`);
              }
            } else if (isMorningWindow) {
              // Step 2: morning window, no stored reading — do live fetch and store
              console.log("[Webcam] Morning window, no stored reading — sampling cameras live");
              const liveResult = await samplePrimoCams(SPOTS);
              if (!cancelled && Object.keys(liveResult).length > 0) {
                Object.values(liveResult).forEach(v => { v.ageMinutes = 0; });

                // Store each spot's reading in Supabase (non-blocking)
                for (const [spotName, data] of Object.entries(liveResult)) {
                  upsertWebcamReading(today, spotName, data).catch(() => {});
                }

                webcamRef.current = liveResult;
                setWebcamData(liveResult);
                setWebcamStatus("ok");
                console.log("[Webcam] Live morning fetch complete, stored to Supabase:", Object.fromEntries(Object.entries(liveResult).map(([k,v]) => [k, v.turbidity])));
              } else if (!cancelled) {
                setWebcamStatus("no-data");
              }
            } else {
              // Afternoon/evening with no stored reading — report that
              console.log("[Webcam] No stored morning reading for today and outside morning window — skipping live fetch");
              if (!cancelled) setWebcamStatus("no-morning-data");
            }
          } catch(e) {
            console.warn("[Webcam] fetch/store failed:", e);
            if (!cancelled) setWebcamStatus("error");
          }
        })();
      }

      // Fetch weather + marine for all spots — staggered to avoid rate limiting
      // (18 simultaneous requests to Open-Meteo triggers 400s on their free tier)
      const delay = ms => new Promise(r => setTimeout(r, ms));
      const spotPromises = SPOTS.map(async (spot, spotIdx) => {
        await delay(spotIdx * 300); // 300ms stagger between spots
        const wLat = spot.weather_lat ?? spot.lat;
        const wLon = spot.weather_lon ?? spot.lon;
        const mLat = spot.marine_lat  ?? spot.lat;
        const mLon = spot.marine_lon  ?? spot.lon;

        try {
          const [weatherRes, marineRes, currentWeatherRes] = await Promise.all([
            fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${wLat}&longitude=${wLon}` +
              `&hourly=wind_speed_10m,wind_direction_10m,precipitation` +
              `&wind_speed_unit=kmh&timezone=Pacific%2FAuckland&forecast_days=7&past_days=9`
            ),
            fetch(
              `https://marine-api.open-meteo.com/v1/marine?latitude=${mLat}&longitude=${mLon}` +
              `&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction` +
              `&timezone=Pacific%2FAuckland&forecast_days=7&past_days=9`
            ),
            fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${wLat}&longitude=${wLon}` +
              `&current=wind_speed_10m,wind_direction_10m` +
              `&wind_speed_unit=kmh&timezone=Pacific%2FAuckland&forecast_days=1`
            ),
          ]);

          const weather = await weatherRes.json();
          const marine  = await marineRes.json();
          const currentWeather = await currentWeatherRes.json();

          // Open-Meteo returns 4xx with a JSON error body — surface these early
          if (weather.error) throw new Error(`Weather API: ${weather.reason ?? "unknown error"}`);
          if (marine.error)  throw new Error(`Marine API: ${marine.reason ?? "unknown error"}`);

          // Merge current block into weather object
          if (currentWeather.current) {
            weather.current = currentWeather.current;
          }

          // Guard: if current block has wind speed but no direction, patch from hourly
          if (
            weather.current?.wind_speed_10m != null &&
            weather.current?.wind_direction_10m == null
          ) {
            const wIdxFallback = nowIdx(weather.hourly?.time ?? []);
            const fallbackDir = weather.hourly?.wind_direction_10m?.[wIdxFallback];
            if (fallbackDir != null) {
              console.warn(`[${spot.name}] current block missing wind_direction — patching from hourly: ${fallbackDir}°`);
              weather.current.wind_direction_10m = fallbackDir;
            }
          }

          const wIdx0 = nowIdx(weather.hourly?.time ?? []);
          console.log(`[${spot.name}] Weather API:`, {
            hasCurrentBlock: !!weather.current,
            currentWind: weather.current?.wind_speed_10m ?? "MISSING",
            currentWindDir: weather.current?.wind_direction_10m ?? "MISSING",
            hourlyWindAtNow: weather.hourly?.wind_speed_10m?.[wIdx0] ?? "NULL",
            hourlyLength: weather.hourly?.wind_speed_10m?.length ?? 0,
            nonZeroWindHours: (weather.hourly?.wind_speed_10m ?? []).filter(v => v > 0).length,
          });

          if (!cancelled) {
            rawApiRef.current[spot.name] = { marine, weather };

            const result = computeSpotResult(
              spot, marine, weather,
              currentRef.current,
              logEntries,
            );

            console.log(`[${spot.name}] Wind resolved:`, {
              source: result.cond.wind_source,
              spd: result.cond.wind_spd?.toFixed(1) + " kph",
              dir: result.cond.wind_dir?.toFixed(0) + "° (" + dirName(result.cond.wind_dir) + ")",
            });

            setSpotDataMap(prev => ({ ...prev, [spot.name]: result }));
          }
        } catch(e) {
          console.error(`[${spot.name}] FETCH FAILED:`, e.message, e);
          if (!cancelled) {
            setErrors(prev => ({ ...prev, [spot.name]: `Error: ${e.message}` }));
          }
        }
      });

      // Fire TRC river turbidity fetch in background (Taranaki only — Netlify proxy)
      let riverPromise = Promise.resolve();
      if (region === "taranaki") {
        setRiverStatus("loading");
        riverPromise = (async () => {
          try {
            const sites = await fetchTRCRiverData();
            if (sites && !cancelled) {
              riverRef.current = sites;
              setRiverData(sites);
              setRiverStatus("ok");
            } else if (!cancelled) {
              setRiverStatus("no-data");
            }
          } catch(e) {
            if (!cancelled) setRiverStatus("error");
            console.warn("[TRC River] fetch failed:", e.message);
          }
        })();
      }

      await Promise.all([
        ...spotPromises,
        rtofsPromise,
        Promise.race([satPromise,   new Promise(r => setTimeout(r, 30000))]),    // sat can't block >30s
        Promise.race([webcamPromise, new Promise(r => setTimeout(r, 15000))]),   // webcam max 15s
        Promise.race([riverPromise,  new Promise(r => setTimeout(r, 12000))]),   // river max 12s
      ]);
      if (!cancelled) setLoading(false);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [SPOTS]);

  // CHANGE 3: Expose satData and satStatus
  return {
    spotDataMap,
    loading,
    errors,
    currentData,
    currentStatus,
    satData,
    satStatus,
    webcamData,
    webcamStatus,
    riverData,
    riverStatus,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function FactorBar({ label, value, isDelta }) {
  const color = isDelta
    ? value > 0 ? "#00e5a0" : value < 0 ? "#e03030" : "#607d8b"
    : value >= 70 ? "#00e5a0" : value >= 50 ? "#f0c040" : value >= 30 ? "#f07040" : "#e03030";
  const display = isDelta
    ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}`
    : Math.round(value);
  return (
    <div className="factor">
      <div className="factor-key">{label}</div>
      <div className="factor-val" style={{ color }}>{display}</div>
    </div>
  );
}

function ForecastBar({ days }) {
  if (!days || days.length === 0) return null;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="forecast-bar">
      <div className="forecast-label-row">7-DAY FORECAST</div>
      <div className="forecast-days">
        {days.map((d, i) => {
          const date = parseDateLocal(d.date);
          const dayName = i === 0 ? "Today" : dayNames[date.getDay()];
          const color = scoreToColor(d.score);
          return (
            <div key={d.date} className="forecast-day"
              title={`${d.date}: Score ${d.score}\nSwell ${d.cond.swell_h.toFixed(1)}m ${d.cond.swell_p.toFixed(0)}s (72h peak: ${d.cond.swell_hist_72h.toFixed(1)}m)\nWind ${d.cond.wind_spd.toFixed(0)}kph (${(d.cond.wind_spd / 1.852).toFixed(0)}kt) ${dirName(d.cond.wind_dir)}\nSST ${d.cond.sst.toFixed(1)}°C\nRain 48h: ${d.cond.rain_48h.toFixed(1)}mm · ${d.cond.days_since_rain}d since rain`}>
              <div className="fday-name">{dayName}</div>
              <div className="fday-bar-wrap">
                <div className="fday-bar" style={{
                  height: `${d.score}%`,
                  background: `linear-gradient(to top, ${color}cc, ${color}33)`,
                  borderTop: `2px solid ${color}`,
                }} />
              </div>
              <div className="fday-score" style={{ color }}>{d.score}</div>
              <div className="fday-swell">{d.cond.swell_h.toFixed(1)}m</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WindForecastBar({ days }) {
  if (!days || days.length === 0) return null;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const maxWind = Math.max(30, ...days.map(d => d.cond.wind_spd));

  function windColor(spd) {
    if (spd <= 8) return "#00e5a0";
    if (spd <= 15) return "#6ab4c8";
    if (spd <= 25) return "#f0c040";
    if (spd <= 35) return "#f07040";
    return "#e03030";
  }

  function windLabel(spd) {
    if (spd <= 5) return "Calm";
    if (spd <= 10) return "Light";
    if (spd <= 20) return "Moderate";
    if (spd <= 30) return "Fresh";
    return "Strong";
  }

  return (
    <div className="wind-forecast-bar">
      <div className="wind-forecast-label">💨 WIND FORECAST</div>
      <div className="wind-forecast-days">
        {days.map((d, i) => {
          const date = parseDateLocal(d.date);
          const dayName = i === 0 ? "Today" : dayNames[date.getDay()];
          const spd = d.cond.wind_spd;
          const dir = d.cond.wind_dir;
          const color = windColor(spd);
          const barH = Math.max(8, (spd / maxWind) * 100);
          const isNW = dir >= 270 && dir <= 360;

          return (
            <div key={d.date} className="wf-day"
              title={`${d.date}: ${spd.toFixed(0)} kph ${dirName(dir)} (${(spd / 1.852).toFixed(0)} kt)\n${windLabel(spd)}${isNW ? " — NW push active 🟢" : ""}`}>
              <div className="wf-day-name">{dayName}</div>
              <div className="wf-arrow" style={{
                transform: `rotate(${dir}deg)`,
                color: color,
                opacity: spd < 3 ? 0.3 : 1,
              }}>↓</div>
              <div className="wf-bar-wrap">
                <div className="wf-bar" style={{
                  height: `${barH}%`,
                  background: `linear-gradient(to top, ${color}cc, ${color}33)`,
                  borderTop: `2px solid ${color}`,
                }} />
              </div>
              <div className="wf-speed" style={{ color }}>{spd.toFixed(0)}</div>
              <div className="wf-dir">{dirName(dir)}</div>
              {isNW && <div className="wf-nw-badge" title="NW push active">🌊</div>}
            </div>
          );
        })}
      </div>
      <div className="wf-legend">
        <span style={{color:"#00e5a0"}}>● &lt;8 Calm</span>
        <span style={{color:"#6ab4c8"}}>● 8–15 Light</span>
        <span style={{color:"#f0c040"}}>● 15–25 Mod</span>
        <span style={{color:"#f07040"}}>● 25–35 Fresh</span>
        <span style={{color:"#e03030"}}>● 35+ Strong</span>
        <span style={{color:"#4a8a9a",marginLeft:"0.4rem"}}>kph · ↓ = wind from</span>
      </div>
    </div>
  );
}

// ── Dive log modal ────────────────────────────────────────────────────────────

function DiveLogModal({ spot, modelScore, onSave, onClose, diverName, onCommunitySave, isConfigured }) {
  const [vis, setVis] = useState("");
  const [tide, setTide] = useState("high");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [name, setName] = useState(diverName || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSave() {
    const v = parseFloat(vis);
    if (!name.trim()) { setErr("Enter your name so we can attribute the data."); return; }
    if (isNaN(v) || v <= 0 || v > 50) { setErr("Enter a valid visibility in metres (e.g. 3)"); return; }
    setSaving(true); setErr(null);

    const localEntry = {
      id: Date.now(), date, spot: spot.name,
      observedVis: v, tide, modelScore,
      notes: notes.trim(), diver_name: name.trim(),
    };
    const existing = loadLog();
    const updated = [localEntry, ...existing];
    saveLog(updated);
    onSave(updated);

    if (isConfigured && onCommunitySave) {
      try {
        await onCommunitySave({
          diver_name: name.trim(), date, spot: spot.name,
          observed_vis: v, tide, model_score: modelScore,
          notes: notes.trim(),
        });
      } catch(e) {
        console.error("Community log save failed:", e);
      }
    }
    setSaving(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>📝 Log Observation</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-spot">{spot.name}</div>
        <div className="modal-field">
          <label>Your Name</label>
          <input type="text" placeholder="e.g. Mike" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="modal-field">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Observed Visibility (metres)</label>
          <input type="number" step="0.5" min="0.1" max="40" placeholder="e.g. 3"
            value={vis} onChange={e => setVis(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Tide</label>
          <div className="tide-buttons">
            {["low", "mid", "high"].map(t => (
              <button key={t} className={`tide-btn ${tide === t ? "active" : ""}`}
                onClick={() => setTide(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="modal-field">
          <label>Notes (optional)</label>
          <textarea placeholder="Water colour, fish activity, conditions..." value={notes}
            onChange={e => setNotes(e.target.value)} rows={2} />
        </div>
        {err && <div style={{color:"#e06040",fontSize:"0.75rem",marginBottom:"0.5rem"}}>{err}</div>}
        <div className="modal-footer">
          <div className="modal-score">Model score at time: <strong>{modelScore}</strong></div>
          <button className="modal-save" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "💾 Save to Community Log"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Spot history mini-panel ───────────────────────────────────────────────────

function SpotHistory({ spotName, entries }) {
  const spotEntries = entries.filter(e => e.spot === spotName).slice(0, 3);
  if (spotEntries.length === 0) return null;

  const bias = spotBiasMultiplier(spotName, entries);
  const biasDir = bias > 1.05 ? "↑" : bias < 0.95 ? "↓" : "≈";
  const biasColor = bias > 1.05 ? "#00e5a0" : bias < 0.95 ? "#f07040" : "#607d8b";
  const biasLabel = bias > 1.05
    ? `Model under-predicts by ~${Math.round((bias - 1) * 100)}%`
    : bias < 0.95
    ? `Model over-predicts by ~${Math.round((1 - bias) * 100)}%`
    : "Model accuracy good";

  return (
    <div className="spot-history">
      <div className="history-header">
        <span className="history-title">YOUR OBSERVATIONS</span>
        <span className="history-bias" style={{ color: biasColor }}
          title={biasLabel}>{biasDir} {biasLabel}</span>
      </div>
      {spotEntries.map(e => (
        <div key={e.id} className="history-row">
          <span className="history-date">{e.date}</span>
          <span className="history-vis">{e.observedVis}m</span>
          <span className="history-tide">{e.tide} tide</span>
          {e.notes && <span className="history-note" title={e.notes}>📝</span>}
        </div>
      ))}
    </div>
  );
}

// ── Spot card ─────────────────────────────────────────────────────────────────

function SpotCard({ spot, data, error, currentData, logEntries, onLogUpdate, communityLogs, logStatus, onCommunitySave, diverName, isConfigured }) {
  const [expanded, setExpanded] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);

  const score = data?.score;
  const color = score != null ? scoreToColor(score) : "#607d8b";

  return (
    <div className="spot-card" style={{ "--accent": color }}>
      <div className="spot-header" onClick={() => data && setExpanded(e => !e)}
        style={{ cursor: data ? "pointer" : "default" }}>
        <h3>{spot.name}</h3>
        {spot.river && <span className="river-tag" title="River runoff risk">River</span>}
        {data && <span className="expand-arrow">{expanded ? "▲" : "▼"}</span>}
      </div>

      {!data && !error && <div className="loading-bar"><div className="loading-fill" /></div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          {/* Gauge */}
          <div className="viz-gauge">
            <svg viewBox="0 0 120 70" className="gauge-svg">
              <defs>
                <linearGradient id={`grad-${spot.name.replace(/\W/g, "")}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#e03030" />
                  <stop offset="50%" stopColor="#f0c040" />
                  <stop offset="100%" stopColor="#00e5a0" />
                </linearGradient>
              </defs>
              <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#1a2a3a" strokeWidth="8" strokeLinecap="round" />
              <path d="M10 60 A50 50 0 0 1 110 60" fill="none"
                stroke={`url(#grad-${spot.name.replace(/\W/g, "")})`}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray="157"
                strokeDashoffset={157 - ((score ?? 0) / 100) * 157}
                style={{ transition: "stroke-dashoffset 1s ease" }}
              />
              <text x="60" y="52" textAnchor="middle" fill={color} fontSize="18" fontWeight="bold" fontFamily="'Space Mono', monospace">{score}</text>
              <text x="60" y="63" textAnchor="middle" fill={color} fontSize="7.5" fontFamily="'Space Mono', monospace">{visLabel(score)}</text>
            </svg>
          </div>

          <div className="viz-label" style={{ color }}>
            {(score ?? 0) >= 80 ? "🤿" : (score ?? 0) >= 60 ? "🐟" : (score ?? 0) >= 40 ? "🦞" : (score ?? 0) >= 20 ? "🌊" : "🚫"}{" "}
            {scoreToLabel(score)}
            {data.biasMult && Math.abs(data.biasMult - 1.0) >= 0.05 && (
              <span className="bias-indicator" title={`Bias-adjusted from raw score ${data.rawScore}`}>
                {data.biasMult > 1 ? " ↑" : " ↓"} adj
              </span>
            )}
            {data.plumeReach > 0 && (
              <span className="bias-indicator plume-badge"
                style={{color: data.plumeReach >= 80 ? "#e03030" : data.plumeReach >= 40 ? "#f07040" : "#f0c040"}}
                title={`Turbidity plume reaching Motumahanga (${data.plumeReach}% impact).`}>
                {" "}🟤 plume {data.plumeReach}%
              </span>
            )}
          </div>
          <button className="log-btn" onClick={() => setShowLogModal(true)}>+ Log Your Observation</button>
          {showLogModal && (
            <DiveLogModal
              spot={spot}
              modelScore={data.rawScore}
              onSave={onLogUpdate}
              onClose={() => setShowLogModal(false)}
              diverName={diverName}
              onCommunitySave={onCommunitySave}
              isConfigured={isConfigured}
            />
          )}

          {/* Conditions grid */}
          <div className="conditions">
            {[
              { icon: "🌊", val: `${data.cond.swell_h.toFixed(1)}m ${data.cond.swell_p.toFixed(0)}s`, key: "Swell" },
              { icon: "💨", val: (() => {
                  const spd = data.cond.wind_spd;
                  const dir = dirName(data.cond.wind_dir);
                  const src = data.cond.wind_source;
                  const spdKt = (spd / 1.852).toFixed(0);
                  let label = `${spd.toFixed(0)}kph (${spdKt}kt) ${dir}`;
                  if (src === "none") label += " ⚠️";
                  return label;
                })(), key: (() => {
                  const src = data.cond.wind_source;
                  if (src === "current") return "Wind · live";
                  if (src === "hourly") return "Wind · forecast";
                  return "Wind ⚠️ no data";
                })() },
              { icon: "🌧", val: `${data.cond.rain_48h.toFixed(1)}mm`, key: "Rain 48h" },
              { icon: "🌡️", val: `${data.cond.sst.toFixed(1)}°C`, key: "SST" },
              // CHANGE 4: Satellite turbidity row
              ...(data.satData ? [{
                icon: "🛰️",
                val: (() => {
                  const t = data.satData.turbidity;
                  const age = data.satData.agedays;
                  const label = t > 60 ? "Turbid" : t > 30 ? "Moderate" : t > 10 ? "Clear" : "Very Clear";
                  const tColor = t > 60 ? "#e03030" : t > 30 ? "#f07040" : t > 10 ? "#f0c040" : "#00e5a0";
                  const srcLabel = data.satData.turbiditySource === "bands721" ? "SWIR" : "TC";
                  return (
                    <span>
                      <span style={{color: tColor}}>{label} ({t})</span>
                      {" "}
                      <span style={{
                        display:"inline-block", width:10, height:10,
                        borderRadius:"50%", verticalAlign:"middle",
                        background:`rgb(${data.satData.r},${data.satData.g},${data.satData.b})`,
                        border:"1px solid #334"
                      }} />
                      <span style={{color:"#4a7a8a",fontSize:"0.65rem"}}> {age}d ago · {srcLabel}</span>
                    </span>
                  );
                })(),
                key: "Sat Turbidity",
              }] : []),
              // Webcam turbidity row (live camera pixel analysis)
              ...(data.webcamData ? [{
                icon: "📷",
                val: (() => {
                  const t = data.webcamData.turbidity;
                  const label = t > 60 ? "Turbid" : t > 30 ? "Moderate" : t > 10 ? "Clear" : "Very Clear";
                  const tColor = t > 60 ? "#e03030" : t > 30 ? "#f07040" : t > 10 ? "#f0c040" : "#00e5a0";
                  const surf = data.webcamData.surfaceState;
                  const surfIcon = surf === "rough" ? "🌊" : surf === "choppy" ? "〰️" : "🪞";
                  return (
                    <span>
                      <span style={{color: tColor}}>{label} ({t})</span>
                      {" "}{surfIcon}
                      <span style={{
                        display:"inline-block", width:10, height:10,
                        borderRadius:"50%", verticalAlign:"middle",
                        background:`rgb(${data.webcamData.r},${data.webcamData.g},${data.webcamData.b})`,
                        border:"1px solid #334", marginLeft:4
                      }} />
                      <span style={{color:"#4a7a8a",fontSize:"0.65rem"}}> {data.webcamData.source === "supabase" ? "☀️ morning read" : "🔴 live"} · {data.webcamData.camName} · {data.webcamData.solarLabel ?? ""}</span>
                    </span>
                  );
                })(),
                key: "Webcam",
              }] : []),
              { icon: "🌀", val: (() => {
                  if (currentData?.valid) return `${currentData.speed.toFixed(1)}kt ${currentData.dirLabel} (RTOFS)`;
                  return `${data.cond.current_vel.toFixed(2)}m/s ${dirName(data.cond.current_dir)}`;
                })(), key: "Current" },
            ].map(c => (
              <div key={c.key} className="cond">
                <span className="cond-icon">{c.icon}</span>
                <div>
                  <div className="cond-val">{c.val}</div>
                  <div className="cond-key">{c.key}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Factor breakdown */}
          <div className="factors-grid">
            <FactorBar label="Swell" value={data.factors.swell} isDelta={false} />
            <FactorBar label="Wind" value={data.factors.wind} isDelta={false} />
            <FactorBar label="Rain" value={data.factors.rain} isDelta={false} />
            <FactorBar label="NW" value={data.factors.nw} isDelta={true} />
            <FactorBar label="Current" value={data.factors.current} isDelta={true} />
            <FactorBar label="SST" value={data.factors.sst} isDelta={true} />
            <FactorBar label="Tide" value={data.factors.tide} isDelta={true} />
            <FactorBar label="Recovery" value={data.factors.recovery ?? 0} isDelta={true} />
            {/* CHANGE 4: Satellite factor bar */}
            {data.factors.satellite != null && data.factors.satellite !== 0 && (
              <FactorBar label="Satellite" value={data.factors.satellite} isDelta={true} />
            )}
            {data.factors.webcam != null && data.factors.webcam !== 0 && (
              <FactorBar label="Webcam" value={data.factors.webcam} isDelta={true} />
            )}
            {data.factors.riverGauge != null && data.factors.riverGauge !== 0 && (
              <FactorBar label="River gauge" value={data.factors.riverGauge} isDelta={true} />
            )}
          </div>

          <div className="spot-note">{spot.note}</div>

          {/* Live river turbidity callout from TRC gauges */}
          {spot.trc_sites && data.cond.riverFNU != null && data.cond.riverFNU > 0 && (() => {
            const fnu = data.cond.riverFNU;
            const trend = data.cond.riverTrendFactor > 1.1 ? " ↑ rising" : "";
            const level = fnu < 5 ? { label: "clear", color: "#00e5a0" }
                        : fnu < 30 ? { label: "slightly elevated", color: "#f0c040" }
                        : fnu < 100 ? { label: "murky", color: "#f07040" }
                        : { label: "very high — flood turbidity", color: "#e05030" };
            return (
              <div style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem", marginTop: "0.3rem",
                            background: "rgba(0,0,0,0.2)", borderRadius: "6px", color: level.color }}>
                💧 River gauge: <strong>{fnu.toFixed(1)} FNU</strong> — {level.label}{trend}
                <span style={{ color: "#3a6070", marginLeft: "0.4rem" }}>
                  (TRC · {TRC_RIVER_SITES[spot.trc_sites[0]] ?? "gauge"})
                </span>
              </div>
            );
          })()}

          {spot.river && data.cond.rain_48h > 10 && !data.cond.riverFNU && (
            <div className="warning">⚠️ Recent rain — expect river runoff and reduced viz at this spot</div>
          )}

          <SpotHistory spotName={spot.name} entries={logEntries || []} />
          <CommunityLogPanel logs={communityLogs || []} logStatus={logStatus} spotName={spot.name} />

          {data.forecast && <ForecastBar days={data.forecast} />}
          {data.forecast && <WindForecastBar days={data.forecast} />}

          {expanded && data.forecast && (
            <div className="expanded-table">
              <table>
                <thead>
                  <tr>
                    <th>Day</th><th>Score</th><th>Swell</th><th>Wind</th><th>SST</th><th>Rain</th><th>Settling</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.map((d, i) => {
                    const date = parseDateLocal(d.date);
                    const dn = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][date.getDay()];
                    const shortDate = date.toLocaleDateString("en-NZ", { day:"numeric", month:"short" });
                    return (
                      <tr key={d.date}>
                        <td>
                          <span style={{ color: "#8ab" }}>{i === 0 ? "Today" : dn}</span>{" "}
                          <span style={{ color: "#345", fontSize: "0.68rem" }}>{shortDate}</span>
                        </td>
                        <td style={{ color: scoreToColor(d.score), fontFamily: "'Space Mono',monospace", fontWeight: "700" }}>{d.score}</td>
                        <td>{d.cond.swell_h.toFixed(1)}m {d.cond.swell_p.toFixed(0)}s</td>
                        <td>{d.cond.wind_spd.toFixed(0)}kph ({(d.cond.wind_spd / 1.852).toFixed(0)}kt) {dirName(d.cond.wind_dir)}</td>
                        <td>{d.cond.sst.toFixed(1)}°C</td>
                        <td>{d.cond.rain_48h.toFixed(1)}mm</td>
                        <td style={{ color: d.cond.days_since_rain >= 4 ? "#00e5a0" : d.cond.days_since_rain >= 2 ? "#f0c040" : "#e06040" }}>
                          {d.cond.days_since_rain}d dry
                          {d.cond.swell_hist_72h > 1.5 && <span style={{ color: "#8ab", fontSize: "0.65rem" }}> · {d.cond.swell_hist_72h.toFixed(1)}m swell</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Best day panel ────────────────────────────────────────────────────────────

function BestDayPanel({ spotDataMap }) {
  const bestDays = useMemo(() => {
    const days = {};
    for (const [spotName, data] of Object.entries(spotDataMap)) {
      if (!data?.forecast?.length) continue;
      const best = data.forecast.reduce((a, b) => b.score > a.score ? b : a, data.forecast[0]);
      days[spotName] = best;
    }
    return days;
  }, [spotDataMap]);

  const allBests = Object.entries(bestDays);
  if (allBests.length === 0) return null;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dateScores = {};
  allBests.forEach(([spotName, best]) => {
    if (!dateScores[best.date]) dateScores[best.date] = { total: 0, count: 0, spots: [] };
    dateScores[best.date].total += best.score;
    dateScores[best.date].count += 1;
    dateScores[best.date].spots.push({ spotName, score: best.score });
  });

  const [date, info] = Object.entries(dateScores).sort((a, b) =>
    (b[1].total / b[1].count) - (a[1].total / a[1].count)
  )[0];

  const d = parseDateLocal(date);
  const today = new Date().toLocaleDateString("en-CA");
  const dayLabel = date === today ? "Today" : dayNames[d.getDay()];
  const dateStr = d.toLocaleDateString("en-NZ", { day: "numeric", month: "long" });
  const avgScore = Math.round(info.total / info.count);
  const color = scoreToColor(avgScore);

  return (
    <div className="best-day-panel" style={{ "--best-color": color }}>
      <div className="best-day-icon">🎯</div>
      <div className="best-day-content">
        <div className="best-day-title">Best Dive Day This Week</div>
        <div className="best-day-date" style={{ color }}>{dayLabel} · {dateStr}</div>
        <div className="best-day-avg">
          Avg score: <strong style={{ color }}>{avgScore}</strong> · {scoreToLabel(avgScore)} · {visLabel(avgScore)} est.
        </div>
        <div className="best-day-spots">
          {info.spots.sort((a, b) => b.score - a.score).map(s => (
            <span key={s.spotName} className="best-spot-chip"
              style={{ borderColor: scoreToColor(s.score) + "55", color: scoreToColor(s.score) }}>
              {s.spotName} <strong>{s.score}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Advice panel ──────────────────────────────────────────────────────────────

function AdvicePanel({ spotDataMap, spots, region }) {
  const advice = useMemo(() => {
    const entries = Object.entries(spotDataMap);
    if (entries.length === 0) return [];

    const firstData = entries[0]?.[1];
    if (!firstData?.cond) return [];

    const scored = spots.map(spot => {
      const d = spotDataMap[spot.name];
      return { spot, score: d?.score ?? 0 };
    }).sort((a, b) => b.score - a.score);

    return getAdvice(firstData.cond, scored, region);
  }, [spotDataMap, region]);

  if (!advice || advice.length === 0) return null;
  return (
    <div className="advice-panel">
      {advice.map((tip, i) => (
        <div key={i} className="advice-tip">
          <span className="advice-emoji">{tip.e}</span>
          <span>{tip.t}</span>
        </div>
      ))}
    </div>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="legend">
      {[
        { label: "Excellent", sub: "10m+", color: "#00e5a0" },
        { label: "Good", sub: "5–10m", color: "#7dd64f" },
        { label: "Crays/Paua", sub: "3–5m", color: "#f0a030" },
        { label: "Poor", sub: "1–3m", color: "#f07040" },
        { label: "Not Diveable", sub: "< 1m", color: "#e03030" },
      ].map(i => (
        <div key={i.label} className="legend-item">
          <span className="legend-dot" style={{ background: i.color }} />
          <span className="legend-label">{i.label}</span>
          <span className="legend-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
}


// ── Satellite map ─────────────────────────────────────────────────────────────

function SpotMap({ spotScores, currentData, currentStatus, spots, mapCenter, mapZoom }) {
  const mapRef         = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef     = useRef([]);
  const layersRef      = useRef({});

  const [activeLayer,  setActiveLayer]  = useState("satellite");
  const [layerDates,   setLayerDates]   = useState({
    truecolor: null,
  });

  function fmtDate(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr + "T00:00:00");
    return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
  }

  function dateStrNDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }

  async function gibsTileHasData(layer, dateStr, fmt) {
    const ext = fmt === "jpg" ? "jpg" : "png";
    const matrix = fmt === "jpg" ? "GoogleMapsCompatible_Level9" : "GoogleMapsCompatible_Level7";
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${dateStr}/${matrix}/5/19/31.${ext}`;
    try {
      return await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = 32; c.height = 32;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, 32, 32);
            const px = ctx.getImageData(0, 0, 32, 32).data;
            const uniq = new Set();
            for (let i = 0; i < px.length; i += 16) {
              uniq.add(`${px[i]},${px[i+1]},${px[i+2]}`);
            }
            resolve(uniq.size > 8);
          } catch(e) { resolve(true); }
        };
        img.onerror = () => resolve(false);
        img.src = url;
      });
    } catch(e) { return false; }
  }

  async function findLastClearDate(layer, fmt, maxDays = 10) {
    for (let n = 1; n <= maxDays; n++) {
      const dateStr = dateStrNDaysAgo(n);
      const hasData = await gibsTileHasData(layer, dateStr, fmt);
      if (hasData) return dateStr;
    }
    return dateStrNDaysAgo(3);
  }

  function buildMarkers(map, L, scoresArg) {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    spots.forEach(spot => {
      const score   = scoresArg[spot.name] ?? null;
      const color   = score != null ? scoreToColor(score) : "#607d8b";
      const label   = score != null ? scoreToLabel(score) : "Loading…";
      const vis     = score != null ? visLabel(score) : "";
      const size    = 38;

      const svg = `
        <svg width="${size}" height="${size+10}" viewBox="0 0 ${size} ${size+10}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="#040d14" stroke="${color}" stroke-width="2.5" opacity="0.92"/>
          <text x="${size/2}" y="${size/2-3}" text-anchor="middle" fill="${color}"
            font-size="13" font-weight="bold" font-family="monospace">${score ?? "…"}</text>
          <text x="${size/2}" y="${size/2+8}" text-anchor="middle" fill="${color}"
            font-size="6.5" font-family="monospace" opacity="0.85">
            ${vis.replace("🤿","").replace("🦞","").trim()}
          </text>
          <line x1="${size/2}" y1="${size-2}" x2="${size/2}" y2="${size+9}"
            stroke="${color}" stroke-width="2" opacity="0.7"/>
        </svg>`;

      const icon = L.divIcon({
        html: svg, className: "",
        iconSize: [size, size+10], iconAnchor: [size/2, size+10], popupAnchor: [0, -(size+10)],
      });

      const marker = L.marker([spot.lat, spot.lon], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:monospace;font-size:12px;min-width:180px;background:#0a1a26;padding:2px">
            <strong style="font-size:13px;color:${color}">${spot.name}</strong><br/>
            <span style="color:${color};font-size:18px;font-weight:bold">${score ?? "…"}</span>
            <span style="color:#888"> / 100</span> &nbsp;
            <span style="color:${color}">${label}</span><br/>
            ${vis ? `<span style="color:#aaa;font-size:11px">${vis} est.</span><br/>` : ""}
            <hr style="border-color:#1a3a4a;margin:5px 0"/>
            <span style="color:#444;font-size:10px">${spot.note.slice(0,80)}…</span>
          </div>
        `);

      markersRef.current.push(marker);
    });
  }

  async function initMap() {
    if (mapInstanceRef.current || !mapRef.current) return;
    const L = window.L;

    const map = L.map(mapRef.current, {
      center: mapCenter ?? [-39.2, 174.1], zoom: mapZoom ?? 9,
      zoomControl: true, attributionControl: true,
    });
    mapInstanceRef.current = map;

    const tcDate = await findLastClearDate("MODIS_Aqua_CorrectedReflectance_TrueColor", "jpg", 12);

    setLayerDates({ truecolor: tcDate });

    const satellite = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/${tcDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      { attribution: `NASA GIBS — MODIS Aqua True Colour (${fmtDate(tcDate)})`, maxZoom: 9, tileSize: 256 }
    );
    const labels = L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { opacity: 0.6, maxZoom: 17 }
    );
    const osm = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: "© OpenStreetMap", maxZoom: 17, opacity: 0.4 }
    );

    layersRef.current = { satellite, labels, osm };
    satellite.addTo(map);
    labels.addTo(map);

    buildMarkers(map, L, spotScores);
  }

  useEffect(() => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);
    }
    const load = () => initMap();
    if (window.L) { load(); }
    else {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = load;
      document.head.appendChild(script);
    }
    // Cleanup: destroy map instance when mapCenter changes (region switch)
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersRef.current = [];
        layersRef.current = {};
      }
    };
  }, [mapCenter]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    buildMarkers(mapInstanceRef.current, window.L, spotScores);
  }, [spotScores]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L   = window.L;
    if (!map || !L || !layersRef.current.satellite) return;
    const { satellite, labels, osm } = layersRef.current;
    [satellite, labels, osm].forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    if (activeLayer === "satellite") {
      satellite.addTo(map); labels.addTo(map);
    }
  }, [activeLayer]);

  function activeDateBadge() {
    if (activeLayer === "satellite") {
      return layerDates.truecolor
        ? <span>
            Image date: <strong style={{color:"#6ab4c8"}}>{fmtDate(layerDates.truecolor)}</strong>
            <span style={{color:"#3a6a7a"}}> · NASA MODIS Aqua · 250m</span>
            {layerDates.truecolor <= dateStrNDaysAgo(2) &&
              <span style={{color:"#f0c040"}}> · last clear (cloud on recent days)</span>}
          </span>
        : <span style={{color:"#4a7a8a"}}>Finding last clear satellite pass…</span>;
    }
    return null;
  }

  const layerBtns = [
    { id: "satellite", label: "🛰 Satellite", date: layerDates.truecolor },
  ];

  return (
    <div className="spot-map-wrap">
      <div className="spot-map-toolbar">
        <span className="spot-map-label">📍 FORECAST SPOTS</span>
        <div className="spot-map-layer-btns">
          {layerBtns.map(b => (
            <button key={b.id}
              className={"map-layer-btn" + (activeLayer === b.id ? " active" : "")}
              onClick={() => setActiveLayer(b.id)}>
              <span>{b.label}</span>
              {b.date && (
                <span className="layer-btn-date" style={{
                  display: "block", fontSize: "0.5rem", opacity: 0.75,
                  color: b.date <= dateStrNDaysAgo(2) ? "#f0c040" : "#6ab4c8",
                }}>
                  {b.date}{b.date <= dateStrNDaysAgo(2) ? " ☁" : ""}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div ref={mapRef} className="spot-map" />

      <div className="spot-map-footer">
        <span className="spot-map-date-info">{activeDateBadge()}</span>
        <span className="current-widget">
          {currentStatus === "loading" && (
            <span style={{color:"#4a7a8a",fontSize:"0.7rem"}}>🌊 Loading current…</span>
          )}
          {currentStatus === "ok" && currentData?.valid && (
            <span style={{fontSize:"0.72rem",display:"inline-flex",alignItems:"center",gap:"0.4rem"}}>
              <span style={{color:"#6ab4c8",fontWeight:600}}>🌊 Current</span>
              <span style={{
                display:"inline-block",
                transform:`rotate(${currentData.dir}deg)`,
                fontSize:"1rem", lineHeight:1,
                color: currentData.v < -0.1 ? "#e06040" : currentData.v > 0.1 ? "#40b080" : "#aaa"
              }}>↑</span>
              <span style={{color:"#cde"}}>{currentData.dirLabel}</span>
              <span style={{color:"#8ab"}}>{currentData.speed.toFixed(1)} kt</span>
              <span style={{
                color: currentData.v < -0.1 ? "#e07050" : currentData.v > 0.1 ? "#50c090" : "#8ab",
                fontSize:"0.65rem"
              }}>
                {currentData.v < -0.1 ? "↓ southward — plume risk ↑" :
                 currentData.v > 0.1  ? "↑ northward — cleaner water" :
                 "weak — mixed conditions"}
              </span>
              <span style={{color:"#3a6a7a",fontSize:"0.6rem"}}>RTOFS HYCOM {currentData.ageHrs}h ago</span>
            </span>
          )}
          {currentStatus === "error" && (
            <span style={{color:"#e06040",fontSize:"0.7rem"}}>🌊 Current unavailable</span>
          )}
        </span>
        <span className="spot-map-hint">Click a marker for details</span>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// DATA SOURCES & VALIDATION PAGE
// ══════════════════════════════════════════════════════════════════════════════

function DataSourcesPage({ W, spots }) {
  return (
    <div className="ds-page">
      <div className="ds-hero">
        <div className="ds-hero-icon">📡</div>
        <h2 className="ds-hero-title">Data Sources & Model</h2>
        <p className="ds-hero-sub">How the scores are built — what feeds in, how they're combined, and where to cross-check</p>
      </div>

      {/* ── SCORING PIPELINE ───────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">⚙️ Scoring Pipeline</h3>
        <p className="ds-section-desc">
          Each spot score (0–100) is computed fresh on every page load from live API data. The pipeline runs in this order:
        </p>
        <div className="ds-sources">
          {[
            { n: "1. Base score", d: "Weighted average of swell sub-score (0.45), wind sub-score (0.25), and rain penalty (0.30), multiplied by a swell history multiplier (0.60–1.0× depending on wave height over the past 72 hours)." },
            { n: "2. Wind direction push/drag", d: "Each spot has calibrated best_wind_dirs and worst_wind_dirs from pipeline analysis. Offshore wind adds a push bonus; onshore subtracts. Amplified by wind speed and rain (rain during offshore wind reduces the push benefit)." },
            { n: "3. Ocean current", d: "Northerly current (cleaner Tasman water) adds points; southerly (turbid Whanganui/Manawatū plume) subtracts. Southerly bight spots (Patea) are amplified further." },
            { n: "4. SST adjustment", d: "SST > 18°C = warm-water bonus (stratified, clear). SST < 16°C = cold-water penalty (upwelling = murky). Sourced from Open-Meteo Marine." },
            { n: "5. Tide adjustment", d: "Per-spot tide sensitivity (0–1). High incoming tide at sensitive spots can stir sediment. Currently uses Open-Meteo's tidal model — not a dedicated tidal gauge." },
            { n: "6. Shelter & river", d: "Sheltered spots buffer bad conditions. River-mouth spots take a penalty proportional to rain history and their river_impact coefficient." },
            { n: "7. Recovery bonus", d: "Extended dry + calm stretches (3–7+ days) earn up to +12 points. Reduced if active plume-reach is in effect." },
            { n: "8. Satellite turbidity (satAdj)", d: "MODIS Aqua SWIR pixel sampling for each spot. Turbidity index 0–100 fed back as a score adjustment. Confidence decays over 3 days. High turbidity (>60) suppresses score; low (<20) gives a small clarity bonus." },
            { n: "9. Webcam turbidity (webcamAdj)", d: "Primo webcam pixel sampling — three west-facing cameras covering Motumahanga and Nga Motu. Solar angle modulates confidence (morning = ideal). Morning readings cached in Supabase and re-used throughout the day (12h decay window). Live reads decay over 2 hours." },
            { n: "10. River gauge (riverFNUAdj)", d: "Live FNU turbidity from TRC river gauges via Netlify proxy. Each spot maps to 1–2 nearest gauges. High FNU amplifies the rain-based river penalty; surprisingly clear rivers give a small relief. Rising trend gets a 1.3× multiplier. Capped at ±20 points." },
          ].map(({ n, d }) => (
            <div key={n} className="ds-source-card" style={{ padding: "0.8rem 1.1rem" }}>
              <div style={{ fontWeight: 700, color: "#b0d0e0", fontSize: "0.85rem", marginBottom: "0.3rem" }}>{n}</div>
              <div style={{ fontSize: "0.78rem", color: "#6a9aaa", lineHeight: 1.6 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── DATA SOURCES ───────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">🔗 Live Data Sources</h3>
        <p className="ds-section-desc">Seven independent data streams feed the model, fetched on every load.</p>
        <div className="ds-sources">

          {/* Open-Meteo Weather */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">💨</span>
              <div>
                <div className="ds-source-name">Open-Meteo Weather API</div>
                <a className="ds-source-url" href="https://api.open-meteo.com" target="_blank" rel="noreferrer">api.open-meteo.com/v1/forecast</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Wind speed & direction (10m), hourly precipitation — 9-day history + 7-day forecast"],
                ["Resolution", "~11 km global, hourly updates"],
                ["Models", "GFS, ICON, GEM, ECMWF IFS — auto-selects best for region"],
                ["License", "CC BY 4.0 — free, no key required"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Each spot uses a <strong>weather_lat/lon</strong> coordinate on land (not the dive spot) to guarantee non-null data — offshore grid cells may return null. Wind speed is fetched in <code>kmh</code>. A separate real-time <code>current_weather</code> block is fetched alongside the hourly data and prioritised for present conditions.
              </div>
            </div>
          </div>

          {/* Open-Meteo Marine */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🌊</span>
              <div>
                <div className="ds-source-name">Open-Meteo Marine API</div>
                <a className="ds-source-url" href="https://marine-api.open-meteo.com" target="_blank" rel="noreferrer">marine-api.open-meteo.com/v1/marine</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Wave height, wave period, wave direction, sea surface temperature (SST)"],
                ["Resolution", "~0.5° grid (~50 km), hourly"],
                ["Models", "ECMWF WAM, NOAA WW3, Copernicus Marine"],
                ["License", "CC BY 4.0"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Each spot uses a <strong>marine_lat/lon</strong> shifted ~10–18 km offshore to avoid the land mask — nearshore and island coordinates return null at 0.5° resolution. The offset ensures wave/SST data comes from the nearest open-ocean grid cell.
              </div>
            </div>
          </div>

          {/* RTOFS */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🌀</span>
              <div>
                <div className="ds-source-name">NOAA RTOFS / HYCOM Ocean Current</div>
                <a className="ds-source-url" href="https://upwell.pfeg.noaa.gov/erddap" target="_blank" rel="noreferrer">upwell.pfeg.noaa.gov/erddap</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "U/V ocean current velocity at 1m depth → speed (knots) + direction"],
                ["Resolution", "~8 km, 3-hourly forecast"],
                ["Reference pt", "-39.05°S, 173.87°E (offshore Taranaki — applied to all spots)"],
                ["License", "NOAA public domain"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Southerly currents drive Whanganui/Manawatū sediment-laden water into the South Taranaki Bight — this is the main mechanism behind Patea's bight exposure penalty. Model data can lag real conditions by 6–12 hours.
              </div>
            </div>
          </div>

          {/* NASA GIBS */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🛰️</span>
              <div>
                <div className="ds-source-name">NASA GIBS — MODIS Aqua Satellite</div>
                <a className="ds-source-url" href="https://gibs.earthdata.nasa.gov" target="_blank" rel="noreferrer">gibs.earthdata.nasa.gov/wmts</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Dual-layer MODIS Aqua: TrueColor (display swatch) + Bands 7-2-1 SWIR (turbidity scoring)"],
                ["Resolution", "250m per pixel at zoom level 9"],
                ["Layers", "MODIS_Aqua_CorrectedReflectance_TrueColor + Bands721"],
                ["License", "NASA EOSDIS — public domain"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                The <strong>SWIR band (7, 2.1µm)</strong> is a direct proxy for suspended sediment — immune to sun glint and atmospheric haze that corrupt visible bands. A 5×5 pixel neighbourhood is sampled per spot; cloud and glint pixels are rejected before scoring. Searches back up to 14 days for a scene with &gt;25% valid ocean pixels. Score label shows <strong>· SWIR</strong> when scored from Bands 7-2-1, or <strong>· TC</strong> on TrueColor fallback.
              </div>
            </div>
          </div>

          {/* Primo Webcams */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">📷</span>
              <div>
                <div className="ds-source-name">Primo Webcams — New Plymouth</div>
                <a className="ds-source-url" href="https://www.primo.nz/webcameras/" target="_blank" rel="noreferrer">primo.nz/webcameras</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Cameras", "Chimney West · East End SLSC · Fitzroy East"],
                ["Coverage", "Motumahanga + Nga Motu (Chimney West, East End); Nga Motu only (East End SLSC)"],
                ["Update freq", "Live JPEG snapshots — fetched on load"],
                ["CORS", "Open — pixel-readable cross-origin"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Cameras face <strong>west</strong> — morning easterly sun backlights the water for ideal colour contrast. Solar confidence is highest 6–11am (1.0), drops to 0.35 after 1pm (glare), near-zero at night. Morning readings (6–11am) are stored in Supabase and re-used throughout the day (12h decay window), avoiding glare-corrupted afternoon reads. Live reads outside morning window decay over 2 hours.
              </div>
            </div>
          </div>

          {/* TRC River Gauges */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">💧</span>
              <div>
                <div className="ds-source-name">TRC River Turbidity Gauges</div>
                <a className="ds-source-url" href="https://www.trc.govt.nz/environment/maps-and-data/regional-overview?measureID=19" target="_blank" rel="noreferrer">trc.govt.nz — Environmental Data (measureID=19)</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Live FNU turbidity readings from 6 Taranaki river gauges, every 5 minutes"],
                ["Gauges", "Mangaehu · Mangati · Urenui · Waingongoro · Waiokura · Waitaha"],
                ["Proxy", "Netlify Function (/.netlify/functions/trc-river) — proxies TRC to bypass CORS"],
                ["Trend", "6-hour rising/falling trend computed; rising adds 1.3× multiplier to river penalty"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                FNU is converted to a 0–100 turbidity score: &lt;3 FNU = crystal (0), 3–10 = slightly elevated (0–15), 10–50 = elevated (15–50), 50–200 = murky (50–85), &gt;200 = flood turbidity (85–100). Each spot maps to its geographically nearest gauge(s). The river gauge adjustment is capped at <strong>−20 to +8 points</strong> and only activates when <code>river_impact &gt; 0.1</code>.
              </div>
            </div>
          </div>

          {/* Supabase */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🗄️</span>
              <div>
                <div className="ds-source-name">Supabase — Community Dive Logs</div>
                <a className="ds-source-url" href="https://supabase.com" target="_blank" rel="noreferrer">mgcwrktuplnjtxkbsypc.supabase.co</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Tables", "dive_logs (observed visibility + model score) · webcam_readings (morning cache)"],
                ["Bias system", "Per-spot multiplier (0.6–1.4×) from last 20 logs, exponentially weighted"],
                ["Access", "Anon key (read/write) — community-shared, not private"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Dive logs calibrate the model over time — when you log a real visibility observation, the bias multiplier adjusts future scores for that spot. The webcam_readings table caches the morning (peak-solar) webcam reading once per day per spot, so glare-affected afternoon fetches don't overwrite the reliable morning read.
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── SPOT COORDINATES ───────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">📍 Spot Coordinates</h3>
        <p className="ds-section-desc">
          Each spot has three coordinate sets: the <strong>display location</strong> (actual dive spot), a <strong>marine API offset</strong> (~10–18 km offshore to avoid the 0.5° land mask), and a <strong>weather API coordinate</strong> (on land for reliable wind/rain data).
        </p>
        <div className="ds-coords-table-wrap">
          <table className="ds-coords-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th>Display Lat/Lon</th>
                <th>Marine API</th>
                <th>Weather API</th>
                <th>TRC Gauges</th>
              </tr>
            </thead>
            <tbody>
              {spots.map(s => (
                <tr key={s.name}>
                  <td className="ds-coord-name">{s.name}</td>
                  <td className="ds-coord-num">{s.lat.toFixed(3)}°S, {s.lon.toFixed(3)}°E</td>
                  <td className="ds-coord-num">{s.marine_lat?.toFixed(2)}°S, {s.marine_lon?.toFixed(2)}°E</td>
                  <td className="ds-coord-num">{s.weather_lat?.toFixed(3)}°S, {s.weather_lon?.toFixed(3)}°E</td>
                  <td className="ds-coord-note">{s.trc_sites ? s.trc_sites.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SPOT PARAMETERS ────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">⚙️ Per-Spot Parameters</h3>
        <p className="ds-section-desc">
          Pipeline-calibrated coefficients control how each spot responds to conditions. All values 0–1 except tide_sensitive.
        </p>
        <div className="ds-coords-table-wrap">
          <table className="ds-coords-table ds-params-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th title="How much shelter reduces bad-condition penalties">Shelter</th>
                <th title="River runoff sensitivity">River</th>
                <th title="Papa rock / sediment risk">Papa</th>
                <th title="Swell exposure">Swell exp.</th>
                <th title="Best wind directions (offshore for this aspect)">Best wind dirs</th>
                <th title="Worst wind directions (onshore)">Worst wind dirs</th>
                <th title="Tide sensitivity">Tide</th>
              </tr>
            </thead>
            <tbody>
              {spots.map(s => (
                <tr key={s.name}>
                  <td className="ds-coord-name" style={{ textAlign: "left", fontFamily: "inherit", fontSize: "0.72rem" }}>{s.name.split("—")[0].split("(")[0].trim()}</td>
                  <td style={{ color: s.shelter > 0.6 ? "#00e5a0" : s.shelter < 0.3 ? "#f07040" : "#f0c040" }}>{s.shelter.toFixed(2)}</td>
                  <td style={{ color: s.river_impact > 0.6 ? "#f07040" : s.river_impact < 0.2 ? "#00e5a0" : "#f0c040" }}>{s.river_impact.toFixed(2)}</td>
                  <td style={{ color: s.papa_risk > 0.6 ? "#f07040" : s.papa_risk < 0.2 ? "#00e5a0" : "#f0c040" }}>{s.papa_risk.toFixed(2)}</td>
                  <td style={{ color: s.swell_exposure > 0.6 ? "#f07040" : s.swell_exposure < 0.2 ? "#00e5a0" : "#f0c040" }}>{s.swell_exposure.toFixed(2)}</td>
                  <td style={{ color: "#6ab4c8", fontSize: "0.65rem" }}>{(s.best_wind_dirs||[]).map(d=>["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(d/22.5)%16]).join(", ")}</td>
                  <td style={{ color: "#f07050", fontSize: "0.65rem" }}>{(s.worst_wind_dirs||[]).map(d=>["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(d/22.5)%16]).join(", ")}</td>
                  <td>{(s.tide_sensitive||0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── GLOBAL WEIGHTS ─────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">⚖️ Global Scoring Weights</h3>
        <p className="ds-section-desc">Pipeline-calibrated weights applied uniformly across all spots.</p>
        <div className="ds-weights-grid">
          {[
            { val: W.w_swell,       label: "Swell weight",        desc: "Primary factor — wave height + period" },
            { val: W.w_wind,        label: "Wind weight",         desc: "Wind speed and direction sub-score" },
            { val: W.w_rain,        label: "Rain weight",         desc: "14-day rain history with papa decay" },
            { val: W.push_mult,     label: "Offshore push mult",  desc: "Blue-water suck bonus per offshore wind" },
            { val: W.rain_pen_mult, label: "Rain push penalty",   desc: "Suppresses push bonus during rain events" },
            { val: W.cur_north,     label: "Current north",       desc: "Bonus for northerly (clean Tasman) current" },
            { val: W.cur_south,     label: "Current south",       desc: "Penalty for southerly (turbid bight) current" },
            { val: W.bight_mult,    label: "Bight mult",          desc: "Amplifies southerly penalty for bight-exposed spots" },
            { val: W.sst_warm,      label: "SST warm bonus",      desc: "Bonus when SST > 18°C (no upwelling)" },
            { val: W.sst_cold,      label: "SST cold penalty",    desc: "Penalty when SST < 16°C (upwelling = murky)" },
            { val: W.river_mult,    label: "River mult",          desc: "Scales the rain-based river penalty" },
            { val: W.hist_2_5,      label: "Swell hist ×2.5m",    desc: "Score multiplier if 72h avg swell >2.5m" },
          ].map(({ val, label, desc }) => (
            <div key={label} className="ds-weight-card">
              <div className="ds-weight-val">{val}</div>
              <div className="ds-weight-label">{label}</div>
              <div className="ds-weight-desc">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CALIBRATION ────────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">🔬 Calibration & Known Limits</h3>
        <div className="ds-validation-items">
          {[
            { icon: "🗓️", title: "Pipeline calibration", text: "Spot parameters (best/worst wind dirs, swell max, rain recovery days) derived from 3–5 years of historical MODIS satellite data cross-referenced with Open-Meteo weather and marine hindcasts. Fin Fuckers seasonal data is estimated — pending pipeline run." },
            { icon: "🛰️", title: "Satellite turbidity", text: "SWIR band (2.1µm) is the primary turbidity scorer — sediment-specific, unaffected by sun glint. TrueColor is fallback only. Confidence decays over 3 days. Cloud cover can force 7–14 day old imagery." },
            { icon: "🟤", title: "Plume reach model", text: "Motumahanga has a plume-reach model: weighted 14-day rain history (4-day half-life) drives a 0–100% factor. At 100%, the island is scored like an inshore spot. Calibrated against Feb 2026 satellite imagery showing plume past the island 3+ days post-rain." },
            { icon: "💧", title: "River gauge integration", text: "TRC FNU readings are live-measured turbidity — more direct than rain-proxy alone. Rising trends (>5 FNU/6h) get a 1.3× amplifier. Capped at ±20 points to prevent gauge outages from crashing scores." },
            { icon: "📷", title: "Webcam solar limitation", text: "Cameras face west — afternoon sun creates glare that washes out colour contrast. Morning reads (6–11am) are cached in Supabase. After 11am the cached morning read is used with a 12-hour decay, so glare never contaminates the turbidity score." },
            { icon: "🌊", title: "Tide limitation", text: "Tide sensitivity is calibrated per spot but the tide_h value comes from Open-Meteo's tidal model, not a dedicated NZ tidal gauge. Predictions may differ from actual tides by 10–20 cm." },
            { icon: "🔴", title: "7-day forecast limitations", text: "Satellite turbidity and webcam/river data only affect today's score — not the 7-day forecast bars. Forecast bars use the rain + swell + wind model only. Always cross-check with MetService and Port Taranaki sea conditions before heading out." },
          ].map(({ icon, title, text }) => (
            <div key={title} className="ds-val-item">
              <div className="ds-val-icon">{icon}</div>
              <div>
                <div className="ds-val-title">{title}</div>
                <div className="ds-val-text">{text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CROSS-CHECK LINKS ──────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">🔗 Cross-Check Resources</h3>
        <p className="ds-section-desc">Always verify model outputs with these independent sources before heading out.</p>
        <div className="ds-links-grid">
          {[
            { name: "Port Taranaki — Sea Conditions", desc: "LIVE wind, wave & tide — Lee Breakwater anemometer", url: "https://www.port.co.nz/marine-services/sea-conditions/" },
            { name: "TRC River Turbidity", desc: "Live FNU readings — all 6 Taranaki gauges", url: "https://www.trc.govt.nz/environment/maps-and-data/regional-overview?measureID=19" },
            { name: "Windfinder — Port Taranaki", desc: "Live wind station + forecast", url: "https://www.windfinder.com/forecast/new_plymouth" },
            { name: "Windy.app — New Plymouth", desc: "GFS wind/wave forecast overlay", url: "https://windy.app/forecast2/spots/New-Plymouth" },
            { name: "MetService — Taranaki", desc: "Official NZ weather forecast", url: "https://www.metservice.com/towns-cities/locations/new-plymouth" },
            { name: "Primo Webcams", desc: "Live west-facing coastal cameras", url: "https://www.primo.nz/webcameras/" },
            { name: "NASA Worldview", desc: "True-colour satellite imagery — verify cloud cover", url: "https://worldview.earthdata.nasa.gov/?l=MODIS_Aqua_CorrectedReflectance_TrueColor" },
            { name: "Surf-Forecast Taranaki", desc: "Swell forecast verification", url: "https://www.surf-forecast.com/breaks/New-Plymouth/forecasts/latest" },
          ].map(({ name, desc, url }) => (
            <a key={name} className="ds-link-card" href={url} target="_blank" rel="noreferrer">
              <div className="ds-link-name">{name}</div>
              <div className="ds-link-desc">{desc}</div>
              <span className="ds-link-arrow">↗</span>
            </a>
          ))}
        </div>
      </div>

    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// Share helpers
// ══════════════════════════════════════════════════════════════════════════════

function getShareText(spotDataMap, regionLabel) {
  const entries = Object.entries(spotDataMap).filter(([,d]) => d?.score != null);
  if (!entries.length) return `Check out the ${regionLabel} Viz Forecast — spearfishing visibility predictions! 🐟🤿`;
  const best = entries.sort((a, b) => b[1].score - a[1].score)[0];
  const bestName = best[0].split("—")[0].trim();
  return `${regionLabel} Viz Forecast 🐟\nBest spot right now: ${bestName} — ${best[1].score}/100 (${scoreToLabel(best[1].score)})\nCheck conditions & log your dives:`;
}


// ══════════════════════════════════════════════════════════════════════════════
// SEASONAL CHART — pipeline-calibrated, region-aware
// ══════════════════════════════════════════════════════════════════════════════
function SeasonalPage({ region }) {
  const REGION = REGIONS[region];
  const currentMonth = new Date().getMonth(); // 0-indexed
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Regional overview data (clear% by month)
  const overview = REGION.seasonalChart;
  const spotSeasonal = REGION.spotSeasonal;
  const spots = Object.keys(spotSeasonal);

  // Colour helpers
  function clearColor(pct) {
    if (pct >= 75) return "#00e5a0";
    if (pct >= 60) return "#7dd64f";
    if (pct >= 50) return "#f0a030";
    return "#f07040";
  }
  function deltaColor(d) {
    if (d >= 10) return "#00e5a0";
    if (d >= 4)  return "#7dd64f";
    if (d >= -3) return "#8899aa";
    if (d >= -10) return "#f0a030";
    return "#f07040";
  }
  function deltaLabel(d) {
    if (d >= 10) return "Best";
    if (d >= 4)  return "Good";
    if (d >= -3) return "Avg";
    if (d >= -10) return "Poor";
    return "Worst";
  }

  return (
    <div style={{ padding: "0 0 3rem" }}>

      {/* ── Regional overview ─────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, padding: "1.4rem 1.6rem 1.2rem", marginBottom: "2rem",
      }}>
        <div style={{ fontSize: "1rem", fontWeight: 700, color: "#c8e0ea", marginBottom: 4 }}>
          📅 {REGION.label} — Regional Overview
        </div>
        <div style={{ fontSize: "0.72rem", color: "#4a7a8a", marginBottom: "1.2rem" }}>
          {REGION.seasonalNote}
        </div>

        {/* Overview bars */}
        <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80 }}>
          {overview.map((d, i) => {
            const isCurrent = i === currentMonth;
            const cc = clearColor(d.clear);
            return (
              <div key={d.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ fontSize: "0.6rem", color: cc, fontWeight: isCurrent ? 700 : 400 }}>{d.clear}%</div>
                <div style={{
                  width: "100%", height: `${d.clear * 0.55}px`,
                  background: `linear-gradient(to top, ${cc}cc, ${cc}33)`,
                  borderTop: `2px solid ${cc}`,
                  borderRadius: "3px 3px 0 0",
                  outline: isCurrent ? `2px solid ${cc}` : "none",
                  outlineOffset: 1,
                }} />
                <div style={{ fontSize: "0.58rem", color: isCurrent ? "#c8e0ea" : "#4a7a8a", fontWeight: isCurrent ? 700 : 400 }}>
                  {d.month}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.8rem" }}>
          {[["#00e5a0","75%+ clear"],["#7dd64f","60–75%"],["#f0a030","50–60%"],["#f07040","<50%"]].map(([c,l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.68rem", color: "#6a8a9a" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>

      {/* ── Per-spot seasonal patterns ────────────────────────────── */}
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#c8e0ea", marginBottom: "0.6rem", letterSpacing: "0.04em" }}>
        Per-Spot Monthly Patterns
      </div>
      <div style={{ fontSize: "0.72rem", color: "#4a7a8a", marginBottom: "1.4rem" }}>
        Delta vs annual average — how much better or worse each spot is in each month.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        {spots.map(spotName => {
          const deltas = spotSeasonal[spotName]; // { 1:val, 2:val, ... }
          const vals = Object.values(deltas);
          const maxAbs = Math.max(...vals.map(Math.abs), 1);
          // Find best and worst months
          const maxVal = Math.max(...vals);
          const minVal = Math.min(...vals);

          return (
            <div key={spotName} style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: "1rem 1.2rem 0.9rem",
            }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#c8e0ea", marginBottom: "0.8rem" }}>
                {spotName}
              </div>

              {/* Delta bars — centred on zero */}
              <div style={{ display: "flex", gap: 3, alignItems: "center", height: 64 }}>
                {MONTHS.map((month, i) => {
                  const d = deltas[i + 1] ?? 0;
                  const isCurrent = i === currentMonth;
                  const barH = Math.round((Math.abs(d) / maxAbs) * 28);
                  const isPos = d >= 0;
                  const dc = deltaColor(d);
                  return (
                    <div key={month} title={`${month}: ${d > 0 ? "+" : ""}${d} (${deltaLabel(d)})`}
                      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: 64, justifyContent: "center", position: "relative" }}>
                      {/* Positive bar (above centre) */}
                      <div style={{ height: 28, display: "flex", alignItems: "flex-end", width: "100%" }}>
                        {isPos && (
                          <div style={{
                            width: "100%", height: barH,
                            background: dc,
                            borderRadius: "2px 2px 0 0",
                            opacity: isCurrent ? 1 : 0.75,
                            outline: isCurrent ? `1px solid ${dc}` : "none",
                            outlineOffset: 1,
                          }} />
                        )}
                      </div>
                      {/* Centre line */}
                      <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.1)" }} />
                      {/* Negative bar (below centre) */}
                      <div style={{ height: 28, display: "flex", alignItems: "flex-start", width: "100%" }}>
                        {!isPos && (
                          <div style={{
                            width: "100%", height: barH,
                            background: dc,
                            borderRadius: "0 0 2px 2px",
                            opacity: isCurrent ? 1 : 0.75,
                            outline: isCurrent ? `1px solid ${dc}` : "none",
                            outlineOffset: 1,
                          }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Month labels */}
              <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                {MONTHS.map((month, i) => (
                  <div key={month} style={{
                    flex: 1, textAlign: "center",
                    fontSize: "0.55rem",
                    color: i === currentMonth ? "#c8e0ea" : "#3a5a6a",
                    fontWeight: i === currentMonth ? 700 : 400,
                  }}>{month}</div>
                ))}
              </div>

              {/* Best / worst callout */}
              <div style={{ display: "flex", gap: "1.2rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
                {[
                  { label: "Best", val: maxVal, months: MONTHS.filter((_,i) => deltas[i+1] === maxVal) },
                  { label: "Worst", val: minVal, months: MONTHS.filter((_,i) => deltas[i+1] === minVal) },
                ].map(({ label, val, months }) => (
                  <span key={label} style={{ fontSize: "0.68rem", color: "#4a7a8a" }}>
                    <span style={{ color: deltaColor(val), fontWeight: 600 }}>{label}:</span>{" "}
                    {months.join(", ")} ({val > 0 ? "+" : ""}{val})
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Delta legend ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "1.4rem" }}>
        {[["#00e5a0","+10 or more — significantly above avg"],["#7dd64f","+4 to +9 — above avg"],
          ["#8899aa","-3 to +3 — average"],["#f0a030","-4 to -9 — below avg"],["#f07040","-10 or worse — significantly below avg"]]
          .map(([c,l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.66rem", color: "#6a8a9a" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
      </div>
    </div>
  );
}

function ShareButtons({ spotDataMap, compact, regionLabel }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const text = getShareText(spotDataMap, regionLabel);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text + "\n" + shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch {}
  };
  const handleWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(text + "\n" + shareUrl)}`, "_blank"); };
  const handleSms = () => { window.open(`sms:?body=${encodeURIComponent(text + "\n" + shareUrl)}`, "_blank"); };
  const handleNativeShare = async () => { if (navigator.share) { try { await navigator.share({ title: `${regionLabel} Viz Forecast`, text, url: shareUrl }); } catch {} } };
  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  if (compact) {
    return (
      <div className="share-compact">
        <button className="share-btn share-whatsapp" onClick={handleWhatsApp} title="Share via WhatsApp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </button>
        <button className="share-btn share-sms" onClick={handleSms} title="Share via text">💬</button>
        <button className="share-btn share-copy" onClick={handleCopy} title="Copy link">{copied ? "✓" : "🔗"}</button>
        {hasNativeShare && (
          <button className="share-btn share-native" onClick={handleNativeShare} title="Share">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="share-panel">
      <div className="share-title">📤 SHARE WITH YOUR CREW</div>
      <div className="share-subtitle">More divers logging = better predictions for everyone</div>
      <div className="share-buttons">
        <button className="share-btn-full share-whatsapp" onClick={handleWhatsApp}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </button>
        <button className="share-btn-full share-sms" onClick={handleSms}>💬 Text</button>
        <button className="share-btn-full share-copy" onClick={handleCopy}>{copied ? "✓ Copied!" : "🔗 Copy Link"}</button>
        {hasNativeShare && (
          <button className="share-btn-full share-native" onClick={handleNativeShare}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            Share
          </button>
        )}
      </div>
    </div>
  );
}

// ── Welcome banner ─────────────────────────────────────────────────────────────
function WelcomeBanner({ onDismiss, onSetName, onSetEmail, diverName, regionLabel }) {
  const [name, setName] = useState(diverName || "");
  const [email, setEmail] = useState("");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const handleJoin = () => {
    if (name.trim()) onSetName(name.trim());
    if (email.trim()) onSetEmail(email.trim());
    setDismissed(true);
    onDismiss();
  };
  return (
    <div className="welcome-banner">
      <div className="welcome-glow" />
      <div className="welcome-content">
        <div className="welcome-icon">🤿</div>
        <h2 className="welcome-title">Welcome to the {regionLabel} Viz Forecast</h2>
        <p className="welcome-desc">
          Real-time spearfishing visibility predictions for 6 spots around the Taranaki coast.
          Scores combine swell, wind, rain history, ocean currents, SST, and satellite turbidity data.
        </p>
        <div className="welcome-features">
          <div className="wf-item"><span className="wf-icon">📊</span><span>Live conditions & 7-day forecasts per spot</span></div>
          <div className="wf-item"><span className="wf-icon">🎯</span><span>Best dive day recommendation</span></div>
          <div className="wf-item"><span className="wf-icon">🛰️</span><span>Satellite turbidity integrated into scores</span></div>
          <div className="wf-item"><span className="wf-icon">🤝</span><span>Community-calibrated model — more logs = better accuracy</span></div>
        </div>
        <div className="welcome-join">
          <input type="text" className="welcome-name-input" placeholder="Your name (for dive logs)"
            value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJoin()} />
          <input type="email" className="welcome-name-input" placeholder="Email — get notified when new spots are added (optional)"
            value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJoin()}
            style={{ marginTop: "0.5rem" }} />
          <button className="welcome-go-btn" onClick={handleJoin}>{name.trim() ? "Let's Go 🐟" : "Skip for Now"}</button>
        </div>
        <div className="welcome-hint">Email is optional and never shared — only used for app updates</div>
      </div>
    </div>
  );
}

// ── Community log panel ───────────────────────────────────────────────────────
function CommunityLogPanel({ logs, logStatus, spotName }) {
  const [expanded, setExpanded] = useState(false);
  const spotLogs = spotName ? logs.filter(e => e.spot === spotName).slice(0, expanded ? 20 : 4) : logs.slice(0, expanded ? 50 : 8);
  const title = spotName ? "COMMUNITY OBSERVATIONS" : "RECENT COMMUNITY OBSERVATIONS";
  if (logStatus === "unconfigured") return (
    <div className="community-panel unconfigured"><div className="cp-title">🌐 {title}</div><div className="cp-unconfigured">⚙️ Configure Supabase to enable shared logging.</div></div>
  );
  if (logStatus === "loading") return (<div className="community-panel"><div className="cp-title">🌐 {title}</div><div className="loading-bar"><div className="loading-fill"/></div></div>);
  if (logStatus === "error") return (<div className="community-panel"><div className="cp-title">🌐 {title}</div><div style={{color:"#e06040",fontSize:"0.75rem"}}>Could not connect to database.</div></div>);
  const allSpotLogs = spotName ? logs.filter(e => e.spot === spotName) : logs;
  const bias = spotName ? spotBiasMultiplier(spotName, logs) : null;
  return (
    <div className="community-panel">
      <div className="cp-header">
        <div className="cp-title">🌐 {title}</div>
        {bias != null && (
          <div className="cp-bias" style={{color: bias > 1.05 ? "#00e5a0" : bias < 0.95 ? "#f07040" : "#607d8b"}}>
            {bias > 1.05 ? `↑ Under-predicts ~${Math.round((bias-1)*100)}%` : bias < 0.95 ? `↓ Over-predicts ~${Math.round((1-bias)*100)}%` : "≈ Accuracy good"}
          </div>
        )}
      </div>
      {allSpotLogs.length === 0 && logStatus === "ok" && <div style={{color:"#3a6070",fontSize:"0.75rem",padding:"0.4rem 0"}}>No observations yet — be the first!</div>}
      {spotLogs.map((e, i) => (
        <div key={e.id || i} className="cp-row">
          <span className="cp-diver">🤿 {e.diver_name}</span>
          <span className="cp-date">{e.date}</span>
          <span className="cp-vis" style={{color: scoreToColor(Math.round((e.observed_vis ?? e.observedVis ?? 0) * 10))}}>{e.observed_vis ?? e.observedVis}m</span>
          <span className="cp-tide">{e.tide} tide</span>
          <span className="cp-model">model: {e.model_score ?? e.modelScore}</span>
          {e.notes && <span className="cp-note" title={e.notes}>📝</span>}
        </div>
      ))}
      {allSpotLogs.length > (spotName ? 4 : 8) && (
        <button className="cp-more" onClick={() => setExpanded(e => !e)}>{expanded ? "Show less" : `Show all ${allSpotLogs.length} observations`}</button>
      )}
    </div>
  );
}

// ── Community stats ───────────────────────────────────────────────────────────
function CommunityStats({ logs, logStatus }) {
  if (logStatus !== "ok" || logs.length === 0) return null;
  const totalDivers = new Set(logs.map(l => l.diver_name)).size;
  const avgVis = (logs.reduce((a, l) => a + (l.observed_vis ?? l.observedVis ?? 0), 0) / logs.length).toFixed(1);
  const recentLogs = logs.slice(0, 5);
  return (
    <div className="community-stats">
      <div className="cs-item"><span className="cs-val">{logs.length}</span><span className="cs-key">Total Dives Logged</span></div>
      <div className="cs-item"><span className="cs-val">{totalDivers}</span><span className="cs-key">Community Divers</span></div>
      <div className="cs-item"><span className="cs-val">{avgVis}m</span><span className="cs-key">Avg Observed Vis</span></div>
      <div className="cs-item"><span className="cs-val" style={{fontSize:"0.8rem",color:"#6ab4c8"}}>{recentLogs[0] ? `${recentLogs[0].diver_name} · ${recentLogs[0].date}` : "—"}</span><span className="cs-key">Most Recent</span></div>
    </div>
  );
}

// ── Growth nudge ──────────────────────────────────────────────────────────────
function GrowthNudge({ logs, spotDataMap, regionLabel, spots }) {
  const totalDivers = new Set(logs.map(l => l.diver_name)).size;
  const totalLogs = logs.length;
  const spotsWithData = spots.filter(s => logs.filter(l => l.spot === s.name).length >= 2).length;
  return (
    <div className="growth-nudge">
      <div className="gn-header"><span className="gn-title">📈 Community Data Health</span></div>
      <div className="gn-stats">
        <div className="gn-stat"><div className="gn-stat-val">{totalDivers}</div><div className="gn-stat-label">Divers</div></div>
        <div className="gn-stat"><div className="gn-stat-val">{totalLogs}</div><div className="gn-stat-label">Observations</div></div>
        <div className="gn-stat"><div className="gn-stat-val">{spotsWithData}/{spots.length}</div><div className="gn-stat-label">Spots Calibrated</div></div>
      </div>
      <div className="gn-meter">
        <div className="gn-meter-label">Model calibration: {totalLogs < 10 ? "Early days" : totalLogs < 30 ? "Getting better" : totalLogs < 100 ? "Good data" : "Strong calibration"}</div>
        <div className="gn-meter-bar"><div className="gn-meter-fill" style={{ width: `${Math.min(100, (totalLogs / 100) * 100)}%` }} /></div>
        <div className="gn-meter-hint">{totalLogs < 30 ? `${30 - totalLogs} more observations for solid calibration` : totalLogs < 100 ? `${100 - totalLogs} more for high-confidence predictions` : "Great coverage — well-calibrated"}</div>
      </div>
      <ShareButtons spotDataMap={spotDataMap} regionLabel={regionLabel} compact={false} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [region, setRegion] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("region") === "kapiti" ? "kapiti" : "taranaki";
    } catch(e) { return "taranaki"; }
  });
  const REGION = REGIONS[region];
  const SPOTS = REGION.spots;
  const W = REGION.W;

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("region", region);
      window.history.replaceState({}, "", url);
    } catch(e) {}
  }, [region]);

  const now = new Date().toLocaleDateString("en-NZ", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Pacific/Auckland"
  });

  const [logEntries, setLogEntries] = useState(() => loadLog());
  const [activePage, setActivePage] = useState("forecast");
  const [diverName, setDiverName] = useState(() => {
    try { return sessionStorage.getItem("taranaki_diver_name") || ""; } catch { return ""; }
  });
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return !sessionStorage.getItem("taranaki_welcomed"); } catch { return true; }
  });

  const { logs: communityLogs, logStatus, addLog: addCommunityLog, refresh: refreshLogs, isConfigured } = useCommunityLogs();

  const allLogs = useMemo(() => {
    const ids = new Set(communityLogs.map(l => l.id));
    const localOnly = logEntries.filter(l => !ids.has(l.id));
    return [...communityLogs, ...localOnly];
  }, [communityLogs, logEntries]);

  // CHANGE 5: Destructure satData and satStatus from hook
  const {
    spotDataMap,
    loading,
    errors,
    currentData,
    currentStatus,
    satData,
    satStatus,
    webcamData,
    webcamStatus,
    riverData,
    riverStatus,
  } = useAllSpotsData(logEntries, SPOTS, W, region);

  const spotScores = useMemo(() => {
    const s = {};
    for (const [name, data] of Object.entries(spotDataMap)) {
      if (data?.score != null) s[name] = data.score;
    }
    return s;
  }, [spotDataMap]);

  const handleLogUpdate = (updated) => {
    setLogEntries(updated);
  };

  const handleCommunitySave = useCallback(async (entry) => {
    if (entry.diver_name && entry.diver_name !== diverName) {
      setDiverName(entry.diver_name);
      try { sessionStorage.setItem("taranaki_diver_name", entry.diver_name); } catch {}
    }
    await addCommunityLog(entry);
    refreshLogs();
  }, [addCommunityLog, refreshLogs, diverName]);

  const handleWelcomeDismiss = useCallback(() => {
    try { sessionStorage.setItem("taranaki_welcomed", "1"); } catch {}
  }, []);

  const handleSetName = useCallback((name) => {
    setDiverName(name);
    try { sessionStorage.setItem("taranaki_diver_name", name); } catch {}
  }, []);

  const handleSetEmail = useCallback(async (email) => {
    // Upsert into users table — creates record if new, updates if email already exists
    // is_pro defaults to false in the DB schema
    try {
      await supaFetch("/users", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          name: diverName || null,
          region: region,
          joined_at: new Date().toISOString(),
        }),
      });
    } catch (e) {
      // Silent fail — email capture is best-effort
      console.warn("[Users] Failed to save email:", e.message);
    }
  }, [diverName, region]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #040d14; color: #c8d8e8; font-family: 'Syne', sans-serif; min-height: 100vh; }
        .app { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }

        header { text-align: center; padding: 2.5rem 0 2rem; position: relative; }
        .fish-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
        .wave-line { position: absolute; width: 200%; height: 2px; background: linear-gradient(90deg, transparent, rgba(0,180,140,0.15), transparent); animation: wave 8s linear infinite; }
        .wave-line:nth-child(1) { top: 20%; }
        .wave-line:nth-child(2) { top: 50%; animation-delay: -3s; opacity: 0.6; }
        .wave-line:nth-child(3) { top: 80%; animation-delay: -6s; opacity: 0.3; }
        @keyframes wave { 0% { transform: translateX(-50%); } 100% { transform: translateX(0%); } }
        header h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 800; background: linear-gradient(135deg, #00e5a0 0%, #00b4d8 60%, #90e0ef 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; letter-spacing: -1px; position: relative; z-index: 1; }
        header .subtitle { color: #4a8fa0; font-size: 0.9rem; letter-spacing: 0.2em; text-transform: uppercase; margin-top: 0.4rem; position: relative; z-index: 1; }
        header .date { color: #2a5a6a; font-family: 'Space Mono', monospace; font-size: 0.75rem; margin-top: 0.5rem; position: relative; z-index: 1; }

        .tagline { text-align: center; color: #4a7a8a; font-size: 0.85rem; margin: -0.5rem auto 1.5rem; padding: 0.8rem 1.5rem; background: rgba(0,180,140,0.04); border: 1px solid rgba(0,180,140,0.1); border-radius: 8px; max-width: 640px; }

        .advice-panel { margin-bottom: 1.5rem; padding: 1rem 1.2rem; background: rgba(0,70,50,0.15); border: 1px solid rgba(0,180,140,0.15); border-radius: 12px; display: flex; flex-direction: column; gap: 0.5rem; }
        .advice-tip { display: flex; gap: 0.6rem; font-size: 0.82rem; color: #7ab8c8; line-height: 1.5; }
        .advice-emoji { flex-shrink: 0; font-size: 1rem; }

        .best-day-panel { display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 2rem; padding: 1.2rem 1.5rem; background: linear-gradient(135deg, rgba(0,229,160,0.05), rgba(0,180,216,0.03)); border: 1px solid rgba(255,255,255,0.07); border-left: 4px solid var(--best-color, #00e5a0); border-radius: 12px; animation: fadeIn 0.5s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
        .best-day-icon { font-size: 2rem; line-height: 1; flex-shrink: 0; padding-top: 0.2rem; }
        .best-day-content { flex: 1; }
        .best-day-title { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.18em; color: #3a6a7a; margin-bottom: 0.25rem; font-family: 'Space Mono', monospace; }
        .best-day-date { font-size: 1.4rem; font-weight: 800; margin-bottom: 0.2rem; }
        .best-day-avg { font-size: 0.78rem; color: #4a7a8a; margin-bottom: 0.6rem; }
        .best-day-spots { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .best-spot-chip { font-size: 0.68rem; padding: 0.2rem 0.6rem; border: 1px solid; border-radius: 20px; background: rgba(0,0,0,0.2); white-space: nowrap; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }

        .spot-card { background: linear-gradient(135deg, #0a1a26, #081520); border: 1px solid rgba(255,255,255,0.06); border-top: 2px solid var(--accent, #00e5a0); border-radius: 12px; padding: 1.4rem; transition: transform 0.2s, box-shadow 0.2s; position: relative; overflow: hidden; }
        .spot-card::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 50% 0%, rgba(0,200,150,0.04), transparent 70%); pointer-events: none; }
        .spot-card:hover { transform: translateY(-3px); box-shadow: 0 8px 30px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,200,150,0.1); }

        .spot-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.8rem; }
        .spot-header h3 { font-size: 1.05rem; font-weight: 700; color: #e0f0f8; flex: 1; }
        .expand-arrow { color: #2a5a6a; font-size: 0.65rem; padding: 0.15rem 0.4rem; border: 1px solid #1a3a4a; border-radius: 4px; user-select: none; }
        .river-tag { font-size: 0.62rem; font-family: 'Space Mono', monospace; color: #607d8b; background: rgba(96,125,139,0.1); border: 1px solid rgba(96,125,139,0.2); padding: 0.15rem 0.4rem; border-radius: 4px; text-transform: uppercase; }

        .gauge-svg { width: 100%; max-width: 160px; display: block; margin: 0 auto; }
        .viz-label { text-align: center; font-size: 1.1rem; font-weight: 700; margin: 0.3rem 0 0.8rem; }
        .conditions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.45rem; margin-bottom: 0.8rem; }
        .cond { display: flex; flex-direction: column; align-items: center; text-align: center; background: rgba(255,255,255,0.03); border-radius: 8px; padding: 0.5rem 0.3rem; gap: 0.15rem; }
        .cond-icon { font-size: 0.9rem; }
        .cond-val { font-family: 'Space Mono', monospace; font-size: 0.72rem; color: #b0d0e0; font-weight: 700; }
        .cond-key { font-size: 0.55rem; color: #3a6a7a; text-transform: uppercase; letter-spacing: 0.06em; }

        .factors-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; margin-bottom: 0.8rem; }
        .factor { background: rgba(0,0,0,0.2); border-radius: 7px; padding: 0.4rem 0.3rem; text-align: center; }
        .factor-key { font-size: 0.55rem; color: #3a5a6a; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.1rem; }
        .factor-val { font-family: 'Space Mono', monospace; font-size: 0.78rem; font-weight: 700; }

        .spot-note { font-size: 0.72rem; color: #3a6070; line-height: 1.5; margin-bottom: 0.6rem; padding: 0.5rem 0.6rem; background: rgba(0,0,0,0.15); border-radius: 6px; border-left: 2px solid #1a3a4a; }
        .warning { margin-top: 0.6rem; font-size: 0.72rem; color: #c08020; background: rgba(200,130,0,0.08); border: 1px solid rgba(200,130,0,0.2); border-radius: 6px; padding: 0.5rem 0.7rem; }

        .forecast-bar { margin-top: 1.2rem; }
        .forecast-label-row { font-size: 0.58rem; font-family: 'Space Mono', monospace; color: #2a5a6a; letter-spacing: 0.15em; margin-bottom: 0.5rem; }
        .forecast-days { display: flex; gap: 0.3rem; height: 90px; align-items: flex-end; }
        .forecast-day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; height: 100%; cursor: default; }
        .forecast-day:hover .fday-bar { filter: brightness(1.3); }
        .fday-name { font-size: 0.54rem; color: #4a7a8a; font-family: 'Space Mono', monospace; white-space: nowrap; }
        .fday-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
        .fday-bar { width: 100%; min-height: 3px; border-radius: 3px 3px 0 0; transition: height 1s ease, filter 0.2s; }
        .fday-score { font-size: 0.6rem; font-family: 'Space Mono', monospace; font-weight: 700; }
        .fday-swell { font-size: 0.5rem; color: #2a4a5a; }

        .wind-forecast-bar { margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px solid rgba(255,255,255,0.04); }
        .wind-forecast-label { font-size: 0.58rem; font-family: 'Space Mono', monospace; color: #2a5a6a; letter-spacing: 0.15em; margin-bottom: 0.5rem; }
        .wind-forecast-days { display: flex; gap: 0.3rem; height: 100px; align-items: flex-end; }
        .wf-day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; height: 100%; cursor: default; position: relative; }
        .wf-day:hover .wf-bar { filter: brightness(1.3); }
        .wf-day-name { font-size: 0.54rem; color: #4a7a8a; font-family: 'Space Mono', monospace; white-space: nowrap; }
        .wf-arrow { font-size: 0.9rem; line-height: 1; transition: transform 0.3s ease; }
        .wf-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
        .wf-bar { width: 100%; min-height: 3px; border-radius: 3px 3px 0 0; transition: height 1s ease, filter 0.2s; }
        .wf-speed { font-size: 0.62rem; font-family: 'Space Mono', monospace; font-weight: 700; }
        .wf-dir { font-size: 0.48rem; color: #3a6a7a; font-family: 'Space Mono', monospace; }
        .wf-nw-badge { font-size: 0.55rem; position: absolute; top: -2px; right: -2px; }
        
        /* ── Region Switcher ── */
        .region-switcher { display: flex; justify-content: center; gap: 0; margin: 0 auto 1.2rem; border: 1px solid rgba(0,229,160,0.2); border-radius: 10px; overflow: hidden; max-width: 340px; }
        .region-btn { flex: 1; padding: 0.55rem 1rem; background: transparent; border: none; color: #4a8a9a; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.05em; cursor: pointer; transition: all 0.2s; }
        .region-btn:hover { background: rgba(0,229,160,0.08); color: #00e5a0; }
        .region-btn.active { background: rgba(0,229,160,0.15); color: #00e5a0; border-bottom: 2px solid #00e5a0; }
        .region-btn + .region-btn { border-left: 1px solid rgba(0,229,160,0.15); }
        /* ── Seasonal chart (shared) ── */
        .seasonal-chart-wrap { background: rgba(0,20,40,0.7); border: 1px solid rgba(0,229,160,0.12); border-radius: 12px; padding: 1.2rem 1.4rem 1rem; margin: 1.5rem 0; }
        .seasonal-chart-title { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; color: #00e5a0; margin-bottom: 0.2rem; }
        .seasonal-chart-sub { display: block; font-size: 0.6rem; color: #4a7a8a; font-weight: 400; letter-spacing: 0.04em; margin-top: 0.1rem; margin-bottom: 0.8rem; }
        .seasonal-chart-body { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; height: 100px; align-items: end; }
        .seasonal-col { display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: default; }
        .seasonal-col-current .seasonal-bar-wrap { outline: 1px solid rgba(0,229,160,0.4); border-radius: 3px; }
        .seasonal-bar-wrap { width: 100%; height: 70px; display: flex; flex-direction: column; justify-content: flex-end; position: relative; border-radius: 3px; }
        .seasonal-bar-clear { width: 100%; border-radius: 3px 3px 0 0; min-height: 2px; }
        .seasonal-blue-dot { position: absolute; left: 50%; transform: translateX(-50%); width: 6px; height: 6px; border-radius: 50%; background: #4fc3f7; border: 1px solid rgba(79,195,247,0.8); }
        .seasonal-pct { font-size: 0.5rem; color: #5a8a9a; text-align: center; margin-top: 2px; }
        .seasonal-month { font-size: 0.55rem; color: #3a5a6a; text-align: center; }
        .seasonal-month-now { color: #00e5a0 !important; font-weight: 700; }
        .seasonal-chart-legend { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.7rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.05); }
        .seasonal-legend-item { display: flex; align-items: center; gap: 4px; font-size: 0.58rem; color: #4a6a7a; }
        .seasonal-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
        .seasonal-blue-legend { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4fc3f7; border: 1px solid rgba(79,195,247,0.8); }

        .wf-legend { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.4rem; font-size: 0.52rem; font-family: 'Space Mono', monospace; }

        .expanded-table { margin-top: 1rem; overflow-x: auto; }
        .expanded-table table { width: 100%; border-collapse: collapse; font-size: 0.73rem; }
        .expanded-table th { color: #2a5a6a; font-family: 'Space Mono', monospace; font-size: 0.57rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.4rem 0.4rem; border-bottom: 1px solid #0d2030; text-align: left; }
        .expanded-table td { padding: 0.35rem 0.4rem; border-bottom: 1px solid #081820; color: #7aa0b0; }
        .expanded-table tr:last-child td { border-bottom: none; }
        .expanded-table tr:hover td { background: rgba(255,255,255,0.02); }

        .loading-bar { height: 3px; background: #0a1e2e; border-radius: 2px; overflow: hidden; margin: 1.5rem 0; }
        .loading-fill { height: 100%; background: linear-gradient(90deg, #00e5a0, #00b4d8); animation: load 1.5s ease-in-out infinite; }
        @keyframes load { 0% { width: 0%; margin-left: 0; } 50% { width: 60%; margin-left: 20%; } 100% { width: 0%; margin-left: 100%; } }
        .error { color: #e04040; font-size: 0.8rem; padding: 1rem 0; text-align: center; }

        .legend { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; justify-content: center; margin: 2.5rem 0 0; padding: 1.2rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; }
        .legend-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .legend-label { font-weight: 700; color: #c0d8e8; }
        .legend-sub { color: #3a6070; }

        .info-panel { margin-top: 2rem; padding: 1.2rem 1.5rem; background: rgba(0,180,200,0.04); border: 1px solid rgba(0,180,200,0.1); border-radius: 10px; font-size: 0.8rem; color: #4a7a8a; line-height: 1.7; }
        .info-panel strong { color: #6ab4c8; }
        footer { text-align: center; margin-top: 3rem; font-size: 0.7rem; color: #1e3a4a; font-family: 'Space Mono', monospace; }

        .page-nav { display: flex; gap: 0.5rem; justify-content: center; margin: 0 auto 1.5rem; max-width: 500px; }
        .page-nav-btn { flex: 1; padding: 0.7rem 1rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: #4a7a8a; font-family: 'Syne', sans-serif; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.2s; letter-spacing: 0.02em; }
        .page-nav-btn:hover { background: rgba(0,180,140,0.06); border-color: rgba(0,180,140,0.2); color: #6ab4c8; }
        .page-nav-btn.active { background: rgba(0,180,140,0.1); border-color: rgba(0,229,160,0.3); color: #00e5a0; box-shadow: 0 0 20px rgba(0,229,160,0.08); }

        .ds-page { animation: fadeIn 0.4s ease; }
        .ds-hero { text-align: center; margin-bottom: 2rem; padding: 1.5rem 0; }
        .ds-hero-icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
        .ds-hero-title { font-size: 1.6rem; font-weight: 800; background: linear-gradient(135deg, #00e5a0, #00b4d8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 0.3rem; }
        .ds-hero-sub { color: #4a7a8a; font-size: 0.85rem; }

        .ds-alert { display: flex; gap: 0.8rem; padding: 1rem 1.2rem; background: rgba(240,160,48,0.06); border: 1px solid rgba(240,160,48,0.2); border-left: 4px solid #f0a030; border-radius: 10px; margin-bottom: 2rem; }
        .ds-alert-icon { font-size: 1.3rem; flex-shrink: 0; padding-top: 0.1rem; }
        .ds-alert-content { font-size: 0.82rem; color: #9ab0c0; line-height: 1.65; }
        .ds-alert-title { font-weight: 700; color: #f0a030; margin-bottom: 0.3rem; font-size: 0.9rem; }
        .ds-alert-content code { background: rgba(0,0,0,0.3); padding: 0.1rem 0.35rem; border-radius: 4px; font-family: 'Space Mono', monospace; font-size: 0.75rem; color: #f0c040; }

        .ds-section { margin-bottom: 2.5rem; }
        .ds-section-title { font-size: 1.15rem; font-weight: 700; color: #c8e0f0; margin-bottom: 0.4rem; }
        .ds-section-desc { font-size: 0.82rem; color: #4a7a8a; line-height: 1.6; margin-bottom: 1.2rem; }
        .ds-section-desc strong { color: #6ab4c8; }

        .ds-sources { display: flex; flex-direction: column; gap: 1rem; }
        .ds-source-card { background: linear-gradient(135deg, #0a1a26, #081520); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; transition: transform 0.2s; }
        .ds-source-card:hover { transform: translateY(-2px); }
        .ds-source-header { display: flex; align-items: center; gap: 0.8rem; padding: 1rem 1.2rem 0.6rem; }
        .ds-source-icon { font-size: 1.6rem; flex-shrink: 0; }
        .ds-source-name { font-weight: 700; color: #c8e0f0; font-size: 0.95rem; }
        .ds-source-url { font-family: 'Space Mono', monospace; font-size: 0.68rem; color: #2a6a8a; text-decoration: none; word-break: break-all; }
        .ds-source-url:hover { color: #00e5a0; }
        .ds-source-body { padding: 0 1.2rem 1rem; }
        .ds-source-row { display: flex; gap: 0.5rem; padding: 0.3rem 0; font-size: 0.78rem; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .ds-row-label { color: #3a6a7a; font-family: 'Space Mono', monospace; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; min-width: 75px; flex-shrink: 0; padding-top: 0.1rem; }
        .ds-row-val { color: #8ab0c0; flex: 1; }
        .ds-source-notes { margin-top: 0.6rem; font-size: 0.78rem; color: #4a7a8a; line-height: 1.55; padding: 0.6rem 0.8rem; background: rgba(0,0,0,0.2); border-radius: 6px; border-left: 2px solid #1a3a4a; }
        .ds-source-windwarn { margin-top: 0.5rem; font-size: 0.75rem; color: #f0a030; padding: 0.4rem 0.6rem; background: rgba(240,160,48,0.06); border-radius: 6px; border: 1px solid rgba(240,160,48,0.15); }

        .ds-coords-table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06); }
        .ds-coords-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
        .ds-coords-table th { background: #0a1e2e; color: #3a7a8a; font-family: 'Space Mono', monospace; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.6rem 0.6rem; text-align: left; border-bottom: 1px solid #0d2030; white-space: nowrap; }
        .ds-coords-table td { padding: 0.5rem 0.6rem; border-bottom: 1px solid #081820; color: #7aa0b0; }
        .ds-coords-table tr:hover td { background: rgba(0,180,140,0.03); }
        .ds-coord-name { font-weight: 700; color: #b0d0e0; white-space: nowrap; font-size: 0.72rem; }
        .ds-coord-num { font-family: 'Space Mono', monospace; font-size: 0.68rem; white-space: nowrap; }
        .ds-coord-note { font-size: 0.68rem; color: #4a7a8a; }
        .ds-params-table td { text-align: center; font-family: 'Space Mono', monospace; font-size: 0.72rem; font-weight: 700; }
        .ds-params-table td:first-child { text-align: left; }

        .ds-weights-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.8rem; }
        .ds-weight-card { background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; padding: 0.8rem; text-align: center; }
        .ds-weight-val { font-family: 'Space Mono', monospace; font-size: 1.3rem; font-weight: 700; color: #00e5a0; margin-bottom: 0.2rem; }
        .ds-weight-label { font-size: 0.72rem; font-weight: 700; color: #b0d0e0; margin-bottom: 0.2rem; }
        .ds-weight-desc { font-size: 0.65rem; color: #4a7a8a; line-height: 1.4; }

        .ds-validation-items { display: flex; flex-direction: column; gap: 0.8rem; }
        .ds-val-item { display: flex; gap: 0.8rem; padding: 1rem 1.2rem; background: linear-gradient(135deg, #0a1a26, #081520); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; }
        .ds-val-icon { font-size: 1.3rem; flex-shrink: 0; padding-top: 0.1rem; }
        .ds-val-title { font-weight: 700; color: #c8e0f0; font-size: 0.88rem; margin-bottom: 0.25rem; }
        .ds-val-text { font-size: 0.78rem; color: #6a9aaa; line-height: 1.6; }

        .ds-links-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.7rem; }
        .ds-link-card { display: block; padding: 0.8rem 1rem; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; text-decoration: none; transition: all 0.2s; position: relative; }
        .ds-link-card:hover { border-color: rgba(0,229,160,0.3); transform: translateY(-2px); background: rgba(0,180,140,0.06); }
        .ds-link-name { font-weight: 700; color: #b0d0e0; font-size: 0.82rem; margin-bottom: 0.2rem; }
        .ds-link-desc { font-size: 0.68rem; color: #4a7a8a; }
        .ds-link-arrow { position: absolute; top: 0.6rem; right: 0.8rem; color: #2a5a6a; font-size: 0.85rem; }
        .ds-link-card:hover .ds-link-arrow { color: #00e5a0; }

        .ds-api-examples { display: flex; flex-direction: column; gap: 0.8rem; }
        .ds-api-block { padding: 0.8rem 1rem; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; }
        .ds-api-spot { font-weight: 700; color: #b0d0e0; font-size: 0.82rem; margin-bottom: 0.4rem; }
        .ds-api-label { font-size: 0.65rem; color: #3a6a7a; font-family: 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.15rem; }
        .ds-api-url { font-family: 'Space Mono', monospace; font-size: 0.62rem; color: #2a6a8a; word-break: break-all; text-decoration: none; display: block; }
        .ds-api-url:hover { color: #00e5a0; }

        .data-status-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.8rem; margin: 0.75rem 0; background: rgba(0,20,40,0.5); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; flex-wrap: wrap; font-size: 0.65rem; font-family: 'Space Mono', monospace; }
        .data-status-label { color: #4a7a8a; font-weight: 700; font-size: 0.6rem; text-transform: uppercase; margin-right: 0.3rem; }
        .data-status-pill { padding: 0.2rem 0.5rem; border-radius: 4px; white-space: nowrap; }
        .data-status-pill.ok { background: rgba(0,229,160,0.1); color: #00e5a0; border: 1px solid rgba(0,229,160,0.2); }
        .data-status-pill.warn { background: rgba(240,192,64,0.1); color: #f0c040; border: 1px solid rgba(240,192,64,0.2); }
        .data-status-pill.fail { background: rgba(224,96,64,0.1); color: #e06040; border: 1px solid rgba(224,96,64,0.2); }
        .data-status-pill.wait { background: rgba(100,140,160,0.1); color: #6a8a9a; border: 1px solid rgba(100,140,160,0.15); }

        .log-btn { display: block; width: 100%; margin: 0.5rem 0 0.8rem; padding: 0.4rem; background: rgba(0,180,140,0.06); border: 1px dashed rgba(0,180,140,0.25); border-radius: 7px; color: #3a8a7a; font-size: 0.72rem; cursor: pointer; font-family: 'Syne', sans-serif; letter-spacing: 0.05em; }
        .log-btn:hover { background: rgba(0,180,140,0.12); color: #00e5a0; border-color: rgba(0,180,140,0.5); }

        .bias-indicator { font-size: 0.6rem; font-family: 'Space Mono', monospace; color: #607d8b; margin-left: 0.4rem; opacity: 0.8; }

        .spot-history { margin: 0.8rem 0; padding: 0.7rem 0.8rem; background: rgba(0,0,0,0.2); border-radius: 8px; border-left: 2px solid #1a3a4a; }
        .history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.3rem; }
        .history-title { font-size: 0.58rem; font-family: 'Space Mono', monospace; color: #2a5a6a; text-transform: uppercase; letter-spacing: 0.1em; }
        .history-bias { font-size: 0.62rem; font-family: 'Space Mono', monospace; }
        .history-row { display: flex; gap: 0.6rem; align-items: center; font-size: 0.72rem; padding: 0.2rem 0; border-bottom: 1px solid #081820; }
        .history-row:last-child { border-bottom: none; }
        .history-date { color: #3a6070; font-family: 'Space Mono', monospace; font-size: 0.65rem; min-width: 80px; }
        .history-vis { color: #00e5a0; font-weight: 700; font-family: 'Space Mono', monospace; min-width: 36px; }
        .history-tide { color: #4a7a8a; font-size: 0.65rem; }
        .history-note { cursor: pointer; }

        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
        .modal { background: #0a1a26; border: 1px solid #1a3a4a; border-radius: 14px; padding: 1.5rem; width: 100%; max-width: 380px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; font-weight: 700; color: #c8d8e8; }
        .modal-close { background: none; border: none; color: #4a7a8a; cursor: pointer; font-size: 1.1rem; padding: 0.2rem; }
        .modal-spot { font-size: 0.75rem; color: #3a7a8a; margin-bottom: 1rem; font-family: 'Space Mono', monospace; }
        .modal-field { margin-bottom: 0.9rem; }
        .modal-field label { display: block; font-size: 0.72rem; color: #4a7a8a; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.35rem; }
        .modal-field input, .modal-field textarea { width: 100%; background: #040d14; border: 1px solid #1a3a4a; border-radius: 8px; padding: 0.6rem 0.8rem; color: #c8d8e8; font-size: 0.9rem; font-family: 'Syne', sans-serif; }
        .modal-field input:focus, .modal-field textarea:focus { outline: none; border-color: #2a6a5a; }
        .modal-field textarea { resize: none; }
        .tide-buttons { display: flex; gap: 0.5rem; }
        .tide-btn { flex: 1; padding: 0.5rem; background: #040d14; border: 1px solid #1a3a4a; border-radius: 7px; color: #4a7a8a; cursor: pointer; font-family: 'Syne', sans-serif; font-size: 0.85rem; }
        .tide-btn.active { background: rgba(0,180,140,0.12); border-color: #2a8a7a; color: #00e5a0; font-weight: 700; }
        .modal-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; }
        .modal-score { font-size: 0.7rem; color: #3a6070; font-family: 'Space Mono', monospace; }
        .modal-save { padding: 0.6rem 1.4rem; background: #1a4a3a; border: 1px solid #2a8a6a; border-radius: 8px; color: #00e5a0; font-weight: 700; cursor: pointer; font-family: 'Syne', sans-serif; font-size: 0.9rem; }
        .modal-save:hover { background: #1f5a46; }
        .modal-save:disabled { opacity: 0.5; cursor: wait; }

        .share-compact { display: flex; gap: 0.4rem; justify-content: center; margin-top: 0.8rem; position: relative; z-index: 1; }
        .share-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(0,180,140,0.2); background: rgba(0,180,140,0.06); color: #4a9a8a; cursor: pointer; font-size: 0.85rem; transition: all 0.2s; }
        .share-btn:hover { background: rgba(0,180,140,0.15); border-color: rgba(0,180,140,0.4); color: #00e5a0; transform: scale(1.1); }
        .share-btn.share-whatsapp:hover { background: rgba(37,211,102,0.15); border-color: rgba(37,211,102,0.4); color: #25d366; }
        .share-panel { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(0,180,140,0.1); }
        .share-title { font-size: 0.6rem; font-family: 'Space Mono',monospace; color: #2a6a5a; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 0.2rem; }
        .share-subtitle { font-size: 0.72rem; color: #4a7a8a; margin-bottom: 0.7rem; }
        .share-buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .share-btn-full { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid rgba(0,180,140,0.2); background: rgba(0,180,140,0.06); color: #6ab4c8; cursor: pointer; font-family: 'Syne',sans-serif; font-size: 0.8rem; font-weight: 600; transition: all 0.2s; }
        .share-btn-full:hover { background: rgba(0,180,140,0.12); border-color: rgba(0,180,140,0.35); color: #00e5a0; }
        .share-btn-full.share-whatsapp { border-color: rgba(37,211,102,0.25); background: rgba(37,211,102,0.06); }
        .share-btn-full.share-whatsapp:hover { background: rgba(37,211,102,0.15); color: #25d366; }

        .welcome-banner { position: relative; margin-bottom: 2rem; padding: 2rem; background: linear-gradient(135deg, rgba(0,40,60,0.95), rgba(0,20,35,0.95)); border: 1px solid rgba(0,180,140,0.15); border-radius: 16px; overflow: hidden; }
        .welcome-glow { position: absolute; top: -50%; left: -20%; width: 140%; height: 200%; background: radial-gradient(ellipse at 30% 20%, rgba(0,229,160,0.06) 0%, transparent 60%); pointer-events: none; }
        .welcome-content { position: relative; z-index: 1; }
        .welcome-icon { font-size: 2.5rem; margin-bottom: 0.6rem; }
        .welcome-title { font-size: 1.5rem; font-weight: 800; background: linear-gradient(135deg, #00e5a0, #00b4d8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 0.6rem; }
        .welcome-desc { color: #7aa0b0; font-size: 0.88rem; line-height: 1.6; margin-bottom: 1.2rem; max-width: 540px; }
        .welcome-features { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.2rem; margin-bottom: 1.5rem; }
        .wf-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: #8ab0c0; }
        .wf-icon { font-size: 1rem; flex-shrink: 0; }
        .welcome-join { display: flex; gap: 0.6rem; align-items: stretch; max-width: 400px; }
        .welcome-name-input { flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,180,140,0.2); border-radius: 10px; padding: 0.7rem 1rem; color: #c8d8e8; font-size: 0.9rem; font-family: 'Syne',sans-serif; }
        .welcome-name-input:focus { outline: none; border-color: #00e5a0; }
        .welcome-name-input::placeholder { color: #3a6a7a; }
        .welcome-go-btn { padding: 0.7rem 1.4rem; background: linear-gradient(135deg, #1a5a4a, #1a4a5a); border: 1px solid rgba(0,229,160,0.3); border-radius: 10px; color: #00e5a0; font-weight: 700; font-size: 0.9rem; cursor: pointer; font-family: 'Syne',sans-serif; white-space: nowrap; transition: all 0.2s; }
        .welcome-go-btn:hover { background: linear-gradient(135deg, #1f6a56, #1f5a6a); border-color: rgba(0,229,160,0.5); }
        .welcome-hint { font-size: 0.65rem; color: #2a5a6a; margin-top: 0.6rem; }
        @media(max-width:500px) { .welcome-features { grid-template-columns: 1fr; } .welcome-join { flex-direction: column; } }

        .setup-banner { display: flex; align-items: center; gap: 0.8rem; padding: 0.8rem 1.1rem; margin-bottom: 1.2rem; background: rgba(240,192,64,0.07); border: 1px solid rgba(240,192,64,0.25); border-left: 3px solid #f0c040; border-radius: 8px; font-size: 0.8rem; color: #9ab0c0; }
        .setup-banner strong { color: #f0c040; }

        .community-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 0.6rem; margin-bottom: 1.5rem; }
        .cs-item { background: rgba(0,180,140,0.05); border: 1px solid rgba(0,180,140,0.12); border-radius: 10px; padding: 0.8rem 1rem; text-align: center; }
        .cs-val { display: block; font-family: 'Space Mono', monospace; font-size: 1.4rem; font-weight: 700; color: #00e5a0; }
        .cs-key { display: block; font-size: 0.6rem; color: #3a6a7a; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 0.2rem; }
        @media(max-width:600px) { .community-stats { grid-template-columns: repeat(2,1fr); } }

        .community-panel { margin: 0.8rem 0; padding: 0.8rem 0.9rem; background: rgba(0,30,60,0.3); border: 1px solid rgba(0,100,160,0.15); border-radius: 8px; }
        .community-panel.unconfigured { opacity: 0.6; }
        .cp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.3rem; }
        .cp-title { font-size: 0.58rem; font-family: 'Space Mono', monospace; color: #2a5a7a; text-transform: uppercase; letter-spacing: 0.1em; }
        .cp-bias { font-size: 0.62rem; font-family: 'Space Mono', monospace; }
        .cp-row { display: flex; gap: 0.5rem; align-items: center; font-size: 0.7rem; padding: 0.2rem 0; border-bottom: 1px solid #081825; flex-wrap: wrap; }
        .cp-row:last-child { border-bottom: none; }
        .cp-diver { color: #6ab4c8; font-weight: 700; min-width: 80px; }
        .cp-date { color: #3a5a7a; font-family: 'Space Mono', monospace; font-size: 0.62rem; }
        .cp-vis { font-weight: 700; font-family: 'Space Mono', monospace; }
        .cp-tide { color: #3a6a7a; font-size: 0.65rem; }
        .cp-model { color: #2a4a6a; font-size: 0.62rem; font-family: 'Space Mono', monospace; }
        .cp-note { cursor: pointer; }
        .cp-more { display: block; width: 100%; text-align: center; padding: 0.4rem; margin-top: 0.4rem; background: none; border: 1px solid rgba(0,100,160,0.15); border-radius: 5px; color: #3a6a8a; font-size: 0.65rem; cursor: pointer; font-family: 'Syne',sans-serif; }
        .cp-more:hover { background: rgba(0,100,160,0.08); color: #6ab4c8; }

        .growth-nudge { margin: 2rem 0; padding: 1.3rem 1.5rem; background: linear-gradient(135deg, rgba(0,40,60,0.6), rgba(0,20,40,0.6)); border: 1px solid rgba(0,180,140,0.12); border-radius: 14px; }
        .gn-header { margin-bottom: 0.8rem; }
        .gn-title { font-size: 0.78rem; font-weight: 700; color: #4a9a8a; font-family: 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.1em; }
        .gn-stats { display: flex; gap: 1rem; margin-bottom: 1rem; }
        .gn-stat { text-align: center; flex: 1; }
        .gn-stat-val { font-family: 'Space Mono', monospace; font-size: 1.6rem; font-weight: 700; color: #00e5a0; }
        .gn-stat-label { font-size: 0.6rem; color: #3a6a7a; text-transform: uppercase; }
        .gn-meter { margin-bottom: 0.5rem; }
        .gn-meter-label { font-size: 0.72rem; color: #4a7a8a; margin-bottom: 0.3rem; }
        .gn-meter-bar { height: 4px; background: #0a1e2e; border-radius: 2px; overflow: hidden; margin-bottom: 0.3rem; }
        .gn-meter-fill { height: 100%; background: linear-gradient(90deg, #00e5a0, #00b4d8); border-radius: 2px; transition: width 1s ease; }
        .gn-meter-hint { font-size: 0.65rem; color: #3a6070; }

        .spot-map-wrap { margin-bottom: 2rem; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.07); background: #081520; }
        .spot-map-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0.7rem 1rem; background: rgba(0,20,40,0.8); border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; gap: 0.5rem; }
        .spot-map-label { font-size: 0.6rem; font-family: 'Space Mono', monospace; color: #3a6a7a; text-transform: uppercase; letter-spacing: 0.15em; }
        .spot-map-layer-btns { display: flex; gap: 0.4rem; }
        .map-layer-btn { padding: 0.35rem 0.7rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #4a7a8a; font-family: 'Syne', sans-serif; font-size: 0.72rem; cursor: pointer; transition: all 0.2s; text-align: center; }
        .map-layer-btn.active { background: rgba(0,180,140,0.12); border-color: rgba(0,229,160,0.3); color: #00e5a0; }
        .spot-map { height: 340px; }
        .spot-map-footer { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; background: rgba(0,10,20,0.6); border-top: 1px solid rgba(255,255,255,0.04); font-size: 0.68rem; flex-wrap: wrap; gap: 0.3rem; }
        .spot-map-date-info { color: #4a7a8a; }
        .spot-map-hint { color: #2a4a5a; font-size: 0.6rem; }
        .current-widget { display: flex; align-items: center; }
        .layer-btn-date { display: block; font-size: 0.5rem; opacity: 0.75; }
      `}</style>

      <div className="app">
        <header>
          <div className="fish-bg">
            <div className="wave-line" />
            <div className="wave-line" />
            <div className="wave-line" />
          </div>
          <h1>{REGION.emoji} {REGION.label} Viz Forecast</h1>
          <p className="subtitle">Spearfishing Visibility Predictions</p>
          <p className="date">{now}</p>
          <ShareButtons spotDataMap={spotDataMap} regionLabel={REGION.label} compact={true} />
        </header>

        <div className="page-nav">
          <div className="region-switcher" style={{marginBottom:"0.8rem"}}>
            {Object.values(REGIONS).map(r => (
              <button key={r.id} className={`region-btn${region === r.id ? " active" : ""}`}
                onClick={() => { setRegion(r.id); setActivePage("forecast"); }}>
                {r.emoji} {r.label}
              </button>
            ))}
          </div>
          <button className={`page-nav-btn ${activePage === "seasonal" ? "active" : ""}`}
            onClick={() => setActivePage(activePage === "seasonal" ? "forecast" : "seasonal")}>📅 Seasonal</button>
          <button className={`page-nav-btn ${activePage === "data" ? "active" : ""}`}
        </div>

        {activePage === "seasonal" ? (
          <SeasonalPage region={region} />
        ) : (
          <>
            {showWelcome && (
              <WelcomeBanner
                regionLabel={REGION.label}
                onDismiss={handleWelcomeDismiss}
                onSetName={handleSetName}
                onSetEmail={handleSetEmail}
                diverName={diverName}
              />
            )}

            {/* Satellite status pill */}
            <div className="data-status-bar">
              <span className="data-status-label">Data</span>
              <span className={`data-status-pill ${loading ? "wait" : "ok"}`}>
                {loading ? "⏳ Loading spots…" : "✓ Spots"}
              </span>
              <span className={`data-status-pill ${currentStatus === "ok" ? "ok" : currentStatus === "error" ? "fail" : "wait"}`}>
                {currentStatus === "ok" ? "✓ Current" : currentStatus === "error" ? "✗ Current" : "⏳ Current"}
              </span>
              <span className={`data-status-pill ${satStatus === "ok" ? "ok" : satStatus === "error" ? "warn" : "wait"}`}>
                {satStatus === "ok" ? `✓ Satellite (${Object.keys(satData).length} spots)` : satStatus === "error" ? "⚠ Satellite" : "⏳ Satellite…"}
              </span>
              {region === "taranaki" && (
                <span className={`data-status-pill ${webcamStatus === "ok" ? "ok" : webcamStatus === "error" ? "warn" : webcamStatus === "no-data" || webcamStatus === "no-morning-data" ? "warn" : "wait"}`}>
                  {webcamStatus === "ok"
                    ? `📷 Webcam (${Object.values(webcamData).some(v => v.source === "supabase") ? "☀️ cached" : "🔴 live"} · ${Object.keys(webcamData).length} spots)`
                    : webcamStatus === "no-morning-data" ? "📷 No morning read yet"
                    : webcamStatus === "no-data" ? "📷 No cam data"
                    : webcamStatus === "error" ? "⚠ Webcam"
                    : "⏳ Webcam…"}
                </span>
              )}
              {region === "taranaki" && (
                <span className={`data-status-pill ${riverStatus === "ok" ? "ok" : riverStatus === "error" ? "warn" : riverStatus === "no-data" ? "warn" : "wait"}`}>
                  {riverStatus === "ok"
                    ? `💧 Rivers (${Object.keys(riverData).length} gauges live)`
                    : riverStatus === "error" ? "⚠ Rivers (offline)"
                    : riverStatus === "no-data" ? "💧 No river data"
                    : "⏳ Rivers…"}
                </span>
              )}
            </div>

            <AdvicePanel spotDataMap={spotDataMap} spots={SPOTS} region={region} />
            <BestDayPanel spotDataMap={spotDataMap} />
            <CommunityStats logs={allLogs} logStatus={logStatus} />

            <SpotMap
              spots={SPOTS}
              spotScores={spotScores}
              currentData={currentData}
              currentStatus={currentStatus}
              mapCenter={REGION.mapCenter}
              mapZoom={REGION.mapZoom}
            />

            <div className="grid">
              {SPOTS.map(spot => (
                <SpotCard
                  key={spot.name}
                  spot={spot}
                  data={spotDataMap[spot.name]}
                  error={errors[spot.name]}
                  currentData={currentData}
                  logEntries={logEntries}
                  onLogUpdate={handleLogUpdate}
                  communityLogs={allLogs}
                  logStatus={logStatus}
                  onCommunitySave={handleCommunitySave}
                  diverName={diverName}
                  isConfigured={isConfigured}
                />
              ))}
            </div>

            <Legend />
            <GrowthNudge logs={allLogs} spotDataMap={spotDataMap} regionLabel={REGION.label} spots={SPOTS} />

            <div className="info-panel">
              <strong>How it works:</strong> Scores combine swell height/period, wind speed/direction, 14-day rain history,
              ocean current direction, sea surface temperature, and now <strong>satellite turbidity</strong> from MODIS Aqua imagery.
              Each spot has calibrated parameters for papa rock risk, river runoff, NW push, and swell exposure.
              Log your dives to build per-spot bias correction over time.
            </div>

            <div style={{
              background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "0.9rem 1.2rem",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
            }}>
              <span style={{ fontSize: "0.8rem", color: "#6a8a9a" }}>
                📅 <strong style={{ color: "#c8e0ea" }}>Seasonal patterns</strong> — monthly visibility trends for all spots
              </span>
              <button
                onClick={() => setActivePage("seasonal")}
                style={{
                  background: "rgba(0,180,140,0.1)", border: "1px solid rgba(0,229,160,0.25)",
                  borderRadius: 8, color: "#00e5a0", fontSize: "0.75rem", fontWeight: 600,
                  padding: "0.4rem 0.9rem", cursor: "pointer", whiteSpace: "nowrap",
                }}>
                View →
              </button>
            </div>

            <footer>
              {REGION.footer} · Open-Meteo · NOAA RTOFS · NASA GIBS · Supabase · NZ Spearfishing Visibility 🐟
            </footer>
          </>
        )}
      </div>
    </>
  );
}
