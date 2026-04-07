// netlify/functions/erddap-current.js
// Proxy for NOAA ERDDAP RTOFS ocean current data
// Endpoint: /.netlify/functions/erddap-current?lat=-39.05&lon=173.87
// Returns: { u, v, speed, dir, dirLabel, modelTime, ageHrs, valid }
// Cached 1 hour — RTOFS updates every 3 hours so this is fine

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600", // 1hr cache
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const lat = parseFloat(event.queryStringParameters?.lat ?? "-39.05");
  const lon = parseFloat(event.queryStringParameters?.lon ?? "173.87");

  if (isNaN(lat) || isNaN(lon)) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Invalid lat/lon" }) };
  }

  try {
    // ERDDAP requires HTTPS — fetch directly from server side (no CORS issue)
    const base = "https://upwell.pfeg.noaa.gov/erddap/griddap/ncepRtofsG2DFore3hrlyProg.json";
    const q = `?u_velocity[(0)][(1.0)][(${lat})][(${lon})],v_velocity[(0)][(1.0)][(${lat})][(${lon})]`;

    const res = await fetch(base + q, {
      headers: { "User-Agent": "TaranakiVizForecast/1.0" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });

    if (!res.ok) throw new Error(`ERDDAP HTTP ${res.status}`);

    const js = await res.json();
    const rows = js.table?.rows;
    if (!rows || rows.length === 0) throw new Error("no rows");

    const [timeStr, , , , u, v] = rows[0];
    if (u == null || v == null || isNaN(u) || isNaN(v)) throw new Error("NaN current");

    const uKt = u * 1.944;
    const vKt = v * 1.944;
    const speed = Math.sqrt(uKt * uKt + vKt * vKt);
    const dirRad = Math.atan2(u, v);
    const dir = ((dirRad * 180 / Math.PI) + 360) % 360;
    const pts = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const dirLabel = pts[Math.round(dir / 22.5) % 16];
    const modelTime = new Date(timeStr);
    const ageHrs = Math.round((Date.now() - modelTime) / 3600000);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, u: uKt, v: vKt, speed, dir, dirLabel, modelTime: timeStr, ageHrs, valid: true }),
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
