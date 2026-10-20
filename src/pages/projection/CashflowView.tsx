import { useState } from "react";
import { m } from "motion/react";
import type { YearPoint } from "../../lib/projection";
import { money } from "../../lib/format";
import SankeyChart from "../../components/SankeyChart";

/** Vue Cash-flow : diagramme de Sankey du cash-flow d'une année (slider). */
export default function CashflowView({ points, realTerms }: { points: YearPoint[]; realTerms: boolean }) {
  // par défaut la 1re année PLEINE (l'année 0 est souvent partielle)
  const [rawIdx, setRawIdx] = useState(Math.min(1, points.length - 1));
  const idx = Math.min(rawIdx, points.length - 1);
  const pt = points[idx];

  // les transferts sont neutres (cash 0) : déjà portés par deposited/withdrawn, ils ne comptent pas ici
  const evIn = pt.detail.events.filter((e) => e.cash > 0).reduce((t, e) => t + e.cash, 0);
  const evOut = pt.detail.events.filter((e) => e.cash < 0).reduce((t, e) => t - e.cash, 0);
  const inflows = pt.distributed + pt.extra + pt.savingsYield + pt.withdrawn + evIn;
  const outflows = pt.expenses + pt.charges + pt.interest + pt.insurance + pt.principal + pt.deposited + evOut;
  const saved = inflows - outflows;

  return (
    <>
      <m.div className="card cash-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="cash-head">
          <div>
            <div className="eyebrow">Cash-flow de l'année{realTerms ? " · € constants" : ""}</div>
            <div className="cash-year mono">
              {pt.year}
              {pt.age !== null && <span className="proj-age"> · {pt.age} ans</span>}
            </div>
          </div>
          <div className="cash-chips">
            <span className="tag" style={{ color: "var(--gain)" }}>entrées {money(inflows)}</span>
            <span className="tag" style={{ color: "var(--drain)" }}>affectations {money(outflows)}</span>
            <span className="tag" style={{ color: saved >= 0 ? "var(--gain)" : "var(--drain)" }}>
              {saved >= 0 ? "épargné" : "désépargné"} {money(Math.abs(saved))}
            </span>
          </div>
          <input
            className="cash-slider"
            type="range"
            min={0}
            max={points.length - 1}
            value={idx}
            onChange={(e) => setRawIdx(Number(e.target.value))}
          />
        </div>
        <SankeyChart point={pt} />
      </m.div>
      <p className="help" style={{ marginTop: 16 }}>
        D'où vient l'argent de l'année, et où il va. L'<b>épargne</b> est le poste d'équilibre : le surplus part
        « vers l'épargne », un déficit est « puisé dans l'épargne » (ou couvert par les <b>retraits d'actifs</b> si la
        cascade de retrait est configurée). Le capital remboursé et les versements sont des transferts neutres —
        ils sortent de la trésorerie mais restent dans ton patrimoine.
      </p>
    </>
  );
}
