import { parseDateLocal, scoreToColor } from "../lib/scoring.js";

export function FactorBar({ label, value, isDelta }) {
  const color = isDelta
    ? value > 0 ? "#00e5a0" : value < 0 ? "#e03030" : "#607d8b"
    : value >= 70 ? "#00e5a0" : value >= 50 ? "#f0c040" : value >= 30 ? "#f07040" : "#e03030";
  const display = isDelta
    ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}`
    : Math.round(value);
  return (
    <div className="factor">
      <div className="factor-key">{label}</div>
      <div className="factor-val" style={{ color }}>{display}</div>
    </div>
  );
}

// ── Score chart ──────────────────────────────────────────────────────────────
export function ScoreChart({ days }) {
  if (!days || days.length === 0) return null;
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const n = days.length;

  // Match ConditionsChart layout exactly
  const LABEL_W = 34;
  const CHART_W = 320;
  const BAR_H   = 70;
  const SCORE_H = 14;
  const LABEL_H = 10;
  const DAY_H   = 16;
  const TOTAL_H = DAY_H + BAR_H + SCORE_H + LABEL_H + 4;
  const colW    = (CHART_W - LABEL_W) / n;
  const cx      = i => LABEL_W + colW * i + colW / 2;

  return (
    <div className="chart-wrap">
      <div className="chart-label">VISIBILITY FORECAST</div>
      <svg viewBox={"0 0 "+CHART_W+" "+TOTAL_H} width="100%" style={{display:"block",overflow:"visible"}}>

        {/* Col dividers — matches conditions chart */}
        {days.map((_, i) => i > 0 && (
          <line key={i} x1={LABEL_W + colW*i} x2={LABEL_W + colW*i}
            y1="0" y2={TOTAL_H} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
        ))}

        {/* Today highlight */}
        <rect x={LABEL_W} y="0" width={colW} height={TOTAL_H}
          fill="rgba(106,180,200,0.04)" stroke="none"/>

        {days.map((d, i) => {
          const date   = parseDateLocal(d.date);
          const dayName = i === 0 ? "TODAY" : dayNames[date.getDay()].toUpperCase();
          const color  = scoreToColor(d.score);
          const label  = d.score >= 80 ? "Exc" : d.score >= 60 ? "Good" : d.score >= 40 ? "Fair" : d.score >= 20 ? "Poor" : "Bad";
          const barH   = Math.max(3, (d.score / 100) * BAR_H);
          const barW   = Math.min(colW - 6, 30);
          const px     = cx(i);

          return (
            <g key={d.date}>
              {/* Day name top */}
              <text x={px} y={DAY_H/2} textAnchor="middle" dominantBaseline="central"
                fontSize={i===0?"7":"6.5"} fontFamily="Space Mono,monospace"
                fill={i===0?"#6ab4c8":"#3a6a7a"} fontWeight={i===0?"700":"400"}>
                {dayName}
              </text>
              {/* Bar */}
              <rect x={px - barW/2} y={DAY_H + BAR_H - barH}
                width={barW} height={barH} rx="2"
                fill={color+"99"} stroke={color} strokeWidth="1.5"/>
              {/* Score */}
              <text x={px} y={DAY_H + BAR_H + SCORE_H/2 + 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize="9" fontWeight="700" fontFamily="Space Mono,monospace" fill={color}>
                {d.score}
              </text>
              {/* Label */}
              <text x={px} y={DAY_H + BAR_H + SCORE_H + LABEL_H/2 + 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize="6.5" fontFamily="Space Mono,monospace" fill={color+"bb"}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Conditions chart — swimlane ──────────────────────────────────────────────
export function ConditionsChart({ days, currentData }) {
  if (!days || days.length === 0) return null;
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const n = days.length;

  function wc(spd) {
    return spd <= 8 ? "#00e5a0" : spd <= 15 ? "#6ab4c8" : spd <= 25 ? "#f0c040" : spd <= 35 ? "#f07040" : "#e03030";
  }
  function sc(h) {
    return h < 0.5 ? "#00e5a0" : h < 1.0 ? "#6ab4c8" : h < 1.5 ? "#f0c040" : h < 2.0 ? "#f07040" : "#e03030";
  }

  // Layout
  const LABEL_W = 34;
  const ROW_H_PILL = 38;  // swell + wind rows
  const ROW_H_RAIN = 22;  // rain row
  const ROW_H_SST  = 30;  // SST row
  const DAY_ROW    = 18;  // day name footer
  const TOTAL_H    = ROW_H_PILL * 2 + ROW_H_RAIN + ROW_H_SST + DAY_ROW;
  const CHART_W    = 320;
  const colW       = (CHART_W - LABEL_W) / n;
  const cx         = i => LABEL_W + colW * i + colW / 2;

  // Row Y offsets
  const Y_SWELL = 0;
  const Y_WIND  = ROW_H_PILL;
  const Y_RAIN  = ROW_H_PILL * 2;
  const Y_SST   = ROW_H_PILL * 2 + ROW_H_RAIN;
  const Y_DAYS  = Y_SST + ROW_H_SST;

  const maxRain = Math.max(1, ...days.map(d => d.cond.rain_48h ?? 0));
  const sstVals = days.map(d => d.cond.sst ?? 16);
  const sstMin  = Math.min(...sstVals);
  const sstMax  = Math.max(...sstVals);

  const PILL_W = Math.min(colW - 4, 36);
  const PILL_H = 20;

  return (
    <div className="chart-wrap" style={{marginTop:"0.8rem"}}>
      <div className="chart-label">CONDITIONS</div>
      <svg viewBox={"0 0 "+CHART_W+" "+TOTAL_H} width="100%" style={{display:"block",overflow:"visible"}}>

        {/* ── Row backgrounds ── */}
        <rect x="0" y={Y_SWELL} width={CHART_W} height={ROW_H_PILL} fill="rgba(106,180,200,0.05)"/>
        <rect x="0" y={Y_WIND}  width={CHART_W} height={ROW_H_PILL} fill="rgba(138,180,200,0.03)"/>
        <rect x="0" y={Y_RAIN}  width={CHART_W} height={ROW_H_RAIN} fill="rgba(100,180,220,0.03)"/>
        <rect x="0" y={Y_SST}   width={CHART_W} height={ROW_H_SST}  fill="rgba(0,229,160,0.02)"/>
        <rect x="0" y={Y_DAYS}  width={CHART_W} height={DAY_ROW}    fill="rgba(0,0,0,0.15)"/>

        {/* ── Row dividers ── */}
        {[Y_WIND, Y_RAIN, Y_SST, Y_DAYS].map(y => (
          <line key={y} x1="0" x2={CHART_W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        ))}

        {/* ── Row labels ── */}
        {[
          {label:"SWELL", y: Y_SWELL + ROW_H_PILL/2, col:"#3a8a9a"},
          {label:"WIND",  y: Y_WIND  + ROW_H_PILL/2, col:"#3a7a8a"},
          {label:"RAIN",  y: Y_RAIN  + ROW_H_RAIN/2, col:"#2a6a7a"},
          {label:"SST",   y: Y_SST   + ROW_H_SST/2,  col:"#2a6a6a"},
        ].map(({label, y, col}) => (
          <text key={label} x="2" y={y} fontSize="6" fontFamily="Space Mono,monospace"
            fill={col} fontWeight="700" dominantBaseline="central">{label}</text>
        ))}

        {/* ── Col dividers ── */}
        {days.map((_, i) => i > 0 && (
          <line key={i} x1={LABEL_W + colW*i} x2={LABEL_W + colW*i}
            y1="0" y2={Y_DAYS} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
        ))}

        {/* ── Day data ── */}
        {days.map((d, i) => {
          const date    = parseDateLocal(d.date);
          const dayName = i === 0 ? "TODAY" : dayNames[date.getDay()].toUpperCase();
          const swell   = d.cond.swell_h;
          const wind    = d.cond.wind_spd;
          const rain    = d.cond.rain_48h ?? 0;
          const sst     = d.cond.sst ?? 16;
          const swc     = sc(swell);
          const wnc     = wc(wind);
          const sstC    = sst > 18 ? "#00e5a0" : sst > 16 ? "#6ab4c8" : sst > 14 ? "#f0c040" : "#e03030";
          const swDir   = (d.cond.swell_dir ?? d.cond.swell_wave_dir) ?? 0;
          const wiDir   = d.cond.wind_dir ?? 0;
          const px      = cx(i);

          // Rain bar width proportional (max fills 80% of cell)
          const rainBarW = rain > 0 ? Math.max(4, (rain / maxRain) * (colW * 0.8)) : 0;
          // SST dot radius 3–6 based on relative temp
          const sstR = sstMax > sstMin
            ? 3 + ((sst - sstMin) / (sstMax - sstMin)) * 3
            : 4.5;

          return (
            <g key={d.date}>
              {/* SWELL pill */}
              <rect x={px - PILL_W/2} y={Y_SWELL + (ROW_H_PILL-PILL_H)/2}
                width={PILL_W} height={PILL_H} rx="4"
                fill={swc+"28"} stroke={swc} strokeWidth={i===0?"1.5":"1"}/>
              <text x={px} y={Y_SWELL + ROW_H_PILL/2 - 1}
                textAnchor="middle" dominantBaseline="central"
                fontSize="8" fontWeight="700" fontFamily="Space Mono,monospace" fill={swc}>
                {swell.toFixed(1)}m
              </text>
              {/* Swell direction arrow */}
              <g transform={"translate("+px+","+(Y_SWELL+ROW_H_PILL-6)+") rotate("+swDir+")"}>
                <line x1="0" y1="-5" x2="0" y2="2" stroke={swc} strokeWidth="1.5" strokeLinecap="round"/>
                <polygon points="0,-6 -2,-2 2,-2" fill={swc}/>
              </g>

              {/* WIND pill */}
              <rect x={px - PILL_W/2} y={Y_WIND + (ROW_H_PILL-PILL_H)/2}
                width={PILL_W} height={PILL_H} rx="4"
                fill={wnc+"18"} stroke={wnc+"99"} strokeWidth={i===0?"1.5":"1"}/>
              <text x={px} y={Y_WIND + ROW_H_PILL/2 - 1}
                textAnchor="middle" dominantBaseline="central"
                fontSize="7.5" fontWeight="700" fontFamily="Space Mono,monospace" fill={wnc+"cc"}>
                {wind.toFixed(0)}kph
              </text>
              {/* Wind direction arrow */}
              <g transform={"translate("+px+","+(Y_WIND+ROW_H_PILL-6)+") rotate("+wiDir+")"}>
                <line x1="0" y1="-5" x2="0" y2="2" stroke={wnc} strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
                <polygon points="0,-6 -2,-2 2,-2" fill={wnc} opacity="0.8"/>
              </g>

              {/* RAIN bar */}
              {rain > 0 ? (
                <>
                  <rect x={px - rainBarW/2} y={Y_RAIN + 4}
                    width={rainBarW} height={ROW_H_RAIN - 8} rx="2"
                    fill="rgba(100,180,220,0.3)" stroke="rgba(100,180,220,0.5)" strokeWidth="1"/>
                  <text x={px} y={Y_RAIN + ROW_H_RAIN/2}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="6.5" fontFamily="Space Mono,monospace" fill="#6ab4c8cc">
                    {rain.toFixed(0)}mm
                  </text>
                </>
              ) : (
                <text x={px} y={Y_RAIN + ROW_H_RAIN/2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize="8" fontFamily="Space Mono,monospace" fill="rgba(58,100,120,0.4)">—</text>
              )}

              {/* SST dot + value */}
              <circle cx={px} cy={Y_SST + ROW_H_SST/2 - 2} r={sstR}
                fill={sstC+"44"} stroke={sstC} strokeWidth="1.2"/>
              <text x={px} y={Y_SST + ROW_H_SST - 5}
                textAnchor="middle" fontSize="6.5"
                fontFamily="Space Mono,monospace" fill={sstC+"bb"}>
                {sst.toFixed(1)}°
              </text>

              {/* Day name */}
              <text x={px} y={Y_DAYS + DAY_ROW/2}
                textAnchor="middle" dominantBaseline="central"
                fontSize={i===0?"7":"6.5"} fontFamily="Space Mono,monospace"
                fill={i===0?"#6ab4c8":"#3a6a7a"} fontWeight={i===0?"700":"400"}>
                {dayName}
              </text>
            </g>
          );
        })}

        {/* ── Today highlight border ── */}
        <rect x={LABEL_W} y="0" width={colW} height={Y_DAYS}
          fill="none" stroke="rgba(106,180,200,0.15)" strokeWidth="1.5" rx="2"/>

      </svg>

      {/* Legend */}
      <div className="cc-legend">
        <div className="cc-legend-row">
          <span className="cc-legend-item">Pill colour + arrow = intensity &amp; direction</span>
          <span className="cc-legend-item"><span style={{color:"#00e5a0"}}>■</span> Calm &nbsp;<span style={{color:"#6ab4c8"}}>■</span> OK &nbsp;<span style={{color:"#f0c040"}}>■</span> Mod &nbsp;<span style={{color:"#f07040"}}>■</span> Poor &nbsp;<span style={{color:"#e03030"}}>■</span> Bad</span>
        </div>
      </div>
    </div>
  );
}

export function ForecastBar({ days }) { return null; }
export function WindForecastBar({ days }) { return null; }
