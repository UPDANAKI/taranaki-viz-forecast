// ══════════════════════════════════════════════════════════════════════════════
// Vizcast Scoring Engine — Supabase Edge Function
// ══════════════════════════════════════════════════════════════════════════════
//
// This is the IP protection layer. All scoring logic, weights, spot configs,
// and calibration curves live here — server-side. The frontend only receives
// a finished score. No formula is ever exposed to the client.
//
// Deploy:
//   supabase functions deploy score
//
// Invoke:
//   POST https://<project>.supabase.co/functions/v1/score
//   Body: { spot_id, wind_kmh, wind_dir, rain_24h, rain_72h, swell_h,
//           swell_period, sst, tide_m, tide_phase, days_since_rain,
//           onshore_wind_pct, nw_wind_pct }
//
// Response:
//   { score, label, vis_m, confidence, drivers, sensor, data_age_days }
//
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── SPOT CONFIG ───────────────────────────────────────────────────────────────
// Per-spot metadata — this is your domain knowledge, never sent to client
const SPOT_CONFIG: Record<string, SpotConfig> = {
  nga_motu:         { papa_risk: 0.7, depth_m: 8,  swell_exposure: 0.4, seasonal_bias: 1.1, recovery_days: 4 },
  motumahanga:      { papa_risk: 0.5, depth_m: 12, swell_exposure: 0.7, seasonal_bias: 1.0, recovery_days: 4 },
  fin_fuckers:      { papa_risk: 0.3, depth_m: 10, swell_exposure: 0.9, seasonal_bias: 1.0, recovery_days: 3 },
  opunake:          { papa_risk: 0.2, depth_m: 8,  swell_exposure: 0.6, seasonal_bias: 0.9, recovery_days: 2 },
  patea_inshore:    { papa_risk: 0.9, depth_m: 5,  swell_exposure: 0.5, seasonal_bias: 1.2, recovery_days: 5 },
  patea_offshore:   { papa_risk: 0.6, depth_m: 18, swell_exposure: 0.7, seasonal_bias: 1.1, recovery_days: 5 },
  metal_reef:       { papa_risk: 0.5, depth_m: 14, swell_exposure: 0.5, seasonal_bias: 1.0, recovery_days: 4 },
  aeroplane_island: { papa_risk: 0.2, depth_m: 15, swell_exposure: 0.8, seasonal_bias: 0.9, recovery_days: 3 },
  tokahaki:         { papa_risk: 0.3, depth_m: 10, swell_exposure: 0.6, seasonal_bias: 1.0, recovery_days: 3 },
  kapiti_west:      { papa_risk: 0.2, depth_m: 12, swell_exposure: 0.9, seasonal_bias: 0.9, recovery_days: 3 },
  rgv_reef:         { papa_risk: 0.1, depth_m: 20, swell_exposure: 0.5, seasonal_bias: 1.0, recovery_days: 2 },
  the_aquarium:     { papa_risk: 0.1, depth_m: 37, swell_exposure: 0.4, seasonal_bias: 1.0, recovery_days: 2 },
}

// ── SCORING WEIGHTS ───────────────────────────────────────────────────────────
// Derived from regression analysis (analyze_vizcast.py)
// Update these after each re-run of the regression — never hardcode in frontend
const WEIGHTS = {
  wind:          0.38,   // wind speed + direction combined
  rain:          0.16,   // rain_72h is the best single window
  swell:         0.15,   // swell_energy_now is strongest swell feature
  seasonal:      0.10,   // SST trend + day-of-year
  interaction:   0.085,  // rain × papa, combined_stress
  tidal:         0.072,  // tide_m, tide_phase
  papa:          0.056,  // static papa risk (amplifies rain score)
}

