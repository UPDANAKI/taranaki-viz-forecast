// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG — Community Shared Logging
// ══════════════════════════════════════════════════════════════════════════════
// Supabase is now per-region — see REGIONS config
export const SUPABASE_URL = "https://mgcwrktuplnjtxkbsypc.supabase.co"; // Taranaki default
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY3dya3R1cGxuanR4a2JzeXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MjA3MzgsImV4cCI6MjA4ODA5NjczOH0.vk_ylXl3wny0NjIUD9D89324muA74bXx3Mg6Syq8yMA";

export async function sbFetch(path, options = {}) {
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

export async function fetchCommunityLogs() { return sbFetch("/dive_logs?order=created_at.desc&limit=500"); }
export async function insertLog(entry) { return sbFetch("/dive_logs", { method: "POST", body: JSON.stringify(entry), prefer: "return=representation" }); }

// ── Usage analytics — anonymous session + spot view logging ──────────────────
export function getPlatform() {
  const ua = navigator.userAgent;
  if (/Mobi|Android/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

export async function logUsageEvent(event, region, spotName = null) {
  try {
    await sbFetch("/usage_events", {
      method: "POST",
      body: JSON.stringify({
        event,
        region,
        spot_name: spotName,
        platform: getPlatform(),
        referrer: document.referrer || null,
      }),
      prefer: "return=minimal",
    });
  } catch(e) {
    // Silent fail — analytics should never break the app
  }
}

// ── Webcam morning readings — Supabase persistence ────────────────────────────
// Stores one morning (peak solar) webcam turbidity reading per spot per day.
// Table: webcam_readings  columns: date, spot_name, turbidity, surface_state,
//                                  cam_name, r, g, b, solar_confidence, fetched_at
// See webcam_readings_migration.sql to create the table.

export function todayNZ() {
  // Returns NZ local date string YYYY-MM-DD (UTC+12 approx; close enough for daily granularity)
  const now = new Date();
  const nz = new Date(now.getTime() + 13 * 3600 * 1000); // NZ is UTC+12/+13, use +13 (NZDT) as safe offset
  return nz.toISOString().split("T")[0];
}

export async function fetchStoredWebcamReadings(date) {
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

export async function upsertWebcamReading(date, spotName, data) {
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
export const SEED_LOGS = [
  { diver_name: "Mike", date: "2026-03-03", spot: "Motumahanga (Saddleback Is.)", observed_vis: 20, tide: "mid", model_score: 100, notes: "" },
  { diver_name: "Mike", date: "2026-03-02", spot: "Nga Motu — Inshore (Port Taranaki)", observed_vis: 3, tide: "low", model_score: 68, notes: "" },
  { diver_name: "Mike", date: "2026-02-23", spot: "Nga Motu — Inshore (Port Taranaki)", observed_vis: 3, tide: "high", model_score: 68, notes: "Affected by swell, dirty in close" },
  { diver_name: "Mike", date: "2026-02-13", spot: "Patea — Offshore Trap", observed_vis: 9.6, tide: "high", model_score: 100, notes: "Dirty layer on top, but clear underneath" },
  { diver_name: "Mike", date: "2026-01-27", spot: "Motumahanga (Saddleback Is.)", observed_vis: 15, tide: "low", model_score: 99, notes: "" },
];

export async function seedLogsIfEmpty() {
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
