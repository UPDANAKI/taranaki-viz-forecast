import { safe, scoreSpot } from "./scoring.js";

export async function getDailyScores(marine, weather, spot, W, region, gaugeRain = null, murSstByDate = null) {
  const mTimes = marine?.hourly?.time ?? [];
  const wTimes = weather?.hourly?.time ?? [];

  const mByDate = {};
  mTimes.forEach((t, i) => {
    const date = t.split("T")[0];
    if (!mByDate[date]) mByDate[date] = { waveH: [], waveP: [], waveDir: [], swellH: [], swellP: [], swellDir: [], windWaveH: [], windWaveP: [], sst: [], curVel: [], curDir: [] };
    mByDate[date].waveH.push(safe(marine.hourly.wave_height?.[i]));
    mByDate[date].waveP.push(safe(marine.hourly.wave_period?.[i]));
    mByDate[date].waveDir.push(safe(marine.hourly.wave_direction?.[i]));
    mByDate[date].swellH.push(safe(marine.hourly.swell_wave_height?.[i]));
    mByDate[date].swellP.push(safe(marine.hourly.swell_wave_period?.[i]));
    mByDate[date].swellDir.push(safe(marine.hourly.swell_wave_direction?.[i]));
    mByDate[date].windWaveH.push(safe(marine.hourly.wind_wave_height?.[i]));
    mByDate[date].windWaveP.push(safe(marine.hourly.wind_wave_period?.[i]));
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

  // Build full daily maps for all variables — used for legacy cond fields
  // and to construct per-day shifted hist22 arrays for the ONNX feature builder.
  const dailyRainMap     = {};
  const dailySwellMaxMap = {};
  const dailySwellAvgMap = {};
  const dailySwellPMap   = {};
  const dailySwellDirMap = {};
  const dailySwellWHMap  = {};
  const dailySwellWPMap  = {};
  const dailyWindSpdMap  = {};
  const dailyWindDirMap  = {};
  const dailySSTMap      = {};

  allDates.forEach(d => {
    const w = wByDate[d];
    const m = mByDate[d];
    dailyRainMap[d]     = w ? sum(w.precip) : 0;
    dailySwellMaxMap[d] = m ? Math.max(...m.waveH, 0) : 0;
    dailySwellAvgMap[d] = m ? avg(m.waveH) : 0;
    dailySwellPMap[d]   = m ? avg(m.waveP) : 0;
    dailySwellDirMap[d] = m ? avg(m.waveDir) : 0;
    dailySwellWHMap[d]  = m ? avg(m.swellH) : 0;
    dailySwellWPMap[d]  = m ? avg(m.swellP) : 0;
    dailyWindSpdMap[d]  = w ? avg(w.wind) : 0;
    dailyWindDirMap[d]  = w ? avg(w.windDir) : 0;
    dailySSTMap[d]      = m ? avg(m.sst) : 16;
  });

  // Override past dates with NASA MUR 1km SST where available.
  // MUR has ~1 day latency, so today may be null — yesterday onward is reliable.
  // Future forecast dates are not in murSstByDate so Open-Meteo is used for those.
  if (murSstByDate) {
    for (const [date, sst] of Object.entries(murSstByDate)) {
      if (sst != null) dailySSTMap[date] = sst;
    }
  }

  // Override today/yesterday rain with GWRC gauge data when available.
  // Future forecast days always use Open-Meteo (gauges have no forecast).
  if (gaugeRain) {
    const sorted = [...allDates].sort();
    const todayIdx = sorted.indexOf(todayStr);
    if (todayIdx >= 0) {
      dailyRainMap[sorted[todayIdx]] = gaugeRain.rain_24h ?? dailyRainMap[sorted[todayIdx]];
      if (todayIdx > 0) {
        dailyRainMap[sorted[todayIdx - 1]] = Math.max(0,
          (gaugeRain.rain_48h ?? 0) - (gaugeRain.rain_24h ?? 0));
      }
    }
  }

  // Build a hist22 anchored to a specific forecast date.
  // Index 0 = the forecast date itself, index N = N days before that.
  // This ensures each forecast day sees different lagged conditions.
  function buildHist22ForDate(anchorDateIdx) {
    const build = (mapObj, fallback = 0) => {
      const arr = [];
      for (let i = 0; i < 22; i++) {
        const idx = anchorDateIdx - i;
        arr.push(idx >= 0 ? (mapObj[allDates[idx]] ?? fallback) : fallback);
      }
      return arr;
    };
    return {
      swell_h:      build(dailySwellAvgMap),
      swell_p:      build(dailySwellPMap),
      swell_dir:    build(dailySwellDirMap),
      swell_wave_h: build(dailySwellWHMap),
      swell_wave_p: build(dailySwellWPMap),
      wind_spd:     build(dailyWindSpdMap),
      wind_dir:     build(dailyWindDirMap),
      sst:          build(dailySSTMap, 16),
      rain:         build(dailyRainMap),
    };
  }

  const futureDates = allDates.filter(d => d >= todayStr).slice(0, 7);

  return Promise.all(futureDates.map(async (date, dayIdx) => {
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
      swell_dir:       avg(m?.waveDir ?? [0]),
      swell_wave_h:    avg(m?.swellH ?? [0]),
      swell_wave_p:    avg(m?.swellP ?? [0]),
      swell_wave_dir:  avg(m?.swellDir ?? [0]),
      wind_wave_h:     avg(m?.windWaveH ?? [0]),
      wind_wave_p:     avg(m?.windWaveP ?? [0]),
      swell_hist_72h:  swellHist72,
      wind_spd:        avg(w.wind),
      wind_dir:        avg(w.windDir),
      rain_48h:        rain48h,
      days_since_rain: daysSinceRainVal,
      sst:             murSstByDate?.[date] ?? (avg(m?.sst ?? [0]) || 16),
      current_vel:     avg(m?.curVel ?? [0]),
      current_dir:     avg(m?.curDir ?? [0]),
      tide_h:          0,
      rainHistory,
      swellHistory,
      hist22: buildHist22ForDate(dateIdx),  // per-day shifted history for ONNX
      _forecastDate:   date,  // ensures cache key is unique per forecast day
    };
    const { score: rawForecastScore, factors } = await scoreSpot(cond, spot, W);
    // Seasonal delta removed — score is purely physics-based
    const score = rawForecastScore;
    return { date, score, factors, cond };
  }));
}

// ── Plume reach factor — how much rain has penetrated to Motumahanga ────────────
// rainHistory[0] = today, [1] = yesterday, [2] = 2 days ago, etc.
// Returns 0.0 (no plume) → 1.0 (full plume reaching offshore)
// Based on Taranaki field knowledge: >50mm in 3 days = plume reaches Motumahanga
export function plumeReachFactor(rainHistory) {
  if (!rainHistory || rainHistory.length === 0) return 0;
  const rain3d = rainHistory.slice(0, 3).reduce((a, b) => a + b, 0);
  const rain7d = rainHistory.slice(0, 7).reduce((a, b) => a + b, 0);
  // Weight recent rain heavily — plume dissipates over ~3 days
  const rawFactor = Math.min(1.0, (rain3d / 50) * 0.7 + (rain7d / 120) * 0.3);
  return Math.max(0, rawFactor);
}

// ── Recovery bonus — how clean has it been recently ──────────────────────────
// Returns 0 (recent dirty) → 10 (extended clean spell)
// Used to generate "water clearing" advice messages
export function recoveryBonus(rainHistory, swellHistory) {
  if (!rainHistory || !swellHistory) return 0;
  const cleanRainDays = rainHistory.slice(0, 7).filter(mm => mm < 3).length;
  const calmSwellDays = swellHistory.slice(0, 5).filter(h => h < 1.5).length;
  return cleanRainDays + calmSwellDays;
}

// ── Advice generator ──────────────────────────────────────────────────────────

export function getAdvice(cond, results, region = "taranaki") {
  const best = results[0];
  const tips = [];

  if (best.score >= 80) tips.push({ e: "🤿", t: `Excellent conditions at ${best.spot.name}. Get in the water.` });
  else if (best.score >= 60) tips.push({ e: "🐟", t: `Good spearfishing conditions at ${best.spot.name}. Worth the dive.` });
  else if (best.score >= 40) tips.push({ e: "🦞", t: `Marginal conditions at ${best.spot.name}. Marginal conditions.` });
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
