// Vizcast score-full Edge Function
// All scoring IP lives here server-side.

function degToOctant(deg) {
  const d = ((deg % 360) + 360) % 360;
  const octants = ["N","NE","E","SE","S","SW","W","NW"];
  return octants[Math.round(d / 45) % 8];
}

function dirExposureFactor(swellDir, spot) {
  if (!spot?.dir_exposure || swellDir == null || swellDir === 0) return spot?.swell_exposure ?? 0.5;
  const octant = degToOctant(swellDir);
  return spot.dir_exposure[octant] ?? spot.swell_exposure ?? 0.5;
}

function periodDepthFactor(period, depthM) {
  if (!period || period <= 0 || !depthM) return 0.5;
  const disturbanceDepth = period * period * 0.12;
  if (disturbanceDepth >= depthM) return 1.0;
  if (disturbanceDepth < depthM * 0.3) return 0.2;
  return 0.2 + 0.8 * (disturbanceDepth / depthM);
}

function swellScore(h, p, spot, swellDir) {
  const dirFactor = dirExposureFactor(swellDir, spot);
  const depthFactor = periodDepthFactor(p, spot?.depth_m ?? 10);
  const periodWeight = 0.4 + 0.6 * depthFactor;
  const effectiveH = h * (0.3 + 0.7 * dirFactor) * periodWeight;
  let s = effectiveH < 0.4 ? 100 : effectiveH < 0.7 ? 90 : effectiveH < 1.0 ? 76
        : effectiveH < 1.4 ? 58 : effectiveH < 1.8 ? 36 : effectiveH < 2.3 ? 16
        : effectiveH < 3.0 ? 5 : 0;
  const exposure = spot?.swell_exposure ?? 0.5;
  if (exposure >= 0.75) s = Math.max(0, s - exposure * (100 - s) * 0.45);
  return Math.max(0, Math.round(s));
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
  rainHistory.forEach((mm, dayAgo) => { weighted += mm * Math.pow(0.5, dayAgo / halfLife); });
  if (weighted <= 5) return 0.0;
  if (weighted >= 30) return 1.0;
  return (weighted - 5) / 25;
}

function rainPenalty14(rainHistory, papaRisk) {
  const halfLife = 2.0 + papaRisk * 10.0;
  const penaltyMult = 1.2 + papaRisk * 2.0;
  let weightedRain = 0;
  rainHistory.forEach((mm, dayAgo) => { weightedRain += mm * Math.pow(0.5, dayAgo / halfLife); });
  const penalty = Math.min(95, weightedRain * penaltyMult);
  return Math.max(0, 100 - penalty);
}

