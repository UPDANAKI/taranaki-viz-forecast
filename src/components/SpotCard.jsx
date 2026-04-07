import { useState } from "react";
import { scoreToColor, scoreToLabel, visLabel, dirName, parseDateLocal, spotBiasMultiplier } from "../lib/scoring.js";
import { loadLog, saveLog } from "../hooks/useDiveLogs.js";
import { TRC_RIVER_SITES } from "../hooks/useRiver.js";
import { CommunityLogPanel } from "./Community.jsx";
import { ScoreChart, ConditionsChart } from "./Charts.jsx";

function DiveLogModal({ spot, modelScore, onSave, onClose, diverName, onCommunitySave, isConfigured }) {
  const [vis, setVis] = useState("");
  const [tide, setTide] = useState("high");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [name, setName] = useState(diverName || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSave() {
    const v = parseFloat(vis);
    if (!name.trim()) { setErr("Enter your name so we can attribute the data."); return; }
    if (isNaN(v) || v <= 0 || v > 50) { setErr("Enter a valid visibility in metres (e.g. 3)"); return; }
    setSaving(true); setErr(null);

    const localEntry = {
      id: Date.now(), date, spot: spot.name,
      observedVis: v, tide, modelScore,
      notes: notes.trim(), diver_name: name.trim(),
    };
    const existing = loadLog();
    const updated = [localEntry, ...existing];
    saveLog(updated);
    onSave(updated);

    if (isConfigured && onCommunitySave) {
      try {
        await onCommunitySave({
          diver_name: name.trim(), date, spot: spot.name,
          observed_vis: v, tide, model_score: modelScore,
          notes: notes.trim(),
        });
      } catch(e) {
        console.error("Community log save failed:", e);
      }
    }
    setSaving(false);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>📝 Log Observation</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-spot">{spot.name}</div>
        <div className="modal-field">
          <label>Your Name</label>
          <input type="text" placeholder="e.g. Mike" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="modal-field">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Observed Visibility (metres)</label>
          <input type="number" step="0.5" min="0.1" max="40" placeholder="e.g. 3"
            value={vis} onChange={e => setVis(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>Tide</label>
          <div className="tide-buttons">
            {["low", "mid", "high"].map(t => (
              <button key={t} className={`tide-btn ${tide === t ? "active" : ""}`}
                onClick={() => setTide(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="modal-field">
          <label>Notes (optional)</label>
          <textarea placeholder="Water colour, fish activity, conditions..." value={notes}
            onChange={e => setNotes(e.target.value)} rows={2} />
        </div>
        {err && <div style={{color:"#e06040",fontSize:"0.75rem",marginBottom:"0.5rem"}}>{err}</div>}
        <div className="modal-footer">
          <div className="modal-score">Model score at time: <strong>{modelScore}</strong></div>
          <button className="modal-save" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "💾 Save to Community Log"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Spot history mini-panel ───────────────────────────────────────────────────

function SpotHistory({ spotName, entries }) {
  const normSpotH = (s) => (s ?? "").split(/[—–(]/)[0].trim().toLowerCase();
  const spotEntries = entries.filter(e => e.spot === spotName || normSpotH(e.spot) === normSpotH(spotName)).slice(0, 3);
  if (spotEntries.length === 0) return null;

  const bias = spotBiasMultiplier(spotName, entries);
  const biasDir = bias > 1.05 ? "↑" : bias < 0.95 ? "↓" : "≈";
  const biasColor = bias > 1.05 ? "#00e5a0" : bias < 0.95 ? "#f07040" : "#607d8b";
  const biasLabel = bias > 1.05
    ? `Model under-predicts by ~${Math.round((bias - 1) * 100)}%`
    : bias < 0.95
    ? `Model over-predicts by ~${Math.round((1 - bias) * 100)}%`
    : "Model accuracy good";

  return (
    <div className="spot-history">
      <div className="history-header">
        <span className="history-title">YOUR OBSERVATIONS</span>
        <span className="history-bias" style={{ color: biasColor }}
          title={biasLabel}>{biasDir} {biasLabel}</span>
      </div>
      {spotEntries.map(e => (
        <div key={e.id} className="history-row">
          <span className="history-date">{e.date}</span>
          <span className="history-vis">{e.observedVis}m</span>
          <span className="history-tide">{e.tide} tide</span>
          {e.notes && <span className="history-note" title={e.notes}>📝</span>}
        </div>
      ))}
    </div>
  );
}

// ── Spot card ─────────────────────────────────────────────────────────────────

export function SpotCard({ spot, data, error, currentData, logEntries, onLogUpdate, communityLogs, logStatus, onCommunitySave, diverName, isConfigured }) {
  const [expanded, setExpanded] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);

  const score = data?.score;
  const color = score != null ? scoreToColor(score) : "#607d8b";

  // Guard: don't render conditions until data and cond are ready
  if (!data?.cond) {
    return (
      <div className="spot-card" style={{ "--accent": color }}>
        <div className="spot-header">
          <span className="spot-name">{spot.name}</span>
          <span className="spot-score" style={{ color }}>—</span>
        </div>
      </div>
    );
  }

  return (
    <div className="spot-card" style={{ "--accent": color }}>
      <div className="spot-header" onClick={() => data && setExpanded(e => !e)}
        style={{ cursor: data ? "pointer" : "default" }}>
        <h3>{spot.name}</h3>
        {spot.river && <span className="river-tag" title="River runoff risk">River</span>}
        {data && <span className="expand-arrow">{expanded ? "▲" : "▼"}</span>}
      </div>

      {!data && !error && <div className="loading-bar"><div className="loading-fill" /></div>}
      {error && <div className="error">{error}</div>}

      {data && (
        <>
          {/* Gauge */}
          <div className="viz-gauge">
            <svg viewBox="0 0 120 70" className="gauge-svg">
              <defs>
                <linearGradient id={`grad-${spot.name.replace(/\W/g, "")}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#e03030" />
                  <stop offset="50%" stopColor="#f0c040" />
                  <stop offset="100%" stopColor="#00e5a0" />
                </linearGradient>
              </defs>
              <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#1a2a3a" strokeWidth="8" strokeLinecap="round" />
              <path d="M10 60 A50 50 0 0 1 110 60" fill="none"
                stroke={`url(#grad-${spot.name.replace(/\W/g, "")})`}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray="157"
                strokeDashoffset={157 - ((score ?? 0) / 100) * 157}
                style={{ transition: "stroke-dashoffset 1s ease" }}
              />
              <text x="60" y="48" textAnchor="middle" fill={color} fontSize="22">{(score ?? 0) >= 80 ? "🤿" : (score ?? 0) >= 60 ? "🐟" : (score ?? 0) >= 40 ? "🦞" : (score ?? 0) >= 20 ? "🌊" : "🚫"}</text>
              <text x="60" y="62" textAnchor="middle" fill={color} fontSize="8" fontWeight="bold" fontFamily="'Space Mono', monospace">{scoreToLabel(score)}</text>
            </svg>
          </div>

          <div className="viz-label" style={{ color }}>
            {visLabel(score, spot.name, logEntries) && (
              <span>{visLabel(score, spot.name, logEntries)}</span>
            )}
            {data.biasMult && Math.abs(data.biasMult - 1.0) >= 0.05 && (
              <span className="bias-indicator" title={`Bias-adjusted from raw score ${data.rawScore}`}>
                {data.biasMult > 1 ? " ↑" : " ↓"} adj
              </span>
            )}
            {data.plumeReach > 0 && (
              <span className="bias-indicator plume-badge"
                style={{color: data.plumeReach >= 80 ? "#e03030" : data.plumeReach >= 40 ? "#f07040" : "#f0c040"}}
                title={`Turbidity plume reaching Motumahanga (${data.plumeReach}% impact).`}>
                {" "}🟤 plume {data.plumeReach}%
              </span>
            )}
          </div>
          <button className="log-btn" onClick={() => setShowLogModal(true)}>+ Log Your Observation</button>
          {showLogModal && (
            <DiveLogModal
              spot={spot}
              modelScore={data.rawScore}
              onSave={onLogUpdate}
              onClose={() => setShowLogModal(false)}
              diverName={diverName}
              onCommunitySave={onCommunitySave}
              isConfigured={isConfigured}
            />
          )}

          {/* Live data strip */}
          <div className="live-strip">
            <span className="ls-item">🌊 <span style={{color:"#6ab4c8"}}>{data.cond.swell_h.toFixed(1)}m {data.cond.swell_p.toFixed(0)}s {dirName(data.cond.swell_dir)}</span></span>
            <span className="ls-sep">·</span>
            <span className="ls-item">
              <span style={{display:"inline-block",transform:"rotate("+data.cond.wind_dir+"deg)",color:data.cond.wind_spd>25?"#f07040":data.cond.wind_spd>15?"#f0c040":"#6ab4c8"}}>↓</span>
              <span style={{color:data.cond.wind_spd>25?"#f07040":data.cond.wind_spd>15?"#f0c040":"#6ab4c8",marginLeft:2}}>{data.cond.wind_spd.toFixed(0)}kph {dirName(data.cond.wind_dir)}</span>
              <span style={{fontSize:"0.55rem",color:"#2a5a6a",marginLeft:3}}>{data.cond.wind_source==="current"?"live":"fcst"}</span>
            </span>
            <span className="ls-sep">·</span>
            <span className="ls-item">🌡️ <span style={{color:data.cond.sst>18?"#00e5a0":data.cond.sst<16?"#f07040":"#6ab4c8"}}>{data.cond.sst.toFixed(1)}°C SST</span></span>
            {(data.cond.rain_48h??0)>0 && <><span className="ls-sep">·</span><span className="ls-item">🌧 <span style={{color:"#6ab4c8"}}>{data.cond.rain_48h.toFixed(0)}mm</span></span></>}
            {currentData?.valid && <><span className="ls-sep">·</span><span className="ls-item">🌀 <span style={{color:"#4a8a9a"}}>{currentData.speed.toFixed(1)}kt {currentData.dirLabel}</span></span></>}
            {data.satData && <><span className="ls-sep">·</span>
              <span className="ls-item">🛰️ <span style={{color:data.satData.turbidity>60?"#e03030":data.satData.turbidity>30?"#f07040":data.satData.turbidity>10?"#f0c040":"#00e5a0"}}>
                {data.satData.turbidity>60?"Turbid":data.satData.turbidity>30?"Mod":data.satData.turbidity>10?"Clear":"V.Clear"}</span>
                <span style={{color:"#2a5a6a",fontSize:"0.55rem",marginLeft:2}}>{data.satData.agedays}d</span>
                <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",verticalAlign:"middle",background:"rgb("+data.satData.r+","+data.satData.g+","+data.satData.b+")",border:"1px solid #334",marginLeft:3}}/>
              </span>
            </>}
            {data.webcamData && <><span className="ls-sep">·</span><span className="ls-item">📷 <span style={{color:data.webcamData.turbidity>60?"#e03030":data.webcamData.turbidity>10?"#f0c040":"#00e5a0"}}>{data.webcamData.turbidity>60?"Turbid":data.webcamData.turbidity>10?"Hazy":"Clear"}</span></span></>}
            {(data.cond.riverFNU??0)>0 && <><span className="ls-sep">·</span><span className="ls-item">💧 <span style={{color:data.cond.riverFNU>100?"#e03030":data.cond.riverFNU>30?"#f07040":"#6ab4c8"}}>{data.cond.riverFNU.toFixed(0)} FNU</span></span></>}
          </div>

          {/* Factor breakdown — hidden from UI, scoring runs in background
          <div className="factors-grid">
            <FactorBar label="Swell" value={data.factors.swell} isDelta={false} />
            <FactorBar label="Wind" value={data.factors.wind} isDelta={false} />
            <FactorBar label="Rain" value={data.factors.rain} isDelta={false} />
            <FactorBar label="NW" value={data.factors.nw} isDelta={true} />
            <FactorBar label="Current" value={data.factors.current} isDelta={true} />
            <FactorBar label="SST" value={data.factors.sst} isDelta={true} />
            <FactorBar label="Tide" value={data.factors.tide} isDelta={true} />
            <FactorBar label="Recovery" value={data.factors.recovery ?? 0} isDelta={true} />
            {data.factors.satellite != null && data.factors.satellite !== 0 && (
              <FactorBar label="Satellite" value={data.factors.satellite} isDelta={true} />
            )}
            {data.factors.webcam != null && data.factors.webcam !== 0 && (
              <FactorBar label="Webcam" value={data.factors.webcam} isDelta={true} />
            )}
            {data.factors.riverGauge != null && data.factors.riverGauge !== 0 && (
              <FactorBar label="River gauge" value={data.factors.riverGauge} isDelta={true} />
            )}
          </div>
          */}

          {/* spot note hidden */}

          {/* river FNU shown in live strip */ false && (() => {
            const fnu = data.cond.riverFNU;
            const trend = data.cond.riverTrendFactor > 1.1 ? " ↑ rising" : "";
            const level = fnu < 5 ? { label: "clear", color: "#00e5a0" }
                        : fnu < 30 ? { label: "slightly elevated", color: "#f0c040" }
                        : fnu < 100 ? { label: "murky", color: "#f07040" }
                        : { label: "very high — flood turbidity", color: "#e05030" };
            return (
              <div style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem", marginTop: "0.3rem",
                            background: "rgba(0,0,0,0.2)", borderRadius: "6px", color: level.color }}>
                💧 River gauge: <strong>{fnu.toFixed(1)} FNU</strong> — {level.label}{trend}
                <span style={{ color: "#3a6070", marginLeft: "0.4rem" }}>
                  (TRC · {TRC_RIVER_SITES[spot.trc_sites[0]] ?? "gauge"})
                </span>
              </div>
            );
          })()}

          {spot.river && data.cond.rain_48h > 10 && !data.cond.riverFNU && (
            <div className="warning">⚠️ Recent rain — expect river runoff and reduced viz at this spot</div>
          )}

          <CommunityLogPanel logs={communityLogs || []} logStatus={logStatus} spotName={spot.name} />

          {data.forecast && <ScoreChart days={data.forecast} />}
          {data.forecast && <ConditionsChart days={data.forecast} currentData={currentData} />}

          {expanded && data.forecast && (
            <div className="expanded-table">
              <table>
                <thead>
                  <tr>
                    <th>Day</th><th>Score</th><th>Swell</th><th>Wind</th><th>SST</th><th>Rain</th><th>Settling</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecast.map((d, i) => {
                    const date = parseDateLocal(d.date);
                    const dn = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][date.getDay()];
                    const shortDate = date.toLocaleDateString("en-NZ", { day:"numeric", month:"short" });
                    return (
                      <tr key={d.date}>
                        <td>
                          <span style={{ color: "#8ab" }}>{i === 0 ? "Today" : dn}</span>{" "}
                          <span style={{ color: "#345", fontSize: "0.68rem" }}>{shortDate}</span>
                        </td>
                        <td style={{ color: scoreToColor(d.score), fontFamily: "'Space Mono',monospace", fontWeight: "700" }}>{d.score}</td>
                        <td>{d.cond.swell_h.toFixed(1)}m {d.cond.swell_p.toFixed(0)}s {dirName(d.cond.swell_dir)}</td>
                        <td>{d.cond.wind_spd.toFixed(0)}kph ({(d.cond.wind_spd / 1.852).toFixed(0)}kt) {dirName(d.cond.wind_dir)}</td>
                        <td>{d.cond.sst.toFixed(1)}°C</td>
                        <td>{(d.cond.rain_24h ?? d.cond.rain_48h).toFixed(1)}mm</td>
                        <td style={{ color: d.cond.days_since_rain >= 4 ? "#00e5a0" : d.cond.days_since_rain >= 2 ? "#f0c040" : "#e06040" }}>
                          {d.cond.days_since_rain}d dry
                          {d.cond.swell_hist_72h > 1.5 && <span style={{ color: "#8ab", fontSize: "0.65rem" }}> · {d.cond.swell_hist_72h.toFixed(1)}m swell</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
