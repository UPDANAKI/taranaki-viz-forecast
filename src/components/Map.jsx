import { useRef, useState, useEffect } from "react";
import { scoreToColor, scoreToLabel } from "../lib/scoring.js";

export function SpotMap({ spotScores, currentData, currentStatus, spots, mapCenter, mapZoom }) {
  const mapRef         = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef     = useRef([]);
  const layersRef      = useRef({});

  const [activeLayer,  setActiveLayer]  = useState("satellite");
  const [layerDates,   setLayerDates]   = useState({
    truecolor: null,
  });

  function fmtDate(isoStr) {
    if (!isoStr) return null;
    const d = new Date(isoStr + "T00:00:00");
    return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
  }

  function dateStrNDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }

  async function gibsTileHasData(layer, dateStr, fmt) {
    const ext = fmt === "jpg" ? "jpg" : "png";
    const matrix = fmt === "jpg" ? "GoogleMapsCompatible_Level9" : "GoogleMapsCompatible_Level7";
    const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${dateStr}/${matrix}/5/19/31.${ext}`;
    try {
      return await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = 32; c.height = 32;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 32, 32);
            const px = ctx.getImageData(0, 0, 32, 32).data;
            const uniq = new Set();
            for (let i = 0; i < px.length; i += 16) {
              uniq.add(`${px[i]},${px[i+1]},${px[i+2]}`);
            }
            resolve(uniq.size > 8);
          } catch(e) { resolve(true); }
        };
        img.onerror = () => resolve(false);
        img.src = url;
      });
    } catch(e) { return false; }
  }

  async function findLastClearDate(layer, fmt, maxDays = 10) {
    for (let n = 1; n <= maxDays; n++) {
      const dateStr = dateStrNDaysAgo(n);
      const hasData = await gibsTileHasData(layer, dateStr, fmt);
      if (hasData) return dateStr;
    }
    return dateStrNDaysAgo(3);
  }

  function buildMarkers(map, L, scoresArg) {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    spots.forEach(spot => {
      const score   = scoresArg[spot.name] ?? null;
      const color   = score != null ? scoreToColor(score) : "#607d8b";
      const label   = score != null ? scoreToLabel(score) : "Loading…";
      const vis     = ""; // visibility label removed from map — data-driven only
      const size    = 38;

      const svg = `
        <svg width="${size}" height="${size+10}" viewBox="0 0 ${size} ${size+10}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="#040d14" stroke="${color}" stroke-width="2.5" opacity="0.92"/>
          <text x="${size/2}" y="${size/2-3}" text-anchor="middle" fill="${color}"
            font-size="13" font-weight="bold" font-family="monospace">${score ?? "…"}</text>
          <text x="${size/2}" y="${size/2+8}" text-anchor="middle" fill="${color}"
            font-size="6.5" font-family="monospace" opacity="0.85">
            ${vis.replace("🤿","").replace("🦞","").trim()}
          </text>
          <line x1="${size/2}" y1="${size-2}" x2="${size/2}" y2="${size+9}"
            stroke="${color}" stroke-width="2" opacity="0.7"/>
        </svg>`;

      const icon = L.divIcon({
        html: svg, className: "",
        iconSize: [size, size+10], iconAnchor: [size/2, size+10], popupAnchor: [0, -(size+10)],
      });

      const marker = L.marker([spot.lat, spot.lon], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:monospace;font-size:12px;min-width:180px;background:#0a1a26;padding:2px">
            <strong style="font-size:13px;color:${color}">${spot.name}</strong><br/>
            <span style="color:${color};font-size:18px;font-weight:bold">${score ?? "…"}</span>
            <span style="color:#888"> / 100</span> &nbsp;
            <span style="color:${color}">${label}</span><br/>
            ${vis ? `<span style="color:#aaa;font-size:11px">${vis} est.</span><br/>` : ""}
            <hr style="border-color:#1a3a4a;margin:5px 0"/>
            <span style="color:#444;font-size:10px">${spot.note.slice(0,80)}…</span>
          </div>
        `);

      markersRef.current.push(marker);
    });
  }

  async function initMap() {
    if (mapInstanceRef.current || !mapRef.current) return;
    const L = window.L;

    const map = L.map(mapRef.current, {
      center: mapCenter ?? [-39.2, 174.1], zoom: mapZoom ?? 9,
      zoomControl: true, attributionControl: true,
    });
    mapInstanceRef.current = map;

    const tcDate = await findLastClearDate("MODIS_Aqua_CorrectedReflectance_TrueColor", "jpg", 12);

    setLayerDates({ truecolor: tcDate });

    const satellite = L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/${tcDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      { attribution: `NASA GIBS — MODIS Aqua True Colour (${fmtDate(tcDate)})`, maxZoom: 9, tileSize: 256 }
    );
    const labels = L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { opacity: 0.6, maxZoom: 17 }
    );
    const osm = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: "© OpenStreetMap", maxZoom: 17, opacity: 0.4 }
    );

    layersRef.current = { satellite, labels, osm };
    satellite.addTo(map);
    labels.addTo(map);

    buildMarkers(map, L, spotScores);
  }

  useEffect(() => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);
    }
    const load = () => initMap();
    if (window.L) { load(); }
    else {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = load;
      document.head.appendChild(script);
    }
    // Cleanup: destroy map instance when mapCenter changes (region switch)
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersRef.current = [];
        layersRef.current = {};
      }
    };
  }, [mapCenter]);

  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    buildMarkers(mapInstanceRef.current, window.L, spotScores);
  }, [spotScores]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L   = window.L;
    if (!map || !L || !layersRef.current.satellite) return;
    const { satellite, labels, osm } = layersRef.current;
    [satellite, labels, osm].forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    if (activeLayer === "satellite") {
      satellite.addTo(map); labels.addTo(map);
    }
  }, [activeLayer]);

  function activeDateBadge() {
    if (activeLayer === "satellite") {
      return layerDates.truecolor
        ? <span>
            Image date: <strong style={{color:"#6ab4c8"}}>{fmtDate(layerDates.truecolor)}</strong>
            <span style={{color:"#3a6a7a"}}> · NASA MODIS Aqua · 250m</span>
            {layerDates.truecolor <= dateStrNDaysAgo(2) &&
              <span style={{color:"#f0c040"}}> · last clear (cloud on recent days)</span>}
          </span>
        : <span style={{color:"#4a7a8a"}}>Finding last clear satellite pass…</span>;
    }
    return null;
  }

  const layerBtns = [
    { id: "satellite", label: "🛰 Satellite", date: layerDates.truecolor },
  ];

  return (
    <div className="spot-map-wrap">
      <div className="spot-map-toolbar">
        <span className="spot-map-label">📍 FORECAST SPOTS</span>
        <div className="spot-map-layer-btns">
          {layerBtns.map(b => (
            <button key={b.id}
              className={"map-layer-btn" + (activeLayer === b.id ? " active" : "")}
              onClick={() => setActiveLayer(b.id)}>
              <span>{b.label}</span>
              {b.date && (
                <span className="layer-btn-date" style={{
                  display: "block", fontSize: "0.5rem", opacity: 0.75,
                  color: b.date <= dateStrNDaysAgo(2) ? "#f0c040" : "#6ab4c8",
                }}>
                  {b.date}{b.date <= dateStrNDaysAgo(2) ? " ☁" : ""}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div ref={mapRef} className="spot-map" />

      <div className="spot-map-footer">
        <span className="spot-map-date-info">{activeDateBadge()}</span>
        <span className="current-widget">
          {currentStatus === "loading" && (
            <span style={{color:"#4a7a8a",fontSize:"0.7rem"}}>🌊 Loading current…</span>
          )}
          {currentStatus === "ok" && currentData?.valid && (
            <span style={{fontSize:"0.72rem",display:"inline-flex",alignItems:"center",gap:"0.4rem"}}>
              <span style={{color:"#6ab4c8",fontWeight:600}}>🌊 Current</span>
              <span style={{
                display:"inline-block",
                transform:`rotate(${currentData.dir}deg)`,
                fontSize:"1rem", lineHeight:1,
                color: currentData.v < -0.1 ? "#e06040" : currentData.v > 0.1 ? "#40b080" : "#aaa"
              }}>↑</span>
              <span style={{color:"#cde"}}>{currentData.dirLabel}</span>
              <span style={{color:"#8ab"}}>{currentData.speed.toFixed(1)} kt</span>
              <span style={{
                color: currentData.v < -0.1 ? "#e07050" : currentData.v > 0.1 ? "#50c090" : "#8ab",
                fontSize:"0.65rem"
              }}>
                {currentData.v < -0.1 ? "↓ southward — plume risk ↑" :
                 currentData.v > 0.1  ? "↑ northward — cleaner water" :
                 "weak — mixed conditions"}
              </span>
              <span style={{color:"#3a6a7a",fontSize:"0.6rem"}}>RTOFS HYCOM {currentData.ageHrs}h ago</span>
            </span>
          )}
          {currentStatus === "error" && (
            <span style={{color:"#e06040",fontSize:"0.7rem"}}>🌊 Current unavailable</span>
          )}
        </span>
        <span className="spot-map-hint">Click a marker for details</span>
      </div>
    </div>
  );
}
