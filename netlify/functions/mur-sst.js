// mur-sst.js — Netlify serverless function
// Fetches NASA MUR SST (1km resolution) from CoastWatch ERDDAP for a spot's
// marine coordinates.
//
// Query params:
//   lat   — marine latitude (float)
//   lon   — marine longitude (float)
//   date  — anchor date YYYY-MM-DD (typically today in local timezone)
//   days  — how many days back to fetch (default 8, max 22)
//
// Returns:
//   { sst: [float|null, ...], source: 'MUR'|'failed' }
//   sst[0] = anchor date (today), sst[1] = yesterday, ...
//   null entries = MUR has no data for that date (cloud, ice, or latency)
//
// MUR latency: ~1 day, so sst[0] (today) is often null; sst[1] (yesterday) reliable.
// Cache: 3 hours (SST changes slowly; avoids hammering CoastWatch during page loads).

exports.handler = async (event) => {
  const { lat, lon, date, days = '8' } = event.queryStringParameters || {};

  if (!lat || !lon || !date) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'lat, lon, date required' }),
    };
  }

  const nDays = Math.min(parseInt(days) || 8, 22);
  const results = [];
  const baseDate = new Date(date + 'T00:00:00Z');

  for (let i = 0; i < nDays; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split('T')[0] + 'T09:00:00Z';

    const url =
      `https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json` +
      `?analysed_sst[(${dateStr})][(${lat})][(${lat})][(${lon})][(${lon})]`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { results.push(null); continue; }
      const json = await res.json();
      // Column order: [time, latitude, longitude, analysed_sst]
      // jplMURSST41 returns °C directly (not Kelvin)
      const sst = json.table?.rows?.[0]?.[3];
      results.push(sst != null && sst > -10 ? Math.round(sst * 10) / 10 : null);
    } catch {
      results.push(null);
    }
  }

  const hasData = results.some(v => v !== null);

  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'public, max-age=10800' },  // 3hr cache
    body: JSON.stringify({
      sst:    results,
      source: hasData ? 'MUR' : 'failed',
    }),
  };
};
