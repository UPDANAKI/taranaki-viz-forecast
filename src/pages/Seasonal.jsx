import { REGIONS } from "../spots/index.js";

export function SeasonalPage({ region }) {
  const REGION = REGIONS[region];
  const currentMonth = new Date().getMonth(); // 0-indexed
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Regional overview data (clear% by month)
  const overview = REGION.seasonalChart;
  const spotSeasonal = REGION.spotSeasonal;
  const spots = Object.keys(spotSeasonal);

  // Colour helpers
  function clearColor(pct) {
    if (pct >= 75) return "#00e5a0";
    if (pct >= 60) return "#7dd64f";
    if (pct >= 50) return "#f0a030";
    return "#f07040";
  }
  function deltaColor(d) {
    if (d >= 10) return "#00e5a0";
    if (d >= 4)  return "#7dd64f";
    if (d >= -3) return "#8899aa";
    if (d >= -10) return "#f0a030";
    return "#f07040";
  }
  function deltaLabel(d) {
    if (d >= 10) return "Best";
    if (d >= 4)  return "Good";
    if (d >= -3) return "Avg";
    if (d >= -10) return "Poor";
    return "Worst";
  }

  return (
    <div style={{ padding: "0 0 3rem" }}>

      {/* ── Regional overview ─────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14, padding: "1.4rem 1.6rem 1.2rem", marginBottom: "2rem",
      }}>
        <div style={{ fontSize: "1rem", fontWeight: 700, color: "#c8e0ea", marginBottom: 4 }}>
          📅 {REGION.label} — Regional Overview
        </div>
        <div style={{ fontSize: "0.72rem", color: "#4a7a8a", marginBottom: "1.2rem" }}>
          {REGION.seasonalNote}
        </div>

        {/* Overview bars */}
        <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80 }}>
          {overview.map((d, i) => {
            const isCurrent = i === currentMonth;
            const cc = clearColor(d.clear);
            return (
              <div key={d.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ fontSize: "0.6rem", color: cc, fontWeight: isCurrent ? 700 : 400 }}>{d.clear}%</div>
                <div style={{
                  width: "100%", height: `${d.clear * 0.55}px`,
                  background: `linear-gradient(to top, ${cc}cc, ${cc}33)`,
                  borderTop: `2px solid ${cc}`,
                  borderRadius: "3px 3px 0 0",
                  outline: isCurrent ? `2px solid ${cc}` : "none",
                  outlineOffset: 1,
                }} />
                <div style={{ fontSize: "0.58rem", color: isCurrent ? "#c8e0ea" : "#4a7a8a", fontWeight: isCurrent ? 700 : 400 }}>
                  {d.month}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.8rem" }}>
          {[["#00e5a0","75%+ clear"],["#7dd64f","60–75%"],["#f0a030","50–60%"],["#f07040","<50%"]].map(([c,l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.68rem", color: "#6a8a9a" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>

      {/* ── Per-spot seasonal patterns ────────────────────────────── */}
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#c8e0ea", marginBottom: "0.6rem", letterSpacing: "0.04em" }}>
        Per-Spot Monthly Patterns
      </div>
      <div style={{ fontSize: "0.72rem", color: "#4a7a8a", marginBottom: "1.4rem" }}>
        Delta vs annual average — how much better or worse each spot is in each month.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
        {spots.map(spotName => {
          const deltas = spotSeasonal[spotName]; // { 1:val, 2:val, ... }
          const vals = Object.values(deltas);
          const maxAbs = Math.max(...vals.map(Math.abs), 1);
          // Find best and worst months
          const maxVal = Math.max(...vals);
          const minVal = Math.min(...vals);

          return (
            <div key={spotName} style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: "1rem 1.2rem 0.9rem",
            }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#c8e0ea", marginBottom: "0.8rem" }}>
                {spotName}
              </div>

              {/* Delta bars — centred on zero */}
              <div style={{ display: "flex", gap: 3, alignItems: "center", height: 64 }}>
                {MONTHS.map((month, i) => {
                  const d = deltas[i + 1] ?? 0;
                  const isCurrent = i === currentMonth;
                  const barH = Math.round((Math.abs(d) / maxAbs) * 28);
                  const isPos = d >= 0;
                  const dc = deltaColor(d);
                  return (
                    <div key={month} title={`${month}: ${d > 0 ? "+" : ""}${d} (${deltaLabel(d)})`}
                      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: 64, justifyContent: "center", position: "relative" }}>
                      {/* Positive bar (above centre) */}
                      <div style={{ height: 28, display: "flex", alignItems: "flex-end", width: "100%" }}>
                        {isPos && (
                          <div style={{
                            width: "100%", height: barH,
                            background: dc,
                            borderRadius: "2px 2px 0 0",
                            opacity: isCurrent ? 1 : 0.75,
                            outline: isCurrent ? `1px solid ${dc}` : "none",
                            outlineOffset: 1,
                          }} />
                        )}
                      </div>
                      {/* Centre line */}
                      <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.1)" }} />
                      {/* Negative bar (below centre) */}
                      <div style={{ height: 28, display: "flex", alignItems: "flex-start", width: "100%" }}>
                        {!isPos && (
                          <div style={{
                            width: "100%", height: barH,
                            background: dc,
                            borderRadius: "0 0 2px 2px",
                            opacity: isCurrent ? 1 : 0.75,
                            outline: isCurrent ? `1px solid ${dc}` : "none",
                            outlineOffset: 1,
                          }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Month labels */}
              <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                {MONTHS.map((month, i) => (
                  <div key={month} style={{
                    flex: 1, textAlign: "center",
                    fontSize: "0.55rem",
                    color: i === currentMonth ? "#c8e0ea" : "#3a5a6a",
                    fontWeight: i === currentMonth ? 700 : 400,
                  }}>{month}</div>
                ))}
              </div>

              {/* Best / worst callout */}
              <div style={{ display: "flex", gap: "1.2rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
                {[
                  { label: "Best", val: maxVal, months: MONTHS.filter((_,i) => deltas[i+1] === maxVal) },
                  { label: "Worst", val: minVal, months: MONTHS.filter((_,i) => deltas[i+1] === minVal) },
                ].map(({ label, val, months }) => (
                  <span key={label} style={{ fontSize: "0.68rem", color: "#4a7a8a" }}>
                    <span style={{ color: deltaColor(val), fontWeight: 600 }}>{label}:</span>{" "}
                    {months.join(", ")} ({val > 0 ? "+" : ""}{val})
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Delta legend ─────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "1.4rem" }}>
        {[["#00e5a0","+10 or more — significantly above avg"],["#7dd64f","+4 to +9 — above avg"],
          ["#8899aa","-3 to +3 — average"],["#f0a030","-4 to -9 — below avg"],["#f07040","-10 or worse — significantly below avg"]]
          .map(([c,l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.66rem", color: "#6a8a9a" }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
      </div>
    </div>
  );
}

