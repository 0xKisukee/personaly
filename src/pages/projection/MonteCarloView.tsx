import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../../lib/store";
import type { Asset, ProjectionParams, SimState } from "../../lib/types";
import type { YearPoint } from "../../lib/projection";
import { DEFAULT_VOLATILITY } from "../../lib/assets";
import { runMonteCarlo, type MonteCarloBand } from "../../lib/montecarlo";
import { money } from "../../lib/format";
import { compactEur, timeFractions, nearestIndex } from "./chartUtils";

/** Vue Probabilité : Monte Carlo (jauge de succès + éventail de percentiles). */
export default function MonteCarloView({ projState, params, detPoints, eligibleAssets }: {
  projState: SimState;
  params: ProjectionParams;
  detPoints: YearPoint[];
  eligibleAssets: Asset[];
}) {
  const { update } = useStore();
  const mc = useMemo(() => runMonteCarlo(projState, params, { trials: 400 }), [projState, params]);

  const rate = mc.successRate;
  const color = !mc.hasVolatility
    ? "var(--ink-mute)"
    : rate >= 0.85 ? "var(--gain)" : rate >= 0.6 ? "var(--brass-bright)" : "var(--drain)";
  const verdict = rate >= 0.85 ? "solide" : rate >= 0.6 ? "fragile" : "risqué";
  const end = mc.bands[mc.bands.length - 1];

  const applyDefaultVols = () =>
    update((st) => ({
      ...st,
      assets: st.assets.map((a) =>
        a.volatility == null && DEFAULT_VOLATILITY[a.category] > 0 ? { ...a, volatility: DEFAULT_VOLATILITY[a.category] } : a
      ),
    }));

  const R = 40;
  const C = 2 * Math.PI * R;

  return (
    <>
      {!mc.hasVolatility && (
        <div className="fi-banner" style={{ borderColor: "var(--line-brass)", background: "rgba(203,169,107,0.06)" }}>
          <span className="fi-dot" style={{ background: "var(--brass)", boxShadow: "0 0 10px var(--brass)" }} />
          <span>
            Aucun actif n'a de <b>volatilité</b> : tous les tirages suivent la même trajectoire.
            Renseigne-la par actif dans <b>Patrimoine</b>, ou
          </span>
          <button className="btn btn-ghost" onClick={applyDefaultVols} style={{ whiteSpace: "nowrap" }}>
            appliquer des valeurs types
          </button>
        </div>
      )}

      <motion.div className="mc-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mc-gauge">
          <svg width="112" height="112" viewBox="0 0 104 104">
            <circle cx="52" cy="52" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="8" />
            <circle cx="52" cy="52" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${C * rate} ${C}`} transform="rotate(-90 52 52)" />
            <text x="52" y="50" textAnchor="middle" className="mc-gauge-pct" style={{ fill: color }}>
              {Math.round(rate * 100)}%
            </text>
            <text x="52" y="66" textAnchor="middle" className="mc-gauge-sub">succès</text>
          </svg>
        </div>
        <div className="mc-facts">
          <div className="mc-title">
            Plan <b style={{ color }}>{verdict}</b> : l'épargne tient jusqu'au bout dans {mc.trials - mc.failures} des {mc.trials} tirages.
          </div>
          <div className="mc-sub">
            Un tirage <b>échoue</b> si l'épargne tombe à sec une année (déficit non couvert, même après la cascade de retrait).
            Rendements mensuels tirés autour du taux de chaque actif, selon sa volatilité.
          </div>
          <div className="mc-percentiles">
            <span className="tag" style={{ color: "var(--drain)" }}>pessimiste (P10) {compactEur(end.p10)}</span>
            <span className="tag" style={{ color: "var(--brass-bright)" }}>médian {compactEur(end.p50)}</span>
            <span className="tag" style={{ color: "var(--gain)" }}>optimiste (P90) {compactEur(end.p90)}</span>
            <span className="tag">en {end.year}</span>
          </div>
        </div>
      </motion.div>

      {(params.withdrawalTargets ?? []).length === 0 && eligibleAssets.length > 0 && (
        <p className="help" style={{ marginBottom: 16 }}>
          Astuce : sans <b>cascade de retrait</b> (onglet Projection), un déficit compte comme un échec même si tes
          placements sont pleins — configure-la pour laisser tes actifs financer les années creuses.
        </p>
      )}

      <motion.div className="card" style={{ padding: "18px 20px 12px" }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.06 }}>
        <div className="chart-head">
          <div className="chart-legend">
            <span><i style={{ background: "var(--brass)", opacity: 0.25 }} /> P10–P90</span>
            <span><i style={{ background: "var(--brass)", opacity: 0.5 }} /> P25–P75</span>
            <span><i style={{ background: "var(--brass-bright)" }} /> Médiane</span>
            <span><i style={{ background: "var(--ink-mute)" }} /> Déterministe</span>
          </div>
        </div>
        <FanChart bands={mc.bands} det={detPoints} />
      </motion.div>
    </>
  );
}

/** Éventail de percentiles P10–P90 / P25–P75 + médiane + trajectoire déterministe. */
function FanChart({ bands, det }: { bands: MonteCarloBand[]; det: YearPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000, H = 340;
  const M = { top: 24, right: 24, bottom: 40, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const n = bands.length;

  const maxV = Math.max(...bands.map((b) => b.p90), ...det.map((pt) => pt.netWorth), 0);
  const minV = Math.min(...bands.map((b) => b.p10), ...det.map((pt) => pt.netWorth), 0);
  const domainMax = (maxV || 1) * 1.08;
  const domainMin = minV < 0 ? minV * 1.08 : 0;

  const fracs = timeFractions(n);
  const x = (i: number) => M.left + fracs[i] * innerW;
  const y = (v: number) => M.top + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;

  const path = (get: (b: MonteCarloBand) => number) =>
    bands.map((b, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(get(b)).toFixed(1)}`).join(" ");
  const bandArea = (up: (b: MonteCarloBand) => number, low: (b: MonteCarloBand) => number) => {
    const upP = path(up);
    const down = [...bands].reverse().map((b) => `L ${x(b.yearIndex).toFixed(1)} ${y(low(b)).toFixed(1)}`).join(" ");
    return `${upP} ${down} Z`;
  };
  const detLine = det.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(pt.netWorth).toFixed(1)}`).join(" ");

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / yTicks);
  const xStep = Math.max(1, Math.ceil((n - 1) / 8));
  const xTickIdx = bands.map((_, i) => i).filter((i) => i % xStep === 0 || i === n - 1);

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

  const hb = hover !== null ? bands[hover] : null;

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

        <path d={bandArea((b) => b.p90, (b) => b.p10)} fill="var(--brass)" fillOpacity="0.14" />
        <path d={bandArea((b) => b.p75, (b) => b.p25)} fill="var(--brass)" fillOpacity="0.22" />
        <path d={path((b) => b.p50)} fill="none" stroke="var(--brass-bright)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={detLine} fill="none" stroke="var(--ink-mute)" strokeWidth="1.5" strokeDasharray="5 5" strokeLinejoin="round" />

        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-axis">{bands[i].year}</text>
        ))}

        {hb && (
          <>
            <line x1={x(hb.yearIndex)} x2={x(hb.yearIndex)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-mute)" strokeWidth="1" />
            <circle cx={x(hb.yearIndex)} cy={y(hb.p50)} r="5" fill="var(--brass-bright)" stroke="var(--bg)" strokeWidth="2" />
          </>
        )}
      </svg>

      {hb && (
        <div className="chart-tip" style={{ left: `${(x(hb.yearIndex) / W) * 100}%`, top: `${(y(hb.p50) / H) * 100}%` }}>
          <div className="chart-tip-year">{hb.year}{hb.age !== null ? ` · ${hb.age} ans` : ""}</div>
          <div className="chart-tip-val">{money(hb.p50)}</div>
          <div className="chart-tip-sub" style={{ color: "var(--gain)" }}>P90 {compactEur(hb.p90)}</div>
          <div className="chart-tip-sub" style={{ color: "var(--drain)" }}>P10 {compactEur(hb.p10)}</div>
        </div>
      )}
    </div>
  );
}
