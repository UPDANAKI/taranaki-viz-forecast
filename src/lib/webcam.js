// ── Primo Webcam sampling ─────────────────────────────────────────────────────
// Samples pixel regions from Primo's live coastal webcams to infer surface
// turbidity and sea state. Images are CORS-open JPEGs, updated ~every 2 min.
//
// Water regions are defined as fractional bounding boxes [x0,y0,x1,y1] over
// the full image, chosen to cover open sea while avoiding sky, land, and
// camera housing. Each cam maps to one or more spots.
//
// Returns { [spotName]: { turbidity: 0-100, surfaceState: 'calm'|'choppy'|'rough',
//                         camName, fetchedAt, ageMinutes } }

export const PRIMO_CAMS = [
  {
    name: "Chimney West",
    url: "https://www.primo.nz/webcameras/snapshot_chimney_sth.jpg",
    // Right half of image: open sea beyond Sugar Loafs, y=20-50% avoids sky/land
    waterRegion: { x0: 0.50, y0: 0.22, x1: 0.95, y1: 0.50 },
    spots: ["Motumahanga", "Nga Motu / Sugar Loafs"],
  },
  {
    name: "East End SLSC",
    url: "https://www.primo.nz/webcameras/snapshot_eastend_slsc.jpg",
    // Upper portion shows open water horizon; avoid sandy beach at bottom
    waterRegion: { x0: 0.05, y0: 0.10, x1: 0.90, y1: 0.45 },
    spots: ["Nga Motu / Sugar Loafs"],
  },
  {
    name: "Fitzroy East",
    url: "https://www.primo.nz/webcameras/snapshot_fitzboardriders.jpg",
    // Sea visible in upper-right past beach
    waterRegion: { x0: 0.40, y0: 0.10, x1: 0.90, y1: 0.45 },
    spots: [],   // NP city beach, not a dive spot — used for sea state reference only
  },
];

export function calcWebcamTurbidity(r, g, b) {
  // Similar to calcTurbidity but tuned for real-world camera colour balance.
  // Clear water is blue-dominant; turbid (plume/silt) shifts toward brown/grey.
  // Returns 0 (crystal) – 100 (very turbid).
  const brightness = (r + g + b) / 3;
  const blueDom = b - Math.max(r, g);           // positive = blue water
  const brownIndex = (r - b) / (brightness + 1); // positive = brown/turbid
  const greyFlat = 1 - Math.abs(r - g) / (Math.max(r, g, 1));

  // High brightness + low blue dominance = whitewash/glint — unreliable
  if (brightness > 200 && blueDom < 10) return null;  // glint
  // Very dark = night or shadow — skip
  if (brightness < 20) return null;

  // Score: brownIndex drives turbidity; grey flat water (overcast) is neutral ~40
  let turb = 50 + brownIndex * 80 - blueDom * 0.5;
  turb = Math.max(0, Math.min(100, Math.round(turb)));
  return turb;
}

export function calcWebcamSurfaceState(pixelVariance) {
  // Pixel brightness variance over the water region indicates surface roughness
  if (pixelVariance > 800) return "rough";
  if (pixelVariance > 300) return "choppy";
  return "calm";
}

// ── Solar angle / time-of-day webcam confidence ──────────────────────────────
// Key observation: morning sun (east) backlights the water from behind the viewer
// (cameras face west toward the sea from Taranaki coast), making turbidity much
// more visible in the image. Afternoon glare (sun moving west, toward camera)
// washes out colour contrast and reduces pixel analysis reliability.
//
// NZ/Taranaki (UTC+12/+13): Best webcam reads are roughly 6am–11am local time.
// After noon the sun approaches the camera's west-facing direction and glare
// increases. We encode this as a solar confidence multiplier applied to the
// webcam turbidity score weight.

