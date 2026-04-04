import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import './App.css';
import { REGIONS, getSPOTS, getW } from "./spots/index.js";
import { SUPABASE_URL, SUPABASE_KEY, sbFetch, fetchCommunityLogs, insertLog, getPlatform, logUsageEvent, todayNZ, fetchStoredWebcamReadings, upsertWebcamReading, SEED_LOGS, seedLogsIfEmpty } from "./lib/supabase.js";
import { LOG_KEY, loadLog, saveLog, useCommunityLogs } from "./hooks/useDiveLogs.js";
import { fetchOceanCurrent, TRC_RIVER_SITES, fnuToScore, fetchTRCRiverData } from "./hooks/useRiver.js";
import { scoreSpot, safe, dirName, parseDateLocal, scoreToColor, scoreToLabel, visLabel, scoreToVis, spotBiasMultiplier, applyBias } from "./lib/scoring.js";
import { latLonToTilePx, classifyPixel, calcTurbidity, sampleGibsTile } from "./lib/satellite.js";
import { PRIMO_CAMS, calcWebcamTurbidity, calcWebcamSurfaceState, solarConfidence, solarWindowLabel, samplePrimoCams } from "./lib/webcam.js";
import { nowIdx, dailyRainHistory, dailySwellHistory, rain48h, daysSinceRain, maxSwellPast, condFromHourly, dailyAvgHistory } from "./lib/weather.js";
import { getDailyScores, plumeReachFactor, recoveryBonus, getAdvice } from "./lib/forecast.js";
import { FactorBar, ScoreChart, ConditionsChart, ForecastBar, WindForecastBar } from "./components/Charts.jsx";
import { DataSourcesPage } from "./pages/DataSources.jsx";
import { SeasonalPage } from "./pages/Seasonal.jsx";
import { getShareText, ShareButtons, WelcomeBanner, CommunityLogPanel, CommunityStats, GrowthNudge } from "./components/Community.jsx";
import { SpotCard } from "./components/SpotCard.jsx";
import { BestDayPanel, AdvicePanel, Legend } from "./components/Panels.jsx";
import { SpotMap } from "./components/Map.jsx";
import { useAllSpotsData } from "./hooks/useAllSpotsData.js";







// ══════════════════════════════════════════════════════════════════════════════
// DATA SOURCES & VALIDATION PAGE
// ══════════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [region, setRegion] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const r = p.get("region"); return (r === "kapiti" || r === "spi") ? r : "taranaki";
    } catch(e) { return "taranaki"; }
  });
  const REGION = REGIONS[region];
  const SPOTS = useMemo(() => REGION.spots, [region]);
  const W     = useMemo(() => REGION.W,     [region]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("region", region);
      window.history.replaceState({}, "", url);
    } catch(e) {}
    logUsageEvent("session_start", region);
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
      await sbFetch("/users", {
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