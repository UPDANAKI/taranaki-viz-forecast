// ══════════════════════════════════════════════════════════════════════════════
// vizcast-api.js — thin client for the Vizcast scoring Edge Function
// ══════════════════════════════════════════════════════════════════════════════
//
// Drop this into src/ and import it in App.jsx.
// This replaces ALL the scoring logic currently in App.jsx.
// No weights, no formulas, no spot configs in the frontend.
//
// Usage:
//   import { getSpotForecast } from './vizcast-api.js'
//   const forecast = await getSpotForecast('nga_motu', weatherData, marineData)
//   // → { score: 72, label: 'Good', vis_m: 6.5, confidence: 0.87,
//   //     drivers: ['Recent rainfall', 'Swell disturbing seabed'],
//   //     sensor: 'sentinel2', data_age_days: 2 }
// ══════════════════════════════════════════════════════════════════════════════

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/score`
const ANON_KEY          = import.meta.env.VITE_SUPABASE_ANON_KEY

// Cache results for 15 minutes — same as the Edge Function's Cache-Control
const _cache = new Map()

export async function getSpotForecast(spot_id, weather, marine, options = {}) {
  const cacheKey = `${spot_id}:${new Date().toISOString().slice(0, 13)}`
  if (_cache.has(cacheKey)) return _cache.get(cacheKey)

  const payload = {
    spot_id,

    // Wind
    wind_kmh:          weather?.windspeed_10m         ?? 0,
    wind_dir:          weather?.winddirection_10m      ?? 0,
    onshore_wind_pct:  weather?.onshore_wind_pct_72h  ?? 0,
    nw_wind_pct:       weather?.nw_wind_pct_72h       ?? 0,

    // Rain
    rain_24h:          weather?.rain_24h               ?? 0,
    rain_72h:          weather?.rain_72h               ?? 0,
    days_since_rain:   weather?.days_since_rain        ?? 7,

    // Swell
    swell_h:           marine?.swell_wave_height       ?? 0,
    swell_period:      marine?.swell_wave_period       ?? 8,

    // SST
    sst_trend_7d:      marine?.sst_trend_7d            ?? 0,

    // Tide
    tide_m:            options.tide_m                  ?? 0,
    tide_phase:        options.tide_phase              ?? 'RISING',

    // Data quality — drives confidence score
    data_age_days:     options.data_age_days           ?? 0,
    sensor:            options.sensor                  ?? 'sentinel2',

    // Seasonal context
    month:             new Date().getMonth() + 1,
  }

  try {
    const res = await fetch(EDGE_FUNCTION_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) throw new Error(`Score API ${res.status}`)

    const forecast = await res.json()
    _cache.set(cacheKey, forecast)
    return forecast

  } catch (err) {
    console.error('Vizcast score API error:', err)
    // Graceful fallback — return a neutral score rather than crashing
    return {
      score:         50,
      label:         'Unknown',
      vis_m:         null,
      confidence:    0,
      drivers:       ['Data unavailable'],
      sensor:        null,
      data_age_days: null,
      error:         err.message,
    }
  }
}

// ── Batch fetch all spots ──────────────────────────────────────────────────────
// Fetches forecasts for multiple spots in parallel
export async function getAllSpotForecasts(spots, getWeatherFn, getMarineFn) {
  const results = await Promise.allSettled(
    spots.map(async spot => {
      const weather = await getWeatherFn(spot.spot_id)
      const marine  = await getMarineFn(spot.spot_id)
      const forecast = await getSpotForecast(spot.spot_id, weather, marine)
      return { spot_id: spot.spot_id, ...forecast }
    })
  )

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { spot_id: spots[i].spot_id, score: 50, label: 'Unknown', error: r.reason?.message }
  )
}
