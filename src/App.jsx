import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG — Community Shared Logging
// ══════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://mgcwrktuplnjtxkbsypc.supabase.co";
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

// ── Spots with per-spot modifiers ─────────────────────────────────────────────
const SPOTS = [
  {
    name: "Motumahanga (Saddleback Is.)",
    lat: -39.043, lon: 174.022,
    marine_lat: -39.10, marine_lon: 173.90,
    weather_lat: -39.055, weather_lon: 174.04,
    shelter: 0.6,  river_impact: 0.2,  papa_risk: 0.4,  swell_exposure: 0.15,
    nw_push: 0.8,  nw_rain_penalty: 0.5, southerly_bight: 0.0, tide_sensitive: 0.3,
    plume_reach: 0.7,
    note: "Motumahanga (Saddleback Is.) — outermost Sugar Loaf, ~1.5km offshore. Andesite rock, no papa. Best NW blue-water push. CAUTION: Feb 2026 satellite imagery showed dirty plume extending past the island 3+ days after rain. Model accounts for this — scores will be suppressed post-rain even here.",
    river: false,
  },
  {
    name: "Nga Motu — Inshore (Port Taranaki)",
    lat: -39.058, lon: 174.035,
    marine_lat: -39.10, marine_lon: 173.90,
    weather_lat: -39.07, weather_lon: 174.08,
    shelter: 0.85, river_impact: 0.9,  papa_risk: 0.9,  swell_exposure: 0.85,
    nw_push: 0.3,  nw_rain_penalty: 0.9, southerly_bight: 0.0, tide_sensitive: 1.0,
    note: "Poor flushing. Heavy stormwater/Waiwhakaiho impact. Only good after extended dry calm spells.",
    river: true,
  },
  {
    name: "Opunake",
    lat: -39.458, lon: 173.858,
    marine_lat: -39.50, marine_lon: 173.70,
    weather_lat: -39.45, weather_lon: 173.88,
    shelter: 0.4,  river_impact: 0.15, papa_risk: 0.2,  swell_exposure: 0.45,
    nw_push: 0.2,  nw_rain_penalty: 0.2, southerly_bight: 0.0, tide_sensitive: 0.4,
    note: "Low papa + rain shadow under NW. Clears fastest after rain. Best fallback.",
    river: true,
  },
  {
    name: "Patea — Inshore",
    lat: -39.751, lon: 174.478,
    marine_lat: -39.80, marine_lon: 174.35,
    weather_lat: -39.75, weather_lon: 174.50,
    shelter: 0.3,  river_impact: 0.85, papa_risk: 0.85, swell_exposure: 0.90,
    nw_push: 0.1,  nw_rain_penalty: 0.75, southerly_bight: 0.9, tide_sensitive: 0.85,
    note: "Papa + persistently muddy Patea River + bight exposure. Triple threat in bad conditions.",
    river: true,
  },
  {
    name: "Patea — Offshore Trap",
    lat: -39.80, lon: 174.35,
    marine_lat: -39.80, marine_lon: 174.20,
    weather_lat: -39.75, weather_lon: 174.47,
    shelter: 0.2,  river_impact: 0.25, papa_risk: 0.3,  swell_exposure: 0.20,
    nw_push: 0.15, nw_rain_penalty: 0.3, southerly_bight: 0.95, tide_sensitive: 0.2,
    note: "Clean on calm northerly days. Devastated by southerlies — Whanganui/Manawatu water floods in.",
    river: false,
  },
  {
    name: "The Metal Reef",
    lat: -38.9756, lon: 174.2769,
    marine_lat: -38.97, marine_lon: 174.27,
    weather_lat: -39.00, weather_lon: 174.23,
    shelter: 0.15,  river_impact: 0.55, papa_risk: 0.60, swell_exposure: 0.15,
    nw_push: 0.65,  nw_rain_penalty: 0.55, southerly_bight: 0.3, tide_sensitive: 0.2,
    note: "Steel platform in 30m — unique diving. Papa country + Waitara River runoff, but distance from river mouth reduces direct impact. Benefits from NW blue water push. Clears faster than inshore papa spots after rain.",
    river: true,
  },
];

