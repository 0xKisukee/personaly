import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { Milestone } from "../../lib/types";
import type { ProjectionEvent, YearPoint } from "../../lib/projection";
import { money } from "../../lib/format";
import { compactEur, timeFractions, nearestIndex } from "./chartUtils";

const MARK_COLORS: Record<ProjectionEvent["kind"], string> = {
  planned: "var(--brass-bright)",
  loan: "var(--sage)",
  fi: "var(--gain)",
};
const MARK_GLYPHS: Record<ProjectionEvent["kind"], string> = { planned: "⚑", loan: "✓", fi: "◆" };

/**
 * Graphe patrimoine net (aire) ou composition (actifs/épargne/dettes empilés).
 * Survol, jalons (◇ nommés), marqueurs d'événements cliquables (⚑/✓/◆).
 */
export default function NetWorthChart({ points, events, milestones, mode, onEventClick }: {
  points: YearPoint[];
  events: ProjectionEvent[];
  milestones: Milestone[];
  mode: "net" | "composition";
  onEventClick?: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000, H = 340;
  const M = { top: 24, right: 24, bottom: 40, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const n = points.length;

  // bornes des composantes empilées
  const posTop = (pt: YearPoint) => pt.grossAssets + Math.max(pt.savings, 0);
  const negBot = (pt: YearPoint) => -(pt.debt + Math.max(-pt.savings, 0));

  const maxV = mode === "composition"
    ? Math.max(...points.map(posTop), 0)
    : Math.max(...points.map((pt) => pt.netWorth), 0);
  const minV = mode === "composition"
    ? Math.min(...points.map(negBot), 0)
    : Math.min(...points.map((pt) => pt.netWorth), 0);
  const domainMax = (maxV || 1) * 1.08;
  const domainMin = minV < 0 ? minV * 1.08 : 0;

  const fracs = timeFractions(n);
  const x = (i: number) => M.left + fracs[i] * innerW;
  const y = (v: number) => M.top + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;

  const line = points.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(pt.netWorth).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${y(domainMin).toFixed(1)} L ${x(0).toFixed(1)} ${y(domainMin).toFixed(1)} Z`;

  // bande empilée entre deux séries de valeurs
  const band = (upper: (pt: YearPoint) => number, lower: (pt: YearPoint) => number) => {
    const up = points.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(upper(pt)).toFixed(1)}`).join(" ");
    const down = [...points].reverse().map((pt) => `L ${x(pt.yearIndex).toFixed(1)} ${y(lower(pt)).toFixed(1)}`).join(" ");
    return `${up} ${down} Z`;
  };
  const assetsBand = band((pt) => pt.grossAssets, () => 0);
  const savingsBand = band(posTop, (pt) => pt.grossAssets);
  const debtBand = band(() => 0, negBot);

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / yTicks);
  const xStep = Math.max(1, Math.ceil((n - 1) / 8));
  const xTickIdx = points.map((_, i) => i).filter((i) => i % xStep === 0 || i === n - 1);

  // jalons visibles sur l'horizon, GROUPÉS par année (plusieurs jalons la même
  // année partagent la ligne : leurs libellés sont empilés au lieu de se superposer)
  const msByIdx = new Map<number, Milestone[]>();
  for (const m of milestones) {
    const idx = m.year - points[0].year;
    if (idx < 0 || idx >= n) continue;
    (msByIdx.get(idx) ?? msByIdx.set(idx, []).get(idx)!).push(m);
  }

  // marqueurs d'événements, empilés quand plusieurs tombent la même année
  const marksByYear = new Map<number, ProjectionEvent[]>();
  for (const e of events) {
    const list = marksByYear.get(e.yearIndex) ?? [];
    list.push(e);
    marksByYear.set(e.yearIndex, list);
  }

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotLeft = (rect.width * M.left) / W;
    const plotW = (rect.width * innerW) / W;
    const f = Math.max(0, Math.min(1, (px - plotLeft) / plotW));
    setHover(nearestIndex(fracs, f));
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        <defs>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTickVals.map((v, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 12} y={y(v) + 4} textAnchor="end" className="chart-axis">{compactEur(v)}</text>
          </g>
        ))}

        {domainMin < 0 && (
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
        )}

        {/* jalons : repères verticaux nommés — le ◇ est CENTRÉ sur la ligne, les
            noms à côté (à gauche si près du bord droit), EMPILÉS si même année */}
        {[...msByIdx.entries()].map(([idx, list]) => {
          const mx = x(idx);
          const flip = mx > W - M.right - 90; // le libellé sortirait du graphe
          return (
            <g key={idx}>
              <line x1={mx} x2={mx} y1={M.top} y2={M.top + innerH}
                stroke="var(--sage)" strokeWidth="1" strokeDasharray="2 6" strokeOpacity="0.75" />
              <text x={mx} y={M.top + 4} textAnchor="middle" className="chart-axis" style={{ fill: "var(--sage)" }}>◇</text>
              {list.map((m, j) => (
                <text key={m.id} x={flip ? mx - 9 : mx + 9} y={M.top + 4 + j * 14} textAnchor={flip ? "end" : "start"}
                  className="chart-axis" style={{ fill: "var(--sage)" }}>
                  {m.label || "Jalon"}
                </text>
              ))}
            </g>
          );
        })}

        {events.map((e, i) => (
          <line key={i} x1={x(e.yearIndex)} x2={x(e.yearIndex)} y1={M.top} y2={M.top + innerH}
            stroke={e.kind === "fi" ? "var(--gain)" : "var(--line-brass)"} strokeWidth="1" strokeDasharray="3 5" />
        ))}

        {mode === "composition" ? (
          <>
            <motion.path d={assetsBand} fill="var(--sage)" fillOpacity="0.24" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
            <motion.path d={savingsBand} fill="var(--brass)" fillOpacity="0.32" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.08 }} />
            <motion.path d={debtBand} fill="var(--drain)" fillOpacity="0.24" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.16 }} />
            <motion.path d={line} fill="none" stroke="var(--brass-bright)" strokeWidth="2" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: "easeOut" }} />
          </>
        ) : (
          <>
            <motion.path d={area} fill="url(#area-grad)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} />
            <motion.path d={line} fill="none" stroke="var(--brass-bright)" strokeWidth="2.5" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: "easeOut" }} />
          </>
        )}

        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-axis">{points[i].year}</text>
        ))}

        {hp && (
          <>
            <line x1={x(hp.yearIndex)} x2={x(hp.yearIndex)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-mute)" strokeWidth="1" />
            <circle cx={x(hp.yearIndex)} cy={y(hp.netWorth)} r="5" fill="var(--brass-bright)" stroke="var(--bg)" strokeWidth="2" />
          </>
        )}

        {/* marqueurs d'événements — empilés EN HAUT le long de leur ligne d'année
            (jamais sous l'infobulle qui suit la courbe) ; cliquables si planifiés.
            Décalés SOUS les libellés de jalons de la même année pour ne pas les recouvrir. */}
        {[...marksByYear.entries()].map(([yi, list]) => {
          const msOffset = (msByIdx.get(yi)?.length ?? 0) * 14; // hauteur des libellés de jalons
          return list.map((e, j) => {
            const cx = x(yi);
            const cy = M.top + 14 + msOffset + j * 22;
            const clickable = e.kind === "planned" && !!e.id && !!onEventClick;
            return (
              <g
                key={`${yi}-${j}`}
                className={"chart-mark" + (clickable ? " clickable" : "")}
                onClick={clickable ? () => onEventClick!(e.id!) : undefined}
              >
                {/* zone de clic élargie, invisible */}
                <circle cx={cx} cy={cy} r="13" fill="transparent" />
                <circle cx={cx} cy={cy} r="9" fill="var(--panel-hi)" stroke={MARK_COLORS[e.kind]} strokeWidth="1.4" />
                <text x={cx} y={cy + 3.6} textAnchor="middle" className="chart-mark-glyph" style={{ fill: MARK_COLORS[e.kind] }}>
                  {MARK_GLYPHS[e.kind]}
                </text>
                <title>{e.label} · {e.year}{clickable ? " — cliquer pour modifier" : ""}</title>
              </g>
            );
          });
        })}
      </svg>

      {hp && (
        <div className="chart-tip" style={{ left: `${(x(hp.yearIndex) / W) * 100}%`, top: `${(y(hp.netWorth) / H) * 100}%` }}>
          <div className="chart-tip-year">{hp.year}{hp.age !== null ? ` · ${hp.age} ans` : ""}</div>
          <div className="chart-tip-val">{money(hp.netWorth)}</div>
          <div className="chart-tip-sub">actifs {compactEur(hp.grossAssets)} · dettes {compactEur(hp.debt)}</div>
        </div>
      )}
    </div>
  );
}
