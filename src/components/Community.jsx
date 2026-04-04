import { useState } from "react";
import { scoreToColor, scoreToLabel, spotBiasMultiplier } from "../lib/scoring.js";

export function getShareText(spotDataMap, regionLabel) {
  const entries = Object.entries(spotDataMap).filter(([,d]) => d?.score != null);
  if (!entries.length) return `Check out the ${regionLabel} Viz Forecast — spearfishing visibility predictions! 🐟🤿`;
  const best = entries.sort((a, b) => b[1].score - a[1].score)[0];
  const bestName = best[0].split("—")[0].trim();
  return `${regionLabel} Viz Forecast 🐟\nBest spot right now: ${bestName} — ${best[1].score}/100 (${scoreToLabel(best[1].score)})\nCheck conditions & log your dives:`;
}


// ══════════════════════════════════════════════════════════════════════════════
// SEASONAL CHART — pipeline-calibrated, region-aware
// ══════════════════════════════════════════════════════════════════════════════

export function ShareButtons({ spotDataMap, compact, regionLabel }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const text = getShareText(spotDataMap, regionLabel);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text + "\n" + shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch {}
  };
  const handleWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(text + "\n" + shareUrl)}`, "_blank"); };
  const handleSms = () => { window.open(`sms:?body=${encodeURIComponent(text + "\n" + shareUrl)}`, "_blank"); };
  const handleNativeShare = async () => { if (navigator.share) { try { await navigator.share({ title: `${regionLabel} Viz Forecast`, text, url: shareUrl }); } catch {} } };
  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  if (compact) {
    return (
      <div className="share-compact">
        <button className="share-btn share-whatsapp" onClick={handleWhatsApp} title="Share via WhatsApp">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </button>
        <button className="share-btn share-sms" onClick={handleSms} title="Share via text">💬</button>
        <button className="share-btn share-copy" onClick={handleCopy} title="Copy link">{copied ? "✓" : "🔗"}</button>
        {hasNativeShare && (
          <button className="share-btn share-native" onClick={handleNativeShare} title="Share">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="share-panel">
      <div className="share-title">📤 SHARE WITH YOUR CREW</div>
      <div className="share-subtitle">More divers logging = better predictions for everyone</div>
      <div className="share-buttons">
        <button className="share-btn-full share-whatsapp" onClick={handleWhatsApp}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </button>
        <button className="share-btn-full share-sms" onClick={handleSms}>💬 Text</button>
        <button className="share-btn-full share-copy" onClick={handleCopy}>{copied ? "✓ Copied!" : "🔗 Copy Link"}</button>
        {hasNativeShare && (
          <button className="share-btn-full share-native" onClick={handleNativeShare}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            Share
          </button>
        )}
      </div>
    </div>
  );
}

// ── Welcome banner ─────────────────────────────────────────────────────────────

export function WelcomeBanner({ onDismiss, onSetName, onSetEmail, diverName, regionLabel }) {
  const [name, setName] = useState(diverName || "");
  const [email, setEmail] = useState("");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const handleJoin = () => {
    if (name.trim()) onSetName(name.trim());
    if (email.trim()) onSetEmail(email.trim());
    setDismissed(true);
    onDismiss();
  };
  return (
    <div className="welcome-banner">
      <div className="welcome-glow" />
      <div className="welcome-content">
        <div className="welcome-icon">🤿</div>
        <h2 className="welcome-title">Welcome to the {regionLabel} Viz Forecast</h2>
        <p className="welcome-desc">
          Real-time spearfishing visibility predictions for 6 spots around the Taranaki coast.
          Scores combine swell, wind, rain history, ocean currents, SST, and satellite turbidity data.
        </p>
        <div className="welcome-features">
          <div className="wf-item"><span className="wf-icon">📊</span><span>Live conditions & 7-day forecasts per spot</span></div>
          <div className="wf-item"><span className="wf-icon">🎯</span><span>Best dive day recommendation</span></div>
          <div className="wf-item"><span className="wf-icon">🛰️</span><span>Satellite turbidity integrated into scores</span></div>
          <div className="wf-item"><span className="wf-icon">🤝</span><span>Community-calibrated model — more logs = better accuracy</span></div>
        </div>
        <div className="welcome-join">
          <input type="text" className="welcome-name-input" placeholder="Your name (for dive logs)"
            value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJoin()} />
          <input type="email" className="welcome-name-input" placeholder="Email — get notified when new spots are added (optional)"
            value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleJoin()}
            style={{ marginTop: "0.5rem" }} />
          <button className="welcome-go-btn" onClick={handleJoin}>{name.trim() ? "Let's Go 🐟" : "Skip for Now"}</button>
        </div>
        <div className="welcome-hint">Email is optional and never shared — only used for app updates</div>
      </div>
    </div>
  );
}

// ── Community log panel ───────────────────────────────────────────────────────

export function CommunityLogPanel({ logs, logStatus, spotName }) {
  const title = spotName ? "COMMUNITY OBSERVATIONS" : "RECENT COMMUNITY OBSERVATIONS";
  if (logStatus === "unconfigured") return (
    <div className="community-panel unconfigured"><div className="cp-title">🌐 {title}</div><div className="cp-unconfigured">⚙️ Configure Supabase to enable shared logging.</div></div>
  );
  if (logStatus === "loading") return (<div className="community-panel"><div className="cp-title">🌐 {title}</div><div className="loading-bar"><div className="loading-fill"/></div></div>);
  if (logStatus === "error") return (<div className="community-panel"><div className="cp-title">🌐 {title}</div><div style={{color:"#e06040",fontSize:"0.75rem"}}>Could not connect to database.</div></div>);
  const allSpotLogs = spotName ? logs.filter(e => e.spot === spotName) : logs;
  const latest = allSpotLogs[0] ?? null;
  const bias = spotName ? spotBiasMultiplier(spotName, logs) : null;
  return (
    <div className="community-panel">
      <div className="cp-header">
        <div className="cp-title">🌐 {title}</div>
        {bias != null && (
          <div className="cp-bias" style={{color: bias > 1.05 ? "#00e5a0" : bias < 0.95 ? "#f07040" : "#607d8b"}}>
            {bias > 1.05 ? `↑ Under-predicts ~${Math.round((bias-1)*100)}%` : bias < 0.95 ? `↓ Over-predicts ~${Math.round((1-bias)*100)}%` : "≈ Accuracy good"}
          </div>
        )}
      </div>
      {!latest && logStatus === "ok" && <div style={{color:"#3a6070",fontSize:"0.75rem",padding:"0.4rem 0"}}>No observations yet — be the first!</div>}
      {latest && (
        <div className="cp-row">
          <span className="cp-diver">🤿 {latest.diver_name}</span>
          <span className="cp-date">{latest.date}</span>
          <span className="cp-vis" style={{color: scoreToColor(Math.round((latest.observed_vis ?? latest.observedVis ?? 0) * 10))}}>{latest.observed_vis ?? latest.observedVis}m</span>
          <span className="cp-tide">{latest.tide} tide</span>
          <span className="cp-model">model: {latest.model_score ?? latest.modelScore}</span>
          {latest.notes && <span className="cp-note" title={latest.notes}>📝</span>}
        </div>
      )}
      {allSpotLogs.length > 1 && (
        <div style={{color:"#2a5a6a",fontSize:"0.62rem",marginTop:"0.3rem",fontFamily:"'Space Mono',monospace"}}>
          +{allSpotLogs.length - 1} more observation{allSpotLogs.length > 2 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

// ── Community stats ───────────────────────────────────────────────────────────

export function CommunityStats({ logs, logStatus }) {
  if (logStatus !== "ok" || logs.length === 0) return null;
  const totalDivers = new Set(logs.map(l => l.diver_name)).size;
  const avgVis = (logs.reduce((a, l) => a + (l.observed_vis ?? l.observedVis ?? 0), 0) / logs.length).toFixed(1);
  const recentLogs = logs.slice(0, 5);
  return (
    <div className="community-stats">
      <div className="cs-item"><span className="cs-val">{logs.length}</span><span className="cs-key">Total Dives Logged</span></div>
      <div className="cs-item"><span className="cs-val">{totalDivers}</span><span className="cs-key">Community Divers</span></div>
      <div className="cs-item"><span className="cs-val">{avgVis}m</span><span className="cs-key">Avg Observed Vis</span></div>
      <div className="cs-item"><span className="cs-val" style={{fontSize:"0.8rem",color:"#6ab4c8"}}>{recentLogs[0] ? `${recentLogs[0].diver_name} · ${recentLogs[0].date}` : "—"}</span><span className="cs-key">Most Recent</span></div>
    </div>
  );
}

// ── Growth nudge ──────────────────────────────────────────────────────────────

export function GrowthNudge({ logs, spotDataMap, regionLabel, spots }) {
  const totalDivers = new Set(logs.map(l => l.diver_name)).size;
  const totalLogs = logs.length;
  const spotsWithData = spots.filter(s => logs.filter(l => l.spot === s.name).length >= 2).length;
  return (
    <div className="growth-nudge">
      <div className="gn-header"><span className="gn-title">📈 Community Data Health</span></div>
      <div className="gn-stats">
        <div className="gn-stat"><div className="gn-stat-val">{totalDivers}</div><div className="gn-stat-label">Divers</div></div>
        <div className="gn-stat"><div className="gn-stat-val">{totalLogs}</div><div className="gn-stat-label">Observations</div></div>
        <div className="gn-stat"><div className="gn-stat-val">{spotsWithData}/{spots.length}</div><div className="gn-stat-label">Spots Calibrated</div></div>
      </div>
      <div className="gn-meter">
        <div className="gn-meter-label">Model calibration: {totalLogs < 10 ? "Early days" : totalLogs < 30 ? "Getting better" : totalLogs < 100 ? "Good data" : "Strong calibration"}</div>
        <div className="gn-meter-bar"><div className="gn-meter-fill" style={{ width: `${Math.min(100, (totalLogs / 100) * 100)}%` }} /></div>
        <div className="gn-meter-hint">{totalLogs < 30 ? `${30 - totalLogs} more observations for solid calibration` : totalLogs < 100 ? `${100 - totalLogs} more for high-confidence predictions` : "Great coverage — well-calibrated"}</div>
      </div>
      <ShareButtons spotDataMap={spotDataMap} regionLabel={regionLabel} compact={false} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════

