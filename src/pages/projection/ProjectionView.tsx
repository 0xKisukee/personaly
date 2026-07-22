import { motion } from "motion/react";
import type { Milestone, ProjectionParams } from "../../lib/types";
import type { ProjectionEvent, YearPoint } from "../../lib/projection";
import { money, signedMoney, percent } from "../../lib/format";
import { Segment } from "../../ui";
import NetWorthChart from "./NetWorthChart";
import CompareChart from "./CompareChart";
import { SERIES_COLORS } from "./chartUtils";

type ChartMode = "net" | "composition" | "plans";
type PlanSeries = { name: string; points: YearPoint[] }[] | null;

/**
 * Vue Projection : hero, indépendance financière, graphe (net / composition / plans)
 * et table annuelle cliquable. Les hypothèses/réglages vivent dans la vue Réglages.
 */
export default function ProjectionView({
  p, points, events, fiYearIndex,
  chartMode, setChartMode, planSeries, plansCount,
  milestones, onEditEvent, onSelectYear,
}: {
  p: ProjectionParams;
  points: YearPoint[];
  events: ProjectionEvent[];
  fiYearIndex: number | null;
  chartMode: ChartMode;
  setChartMode: (m: ChartMode) => void;
  planSeries: PlanSeries;
  plansCount: number;
  milestones: Milestone[];
  onEditEvent: (id: string) => void;
  onSelectYear: (year: number) => void;
}) {
  const now = points[0];
  const end = points[points.length - 1];
  const delta = end.netWorth - now.netWorth;
  const mult = now.netWorth > 0 ? end.netWorth / now.netWorth : null;
  const cagr = now.netWorth > 0 && end.netWorth > 0 ? (Math.pow(end.netWorth / now.netWorth, 1 / p.horizon) - 1) * 100 : null;
  const fiPoint = fiYearIndex !== null ? points[fiYearIndex] : null;

  const chartModes: { value: ChartMode; label: string }[] = [
    { value: "net", label: "Patrimoine net" },
    { value: "composition", label: "Composition" },
    ...(plansCount > 1 ? [{ value: "plans", label: "Plans" } as { value: ChartMode; label: string }] : []),
  ];

  return (
    <>
      {/* --------- hero --------- */}
      <motion.div className="wealth-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
        <div className="wealth-cell lead">
          <div className="eyebrow">Patrimoine net en {end.year}{p.realTerms ? " · € constants" : ""}</div>
          <div className={"v " + (end.netWorth < 0 ? "neg" : "")}>{money(end.netWorth)}</div>
          <div className="sub">Dans {p.horizon} ans{end.age !== null ? ` · ${end.age} ans` : ""}</div>
        </div>
        <div className="wealth-cell">
          <div className="eyebrow">Aujourd'hui</div>
          <div className="v">{money(now.netWorth)}</div>
          <div className="sub">{now.year}{now.age !== null ? ` · ${now.age} ans` : ""}</div>
        </div>
        <div className="wealth-cell">
          <div className="eyebrow">Évolution</div>
          <div className={"v " + (delta >= 0 ? "pos" : "neg")}>{signedMoney(delta)}</div>
          <div className="sub">
            {mult !== null ? `× ${mult.toFixed(1)}` : "—"}
            {cagr !== null ? ` · ${percent(cagr)}/an` : ""}
          </div>
        </div>
      </motion.div>

      {/* --------- indépendance financière (seuil défini par l'utilisateur) --------- */}
      {fiPoint && p.fiTarget != null && (
        <div className="fi-banner">
          <span className="fi-dot" />
          <b>Indépendance financière</b> atteinte en <b>{fiPoint.year}</b>
          {fiPoint.age !== null ? ` (${fiPoint.age} ans)` : ""} — ton patrimoine net dépasse alors {money(p.fiTarget)}.
        </div>
      )}
      {!fiPoint && p.fiTarget != null && p.fiTarget > 0 && (
        <div className="fi-banner warn">
          <span className="fi-dot" />
          <b>Indépendance financière</b> ({money(p.fiTarget)}) non atteinte sur l'horizon —
          il manque <b>{money(Math.max(0, p.fiTarget - end.netWorth))}</b> en {end.year}.
        </div>
      )}

      <motion.div className="card" style={{ padding: "18px 20px 12px" }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
        <div className="chart-head">
          <Segment aria-label="Mode du graphe" value={chartMode} onChange={setChartMode} options={chartModes} />

          {chartMode === "composition" && (
            <div className="chart-legend">
              <span><i style={{ background: "var(--sage)" }} /> Actifs</span>
              <span><i style={{ background: "var(--brass)" }} /> Épargne</span>
              <span><i style={{ background: "var(--drain)" }} /> Dettes</span>
            </div>
          )}
          {chartMode === "plans" && planSeries && (
            <div className="chart-legend">
              {planSeries.map((s, i) => (
                <span key={s.name}><i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} /> {s.name}</span>
              ))}
            </div>
          )}
          {chartMode !== "plans" && (
            <div className="chart-legend mark-legend">
              {events.some((e) => e.kind === "planned") && (
                <span><b className="txt-brass-bright">⚑</b> événement — clique pour éditer</span>
              )}
              {events.some((e) => e.kind === "loan") && (
                <span><b className="txt-sage">✓</b> fin d'emprunt</span>
              )}
              {events.some((e) => e.kind === "fi") && (
                <span><b className="txt-gain">◆</b> indépendance financière</span>
              )}
              {milestones.length > 0 && (
                <span><b className="txt-sage">◇</b> jalon</span>
              )}
            </div>
          )}
        </div>
        {chartMode === "plans" && planSeries ? (
          <CompareChart series={planSeries} />
        ) : (
          <NetWorthChart
            points={points}
            events={events}
            milestones={milestones}
            mode={chartMode === "plans" ? "net" : chartMode}
            onEventClick={onEditEvent}
          />
        )}
      </motion.div>

      {/* --------- table --------- */}
      <section className="section" style={{ marginTop: 32 }}>
        <div className="section-head">
          <h2>Détail annuel</h2>
          <span className="spacer" />
          <span className="hint"><span className="dot brass" /> clique une année pour voir sa composition</span>
        </div>
        <div className="proj-table-wrap">
          <table className="proj-table">
            <thead>
              <tr>
                <th>Année</th>
                <th className="r">Actifs</th>
                <th className="r">Dettes</th>
                <th className="r">Épargne cumulée</th>
                <th className="r">Patrimoine net</th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt) => (
                <tr key={pt.yearIndex} data-now={pt.yearIndex === 0} data-fi={pt.yearIndex === fiYearIndex}
                  className="proj-row" onClick={() => onSelectYear(pt.year)}>
                  <td>{pt.year}{pt.age !== null && <span className="proj-age"> · {pt.age} ans</span>}</td>
                  <td className="r mono">{money(pt.grossAssets)}</td>
                  <td className={"r mono " + (pt.debt > 0 ? "txt-drain" : "txt-faint")}>
                    {pt.debt > 0 ? "−" + money(pt.debt) : "—"}
                  </td>
                  <td className={"r mono " + (pt.savings < 0 ? "txt-drain" : "txt-soft")}>{signedMoney(pt.savings)}</td>
                  <td className="r mono proj-net">{money(pt.netWorth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="help" style={{ marginTop: 18 }}>
        Hypothèses : taux d'évolution et revenus supposés constants{p.realTerms ? ", montants en euros constants" : ", montants en euros courants"}.
        {(p.withdrawalTargets ?? []).length > 0 && <> Les déficits puisent dans les actifs de la cascade de retrait avant de peser sur l'épargne.</>}
        {" "}Estimation, hors fiscalité.
      </p>
    </>
  );
}
