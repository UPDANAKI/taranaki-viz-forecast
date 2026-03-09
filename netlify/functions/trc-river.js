// netlify/functions/trc-river.js
// Proxy for TRC (Taranaki Regional Council) river turbidity API
// Endpoint: /.netlify/functions/trc-river?sites=12,17,53,53,117,166,167
// Returns: { [siteId]: { name, latestFNU, latestTime, trend, readings } }

const TRC_BASE = "https://www.trc.govt.nz/environment/maps-and-data/site-details/LoadGraphAndListData";
const MEASURE_ID = 19; // Turbidity
const TIME_PERIOD = "2days"; // 2 days of 5-min readings — enough for trend + latest

// All turbidity sites with names and which coast they face
const SITE_META = {
  12:  { name: "Mangaehu at Huinga",      coast: "south" },
  17:  { name: "Mangati at SH3",           coast: "north" },
  53:  { name: "Waingongoro at SH45",      coast: "south" },
  117: { name: "Waitaha at SH3",           coast: "south" },
  166: { name: "Urenui at Okoki Rd",       coast: "north" },
  167: { name: "Waiokura at No3 Fairway",  coast: "south" },
};

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300", // cache 5 min — matches TRC update freq
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Parse requested site IDs (default: all 6)
  const siteParam = event.queryStringParameters?.sites;
  const requestedIds = siteParam
    ? siteParam.split(",").map(Number).filter(id => SITE_META[id])
    : Object.keys(SITE_META).map(Number);

  try {
    const results = await Promise.allSettled(
      requestedIds.map(async (siteId) => {
        const url = `${TRC_BASE}/?siteID=${siteId}&measureID=${MEASURE_ID}&timePeriod=${TIME_PERIOD}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "TaranakiVizForecast/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for site ${siteId}`);
        const json = await res.json();
        if (json.error) throw new Error(`TRC error for site ${siteId}`);

        const pts = json.highStockData ?? [];
        if (pts.length === 0) return [siteId, null];

        // Latest reading
        const [latestTs, latestFNU] = pts[pts.length - 1];

        // 6-hour trend (compare latest vs 6h ago)
        const sixHoursAgo = latestTs - 6 * 3600 * 1000;
        const sixHourPt = pts.reduce((best, pt) =>
          Math.abs(pt[0] - sixHoursAgo) < Math.abs(best[0] - sixHoursAgo) ? pt : best
        , pts[0]);
        const trend = latestFNU - sixHourPt[1]; // positive = rising turbidity

        // Recent max (last 24h) for plume sizing
        const oneDayAgo = latestTs - 24 * 3600 * 1000;
        const recent = pts.filter(pt => pt[0] >= oneDayAgo);
        const recentMax = Math.max(...recent.map(pt => pt[1]));
        const recentAvg = recent.reduce((sum, pt) => sum + pt[1], 0) / (recent.length || 1);

        return [siteId, {
          name: SITE_META[siteId].name,
          coast: SITE_META[siteId].coast,
          latestFNU: Math.round(latestFNU * 100) / 100,
          latestTime: new Date(latestTs).toISOString(),
          trend: Math.round(trend * 100) / 100,
          recentMax: Math.round(recentMax * 100) / 100,
          recentAvg: Math.round(recentAvg * 100) / 100,
          // Compact sparkline — last 24 readings (2h) for UI display
          sparkline: pts.slice(-24).map(pt => Math.round(pt[1] * 10) / 10),
        }];
      })
    );

    const data = {};
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const [id, val] = result.value;
        if (val) data[id] = val;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, fetched: new Date().toISOString(), sites: data }),
    };

  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
