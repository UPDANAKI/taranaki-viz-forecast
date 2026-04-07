// netlify/functions/open-meteo.js
// Server-side proxy for Open-Meteo weather and marine APIs.
// Eliminates CORS restrictions when fetching from vizcast.nz.
//
// Usage:
//   /.netlify/functions/open-meteo?type=weather&latitude=...&longitude=...&...
//   /.netlify/functions/open-meteo?type=marine&latitude=...&longitude=...&...
//
// The `type` param selects the upstream host:
//   weather → https://api.open-meteo.com/v1/forecast
//   marine  → https://marine-api.open-meteo.com/v1/marine
// All other query params are forwarded as-is.

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=1800", // 30 min — Open-Meteo updates hourly
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const params = event.queryStringParameters ?? {};
  const type = params.type;

  if (type !== "weather" && type !== "marine") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "type must be 'weather' or 'marine'" }),
    };
  }

  // Forward all params except 'type' to the upstream API
  const upstream = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k !== "type") upstream.append(k, v);
  }

  const base =
    type === "weather"
      ? "https://api.open-meteo.com/v1/forecast"
      : "https://marine-api.open-meteo.com/v1/marine";

  try {
    const res = await fetch(`${base}?${upstream.toString()}`, {
      headers: { "User-Agent": "Vizcast/1.0" },
      signal: AbortSignal.timeout(15000),
    });

    const body = await res.text();

    if (!res.ok) {
      return { statusCode: res.status, headers, body };
    }

    return { statusCode: 200, headers, body };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