function swellHistoryMultiplier(swellHistory, W) {
  const halfLife = 2.5;
  let weightedSwell = 0;
  swellHistory.forEach((h, dayAgo) => { weightedSwell += h * Math.pow(0.5, dayAgo / halfLife); });
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

function mergeSpotWeights(W, spot) {
  // Layer 1: spot_type profile (swell/harbour/bight etc)
  if (W.SPOT_TYPE_WEIGHTS && spot.spot_type) {
    const profile = W.SPOT_TYPE_WEIGHTS[spot.spot_type];
    if (profile) W = { ...W, ...profile };
  }
  // Layer 2: per-spot W override (calibrate_per_spot.py output)
  // spot.W takes highest precedence — overrides both regional and spot_type
  if (spot.W) W = { ...W, ...spot.W };
  return W;
}

function scoreSpot(cond, spot, W) {
  W = mergeSpotWeights(W, spot);
  const s = swellScore(cond.swell_h, cond.swell_p, spot, cond.swell_dir);
  const wn = windScore(cond.wind_spd, cond.wind_dir);
  let papaRiskEffective = spot.papa_risk;
  let riverImpactEffective = spot.river_impact;
  let plumeReach = 0;
  if (spot.plume_reach && cond.rainHistory) {
    plumeReach = plumeReachFactor(cond.rainHistory);
    if (plumeReach > 0) {
      const blendStrength = plumeReach * spot.plume_reach;
      papaRiskEffective = spot.papa_risk + blendStrength * (0.85 - spot.papa_risk);
      riverImpactEffective = spot.river_impact + blendStrength * (0.85 - spot.river_impact);
    }
  }
  const r = cond.rainHistory ? rainPenalty14(cond.rainHistory, papaRiskEffective) : rainDecay(cond.rain_48h, cond.days_since_rain, spot);
  const hp = cond.swellHistory ? swellHistoryMultiplier(cond.swellHistory, W) : (cond.swell_hist_72h > 2.5 ? W.hist_2_5 : cond.swell_hist_72h > 2.0 ? W.hist_2_0 : cond.swell_hist_72h > 1.5 ? W.hist_1_5 : 1.0);
  const base = (s * W.w_swell + wn * W.w_wind + r * W.w_rain) * hp;
  const recovery = (cond.rainHistory && cond.swellHistory) ? recoveryBonus(cond.rainHistory, cond.swellHistory) * (1 - plumeReach * 0.8) : 0;
  let nw = 0;
  if (spot.best_wind_dirs && cond.wind_spd > 3) {
    const bestStr = spot.best_wind_dirs.reduce((max, dir) => { const diff = Math.abs(((cond.wind_dir - dir + 360) % 360)); return Math.max(max, Math.max(0, 1 - Math.min(diff, 360 - diff) / 60)); }, 0);
    const worstStr = (spot.worst_wind_dirs || []).reduce((max, dir) => { const diff = Math.abs(((cond.wind_dir - dir + 360) % 360)); return Math.max(max, Math.max(0, 1 - Math.min(diff, 360 - diff) / 60)); }, 0);
    const windSpeedFactor = Math.min(cond.wind_spd / 15, 1);
    const push = bestStr * (spot.wind_push ?? 0.5) * windSpeedFactor * W.push_mult;
    const rpen = cond.rain_48h > 10 ? bestStr * (spot.nw_rain_penalty ?? 0.3) * (papaRiskEffective ?? 0.3) * W.rain_pen_mult : 0;
    const drag = worstStr * windSpeedFactor * (spot.wind_push ?? 0.5) * W.push_mult * 0.6;
    nw = push - rpen - drag;
  }
  const cv = cond.current_vel, cd = cond.current_dir;
  const spd = Math.min(cv / 0.5, 1.0);
  const ss = Math.max(0, 1 - Math.abs(((cd - 180 + 360) % 360)) / 50);
  const ns = Math.max(0, 1 - Math.abs(((cd + 360) % 360)) / 60);
  const cur = ns * spd * W.cur_north - ss * spd * W.cur_south - ss * spd * (spot.southerly_bight ?? 0) * W.bight_mult;
  const sst = cond.sst;
  const sstAdj = sst > 18 ? W.sst_warm : sst > 17 ? W.sst_warm * 0.5 : sst > 16 ? 0 : sst > 15 ? W.sst_cold * 0.5 : sst > 14 ? W.sst_cold : W.sst_cold * 1.5;
  const tl = cond.tide_h;
  const tideSens = spot.tide_sensitive ?? 0.5;
  const tideBase = tl > 0.8 ? 18 : tl > 0.3 ? 10 : tl > -0.3 ? 0 : tl > -0.8 ? -12 : -20;
  const tideAdj = tideBase * tideSens * W.tide_mult;
  const shelter = spot.shelter * Math.max(0, 100 - s) * W.shelter_mult;
  const river = -riverImpactEffective * (100 - r) * W.river_mult;
  let riverFNUAdj = 0;
  if (cond.riverTurbScore != null && spot.river_impact > 0.1) {
    const rts = cond.riverTurbScore;
    const sensitivity = spot.river_impact;
    if (rts > 60) riverFNUAdj = -sensitivity * (rts - 40) * 0.25;
    else if (rts < 15) riverFNUAdj = sensitivity * (15 - rts) * 0.12;
    riverFNUAdj = Math.max(-20, Math.min(8, riverFNUAdj));
  }
  let satAdj = 0;
  if (cond.satTurbidity != null && cond.satTurbidityAge != null) {
    const satConfidence = Math.max(0, 1 - cond.satTurbidityAge / 3);
    if (satConfidence > 0) {
      const satPenalty = cond.satTurbidity > 60 ? Math.min(95, cond.satTurbidity * 1.2) * satConfidence : cond.satTurbidity > 20 ? cond.satTurbidity * 0.6 * satConfidence : 0;
      const satBonus = cond.satTurbidity < 20 ? (20 - cond.satTurbidity) * 0.3 * satConfidence : 0;
      satAdj = satBonus - satPenalty;
    }
  }
  let webcamAdj = 0;
  if (cond.webcamTurbidity != null && cond.webcamAgeMinutes != null) {
    const isCached = cond.webcamSource === "supabase";
    const decayWindow = isCached ? 720 : 120;
    const ageFade = Math.max(0, 1 - cond.webcamAgeMinutes / decayWindow);
    const solar = cond.webcamSolarConfidence ?? 0.5;
    const webcamConfidence = ageFade * solar;
    if (webcamConfidence > 0) {
      const wt = cond.webcamTurbidity;
      const penalty = wt > 60 ? Math.min(80, wt * 1.0) * webcamConfidence : wt > 25 ? wt * 0.5 * webcamConfidence : 0;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }
  try {
    const { cond, spot, W } = await req.json();
    if (!cond || !spot || !W) return new Response(JSON.stringify({ error: "cond, spot, W required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    const result = scoreSpot(cond, spot, W);
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=900" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});