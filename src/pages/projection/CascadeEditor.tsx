import type { Asset } from "../../lib/types";
import { money, percent } from "../../lib/format";

/**
 * Éditeur de cascade ordonnée d'actifs. Deux usages symétriques :
 * - surplus : chaque cible reçoit jusqu'à son plafond, le reste va à l'épargne ;
 * - retrait : chaque source est vidée à son tour pour combler un déficit.
 *
 * Même grammaire visuelle que `SurplusFlowEditor` (étapes numérotées + terminal
 * explicite) : les deux règles se lisent comme un seul pipeline de trésorerie.
 */
export default function CascadeEditor({ mode, eligible, ids, onChange }: {
  mode: "surplus" | "withdraw";
  eligible: Asset[];
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const targets = ids
    .map((id) => eligible.find((a) => a.id === id))
    .filter((a, i, arr) => a && arr.indexOf(a) === i) as Asset[];
  const targetIds = targets.map((a) => a.id);
  const available = eligible.filter((a) => !targetIds.includes(a.id));
  const withdraw = mode === "withdraw";

  const hint = (a: Asset) => {
    if (withdraw) return `${money(a.value)} disponibles aujourd'hui`;
    const capLeft = a.depositCap != null ? Math.max(0, a.depositCap - (a.depositsMade || 0)) : null;
    return capLeft != null ? `reste ${money(capLeft)} à verser` : null;
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= targetIds.length) return;
    const next = [...targetIds];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <section className="rule-block">
      <div className="rule-head">
        <h3 className="rule-title">{withdraw ? "Retraits en cas de déficit" : "Affectation du surplus"}</h3>
        <p className="rule-lede">
          {withdraw
            ? <>Quand un mois coûte plus qu'il ne rapporte, le manque est prélevé ici, <b>dans l'ordre</b> : chaque compte est vidé avant de passer au suivant.</>
            : <>Le surplus est versé ici, <b>dans l'ordre</b>, jusqu'au plafond de chaque compte.</>}
        </p>
      </div>

      <ol className="rule-steps">
        {targets.map((a, i) => {
          const h = hint(a);
          const options = eligible.filter((x) => x.id === a.id || !targetIds.includes(x.id));
          return (
            <li className="rule-step is-compact" key={a.id}>
              <span className="step-n mono">{i + 1}</span>
              <div className="step-body">
                <div className="step-top">
                  <select
                    className="select step-asset"
                    value={a.id}
                    onChange={(e) => onChange(targetIds.map((id, k) => (k === i ? e.target.value : id)))}
                  >
                    {options.map((x) => (
                      <option key={x.id} value={x.id}>{x.label || "Actif"} · {percent(x.growthRate)}/an</option>
                    ))}
                  </select>
                  {h && <span className="step-hint">{h}</span>}
                  <div className="step-move">
                    <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter la priorité">↑</button>
                    <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === targets.length - 1} aria-label="Descendre la priorité">↓</button>
                    <button className="icon-btn danger" onClick={() => onChange(targetIds.filter((_, k) => k !== i))} aria-label="Retirer de la cascade">×</button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}

        {targets.length === 0 && withdraw && (
          <li className="rule-empty is-warn">
            Aucune source : un mois déficitaire fait <b>passer l'Épargne en négatif</b> — découvert signalé,
            et tirage compté en échec dans la Probabilité de succès.
          </li>
        )}

        <li className="rule-term">
          <span className="step-n mono">↳</span>
          <span>
            {withdraw
              ? <>Tout épuisé : l'<b>Épargne</b> part en découvert (alerte)</>
              : <>Le reliquat retombe sur l'<b>Épargne</b></>}
          </span>
        </li>
      </ol>

      {available.length > 0 && (
        <select
          className="select rule-add"
          value=""
          onChange={(e) => e.target.value && onChange([...targetIds, e.target.value])}
        >
          <option value="">
            {targets.length ? "+ Ajouter une source…" : withdraw ? "+ Où puiser en cas de déficit…" : "+ Ajouter un compte…"}
          </option>
          {available.map((x) => (
            <option key={x.id} value={x.id}>{x.label || "Actif"} · {percent(x.growthRate)}/an</option>
          ))}
        </select>
      )}
    </section>
  );
}
