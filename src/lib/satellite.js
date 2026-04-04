// ── Satellite pixel sampling ─────────────────────────────────────────────────

export function latLonToTilePx(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return {
    tileX:  Math.floor(x),
    tileY:  Math.floor(y),
    pixelX: Math.floor((x % 1) * 256),
    pixelY: Math.floor((y % 1) * 256),
  };
}

// ── Pixel quality classification ─────────────────────────────────────────────
// Works for BOTH TrueColor (R=red vis, G=green vis, B=blue vis) and
// Bands721 (R=SWIR band7 2.1µm, G=NIR band2 0.86µm, B=red band1 0.65µm).
// Cloud/glint detection is band-agnostic (brightness + saturation).
export function classifyPixel(r, g, b, a) {
  if (a < 10) return "transparent";
  const brightness = (r + g + b) / 3;
  // Nearly black: shadow, bad data, or land edge — not valid water
  if (brightness < 8) return "invalid";
  const maxCh = Math.max(r, g, b);
  const minCh = Math.min(r, g, b);
  const saturation = maxCh > 0 ? (maxCh - minCh) / maxCh : 0;
  // Cloud: very bright AND low saturation (white/grey in both composites)
  if (brightness > 195 && saturation < 0.12) return "cloud";
  // Sun glint: extremely bright regardless of colour
  if (brightness > 215) return "glint";
  // Land in TrueColor: green/brown with low blue
  // Land in Bands721: vegetation = very high NIR (green channel), low blue
  if (g > 160 && b < 80) return "land";               // vegetation (NIR-bright in B721)
  if (r > b * 1.5 && g > b * 1.2 && b < 90) return "land"; // bare/brown land in TC
  return "water";
}

// Normalised ocean turbidity index from TrueColor pixel — illumination-independent
// Returns 0 (clear deep blue) → 100 (very turbid brown/green)
export function calcTurbidity(r, g, b) {
  const total = r + g + b;
  if (total < 10) return null;
  // Normalised band fractions — divide out overall brightness/illumination
  const rn = r / total;
  const gn = g / total;
  const bn = b / total;
  // Clear offshore ocean: bn ≈ 0.40–0.50 (blue dominates)
  // Turbid river plume: rn + gn high (0.55–0.70), bn low (0.25–0.35)
  // Sediment index: weighted red+green vs blue ratio
  const sedimentIdx = (rn * 0.65 + gn * 0.35) / Math.max(0.01, bn);
  // Blue bonus: extra clear-water credit when blue fraction is high
  const bluenessBonus = Math.max(0, bn - 0.38) * 80;
  const raw = sedimentIdx * 55 - bluenessBonus;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export async function sampleGibsTile(layer, date, zoom, fmt, spots) {
  const results = {};
  const tiles = {};
  for (const spot of spots) {
    const t = latLonToTilePx(spot.lat, spot.lon, zoom);
    const key = t.tileX + "," + t.tileY;
    if (!tiles[key]) tiles[key] = { tileX: t.tileX, tileY: t.tileY, spots: [] };
    tiles[key].spots.push({ ...spot, pixelX: t.pixelX, pixelY: t.pixelY });
  }

  const matrixSet = zoom <= 7
    ? "GoogleMapsCompatible_Level7"
    : "GoogleMapsCompatible_Level9";

  for (const [, tile] of Object.entries(tiles)) {
    const url = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
      layer + "/default/" + date + "/" + matrixSet +
      "/" + zoom + "/" + tile.tileY + "/" + tile.tileX + "." + fmt;

    try {
      // Sample a 5×5 neighbourhood (radius=2) around the spot pixel to reduce
      // single-pixel noise and give cloud masking more pixels to work with
      const sampleNeighbourhood = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 256; c.height = 256;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          resolve((px, py, radius = 2) => {
            const pixels = [];
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const x = Math.max(0, Math.min(255, px + dx));
                const y = Math.max(0, Math.min(255, py + dy));
                const d = ctx.getImageData(x, y, 1, 1).data;
                pixels.push([d[0], d[1], d[2], d[3]]);
              }
            }
            return pixels;
          });
        };
        img.onerror = reject;
        img.src = url;
      });

      for (const spot of tile.spots) {
        try {
          const allPixels = sampleNeighbourhood(spot.pixelX, spot.pixelY, 2);

          // Keep only valid water pixels — reject cloud, glint, land, transparent
          const waterPixels = allPixels.filter(([r, g, b, a]) =>
            classifyPixel(r, g, b, a) === "water"
          );

          if (waterPixels.length === 0) {
            console.warn(`[Satellite] ${spot.name} ${date}: all ${allPixels.length} pixels invalid (cloud/glint/land) — skipping`);
            continue;
          }

          // Use median-brightness water pixel to avoid outliers
          waterPixels.sort((a, b) => (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]));
          const [r, g, b] = waterPixels[Math.floor(waterPixels.length / 2)];

          const turbidity = layer.includes("TrueColor") ? calcTurbidity(r, g, b) : null;

          if (turbidity !== null) console.log(`[Satellite] ${spot.name} ${date}: rgb(${r},${g},${b}) turbidity=${turbidity} (${waterPixels.length}/${allPixels.length} valid px)`);

          results[spot.name] = { r, g, b, turbidity };
        } catch(e) {}
      }
    } catch(e) {}
  }
  return results;
}
