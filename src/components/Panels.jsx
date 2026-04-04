import { useMemo } from "react";
import { parseDateLocal, scoreToColor, scoreToLabel } from "../lib/scoring.js";
import { getAdvice } from "../lib/forecast.js";

export function BestDayPanel({ spotDataMap }) {
  const bestDays = useMemo(() => {
    const days = {};
    for (const [spotName, data] of Object.entries(spotDataMap)) {
      if (!data?.forecast?.length) continue;
      const best = data.forecast.reduce((a, b) => b.score > a.score ? b : a, data.forecast[0]);
      days[spotName] = best;
    }
    return days;
  }, [spotDataMap]);

  const allBests = Object.entries(bestDays);
  if (allBests.length === 0) return null;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dateScores = {};
  allBests.forEach(([spotName, best]) => {
    if (!dateScores[best.date]) dateScores[best.date] = { total: 0, count: 0, spots: [] };
    dateScores[best.date].total += best.score;
    dateScores[best.date].count += 1;
    dateScores[best.date].spots.push({ spotName, score: best.score });
  });

  const [date, info] = Object.entries(dateScores).sort((a, b) =>
    (b[1].total / b[1].count) - (a[1].total / a[1].count)
  )[0];

  const d = parseDateLocal(date);
  const today = new Date().toLocaleDateString("en-CA");
  const dayLabel = date === today ? "Today" : dayNames[d.getDay()];
  const dateStr = d.toLocaleDateString("en-NZ", { day: "numeric", month: "long" });
  const avgScore = Math.round(info.total / info.count);
  const color = scoreToColor(avgScore);

  return (
    <div className="best-day-panel" style={{ "--best-color": color }}>
      <div className="best-day-icon">🎯</div>
      <div className="best-day-content">
        <div className="best-day-title">Best Dive Day This Week</div>
        <div className="best-day-date" style={{ color }}>{dayLabel} · {dateStr}</div>
        <div className="best-day-avg">
          Avg score: <strong style={{ color }}>{avgScore}</strong> · {scoreToLabel(avgScore)}
        </div>
        <div className="best-day-spots">
          {info.spots.sort((a, b) => b.score - a.score).map(s => (
            <span key={s.spotName} className="best-spot-chip"
              style={{ borderColor: scoreToColor(s.score) + "55", color: scoreToColor(s.score) }}>
              {s.spotName} <strong>{scoreToLabel(s.score)}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdvicePanel({ spotDataMap, spots, region }) {
  const advice = useMemo(() => {
    const entries = Object.entries(spotDataMap);
    if (entries.length === 0) return [];

    const firstData = entries[0]?.[1];
    if (!firstData?.cond) return [];

    const scored = spots.map(spot => {
      const d = spotDataMap[spot.name];
      return { spot, score: d?.score ?? 0 };
    }).sort((a, b) => b.score - a.score);

    return getAdvice(firstData.cond, scored, region);
  }, [spotDataMap, region]);

  if (!advice || advice.length === 0) return null;
  return (
    <div className="advice-panel">
      {advice.map((tip, i) => (
        <div key={i} className="advice-tip">
          <span className="advice-emoji">{tip.e}</span>
          <span>{tip.t}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      {[
        { label: "Excellent", sub: "10m+", color: "#00e5a0" },
        { label: "Good", sub: "5–10m", color: "#7dd64f" },
        { label: "Marginal", sub: "", color: "#f0a030" },
        { label: "Poor", sub: "1–3m", color: "#f07040" },
        { label: "Not Diveable", sub: "< 1m", color: "#e03030" },
      ].map(i => (
        <div key={i.label} className="legend-item">
          <span className="legend-dot" style={{ background: i.color }} />
          <span className="legend-label">{i.label}</span>
          <span className="legend-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
}
