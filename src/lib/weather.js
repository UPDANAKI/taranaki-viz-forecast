import { safe } from "./scoring.js";

// ── Data extraction helpers ───────────────────────────────────────────────────

export function nowIdx(times) {
  const now = Date.now();
  let best = 0, bd = Infinity;
  times.forEach((t, i) => {
    const d = Math.abs(new Date(t).getTime() - now);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export function dailyRainHistory(times, vals, maxDays = 14) {
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

export function dailySwellHistory(times, vals, maxDays = 7) {
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

export function rain48h(times, vals) {
  const now = Date.now();
  return times.reduce((sum, t, i) => {
    const hrs = (now - new Date(t).getTime()) / 3600000;
    return (hrs >= 0 && hrs <= 48) ? sum + safe(vals[i]) : sum;
  }, 0);
}

export function daysSinceRain(vals) {
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

export function maxSwellPast(times, vals, hours) {
  const now = Date.now();
  return times.reduce((mx, t, i) => {
    const hrs = (now - new Date(t).getTime()) / 3600000;
    return (hrs >= 0 && hrs <= hours) ? Math.max(mx, safe(vals[i])) : mx;
  }, 0);
}

export function condFromHourly(marine, weather, mIdx, wIdx, r48, dsr, hist) {
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
    swell_wave_h:   safe(marine.hourly?.swell_wave_height?.[mIdx]),
    swell_wave_p:   safe(marine.hourly?.swell_wave_period?.[mIdx]),
    swell_wave_dir: safe(marine.hourly?.swell_wave_direction?.[mIdx]),
    wind_wave_h:    safe(marine.hourly?.wind_wave_height?.[mIdx]),
    wind_wave_p:    safe(marine.hourly?.wind_wave_period?.[mIdx]),
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

// dailyAvgHistory — builds a daily-average array anchored to a reference date string.
// Used to supply 22-day history windows to the Netlify ONNX scoring function.
// times: ISO string array. vals: numeric array (same length). days: how many days back.
// Returns array of length `days`: index 0 = today (or most recent), index N = N days ago.
// Missing days fill with 0.
export function dailyAvgHistory(times, vals, days = 22) {
  if (!times || !vals || times.length === 0) return Array(days).fill(0);
  const todayMs = Date.now();
  const byDay = {};
  const counts = {};
  times.forEach((t, i) => {
    const hrs = (todayMs - new Date(t).getTime()) / 3600000;
    if (hrs < 0 || hrs > days * 24) return;
    const dayAgo = Math.floor(hrs / 24);
    const v = typeof vals[i] === "number" && !isNaN(vals[i]) ? vals[i] : 0;
    byDay[dayAgo] = (byDay[dayAgo] ?? 0) + v;
    counts[dayAgo] = (counts[dayAgo] ?? 0) + 1;
  });
  const result = [];
  for (let d = 0; d < days; d++) {
    result.push(counts[d] ? byDay[d] / counts[d] : 0);
  }
  return result;
}
