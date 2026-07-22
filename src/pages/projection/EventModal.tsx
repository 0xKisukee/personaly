import type { AssetCategory, PlannedEvent } from "../../lib/types";
import { eventYear } from "../../lib/types";
import { ASSET_CATEGORIES, assetLabel } from "../../lib/assets";
import Modal from "../../components/Modal";
import WhenPicker from "../../components/WhenPicker";
import {
  type AppStateLike, EVENT_KINDS, switchKind, RECURRABLE, DEFAULT_RECURRENCE,
  sellableAssets, repayableLoans, depositableAssets,
} from "./eventHelpers";

/** Modale de création / édition d'un événement daté (les 6 types + flux récurrent). */
export default function EventModal({ draft, s, onChange, onSave, onClose }: {
  draft: PlannedEvent;
  s: AppStateLike;
  onChange: (e: PlannedEvent) => void;
  onSave: (e: PlannedEvent) => void;
  onClose: () => void;
}) {
  const set = (patch: object) => onChange({ ...draft, ...patch } as PlannedEvent);
  const currentYear = new Date().getFullYear();
  const effYear = eventYear(draft, s.milestones);

  const valid =
    draft.label.trim().length > 0 &&
    Number.isFinite(effYear) && effYear >= currentYear &&
    (draft.kind === "flow" ? draft.amount > 0
      : draft.kind === "cash" ? draft.amount !== 0
      : draft.kind === "buy" ? draft.price > 0
      : draft.kind === "sell" ? !!draft.assetId
      : draft.kind === "loan" ? draft.amount > 0 && draft.termMonths > 0
      : draft.kind === "deposit" ? !!draft.assetId && draft.amount > 0
      : !!draft.loanId);

  // à l'enregistrement d'un achat : l'actif embarqué suit TOUJOURS le libellé de
  // l'événement (pas de champ séparé dans la modale — un renommage doit se propager
  // partout : colonne patrimoine, sous-lignes de flux, liste de vente…)
  const handleSave = () =>
    onSave(draft.kind === "buy" ? { ...draft, asset: { ...draft.asset, label: draft.label } } : draft);

  return (
    <Modal
      open
      title={s.events.some((x) => x.id === draft.id) ? "Modifier l'événement" : "Nouvel événement"}
      subtitle="Appliqué en début d'année. Les événements sont atomiques : un achat financé = un emprunt + un achat la même année."
      onClose={onClose}
    >
      <div className="form-grid">
        <div className="field span-2">
          <label>Type</label>
          <div className="segment seg-wrap">
            {EVENT_KINDS.map((k) => (
              <button key={k.id} data-on={draft.kind === k.id} onClick={() => onChange(switchKind(draft, k.id, s))}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field span-2">
          <label>Libellé</label>
          <input className="input" autoFocus placeholder="ex. Achat apt Lyon, Héritage…"
            value={draft.label} onChange={(e) => set({ label: e.target.value })} />
        </div>
        <div className="field span-2">
          <label>{draft.kind === "flow" ? "Début" : "Quand"}</label>
          <WhenPicker
            milestones={s.milestones}
            minYear={currentYear}
            value={{ year: draft.year || undefined, ref: draft.when }}
            onChange={(v) => set({ year: v.year ?? 0, when: v.ref })}
          />
        </div>

        {draft.kind === "flow" && (
          <>
            <div className="field">
              <label>Sens</label>
              <div className="segment">
                <button data-on={draft.direction === "in"} onClick={() => set({ direction: "in" })}>Entrant</button>
                <button data-on={draft.direction === "out"} onClick={() => set({ direction: "out" })}>Sortant</button>
              </div>
            </div>
            <div className="field">
              <label>Périodicité</label>
              <div className="segment">
                <button data-on={draft.period === "monthly"} onClick={() => set({ period: "monthly" })}>Mensuel</button>
                <button data-on={draft.period === "yearly"} onClick={() => set({ period: "yearly" })}>Annuel</button>
              </div>
            </div>
            <div className="field">
              <label>Montant (€) {draft.period === "monthly" ? "/ mois" : "/ an"}</label>
              <input className="input mono" type="number" placeholder="ex. 800"
                value={draft.amount || ""} onChange={(e) => set({ amount: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Revalorisation (%/an)</label>
              <input className="input mono" type="number" step="0.1" placeholder="vide = inflation"
                value={draft.growth ?? ""}
                onChange={(e) => set({ growth: e.target.value !== "" ? Number(e.target.value) : undefined })} />
            </div>
            <div className="field span-2">
              <label>Fin</label>
              <WhenPicker
                milestones={s.milestones}
                allowEmpty
                emptyLabel="Sans fin (jusqu'à l'horizon)"
                value={{ year: draft.endYear, ref: draft.endRef }}
                onChange={(v) => set({ endYear: v.year, endRef: v.ref })}
              />
            </div>
            <span className="help span-2">
              Flux <b>récurrent</b> propre à ce plan (comme un revenu/dépense de la page Flux, mais lié à une
              simulation). Ex. « conjoint à charge : −800 €/mois à partir du <b>Mariage</b> ». Ancre le début et la
              fin sur un <b>jalon</b> pour qu'ils suivent tes hypothèses. Revalorisation vide = suit l'inflation.
            </span>
          </>
        )}

        {draft.kind === "cash" && (
          <>
            <div className="field">
              <label>Sens</label>
              <div className="segment">
                <button data-on={draft.amount >= 0} onClick={() => set({ amount: Math.abs(draft.amount) })}>Rentrée</button>
                <button data-on={draft.amount < 0} onClick={() => set({ amount: -Math.abs(draft.amount || 0) })}>Sortie</button>
              </div>
            </div>
            <div className="field">
              <label>Montant (€)</label>
              <input className="input mono" type="number" placeholder="ex. 20 000"
                value={Math.abs(draft.amount) || ""}
                onChange={(e) => set({ amount: (draft.amount < 0 ? -1 : 1) * Math.abs(Number(e.target.value)) })} />
            </div>
            <span className="help span-2">Héritage, prime, vente ponctuelle… ou travaux, mariage. Arrive / part de l'épargne.</span>
          </>
        )}

        {draft.kind === "buy" && (
          <>
            <div className="field">
              <label>Prix d'achat (€)</label>
              <input className="input mono" type="number" value={draft.price || ""}
                onChange={(e) => set({ price: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Frais (notaire…) (€)</label>
              <input className="input mono" type="number" placeholder="sortie sèche" value={draft.fees || ""}
                onChange={(e) => set({ fees: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <div className="field">
              <label>Catégorie de l'actif</label>
              <select className="select" value={draft.asset.category}
                onChange={(e) => set({ asset: { ...draft.asset, category: e.target.value as AssetCategory } })}>
                {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{assetLabel(c)}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Évolution de la valeur (%/an)</label>
              <input className="input mono" type="number" step="0.1" placeholder="ex. +2 immo"
                value={draft.asset.growthRate || ""}
                onChange={(e) => set({ asset: { ...draft.asset, growthRate: Number(e.target.value) } })} />
            </div>
            <div className="field">
              <label>Revenu distribué (€/mois)</label>
              <input className="input mono" type="number" placeholder="ex. loyer perçu, 0 = aucun"
                value={draft.asset.income?.amount || ""}
                onChange={(e) => {
                  const amount = Number(e.target.value);
                  set({ asset: { ...draft.asset, incomeMode: amount > 0 ? "amount" : "none", income: { amount, period: "monthly" } } });
                }} />
            </div>
            <div className="field">
              <label>Charges (€/an)</label>
              <input className="input mono" type="number" placeholder="taxe foncière, copro…"
                value={draft.asset.charges?.amount || ""}
                onChange={(e) => set({ asset: { ...draft.asset, charges: { amount: Number(e.target.value), period: "yearly" } } })} />
            </div>
            <span className="help span-2">
              Payé <b>cash</b> (prix + frais sortent de l'épargne). Pour un achat financé, ajoute un événement
              <b> Emprunt</b> la même année : le capital arrive en épargne et couvre le prix — la différence est ton apport.
            </span>
          </>
        )}

        {draft.kind === "sell" && (
          <>
            <div className="field">
              <label>Actif vendu</label>
              <select className="select" value={draft.assetId} onChange={(e) => set({ assetId: e.target.value })}>
                {sellableAssets(s).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Prix de vente (€) — optionnel</label>
              <input className="input mono" type="number" placeholder="vide = valeur projetée"
                value={draft.price ?? ""}
                onChange={(e) => set({ price: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <div className="field">
              <label>Frais de vente (%)</label>
              <input className="input mono" type="number" step="0.1" placeholder="ex. 5 (agence)"
                value={draft.feesPct || ""}
                onChange={(e) => set({ feesPct: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <span className="help span-2">
              Le produit net arrive en <b>épargne</b>. Si un emprunt reste attaché au bien, ajoute un événement
              <b> Remboursement</b> la même année. Prix fixé ≠ valeur projetée → plus/moins-value réalisée.
            </span>
          </>
        )}

        {draft.kind === "loan" && (
          <>
            <div className="field">
              <label>Capital emprunté (€)</label>
              <input className="input mono" type="number" value={draft.amount || ""}
                onChange={(e) => set({ amount: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Taux annuel (%)</label>
              <input className="input mono" type="number" step="0.01" placeholder="ex. 3.4"
                value={draft.rate || ""} onChange={(e) => set({ rate: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Durée (années)</label>
              <input className="input mono" type="number" step="0.5"
                value={draft.termMonths ? draft.termMonths / 12 : ""}
                onChange={(e) => set({ termMonths: Math.round(Number(e.target.value) * 12) })} />
            </div>
            <div className="field">
              <label>Assurance (€/mois) — optionnel</label>
              <input className="input mono" type="number" value={draft.insurance || ""}
                onChange={(e) => set({ insurance: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <span className="help span-2">
              Le capital arrive en <b>épargne</b> à la date ; la mensualité se calcule seule et l'emprunt
              s'amortit jusqu'à son terme{draft.termMonths && Number.isFinite(effYear) ? ` (fin ${effYear + Math.round(draft.termMonths / 12)})` : ""}.
            </span>
          </>
        )}

        {draft.kind === "deposit" && (
          <>
            <div className="field">
              <label>Actif destinataire</label>
              <select className="select" value={draft.assetId} onChange={(e) => set({ assetId: e.target.value })}>
                {depositableAssets(s).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Montant (€)</label>
              <input className="input mono" type="number" placeholder="ex. 10 000"
                value={draft.amount || ""} onChange={(e) => set({ amount: Number(e.target.value) })} />
            </div>
            <span className="help span-2">
              Transfert <b>neutre</b> de l'épargne vers l'actif à la date (il compose ensuite au taux de l'actif).
              Le <b>plafond de versements</b> est respecté — la capacité est partagée avec la cascade du surplus.
              Seuls les comptes, livrets et placements sont éligibles.
            </span>
          </>
        )}

        {draft.kind === "repay" && (
          <>
            <div className="field">
              <label>Emprunt à rembourser</label>
              <select className="select" value={draft.loanId} onChange={(e) => set({ loanId: e.target.value })}>
                {repayableLoans(s).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Montant (€) — optionnel</label>
              <input className="input mono" type="number" placeholder="vide = solde total"
                value={draft.amount ?? ""}
                onChange={(e) => set({ amount: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
            <span className="help span-2">Prélevé sur l'épargne à la date ; neutre pour le patrimoine (la dette baisse d'autant).</span>
          </>
        )}

        <div className="divider span-2" style={{ margin: "4px 0" }} />
        <div className="field span-2">
          <label>Montant exprimé en</label>
          <div className="segment">
            <button data-on={!draft.nominal} onClick={() => set({ nominal: undefined })}>Euros constants (aujourd'hui)</button>
            <button data-on={!!draft.nominal} onClick={() => set({ nominal: true })}>
              {draft.kind === "flow" ? "Euros courants (au début)" : "Euros courants (à la date)"}
            </button>
          </div>
        </div>
        <span className="help span-2">
          {draft.kind === "flow" ? (
            <><b>Euros constants</b> : le montant est en pouvoir d'achat d'aujourd'hui ; la revalorisation compose
            depuis <b>aujourd'hui</b>, donc un flux qui démarre plus tard vaut déjà ce montant en euros réels à son
            début. <b>Euros courants</b> : le montant est nominal l'<b>année où le flux commence</b>, puis la
            revalorisation compose à partir de là (ex. « pension de 2 000 € nominaux en 2050 »). Sans effet si la
            revalorisation est à 0.</>
          ) : (
            <><b>Euros constants</b> : le montant est en pouvoir d'achat d'aujourd'hui — le moteur l'<b>indexe sur
            l'inflation</b> jusqu'à l'année de l'événement (150 k€ en 2050 = 150 k€ d'aujourd'hui, plus élevés
            nominalement). <b>Euros courants</b> : le montant est la valeur <b>nominale</b> telle quelle à la date.
            En affichage « euros constants », les deux se rejoignent.</>
          )}
        </span>

        {RECURRABLE.includes(draft.kind) && (
          <>
            <div className="divider span-2" style={{ margin: "4px 0" }} />
            <div className="field span-2">
              <label>Récurrence</label>
              <div className="segment">
                <button data-on={!draft.recurrence} onClick={() => set({ recurrence: undefined })}>Ponctuel</button>
                <button data-on={!!draft.recurrence} onClick={() => set({ recurrence: draft.recurrence ?? { ...DEFAULT_RECURRENCE } })}>Répéter</button>
              </div>
            </div>

            {draft.recurrence && (
              <>
                <div className="field">
                  <label>Intervalle (ans)</label>
                  <input className="input mono" type="number" min={1} step={1} placeholder="ex. 10"
                    value={draft.recurrence.everyYears || ""}
                    onChange={(e) => set({ recurrence: { ...draft.recurrence!, everyYears: Math.max(1, Math.round(Number(e.target.value))) } })} />
                </div>
                <div className="field">
                  <label>Ajustement réel (%/fois)</label>
                  <input className="input mono" type="number" step="0.1" placeholder="en plus de l'inflation"
                    value={draft.recurrence.scaling ?? ""}
                    onChange={(e) => set({ recurrence: { ...draft.recurrence!, scaling: e.target.value !== "" ? Number(e.target.value) : undefined } })} />
                </div>
                <div className="field span-2">
                  <label>Jusqu'à</label>
                  <WhenPicker
                    milestones={s.milestones}
                    allowEmpty
                    emptyLabel="Jusqu'à l'horizon"
                    value={{ year: draft.recurrence.untilYear, ref: draft.recurrence.untilRef }}
                    onChange={(v) => set({ recurrence: { ...draft.recurrence!, untilYear: v.year, untilRef: v.ref } })}
                  />
                </div>
                {draft.kind === "buy" && (
                  <div className="field span-2">
                    <label>Dernière instance</label>
                    <div className="segment">
                      <button data-on={draft.recurrence.keepLast !== false} onClick={() => set({ recurrence: { ...draft.recurrence!, keepLast: true } })}>Conserver</button>
                      <button data-on={draft.recurrence.keepLast === false} onClick={() => set({ recurrence: { ...draft.recurrence!, keepLast: false } })}>Revendre à terme</button>
                    </div>
                  </div>
                )}
                <span className="help span-2">
                  {draft.kind === "buy" ? (
                    <>Répète l'<b>achat</b> à intervalle régulier : à chaque échéance l'exemplaire précédent est
                    <b> revendu</b> (à sa valeur projetée, neutre) et un neuf acheté — idéal pour « changer de voiture
                    tous les 10 ans ». Pour un achat <b>à crédit</b> répété, ajoute un <b>Emprunt</b> récurrent de même
                    cadence. <b>Ajustement</b> = prix un peu plus élevé (ou bas) à chaque fois.</>
                  ) : draft.kind === "deposit" ? (
                    <>Répète ce <b>versement</b> vers l'actif à intervalle régulier (ex. 5 000 € sur le PEA chaque année).
                    Le <b>plafond de versements</b> reste respecté, instance après instance.
                    <b> Ajustement</b> = montant modulé à chaque fois.</>
                  ) : draft.kind === "loan" ? (
                    <>Répète ce <b>nouvel emprunt</b> à intervalle régulier (souvent couplé à un <b>Achat</b> récurrent de
                    même cadence pour financer chaque remplacement). <b>Ajustement</b> = capital modulé à chaque fois.</>
                  ) : (
                    <>Répète cette <b>rentrée / sortie</b> à intervalle régulier (ex. gros travaux tous les 15 ans).
                    <b> Ajustement</b> = montant modulé à chaque répétition.</>
                  )}{" "}L'<b>ajustement</b> est une réévaluation <b>réelle</b>, en plus de l'indexation choisie ci-dessus
                  (euros constants → chaque instance suit l'inflation). Ancre <b>Jusqu'à</b> sur un jalon (Retraite…) pour
                  arrêter au bon moment.
                </span>
              </>
            )}
          </>
        )}
      </div>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-brass" onClick={handleSave} disabled={!valid}>Enregistrer</button>
      </div>
    </Modal>
  );
}
