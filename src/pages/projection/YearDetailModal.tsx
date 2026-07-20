import { useState } from "react";
import type { YearDetail, YearPoint } from "../../lib/projection";
import { money, signedMoney } from "../../lib/format";
import Modal from "../../components/Modal";
import { IconChevron } from "../../components/icons";

/**
 * Détail d'une année : patrimoine (début d'année) + décomposition des flux, chaque
 * agrégat dépliable en sous-lignes. Vérifie l'identité « début + enrichissement =
 * début suivant » (affichée en euros courants).
 */
export default function YearDetailModal({ point, real, onClose }: { point: YearPoint; real: boolean; onClose: () => void }) {
  const d: YearDetail = point.detail;
  const suffix = real ? " · € constants" : "";
  const enrichment = point.distributed + point.extra + point.savingsYield + point.growth
    + point.eventCash + point.eventGain
    - point.expenses - point.charges - point.interest - point.insurance - point.eventFees;
  return (
    <Modal open title={`Composition ${point.year}`} subtitle={`Patrimoine net ${money(point.netWorth)}${point.age !== null ? ` · ${point.age} ans` : ""}${suffix}`} onClose={onClose}>
      <div className="yd-grid">
        <div>
          <div className="yd-head"><span className="dot brass" /> Patrimoine (début d'année)</div>
          {d.assets.filter((a) => a.value > 0.005).map((a) => (
            <div className="yd-row" key={a.id}>
              <span className="yd-label">{a.label}</span>
              <span className="mono">{money(a.value)}</span>
            </div>
          ))}
          {d.loans.filter((l) => l.balance > 0.005).map((l) => (
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
          {point.distributed > 0 && (
            <YdGroup label="Revenus distribués" v={point.distributed} pos
              subs={d.assets.filter((a) => a.income > 0).map((a) => ({ id: a.id, label: a.label, v: a.income }))} />
          )}
          {point.extra > 0 && (
            <YdGroup label="Revenus complémentaires" v={point.extra} pos
              subs={d.incomes.map((f) => ({ id: f.id, label: f.label, v: f.amount }))} />
          )}
          {point.savingsYield !== 0 && <YdFlow label="Rendement épargne" v={point.savingsYield} pos />}
          {point.growth !== 0 && (
            <YdGroup label="Plus-value latente" v={point.growth} pos={point.growth >= 0}
              subs={d.assets.filter((a) => a.growth !== 0).map((a) => ({ id: a.id, label: a.label, v: a.growth }))} />
          )}
          {point.expenses > 0 && (
            <YdGroup label="Dépenses & impôts" v={-point.expenses}
              subs={d.expenses.map((f) => ({ id: f.id, label: f.label, v: -f.amount }))} />
          )}
          {point.charges > 0 && (
            <YdGroup label="Charges d'actifs" v={-point.charges}
              subs={d.assets.filter((a) => a.charges > 0).map((a) => ({ id: a.id, label: a.label, v: -a.charges }))} />
          )}
          {point.interest > 0 && (
            <YdGroup label="Intérêts d'emprunt" v={-point.interest}
              subs={d.loans.filter((l) => l.interest > 0).map((l) => ({ id: l.id, label: l.label, v: -l.interest }))} />
          )}
          {point.insurance > 0 && (
            <YdGroup label="Assurance emprunt" v={-point.insurance}
              subs={d.loans.filter((l) => l.insurance > 0).map((l) => ({ id: l.id, label: l.label, v: -l.insurance }))} />
          )}
          {point.principal > 0 && (
            <YdGroup label="Capital remboursé (neutre)" v={-point.principal} neutral
              subs={d.loans.filter((l) => l.principal > 0).map((l) => ({ id: l.id, label: l.label, v: -l.principal }))} />
          )}
          {point.deposited > 0 && (
            <YdGroup label="Versé dans les actifs (transfert neutre)" v={point.deposited} neutral
              subs={d.assets.filter((a) => a.deposit > 0).map((a) => ({ id: a.id, label: a.label, v: a.deposit }))} />
          )}
          {point.withdrawn > 0 && (
            <YdGroup label="Retiré des actifs (transfert neutre)" v={-point.withdrawn} neutral
              subs={d.assets.filter((a) => a.withdrawal > 0).map((a) => ({ id: a.id, label: a.label, v: -a.withdrawal }))} />
          )}
          {point.eventCash !== 0 && (
            <YdGroup label="Rentrées / sorties ponctuelles" v={point.eventCash} pos={point.eventCash >= 0}
              subs={d.events.filter((e) => e.kind === "cash").map((e) => ({ id: e.id, label: `⚑ ${e.label}`, v: e.cash }))} />
          )}
          {point.eventGain !== 0 && <YdFlow label="Plus/moins-value réalisée" v={point.eventGain} pos={point.eventGain >= 0} />}
          {point.eventFees > 0 && <YdFlow label="Frais d'événements" v={-point.eventFees} />}
          {d.events.filter((e) => e.kind !== "cash").map((e) => (
            <YdFlow key={e.id} label={`⚑ ${e.label} (cash)`} v={e.cash} neutral sub />
          ))}
          <div className="yd-row yd-total">
            <span>Enrichissement</span>
            <span className="mono" style={{ color: "var(--brass-bright)" }}>{signedMoney(enrichment)}</span>
          </div>
          {/* pont entre les deux colonnes : début d'année + enrichissement = début d'année suivante
              (masqué en euros constants : le déflateur diffère d'une année à l'autre) */}
          {!real && (
            <div className="yd-row" style={{ opacity: 0.8 }}>
              <span className="yd-label">→ Patrimoine net début {point.year + 1}</span>
              <span className="mono" style={{ color: "var(--ink-soft)" }}>{money(point.netWorth + enrichment)}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function YdFlow({ label, v, pos, neutral, sub }: { label: string; v: number; pos?: boolean; neutral?: boolean; sub?: boolean }) {
  const color = neutral ? "var(--ink-mute)" : pos ? "var(--gain)" : "var(--drain)";
  return (
    <div className="yd-row" style={sub ? { paddingLeft: 22, opacity: 0.75 } : undefined}>
      {/* les lignes de 1er niveau réservent la place du chevron : tous les libellés s'alignent */}
      <span className="yd-label">{!sub && <span className="yd-chev yd-chev-ghost" />}{label}</span>
      <span className="mono" style={{ color }}>{signedMoney(v)}</span>
    </div>
  );
}

/** Ligne agrégée dépliable : clic → détail des composantes (par actif, par emprunt…). */
function YdGroup({ label, v, pos, neutral, subs }: {
  label: string; v: number; pos?: boolean; neutral?: boolean;
  subs: { id: string; label: string; v: number }[];
}) {
  const [open, setOpen] = useState(false);
  const has = subs.length > 0;
  const color = neutral ? "var(--ink-mute)" : pos ? "var(--gain)" : "var(--drain)";
  if (!has) return <YdFlow label={label} v={v} pos={pos} neutral={neutral} />;
  return (
    <>
      <div className="yd-row yd-toggle" role="button" tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(!open)}>
        <span className="yd-label">
          <span className="yd-chev" data-open={open || undefined}><IconChevron size={12} /></span>
          {label}
        </span>
        <span className="mono" style={{ color }}>{signedMoney(v)}</span>
      </div>
      {open && subs.map((s) => (
        <YdFlow key={s.id} label={s.label} v={s.v} pos={neutral ? undefined : s.v >= 0} neutral={neutral} sub />
      ))}
    </>
  );
}
