import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { projectionPath, viewFromSlug, type ProjectionViewId } from "../routes";
import type { PlannedEvent, ProjectionParams } from "../lib/types";
import { eventYear, simInput } from "../lib/types";
import { project } from "../lib/projection";
import { canReceiveDeposits } from "../lib/types";
import { grossWealth, totalLiabilities } from "../lib/selectors";
import { uid } from "../lib/format";
import PageHeader from "../components/PageHeader";
import { IconChart } from "../components/icons";
import type { AppStateLike } from "./projection/eventHelpers";
import { emptyEvent } from "./projection/eventHelpers";
import ProjectionView from "./projection/ProjectionView";
import EventsView from "./projection/EventsView";
import CashflowView from "./projection/CashflowView";
import MonteCarloView from "./projection/MonteCarloView";
import EventModal from "./projection/EventModal";
import YearDetailModal from "./projection/YearDetailModal";

const HORIZONS = [10, 20, 30, 40];

type ViewId = ProjectionViewId;
const VIEWS: { id: ViewId; label: string }[] = [
  { id: "proj", label: "Projection" },
  { id: "events", label: "Événements" },
  { id: "cash", label: "Cash-flow" },
  { id: "mc", label: "Probabilité" },
];

/**
 * Page 04 — Projection. Orchestrateur : compose l'entrée du moteur (finances
 * courantes + plan actif), lance la projection une fois, gère l'état de navigation
 * (vue active, modales) et distribue les résultats aux 4 vues. Toute la logique de
 * rendu vit dans `./projection/*`.
 */
