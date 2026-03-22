// netlify/functions/score.js
// ══════════════════════════════════════════════════════════════════════════════
// Vizcast ONNX scoring function
// Receives { cond, spot, W } from App.jsx, builds the 333-feature vector,
// runs the XGBoost ONNX model, returns { score, predicted_ntu, factors, plumeReach }
//
// Model files served from Supabase Storage (too large to bundle with function):
//   vizcast-models/vizcast_model.onnx
//   vizcast-models/vizcast_model_cols.json
//   vizcast-models/vizcast_model_meta.json
// ══════════════════════════════════════════════════════════════════════════════

const os   = require("os");
const path = require("path");
const fs   = require("fs");

const SUPABASE_STORAGE = "https://mgcwrktuplnjtxkbsypc.supabase.co/storage/v1/object/public/vizcast-models";

// ── Lazy-load ONNX runtime (cold start optimisation) ─────────────────────────
let ort = null;
let session = null;
let MODEL_COLS = null;
let MODEL_META = null;

async function fetchToTmp(url, filename) {
  // Download file from Supabase Storage and cache in /tmp
  // /tmp persists across warm Lambda invocations — only downloads once per container
  const tmpPath = path.join(os.tmpdir(), filename);
  if (fs.existsSync(tmpPath)) return tmpPath;

  console.log(`[score] Downloading ${filename} from Supabase Storage...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPath, buf);
  console.log(`[score] Cached ${filename} (${buf.length} bytes)`);
  return tmpPath;
}

async function loadModel() {
  if (session) return;

  ort = require("onnxruntime-node");

  const [modelPath, colsPath, metaPath] = await Promise.all([
    fetchToTmp(`${SUPABASE_STORAGE}/vizcast_model.onnx`,      "vizcast_model.onnx"),
    fetchToTmp(`${SUPABASE_STORAGE}/vizcast_model_cols.json`, "vizcast_model_cols.json"),
    fetchToTmp(`${SUPABASE_STORAGE}/vizcast_model_meta.json`, "vizcast_model_meta.json"),
  ]);

  session    = await ort.InferenceSession.create(modelPath);
  MODEL_COLS = JSON.parse(fs.readFileSync(colsPath, "utf8"));
  MODEL_META = JSON.parse(fs.readFileSync(metaPath, "utf8"));

  console.log(`[score] Model loaded — ${MODEL_COLS.length} features`);
}

// ── Spot metadata (mirrors build_regression_features.py SPOT_META) ───────────
const SPOT_META = {
  "Motumahanga (Saddleback Is.)": { spot_id:"motumahanga",      papa_risk:0.5, depth_m:12, swell_exposure:0.7, shelter:0.3 },
  "Nga Motu — Inshore (Port Taranaki)": { spot_id:"nga_motu",   papa_risk:0.7, depth_m:8,  swell_exposure:0.4, shelter:0.6 },
  "Fin Fuckers (Cape Egmont / Warea)":  { spot_id:"fin_fuckers",papa_risk:0.3, depth_m:10, swell_exposure:0.9, shelter:0.1 },
  "Opunake":                            { spot_id:"opunake",     papa_risk:0.2, depth_m:8,  swell_exposure:0.6, shelter:0.4 },
  "Patea — Inshore":                    { spot_id:"patea_inshore",papa_risk:0.9,depth_m:5,  swell_exposure:0.5, shelter:0.5 },
  "Patea — Offshore Trap":              { spot_id:"patea_offshore",papa_risk:0.6,depth_m:18,swell_exposure:0.7, shelter:0.3 },
  "The Metal Reef":                     { spot_id:"metal_reef",  papa_risk:0.5, depth_m:14, swell_exposure:0.5, shelter:0.5 },
  "Aeroplane Island":                   { spot_id:"aeroplane_island",papa_risk:0.2,depth_m:15,swell_exposure:0.8,shelter:0.2 },
  "Tokahaki":                           { spot_id:"tokahaki",    papa_risk:0.3, depth_m:10, swell_exposure:0.6, shelter:0.4 },
  "Kapiti West":                        { spot_id:"kapiti_west", papa_risk:0.2, depth_m:12, swell_exposure:0.9, shelter:0.1 },
};

// Spot ID → integer encoding (sorted alphabetical, mirrors build script)
const SPOT_ORDER = [
  "aeroplane_island","fin_fuckers","kapiti_west","metal_reef",
  "motumahanga","nga_motu","opunake","patea_inshore","patea_offshore",
  "rgv_reef","the_aquarium","tokahaki",
];
const SPOT_ENC = Object.fromEntries(SPOT_ORDER.map((s, i) => [s, i]));

// ── Wind component conversion (matches build_regression_features.py) ─────────
// wind_u = -speed * sin(dir_rad)   (positive = easterly)
// wind_v = -speed * cos(dir_rad)   (positive = northerly)
function windUV(speed_kmh, dir_deg) {
  const r = (dir_deg ?? 0) * Math.PI / 180;
  const s = speed_kmh ?? 0;
  return { u: -s * Math.sin(r), v: -s * Math.cos(r) };
}

// ── Build feature vector from cond + spot ────────────────────────────────────
function buildFeatureVector(cond, spot) {
  const now = new Date();
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const month = now.getMonth() + 1;

  const meta = SPOT_META[spot.name] ?? {
    spot_id: spot.name.toLowerCase().replace(/\s+/g,"_"),
    papa_risk: 0.5, depth_m: 10, swell_exposure: 0.5, shelter: 0.5,
  };
  const spot_enc = SPOT_ENC[meta.spot_id] ?? 0;

  // hist22 arrays: index 0=today, index N=N days ago
  const h = cond.hist22 ?? {};
  const swellH  = h.swell_h     ?? [];
  const swellP  = h.swell_p     ?? [];
  const swellDir= h.swell_dir   ?? [];
  const swellWH = h.swell_wave_h?? [];
  const swellWP = h.swell_wave_p?? [];
  const windSpd = h.wind_spd    ?? [];
  const windDir = h.wind_dir    ?? [];
  const sstArr  = h.sst         ?? [];
  const rainArr = h.rain        ?? [];

  // Helper: get day-N value (0=today), fallback to scalar cond value
  const sh  = (i) => swellH[i]  ?? cond.swell_h     ?? 0;
  const sp  = (i) => swellP[i]  ?? cond.swell_p     ?? 0;
  const sd  = (i) => swellDir[i]?? cond.swell_dir   ?? 0;
  const swh = (i) => swellWH[i] ?? cond.swell_wave_h?? 0;
  const swp = (i) => swellWP[i] ?? cond.swell_wave_p?? 0;
  const ws  = (i) => windSpd[i] ?? cond.wind_spd    ?? 0;
  const wd  = (i) => windDir[i] ?? cond.wind_dir    ?? 0;
  const sst = (i) => sstArr[i]  ?? cond.sst         ?? 16;
  const rn  = (i) => rainArr[i] ?? 0;

  // Wind u/v per lag day
  const wu = (i) => windUV(ws(i), wd(i)).u;
  const wv = (i) => windUV(ws(i), wd(i)).v;

  // Summary stats
  const avg = (arr, n) => { const s = arr.slice(0,n); return s.length ? s.reduce((a,b)=>a+b,0)/s.length : 0; };
  const max = (arr, n) => { const s = arr.slice(0,n); return s.length ? Math.max(...s) : 0; };
  const sum = (arr, n) => arr.slice(0,n).reduce((a,b)=>a+b,0);

  const rain7  = sum(rainArr, 7);
  const rain14 = sum(rainArr, 14);
  const rain24h = rn(0);
  const rain72h = rn(0) + rn(1) + rn(2);

  // days_since_rain: count back from today until rain > 3mm
  let dsr = 0;
  for (let i = 0; i <= 21; i++) { if (rn(i) > 3) break; dsr++; }

  // Swell energy = height² × period (proxy for seabed disturbance energy)
  const swellEnergy = (i) => sh(i) * sh(i) * sp(i);
  const sst_avg7 = avg(sstArr, 7);
  const sst_trend7 = sstArr.length >= 7 ? (sstArr[0] - sstArr[6]) : 0;

  // NW wind pct — used as a bonus feature alongside u/v
  let nwCount = 0;
  for (let i = 0; i < Math.min(3, windDir.length); i++) {
    const d = wd(i); if (d >= 270 || d <= 90) nwCount++;
  }
  const nw_wind_pct_72h = windDir.length > 0 ? nwCount / Math.min(3, windDir.length) : 0;

  // Swell history rolling stats
  const swell_energy_now   = swellEnergy(0);
  const swell_h_avg_7d     = avg(swellH, 7);
  const swell_h_avg_72h    = avg(swellH, 3);
  const swell_h_peak_7d    = max(swellH, 7);
  const swell_h_peak_14d   = max(swellH, 14);
  const swell_energy_avg_7d= avg(swellH.map((v,i)=>swellEnergy(i)), 7);
  const swell_energy_peak_7d=max(swellH.map((v,i)=>swellEnergy(i)), 7);

  // days since big swell (>2m)
  let days_since_big_swell = 0;
  for (let i = 0; i <= 21; i++) { if (sh(i) > 2.0) break; days_since_big_swell = i + 1; }

  // Combined stress index
  const combined_stress = (rain14 / 50) * meta.papa_risk + (swell_h_avg_7d / 3) * meta.swell_exposure;

  // ── Assemble feature dict matching MODEL_COLS order ──────────────────────
  const feat = {};

  // Spot metadata
  feat["depth_m"]          = meta.depth_m;
  feat["papa_risk"]        = meta.papa_risk;
  feat["swell_exposure"]   = meta.swell_exposure;
  feat["shelter"]          = meta.shelter;
  feat["spot_enc"]         = spot_enc;
  feat["has_river_gauge"]  = (cond.riverFNU != null && cond.riverFNU > 0) ? 1 : 0;
  feat["has_trc_data"]     = feat["has_river_gauge"];

  // Seasonal
  feat["month_num"]        = month;
  feat["day_of_year"]      = doy;
  feat["sin_doy"]          = Math.sin(2 * Math.PI * doy / 365.25);
  feat["cos_doy"]          = Math.cos(2 * Math.PI * doy / 365.25);

  // Rain summaries
  feat["rain_24h"]         = rain24h;
  feat["rain_72h"]         = rain72h;
  feat["rain_7d"]          = rain7;
  feat["rain_14d"]         = rain14;
  feat["rain_peak_day_7d"] = max(rainArr, 7);
  feat["rain_peak_day_14d"]= max(rainArr, 14);
  feat["days_since_rain"]  = dsr;
  feat["rain_days_14d"]    = rainArr.slice(0,14).filter(v=>v>3).length;

  // Wind summaries
  feat["wind_speed_24h"]   = ws(0);
  feat["wind_speed_72h"]   = avg(windSpd, 3);
  feat["wind_speed_7d"]    = avg(windSpd, 7);
  feat["wind_dir_24h"]     = wd(0);
  feat["wind_dir_72h"]     = avg(windDir, 3);
  feat["wind_dir_7d"]      = avg(windDir, 7);
  feat["nw_wind_pct_72h"]  = nw_wind_pct_72h;
  feat["nw_wind_pct_7d"]   = nw_wind_pct_72h; // approximation
  feat["onshore_wind_pct_72h"] = nw_wind_pct_72h; // approximation

  // Swell summaries
  feat["swell_h"]          = sh(0);
  feat["swell_p"]          = sp(0);
  feat["swell_dir"]        = sd(0);
  feat["swell_wave_h"]     = swh(0);
  feat["swell_wave_p"]     = swp(0);
  feat["swell_wave_dir"]   = sd(0);
  feat["wind_wave_h"]      = cond.wind_wave_h ?? 0;
  feat["swell_energy_now"] = swell_energy_now;
  feat["swell_h_avg_72h"]  = swell_h_avg_72h;
  feat["swell_h_avg_7d"]   = swell_h_avg_7d;
  feat["swell_h_peak_7d"]  = swell_h_peak_7d;
  feat["swell_h_peak_14d"] = swell_h_peak_14d;
  feat["swell_energy_avg_7d"]  = swell_energy_avg_7d;
  feat["swell_energy_peak_7d"] = swell_energy_peak_7d;
  feat["days_since_big_swell"] = days_since_big_swell;

  // SST
  feat["sst"]              = sst(0);
  feat["sst_avg_7d"]       = sst_avg7;
  feat["sst_trend_7d"]     = sst_trend7;

  // River (live TRC gauge data if available)
  feat["river_fnu_d0"]     = cond.riverFNU ?? -999;
  feat["river_flow_d0"]    = cond.riverFlow ?? -999;
  feat["river_fnu_avg_7d"] = cond.riverFNU ?? -999;
  feat["river_fnu_peak_7d"]= cond.riverMaxFNU ?? cond.riverFNU ?? -999;
  feat["gauge_rain_7d"]    = rain7; // proxy

  // Interaction features
  feat["rain_x_papa"]      = rain14 * meta.papa_risk;
  feat["swell_x_exposure"] = swell_h_avg_7d * meta.swell_exposure;
  feat["combined_stress"]  = combined_stress;
  feat["dsr_x_depth"]      = dsr * meta.depth_m;

  // 21-day daily lag sequences — the main signal for the v3 model
  for (let d = 0; d <= 21; d++) {
    feat[`rain_d${d}`]       = rn(d);
    feat[`swell_h_d${d}`]    = sh(d);
    feat[`swell_p_d${d}`]    = sp(d);
    feat[`swell_dir_d${d}`]  = sd(d);
    feat[`wind_u_d${d}`]     = wu(d);
    feat[`wind_v_d${d}`]     = wv(d);
    feat[`wind_speed_kmh_d${d}`] = ws(d);
    feat[`sst_d${d}`]        = sst(d);
    feat[`river_fnu_d${d}`]  = d === 0 ? (cond.riverFNU ?? -999) : -999;
    feat[`river_flow_d${d}`] = d === 0 ? (cond.riverFlow ?? -999) : -999;
  }

  // ── Build the ordered float array ─────────────────────────────────────────
  return MODEL_COLS.map(col => {
    const v = feat[col];
    if (v === undefined || v === null || (typeof v === "number" && isNaN(v))) return -999;
    return Number(v);
  });
}

// ── NTU → 0-100 score conversion ─────────────────────────────────────────────
// From vizcast_model_meta.json thresholds (or defaults if meta not loaded)
function ntuToScore(ntu, meta) {
  if (!meta) {
    // Default thresholds (calibrated from S2 observations + dive logs)
    // NTU:  0   2   5   10  20  40  80  150
    // Score:100  90  75  58  40  22  10   0
    const breakpoints = [
      [0,   100], [2,  90], [5,  75], [10, 58],
      [20,   40], [40, 22], [80, 10], [150, 0],
    ];
    if (ntu <= 0)   return 100;
    if (ntu >= 150) return 0;
    for (let i = 1; i < breakpoints.length; i++) {
      const [lo, sLo] = breakpoints[i-1];
      const [hi, sHi] = breakpoints[i];
      if (ntu <= hi) {
        return Math.round(sLo + (sHi - sLo) * (ntu - lo) / (hi - lo));
      }
    }
    return 0;
  }
  // Use model meta thresholds if available
  const bp = meta.ntu_score_breakpoints;
  if (!bp || bp.length < 2) return Math.max(0, Math.round(100 - ntu * 0.7));
  if (ntu <= bp[0][0]) return 100;
  if (ntu >= bp[bp.length-1][0]) return 0;
  for (let i = 1; i < bp.length; i++) {
    const [lo, sLo] = bp[i-1];
    const [hi, sHi] = bp[i];
    if (ntu <= hi) return Math.round(sLo + (sHi - sLo) * (ntu - lo) / (hi - lo));
  }
  return 0;
}

// ── Plume reach — carried through from App.jsx logic ─────────────────────────
function plumeReachFactor(rainHistory) {
  if (!rainHistory || rainHistory.length === 0) return 0;
  const rain3d = rainHistory.slice(0, 3).reduce((a, b) => a + b, 0);
  const rain7d  = rainHistory.slice(0, 7).reduce((a, b) => a + b, 0);
  if (rain3d > 80) return 1.0;
  if (rain3d > 50) return 0.7;
  if (rain3d > 30) return 0.4;
  if (rain7d > 100) return 0.5;
  if (rain7d > 60)  return 0.3;
  return 0;
}

// ── Key scoring drivers for UI display ───────────────────────────────────────
function buildFactors(cond, ntu, score, spot) {
  const factors = {};
  const h = cond.hist22 ?? {};
  const rain7 = (h.rain ?? []).slice(0,7).reduce((a,b)=>a+b,0);
  const swell0 = h.swell_h?.[0] ?? cond.swell_h ?? 0;
  const sst0   = h.sst?.[0]    ?? cond.sst ?? 16;

  factors.swell   = swell0;
  factors.rain7d  = Math.round(rain7);
  factors.sst     = sst0;
  factors.riverFNU= cond.riverFNU ?? null;

  // Human-readable drivers
  const drivers = [];
  if (swell0 > 2.5) drivers.push(`Big swell (${swell0.toFixed(1)}m)`);
  if (rain7 > 40)   drivers.push(`Recent heavy rain (${Math.round(rain7)}mm/7d)`);
  if (sst0 < 16)    drivers.push(`Cold water (${sst0.toFixed(1)}°C)`);
  if (cond.riverFNU > 50) drivers.push(`High river turbidity (${Math.round(cond.riverFNU)} FNU)`);
  if (score > 75)   drivers.push("Clean conditions");
  if (drivers.length === 0) drivers.push("Average conditions");

  factors.drivers = drivers;
  return factors;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function(event, context) {
  // CORS headers — allow requests from any Netlify deploy + localhost dev
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { cond, spot, W } = body;
  if (!cond || !spot) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing cond or spot" }) };
  }

  try {
    await loadModel();

    const featureVec = buildFeatureVector(cond, spot);
    const input  = new ort.Tensor("float32", Float32Array.from(featureVec), [1, featureVec.length]);
    const output = await session.run({ [session.inputNames[0]]: input });
    const predicted_ntu = Math.max(0, output[session.outputNames[0]].data[0]);

    const score      = ntuToScore(predicted_ntu, MODEL_META);
    const plumeReach = plumeReachFactor(cond.rainHistory ?? []);
    const factors    = buildFactors(cond, predicted_ntu, score, spot);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        score:         Math.round(score),
        predicted_ntu: Math.round(predicted_ntu * 10) / 10,
        plumeReach,
        factors,
        model:         "onnx-xgboost-s2",
      }),
    };

  } catch (err) {
    console.error("[score] ONNX inference error:", err.message, err.stack);
    // Return a 200 with fallback score so the app doesn't break
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        score:         50,
        predicted_ntu: null,
        plumeReach:    0,
        factors:       { drivers: ["Model error — using fallback"] },
        error:         err.message,
        model:         "fallback",
      }),
    };
  }
};
