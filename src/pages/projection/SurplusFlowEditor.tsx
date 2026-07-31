import type { Asset, Period, SurplusFlow } from "../../lib/types";
import { money } from "../../lib/format";

/**
 * Éditeur des FLOWS d'affectation du surplus (« cash flow priorities »). Liste
 * ORDONNÉE de priorités : chaque flow prélève dans le surplus restant selon son
 * mode (maximiser / % du restant / montant fixe), borné par le plafond de versements
 * et un éventuel solde cible ; le reliquat retombe à l'épargne. ↑/↓ = priorité.
 *
 * Chaque étape porte une PHRASE en clair (« verse tout le surplus restant sur pea »)
 * : les trois modes et le solde cible ne se devinent pas depuis les seuls contrôles.
 */
const MODES: { id: SurplusFlow["mode"]; label: string }[] = [
  { id: "max", label: "Tout le reste" },
  { id: "percent", label: "% du reste" },
  { id: "amount", label: "Montant fixe" },
];

/** Part du surplus prise par ce flow, en français — le sujet de la phrase de l'étape. */
function shareLabel(f: SurplusFlow): string {
  if (f.mode === "percent") return `${f.percent ?? 0} % du surplus restant`;
  if (f.mode === "amount") return `${money(f.amount || 0)} ${f.period === "yearly" ? "par an" : "par mois"}`;
  return "tout le surplus restant";
}

export default function SurplusFlowEditor({ eligible, flows, onChange, savingsYield }: {
  eligible: Asset[];
  flows: SurplusFlow[];
  onChange: (flows: SurplusFlow[]) => void;
  savingsYield: number;
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
    <section className="rule-block">
      <div className="rule-head">
        <h3 className="rule-title">Affectation du surplus</h3>
        <p className="rule-lede">
          Chaque mois, ce qui reste une fois les dépenses, charges et mensualités payées est versé
          dans ces comptes, <b>dans l'ordre</b>. Chaque étape se sert dans ce que la précédente a laissé.
        </p>
      </div>

      <ol className="rule-steps">
        {flows.map((f, i) => {
          const a = assetOf(f.assetId);
          const capLeft = a?.depositCap != null ? Math.max(0, a.depositCap - (a.depositsMade || 0)) : null;
          // choix d'actifs pour CE flow : le sien + ceux non déjà pris
          const options = eligible.filter((x) => x.id === f.assetId || !usedIds.has(x.id));
          const showNominal = f.mode === "amount" || f.targetBalance != null;
          return (
            <li className="rule-step" key={f.assetId}>
              <span className="step-n mono">{i + 1}</span>
              <div className="step-body">
                <div className="step-top">
                  <select className="select step-asset" value={f.assetId} onChange={(e) => patch(i, { assetId: e.target.value })}>
                    {options.map((x) => <option key={x.id} value={x.id}>{x.label || "Actif"}</option>)}
                  </select>
                  <div className="segment step-modes">
                    {MODES.map((m) => (
                      <button key={m.id} data-on={f.mode === m.id} onClick={() => patch(i, { mode: m.id })}>{m.label}</button>
                    ))}
                  </div>
                  <div className="step-move">
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter la priorité">↑</button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === flows.length - 1} aria-label="Descendre la priorité">↓</button>
                    <button className="icon-btn danger" onClick={() => remove(i)} aria-label="Retirer cette étape">×</button>
                  </div>
                </div>

                <div className="step-cfg">
                  {f.mode === "percent" && (
                    <label className="cfg-field">
                      <span className="cfg-label">Part du surplus restant</span>
                      <div className="cfg-input">
                        <input className="input mono" type="number" min={0} max={100} step={1} placeholder="ex. 50"
                          value={f.percent ?? ""} onChange={(e) => patch(i, { percent: e.target.value !== "" ? Number(e.target.value) : undefined })} />
                        <span className="assum-unit">%</span>
                      </div>
                    </label>
                  )}
                  {f.mode === "amount" && (
                    <label className="cfg-field">
                      <span className="cfg-label">Montant versé</span>
                      <div className="cfg-input">
                        <input className="input mono" type="number" placeholder="ex. 300"
                          value={f.amount || ""} onChange={(e) => patch(i, { amount: Number(e.target.value) })} />
                        <div className="segment">
                          <button data-on={(f.period ?? "monthly") === "monthly"} onClick={() => patch(i, { period: "monthly" })}>/ mois</button>
                          <button data-on={f.period === "yearly"} onClick={() => patch(i, { period: "yearly" as Period })}>/ an</button>
                        </div>
                      </div>
                    </label>
                  )}
                  <label className="cfg-field">
                    <span className="cfg-label">S'arrêter à un solde de — optionnel</span>
                    <div className="cfg-input">
                      <input className="input mono cfg-wide" type="number" placeholder="sans limite"
                        value={f.targetBalance ?? ""} onChange={(e) => patch(i, { targetBalance: e.target.value !== "" ? Number(e.target.value) : undefined })} />
                      <span className="assum-unit">€</span>
                    </div>
                  </label>
                  {showNominal && (
                    <label className="cfg-field">
                      <span className="cfg-label">Montants exprimés en</span>
                      <div className="segment">
                        <button data-on={!f.nominal} onClick={() => patch(i, { nominal: undefined })}>€ constants</button>
                        <button data-on={!!f.nominal} onClick={() => patch(i, { nominal: true })}>€ courants</button>
                      </div>
                    </label>
                  )}
                </div>

                <p className="step-say">
                  Verse <b>{shareLabel(f)}</b> sur <b>{a?.label || "—"}</b>
                  {f.targetBalance != null && <> jusqu'à un solde de <b>{money(f.targetBalance)}</b></>}.
                  {capLeft != null && <span className="step-note"> Plafond de versements : {money(capLeft)} restants.</span>}
                </p>
              </div>
            </li>
          );
        })}

        {flows.length === 0 && (
          <li className="rule-empty">
            Aucune affectation : <b>tout le surplus reste sur l'Épargne</b>, rémunérée à {savingsYield || 0} %/an.
          </li>
        )}

        <li className="rule-term">
          <span className="step-n mono">↳</span>
          <span>
            {flows.length ? "Ce qui n'a pas été absorbé retombe sur l'" : "Destination par défaut : l'"}
            <b>Épargne</b> · {savingsYield || 0} %/an
          </span>
        </li>
      </ol>

      {available.length > 0 && (
        <select className="select rule-add" value="" onChange={(e) => add(e.target.value)}>
          <option value="">{flows.length ? "+ Ajouter une étape…" : "+ Affecter le surplus à un compte…"}</option>
          {available.map((x) => <option key={x.id} value={x.id}>{x.label || "Actif"}</option>)}
        </select>
      )}
    </section>
  );
}