export default function ProjectionPage() {
  const { state, plan, update, updatePlan } = useStore();
  const p = plan.projection;
  // vue active portée par l'URL (`/projection/:vue`) : deep-link + refresh sans perte.
  const { vue } = useParams();
  const navigate = useNavigate();
  const view = viewFromSlug(vue);
  const setView = (v: ViewId) => navigate(projectionPath(v));
  const [chartMode, setChartMode] = useState<"net" | "composition" | "plans">("net");
  const [selYear, setSelYear] = useState<number | null>(null);
  const [evDraft, setEvDraft] = useState<PlannedEvent | null>(null);
  const setP = (patch: Partial<ProjectionParams>) =>
    updatePlan((pl) => ({ ...pl, projection: { ...pl.projection, ...patch } }));

  // finances courantes + couche du plan = entrée du moteur
  const projState = useMemo(() => simInput(state, plan), [state, plan]);

  const { points, events, warnings, fiYearIndex } = useMemo(
    () => project(projState, p),
    [projState, p]
  );

  // vue de référence pour eventSummary / listes d'actifs vendables… (plan actif)
  const like: AppStateLike = useMemo(() => ({
    assets: state.assets, liabilities: state.liabilities,
    events: plan.events, milestones: plan.milestones,
  }), [state.assets, state.liabilities, plan]);

  // mode Plans : une courbe par PLAN, chacun avec ses jalons/événements/hypothèses
  // (horizon et euros constants alignés sur le plan actif pour partager l'axe)
  const planSeries = useMemo(() => {
    if (view !== "proj" || chartMode !== "plans") return null;
    return state.plans.map((pl) => ({
      name: pl.name,
      points: project(simInput(state, pl), { ...pl.projection, horizon: p.horizon, realTerms: p.realTerms }).points,
    }));
  }, [view, chartMode, state, p.horizon, p.realTerms]);

  const hasData =
    grossWealth(state) > 0 || totalLiabilities(state) > 0 || state.incomes.length > 0 ||
    state.expenses.length > 0 || plan.events.length > 0;

  // --- événements du plan actif (CRUD) ---
  const saveEvent = (ev: PlannedEvent) => {
    updatePlan((pl) => {
      const exists = pl.events.some((x) => x.id === ev.id);
      return { ...pl, events: exists ? pl.events.map((x) => (x.id === ev.id ? ev : x)) : [...pl.events, ev] };
    });
    setEvDraft(null);
  };
  const delEvent = (id: string) => updatePlan((pl) => ({ ...pl, events: pl.events.filter((x) => x.id !== id) }));
  const toggleEvent = (id: string) =>
    updatePlan((pl) => ({ ...pl, events: pl.events.map((x) => (x.id === id ? { ...x, disabled: !x.disabled } : x)) }));
  const sortedEvents = [...plan.events].sort((a, b) => eventYear(a, plan.milestones) - eventYear(b, plan.milestones));
  const editEvent = (id: string) => {
    const ev = plan.events.find((x) => x.id === id);
    if (ev) setEvDraft({ ...ev });
  };

  // --- gestion du plan actif : duplication (jalons copiés, mêmes ids) & suppression ---
  const duplicatePlan = () =>
    update((s) => {
      const copy = { ...structuredClone(plan), id: uid(), name: `${plan.name} (copie)` };
      return { ...s, plans: [...s.plans, copy], activePlanId: copy.id };
    });
  const deletePlan = () => {
    if (state.plans.length <= 1) return;
    if (!window.confirm(`Supprimer le plan « ${plan.name} » et toutes ses simulations ?`)) return;
    update((s) => {
      const plans = s.plans.filter((pl) => pl.id !== plan.id);
      return { ...s, plans, activePlanId: plans[0].id };
    });
  };

  const eligibleAssets = state.assets.filter(canReceiveDeposits);
  const selPoint = selYear !== null ? points.find((pt) => pt.year === selYear) ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="03 — Projection"
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
          {/* --------- plan actif : nom + gestion --------- */}
          <div className="plan-bar">
            <span className="eyebrow">Plan</span>
            <input
              className="input plan-name"
              value={plan.name}
              onChange={(e) => updatePlan({ name: e.target.value })}
              aria-label="Nom du plan"
            />
            <button className="btn btn-ghost" onClick={duplicatePlan}>Dupliquer</button>
            {state.plans.length > 1 && (
              <button className="btn btn-ghost" style={{ color: "var(--drain)" }} onClick={deletePlan}>Supprimer</button>
            )}
            <span className="spacer" />
            <div className="segment view-tabs">
              {VIEWS.map((v) => (
                <button key={v.id} data-on={view === v.id} onClick={() => setView(v.id)}>
                  {v.label}
                  {v.id === "events" && plan.events.length > 0 && <span className="view-count">{plan.events.length}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* --------- alertes moteur (épargne négative, jalon supprimé…) --------- */}
          {warnings.slice(0, 3).map((w, i) => (
            <div key={i} className="fi-banner" style={{ borderColor: "rgba(213,152,115,0.4)", background: "rgba(213,152,115,0.07)" }}>
              <span className="fi-dot" style={{ background: "var(--drain)", boxShadow: "0 0 10px var(--drain)" }} />
              {w.label}
            </div>
          ))}

          {view === "proj" && (
            <ProjectionView
              p={p}
              setP={setP}
              points={points}
              events={events}
              fiYearIndex={fiYearIndex}
              chartMode={chartMode}
              setChartMode={setChartMode}
              planSeries={planSeries}
              plansCount={state.plans.length}
              milestones={plan.milestones}
              eligibleAssets={eligibleAssets}
              onEditEvent={editEvent}
              onSelectYear={setSelYear}
            />
          )}

          {view === "events" && (
            <EventsView
              milestones={plan.milestones}
              birthYear={state.profile.birthDate ? new Date(state.profile.birthDate).getFullYear() : null}
              onMilestonesChange={(ms) => updatePlan({ milestones: ms })}
              events={sortedEvents}
              like={like}
              onNew={() => setEvDraft(emptyEvent(points[points.length - 1].year))}
              onEdit={(ev) => setEvDraft({ ...ev })}
              onDelete={delEvent}
              onToggle={toggleEvent}
            />
          )}

          {view === "cash" && <CashflowView points={points} realTerms={p.realTerms} />}

          {view === "mc" && (
            <MonteCarloView projState={projState} params={p} detPoints={points} eligibleAssets={eligibleAssets} />
          )}
        </>
      )}

      {selPoint && (
        <YearDetailModal point={selPoint} real={p.realTerms} onClose={() => setSelYear(null)} />
      )}
      {evDraft && (
        <EventModal draft={evDraft} s={like} onChange={setEvDraft} onSave={saveEvent} onClose={() => setEvDraft(null)} />
      )}
    </>
  );
}
