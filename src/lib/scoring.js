// ── Scoring engine — IP protected via Supabase Edge Function ─────────────────
// All scoring logic (weights, formulas, spot configs) lives server-side.
// This stub sends cond + spot + W to the Edge Function and returns the result.
// The app interface is identical — callers don't need to change.

// Supabase Edge Function — ONNX scoring (Deno, deployed via supabase functions deploy)
import { SUPABASE_KEY } from "./supabase.js";
const SCORE_API  = "https://mgcwrktuplnjtxkbsypc.supabase.co/functions/v1/score-full";
const SCORE_KEY  = SUPABASE_KEY;

// In-memory cache: keyed by spot name + hour + build timestamp
// __BUILD_TS__ is injected by vite.config.js (= Netlify COMMIT_REF or Date.now())
// This ensures every new deploy auto-busts stale cached scores.
const _BUILD_TS = (typeof __BUILD_TS__ !== "undefined") ? __BUILD_TS__ : "dev";
const _scoreCache = new Map();

export async function scoreSpot(cond, spot, W) {
  // Cache key: spot + date + build timestamp (for forecast) or current 15min bucket (for today)
  const dateKey = cond._forecastDate ?? Math.floor(Date.now() / 900000);
  const key = `${spot.name}:${dateKey}:${_BUILD_TS}`;
  if (_scoreCache.has(key)) return _scoreCache.get(key);

  try {
    const res = await fetch(SCORE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + SCORE_KEY,
      },
      body: JSON.stringify({ cond, spot, W }),
    });
    if (!res.ok) throw new Error(`Score API ${res.status}`);
    const result = await res.json();
    _scoreCache.set(key, result);
    return result;
  } catch (err) {
    console.error("[scoreSpot] API error:", err.message);
    return { score: 0, plumeReach: 0, factors: { error: err.message } };
  }
}

// ── Utility helpers ───────────────────────────────────────────────────────────

export function safe(v) { return (v != null && !isNaN(v)) ? v : 0; }

export function dirName(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function parseDateLocal(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day);
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function scoreToColor(score) {
  if (score >= 80) return "#00e5a0";
  if (score >= 60) return "#7dd64f";
  if (score >= 40) return "#f0a030";
  if (score >= 20) return "#f07040";
  return "#e03030";
}

export function scoreToLabel(score) {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Marginal";
  if (score >= 20) return "Poor";
  return "Not Diveable";
}

// ── Data-driven visibility label ─────────────────────────────────────────────
// Uses community dive logs to show observed visibility per spot.
// Returns null if < 3 observations (UI shows nothing).
export function visLabel(score, spotName, entries) {
  const MIN_OBS = 3;
  // Normalise spot name for fuzzy matching — handle legacy name variants
  // e.g. "Nga Motu — Inshore (Back Beach)" matches "Nga Motu — Inshore (Port Taranaki)"
  const normSpot = (s) => (s ?? "").split(/[—–(]/)[0].trim().toLowerCase();
  const normTarget = normSpot(spotName);
  const spotLogs = (entries ?? []).filter(e => {
    const ov = e.observedVis ?? e.observed_vis ?? 0;
    const ms = e.modelScore ?? e.model_score ?? 0;
    const nameMatch = e.spot === spotName || normSpot(e.spot) === normTarget;
    return nameMatch && ov > 0 && ms > 0;
  });
  if (spotLogs.length < MIN_OBS) return null;
  // Find logs near this score (±20 pts)
  const nearby = spotLogs.filter(e => Math.abs((e.modelScore ?? e.model_score ?? 0) - score) <= 20);
  const pool = nearby.length >= MIN_OBS ? nearby : spotLogs;
  const visSorted = pool.map(e => e.observedVis ?? e.observed_vis).sort((a, b) => a - b);
  const medVis = visSorted[Math.floor(visSorted.length / 2)];
  const minVis = visSorted[0];
  const maxVis = visSorted[visSorted.length - 1];
  const suffix = nearby.length >= MIN_OBS ? " observed" : " at this spot";
  if (maxVis - minVis >= 2) return `${minVis.toFixed(0)}–${maxVis.toFixed(0)}m${suffix}`;
  return `~${medVis.toFixed(0)}m${suffix}`;
}

export function scoreToVis(score) {
  if (score >= 80) return 12;
  if (score >= 60) return 7;
  if (score >= 40) return 4;
  if (score >= 20) return 2;
  return 0.5;
}

// ── Bias correction from community dive logs ──────────────────────────────────

export function spotBiasMultiplier(spotName, entries) {
  const normSpotB = (s) => (s ?? "").split(/[—–(]/)[0].trim().toLowerCase();
  const normTargetB = normSpotB(spotName);
  const spotEntries = entries
    .filter(e => {
      const ms = e.modelScore ?? e.model_score ?? 0;
      const ov = e.observedVis ?? e.observed_vis ?? 0;
      const nameMatch = e.spot === spotName || normSpotB(e.spot) === normTargetB;
      return nameMatch && ms > 0 && ov > 0;
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

export function applyBias(score, biasMult) {
  if (Math.abs(biasMult - 1.0) < 0.03) return score;
  const vis = scoreToVis(score) * biasMult;
  if (vis >= 10) return Math.min(100, score + 10);
  if (vis >= 7)  return Math.min(100, score + 5);
  if (vis >= 4)  return score;
  if (vis >= 2)  return Math.max(0, score - 10);
  if (vis >= 1)  return Math.max(0, score - 20);
  return Math.max(0, score - 30);
}
