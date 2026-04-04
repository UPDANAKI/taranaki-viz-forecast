export function DataSourcesPage({ W, spots }) {
  return (
    <div className="ds-page">
      <div className="ds-hero">
        <div className="ds-hero-icon">📡</div>
        <h2 className="ds-hero-title">Data Sources & Model</h2>
        <p className="ds-hero-sub">How the scores are built — what feeds in, how they're combined, and where to cross-check</p>
      </div>

      {/* ── SCORING PIPELINE ───────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">⚙️ Scoring Pipeline</h3>
        <p className="ds-section-desc">
          Each spot score (0–100) is computed fresh on every page load from live API data. The pipeline runs in this order:
        </p>
        <div className="ds-sources">
          {[
            { n: "1. Base score", d: "Weighted average of swell sub-score (0.45), wind sub-score (0.25), and rain penalty (0.30), multiplied by a swell history multiplier (0.60–1.0× depending on wave height over the past 72 hours)." },
            { n: "2. Wind direction push/drag", d: "Each spot has calibrated best_wind_dirs and worst_wind_dirs from pipeline analysis. Offshore wind adds a push bonus; onshore subtracts. Amplified by wind speed and rain (rain during offshore wind reduces the push benefit)." },
            { n: "3. Ocean current", d: "Northerly current (cleaner Tasman water) adds points; southerly (turbid Whanganui/Manawatū plume) subtracts. Southerly bight spots (Patea) are amplified further." },
            { n: "4. SST adjustment", d: "SST > 18°C = warm-water bonus (stratified, clear). SST < 16°C = cold-water penalty (upwelling = murky). Sourced from Open-Meteo Marine." },
            { n: "5. Tide adjustment", d: "Per-spot tide sensitivity (0–1). High incoming tide at sensitive spots can stir sediment. Currently uses Open-Meteo's tidal model — not a dedicated tidal gauge." },
            { n: "6. Shelter & river", d: "Sheltered spots buffer bad conditions. River-mouth spots take a penalty proportional to rain history and their river_impact coefficient." },
            { n: "7. Recovery bonus", d: "Extended dry + calm stretches (3–7+ days) earn up to +12 points. Reduced if active plume-reach is in effect." },
            { n: "8. Satellite turbidity (satAdj)", d: "MODIS Aqua SWIR pixel sampling for each spot. Turbidity index 0–100 fed back as a score adjustment. Confidence decays over 3 days. High turbidity (>60) suppresses score; low (<20) gives a small clarity bonus." },
            { n: "9. Webcam turbidity (webcamAdj)", d: "Primo webcam pixel sampling — three west-facing cameras covering Motumahanga and Nga Motu. Solar angle modulates confidence (morning = ideal). Morning readings cached in Supabase and re-used throughout the day (12h decay window). Live reads decay over 2 hours." },
            { n: "10. River gauge (riverFNUAdj)", d: "Live FNU turbidity from TRC river gauges via Netlify proxy. Each spot maps to 1–2 nearest gauges. High FNU amplifies the rain-based river penalty; surprisingly clear rivers give a small relief. Rising trend gets a 1.3× multiplier. Capped at ±20 points." },
          ].map(({ n, d }) => (
            <div key={n} className="ds-source-card" style={{ padding: "0.8rem 1.1rem" }}>
              <div style={{ fontWeight: 700, color: "#b0d0e0", fontSize: "0.85rem", marginBottom: "0.3rem" }}>{n}</div>
              <div style={{ fontSize: "0.78rem", color: "#6a9aaa", lineHeight: 1.6 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── DATA SOURCES ───────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">🔗 Live Data Sources</h3>
        <p className="ds-section-desc">Seven independent data streams feed the model, fetched on every load.</p>
        <div className="ds-sources">

          {/* Open-Meteo Weather */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">💨</span>
              <div>
                <div className="ds-source-name">Open-Meteo Weather API</div>
                <a className="ds-source-url" href="https://api.open-meteo.com" target="_blank" rel="noreferrer">api.open-meteo.com/v1/forecast</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Wind speed & direction (10m), hourly precipitation — 9-day history + 7-day forecast"],
                ["Resolution", "~11 km global, hourly updates"],
                ["Models", "GFS, ICON, GEM, ECMWF IFS — auto-selects best for region"],
                ["License", "CC BY 4.0 — free, no key required"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Each spot uses a <strong>weather_lat/lon</strong> coordinate on land (not the dive spot) to guarantee non-null data — offshore grid cells may return null. Wind speed is fetched in <code>kmh</code>. A separate real-time <code>current_weather</code> block is fetched alongside the hourly data and prioritised for present conditions.
              </div>
            </div>
          </div>

          {/* Open-Meteo Marine */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🌊</span>
              <div>
                <div className="ds-source-name">Open-Meteo Marine API</div>
                <a className="ds-source-url" href="https://marine-api.open-meteo.com" target="_blank" rel="noreferrer">marine-api.open-meteo.com/v1/marine</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Wave height, wave period, wave direction, sea surface temperature (SST)"],
                ["Resolution", "~0.5° grid (~50 km), hourly"],
                ["Models", "ECMWF WAM, NOAA WW3, Copernicus Marine"],
                ["License", "CC BY 4.0"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Each spot uses a <strong>marine_lat/lon</strong> shifted ~10–18 km offshore to avoid the land mask — nearshore and island coordinates return null at 0.5° resolution. The offset ensures wave/SST data comes from the nearest open-ocean grid cell.
              </div>
            </div>
          </div>

          {/* RTOFS */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🌀</span>
              <div>
                <div className="ds-source-name">NOAA RTOFS / HYCOM Ocean Current</div>
                <a className="ds-source-url" href="https://upwell.pfeg.noaa.gov/erddap" target="_blank" rel="noreferrer">upwell.pfeg.noaa.gov/erddap</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "U/V ocean current velocity at 1m depth → speed (knots) + direction"],
                ["Resolution", "~8 km, 3-hourly forecast"],
                ["Reference pt", "-39.05°S, 173.87°E (offshore Taranaki — applied to all spots)"],
                ["License", "NOAA public domain"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Southerly currents drive Whanganui/Manawatū sediment-laden water into the South Taranaki Bight — this is the main mechanism behind Patea's bight exposure penalty. Model data can lag real conditions by 6–12 hours.
              </div>
            </div>
          </div>

          {/* NASA GIBS */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🛰️</span>
              <div>
                <div className="ds-source-name">NASA GIBS — MODIS Aqua Satellite</div>
                <a className="ds-source-url" href="https://gibs.earthdata.nasa.gov" target="_blank" rel="noreferrer">gibs.earthdata.nasa.gov/wmts</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Dual-layer MODIS Aqua: TrueColor (display swatch) + Bands 7-2-1 SWIR (turbidity scoring)"],
                ["Resolution", "250m per pixel at zoom level 9"],
                ["Layers", "MODIS_Aqua_CorrectedReflectance_TrueColor + Bands721"],
                ["License", "NASA EOSDIS — public domain"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                The <strong>SWIR band (7, 2.1µm)</strong> is a direct proxy for suspended sediment — immune to sun glint and atmospheric haze that corrupt visible bands. A 5×5 pixel neighbourhood is sampled per spot; cloud and glint pixels are rejected before scoring. Searches back up to 14 days for a scene with &gt;25% valid ocean pixels. Score label shows <strong>· SWIR</strong> when scored from Bands 7-2-1, or <strong>· TC</strong> on TrueColor fallback.
              </div>
            </div>
          </div>

          {/* Primo Webcams */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">📷</span>
              <div>
                <div className="ds-source-name">Primo Webcams — New Plymouth</div>
                <a className="ds-source-url" href="https://www.primo.nz/webcameras/" target="_blank" rel="noreferrer">primo.nz/webcameras</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Cameras", "Chimney West · East End SLSC · Fitzroy East"],
                ["Coverage", "Motumahanga + Nga Motu (Chimney West, East End); Nga Motu only (East End SLSC)"],
                ["Update freq", "Live JPEG snapshots — fetched on load"],
                ["CORS", "Open — pixel-readable cross-origin"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Cameras face <strong>west</strong> — morning easterly sun backlights the water for ideal colour contrast. Solar confidence is highest 6–11am (1.0), drops to 0.35 after 1pm (glare), near-zero at night. Morning readings (6–11am) are stored in Supabase and re-used throughout the day (12h decay window), avoiding glare-corrupted afternoon reads. Live reads outside morning window decay over 2 hours.
              </div>
            </div>
          </div>

          {/* TRC River Gauges */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">💧</span>
              <div>
                <div className="ds-source-name">TRC River Turbidity Gauges</div>
                <a className="ds-source-url" href="https://www.trc.govt.nz/environment/maps-and-data/regional-overview?measureID=19" target="_blank" rel="noreferrer">trc.govt.nz — Environmental Data (measureID=19)</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Provides", "Live FNU turbidity readings from 6 Taranaki river gauges, every 5 minutes"],
                ["Gauges", "Mangaehu · Mangati · Urenui · Waingongoro · Waiokura · Waitaha"],
                ["Proxy", "Netlify Function (/.netlify/functions/trc-river) — proxies TRC to bypass CORS"],
                ["Trend", "6-hour rising/falling trend computed; rising adds 1.3× multiplier to river penalty"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                FNU is converted to a 0–100 turbidity score: &lt;3 FNU = crystal (0), 3–10 = slightly elevated (0–15), 10–50 = elevated (15–50), 50–200 = murky (50–85), &gt;200 = flood turbidity (85–100). Each spot maps to its geographically nearest gauge(s). The river gauge adjustment is capped at <strong>−20 to +8 points</strong> and only activates when <code>river_impact &gt; 0.1</code>.
              </div>
            </div>
          </div>

          {/* Supabase */}
          <div className="ds-source-card">
            <div className="ds-source-header">
              <span className="ds-source-icon">🗄️</span>
              <div>
                <div className="ds-source-name">Supabase — Community Dive Logs</div>
                <a className="ds-source-url" href="https://supabase.com" target="_blank" rel="noreferrer">mgcwrktuplnjtxkbsypc.supabase.co</a>
              </div>
            </div>
            <div className="ds-source-body">
              {[
                ["Tables", "dive_logs (observed visibility + model score) · webcam_readings (morning cache)"],
                ["Bias system", "Per-spot multiplier (0.6–1.4×) from last 20 logs, exponentially weighted"],
                ["Access", "Anon key (read/write) — community-shared, not private"],
              ].map(([l, v]) => <div key={l} className="ds-source-row"><span className="ds-row-label">{l}</span><span className="ds-row-val">{v}</span></div>)}
              <div className="ds-source-notes">
                Dive logs calibrate the model over time — when you log a real visibility observation, the bias multiplier adjusts future scores for that spot. The webcam_readings table caches the morning (peak-solar) webcam reading once per day per spot, so glare-affected afternoon fetches don't overwrite the reliable morning read.
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── SPOT COORDINATES ───────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">📍 Spot Coordinates</h3>
        <p className="ds-section-desc">
          Each spot has three coordinate sets: the <strong>display location</strong> (actual dive spot), a <strong>marine API offset</strong> (~10–18 km offshore to avoid the 0.5° land mask), and a <strong>weather API coordinate</strong> (on land for reliable wind/rain data).
        </p>
        <div className="ds-coords-table-wrap">
          <table className="ds-coords-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th>Display Lat/Lon</th>
                <th>Marine API</th>
                <th>Weather API</th>
                <th>TRC Gauges</th>
              </tr>
            </thead>
            <tbody>
              {spots.map(s => (
                <tr key={s.name}>
                  <td className="ds-coord-name">{s.name}</td>
                  <td className="ds-coord-num">{s.lat.toFixed(3)}°S, {s.lon.toFixed(3)}°E</td>
                  <td className="ds-coord-num">{s.marine_lat?.toFixed(2)}°S, {s.marine_lon?.toFixed(2)}°E</td>
                  <td className="ds-coord-num">{s.weather_lat?.toFixed(3)}°S, {s.weather_lon?.toFixed(3)}°E</td>
                  <td className="ds-coord-note">{s.trc_sites ? s.trc_sites.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SPOT PARAMETERS ────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">⚙️ Per-Spot Parameters</h3>
        <p className="ds-section-desc">
          Pipeline-calibrated coefficients control how each spot responds to conditions. All values 0–1 except tide_sensitive.
        </p>
        <div className="ds-coords-table-wrap">
          <table className="ds-coords-table ds-params-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th title="How much shelter reduces bad-condition penalties">Shelter</th>
                <th title="River runoff sensitivity">River</th>
                <th title="Papa rock / sediment risk">Papa</th>
                <th title="Swell exposure">Swell exp.</th>
                <th title="Best wind directions (offshore for this aspect)">Best wind dirs</th>
                <th title="Worst wind directions (onshore)">Worst wind dirs</th>
                <th title="Tide sensitivity">Tide</th>
              </tr>
            </thead>
            <tbody>
              {spots.map(s => (
                <tr key={s.name}>
                  <td className="ds-coord-name" style={{ textAlign: "left", fontFamily: "inherit", fontSize: "0.72rem" }}>{s.name.split("—")[0].split("(")[0].trim()}</td>
                  <td style={{ color: s.shelter > 0.6 ? "#00e5a0" : s.shelter < 0.3 ? "#f07040" : "#f0c040" }}>{s.shelter.toFixed(2)}</td>
                  <td style={{ color: s.river_impact > 0.6 ? "#f07040" : s.river_impact < 0.2 ? "#00e5a0" : "#f0c040" }}>{s.river_impact.toFixed(2)}</td>
                  <td style={{ color: s.papa_risk > 0.6 ? "#f07040" : s.papa_risk < 0.2 ? "#00e5a0" : "#f0c040" }}>{s.papa_risk.toFixed(2)}</td>
                  <td style={{ color: s.swell_exposure > 0.6 ? "#f07040" : s.swell_exposure < 0.2 ? "#00e5a0" : "#f0c040" }}>{s.swell_exposure.toFixed(2)}</td>
                  <td style={{ color: "#6ab4c8", fontSize: "0.65rem" }}>{(s.best_wind_dirs||[]).map(d=>["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(d/22.5)%16]).join(", ")}</td>
                  <td style={{ color: "#f07050", fontSize: "0.65rem" }}>{(s.worst_wind_dirs||[]).map(d=>["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(d/22.5)%16]).join(", ")}</td>
                  <td>{(s.tide_sensitive||0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── GLOBAL WEIGHTS ─────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">⚖️ Global Scoring Weights</h3>
        <p className="ds-section-desc">Pipeline-calibrated weights applied uniformly across all spots.</p>
        <div className="ds-weights-grid">
          {[
            { val: W.w_swell,       label: "Swell weight",        desc: "Primary factor — wave height + period" },
            { val: W.w_wind,        label: "Wind weight",         desc: "Wind speed and direction sub-score" },
            { val: W.w_rain,        label: "Rain weight",         desc: "14-day rain history with papa decay" },
            { val: W.push_mult,     label: "Offshore push mult",  desc: "Blue-water suck bonus per offshore wind" },
            { val: W.rain_pen_mult, label: "Rain push penalty",   desc: "Suppresses push bonus during rain events" },
            { val: W.cur_north,     label: "Current north",       desc: "Bonus for northerly (clean Tasman) current" },
            { val: W.cur_south,     label: "Current south",       desc: "Penalty for southerly (turbid bight) current" },
            { val: W.bight_mult,    label: "Bight mult",          desc: "Amplifies southerly penalty for bight-exposed spots" },
            { val: W.sst_warm,      label: "SST warm bonus",      desc: "Bonus when SST > 18°C (no upwelling)" },
            { val: W.sst_cold,      label: "SST cold penalty",    desc: "Penalty when SST < 16°C (upwelling = murky)" },
            { val: W.river_mult,    label: "River mult",          desc: "Scales the rain-based river penalty" },
            { val: W.hist_2_5,      label: "Swell hist ×2.5m",    desc: "Score multiplier if 72h avg swell >2.5m" },
          ].map(({ val, label, desc }) => (
            <div key={label} className="ds-weight-card">
              <div className="ds-weight-val">{val}</div>
              <div className="ds-weight-label">{label}</div>
              <div className="ds-weight-desc">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CALIBRATION ────────────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">🔬 Calibration & Known Limits</h3>
        <div className="ds-validation-items">
          {[
            { icon: "🗓️", title: "Pipeline calibration", text: "Spot parameters (best/worst wind dirs, swell max, rain recovery days) derived from 3–5 years of historical MODIS satellite data cross-referenced with Open-Meteo weather and marine hindcasts. Fin Fuckers seasonal data is estimated — pending pipeline run." },
            { icon: "🛰️", title: "Satellite turbidity", text: "SWIR band (2.1µm) is the primary turbidity scorer — sediment-specific, unaffected by sun glint. TrueColor is fallback only. Confidence decays over 3 days. Cloud cover can force 7–14 day old imagery." },
            { icon: "🟤", title: "Plume reach model", text: "Motumahanga has a plume-reach model: weighted 14-day rain history (4-day half-life) drives a 0–100% factor. At 100%, the island is scored like an inshore spot. Calibrated against Feb 2026 satellite imagery showing plume past the island 3+ days post-rain." },
            { icon: "💧", title: "River gauge integration", text: "TRC FNU readings are live-measured turbidity — more direct than rain-proxy alone. Rising trends (>5 FNU/6h) get a 1.3× amplifier. Capped at ±20 points to prevent gauge outages from crashing scores." },
            { icon: "📷", title: "Webcam solar limitation", text: "Cameras face west — afternoon sun creates glare that washes out colour contrast. Morning reads (6–11am) are cached in Supabase. After 11am the cached morning read is used with a 12-hour decay, so glare never contaminates the turbidity score." },
            { icon: "🌊", title: "Tide limitation", text: "Tide sensitivity is calibrated per spot but the tide_h value comes from Open-Meteo's tidal model, not a dedicated NZ tidal gauge. Predictions may differ from actual tides by 10–20 cm." },
            { icon: "🔴", title: "7-day forecast limitations", text: "Satellite turbidity and webcam/river data only affect today's score — not the 7-day forecast bars. Forecast bars use the rain + swell + wind model only. Always cross-check with MetService and Port Taranaki sea conditions before heading out." },
          ].map(({ icon, title, text }) => (
            <div key={title} className="ds-val-item">
              <div className="ds-val-icon">{icon}</div>
              <div>
                <div className="ds-val-title">{title}</div>
                <div className="ds-val-text">{text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CROSS-CHECK LINKS ──────────────────────────────────────────────── */}
      <div className="ds-section">
        <h3 className="ds-section-title">🔗 Cross-Check Resources</h3>
        <p className="ds-section-desc">Always verify model outputs with these independent sources before heading out.</p>
        <div className="ds-links-grid">
          {[
            { name: "Port Taranaki — Sea Conditions", desc: "LIVE wind, wave & tide — Lee Breakwater anemometer", url: "https://www.port.co.nz/marine-services/sea-conditions/" },
            { name: "TRC River Turbidity", desc: "Live FNU readings — all 6 Taranaki gauges", url: "https://www.trc.govt.nz/environment/maps-and-data/regional-overview?measureID=19" },
            { name: "Windfinder — Port Taranaki", desc: "Live wind station + forecast", url: "https://www.windfinder.com/forecast/new_plymouth" },
            { name: "Windy.app — New Plymouth", desc: "GFS wind/wave forecast overlay", url: "https://windy.app/forecast2/spots/New-Plymouth" },
            { name: "MetService — Taranaki", desc: "Official NZ weather forecast", url: "https://www.metservice.com/towns-cities/locations/new-plymouth" },
            { name: "Primo Webcams", desc: "Live west-facing coastal cameras", url: "https://www.primo.nz/webcameras/" },
            { name: "NASA Worldview", desc: "True-colour satellite imagery — verify cloud cover", url: "https://worldview.earthdata.nasa.gov/?l=MODIS_Aqua_CorrectedReflectance_TrueColor" },
            { name: "Surf-Forecast Taranaki", desc: "Swell forecast verification", url: "https://www.surf-forecast.com/breaks/New-Plymouth/forecasts/latest" },
          ].map(({ name, desc, url }) => (
            <a key={name} className="ds-link-card" href={url} target="_blank" rel="noreferrer">
              <div className="ds-link-name">{name}</div>
              <div className="ds-link-desc">{desc}</div>
              <span className="ds-link-arrow">↗</span>
            </a>
          ))}
        </div>
      </div>

    </div>
  );
}