// ── Scoring weights ────────────────────────────────────────────────────────────
const W = {
  w_swell: 0.45, w_wind: 0.25, w_rain: 0.30,
  nw_push_mult: 18.0, nw_rain_mult: 20.0,
  cur_north: 14.0, cur_south: 18.0, bight_mult: 22.0,
  sst_warm: 8.0, sst_cold: -16.0,
  tide_mult: 1.0,
  shelter_mult: 0.10, river_mult: 0.15,
  hist_2_5: 0.60, hist_2_0: 0.75, hist_1_5: 0.88,
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

function scoreSpot(cond, spot) {
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

  const nwStr = Math.max(0, 1 - Math.abs(((cond.wind_dir - 315 + 360) % 360)) / 45);
  let nw = 0;
  if (nwStr >= 0.1) {
    const push = nwStr * spot.nw_push * Math.min(cond.wind_spd / 15, 1) * W.nw_push_mult;
    const rpen = cond.rain_48h > 10
      ? nwStr * spot.nw_rain_penalty * papaRiskEffective * W.nw_rain_mult
      : 0;
    nw = push - rpen;
  }

  const cv = cond.current_vel, cd = cond.current_dir;
  const spd = Math.min(cv / 0.5, 1.0);
  const ss = Math.max(0, 1 - Math.abs(((cd - 180 + 360) % 360)) / 50);
  const ns = Math.max(0, 1 - Math.abs(((cd + 360) % 360)) / 60);
  const cur = ns * spd * W.cur_north - ss * spd * W.cur_south
              - ss * spd * spot.southerly_bight * W.bight_mult;

  const sst = cond.sst;
  const sstAdj = sst > 18 ? W.sst_warm : sst > 17 ? W.sst_warm * 0.5 : sst > 16 ? 0
               : sst > 15 ? W.sst_cold * 0.5 : sst > 14 ? W.sst_cold : W.sst_cold * 1.5;

  const tl = cond.tide_h;
  const tideSens = spot.tide_sensitive ?? 0.5;
  const tideBase = tl > 0.8 ? 18 : tl > 0.3 ? 10 : tl > -0.3 ? 0 : tl > -0.8 ? -12 : -20;
  const tideAdj = tideBase * tideSens * W.tide_mult;

  const shelter = spot.shelter * Math.max(0, 100 - s) * W.shelter_mult;
  const river   = -riverImpactEffective * (100 - r) * W.river_mult;

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

  const total = base + nw + cur + sstAdj + tideAdj + shelter + river + recovery + satAdj;
  return {
    score: Math.max(0, Math.min(100, Math.round(total))),
    plumeReach: Math.round(plumeReach * 100),
    factors: { swell: s, wind: wn, rain: r, nw, current: cur, sst: sstAdj, tide: tideAdj, recovery, satellite: satAdj },
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
      const rgba = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 256; c.height = 256;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve((px, py) => {
            const d = ctx.getImageData(px, py, 1, 1).data;
            return [d[0], d[1], d[2], d[3]];
          });
        };
        img.onerror = reject;
        img.src = url;
      });

      for (const spot of tile.spots) {
        try {
          const [r, g, b, a] = rgba(spot.pixelX, spot.pixelY);
          if (a < 10) continue;
          const blueness  = b / Math.max(1, r + g + b);
          const brownness = (r * 0.6 + g * 0.3) / Math.max(1, b);
          const turb = Math.min(100, Math.max(0, Math.round(brownness * 60 - blueness * 30 + 10)));
          results[spot.name] = {
            r, g, b,
            turbidity: layer.includes("TrueColor") ? turb : null,
          };
        } catch(e) {}
      }
    } catch(e) {}
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

function getDailyScores(marine, weather, spot) {
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
    const { score, factors } = scoreSpot(cond, spot);
    return { date, score, factors, cond };
  });
}

// ── Advice generator ──────────────────────────────────────────────────────────

