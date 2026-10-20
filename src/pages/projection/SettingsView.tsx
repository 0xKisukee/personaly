import { m } from "motion/react";
import type { Asset, ProjectionParams } from "../../lib/types";
import CascadeEditor from "./CascadeEditor";
import SurplusFlowEditor from "./SurplusFlowEditor";

/**
 * Vue Réglages : toutes les HYPOTHÈSES du plan (rendement, inflation, indexation)
 * et les RÈGLES d'affectation de trésorerie (flows du surplus, retraits
 * en déficit). Isolée de la Projection pour la garder épurée — les nouveaux
 * utilisateurs voient d'abord la courbe, et viennent ici pour affiner.
 *
 * Deux blocs distincts : les hypothèses (des nombres) et les règles de trésorerie
 * (ce que le moteur FAIT du cash chaque mois) — cette seconde partie se lit comme
 * un pipeline : surplus → comptes, déficit → sources.
 */
export default function SettingsView({ p, setP, eligibleAssets }: {
  p: ProjectionParams;
  setP: (patch: Partial<ProjectionParams>) => void;
  eligibleAssets: Asset[];
}) {
  return (
    <m.div
      className="settings-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="assum">
        <div className="field assum-num">
          <label>Rendement épargne réinvestie</label>
          <div className="assum-input">
            <input className="input mono" type="number" step="0.1" value={p.savingsYield || ""} placeholder="0"
              onChange={(e) => setP({ savingsYield: Number(e.target.value) })} />
            <span className="assum-unit">%/an</span>
          </div>
          <span className="help">Taux servi sur le solde d'épargne non investi, capitalisé chaque mois.</span>
        </div>
        <div className="field assum-num">
          <label>Inflation</label>
          <div className="assum-input">
            <input className="input mono" type="number" step="0.1" value={p.inflation || ""} placeholder="0"
              onChange={(e) => setP({ inflation: Number(e.target.value) })} />
            <span className="assum-unit">%/an</span>
          </div>
          <span className="help">Sert à indexer les flux et à convertir en euros constants.</span>
        </div>
        <div className="assum-toggles" title="Réglages communs à tous les plans">
          <span className="eyebrow assum-toggles-note">Communs à tous les plans</span>
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
      </div>

      <div className="eyebrow rules-eyebrow">Règles de trésorerie · appliquées chaque mois</div>
      <div className="rules-grid">
        {/* affectation du surplus : flows ordonnés (maximiser / % / montant + solde cible) */}
        <SurplusFlowEditor
          eligible={eligibleAssets}
          flows={p.surplusTargets ?? []}
          onChange={(flows) => setP({ surplusTargets: flows.length ? flows : undefined })}
          savingsYield={p.savingsYield}
        />
        {/* cascade de retrait (miroir) : où puiser quand le mois est déficitaire */}
        <CascadeEditor
          mode="withdraw"
          eligible={eligibleAssets}
          ids={p.withdrawalTargets ?? []}
          onChange={(ids) => setP({ withdrawalTargets: ids.length ? ids : undefined })}
        />
      </div>
    </m.div>
  );
}