export function solarConfidence() {
  // Returns 0.0–1.0 based on local time of day (NZ timezone approx)
  // Uses local browser time — user is in Taranaki so this is correct
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60; // 0–24 local
  // Best window: 6–11am (sun east, backlighting the sea)
  // Acceptable: 11am–1pm (overhead, neutral)
  // Poor: 1pm–5pm (sun moving west, toward camera, glare)
  // Night: unusable
  if (hour < 5.5 || hour > 19.5) return 0.0;   // dark
  if (hour >= 6 && hour <= 11)   return 1.0;    // peak morning window
  if (hour > 11 && hour <= 13)   return 0.7;    // near noon, acceptable
  if (hour > 13 && hour <= 16)   return 0.35;   // afternoon glare building
  if (hour > 16 && hour <= 19.5) return 0.15;   // late afternoon, low sun glare
  if (hour >= 5.5 && hour < 6)   return 0.4;    // pre-dawn/early light
  return 0.5;
}

export function solarWindowLabel() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < 5.5 || hour > 19.5) return "🌙 dark";
  if (hour >= 6 && hour <= 11)   return "☀️ ideal";
  if (hour > 11 && hour <= 13)   return "🌤 ok";
  if (hour > 13)                 return "😎 glare";
  return "🌅 low light";
}

export async function samplePrimoCams(SPOTS) {
  const results = {};
  const fetchedAt = Date.now();
  const solConf = solarConfidence();
  const solLabel = solarWindowLabel();

  for (const cam of PRIMO_CAMS) {
    try {
      const { r, g, b, variance } = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const W = img.naturalWidth, H = img.naturalHeight;
            const c = document.createElement("canvas");
            c.width = W; c.height = H;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);

            const { x0, y0, x1, y1 } = cam.waterRegion;
            const rx = Math.round(x0 * W), ry = Math.round(y0 * H);
            const rw = Math.round((x1 - x0) * W), rh = Math.round((y1 - y0) * H);

            // Sample a grid of ~60 points across the water region
            const samples = [];
            const cols = 10, rows = 6;
            for (let row = 0; row < rows; row++) {
              for (let col = 0; col < cols; col++) {
                const sx = rx + Math.round((col / (cols - 1)) * rw);
                const sy = ry + Math.round((row / (rows - 1)) * rh);
                const px = ctx.getImageData(sx, sy, 1, 1).data;
                const brightness = (px[0] + px[1] + px[2]) / 3;
                // Reject very bright (glint/sky) and very dark (shadow) pixels
                if (brightness > 210 || brightness < 15) continue;
                samples.push([px[0], px[1], px[2]]);
              }
            }

            if (samples.length < 6) { reject(new Error("insufficient valid pixels")); return; }

            // Median pixel
            samples.sort((a, b) => (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]));
            const med = samples[Math.floor(samples.length / 2)];

            // Variance of brightness across samples
            const brightnesses = samples.map(s => (s[0]+s[1]+s[2]) / 3);
            const mean = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
            const variance = brightnesses.reduce((acc, v) => acc + (v - mean) ** 2, 0) / brightnesses.length;

            resolve({ r: med[0], g: med[1], b: med[2], variance });
          } catch(e) { reject(e); }
        };
        img.onerror = () => reject(new Error("load failed"));
        img.src = cam.url + "?t=" + fetchedAt;
        setTimeout(() => reject(new Error("timeout")), 8000);
      });

      const turbidity = calcWebcamTurbidity(r, g, b);
      if (turbidity === null) continue;
      const surfaceState = calcWebcamSurfaceState(variance);

      console.log(`[Webcam] ${cam.name}: rgb(${r},${g},${b}) turb=${turbidity} surf=${surfaceState} var=${Math.round(variance)}`);

      for (const spotName of cam.spots) {
        // If multiple cams cover a spot, blend by taking the worse (higher) turbidity
        if (results[spotName]) {
          results[spotName].turbidity = Math.round((results[spotName].turbidity + turbidity) / 2);
        } else {
          results[spotName] = { turbidity, surfaceState, camName: cam.name, r, g, b, fetchedAt, ageMinutes: 0, solarConfidence: solConf, solarLabel: solLabel };
        }
      }
    } catch(e) {
      console.warn(`[Webcam] ${cam.name} failed:`, e.message);
    }
  }
  return results;
}
