import { Fragment } from "react";
import type { Asset } from "../../lib/types";
import { money, percent } from "../../lib/format";

/**
 * Éditeur de cascade ordonnée d'actifs. Deux usages symétriques :
 * - surplus : chaque cible reçoit jusqu'à son plafond, le reste va à l'épargne ;
 * - retrait : chaque source est vidée à son tour pour combler un déficit.
 */
export default function CascadeEditor({ mode, label, eligible, ids, onChange }: {
  mode: "surplus" | "withdraw";
  label: string;
  eligible: Asset[];
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const targets = ids
    .map((id) => eligible.find((a) => a.id === id))
    .filter((a, i, arr) => a && arr.indexOf(a) === i) as Asset[];
  const targetIds = targets.map((a) => a.id);
  const available = eligible.filter((a) => !targetIds.includes(a.id));

  const hint = (a: Asset) => {
    if (mode === "withdraw") return `${money(a.value)} disponibles`;
    const capLeft = a.depositCap != null ? Math.max(0, a.depositCap - (a.depositsMade || 0)) : null;
    return capLeft != null ? `reste ${money(capLeft)} à verser` : null;
  };

  return (
    <div className="field assum-surplus">
      <label>{label}</label>
      <div className="assum-cascade">
        {targets.map((a, i) => {
          const h = hint(a);
          const options = eligible.filter((x) => x.id === a.id || !targetIds.includes(x.id));
          return (
            <Fragment key={a.id}>
              {i > 0 && <span className="assum-unit">→</span>}
              <span className="cascade-item">
                <select
                  className="select"
                  value={a.id}
                  onChange={(e) => onChange(targetIds.map((id, k) => (k === i ? e.target.value : id)))}
                >
                  {options.map((x) => (
                    <option key={x.id} value={x.id}>{x.label || "Actif"} · {percent(x.growthRate)}/an</option>
                  ))}
                </select>
                <button
                  className="icon-btn"
                  onClick={() => onChange(targetIds.filter((_, k) => k !== i))}
                  aria-label="Retirer de la cascade"
                >×</button>
                {h && <span className="help">{h}</span>}
              </span>
            </Fragment>
          );
        })}
        {available.length > 0 && (
          <>
            {targets.length > 0 && <span className="assum-unit">→</span>}
            <select
              className="select cascade-add"
              value=""
              onChange={(e) => e.target.value && onChange([...targetIds, e.target.value])}
            >
              <option value="">
                {targets.length
                  ? "+ Ajouter…"
                  : mode === "surplus" ? "Épargne (défaut)" : "Aucun retrait (défaut)"}
              </option>
              {available.map((x) => (
                <option key={x.id} value={x.id}>{x.label || "Actif"} · {percent(x.growthRate)}/an</option>
              ))}
            </select>
          </>
        )}
        {targets.length > 0 && (
          <span className="assum-unit">{mode === "surplus" ? "→ Épargne" : "→ Épargne (découvert)"}</span>
        )}
      </div>
    </div>
  );
}