// ── SEASONAL NTU BASELINES ────────────────────────────────────────────────────
// Median NTU per spot per month — from analyze_vizcast.py seasonal table
// Used to set context for the score (is today better or worse than normal?)
// months are 1-indexed
const SEASONAL_BASELINE: Record<string, number[]> = {
  //                      J     F     M     A     M     J     J     A     S     O     N     D
  nga_motu:         [0,  3.3,  2.5,  0.9,  0.9,  1.1,  1.5,  1.9,  2.5,  5.0,  6.7,  8.2,  6.5],
  motumahanga:      [0,  3.1,  2.1,  1.1,  0.8,  1.0,  0.7,  1.7,  1.4,  3.2,  3.5,  5.4,  8.5],
  fin_fuckers:      [0,  3.9,  3.4,  2.0,  5.8,  6.9,  5.1, 12.4,  6.6, 10.3,  9.9,  8.1,  7.8],
  opunake:          [0,  7.0,  3.8,  3.9,  3.0,  5.6,  2.0,  7.9,  5.3,  8.5,  8.6,  6.6,  7.1],
  patea_inshore:    [0,  7.5,  5.7,  5.9,  5.2,  5.8,  8.1,  6.2, 10.3, 10.2,  9.0,  9.0,  7.0],
  patea_offshore:   [0,  3.6,  2.1,  1.5,  0.7,  1.0,  0.8,  1.0,  1.4,  2.0,  3.0,  4.5,  4.7],
  metal_reef:       [0,  1.3,  1.5,  0.7,  0.6,  1.1,  0.3,  0.4,  0.9,  2.2,  3.8,  2.7,  3.7],
  aeroplane_island: [0,  4.7,  4.2,  2.4,  1.9,  1.8,  1.9,  2.1,  3.1,  3.2,  4.8,  6.1, 14.3],
  tokahaki:         [0,  1.8,  0.7,  1.0,  0.8,  0.2,  0.6,  0.9,  1.2,  1.6,  2.5,  4.9,  1.4],
  kapiti_west:      [0,  2.2,  2.2,  0.9,  0.6,  0.6,  0.4,  0.7,  1.3,  1.4,  2.2,  3.1,  1.8],
  rgv_reef:         [0,  2.5,  2.5,  2.5,  null, null, null, null, null,  null, 2.2,  1.8,  2.0],
  the_aquarium:     [0,  2.7,  3.1,  1.3,  null, null, null, null, null,  null, 2.0,  2.5,  0.3],
}

// ── NTU → VIS_M CALIBRATION ───────────────────────────────────────────────────
// Power law: vis_m = A × NTU^B
// Fitted from dive log ground truth — update as more dive logs accumulate
const CALIBRATION = { A: 8.4, B: -0.52 }

function ntuToVis(ntu: number): number {
  if (ntu <= 0) return 25  // clear water ceiling
  return Math.min(25, Math.round(CALIBRATION.A * Math.pow(ntu, CALIBRATION.B) * 10) / 10)
}

// ── SCORE CALCULATORS ─────────────────────────────────────────────────────────

function scoreRain(rain_72h: number, rain_24h: number, days_since_rain: number,
                   papa_risk: number, recovery_days: number): number {
  // 72h window is the best predictor per regression
  const rain_base = Math.min(1, rain_72h / 60)   // 60mm in 72h = saturated score
  const recency   = Math.max(0, 1 - days_since_rain / recovery_days)
  const rain_x_papa = rain_base * papa_risk      // interaction term
  return (rain_base * 0.6 + recency * 0.2 + rain_x_papa * 0.2)
}

function scoreWind(wind_kmh: number, wind_dir: number,
                   onshore_pct: number, nw_pct: number): number {
  // High wind = murky; onshore wind = worse; NW wind at Taranaki = blue water push
  const speed_score    = Math.min(1, wind_kmh / 60)
  const onshore_score  = onshore_pct   // 0-1 fraction of last 72h
  const nw_bonus       = nw_pct * 0.3  // NW wind can bring cleaner oceanic water
  return Math.max(0, speed_score * 0.6 + onshore_score * 0.4 - nw_bonus)
}

function scoreSwell(swell_h: number, swell_period: number, depth_m: number): number {
  // swell_energy = h² × period (proxy for seabed disturbance)
  const energy = swell_h * swell_h * swell_period
  // Period × depth factor: period² × 0.12 = disturbance depth in metres
  const disturbance_depth = swell_period * swell_period * 0.12
  const depth_factor = Math.min(1, disturbance_depth / depth_m)
  const energy_score = Math.min(1, energy / 80)  // 80 = rough saturation
  return energy_score * (0.7 + depth_factor * 0.3)
}

function scoreTide(tide_m: number, tide_phase: string): number {
  // Falling tide = cleanest, low tide = murkiest (NZ)
  // Positive tide height slightly murkier
  const height_score = Math.min(0.3, Math.max(0, tide_m / 3) * 0.3)
  const phase_score  = tide_phase === 'FALLING' ? 0
                     : tide_phase === 'RISING'  ? 0.15
                     : tide_phase === 'HIGH'    ? 0.2
                     : 0.25  // LOW = worst
  return height_score + phase_score
}

function scoreSeasonal(month: number, sst_trend_7d: number,
                       spot_id: string): number {
  const baseline = SEASONAL_BASELINE[spot_id]?.[month] ?? 5
  // Higher baseline month = worse seasonal conditions
  const seasonal = Math.min(1, baseline / 20)
  // Falling SST = upwelling = murkier water
  const sst_score = sst_trend_7d < -0.5 ? 0.2 : 0
  return seasonal * 0.8 + sst_score * 0.2
}

