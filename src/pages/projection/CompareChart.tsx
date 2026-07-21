import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { YearPoint } from "../../lib/projection";
import { money } from "../../lib/format";
import { compactEur, timeFractions, nearestIndex, SERIES_COLORS } from "./chartUtils";

/** Mode « Plans » : une courbe de patrimoine net par plan, sur un axe partagé. */
export default function CompareChart({ series }: { series: { name: string; points: YearPoint[] }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000, H = 340;
  const M = { top: 24, right: 24, bottom: 40, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const pts0 = series[0].points;
  const n = pts0.length;

  const all = series.flatMap((s) => s.points.map((pt) => pt.netWorth));
  const maxV = Math.max(...all, 0);
  const minV = Math.min(...all, 0);
  const domainMax = (maxV || 1) * 1.08;
  const domainMin = minV < 0 ? minV * 1.08 : 0;

  const fracs = timeFractions(n);
  const x = (i: number) => M.left + fracs[i] * innerW;
  const y = (v: number) => M.top + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;
  const line = (pts: YearPoint[]) =>
    pts.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(pt.netWorth).toFixed(1)}`).join(" ");

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / yTicks);
  const xStep = Math.max(1, Math.ceil((n - 1) / 8));
  const xTickIdx = pts0.map((_, i) => i).filter((i) => i % xStep === 0 || i === n - 1);

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

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none">
        {yTickVals.map((v, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 12} y={y(v) + 4} textAnchor="end" className="chart-axis">{compactEur(v)}</text>
          </g>
        ))}
        {domainMin < 0 && (
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
        )}
        {series.map((s, si) => (
          <motion.path key={s.name} d={line(s.points)} fill="none"
            stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth="2" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: "easeOut", delay: si * 0.06 }} />
        ))}
        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-axis">{pts0[i].year}</text>
        ))}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-mute)" strokeWidth="1" />
            {series.map((s, si) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.points[hover].netWorth)} r="4"
                fill={SERIES_COLORS[si % SERIES_COLORS.length]} stroke="var(--bg)" strokeWidth="2" />
            ))}
          </>
        )}
      </svg>

      {hover !== null && (
        <div className="chart-tip below" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(M.top / H) * 100}%` }}>
          <div className="chart-tip-year">{pts0[hover].year}{pts0[hover].age !== null ? ` · ${pts0[hover].age} ans` : ""}</div>
          {series.map((s, si) => (
            <div key={s.name} className="chart-tip-sub">
              <i className="tip-dot" style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} />
              {s.name} · {money(s.points[hover].netWorth)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
