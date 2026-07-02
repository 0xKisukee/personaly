import { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import type { ProjectionParams } from "../lib/types";
import { project, type ProjectionEvent, type YearDetail, type YearPoint } from "../lib/projection";
import { grossWealth, totalLiabilities } from "../lib/selectors";
import { money, signedMoney, percent } from "../lib/format";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import { IconChart } from "../components/icons";

const HORIZONS = [10, 20, 30, 40];

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const compactEur = (n: number) => compact.format(n) + " €";

export default function ProjectionPage() {
  const { state, update } = useStore();
  const p = state.projection;
  const [chartMode, setChartMode] = useState<"net" | "composition">("net");
  const [selYear, setSelYear] = useState<number | null>(null);
  const setP = (patch: Partial<ProjectionParams>) =>
    update((s) => ({ ...s, projection: { ...s.projection, ...patch } }));

  const { points, events, fiYearIndex } = useMemo(() => project(state, p), [state, p]);

  const hasData =
    grossWealth(state) > 0 || totalLiabilities(state) > 0 || state.incomes.length > 0 || state.expenses.length > 0;

  const now = points[0];
  const end = points[points.length - 1];
  const delta = end.netWorth - now.netWorth;
  const mult = now.netWorth > 0 ? end.netWorth / now.netWorth : null;
  const cagr = now.netWorth > 0 && end.netWorth > 0 ? (Math.pow(end.netWorth / now.netWorth, 1 / p.horizon) - 1) * 100 : null;
  const fiPoint = fiYearIndex !== null ? points[fiYearIndex] : null;

  const goalPoint = p.goalYear ? points.find((pt) => pt.year === p.goalYear) ?? null : null;
  const goalGap = p.goalAmount != null && goalPoint ? goalPoint.netWorth - p.goalAmount : null;
  const selPoint = selYear !== null ? points.find((pt) => pt.year === selYear) ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="04 — Projection"
        title={<>Ton patrimoine <em>demain</em></>}
        lede="Simulation année par année : les emprunts s'éteignent à leur terme, la valeur des actifs se compose et l'épargne est réinvestie."
        actions={
          <div className="segment">
            {HORIZONS.map((h) => (
              <button key={h} data-on={p.horizon === h} onClick={() => setP({ horizon: h })}>{h} ans</button>
            ))}
          </div>
        }
      />

      {!hasData ? (
        <div className="empty">
          <IconChart size={28} />
          <div>Rien à projeter pour l'instant.<br />Ajoute des actifs, des passifs ou des flux d'abord.</div>
        </div>
      ) : (
        <>
          {/* --------- hypothèses --------- */}
          <motion.div
            className="assum"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="field assum-num">
              <label>Rendement épargne réinvestie</label>
              <div className="assum-input">
                <input className="input mono" type="number" step="0.1" value={p.savingsYield || ""} placeholder="0"
                  onChange={(e) => setP({ savingsYield: Number(e.target.value) })} />
                <span className="assum-unit">%/an</span>
              </div>
            </div>
            <div className="field assum-num">
              <label>Inflation</label>
              <div className="assum-input">
                <input className="input mono" type="number" step="0.1" value={p.inflation || ""} placeholder="0"
                  onChange={(e) => setP({ inflation: Number(e.target.value) })} />
                <span className="assum-unit">%/an</span>
              </div>
            </div>
            <div className="field assum-num">
              <label>Objectif de patrimoine net</label>
              <div className="assum-input">
                <input className="input mono" type="number" placeholder="montant" style={{ width: 130 }}
                  value={p.goalAmount ?? ""} onChange={(e) => setP({ goalAmount: e.target.value ? Number(e.target.value) : undefined })} />
                <span className="assum-unit">en</span>
                <input className="input mono" type="number" placeholder="année" style={{ width: 84 }}
                  value={p.goalYear ?? ""} onChange={(e) => setP({ goalYear: e.target.value ? Number(e.target.value) : undefined })} />
              </div>
            </div>
            <div className="assum-toggles">
              <label className="auto-toggle">
                <input type="checkbox" checked={p.indexIncomes} onChange={(e) => setP({ indexIncomes: e.target.checked })} />
                Indexer les revenus
              </label>
              <label className="auto-toggle">
                <input type="checkbox" checked={p.indexExpenses} onChange={(e) => setP({ indexExpenses: e.target.checked })} />
                Indexer les dépenses
              </label>
              <label className="auto-toggle">
                <input type="checkbox" checked={p.realTerms} onChange={(e) => setP({ realTerms: e.target.checked })} />
                Euros constants
              </label>
            </div>
          </motion.div>

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

          {/* --------- indépendance financière --------- */}
          {fiPoint && (
            <div className="fi-banner">
              <span className="fi-dot" />
              <b>Indépendance financière</b> atteinte en <b>{fiPoint.year}</b>
              {fiPoint.age !== null ? ` (${fiPoint.age} ans)` : ""} — tes revenus passifs couvrent alors tes sorties.
            </div>
          )}

          {goalGap !== null && goalPoint && (
            <div className="fi-banner" style={{ borderColor: goalGap >= 0 ? "rgba(147,195,156,0.35)" : "rgba(213,152,115,0.4)", background: goalGap >= 0 ? "rgba(147,195,156,0.07)" : "rgba(213,152,115,0.07)" }}>
              <span className="fi-dot" style={{ background: goalGap >= 0 ? "var(--gain)" : "var(--drain)", boxShadow: `0 0 10px ${goalGap >= 0 ? "var(--gain)" : "var(--drain)"}` }} />
              Objectif <b>{money(p.goalAmount!)}</b> en <b>{p.goalYear}</b> — projeté {money(goalPoint.netWorth)},&nbsp;
              <b style={{ color: goalGap >= 0 ? "var(--gain)" : "var(--drain)" }}>{goalGap >= 0 ? "atteint" : "manque"} {money(Math.abs(goalGap))}</b>.
            </div>
          )}

          <motion.div className="card" style={{ padding: "18px 20px 12px" }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
            <div className="chart-head">
              <div className="segment">
                <button data-on={chartMode === "net"} onClick={() => setChartMode("net")}>Patrimoine net</button>
                <button data-on={chartMode === "composition"} onClick={() => setChartMode("composition")}>Composition</button>
              </div>
              {chartMode === "composition" && (
                <div className="chart-legend">
                  <span><i style={{ background: "var(--sage)" }} /> Actifs</span>
                  <span><i style={{ background: "var(--gain)" }} /> Épargne</span>
                  <span><i style={{ background: "var(--drain)" }} /> Dettes</span>
                </div>
              )}
            </div>
            <NetWorthChart points={points} events={events} mode={chartMode} />
          </motion.div>

          {events.length > 0 && (
            <div className="proj-events">
              {events.map((e, i) => (
                <span className="tag" key={i}
                  style={e.kind === "fi"
                    ? { borderColor: "rgba(147,195,156,0.4)", color: "var(--gain)" }
                    : { borderColor: "var(--line-brass)", color: "var(--brass-bright)" }}>
                  {e.kind === "fi" ? "◆" : "⚑"} {e.label} · {e.year}
                </span>
              ))}
            </div>
          )}

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
                      className="proj-row" onClick={() => setSelYear(pt.year)}>
                      <td>{pt.year}{pt.age !== null && <span className="proj-age"> · {pt.age} ans</span>}</td>
                      <td className="r mono">{money(pt.grossAssets)}</td>
                      <td className="r mono" style={{ color: pt.debt > 0 ? "var(--drain)" : "var(--ink-faint)" }}>
                        {pt.debt > 0 ? "−" + money(pt.debt) : "—"}
                      </td>
                      <td className="r mono" style={{ color: pt.savings < 0 ? "var(--drain)" : "var(--ink-soft)" }}>{signedMoney(pt.savings)}</td>
                      <td className="r mono" style={{ fontWeight: 600, color: "var(--brass-bright)" }}>{money(pt.netWorth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="help" style={{ marginTop: 18 }}>
            Hypothèses : taux d'évolution et revenus supposés constants{p.realTerms ? ", montants en euros constants" : ", montants en euros courants"}.
            L'épargne réalisée est réinvestie à {percent(p.savingsYield)}/an. Estimation, hors fiscalité.
          </p>
        </>
      )}

      {selPoint && (
        <YearDetailModal point={selPoint} real={p.realTerms} onClose={() => setSelYear(null)} />
      )}
    </>
  );
}

/* --------------------------- CHART --------------------------- */
function NetWorthChart({ points, events, mode }: { points: YearPoint[]; events: ProjectionEvent[]; mode: "net" | "composition" }) {
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

  const x = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
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

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotLeft = (rect.width * M.left) / W;
    const plotW = (rect.width * innerW) / W;
    let i = Math.round(((px - plotLeft) / plotW) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none">
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

        {events.map((e, i) => (
          <line key={i} x1={x(e.yearIndex)} x2={x(e.yearIndex)} y1={M.top} y2={M.top + innerH}
            stroke={e.kind === "fi" ? "var(--gain)" : "var(--line-brass)"} strokeWidth="1" strokeDasharray="3 5" />
        ))}

        {mode === "composition" ? (
          <>
            <path d={assetsBand} fill="var(--sage)" fillOpacity="0.24" />
            <path d={savingsBand} fill="var(--gain)" fillOpacity="0.3" />
            <path d={debtBand} fill="var(--drain)" fillOpacity="0.24" />
            <path d={line} fill="none" stroke="var(--brass-bright)" strokeWidth="2" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d={area} fill="url(#area-grad)" />
            <path d={line} fill="none" stroke="var(--brass-bright)" strokeWidth="2.5" strokeLinejoin="round" />
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

/* -------------------- YEAR DETAIL MODAL -------------------- */
function YearDetailModal({ point, real, onClose }: { point: YearPoint; real: boolean; onClose: () => void }) {
  const d: YearDetail = point.detail;
  const suffix = real ? " · € constants" : "";
  return (
    <Modal open title={`Composition ${point.year}`} subtitle={`Patrimoine net ${money(point.netWorth)}${point.age !== null ? ` · ${point.age} ans` : ""}${suffix}`} onClose={onClose}>
      <div className="yd-grid">
        <div>
          <div className="yd-head"><span className="dot brass" /> Patrimoine (fin d'année)</div>
          {d.assets.map((a) => (
            <div className="yd-row" key={a.id}>
              <span className="yd-label">{a.label}</span>
              <span className="mono">{money(a.value)}</span>
            </div>
          ))}
          {d.loans.map((l) => (
            <div className="yd-row" key={l.id}>
              <span className="yd-label">{l.label}</span>
              <span className="mono" style={{ color: "var(--drain)" }}>−{money(l.balance)}</span>
            </div>
          ))}
          <div className="yd-row">
            <span className="yd-label">Épargne cumulée</span>
            <span className="mono" style={{ color: point.savings < 0 ? "var(--drain)" : "var(--ink-soft)" }}>{signedMoney(point.savings)}</span>
          </div>
          <div className="yd-row yd-total">
            <span>Patrimoine net</span>
            <span className="mono" style={{ color: "var(--brass-bright)" }}>{money(point.netWorth)}</span>
          </div>
        </div>

        <div>
          <div className="yd-head"><span className="dot gain" /> Flux de l'année</div>
          <YdFlow label="Revenus distribués" v={point.distributed} pos />
          {d.incomes.map((f) => <YdFlow key={f.id} label={f.label} v={f.amount} pos sub />)}
          {point.extra > 0 && <YdFlow label="Revenus complémentaires" v={point.extra} pos />}
          {point.savingsYield !== 0 && <YdFlow label="Rendement épargne" v={point.savingsYield} pos />}
          {point.growth !== 0 && <YdFlow label="Plus-value latente" v={point.growth} pos={point.growth >= 0} />}
          {point.expenses > 0 && <YdFlow label="Dépenses & impôts" v={-point.expenses} />}
          {point.charges > 0 && <YdFlow label="Charges d'actifs" v={-point.charges} />}
          {point.interest > 0 && <YdFlow label="Intérêts d'emprunt" v={-point.interest} />}
          {point.insurance > 0 && <YdFlow label="Assurance emprunt" v={-point.insurance} />}
          {point.principal > 0 && <YdFlow label="Capital remboursé (neutre)" v={-point.principal} neutral />}
          <div className="yd-row yd-total">
            <span>Enrichissement</span>
            <span className="mono" style={{ color: "var(--brass-bright)" }}>
              {signedMoney(point.distributed + point.extra + point.savingsYield + point.growth - point.expenses - point.charges - point.interest - point.insurance)}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function YdFlow({ label, v, pos, neutral, sub }: { label: string; v: number; pos?: boolean; neutral?: boolean; sub?: boolean }) {
  const color = neutral ? "var(--ink-mute)" : pos ? "var(--gain)" : "var(--drain)";
  return (
    <div className="yd-row" style={sub ? { paddingLeft: 14, opacity: 0.75 } : undefined}>
      <span className="yd-label">{label}</span>
      <span className="mono" style={{ color }}>{signedMoney(v)}</span>
    </div>
  );
}