// ── CONFIDENCE SCORE ──────────────────────────────────────────────────────────
// How much we trust this forecast — based on data recency
function calcConfidence(data_age_days: number, sensor: string): number {
  // Exponential decay: 7-day half-life
  const recency_weight = Math.exp(-data_age_days / 7)
  // Sentinel-2 > MODIS for confidence
  const sensor_weight  = sensor === 'sentinel2' ? 1.0
                       : sensor === 'modis_aqua' ? 0.75
                       : 0.5
  return Math.round(recency_weight * sensor_weight * 100) / 100
}

// ── KEY DRIVERS ───────────────────────────────────────────────────────────────
// Returns the 2-3 top factors making it good or bad today — shown to user
function getDrivers(scores: Record<string, number>, spot: SpotConfig): string[] {
  const drivers: string[] = []
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])

  for (const [key, score] of sorted.slice(0, 3)) {
    if (score > 0.4) {
      const labels: Record<string, string> = {
        rain:     'Recent rainfall',
        wind:     'Strong onshore wind',
        swell:    'Swell disturbing seabed',
        tidal:    'Tidal conditions',
        seasonal: 'Seasonal conditions',
      }
      if (labels[key]) drivers.push(labels[key])
    }
  }

  if (drivers.length === 0) drivers.push('Conditions look settled')
  return drivers
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS for browser clients
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      }
    })
  }

  try {
    const body = await req.json()
    const {
      spot_id,
      wind_kmh        = 0,
      wind_dir        = 0,
      rain_24h        = 0,
      rain_72h        = 0,
      swell_h         = 0,
      swell_period    = 8,
      sst_trend_7d    = 0,
      tide_m          = 0,
      tide_phase      = 'RISING',
      days_since_rain = 7,
      onshore_wind_pct= 0,
      nw_wind_pct     = 0,
      data_age_days   = 0,
      sensor          = 'sentinel2',
      month           = new Date().getMonth() + 1,
    } = body

    if (!spot_id) {
      return new Response(JSON.stringify({ error: 'spot_id required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const spot = SPOT_CONFIG[spot_id]
    if (!spot) {
      return new Response(JSON.stringify({ error: `unknown spot: ${spot_id}` }), {
        status: 404, headers: { 'Content-Type': 'application/json' }
      })
    }

    // ── Run sub-scores (each 0-1, higher = murkier) ───────────────────────────
    const sub_scores = {
      rain:     scoreRain(rain_72h, rain_24h, days_since_rain, spot.papa_risk, spot.recovery_days),
      wind:     scoreWind(wind_kmh, wind_dir, onshore_wind_pct, nw_wind_pct),
      swell:    scoreSwell(swell_h, swell_period, spot.depth_m),
      tidal:    scoreTide(tide_m, tide_phase),
      seasonal: scoreSeasonal(month, sst_trend_7d, spot_id),
    }

    // ── Weighted turbidity index (0-1, higher = murkier) ─────────────────────
    const turbidity_index =
      sub_scores.rain     * WEIGHTS.rain     +
      sub_scores.wind     * WEIGHTS.wind     +
      sub_scores.swell    * WEIGHTS.swell    +
      sub_scores.tidal    * WEIGHTS.tidal    +
      sub_scores.seasonal * WEIGHTS.seasonal

    // Apply spot seasonal bias
    const adjusted = Math.min(1, turbidity_index * spot.seasonal_bias)

    // ── Convert to NTU estimate then vis_m ────────────────────────────────────
    const estimated_ntu = adjusted * 40  // 40 NTU = very murky practical ceiling
    const vis_m         = ntuToVis(estimated_ntu)

    // ── Final score (0-100, higher = better visibility) ───────────────────────
    const score = Math.round((1 - adjusted) * 100)

    // ── Label ─────────────────────────────────────────────────────────────────
    const label = score >= 75 ? 'Excellent'
                : score >= 55 ? 'Good'
                : score >= 35 ? 'Marginal'
                : score >= 20 ? 'Poor'
                : 'Terrible'

    const confidence = calcConfidence(data_age_days, sensor)
    const drivers    = getDrivers(sub_scores, spot)

    const response = {
      score,
      label,
      vis_m,
      confidence,
      drivers,
      sensor,
      data_age_days,
      // sub_scores intentionally NOT included — would expose weights
    }

    return new Response(JSON.stringify(response), {
      headers: {
        'Content-Type':                 'application/json',
        'Access-Control-Allow-Origin':  '*',
        'Cache-Control':                'public, max-age=900',  // 15 min cache
      }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

// ── TYPES ─────────────────────────────────────────────────────────────────────
interface SpotConfig {
  papa_risk:      number
  depth_m:        number
  swell_exposure: number
  seasonal_bias:  number
  recovery_days:  number
}
