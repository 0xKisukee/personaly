import type { Asset, Period, SurplusFlow } from "../../lib/types";
import { money } from "../../lib/format";

/**
 * Éditeur des FLOWS d'affectation du surplus (« cash flow priorities »). Liste
 * ORDONNÉE de priorités : chaque flow prélève dans le surplus restant selon son
 * mode (maximiser / % du restant / montant fixe), borné par le plafond de versements
 * et un éventuel solde cible ; le reliquat retombe à l'épargne. ↑/↓ = priorité.
 */
const MODES: { id: SurplusFlow["mode"]; label: string }[] = [
  { id: "max", label: "Maximiser" },
  { id: "percent", label: "% du restant" },
  { id: "amount", label: "Montant fixe" },
];

export default function SurplusFlowEditor({ label, eligible, flows, onChange }: {
  label: string;
  eligible: Asset[];
  flows: SurplusFlow[];
  onChange: (flows: SurplusFlow[]) => void;
}) {
  const usedIds = new Set(flows.map((f) => f.assetId));
  const available = eligible.filter((a) => !usedIds.has(a.id));
  const assetOf = (id: string) => eligible.find((a) => a.id === id);

  const patch = (i: number, p: Partial<SurplusFlow>) =>
    onChange(flows.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const remove = (i: number) => onChange(flows.filter((_, k) => k !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= flows.length) return;
    const next = [...flows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (assetId: string) => assetId && onChange([...flows, { assetId, mode: "max" }]);

  return (
    <div className="field assum-surplus">
      <label>{label}</label>
      <div className="flow-list">
        {flows.map((f, i) => {
          const a = assetOf(f.assetId);
          const capLeft = a?.depositCap != null ? Math.max(0, a.depositCap - (a.depositsMade || 0)) : null;
          // choix d'actifs pour CE flow : le sien + ceux non déjà pris
          const options = eligible.filter((x) => x.id === f.assetId || !usedIds.has(x.id));
          const showNominal = f.mode === "amount" || f.targetBalance != null;
          return (
            <div className="flow-row" key={f.assetId}>
              <div className="flow-head">
                <span className="flow-rank mono">{i + 1}</span>
                <select className="select" value={f.assetId} onChange={(e) => patch(i, { assetId: e.target.value })}>
                  {options.map((x) => <option key={x.id} value={x.id}>{x.label || "Actif"}</option>)}
                </select>
                <div className="segment flow-modes">
                  {MODES.map((m) => (
                    <button key={m.id} data-on={f.mode === m.id} onClick={() => patch(i, { mode: m.id })}>{m.label}</button>
                  ))}
                </div>
                <div className="flow-move">
                  <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter la priorité">↑</button>
                  <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === flows.length - 1} aria-label="Descendre la priorité">↓</button>
                  <button className="icon-btn" onClick={() => remove(i)} aria-label="Retirer">×</button>
                </div>
              </div>

              <div className="flow-cfg">
                {f.mode === "percent" && (
                  <div className="flow-input">
                    <input className="input mono" type="number" min={0} max={100} step={1} placeholder="ex. 50"
                      value={f.percent ?? ""} onChange={(e) => patch(i, { percent: e.target.value !== "" ? Number(e.target.value) : undefined })} />
                    <span className="assum-unit">% du surplus restant</span>
                  </div>
                )}
                {f.mode === "amount" && (
                  <div className="flow-input">
                    <input className="input mono" type="number" placeholder="ex. 300"
                      value={f.amount || ""} onChange={(e) => patch(i, { amount: Number(e.target.value) })} />
                    <div className="segment">
                      <button data-on={(f.period ?? "monthly") === "monthly"} onClick={() => patch(i, { period: "monthly" })}>/ mois</button>
                      <button data-on={f.period === "yearly"} onClick={() => patch(i, { period: "yearly" as Period })}>/ an</button>
                    </div>
                  </div>
                )}
                <div className="flow-input">
                  <input className="input mono" type="number" placeholder="sans limite"
                    value={f.targetBalance ?? ""} onChange={(e) => patch(i, { targetBalance: e.target.value !== "" ? Number(e.target.value) : undefined })} />
                  <span className="assum-unit">€ solde cible</span>
                </div>
                {showNominal && (
                  <div className="segment flow-nominal">
                    <button data-on={!f.nominal} onClick={() => patch(i, { nominal: undefined })}>€ constants</button>
                    <button data-on={!!f.nominal} onClick={() => patch(i, { nominal: true })}>€ courants</button>
                  </div>
                )}
                {capLeft != null && <span className="help">plafond de versements : reste {money(capLeft)}</span>}
              </div>
            </div>
          );
        })}

        {available.length > 0 && (
          <select className="select cascade-add flow-add" value="" onChange={(e) => add(e.target.value)}>
            <option value="">{flows.length ? "+ Ajouter une priorité…" : "+ Affecter le surplus à un compte…"}</option>
            {available.map((x) => <option key={x.id} value={x.id}>{x.label || "Actif"}</option>)}
          </select>
        )}
        <span className="assum-unit flow-rest">↳ le reliquat va à l'Épargne</span>
      </div>
    </div>
  );
}
