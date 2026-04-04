// ══════════════════════════════════════════════════════════════════════════════
// REGIONS CONFIG — all per-region differences live here
// Pipeline-calibrated seasonal data (5yr MODIS satellite observations)
// Wind direction scoring replaces legacy nw_push for Taranaki
// ══════════════════════════════════════════════════════════════════════════════

export const REGIONS = {

  taranaki: {
    id: "taranaki",
    label: "Taranaki",
    emoji: "🌋",
    subtitle: "Sugar Loafs to Patea",
    mapCenter: [-39.2, 174.05],
    mapZoom: 9,
    cloudTile: { zoom: 9, x: 504, y: 319 },
    rtofs: { lat: -39.10, lon: 173.90 },
    supabaseUrl: "https://mgcwrktuplnjtxkbsypc.supabase.co",
    supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY3dya3R1cGxuanR4a2JzeXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MjU2OTcsImV4cCI6MjA1NTUwMTY5N30.EzBxBCRz0pGAOxN9l2MINBJxzGk1QcBdRmFIlZXijCE",
    logKey: "taranaki_dive_log",
    sessionName: "diver_name",
    sessionWelcome: "welcomed",
    footer: "Kāpiti Viz Forecast · Open-Meteo · NOAA RTOFS · NASA GIBS · Supabase · Built for Kāpiti divers 🐟",

    // Scoring weights — calibrated from XGBoost regression (79k MODIS+S2 obs, Mar 2026)
    // Feature group importances: swell 26.5%, rain 13.1%, wind_u 9.3%, wind_v 8.2%,
    // wind_speed 7.5%, SST 8.6%, spot_metadata 5.3%
    // Key findings: rain peaks at d1 (yesterday), days_since_rain is #1 predictor,
    // wind_v_d2 (northerly 2 days prior) r=-0.202 with turbidity
    W: {
      w_swell: 0.45, w_wind: 0.30, w_rain: 0.25,  // retrain 26 Mar 2026: swell 31.4%, wind 33.9% — balanced
      push_mult: 14.0,
      rain_pen_mult: 22.0,           // increased — rain_d1 is #2 feature overall
      days_since_rain_bonus: 18.0,   // NEW — days_since_rain is #1 feature (6.4% importance)
      cur_north: 14.0, cur_south: 18.0, bight_mult: 22.0,
      sst_warm: 12.0, sst_cold: -20.0,  // retrain: SST group 12.2% importance
      tide_mult: 1.0,
      shelter_mult: 0.10, river_mult: 0.15,
      hist_2_5: 0.60, hist_2_0: 0.75, hist_1_5: 0.88,
      seasonal_mult: 1.0,
      swell_wave_p_bonus: 8.0,    // NEW — swell_wave_p_d0 is #3 feature; longer period = cleaner
      wind_v_d2_mult: 10.0,       // NEW — wind_v_d2 r=-0.202; northerly 2d ago = cleaner water

      // ── Per-spot type weight profiles (XGBoost regression-derived) ──────
      SPOT_TYPE_WEIGHTS: {
      // Swell-dominated: open rock/reef, no significant river input.
      // XGBoost: swell group 26.5%, spot R²=0.39-0.45 (best performing)
      swell: {
        w_swell: 0.62, w_wind: 0.17, w_rain: 0.21,
        sst_warm: 12.0, sst_cold: -22.0,
        river_mult: 0.05,
        days_since_rain_bonus: 20.0,  // faster recovery = bigger clean bonus
      },
      // River/harbour-dominated: poor flushing, high rain sensitivity.
      // XGBoost: rain_d1 r=+0.28 all spots; river spots show longer recovery
      river: {
        w_swell: 0.35, w_wind: 0.15, w_rain: 0.50,
        rain_pen_mult: 30.0,
        sst_warm: 6.0,  sst_cold: -10.0,
        river_mult: 0.25,
        days_since_rain_bonus: 12.0,  // slower recovery — papa/harbour retention
      },
      // Bight/sediment: southerly current + suspended sediment dominant.
      // XGBoost: wind_v_d2 signal strong here (southerly bight upwelling)
      bight: {
        w_swell: 0.45, w_wind: 0.20, w_rain: 0.35,
        sst_warm: 8.0,  sst_cold: -18.0,
        bight_mult: 28.0,
        cur_south: 22.0,
        river_mult: 0.20,
        wind_v_d2_mult: 14.0,  // stronger southerly signal in bight
      },
      },  // end SPOT_TYPE_WEIGHTS
    },  // end W

    // Seasonal bias per month — S2 recalibrated Mar 2026 (~3,000+ valid obs, 80% cloud threshold)
    // Derived from median NTU per spot per month vs annual median.
    // Applied as: score += seasonal[month] * W.seasonal_mult
    // Positive = cleaner than average (bonus), Negative = dirtier (penalty)
    // spotSeasonal recalibrated 26 Mar 2026
    // Source: 3,635 S2 SWIR obs (2017-2026) merged with weather features, XGBoost retrain
    // NTU median per month per spot -> delta vs annual median. Scale: 5 NTU = 10 score pts.
    spotSeasonal: {
      "Motumahanga (Saddleback Is.)":
        {1:-15,2:-15,3:+15,4:+15,5:+15,6:+15,7:+13,8:+15,9:-13,10:-15,11:-15,12:-15},
      "Nga Motu — Inshore (Port Taranaki)":
        {1:-15,2:-15,3:+13,4:+15,5:+15,6:+15,7:+15,8:+15,9:-13,10:-15,11:-15,12:-15},
      "Fin Fuckers (Cape Egmont / Warea)":
        {1:-15,2:-10,3:+15,4:+15,5:+10,6:+15,7:+15,8:+10,9:-11,10:-15,11:-15,12:-15},
      "Opunake":
        {1:-15,2:0,3:+15,4:+15,5:0,6:+15,7:+15,8:+15,9:-15,10:-15,11:-15,12:-15},
      "Patea — Inshore":
        {1:-15,2:-15,3:-14,4:+10,5:+10,6:+4,7:+5,8:0,9:0,10:0,11:0,12:0},
      "Patea — Offshore Trap":
        {1:-15,2:-15,3:-15,4:-11,5:-7,6:+1,7:+7,8:+6,9:+4,10:+3,11:0,12:0},
      "Boarfish Rock":
        {1:-15,2:-6,3:+6,4:+13,5:+10,6:+15,7:+14,8:+7,9:-12,10:-15,11:-15,12:-15},
      "Aeroplane Island":
        {1:-15,2:-15,3:-2,4:+4,5:+12,6:+2,7:+12,8:+10,9:+2,10:-15,11:-15,12:-15},
      "Tokahaki (North Tip)":
        {1:-15,2:-15,3:+4,4:+5,5:+5,6:0,7:+10,8:+7,9:0,10:-15,11:-15,12:-15},
      "Kapiti West Face":
        {1:-15,2:-15,3:+6,4:+9,5:+13,6:+13,7:+15,8:+8,9:-6,10:-15,11:-15,12:-15},
    },

    // Seasonal chart data for UI (pipeline clear% by month)
    seasonalChart: [
      { month:"Jan", clear:55, blueIdx:9 },
      { month:"Feb", clear:51, blueIdx:6 },
      { month:"Mar", clear:60, blueIdx:6 },
      { month:"Apr", clear:48, blueIdx:4 },
      { month:"May", clear:49, blueIdx:3 },
      { month:"Jun", clear:23, blueIdx:1 },
      { month:"Jul", clear:40, blueIdx:1 },
      { month:"Aug", clear:42, blueIdx:1 },
      { month:"Sep", clear:35, blueIdx:1 },
      { month:"Oct", clear:41, blueIdx:2 },
      { month:"Nov", clear:42, blueIdx:5 },
      { month:"Dec", clear:40, blueIdx:4 },
    ],
    seasonalNote: "4,095 S2 SWIR observations · 12 spots · recalibrated 23 Mar 2026",

    spots: [
      {
        name: "Motumahanga (Saddleback Is.)",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=312, R2=0.17)
        // Lags: swell:swell_wave_h_d10(+0.26) | wind:wind_u_d1(+0.33) | rain:rain_d2(+0.20)
        W: { w_swell:0.4, w_wind:0.3, w_rain:0.3,
             sst_warm:14.0, sst_cold:-20.0, river_mult:0.15 },
        lat: -39.045543, lon: 174.014640,
        marine_lat: -39.10, marine_lon: 173.90,
        weather_lat: -39.055, weather_lon: 174.02,
        shelter: 0.6,  river_impact: 0.1,  papa_risk: 0.2,  swell_exposure: 0.15,  // river corr=0.15
        // Directional exposure (0=none, 1=full). Faces NW across open Tasman.
        // Island provides shelter from direct W/SW; deepest water ~10m, rocky.
        dir_exposure: { N:0.3, NE:0.2, E:0.1, SE:0.1, S:0.2, SW:0.4, W:0.5, NW:0.6 },
        depth_m: 10,  // typical dive depth — shallow, so period matters less
        // Pipeline: best=S,SE,SW — worst=N,NW,E. NW push myth busted.
        best_wind_dirs: [135, 90, 180],  // SE, E, S
        worst_wind_dirs: [315, 270, 225],  // NW, W, SW
        wind_push: 0.7,
        nw_rain_penalty: 0.5, southerly_bight: 0.0, tide_sensitive: 0.3,
        plume_reach: 0.7,
        trc_sites: [166, 17], // Urenui (primary), Mangati (secondary)
        note: "Outermost Sugar Loaf, ~1.5km offshore. Andesite rock, no papa. Pipeline: clean water from S/SE, not NW. Fast recovery (~1 day). Post-rain plume can still reach island.",
        river: false,
      },
      {
        name: "Nga Motu — Inshore (Port Taranaki)",
        spot_type: "river",

        // Per-spot W (calibrate_per_spot.py, n=310, R2=0.01)
        // Lags: swell:swell_h_d14(-0.25) | wind:wind_u_d1(+0.37) | rain:rain_d16(-0.21)
        W: { w_swell:0.4, w_wind:0.3, w_rain:0.3,
             sst_warm:14.0, sst_cold:-20.0, river_mult:0.15 },
        lat: -39.053292, lon: 174.041905,
        marine_lat: -39.10, marine_lon: 173.90,
        weather_lat: -39.06, weather_lon: 174.06,
        shelter: 0.85, river_impact: 0.9,  papa_risk: 0.9,  swell_exposure: 0.85,
        // Very shallow inshore — swell direction matters little, wave height does
        dir_exposure: { N:0.3, NE:0.2, E:0.2, SE:0.5, S:0.6, SW:0.8, W:0.7, NW:0.4 },
        depth_m: 5,
        // Pipeline: best=N,NE,NW — worst=S,SE,SW. Inverted seasonal — winter best.
        best_wind_dirs: [0, 315, 45],    // N, NW, NE
        worst_wind_dirs: [135, 180, 225], // SE, S, SW
        wind_push: 0.3,
        nw_rain_penalty: 0.9, southerly_bight: 0.0, tide_sensitive: 1.0,
        trc_sites: [166, 17], // Urenui + Mangati — Waiwhakaiho is ungauged but correlates
        note: "Poor flushing. Heavy stormwater/Waiwhakaiho impact. Pipeline: Oct/Sep best, Jan/Feb worst — inverted vs all other spots. Only good after extended dry calm spells.",
        river: true,
      },
      {
        name: "Fin Fuckers (Cape Egmont / Warea)",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=244, R2=0.06)
        // Lags: swell:swell_wave_h_d10(-0.34) | wind:wind_u_d0(+0.46) | rain:rain_d2(+0.28)
        W: { w_swell:0.1, w_wind:0.56, w_rain:0.34,
             sst_warm:14.0, sst_cold:-20.0, river_mult:0.15 },
        lat: -39.262931, lon: 173.753192,
        marine_lat: -39.30, marine_lon: 173.65,
        weather_lat: -39.27, weather_lon: 173.76,
        // Cape Egmont point — westernmost tip of Taranaki.
        // Landmark: replica lighthouse 1 & 2 at Warea Boat Club (Bayly Rd).
        // West-facing exposure. Benefits from N/NE wind (offshore). Open to SW swell.
        // No significant rivers nearby — rain effect mainly via direct runoff/papa.
        shelter: 0.25, river_impact: 0.12, papa_risk: 0.35, swell_exposure: 0.55,  // river corr=0.24
        // West-facing cape — maximum W/SW/NW exposure, sheltered from E/SE
        dir_exposure: { N:0.4, NE:0.3, E:0.1, SE:0.1, S:0.5, SW:0.9, W:1.0, NW:0.8 },
        depth_m: 12,
        best_wind_dirs: [0, 270, 315],    // N, W, NW
        worst_wind_dirs: [90, 45, 225],   // E, NE, SW
        wind_push: 0.6,
        nw_rain_penalty: 0.15, southerly_bight: 0.1, tide_sensitive: 0.5,
        plume_reach: 0.2,
        trc_sites: [53, 117], // Waingongoro (closest) + Waitaha
        note: "West-facing cape. Replica lighthouse (Warea Boat Club) is the landmark. Very exposed to westerly swell but clears quickly after rain with no major river input.",
        river: false,
      },
      {
        name: "Opunake",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=304, R2=0.16)
        // Lags: swell:swell_h_d0(+0.39) | wind:wind_u_d0(+0.40) | rain:rain_d2(+0.23)
        W: { w_swell:0.35, w_wind:0.42, w_rain:0.23,
             sst_warm:12.8, sst_cold:-20.0, river_mult:0.15 },
        lat: -39.455188, lon: 173.837393,
        marine_lat: -39.50, marine_lon: 173.70,
        weather_lat: -39.45, weather_lon: 173.86,
        shelter: 0.4,  river_impact: 0.15, papa_risk: 0.2,  swell_exposure: 0.45,
        // SW-facing — open to S/SW/W swell; Cape Egmont provides some N shelter
        dir_exposure: { N:0.2, NE:0.1, E:0.1, SE:0.3, S:0.7, SW:0.9, W:0.8, NW:0.5 },
        depth_m: 8,
        // Pipeline: best=N,W,NE — worst=E,SE,S. NW partially valid.
        best_wind_dirs: [315, 270, 0],    // NW, W, N
        worst_wind_dirs: [180, 135, 90],  // S, SE, E
        wind_push: 0.4,
        nw_rain_penalty: 0.2, southerly_bight: 0.0, tide_sensitive: 0.4,
        trc_sites: [53, 167], // Waingongoro + Waiokura
        note: "Low papa + rain shadow under NW. Clears fastest after rain. Best fallback when other spots blown out.",
        river: true,
      },
      {
        name: "Patea — Inshore",
        spot_type: "river",

        // Per-spot W (calibrate_per_spot.py, n=283, R2=0.07)
        // Lags: swell:swell_wave_h_d2(-0.37) | wind:wind_v_d4(-0.24) | rain:rain_d8(+0.19)
        W: { w_swell:0.1, w_wind:0.44, w_rain:0.46,
             sst_warm:6.0, sst_cold:-10.0, river_mult:0.15 },
        lat: -39.781507, lon: 174.480589,
        marine_lat: -39.80, marine_lon: 174.35,
        weather_lat: -39.78, weather_lon: 174.50,
        shelter: 0.3,  river_impact: 0.85, papa_risk: 0.85, swell_exposure: 0.90,
        // Open bight — exposed to almost everything, especially SW/S
        dir_exposure: { N:0.4, NE:0.5, E:0.3, SE:0.6, S:0.9, SW:1.0, W:0.8, NW:0.5 },
        depth_m: 6,
        best_wind_dirs: [0, 270, 315],    // N, W, NW
        worst_wind_dirs: [135, 225, 180], // SE, SW, S
        wind_push: 0.15,
        nw_rain_penalty: 0.75, southerly_bight: 0.9, tide_sensitive: 0.85,
        trc_sites: [12], // Mangaehu at Huinga — closest to Patea
        note: "Papa + persistently muddy Patea River + bight exposure. Triple threat in bad conditions.",
        river: true,
      },
      {
        name: "Patea — Offshore Trap",
        spot_type: "bight",

        // Per-spot W (calibrate_per_spot.py, n=469, R2=0.06)
        // Lags: swell:swell_wave_h_d18(+0.30) | wind:wind_v_d2(-0.21) | rain:rain_d19(-0.14)
        W: { w_swell:0.1, w_wind:0.43, w_rain:0.47,
             sst_warm:6.0, sst_cold:-10.0, river_mult:0.15 },
        lat: -39.866933, lon: 174.548300,
        marine_lat: -39.90, marine_lon: 174.45,
        weather_lat: -39.85, weather_lon: 174.55,
        shelter: 0.2,  river_impact: 0.25, papa_risk: 0.3,  swell_exposure: 0.20,
        // Offshore — deeper water, longer period swell penetrates to depth
        dir_exposure: { N:0.5, NE:0.6, E:0.4, SE:0.5, S:0.7, SW:0.8, W:0.7, NW:0.5 },
        depth_m: 25,
        // Pipeline: best=SW,E,S — worst=N,SE,NE
        best_wind_dirs: [180, 225, 135],  // S, SW, SE
        worst_wind_dirs: [45, 270, 0],    // NE, W, N
        wind_push: 0.5,
        nw_rain_penalty: 0.3, southerly_bight: 0.95, tide_sensitive: 0.2,
        trc_sites: [12], // Mangaehu — same catchment influence
        note: "Clean on calm days. Pipeline: SW/E/S best — Whanganui water floods in on N/NE.",
        river: false,
      },
      {
        name: "Boarfish Rock",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=312, R2=0.12)
        // Lags: swell:swell_h_d18(-0.20) | wind:wind_u_d1(+0.36) | rain:rain_d0(+0.19)
        W: { w_swell:0.25, w_wind:0.38, w_rain:0.37,
             sst_warm:6.0, sst_cold:-10.0, river_mult:0.2 },
        lat: -38.911833, lon: 174.271650,
        marine_lat: -38.95, marine_lon: 174.20,
        weather_lat: -38.93, weather_lon: 174.28,
        shelter: 0.15,  river_impact: 0.55, papa_risk: 0.60, swell_exposure: 0.15,  // river corr=0.45
        // Pohokura platform — faces NW, partially sheltered by headland from S/SW
        dir_exposure: { N:0.3, NE:0.2, E:0.2, SE:0.3, S:0.4, SW:0.5, W:0.7, NW:0.8 },
        depth_m: 18,
        // Pipeline: best=E,NE,N — worst=S,W,SW. NE not NW.
        best_wind_dirs: [0, 315, 45],     // N, NW, NE
        worst_wind_dirs: [180, 135, 270], // S, SE, W
        wind_push: 0.6,
        nw_rain_penalty: 0.55, southerly_bight: 0.3, tide_sensitive: 0.2,
        trc_sites: [17, 166], // Mangati + Urenui — Waitara area rivers
        note: "Reef at 30m. Pipeline: clean water from NE not NW. Waitara runoff impact. Most consistent year-round (60-79% clear).",
        river: true,
      },
    ],
  },

  kapiti: {
    id: "kapiti",
    label: "Kāpiti",
    emoji: "🐠",
    subtitle: "Kāpiti Island & Cook Strait",
    mapCenter: [-40.86, 174.92],
    mapZoom: 10,
    cloudTile: { zoom: 9, x: 504, y: 335 },
    rtofs: { lat: -40.85, lon: 174.95 },
    supabaseUrl: "",  // TODO: new Supabase project
    supabaseKey: "",
    logKey: "kapiti_dive_log",
    sessionName: "kapiti_diver_name",
    sessionWelcome: "kapiti_welcomed",
    footer: "Kāpiti Viz Forecast · Open-Meteo · NOAA RTOFS · NASA GIBS · Supabase · Built for Kāpiti divers 🐟",

    W: {
      w_swell: 0.30, w_wind: 0.40, w_rain: 0.30,  // retrain: swell minimal at Kapiti (no papa), wind dominant
      push_mult: 16.0,
      rain_pen_mult: 14.0,
      cur_north: 12.0, cur_south: 10.0, bight_mult: 8.0,
      sst_warm: 9.0, sst_cold: -12.0,  // retrain: SST 12.2% importance
      tide_mult: 1.2,
      shelter_mult: 0.08, river_mult: 0.18,
      hist_2_5: 0.55, hist_2_0: 0.70, hist_1_5: 0.85,
      seasonal_mult: 1.0,
    },

    spotSeasonal: {
      // Real pipeline deltas: clear_pct[month] - annual_avg, from 649-670 MODIS obs each
      "Aeroplane Island":    {1:-20,2:-19,3:-13,4:+4,5:+2,6:+12,7:+13,8:+18,9:+13,10:-4,11:-8,12:-1},
      "Tokahaki (North Tip)":{1:+1,2:+1,3:+1,4:+1,5:-4,6:+1,7:-3,8:-1,9:+1,10:+1,11:+1,12:+1},
      "Kāpiti West Face":    {1:+1,2:+1,3:+1,4:+1,5:-2,6:-2,7:-3,8:+1,9:+1,10:+1,11:+1,12:+1},
    },

    seasonalChart: [
      { month:"Jan", clear:45, blueIdx:2 },
      { month:"Feb", clear:46, blueIdx:3 },
      { month:"Mar", clear:52, blueIdx:4 },
      { month:"Apr", clear:69, blueIdx:5 },
      { month:"May", clear:67, blueIdx:5 },
      { month:"Jun", clear:77, blueIdx:3 },
      { month:"Jul", clear:78, blueIdx:4 },
      { month:"Aug", clear:83, blueIdx:4 },
      { month:"Sep", clear:78, blueIdx:4 },
      { month:"Oct", clear:61, blueIdx:3 },
      { month:"Nov", clear:57, blueIdx:2 },
      { month:"Dec", clear:64, blueIdx:1 },
    ],
    seasonalNote: "649 cloud-free MODIS observations · Aeroplane Island reference spot",

    spots: [
      {
        name: "Aeroplane Island",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=520, R2=0.09)
        // Lags: swell:swell_wave_h_d2(+0.32) | wind:wind_u_d3(-0.11) | rain:rain_d14(-0.13)
        W: { w_swell:0.1, w_wind:0.44, w_rain:0.46,
             sst_warm:14.0, sst_cold:-20.0, river_mult:0.18 },
        lat: -40.882084, lon: 174.927163,
        marine_lat: -40.860, marine_lon: 174.960,
        sat_lat: -40.868, sat_lon: 174.910,
        shelter: 0.3, river_impact: 0.3, papa_risk: 0.1, swell_exposure: 0.35,  // MODIS: rain sensitivity confirmed
        dir_exposure: { N:0.3, NE:0.2, E:0.1, SE:0.2, S:0.4, SW:0.6, W:0.8, NW:0.7 },
        depth_m: 12,
        best_wind_dirs: [0, 45, 315],    // N, NE, NW
        worst_wind_dirs: [225, 270, 180], // SW, W, S
        wind_push: 0.9,
        sw_flush: 0.9, sw_rain_penalty: 0.3, strait_squeeze: 0.7, tide_sensitive: 0.8,
        rain_recovery_days: 2,
        note: "East face of Kāpiti. Pipeline: May-Aug best (76-84%), Jan-Feb worst (41-45%). SW Cook Strait flush drives visibility.",
        trc_sites: [1002],  // Otaki River — drains into coast north of Aeroplane Island
        river: true,
      },
      {
        name: "Tokahaki (North Tip)",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=546, R2=0.16)
        // Lags: swell:swell_wave_h_d8(+0.46) | wind:wind_v_d19(-0.14) | rain:rain_d1(+0.07)
        W: { w_swell:0.1, w_wind:0.50, w_rain:0.40,
             sst_warm:14.0, sst_cold:-20.0, river_mult:0.18 },
        lat: -40.819471, lon: 174.946638,
        marine_lat: -40.840, marine_lon: 174.910,
        sat_lat: -40.840, sat_lon: 174.870,
        shelter: 0.2, river_impact: 0.2, papa_risk: 0.10, swell_exposure: 0.45,  // raised from 0.05 — w_rain=0.40 needs longer window
        dir_exposure: { N:0.2, NE:0.2, E:0.1, SE:0.2, S:0.5, SW:0.7, W:0.9, NW:0.8 },
        depth_m: 15,
        best_wind_dirs: [0, 180, 225],   // N, S, SW
        worst_wind_dirs: [135, 90, 270],  // SE, E, W
        wind_push: 1.0,
        sw_flush: 1.0, sw_rain_penalty: 0.2, strait_squeeze: 0.9, tide_sensitive: 1.0,
        rain_recovery_days: 2,
        note: "Most exposed — strongest tidal flushing. Ground truth: 10m vis Feb 28 2026.",
        trc_sites: [1001, 1002],  // Waikanae + Otaki — both drain into Kapiti coast
        river: true,
      },
      {
        name: "Kāpiti West Face",
        spot_type: "swell",

        // Per-spot W (calibrate_per_spot.py, n=533, R2=0.13)
        // Lags: swell:swell_wave_h_d8(+0.43) | wind:wind_v_d2(-0.17) | rain:rain_d1(+0.19)
        W: { w_swell:0.1, w_wind:0.45, w_rain:0.45,
             sst_warm:14.0, sst_cold:-20.0, river_mult:0.18 },
        lat: -40.855557, lon: 174.889112,
        marine_lat: -40.860, marine_lon: 174.860,
        sat_lat: -40.860, sat_lon: 174.862,
        shelter: 0.5, river_impact: 0.5, papa_risk: 0.10, swell_exposure: 0.6,  // raised from 0.05 — w_rain=0.45 needs longer window
        dir_exposure: { N:0.2, NE:0.3, E:0.1, SE:0.3, S:0.6, SW:0.8, W:1.0, NW:0.9 },
        depth_m: 18,
        best_wind_dirs: [225, 270, 315],  // SW, W, NW — pipeline: 100% clear on these dirs
        worst_wind_dirs: [90, 135, 180],  // E, SE, S — pipeline: 95-97% clear (still good but worst)
        wind_push: 0.4,
        sw_flush: 0.4, sw_rain_penalty: 0.5, strait_squeeze: 0.5, tide_sensitive: 0.6,
        rain_recovery_days: 3,
        note: "West face — more Waikanae river influence, less Cook Strait flushing.",
        trc_sites: [1001],  // Waikanae River — primary influence on west face
        river: true,
      },
    ],
  },

  spi: {
    id: "spi", label: "South Padre", emoji: "🦈",
    subtitle: "South Padre Island, Texas",
    mapCenter: [26.20, -96.96], mapZoom: 11,
    cloudTile: { zoom: 9, x: 118, y: 219 },
    rtofs: { lat: 26.20, lon: -96.96 },
    supabaseUrl: "https://mgcwrktuplnjtxkbsypc.supabase.co",
    supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nY3dya3R1cGxuanR4a2JzeXBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk5MjU2OTcsImV4cCI6MjA1NTUwMTY5N30.EzBxBCRz0pGAOxN9l2MINBJxzGk1QcBdRmFIlZXijCE",
    logKey: "spi_dive_log", sessionName: "spi_diver_name", sessionWelcome: "spi_welcomed",
    footer: "SPI Viz Forecast · Open-Meteo · NOAA RTOFS · NASA GIBS · Built for Gulf divers 🦈",
    W: { w_swell:0.40, w_wind:0.20, w_rain:0.40, push_mult:10.0, rain_pen_mult:18.0,
         cur_north:10.0, cur_south:12.0, bight_mult:8.0, sst_warm:12.0, sst_cold:-15.0,
         tide_mult:0.3, shelter_mult:0.08, river_mult:0.25,
         hist_2_5:0.65, hist_2_0:0.78, hist_1_5:0.90, seasonal_mult:1.0 },
    // spotSeasonal recalibrated 30 Mar 2026
    // Source: 390/396 valid S2 SWIR obs at CORRECTED coords, retrain_s2only.py
    // RGV Reef   n=392  NTU: Jan25 Feb31 Mar89 Apr52 May38 Jun46 Jul35 Aug31 Sep81 Oct34 Nov19 Dec17
    // Aquarium   n=398  NTU: Jan20 Feb40 Mar111 Apr76 May39 Jun52 Jul47 Aug35 Sep75 Oct25 Nov18 Dec12
    // Key corrections vs hand-tuned: Jun was 0/−2, data says −15/−15 (actually dirty)
    //                                Jul was +15/−7, data says −1/−15 (near-neutral/dirty)
    //                                May was +13/−15, data says −7/0 (moderate)
    spotSeasonal: {
      "RGV Reef":     {1:+15,2:+8,3:-15,4:-15,5:-7,6:-15,7:-1,8:+7,9:-15,10:+1,11:+15,12:+15},
      "The Aquarium": {1:+15,2:+0,3:-15,4:-15,5:+0,6:-15,7:-15,8:+10,9:-15,10:+15,11:+15,12:+15},
    },
    // seasonalChart: clear% = satellite cloud-free rate, blueIdx = visibility quality 1-10
    // Derived from 392+398 S2 SWIR obs at corrected coords (30 Mar 2026)
    // NTU→blueIdx: <20=9, 20-35=8, 35-50=6, 50-70=4, 70-90=2, >90=1
    // RGV NTU by month: 25,31,89,52,38,46,35,31,81,34,19,17
    // Aq  NTU by month: 20,40,111,76,39,52,47,35,75,25,18,12
    seasonalChart: [
      {month:"Jan",clear:77,blueIdx:8},{month:"Feb",clear:74,blueIdx:7},
      {month:"Mar",clear:72,blueIdx:1},{month:"Apr",clear:69,blueIdx:4},
      {month:"May",clear:75,blueIdx:6},{month:"Jun",clear:76,blueIdx:4},
      {month:"Jul",clear:78,blueIdx:6},{month:"Aug",clear:77,blueIdx:7},
      {month:"Sep",clear:74,blueIdx:2},{month:"Oct",clear:78,blueIdx:7},
      {month:"Nov",clear:79,blueIdx:9},{month:"Dec",clear:80,blueIdx:9},
    ],
    seasonalNote: "790 S2 SWIR obs · corrected coords · 2017-2026 · Mar 2026",
    spots: [
      { name:"RGV Reef", spot_type:"swell",
        lat:26.27967, lon:-97.05722, marine_lat:26.27967, marine_lon:-97.05722,
        weather_lat:26.27967, weather_lon:-97.05722, sat_lat:26.27967, sat_lon:-97.05722,
        shelter:0.5, river_impact:0.4, papa_risk:0.1, swell_exposure:0.5,
        dir_exposure:{N:0.3,NE:0.5,E:0.7,SE:0.8,S:0.6,SW:0.4,W:0.3,NW:0.2},
        depth_m:20, tide_sensitive:0.2,
        best_wind_dirs:[315,0,270], worst_wind_dirs:[90,135,180],
        wind_push:0.6, nw_rain_penalty:0.2, southerly_bight:0.3,
        note:"South Padre Island artificial reef, 20m. Rio Grande plume worst Mar-Apr. Oct-Jan clearest. Warm summer SST stratifies water.",
        trc_sites:[1003], river: true },  // Rio Grande USGS 08370500
      { name:"The Aquarium", spot_type:"swell",
        lat:26.11067, lon:-96.86487, marine_lat:26.11067, marine_lon:-96.86487,
        weather_lat:26.11067, weather_lon:-96.86487, sat_lat:26.11067, sat_lon:-96.86487,
        shelter:0.6, river_impact:0.3, papa_risk:0.1, swell_exposure:0.4,
        dir_exposure:{N:0.3,NE:0.4,E:0.6,SE:0.7,S:0.5,SW:0.3,W:0.2,NW:0.2},
        depth_m:37, tide_sensitive:0.2,
        best_wind_dirs:[315,0,270], worst_wind_dirs:[90,135,180],
        wind_push:0.5, nw_rain_penalty:0.15, southerly_bight:0.2,
        note:"SPI dive site, 37m — deeper than RGV Reef, benefits more from SST stratification. Same Rio Grande plume influence Mar-Apr.",
        trc_sites:[1003], river: true },  // Rio Grande USGS 08370500
    ],
  },

};

// ══════════════════════════════════════════════════════════════════════════════
// REGION HELPERS — derive SPOTS and W from active region
// ══════════════════════════════════════════════════════════════════════════════
export function getSPOTS(regionId) { return REGIONS[regionId]?.spots ?? []; }
export function getW(regionId) { return REGIONS[regionId]?.W ?? REGIONS.taranaki.W; }
