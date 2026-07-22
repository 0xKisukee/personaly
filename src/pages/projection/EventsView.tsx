import type { Milestone, PlannedEvent } from "../../lib/types";
import { whenLabel } from "../../lib/format";
import MilestonesEditor from "../../components/MilestonesEditor";
import { IconEdit, IconPlus, IconTrash } from "../../components/icons";
import { type AppStateLike, eventSummary, recurrenceSummary } from "./eventHelpers";

/** Vue Jalons & Événements : jalons GLOBAUX + jalons du plan + liste des événements. */
export default function EventsView({
  globalMilestones, planMilestones, onGlobalChange, onPlanChange,
  milestones, birthYear,
  events, like, onNew, onEdit, onDelete, onToggle,
}: {
  globalMilestones: Milestone[]; // source de vérité, tous les plans
  planMilestones: Milestone[]; // propres à ce plan (supplément)
  onGlobalChange: (ms: Milestone[]) => void;
  onPlanChange: (ms: Milestone[]) => void;
  milestones: Milestone[]; // combiné (global ∪ plan) — pour l'ancrage des événements
  birthYear: number | null;
  events: PlannedEvent[]; // déjà triés par année effective
  like: AppStateLike;
  onNew: () => void;
  onEdit: (ev: PlannedEvent) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <section className="section" style={{ marginTop: 0 }}>
      <MilestonesEditor
        title="Jalons communs (tous les plans)"
        milestones={globalMilestones}
        birthYear={birthYear}
        onChange={onGlobalChange}
        hint={<>Le <b>calendrier de vie</b> partagé par tous les plans (Retraite, Achat maison…) — c'est la source
          de vérité sur laquelle s'ancrent les <b>flux</b>.</>}
      />
      <div className="divider" style={{ margin: "24px 0" }} />
      <MilestonesEditor
        title="Jalons propres à ce plan"
        milestones={planMilestones}
        birthYear={birthYear}
        onChange={onPlanChange}
        hint={<>Des jalons <b>en supplément</b>, valables uniquement dans ce plan (pour ancrer des événements de
          scénario). Ils s'ajoutent aux jalons communs.</>}
      />
      <div className="divider" style={{ margin: "28px 0" }} />
      <div className="section-head">
        <h2>Événements</h2>
        <span className="count">{events.length}</span>
        <span className="spacer" />
        <button className="btn btn-brass" onClick={onNew}>
          <IconPlus size={16} /> Ajouter
        </button>
      </div>

      {events.length === 0 ? (
        <div className="empty">
          <span style={{ fontFamily: "var(--font-mono)" }}>⚑</span>
          <div>
            Aucun événement planifié.<br />
            Achat immobilier, héritage, vente, remboursement anticipé… datés à l'année ou ancrés sur un jalon.
          </div>
        </div>
      ) : (
        <div className="rows">
          {events.map((ev) => (
            <div className="row row-ev" key={ev.id} data-off={ev.disabled || undefined}>
              <label className="ev-check" title={ev.disabled ? "Réactiver dans la projection" : "Exclure de la projection"}>
                <input type="checkbox" checked={!ev.disabled} onChange={() => onToggle(ev.id)} />
              </label>
              <div className="row-ic" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{"⚑"}</div>
              <div className="row-main">
                <div className="row-title">{ev.label || "Événement"}</div>
                <div className="row-meta">
                  <span className="tag" style={ev.when ? { borderColor: "var(--line-brass)", color: "var(--brass-bright)" } : undefined}>
                    {ev.when && "◇ "}{whenLabel(ev.year, ev.when, milestones)}
                  </span>
                  {" · "}<span>{eventSummary(ev, like)}</span>
                  {ev.recurrence && (
                    <span className="tag" style={{ borderColor: "var(--line-brass)", color: "var(--brass-bright)" }}>
                      {recurrenceSummary(ev.recurrence, milestones)}
                    </span>
                  )}
                  {ev.disabled && <span className="tag" style={{ color: "var(--drain)" }}>désactivé</span>}
                </div>
              </div>
              <div className="row-actions">
                <button className="icon-btn" onClick={() => onEdit(ev)} aria-label="Modifier"><IconEdit size={16} /></button>
                <button className="icon-btn danger" onClick={() => onDelete(ev.id)} aria-label="Supprimer"><IconTrash size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="help" style={{ marginTop: 14 }}>
        Les événements sont <b>atomiques et composables</b> : un achat financé = un événement <b>Emprunt</b> +
        un événement <b>Achat</b> la même année. Pour un « et si » : décoche un événement, ou <b>duplique le
        plan</b> et compare les trajectoires avec le mode <b>Plans</b> du graphe.
      </p>
    </section>
  );
}