function getAdvice(cond, results) {
  const best = results[0];
  const tips = [];

  if (best.score >= 80) tips.push({ e: "🤿", t: `Excellent — 10m+ vis expected at ${best.spot.name}. Get in the water.` });
  else if (best.score >= 60) tips.push({ e: "🐟", t: `Good spearfishing vis (5–10m) at ${best.spot.name}. Worth the dive.` });
  else if (best.score >= 40) tips.push({ e: "🦞", t: `Crays/paua conditions only (3–5m) at ${best.spot.name}. Not great for spearing.` });
  else tips.push({ e: "🚫", t: "Under 3m across all spots — not worth diving. Wait for conditions to settle." });

  const nwStr = Math.max(0, 1 - Math.abs(((cond.wind_dir - 315 + 360) % 360)) / 45);
  if (nwStr > 0.4) {
    if (cond.rain_48h > 15)
      tips.push({ e: "🌀", t: `NW wind active — blue water push, but recent rain likely outweighs it. Try Opunake.` });
    else
      tips.push({ e: "🌀", t: "NW wind — blue water push active on north coast. Motumahanga (Saddleback Is.) best option." });
  }

  if (cond.sst < 15.5)
    tips.push({ e: "🧊", t: `Cold SST (${cond.sst.toFixed(1)}°C) — active upwelling, expect turbid water.` });

  if (cond.swell_hist_72h > 2.0)
    tips.push({ e: "🌊", t: `Swell peaked ${cond.swell_hist_72h.toFixed(1)}m in the past 72h — water may still be dirty.` });

  if (cond.rain_48h > 20 && cond.days_since_rain < 2)
    tips.push({ e: "🌧️", t: "Recent heavy rain — avoid Waitara and Patea river mouths." });

  if (cond.rainHistory) {
    const plumePct = Math.round(plumeReachFactor(cond.rainHistory) * 100);
    if (plumePct >= 80)
      tips.push({ e: "🟤", t: `Heavy turbidity plume reaching Motumahanga (${plumePct}% impact) — offshore buffer fully overwhelmed. All Nga Motu spots affected. CawthronEye confirmed plume extends beyond the island.` });
    else if (plumePct >= 40)
      tips.push({ e: "🟤", t: `Turbidity plume partially reaching Motumahanga (${plumePct}% impact) — offshore advantage significantly reduced. Check CawthronEye before heading out.` });
    else if (plumePct > 0)
      tips.push({ e: "🟡", t: `Minor plume influence at Motumahanga (${plumePct}%) — mostly still buffered but watch CawthronEye.` });
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

// ── RTOFS ocean current fetch ─────────────────────────────────────────────────

async function fetchOceanCurrent() {
  const lat = -39.05;
  const lon = 173.87;
  const base = "https://upwell.pfeg.noaa.gov/erddap/griddap/ncepRtofsG2DFore3hrlyProg.json";
  const q = `?u_velocity[(0)][(1.0)][(${lat})][(${lon})],v_velocity[(0)][(1.0)][(${lat})][(${lon})]`;
  const res = await fetch(base + q);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const js = await res.json();
  const rows = js.table.rows;
  if (!rows || rows.length === 0) throw new Error("no data");
  const [timeStr, , , , u, v] = rows[0];
  if (u == null || v == null || isNaN(u) || isNaN(v)) throw new Error("NaN current");
  const uKt = u * 1.944;
  const vKt = v * 1.944;
  const speed = Math.sqrt(uKt*uKt + vKt*vKt);
  const dirRad = Math.atan2(u, v);
  const dir = ((dirRad * 180 / Math.PI) + 360) % 360;
  const pts = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const dirLabel = pts[Math.round(dir / 22.5) % 16];
  const modelTime = new Date(timeStr);
  const ageHrs = Math.round((Date.now() - modelTime) / 3600000);
  return { u: uKt, v: vKt, speed, dir, dirLabel, modelTime: timeStr, ageHrs, valid: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSOLIDATED DATA HOOK
// ══════════════════════════════════════════════════════════════════════════════

function useAllSpotsData(logEntries) {
  // ── Shared ocean data ────────────────────────────────────────────────────
  const [currentData, setCurrentData]     = useState(null);
  const [currentStatus, setCurrentStatus] = useState("idle");

  // ── CHANGE 2: Satellite turbidity state ──────────────────────────────────
  const [satData, setSatData]     = useState({});   // { [spotName]: { turbidity, r, g, b, date, agedays } }
  const [satStatus, setSatStatus] = useState("idle");
  const satRef = useRef({});

  // ── Per-spot scored data ─────────────────────────────────────────────────
  const [spotDataMap, setSpotDataMap]     = useState({});
  const [loading, setLoading]             = useState(true);
  const [errors, setErrors]               = useState({});

  const currentRef  = useRef(null);

  useEffect(() => { currentRef.current  = currentData;  }, [currentData]);
  // CHANGE 2: Keep satRef in sync
  useEffect(() => { satRef.current = satData; }, [satData]);

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

    const cond = {
      ...condBase,
      ...rtofsOverride,
      ...satOverride,
      rainHistory: rainHist,
      swellHistory: swellHist,
    };

    const { score: rawScore, factors, plumeReach } = scoreSpot(cond, spot);

    const biasMult = spotBiasMultiplier(spot.name, entries || []);
    let score = applyBias(rawScore, biasMult);

    const forecast = getDailyScores(marine, weather, spot);

    return {
      cond, score, rawScore, factors, forecast, biasMult,
      plumeReach: plumeReach ?? 0,
      satData: satRef.current?.[spot.name] ?? null,
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
          // Walk back up to 10 days to find a cloud-free MODIS Aqua tile
          // Each probe has a 5s timeout so a hanging image can't stall the chain
          let tcDate = null;
          for (let n = 1; n <= 10; n++) {
            const d = new Date();
            d.setDate(d.getDate() - n);
            const dateStr = d.toISOString().split("T")[0];
            const hasData = await Promise.race([
              new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/5/19/31.jpg`;
                img.onload = () => {
                  try {
                    const c = document.createElement("canvas");
                    c.width = 32; c.height = 32;
                    const ctx = c.getContext("2d");
                    ctx.drawImage(img, 0, 0, 32, 32);
                    const px = ctx.getImageData(0, 0, 32, 32).data;
                    const uniq = new Set();
                    for (let i = 0; i < px.length; i += 16) uniq.add(`${px[i]},${px[i+1]},${px[i+2]}`);
                    resolve(uniq.size > 8);
                  } catch { resolve(true); }
                };
                img.onerror = () => resolve(false);
              }),
              new Promise(resolve => setTimeout(() => resolve(false), 5000)), // 5s timeout per probe
            ]);
            if (hasData) { tcDate = dateStr; break; }
          }
          if (!tcDate) tcDate = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().split("T")[0]; })();

          const pixels = await sampleGibsTile(
            "MODIS_Aqua_CorrectedReflectance_TrueColor", tcDate, 9, "jpg", SPOTS
          );

          const today = new Date();
          const imgDate = new Date(tcDate + "T00:00:00");
          const agedays = Math.round((today - imgDate) / 86400000);

          const result = {};
          SPOTS.forEach(s => {
            const px = pixels[s.name];
            if (px) {
              result[s.name] = {
                turbidity: px.turbidity,
                r: px.r, g: px.g, b: px.b,
                date: tcDate,
                agedays,
              };
            }
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

      await Promise.all([
        ...spotPromises,
        rtofsPromise,
        Promise.race([satPromise, new Promise(r => setTimeout(r, 30000))]), // sat can't block >30s
      ]);
      if (!cancelled) setLoading(false);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // CHANGE 3: Expose satData and satStatus
  return {
    spotDataMap,
    loading,
    errors,
    currentData,
    currentStatus,
    satData,
    satStatus,
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
                strokeDashoffset={157 - (score / 100) * 157}
                style={{ transition: "stroke-dashoffset 1s ease" }}
              />
              <text x="60" y="52" textAnchor="middle" fill={color} fontSize="18" fontWeight="bold" fontFamily="'Space Mono', monospace">{score}</text>
              <text x="60" y="63" textAnchor="middle" fill={color} fontSize="7.5" fontFamily="'Space Mono', monospace">{visLabel(score)}</text>
            </svg>
          </div>

          <div className="viz-label" style={{ color }}>
            {score >= 80 ? "🤿" : score >= 60 ? "🐟" : score >= 40 ? "🦞" : score >= 20 ? "🌊" : "🚫"}{" "}
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
                      <span style={{color:"#4a7a8a",fontSize:"0.65rem"}}> {age}d ago</span>
                    </span>
                  );
                })(),
                key: "Sat Turbidity",
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
          </div>

          <div className="spot-note">{spot.note}</div>

          {spot.river && data.cond.rain_48h > 10 && (
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

function AdvicePanel({ spotDataMap }) {
  const advice = useMemo(() => {
    const entries = Object.entries(spotDataMap);
    if (entries.length === 0) return [];

    const firstData = entries[0]?.[1];
    if (!firstData?.cond) return [];

    const scored = SPOTS.map(spot => {
      const d = spotDataMap[spot.name];
      return { spot, score: d?.score ?? 0 };
    }).sort((a, b) => b.score - a.score);

    return getAdvice(firstData.cond, scored);
  }, [spotDataMap]);

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

function SpotMap({ spotScores, currentData, currentStatus }) {
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

    SPOTS.forEach(spot => {
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
      center: [-39.2, 174.1], zoom: 9,
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
  }, []);

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

function DataSourcesPage() {
  const spots = SPOTS;

  const dataSources = [
    {
      name: "Open-Meteo Weather API",
      url: "https://api.open-meteo.com/v1/forecast",
      icon: "💨",
      provides: "Wind speed & direction (10m), precipitation (hourly + 14-day history)",
      resolution: "~11 km global, ~1 km mesoscale (hourly updates)",
      models: "GFS, ICON, GEM, ECMWF IFS — auto-selects best for region",
      license: "CC BY 4.0 — Open-Meteo.com",
      notes: "Each spot uses a weather_lat/lon coordinate (on land) to guarantee wind/rain data. Offshore display coordinates may fall outside the land grid, returning null. The safe() function converts null → 0, which can make genuinely missing data appear as calm conditions.",
      windNote: true,
    },
    {
      name: "Open-Meteo Marine API",
      url: "https://marine-api.open-meteo.com/v1/marine",
      icon: "🌊",
      provides: "Wave height, wave period, wave direction, sea surface temperature, ocean current velocity & direction",
      resolution: "~0.5° grid (~50 km), hourly",
      models: "ECMWF WAM, NOAA WW3, Copernicus Marine",
      license: "CC BY 4.0 — Open-Meteo.com",
      notes: "Each spot uses a marine_lat/lon coordinate shifted ~10 km offshore to avoid the land mask. Nearshore and island coordinates are classified as 'land' in the ~0.5° grid and return null. The offset ensures wave/SST data is from the nearest open-ocean cell.",
    },
    {
      name: "NOAA RTOFS / HYCOM Ocean Current",
      url: "https://upwell.pfeg.noaa.gov/erddap/griddap/ncepRtofsG2DFore3hrlyProg",
      icon: "🌀",
      provides: "U/V ocean current velocity at 1m depth — converted to speed (knots) and direction",
      resolution: "~8 km, 3-hourly forecast",
      models: "NCEP Real-Time Ocean Forecast System (RTOFS) using HYCOM",
      license: "NOAA public domain",
      notes: "Single reference point at -39.05°S, 173.87°E (offshore Taranaki). Applied to all spots as a regional current indicator. Southerly currents drive Whanganui/Manawatū sediment-laden water into the South Taranaki Bight. Model data may lag real conditions by 6–12 hours.",
    },
    {
      name: "NASA GIBS Satellite Imagery",
      url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/",
      icon: "🛰️",
      provides: "True-colour satellite imagery — turbidity visual check at each spot",
      resolution: "250m (true colour)",
      models: "MODIS Aqua/Terra True Colour",
      license: "NASA EOSDIS — public domain",
      notes: "The app samples the exact pixel colour at each spot location from WMTS tiles to compute a turbidity index from RGB ratios. Searches back up to 10 days for cloud-free scenes. Turbidity data is now integrated into spot scores via satAdj factor (age-weighted, full trust at 0 days, zero trust at 3+ days).",
    },
  ];

  return (
    <div className="ds-page">
      <div className="ds-hero">
        <div className="ds-hero-icon">📡</div>
        <h2 className="ds-hero-title">Data Sources & Validation</h2>
        <p className="ds-hero-sub">Everything you need to verify and understand this model's inputs</p>
      </div>

      <div className="ds-alert">
        <div className="ds-alert-icon">⚠️</div>
        <div className="ds-alert-content">
          <div className="ds-alert-title">About Wind Readings of 0 kph</div>
          <p>
            The Open-Meteo hourly grid can return <code>null</code> for <code>wind_speed_10m</code> at the matched timestamp
            if the model data hasn&apos;t propagated for that hour. The app now falls back to the API&apos;s <code>current</code> real-time
            reading when the hourly value is missing — look for the ⚡ indicator on wind readings. If both hourly and current
            are null, <code>safe()</code> converts to <strong>0</strong> and you&apos;ll see a ⚠️ warning.
          </p>
          <p style={{marginTop:"0.5rem"}}>
            <strong>Primary cross-check:</strong>{" "}
            <a href="https://www.porttaranaki.co.nz/shipping-and-sea/sea-conditions" target="_blank" rel="noopener noreferrer" style={{color:"#00e5a0",textDecoration:"underline"}}>
              Port Taranaki — Sea Conditions
            </a>{" "}
            (live anemometer on Lee Breakwater — most reliable local source). Also try{" "}
            <a href="https://www.windfinder.com/forecast/new_plymouth_port_taranaki" target="_blank" rel="noopener noreferrer" style={{color:"#00e5a0",textDecoration:"underline"}}>
              Windfinder
            </a>{" "} or{" "}
            <a href="https://windy.app/forecast2/spot/32846/New+Plymouth" target="_blank" rel="noopener noreferrer" style={{color:"#00e5a0",textDecoration:"underline"}}>
              Windy.app
            </a>.
          </p>
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">🔗 Data Sources</h3>
        <p className="ds-section-desc">The model pulls from 4 independent data sources, cross-referencing satellite imagery with forecast models and ocean current observations.</p>
        <div className="ds-sources">
          {dataSources.map((src, i) => (
            <div key={i} className="ds-source-card">
              <div className="ds-source-header">
                <span className="ds-source-icon">{src.icon}</span>
                <div>
                  <div className="ds-source-name">{src.name}</div>
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className="ds-source-url">{src.url.replace("https://","").split("/").slice(0,2).join("/")}</a>
                </div>
              </div>
              <div className="ds-source-body">
                <div className="ds-source-row">
                  <span className="ds-row-label">Provides</span>
                  <span className="ds-row-val">{src.provides}</span>
                </div>
                <div className="ds-source-row">
                  <span className="ds-row-label">Resolution</span>
                  <span className="ds-row-val">{src.resolution}</span>
                </div>
                <div className="ds-source-row">
                  <span className="ds-row-label">Models</span>
                  <span className="ds-row-val">{src.models}</span>
                </div>
                <div className="ds-source-row">
                  <span className="ds-row-label">License</span>
                  <span className="ds-row-val">{src.license}</span>
                </div>
                <div className="ds-source-notes">{src.notes}</div>
                {src.windNote && (
                  <div className="ds-source-windwarn">
                    💨 Wind reading of 0 kph? See the alert above — null API data silently converts to 0.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">📍 Spot GPS Coordinates</h3>
        <p className="ds-section-desc">
          Each spot has a <strong>display location</strong> (where the spot actually is) and
          separate <strong>API query coordinates</strong> for weather and marine data. The offsets
          are needed because Open-Meteo&apos;s grid classifies some nearshore/island coordinates as &quot;land&quot;,
          returning null data.
        </p>
        <div className="ds-coords-table-wrap">
          <table className="ds-coords-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th>Display Lat/Lon</th>
                <th>Marine API Lat/Lon</th>
                <th>Weather API Lat/Lon</th>
                <th>Offset Notes</th>
              </tr>
            </thead>
            <tbody>
              {spots.map((s, i) => (
                <tr key={i}>
                  <td className="ds-coord-name">{s.name}</td>
                  <td className="ds-coord-num">
                    {s.lat.toFixed(3)}°S, {s.lon.toFixed(3)}°E
                  </td>
                  <td className="ds-coord-num">
                    {s.marine_lat ? `${s.marine_lat.toFixed(2)}°S, ${s.marine_lon.toFixed(2)}°E` : "Same as display"}
                  </td>
                  <td className="ds-coord-num">
                    {s.weather_lat ? `${s.weather_lat.toFixed(3)}°S, ${s.weather_lon.toFixed(2)}°E` : "Same as display"}
                  </td>
                  <td className="ds-coord-note">
                    {s.marine_lat
                      ? `Marine offset ~${(Math.sqrt(Math.pow(s.lat - s.marine_lat, 2) + Math.pow(s.lon - s.marine_lon, 2)) * 111).toFixed(0)}km`
                      : "No offset"}
                    {s.weather_lat ? ` · Weather on land` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">⚙️ Spot Scoring Parameters</h3>
        <p className="ds-section-desc">
          Each spot has calibrated modifiers that control how the model weighs different environmental factors.
          These were tuned against observations in Feb 2026 and CawthronEye satellite data.
        </p>
        <div className="ds-coords-table-wrap">
          <table className="ds-coords-table ds-params-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th title="Shelter from swell (0=exposed, 1=sheltered)">Shelter</th>
                <th title="River runoff impact (0=none, 1=heavy)">River</th>
                <th title="Papa rock sediment risk (0=none, 1=heavy papa)">Papa</th>
                <th title="Swell exposure penalty (0=protected, 1=fully exposed)">Swell</th>
                <th title="NW wind blue-water push benefit (0=none, 1=strong)">NW</th>
                <th title="Tide sensitivity (0=unaffected, 1=strongly tide-dependent)">Tide</th>
                <th title="Southerly bight exposure (0=none, 1=fully exposed to bight)">Bight</th>
              </tr>
            </thead>
            <tbody>
              {spots.map((s, i) => {
                const paramColor = (v) => v >= 0.7 ? "#f07040" : v >= 0.4 ? "#f0c040" : "#00e5a0";
                const invColor = (v) => v >= 0.7 ? "#00e5a0" : v >= 0.4 ? "#f0c040" : "#607d8b";
                return (
                  <tr key={i}>
                    <td className="ds-coord-name">{s.name}</td>
                    <td style={{color: invColor(s.shelter)}}>{s.shelter.toFixed(2)}</td>
                    <td style={{color: paramColor(s.river_impact)}}>{s.river_impact.toFixed(2)}</td>
                    <td style={{color: paramColor(s.papa_risk)}}>{s.papa_risk.toFixed(2)}</td>
                    <td style={{color: paramColor(s.swell_exposure)}}>{s.swell_exposure.toFixed(2)}</td>
                    <td style={{color: invColor(s.nw_push)}}>{s.nw_push.toFixed(2)}</td>
                    <td style={{color: paramColor(s.tide_sensitive)}}>{s.tide_sensitive.toFixed(2)}</td>
                    <td style={{color: paramColor(s.southerly_bight)}}>{s.southerly_bight.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">⚖️ Global Scoring Weights</h3>
        <p className="ds-section-desc">
          The base score is a weighted average of swell, wind, and rain sub-scores,
          then modified by NW push, ocean current, SST, tide, shelter, river, recovery, and satellite turbidity adjustments.
        </p>
        <div className="ds-weights-grid">
          {[
            { label: "Swell Weight", val: W.w_swell, desc: "Primary factor — wave height + period" },
            { label: "Wind Weight", val: W.w_wind, desc: "Wind speed and direction effect" },
            { label: "Rain Weight", val: W.w_rain, desc: "14-day rain history with papa decay" },
            { label: "NW Push Mult", val: W.nw_push_mult, desc: "Blue-water push bonus when NW wind active" },
            { label: "NW Rain Mult", val: W.nw_rain_mult, desc: "Rain penalty during NW — reduces push benefit" },
            { label: "Current North", val: W.cur_north, desc: "Northerly current bonus (cleaner water)" },
            { label: "Current South", val: W.cur_south, desc: "Southerly current penalty (turbid bight water)" },
            { label: "Bight Mult", val: W.bight_mult, desc: "South Taranaki Bight sediment exposure" },
            { label: "SST Warm", val: W.sst_warm, desc: "Bonus when SST > 18°C (no upwelling)" },
            { label: "SST Cold", val: W.sst_cold, desc: "Penalty when SST < 16°C (upwelling = murky)" },
          ].map((w, i) => (
            <div key={i} className="ds-weight-card">
              <div className="ds-weight-val">{w.val}</div>
              <div className="ds-weight-label">{w.label}</div>
              <div className="ds-weight-desc">{w.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">🔬 Calibration & Validation</h3>
        <div className="ds-validation-items">
          <div className="ds-val-item">
            <div className="ds-val-icon">🗓️</div>
            <div>
              <div className="ds-val-title">Calibration Period</div>
              <div className="ds-val-text">February 2026, calibrated against CawthronEye satellite observations and in-water visibility reports from Taranaki divers.</div>
            </div>
          </div>
          <div className="ds-val-item">
            <div className="ds-val-icon">🛰️</div>
            <div>
              <div className="ds-val-title">Satellite Turbidity Integration</div>
              <div className="ds-val-text">
                MODIS Aqua true-colour pixel sampling now feeds directly into scoring. The turbidity index (0–100) from RGB ratios
                is applied as a satAdj factor: high turbidity (&gt;60) suppresses scores, low turbidity (&lt;20) provides a small clarity bonus.
                Confidence is age-weighted — full trust at 0 days old, zero trust at 3+ days.
              </div>
            </div>
          </div>
          <div className="ds-val-item">
            <div className="ds-val-icon">🟤</div>
            <div>
              <div className="ds-val-title">Plume Reach Model</div>
              <div className="ds-val-text">
                Motumahanga's plume-reach model was calibrated after Feb 2026 satellite imagery showed dirty plume extending past the island 3+ days after heavy rain.
                A weighted rain history with 4-day half-life drives a 0–100% plume factor. At 100%, the island is scored like an inshore spot.
              </div>
            </div>
          </div>
          <div className="ds-val-item">
            <div className="ds-val-icon">🌧️</div>
            <div>
              <div className="ds-val-title">Rain Decay Calibration</div>
              <div className="ds-val-text">
                30mm of rain leaves Nga Motu Inshore &quot;Very Dirty&quot; for 3+ days, &quot;Dirty&quot; for 7+ days, and &quot;Clearing&quot; after ~10 days.
                Half-life ranges from 2 days (Opunake, low papa) to 11+ days (high-papa inshore sites).
              </div>
            </div>
          </div>
          <div className="ds-val-item">
            <div className="ds-val-icon">📓</div>
            <div>
              <div className="ds-val-title">Dive Log Bias Correction</div>
              <div className="ds-val-text">
                The model supports user-logged observations. When you log actual visibility against the model score, a per-spot
                bias multiplier (0.6–1.4×) is computed from your most recent 20 observations using exponential weighting.
              </div>
            </div>
          </div>
          <div className="ds-val-item">
            <div className="ds-val-icon">🔴</div>
            <div>
              <div className="ds-val-title">Known Limitations</div>
              <div className="ds-val-text">
                Tide data is not currently sourced from a tidal model — the tide_h field is always 0.
                Satellite turbidity only affects today's score (not the 7-day forecast).
                Always cross-check with Port Taranaki Sea Conditions or MetService before making dive decisions.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">🔗 Cross-Check Resources</h3>
        <p className="ds-section-desc">Use these independent sources to verify model outputs before heading out.</p>
        <div className="ds-links-grid">
          {[
            { name: "Port Taranaki — Sea Conditions", url: "https://www.porttaranaki.co.nz/shipping-and-sea/sea-conditions", desc: "LIVE wind, wave & tide from Lee Breakwater anemometer" },
            { name: "Windfinder — Port Taranaki", url: "https://www.windfinder.com/forecast/new_plymouth_port_taranaki", desc: "Live wind station + forecast" },
            { name: "Windy.app — New Plymouth", url: "https://windy.app/forecast2/spot/32846/New+Plymouth", desc: "GFS wind/wave forecast" },
            { name: "MetService — Taranaki", url: "https://www.metservice.com/towns-cities/locations/new-plymouth", desc: "Official NZ weather forecast" },
            { name: "CawthronEye Satellite", url: "https://cawthron.shinyapps.io/CawthronEye/", desc: "NZ coastal water colour satellite" },
            { name: "NASA Worldview", url: "https://worldview.earthdata.nasa.gov/", desc: "True-colour satellite imagery" },
            { name: "Surf-Forecast Taranaki", url: "https://www.surf-forecast.com/breaks/Back-Beach", desc: "Swell forecast verification" },
          ].map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="ds-link-card">
              <div className="ds-link-name">{link.name}</div>
              <div className="ds-link-desc">{link.desc}</div>
              <div className="ds-link-arrow">↗</div>
            </a>
          ))}
        </div>
      </div>

      <div className="ds-section">
        <h3 className="ds-section-title">🧪 Example API Calls</h3>
        <p className="ds-section-desc">These are the actual API endpoints the app queries. Open in a browser to inspect raw data.</p>
        <div className="ds-api-examples">
          {spots.slice(0, 3).map((s, i) => {
            const wLat = s.weather_lat ?? s.lat;
            const wLon = s.weather_lon ?? s.lon;
            const mLat = s.marine_lat ?? s.lat;
            const mLon = s.marine_lon ?? s.lon;
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${wLat}&longitude=${wLon}&current=wind_speed_10m,wind_direction_10m&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kmh&timezone=Pacific%2FAuckland&forecast_days=1&past_days=0`;
            const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${mLat}&longitude=${mLon}&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=Pacific%2FAuckland&forecast_days=1&past_days=0`;
            return (
              <div key={i} className="ds-api-block">
                <div className="ds-api-spot">{s.name}</div>
                <div className="ds-api-label">Weather (wind, rain):</div>
                <a href={weatherUrl} target="_blank" rel="noopener noreferrer" className="ds-api-url">{weatherUrl.slice(0, 120)}…</a>
                <div className="ds-api-label" style={{marginTop:"0.3rem"}}>Marine (swell, SST):</div>
                <a href={marineUrl} target="_blank" rel="noopener noreferrer" className="ds-api-url">{marineUrl.slice(0, 120)}…</a>
              </div>
            );
          })}
          <div className="ds-api-block">
            <div className="ds-api-spot">RTOFS Ocean Current (all spots)</div>
            <div className="ds-api-label">ERDDAP query:</div>
            <a href="https://upwell.pfeg.noaa.gov/erddap/griddap/ncepRtofsG2DFore3hrlyProg.json?u_velocity[(0)][(1.0)][(-39.05)][(173.87)],v_velocity[(0)][(1.0)][(-39.05)][(173.87)]" target="_blank" rel="noopener noreferrer" className="ds-api-url">
              upwell.pfeg.noaa.gov/erddap/griddap/ncepRtofsG2DFore3hrlyProg…
            </a>
          </div>
        </div>
      </div>

    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// Share helpers
// ══════════════════════════════════════════════════════════════════════════════

function getShareText(spotDataMap) {
  const entries = Object.entries(spotDataMap).filter(([,d]) => d?.score != null);
  if (!entries.length) return "Check out the Taranaki Viz Forecast — spearfishing visibility predictions for the Taranaki coast! 🐟🤿";
  const best = entries.sort((a, b) => b[1].score - a[1].score)[0];
  const bestName = best[0].split("—")[0].trim();
  return `Taranaki Viz Forecast 🐟\nBest spot right now: ${bestName} — ${best[1].score}/100 (${scoreToLabel(best[1].score)})\nCheck conditions & log your dives:`;
}

function ShareButtons({ spotDataMap, compact }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const text = getShareText(spotDataMap);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text + "\n" + shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch {}
  };
  const handleWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(text + "\n" + shareUrl)}`, "_blank"); };
  const handleSms = () => { window.open(`sms:?body=${encodeURIComponent(text + "\n" + shareUrl)}`, "_blank"); };
  const handleNativeShare = async () => { if (navigator.share) { try { await navigator.share({ title: "Taranaki Viz Forecast", text, url: shareUrl }); } catch {} } };
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
function WelcomeBanner({ onDismiss, onSetName, diverName }) {
  const [name, setName] = useState(diverName || "");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const handleJoin = () => { if (name.trim()) onSetName(name.trim()); setDismissed(true); onDismiss(); };
  return (
    <div className="welcome-banner">
      <div className="welcome-glow" />
      <div className="welcome-content">
        <div className="welcome-icon">🤿</div>
        <h2 className="welcome-title">Welcome to the Taranaki Viz Forecast</h2>
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
          <button className="welcome-go-btn" onClick={handleJoin}>{name.trim() ? "Let's Go 🐟" : "Skip for Now"}</button>
        </div>
        <div className="welcome-hint">You can always add your name later when logging a dive</div>
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
function GrowthNudge({ logs, spotDataMap }) {
  const totalDivers = new Set(logs.map(l => l.diver_name)).size;
  const totalLogs = logs.length;
  const spotsWithData = SPOTS.filter(s => logs.filter(l => l.spot === s.name).length >= 2).length;
  return (
    <div className="growth-nudge">
      <div className="gn-header"><span className="gn-title">📈 Community Data Health</span></div>
      <div className="gn-stats">
        <div className="gn-stat"><div className="gn-stat-val">{totalDivers}</div><div className="gn-stat-label">Divers</div></div>
        <div className="gn-stat"><div className="gn-stat-val">{totalLogs}</div><div className="gn-stat-label">Observations</div></div>
        <div className="gn-stat"><div className="gn-stat-val">{spotsWithData}/{SPOTS.length}</div><div className="gn-stat-label">Spots Calibrated</div></div>
      </div>
      <div className="gn-meter">
        <div className="gn-meter-label">Model calibration: {totalLogs < 10 ? "Early days" : totalLogs < 30 ? "Getting better" : totalLogs < 100 ? "Good data" : "Strong calibration"}</div>
        <div className="gn-meter-bar"><div className="gn-meter-fill" style={{ width: `${Math.min(100, (totalLogs / 100) * 100)}%` }} /></div>
        <div className="gn-meter-hint">{totalLogs < 30 ? `${30 - totalLogs} more observations for solid calibration` : totalLogs < 100 ? `${100 - totalLogs} more for high-confidence predictions` : "Great coverage — well-calibrated"}</div>
      </div>
      <ShareButtons spotDataMap={spotDataMap} compact={false} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════

export default function App() {
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
  } = useAllSpotsData(logEntries);

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
          <h1>🐟 Taranaki Viz Forecast</h1>
          <p className="subtitle">Spearfishing Visibility Predictions</p>
          <p className="date">{now}</p>
          <ShareButtons spotDataMap={spotDataMap} compact={true} />
        </header>

        <div className="page-nav">
          <button className={`page-nav-btn ${activePage === "forecast" ? "active" : ""}`}
            onClick={() => setActivePage("forecast")}>🤿 Forecast</button>
          <button className={`page-nav-btn ${activePage === "data" ? "active" : ""}`}
            onClick={() => setActivePage("data")}>📡 Data Sources</button>
        </div>

        {activePage === "data" ? (
          <DataSourcesPage />
        ) : (
          <>
            {showWelcome && (
              <WelcomeBanner
                onDismiss={handleWelcomeDismiss}
                onSetName={handleSetName}
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
            </div>

            <AdvicePanel spotDataMap={spotDataMap} />
            <BestDayPanel spotDataMap={spotDataMap} />
            <CommunityStats logs={allLogs} logStatus={logStatus} />

            <SpotMap
              spotScores={spotScores}
              currentData={currentData}
              currentStatus={currentStatus}
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
            <GrowthNudge logs={allLogs} spotDataMap={spotDataMap} />

            <div className="info-panel">
              <strong>How it works:</strong> Scores combine swell height/period, wind speed/direction, 14-day rain history,
              ocean current direction, sea surface temperature, and now <strong>satellite turbidity</strong> from MODIS Aqua imagery.
              Each spot has calibrated parameters for papa rock risk, river runoff, NW push, and swell exposure.
              Log your dives to build per-spot bias correction over time.
            </div>

            <footer>
              Taranaki Viz Forecast · Open-Meteo · NOAA RTOFS · NASA GIBS · Supabase · Built for Taranaki divers 🐟
            </footer>
          </>
        )}
      </div>
    </>
  );
}
