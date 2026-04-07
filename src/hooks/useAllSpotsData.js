import { useState, useEffect, useRef, useCallback } from "react";
import { scoreSpot, dirName, spotBiasMultiplier, applyBias } from "../lib/scoring.js";
import { classifyPixel, sampleGibsTile } from "../lib/satellite.js";
import { samplePrimoCams } from "../lib/webcam.js";
import { nowIdx, dailyRainHistory, dailySwellHistory, rain48h, daysSinceRain, maxSwellPast, condFromHourly, dailyAvgHistory } from "../lib/weather.js";
import { getDailyScores } from "../lib/forecast.js";
import { todayNZ, fetchStoredWebcamReadings, upsertWebcamReading } from "../lib/supabase.js";
import { fetchOceanCurrent, fnuToScore, fetchTRCRiverData } from "./useRiver.js";

export function useAllSpotsData(logEntries, SPOTS, W, region) {
  // ── Shared ocean data ────────────────────────────────────────────────────
  const [currentData, setCurrentData]     = useState(null);
  const [currentStatus, setCurrentStatus] = useState("idle");
  const [currentBySpot, setCurrentBySpot] = useState({});
  const currentBySpotRef = useRef({});
  useEffect(() => { currentBySpotRef.current = currentBySpot; }, [currentBySpot]);

  // ── CHANGE 2: Satellite turbidity state ──────────────────────────────────
  const [satData, setSatData]     = useState({});   // { [spotName]: { turbidity, r, g, b, date, agedays } }
  const [satStatus, setSatStatus] = useState("idle");
  const satRef = useRef({});

  const [webcamData, setWebcamData]     = useState({});  // { [spotName]: { turbidity, surfaceState, camName, fetchedAt, ageMinutes } }
  const [webcamStatus, setWebcamStatus] = useState("idle");
  const webcamRef = useRef({});

  const [riverData, setRiverData]     = useState({});  // { [siteId]: { name, latestFNU, latestTime, trend, ... } }
  const [riverStatus, setRiverStatus] = useState("idle");
  const riverRef = useRef({});

  // ── Per-spot scored data ─────────────────────────────────────────────────
  const [spotDataMap, setSpotDataMap]     = useState({});
  const [loading, setLoading]             = useState(true);
  const [errors, setErrors]               = useState({});

  const currentRef  = useRef(null);

  useEffect(() => { currentRef.current  = currentData;  }, [currentData]);
  // CHANGE 2: Keep satRef in sync
  useEffect(() => { satRef.current = satData; }, [satData]);
  useEffect(() => { webcamRef.current = webcamData; }, [webcamData]);
  useEffect(() => { riverRef.current  = riverData;  }, [riverData]);

  const computeSpotResult = useCallback(async (spot, marine, weather, rtofs, entries, murSstByDate = null) => {
    const mTimes = marine.hourly?.time ?? [];
    const wTimes = weather.hourly?.time ?? [];
    const mIdx = nowIdx(mTimes);
    const wIdx = nowIdx(wTimes);

    let r48  = rain48h(wTimes, weather.hourly?.precipitation ?? []);
    let dsr  = daysSinceRain(weather.hourly?.precipitation ?? []);
    const hist = maxSwellPast(mTimes, marine.hourly?.wave_height ?? [], 72);
    const rainHist  = dailyRainHistory(wTimes, weather.hourly?.precipitation ?? [], 14);

    // Override rain with GWRC gauge data when available — far more accurate than
    // Open-Meteo for coastal NZ (offshore grid cells understate rain up to 300×).
    if (spot.trc_sites && riverRef.current) {
      const rainSite = spot.trc_sites
        .map(id => riverRef.current[id])
        .find(s => s?.source === "gwrc_rain");
      if (rainSite && rainSite.rain_48h != null) {
        r48 = rainSite.rain_48h;
        dsr = rainSite.daysSinceRain ?? dsr;
      }
    }
    const swellHist = dailySwellHistory(mTimes, marine.hourly?.wave_height ?? [], 7);

    // 22-day history arrays for ONNX feature builder
    const hist22 = {
      swell_h:      dailyAvgHistory(mTimes, marine.hourly?.wave_height ?? [], 22),
      swell_p:      dailyAvgHistory(mTimes, marine.hourly?.wave_period ?? [], 22),
      swell_dir:    dailyAvgHistory(mTimes, marine.hourly?.wave_direction ?? [], 22),
      swell_wave_h: dailyAvgHistory(mTimes, marine.hourly?.swell_wave_height ?? [], 22),
      swell_wave_p: dailyAvgHistory(mTimes, marine.hourly?.swell_wave_period ?? [], 22),
      wind_spd:     dailyAvgHistory(wTimes, weather.hourly?.wind_speed_10m ?? [], 22),
      wind_dir:     dailyAvgHistory(wTimes, weather.hourly?.wind_direction_10m ?? [], 22),
      sst:          dailyAvgHistory(mTimes, marine.hourly?.sea_surface_temperature ?? [], 22),
      rain:         dailyAvgHistory(wTimes, weather.hourly?.precipitation ?? [], 22),
    };

    // Override hist22.sst with MUR 1km values for the days we have them.
    // Index 0 = today, index i = i days ago — same convention as dailyAvgHistory.
    if (murSstByDate) {
      hist22.sst = hist22.sst.map((val, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('en-CA');
        return murSstByDate[dateStr] ?? val;
      });
    }

    const condBase = condFromHourly(marine, weather, mIdx, wIdx, r48, dsr, hist);

    // erddap-current returns speed in knots; score-full expects m/s — divide by 1.944.
    // ageHrs passed through so score-full can taper stale RTOFS data (Task B).
    const rtofsOverride = rtofs?.valid
      ? { current_vel: rtofs.speed / 1.944, current_dir: rtofs.dir, current_age_hrs: rtofs.ageHrs }
      : {};

    // CHANGE 2: Pull satellite turbidity for this spot if available
    const satSpot = satRef.current?.[spot.name];
    const satOverride = satSpot
      ? { satTurbidity: satSpot.turbidity, satTurbidityAge: satSpot.agedays }
      : {};

    // Webcam turbidity for this spot if available
    const webcamSpot = webcamRef.current?.[spot.name];
    const webcamOverride = webcamSpot
      ? { webcamTurbidity: webcamSpot.turbidity, webcamAgeMinutes: webcamSpot.ageMinutes, webcamSolarConfidence: webcamSpot.solarConfidence ?? 0.5, webcamSource: webcamSpot.source ?? "live" }
      : {};

    // River turbidity from TRC gauges — blend primary + secondary site readings
    // weighted by river_impact. Higher FNU → amplify river penalty in scoreSpot.
    let riverOverride = {};
    if (spot.trc_sites && riverRef.current && Object.keys(riverRef.current).length > 0) {
      const sites = spot.trc_sites.map(id => riverRef.current[id]).filter(Boolean);
      if (sites.length > 0) {
        // Weighted average: primary site (first) gets 70%, secondary gets 30%
        const weights = sites.length === 1 ? [1] : [0.7, 0.3];
        const weightedFNU = sites.reduce((sum, site, i) => sum + (site.latestFNU ?? 0) * (weights[i] ?? 0.15), 0);
        const maxFNU = Math.max(...sites.map(s => s.recentMax ?? s.latestFNU ?? 0));
        // Rising trend amplifies impact (river hasn't peaked yet)
        const trendFactor = sites[0].trend > 5 ? 1.3 : sites[0].trend > 1 ? 1.1 : 1.0;
        // Build structured riverFlows for lookup table scorer (GWRC sites only)
        const riverFlowsMap = {};
        spot.trc_sites.forEach(id => {
          const siteData = riverRef.current[id];
          if (siteData?.source === "gwrc_flow" && siteData?.latestFlow != null) {
            const gaugeId = id === 1001 ? "WAIKANAE_WTP"
                          : id === 1002 ? "OTAKI_PUKEHINAU"
                          : id === 1003 ? "WAITOHU_WS"
                          : null;
            if (gaugeId) riverFlowsMap[gaugeId] = [siteData.latestFlow, siteData.latestFlow];
          }
        });
        riverOverride = {
          riverFNU: weightedFNU,
          riverMaxFNU: maxFNU,
          riverTrendFactor: trendFactor,
          riverTurbScore: fnuToScore(weightedFNU * trendFactor),
          ...(Object.keys(riverFlowsMap).length > 0 ? { riverFlows: riverFlowsMap } : {}),
        };
      }
    }

    // Use the most recent non-null MUR SST value as cond.sst for today's score.
    // MUR has ~1 day latency, so try today first, then fall back to yesterday.
    let murSstNow = null;
    if (murSstByDate) {
      const today     = new Date().toLocaleDateString('en-CA');
      const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
      murSstNow = murSstByDate[today] ?? murSstByDate[yesterday] ?? null;
    }

    const cond = {
      ...condBase,
      ...(murSstNow != null ? { sst: murSstNow } : {}),
      ...rtofsOverride,
      ...satOverride,
      ...webcamOverride,
      ...riverOverride,
      rainHistory: rainHist,
      swellHistory: swellHist,
      hist22,           // 22-day daily-avg arrays for ONNX feature builder
    };

    const { score: rawScore, factors, plumeReach } = await scoreSpot(cond, spot, W);

    const biasMult = spotBiasMultiplier(spot.name, entries || []);
    const score = applyBias(rawScore, biasMult);

    // Pass GWRC gauge rain to forecast scoring for today/yesterday
    let gaugeRainForForecast = null;
    if (spot.trc_sites && riverRef.current) {
      const rainSite = spot.trc_sites
        .map(id => riverRef.current[id])
        .find(s => s?.source === "gwrc_rain");
      if (rainSite && rainSite.rain_48h != null) gaugeRainForForecast = rainSite;
    }

    const forecast = await getDailyScores(marine, weather, spot, W, region, gaugeRainForForecast, murSstByDate);

    // Replace forecast[0] (today) with the live score so gauge and
    // forecast bar always agree. The live score has all real-time
    // overlays applied (satellite, river, RTOFS, bias) that the
    // daily forecast path lacks.
    if (forecast.length > 0) {
      forecast[0] = { ...forecast[0], score };
    }

    return {
      cond, score, rawScore, factors, forecast, biasMult,
      plumeReach: plumeReach ?? 0,
      satData: satRef.current?.[spot.name] ?? null,
      webcamData: webcamRef.current?.[spot.name] ?? null,
    };
  }, []);

  const rawApiRef = useRef({});

  const rescoreAll = useCallback(async () => {
    const raw = rawApiRef.current;
    if (Object.keys(raw).length === 0) return;

    await Promise.all(SPOTS.map(async (spot) => {
      const api = raw[spot.name];
      if (!api) return;
      try {
        // Per-spot RTOFS data when available; fall back to the shared reference
        const rtofs = currentBySpotRef.current?.[spot.name] ?? currentRef.current;
        const result = await computeSpotResult(spot, api.marine, api.weather, rtofs, logEntries, api.murSst ?? null);
        setSpotDataMap(prev => ({ ...prev, [spot.name]: result }));
      } catch(e) {
        console.error(`[rescoreAll] ${spot.name}:`, e.message);
      }
    }));
  }, [logEntries, computeSpotResult]);

  // Rescore when per-spot RTOFS data arrives — currentBySpot is the precise trigger
  useEffect(() => { rescoreAll(); }, [currentBySpot, logEntries, rescoreAll]);

  // CHANGE 3: Rescore when satellite turbidity arrives
  useEffect(() => { rescoreAll(); }, [satData, rescoreAll]);
  // Rescore when webcam data arrives
  useEffect(() => { rescoreAll(); }, [webcamData, rescoreAll]);
  // Rescore when river data arrives
  useEffect(() => { rescoreAll(); }, [riverData, rescoreAll]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);

      // Build coord → spotNames map so spots sharing marine_lat/marine_lon share one fetch.
      // Avoids up to 12 duplicate RTOFS requests across all regions.
      const coordMap = {};
      SPOTS.forEach(spot => {
        const lat = spot.marine_lat ?? spot.lat;
        const lon = spot.marine_lon ?? spot.lon;
        const key = `${lat},${lon}`;
        if (!coordMap[key]) coordMap[key] = { lat, lon, spotNames: [] };
        coordMap[key].spotNames.push(spot.name);
      });

      const rtofsPromise = Promise.all(
        Object.values(coordMap).map(({ lat, lon, spotNames }) =>
          fetchOceanCurrent(lat, lon)
            .then(data  => ({ spotNames, data }))
            .catch(err  => {
              if (window.location.hostname === "localhost")
                console.warn(`[RTOFS] fetch failed for ${lat},${lon}:`, err.message);
              return { spotNames, data: { valid: false, error: err.message } };
            })
        )
      ).then(results => {
        if (cancelled) return;
        const bySpot = {};
        let firstValid = null;
        results.forEach(({ spotNames, data }) => {
          spotNames.forEach(name => { bySpot[name] = data; });
          if (!firstValid && data.valid) firstValid = data;
        });
        if (window.location.hostname === "localhost") {
          console.log("[RTOFS] Per-spot current:", Object.fromEntries(
            Object.entries(bySpot).map(([k, v]) => [k, v.valid ? `${v.speed?.toFixed(2)}kt @${v.dir?.toFixed(0)}°` : "invalid"])
          ));
        }
        currentBySpotRef.current = bySpot;
        setCurrentBySpot(bySpot);
        // currentData drives the SpotMap display arrow — set to first valid result
        setCurrentData(firstValid ?? { valid: false, error: "all coords failed" });
        setCurrentStatus(firstValid ? "ok" : "error");
      }).catch(err => {
        if (!cancelled) {
          if (window.location.hostname === "localhost")
            console.warn("[RTOFS] Promise.all failed:", err.message);
          setCurrentStatus("error");
          setCurrentData({ valid: false, error: err.message });
        }
      });

      // CHANGE 3: Fire satellite turbidity fetch in background
      setSatStatus("loading");
      const satPromise = (async () => {
        try {
          // Walk back up to 14 days to find a cloud-free MODIS Aqua tile.
          // Uses classifyPixel() to count valid water pixels — if >30% of sampled
          // pixels are water (not cloud/glint/land) we consider the tile usable.
          // Each probe has a 5s timeout so a hanging image can't stall the chain.
          let tcDate = null;
          for (let n = 1; n <= 14; n++) {
            const d = new Date();
            d.setDate(d.getDate() - n);
            const dateStr = d.toISOString().split("T")[0];
            const hasData = await Promise.race([
              new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                // Probe tile centred on Taranaki coast (zoom 5, tile x=31 y=19 in WMTS coords)
                img.src = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/5/19/31.jpg`;
                img.onload = () => {
                  try {
                    const c = document.createElement("canvas");
                    c.width = 64; c.height = 64;
                    const ctx = c.getContext("2d", { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const data = ctx.getImageData(0, 0, 64, 64).data;
                    let waterCount = 0, total = 0;
                    for (let i = 0; i < data.length; i += 4) {
                      const [r, g, b, a] = [data[i], data[i+1], data[i+2], data[i+3]];
                      if (a < 10) continue;
                      total++;
                      if (classifyPixel(r, g, b, a) === "water") waterCount++;
                    }
                    const waterFraction = total > 0 ? waterCount / total : 0;
                    if (waterCount > 0) console.log(`[Satellite probe] ${dateStr}: ${waterCount}/${total} water pixels (${(waterFraction*100).toFixed(0)}%)`);
                    resolve(waterFraction > 0.25); // need at least 25% valid ocean pixels
                  } catch { resolve(true); }
                };
                img.onerror = () => resolve(false);
              }),
              new Promise(resolve => setTimeout(() => resolve(false), 5000)), // 5s timeout per probe
            ]);
            if (hasData) { tcDate = dateStr; break; }
          }
          if (!tcDate) tcDate = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().split("T")[0]; })();

          // Fetch both layers in parallel:
          //   TrueColor  → display swatch shown to user (natural looking)
          //   Bands721   → turbidity scoring (bands 7-2-1 false colour;
          //                sediment/turbid water = bright red/magenta,
          //                clear deep water = dark blue/black, cloud = white)
          //                The red channel (band 7, 2.1µm SWIR) is a direct
          //                proxy for suspended sediment — illumination-independent
          //                and much less affected by sun glint than visible bands.
          const [tcPixels, b721Pixels] = await Promise.all([
            sampleGibsTile("MODIS_Aqua_CorrectedReflectance_TrueColor", tcDate, 9, "jpg", SPOTS),
            sampleGibsTile("MODIS_Aqua_CorrectedReflectance_Bands721",   tcDate, 9, "jpg", SPOTS),
          ]);

          const today = new Date();
          const imgDate = new Date(tcDate + "T00:00:00");
          const agedays = Math.round((today - imgDate) / 86400000);

          const result = {};
          SPOTS.forEach(s => {
            const tc   = tcPixels[s.name];
            const b721 = b721Pixels[s.name];

            // Need at least the TrueColor pixel to show a swatch
            if (!tc && !b721) return;

            let turbidity = null;
            let turbiditySource = null;

            if (b721) {
              // Bands 7-2-1 turbidity: in this composite, band 7 (SWIR 2.1µm)
              // maps to the RED channel. High red = high suspended sediment.
              // Band 2 (NIR 0.86µm) maps to GREEN. Band 1 (red 0.65µm) maps to BLUE.
              // SWIR fraction is a sediment proxy robust to sun glint and atmosphere.
              //
              // REGIONAL CALIBRATION:
              //   Taranaki: volcanic silt, shallow water — SWIR responds strongly
              //             baseline=0.18, max=0.60
              //   Kāpiti/Cook Strait: deep water (200m+), fine marine sediment
              //             SWIR response is naturally lower per unit turbidity
              //             baseline=0.22, max=0.55
              //             Also require swirFrac > 0.24 before trusting B721
              //             (below this, deep-water optical properties dominate)
              //   SPI (Gulf of Mexico): high CDOM, different sediment — use Taranaki defaults
              // Regional SWIR calibration derived from S2 pipeline data (Mar 2026):
              //   Taranaki: volcanic silt, shallow (5-20m), high SWIR response
              //             322 obs: clear-water b05=0.230, turbid b05=0.547
              //   Kāpiti/Cook Strait: deep water (200m+), fine marine sediment
              //             610 obs: clear-water b05=0.139, turbid b05=0.627
              //             S2 clear-water SWIR is 0.60x Taranaki → lower MODIS baseline
              //             March median NTU=28 maps to swirFrac~0.19 → baseline=0.16, max=0.50
              const isKapiti = ["Aeroplane Island","Tokahaki (North Tip)","Kāpiti West Face"].includes(s.name);
              const swirBaseline  = isKapiti ? 0.16 : 0.18;  // 0-NTU floor
              const swirMax       = isKapiti ? 0.50 : 0.60;  // 100-NTU ceiling
              const swirMinSignal = isKapiti ? 0.18 : 0.20;  // below this, noise dominates

              const { r, g, b } = b721;
              const total = r + g + b;
              if (total > 30) {
                const swirFraction = r / total;
                if (swirFraction >= swirMinSignal) {
                  // Signal is meaningful — use B721
                  const raw = (swirFraction - swirBaseline) / (swirMax - swirBaseline) * 100;
                  turbidity = Math.min(100, Math.max(0, Math.round(raw)));
                  turbiditySource = "bands721";
                  console.log(`[Satellite B721] ${s.name}: rgb(${r},${g},${b}) swirFrac=${swirFraction.toFixed(3)} → turbidity=${turbidity}`);
                } else {
                  // swirFrac below minimum signal threshold — B721 not reliable here
                  // Fall through to TrueColor
                  console.log(`[Satellite B721] ${s.name}: swirFrac=${swirFraction.toFixed(3)} below min signal (${swirMinSignal}) — using TrueColor fallback`);
                }
              }
            }

            // Fall back to TrueColor turbidity if B721 was rejected or below signal threshold
            if (turbidity === null && tc?.turbidity != null) {
              turbidity = tc.turbidity;
              turbiditySource = "truecolor";
              console.log(`[Satellite TC fallback] ${s.name}: turbidity=${turbidity}`);
            }

            result[s.name] = {
              turbidity,
              turbiditySource,
              // Display swatch uses TrueColor RGB (natural looking) with B721 as fallback
              r: tc?.r ?? b721?.r ?? 0,
              g: tc?.g ?? b721?.g ?? 0,
              b: tc?.b ?? b721?.b ?? 0,
              date: tcDate,
              agedays,
            };
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

      // ── Webcam: morning-cache strategy ──────────────────────────────────────
      // 1. Always try to load today's stored morning reading from Supabase first.
      // 2. If it's the morning solar window (6–11am) AND no reading exists yet
      //    for today, do a live camera fetch and store the result.
      // 3. Outside the morning window, use stored reading only (avoids glare).
      // Only runs for Taranaki — cams are NP-based.
      let webcamPromise = Promise.resolve();
      if (region === "taranaki") {
        setWebcamStatus("loading");
        webcamPromise = (async () => {
          try {
            const today = todayNZ();
            const hour = new Date().getHours() + new Date().getMinutes() / 60;
            const isMorningWindow = hour >= 6 && hour <= 11;

            // Step 1: check for an existing stored reading today
            let stored = await fetchStoredWebcamReadings(today);
            const hasStoredToday = Object.keys(stored).length > 0;

            if (hasStoredToday) {
              // Use stored morning reading — update age but keep original turbidity
              const now = Date.now();
              Object.values(stored).forEach(v => {
                v.ageMinutes = (now - v.fetchedAt) / 60000;
                v.solarLabel = "☀️ morning (cached)";
              });
              if (!cancelled) {
                webcamRef.current = stored;
                setWebcamData(stored);
                setWebcamStatus("ok");
                console.log(`[Webcam] Loaded ${Object.keys(stored).length} stored morning readings for ${today}`);
              }
            } else if (isMorningWindow) {
              // Step 2: morning window, no stored reading — do live fetch and store
              console.log("[Webcam] Morning window, no stored reading — sampling cameras live");
              const liveResult = await samplePrimoCams(SPOTS);
              if (!cancelled && Object.keys(liveResult).length > 0) {
                Object.values(liveResult).forEach(v => { v.ageMinutes = 0; });

                // Store each spot's reading in Supabase (non-blocking)
                for (const [spotName, data] of Object.entries(liveResult)) {
                  upsertWebcamReading(today, spotName, data).catch(() => {});
                }

                webcamRef.current = liveResult;
                setWebcamData(liveResult);
                setWebcamStatus("ok");
                console.log("[Webcam] Live morning fetch complete, stored to Supabase:", Object.fromEntries(Object.entries(liveResult).map(([k,v]) => [k, v.turbidity])));
              } else if (!cancelled) {
                setWebcamStatus("no-data");
              }
            } else {
              // Afternoon/evening with no stored reading — report that
              console.debug("[Webcam] No stored morning reading for today and outside morning window — skipping live fetch");
              if (!cancelled) setWebcamStatus("no-morning-data");
            }
          } catch(e) {
            console.warn("[Webcam] fetch/store failed:", e);
            if (!cancelled) setWebcamStatus("error");
          }
        })();
      }

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
          const todayStr = new Date().toLocaleDateString('en-CA');
          const [weatherRes, marineRes, murJson] = await Promise.all([
            fetch(
              `/.netlify/functions/open-meteo?type=weather&latitude=${wLat}&longitude=${wLon}` +
              `&hourly=wind_speed_10m,wind_direction_10m,precipitation` +
              `&wind_speed_unit=kmh&timezone=Pacific%2FAuckland&forecast_days=7&past_days=9`
            ),
            fetch(
              `/.netlify/functions/open-meteo?type=marine&latitude=${mLat}&longitude=${mLon}` +
              `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction` +
              `&timezone=Pacific%2FAuckland&forecast_days=7&past_days=9`
            ),
            // Fetch NASA MUR 1km SST for past 8 days — overrides Open-Meteo 50km grid.
            // Fails gracefully: null result means Open-Meteo SST is used as fallback.
            fetch(
              `/.netlify/functions/mur-sst?lat=${mLat}&lon=${mLon}&date=${todayStr}&days=8`,
              { signal: AbortSignal.timeout(10000) }
            ).then(r => r.ok ? r.json() : null).catch(() => null),
          ]);

          if (!weatherRes.ok) throw new Error(`Weather proxy HTTP ${weatherRes.status}`);
          if (!marineRes.ok)  throw new Error(`Marine proxy HTTP ${marineRes.status}`);

          const weather = await weatherRes.json();
          const marine  = await marineRes.json();

          // Open-Meteo returns 4xx with a JSON error body — surface these early
          if (weather.error) throw new Error(`Weather API: ${weather.reason ?? "unknown error"}`);
          if (marine.error)  throw new Error(`Marine API: ${marine.reason ?? "unknown error"}`);

          // Build current wind from hourly at the current hour index
          // (avoids a separate current= fetch which triggers 400s on the free tier)
          const wIdxNow = nowIdx(weather.hourly?.time ?? []);
          const spd = weather.hourly?.wind_speed_10m?.[wIdxNow];
          const dir = weather.hourly?.wind_direction_10m?.[wIdxNow];
          if (spd != null && dir != null) {
            weather.current = { wind_speed_10m: spd, wind_direction_10m: dir };
            console.log(`[${spot.name}] Current wind from hourly[${wIdxNow}]: ${spd} kph @ ${dir}°`);
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

          // Build murSstByDate map: { 'YYYY-MM-DD': sst_celsius }
          // Index 0 = today, index i = i days ago (matches dailyAvgHistory convention).
          let murSstByDate = null;
          if (murJson?.source === 'MUR' && Array.isArray(murJson.sst)) {
            murSstByDate = {};
            murJson.sst.forEach((sst, i) => {
              if (sst != null) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                murSstByDate[d.toLocaleDateString('en-CA')] = sst;
              }
            });
            if (window.location.hostname === 'localhost') {
              const count = Object.keys(murSstByDate).length;
              console.log(`[${spot.name}] MUR SST: ${count}/8 days, latest ${Object.values(murSstByDate)[0]?.toFixed(1)}°C`);
            }
          }

          if (!cancelled) {
            rawApiRef.current[spot.name] = { marine, weather, murSst: murSstByDate };

            const result = await computeSpotResult(
              spot, marine, weather,
              currentBySpotRef.current?.[spot.name] ?? currentRef.current,
              logEntries,
              murSstByDate,
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

      // Fire TRC river turbidity fetch in background (Taranaki only — Netlify proxy)
      let riverPromise = Promise.resolve();
      if (region === "taranaki" || region === "kapiti" || region === "spi") {
        setRiverStatus("loading");
        riverPromise = (async () => {
          try {
            const sites = await fetchTRCRiverData();
            if (sites && !cancelled) {
              riverRef.current = sites;
              setRiverData(sites);
              setRiverStatus("ok");
            } else if (!cancelled) {
              setRiverStatus("no-data");
            }
          } catch(e) {
            if (!cancelled) setRiverStatus("error");
            console.warn("[TRC River] fetch failed:", e.message);
          }
        })();
      }

      await Promise.all([
        ...spotPromises,
        rtofsPromise,
        Promise.race([satPromise,   new Promise(r => setTimeout(r, 30000))]),    // sat can't block >30s
        Promise.race([webcamPromise, new Promise(r => setTimeout(r, 15000))]),   // webcam max 15s
        Promise.race([riverPromise,  new Promise(r => setTimeout(r, 12000))]),   // river max 12s
      ]);
      if (!cancelled) setLoading(false);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [SPOTS]);

  return {
    spotDataMap,
    loading,
    errors,
    currentData,
    currentStatus,
    currentBySpot,
    satData,
    satStatus,
    webcamData,
    webcamStatus,
    riverData,
    riverStatus,
  };
}
