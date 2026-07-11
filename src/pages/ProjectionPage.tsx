import { Fragment, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import type { Asset, AssetCategory, Milestone, PlannedEvent, ProjectionParams, SimState } from "../lib/types";
import { canReceiveDeposits, eventYear, simInput } from "../lib/types";
import { project, type ProjectionEvent, type YearDetail, type YearPoint } from "../lib/projection";
import { runMonteCarlo, type MonteCarloBand } from "../lib/montecarlo";
import { grossWealth, totalLiabilities } from "../lib/selectors";
import { money, signedMoney, percent, uid, whenLabel } from "../lib/format";
import { formatDuration } from "../lib/finance";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import MilestonesEditor from "../components/MilestonesEditor";
import SankeyChart from "../components/SankeyChart";
import WhenPicker from "../components/WhenPicker";
import { IconChart, IconChevron, IconEdit, IconPlus, IconTrash } from "../components/icons";

const HORIZONS = [10, 20, 30, 40];

type ViewId = "proj" | "events" | "cash" | "mc";
const VIEWS: { id: ViewId; label: string }[] = [
  { id: "proj", label: "Projection" },
  { id: "events", label: "Événements" },
  { id: "cash", label: "Cash-flow" },
  { id: "mc", label: "Probabilité" },
];

/* ----------------------- ÉVÉNEMENTS : helpers ----------------------- */

const CAT_LABELS: Record<AssetCategory, string> = {
  immobilier: "Immobilier", compte_courant: "Compte courant", livret_epargne: "Livret d'épargne",
  placement: "Placement", vehicule: "Véhicule", autre: "Autre",
};

const emptyEvent = (year: number): PlannedEvent => ({
  id: uid(), kind: "cash", label: "", year: Math.min(new Date().getFullYear() + 1, year), amount: 0,
});

/** Bascule le type d'un brouillon en conservant id / libellé / date. */
function switchKind(ev: PlannedEvent, kind: PlannedEvent["kind"], s: AppStateLike): PlannedEvent {
  const base = { id: ev.id, label: ev.label, year: ev.year, when: ev.when };
  switch (kind) {
    case "flow": return { ...base, kind, direction: "out", amount: 0, period: "monthly" };
    case "cash": return { ...base, kind, amount: 0 };
    case "buy": return {
      ...base, kind, price: 0, fees: 0,
      asset: { id: uid(), label: "", category: "immobilier", value: 0, growthRate: 0, incomeMode: "none" },
    };
    case "sell": return { ...base, kind, assetId: sellableAssets(s)[0]?.id ?? "", feesPct: 0 };
    case "loan": return { ...base, kind, amount: 0, rate: 0, termMonths: 240 };
    case "repay": return { ...base, kind, loanId: repayableLoans(s)[0]?.id ?? "" };
    case "deposit": return { ...base, kind, assetId: depositableAssets(s)[0]?.id ?? "", amount: 0 };
  }
}

interface AppStateLike {
  assets: { id: string; label: string; category: AssetCategory }[];
  liabilities: { id: string; label: string }[];
  events: PlannedEvent[];
  milestones: Milestone[];
}

/** Actifs vendables : existants + créés par un événement "buy". */
function sellableAssets(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.assets.map((a) => ({ id: a.id, label: a.label || "Actif" })),
    ...s.events.filter((e) => e.kind === "buy").map((e) => ({ id: e.asset.id, label: `${e.label || "Achat"} (${eventYear(e, s.milestones)})` })),
  ];
}

/** Emprunts remboursables : passifs existants + créés par un événement "loan". */
function repayableLoans(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.liabilities.map((l) => ({ id: l.id, label: l.label || "Emprunt" })),
    ...s.events.filter((e) => e.kind === "loan").map((e) => ({ id: e.id, label: `${e.label || "Emprunt"} (${eventYear(e, s.milestones)})` })),
  ];
}

/** Actifs pouvant recevoir un versement : éligibles (compte, livret, placement), existants ou achetés par événement. */
function depositableAssets(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.assets.filter((a) => canReceiveDeposits(a)).map((a) => ({ id: a.id, label: a.label || "Actif" })),
    ...s.events
      .filter((e) => e.kind === "buy")
      .filter((e) => canReceiveDeposits(e.asset))
      .map((e) => ({ id: e.asset.id, label: `${e.label || "Achat"} (${eventYear(e, s.milestones)})` })),
  ];
}

function eventSummary(ev: PlannedEvent, s: AppStateLike): string {
  switch (ev.kind) {
    case "flow": {
      const per = ev.period === "monthly" ? "/mois" : "/an";
      const endTxt = whenLabel(ev.endYear, ev.endRef, s.milestones);
      return `Flux ${ev.direction === "in" ? "entrant" : "sortant"} · ${ev.direction === "in" ? "+" : "−"}${money(ev.amount)}${per}${endTxt ? ` jusqu'à ${endTxt}` : ""}`;
    }
    case "buy":
      return `Achat · ${money(ev.price)}${ev.fees ? ` + ${money(ev.fees)} de frais` : ""} · ${CAT_LABELS[ev.asset.category]}${ev.asset.growthRate ? ` ${ev.asset.growthRate > 0 ? "+" : ""}${percent(ev.asset.growthRate)}/an` : ""}`;
    case "sell": {
      const label = sellableAssets(s).find((a) => a.id === ev.assetId)?.label ?? "actif inconnu";
      return `Vente de ${label} · ${ev.price != null ? money(ev.price) : "à la valeur projetée"}${ev.feesPct ? ` · frais ${percent(ev.feesPct)}` : ""}`;
    }
    case "loan":
      return `Nouvel emprunt · ${money(ev.amount)} à ${percent(ev.rate)} sur ${formatDuration(ev.termMonths)}${ev.insurance ? ` + ${money(ev.insurance)}/mois d'assurance` : ""}`;
    case "cash":
      return `${ev.amount >= 0 ? "Rentrée" : "Sortie"} ponctuelle · ${signedMoney(ev.amount)}`;
    case "repay": {
      const label = repayableLoans(s).find((l) => l.id === ev.loanId)?.label ?? "emprunt inconnu";
      return `Remboursement anticipé de ${label} · ${ev.amount != null ? money(ev.amount) : "totalité"}`;
    }
    case "deposit": {
      const label = depositableAssets(s).find((a) => a.id === ev.assetId)?.label ?? "actif inconnu";
      return `Versement · ${money(ev.amount)} → ${label}`;
    }
  }
}

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const compactEur = (n: number) => compact.format(n) + " €";

export default function ProjectionPage() {
  const { state, plan, update, updatePlan } = useStore();
  const p = plan.projection;
  const [view, setView] = useState<ViewId>("proj");
  const [chartMode, setChartMode] = useState<"net" | "composition" | "plans">("net");
  const [selYear, setSelYear] = useState<number | null>(null);
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

  const [evDraft, setEvDraft] = useState<PlannedEvent | null>(null);

  const hasData =
    grossWealth(state) > 0 || totalLiabilities(state) > 0 || state.incomes.length > 0 ||
    state.expenses.length > 0 || plan.events.length > 0;

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

  // gestion du plan actif : duplication (jalons copiés, mêmes ids) & suppression
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

  const now = points[0];
  const end = points[points.length - 1];
  const delta = end.netWorth - now.netWorth;
  const mult = now.netWorth > 0 ? end.netWorth / now.netWorth : null;
  const cagr = now.netWorth > 0 && end.netWorth > 0 ? (Math.pow(end.netWorth / now.netWorth, 1 / p.horizon) - 1) * 100 : null;
  const fiPoint = fiYearIndex !== null ? points[fiYearIndex] : null;

  const eligibleAssets = state.assets.filter(canReceiveDeposits);
  const selPoint = selYear !== null ? points.find((pt) => pt.year === selYear) ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="04 — Projection"
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

          {/* ==================== VUE PROJECTION ==================== */}
          {view === "proj" && (
            <>
              <motion.div
                className="assum"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                <div className="field assum-num">
                  <label>Rendement épargne réinvestie</label>
                  <div className="assum-input">
                    <input className="input mono" type="number" step="0.1" value={p.savingsYield || ""} placeholder="0"
                      onChange={(e) => setP({ savingsYield: Number(e.target.value) })} />
                    <span className="assum-unit">%/an</span>
                  </div>
                </div>
                <div className="field assum-num">
                  <label>Inflation</label>
                  <div className="assum-input">
                    <input className="input mono" type="number" step="0.1" value={p.inflation || ""} placeholder="0"
                      onChange={(e) => setP({ inflation: Number(e.target.value) })} />
                    <span className="assum-unit">%/an</span>
                  </div>
                </div>
                <div className="field assum-num">
                  <label>Patrimoine d'indépendance</label>
                  <div className="assum-input">
                    <input className="input mono" type="number" placeholder="montant" style={{ width: 130 }}
                      value={p.fiTarget ?? ""} onChange={(e) => setP({ fiTarget: e.target.value ? Number(e.target.value) : undefined })} />
                    <span className="assum-unit">€</span>
                  </div>
                </div>
                <div className="assum-toggles">
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

                {/* cascade d'affectation du surplus : actif 1 → actif 2 → … → épargne */}
                <CascadeEditor
                  mode="surplus"
                  label="Affectation du surplus"
                  eligible={eligibleAssets}
                  ids={p.surplusTargets ?? []}
                  onChange={(ids) => setP({ surplusTargets: ids.length ? ids : undefined })}
                />
                {/* cascade de retrait (miroir) : où puiser quand le mois est déficitaire */}
                <CascadeEditor
                  mode="withdraw"
                  label="Retraits en cas de déficit"
                  eligible={eligibleAssets}
                  ids={p.withdrawalTargets ?? []}
                  onChange={(ids) => setP({ withdrawalTargets: ids.length ? ids : undefined })}
                />
              </motion.div>

              {/* --------- hero --------- */}
              <motion.div className="wealth-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
                <div className="wealth-cell lead">
                  <div className="eyebrow">Patrimoine net en {end.year}{p.realTerms ? " · € constants" : ""}</div>
                  <div className={"v " + (end.netWorth < 0 ? "neg" : "")}>{money(end.netWorth)}</div>
                  <div className="sub">Dans {p.horizon} ans{end.age !== null ? ` · ${end.age} ans` : ""}</div>
                </div>
                <div className="wealth-cell">
                  <div className="eyebrow">Aujourd'hui</div>
                  <div className="v">{money(now.netWorth)}</div>
                  <div className="sub">{now.year}{now.age !== null ? ` · ${now.age} ans` : ""}</div>
                </div>
                <div className="wealth-cell">
                  <div className="eyebrow">Évolution</div>
                  <div className={"v " + (delta >= 0 ? "pos" : "neg")}>{signedMoney(delta)}</div>
                  <div className="sub">
                    {mult !== null ? `× ${mult.toFixed(1)}` : "—"}
                    {cagr !== null ? ` · ${percent(cagr)}/an` : ""}
                  </div>
                </div>
              </motion.div>

              {/* --------- indépendance financière (seuil défini par l'utilisateur) --------- */}
              {fiPoint && p.fiTarget != null && (
                <div className="fi-banner">
                  <span className="fi-dot" />
                  <b>Indépendance financière</b> atteinte en <b>{fiPoint.year}</b>
                  {fiPoint.age !== null ? ` (${fiPoint.age} ans)` : ""} — ton patrimoine net dépasse alors {money(p.fiTarget)}.
                </div>
              )}
              {!fiPoint && p.fiTarget != null && p.fiTarget > 0 && (
                <div className="fi-banner" style={{ borderColor: "rgba(213,152,115,0.4)", background: "rgba(213,152,115,0.07)" }}>
                  <span className="fi-dot" style={{ background: "var(--drain)", boxShadow: "0 0 10px var(--drain)" }} />
                  <b>Indépendance financière</b> ({money(p.fiTarget)}) non atteinte sur l'horizon —
                  il manque <b>{money(Math.max(0, p.fiTarget - end.netWorth))}</b> en {end.year}.
                </div>
              )}

              <motion.div className="card" style={{ padding: "18px 20px 12px" }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
                <div className="chart-head">
                  <div className="segment">
                    <button data-on={chartMode === "net"} onClick={() => setChartMode("net")}>Patrimoine net</button>
                    <button data-on={chartMode === "composition"} onClick={() => setChartMode("composition")}>Composition</button>
                    {state.plans.length > 1 && (
                      <button data-on={chartMode === "plans"} onClick={() => setChartMode("plans")}>Plans</button>
                    )}
                  </div>
                  {chartMode === "composition" && (
                    <div className="chart-legend">
                      <span><i style={{ background: "var(--sage)" }} /> Actifs</span>
                      <span><i style={{ background: "var(--gain)" }} /> Épargne</span>
                      <span><i style={{ background: "var(--drain)" }} /> Dettes</span>
                    </div>
                  )}
                  {chartMode === "plans" && planSeries && (
                    <div className="chart-legend">
                      {planSeries.map((s, i) => (
                        <span key={s.name}><i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} /> {s.name}</span>
                      ))}
                    </div>
                  )}
                  {chartMode !== "plans" && (
                    <div className="chart-legend mark-legend">
                      {events.some((e) => e.kind === "planned") && (
                        <span><b style={{ color: "var(--brass-bright)" }}>⚑</b> événement — clique pour éditer</span>
                      )}
                      {events.some((e) => e.kind === "loan") && (
                        <span><b style={{ color: "var(--sage)" }}>✓</b> fin d'emprunt</span>
                      )}
                      {events.some((e) => e.kind === "fi") && (
                        <span><b style={{ color: "var(--gain)" }}>◆</b> indépendance financière</span>
                      )}
                      {plan.milestones.length > 0 && (
                        <span><b style={{ color: "var(--sage)" }}>◇</b> jalon</span>
                      )}
                    </div>
                  )}
                </div>
                {chartMode === "plans" && planSeries ? (
                  <CompareChart series={planSeries} />
                ) : (
                  <NetWorthChart
                    points={points}
                    events={events}
                    milestones={plan.milestones}
                    mode={chartMode === "plans" ? "net" : chartMode}
                    onEventClick={editEvent}
                  />
                )}
              </motion.div>

              {/* --------- table --------- */}
              <section className="section" style={{ marginTop: 32 }}>
                <div className="section-head">
                  <h2>Détail annuel</h2>
                  <span className="spacer" />
                  <span className="hint"><span className="dot brass" /> clique une année pour voir sa composition</span>
                </div>
                <div className="proj-table-wrap">
                  <table className="proj-table">
                    <thead>
                      <tr>
                        <th>Année</th>
                        <th className="r">Actifs</th>
                        <th className="r">Dettes</th>
                        <th className="r">Épargne cumulée</th>
                        <th className="r">Patrimoine net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((pt) => (
                        <tr key={pt.yearIndex} data-now={pt.yearIndex === 0} data-fi={pt.yearIndex === fiYearIndex}
                          className="proj-row" onClick={() => setSelYear(pt.year)}>
                          <td>{pt.year}{pt.age !== null && <span className="proj-age"> · {pt.age} ans</span>}</td>
                          <td className="r mono">{money(pt.grossAssets)}</td>
                          <td className="r mono" style={{ color: pt.debt > 0 ? "var(--drain)" : "var(--ink-faint)" }}>
                            {pt.debt > 0 ? "−" + money(pt.debt) : "—"}
                          </td>
                          <td className="r mono" style={{ color: pt.savings < 0 ? "var(--drain)" : "var(--ink-soft)" }}>{signedMoney(pt.savings)}</td>
                          <td className="r mono" style={{ fontWeight: 600, color: "var(--brass-bright)" }}>{money(pt.netWorth)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <p className="help" style={{ marginTop: 18 }}>
                Hypothèses : taux d'évolution et revenus supposés constants{p.realTerms ? ", montants en euros constants" : ", montants en euros courants"}.
                {(p.withdrawalTargets ?? []).length > 0 && <> Les déficits puisent dans les actifs de la cascade de retrait avant de peser sur l'épargne.</>}
                {" "}Estimation, hors fiscalité.
              </p>
            </>
          )}

          {/* ==================== VUE JALONS & ÉVÉNEMENTS ==================== */}
          {view === "events" && (
            <section className="section" style={{ marginTop: 0 }}>
              <MilestonesEditor
                milestones={plan.milestones}
                birthYear={state.profile.birthDate ? new Date(state.profile.birthDate).getFullYear() : null}
                onChange={(ms) => updatePlan({ milestones: ms })}
              />
              <div className="divider" style={{ margin: "28px 0" }} />
              <div className="section-head">
                <h2>Événements</h2>
                <span className="count">{plan.events.length}</span>
                <span className="spacer" />
                <button className="btn btn-brass" onClick={() => setEvDraft(emptyEvent(points[points.length - 1].year))}>
                  <IconPlus size={16} /> Ajouter
                </button>
              </div>

              {sortedEvents.length === 0 ? (
                <div className="empty">
                  <span style={{ fontFamily: "var(--font-mono)" }}>⚑</span>
                  <div>
                    Aucun événement planifié.<br />
                    Achat immobilier, héritage, vente, remboursement anticipé… datés à l'année ou ancrés sur un jalon.
                  </div>
                </div>
              ) : (
                <div className="rows">
                  {sortedEvents.map((ev) => (
                    <div className="row row-ev" key={ev.id} data-off={ev.disabled || undefined}>
                      <label className="ev-check" title={ev.disabled ? "Réactiver dans la projection" : "Exclure de la projection"}>
                        <input type="checkbox" checked={!ev.disabled} onChange={() => toggleEvent(ev.id)} />
                      </label>
                      <div className="row-ic" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{"⚑"}</div>
                      <div className="row-main">
                        <div className="row-title">{ev.label || "Événement"}</div>
                        <div className="row-meta">
                          <span className="tag" style={ev.when ? { borderColor: "var(--line-brass)", color: "var(--brass-bright)" } : undefined}>
                            {ev.when && "◇ "}{whenLabel(ev.year, ev.when, plan.milestones)}
                          </span>
                          {" · "}<span>{eventSummary(ev, like)}</span>
                          {ev.disabled && <span className="tag" style={{ color: "var(--drain)" }}>désactivé</span>}
                        </div>
                      </div>
                      <div className="row-actions">
                        <button className="icon-btn" onClick={() => setEvDraft({ ...ev })} aria-label="Modifier"><IconEdit size={16} /></button>
                        <button className="icon-btn danger" onClick={() => delEvent(ev.id)} aria-label="Supprimer"><IconTrash size={16} /></button>
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
          )}

          {/* ==================== VUE CASH-FLOW ==================== */}
          {view === "cash" && <CashflowView points={points} realTerms={p.realTerms} />}

          {/* ==================== VUE PROBABILITÉ ==================== */}
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

/* ----------------------- CASCADES (surplus & retrait) ----------------------- */

/**
 * Éditeur de cascade ordonnée d'actifs. Deux usages symétriques :
 * - surplus : chaque cible reçoit jusqu'à son plafond, le reste va à l'épargne ;
 * - retrait : chaque source est vidée à son tour pour combler un déficit.
 */
function CascadeEditor({ mode, label, eligible, ids, onChange }: {
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

/* ----------------------- EVENT MODAL ----------------------- */

const EVENT_KINDS: { id: PlannedEvent["kind"]; label: string }[] = [
  { id: "flow", label: "Flux récurrent" },
  { id: "cash", label: "Rentrée / Sortie" },
  { id: "buy", label: "Achat" },
  { id: "sell", label: "Vente" },
  { id: "loan", label: "Emprunt" },
  { id: "repay", label: "Remboursement" },
  { id: "deposit", label: "Versement" },
];

function EventModal({ draft, s, onChange, onSave, onClose }: {
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
                {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
      </div>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-brass" onClick={handleSave} disabled={!valid}>Enregistrer</button>
      </div>
    </Modal>
  );
}

/* --------------------------- CHART --------------------------- */

const MARK_COLORS: Record<ProjectionEvent["kind"], string> = {
  planned: "var(--brass-bright)",
  loan: "var(--sage)",
  fi: "var(--gain)",
};
const MARK_GLYPHS: Record<ProjectionEvent["kind"], string> = { planned: "⚑", loan: "✓", fi: "◆" };

function NetWorthChart({ points, events, milestones, mode, onEventClick }: {
  points: YearPoint[];
  events: ProjectionEvent[];
  milestones: Milestone[];
  mode: "net" | "composition";
  onEventClick?: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000, H = 340;
  const M = { top: 24, right: 24, bottom: 40, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const n = points.length;

  // bornes des composantes empilées
  const posTop = (pt: YearPoint) => pt.grossAssets + Math.max(pt.savings, 0);
  const negBot = (pt: YearPoint) => -(pt.debt + Math.max(-pt.savings, 0));

  const maxV = mode === "composition"
    ? Math.max(...points.map(posTop), 0)
    : Math.max(...points.map((pt) => pt.netWorth), 0);
  const minV = mode === "composition"
    ? Math.min(...points.map(negBot), 0)
    : Math.min(...points.map((pt) => pt.netWorth), 0);
  const domainMax = (maxV || 1) * 1.08;
  const domainMin = minV < 0 ? minV * 1.08 : 0;

  const x = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;

  const line = points.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(pt.netWorth).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${y(domainMin).toFixed(1)} L ${x(0).toFixed(1)} ${y(domainMin).toFixed(1)} Z`;

  // bande empilée entre deux séries de valeurs
  const band = (upper: (pt: YearPoint) => number, lower: (pt: YearPoint) => number) => {
    const up = points.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(upper(pt)).toFixed(1)}`).join(" ");
    const down = [...points].reverse().map((pt) => `L ${x(pt.yearIndex).toFixed(1)} ${y(lower(pt)).toFixed(1)}`).join(" ");
    return `${up} ${down} Z`;
  };
  const assetsBand = band((pt) => pt.grossAssets, () => 0);
  const savingsBand = band(posTop, (pt) => pt.grossAssets);
  const debtBand = band(() => 0, negBot);

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / yTicks);
  const xStep = Math.max(1, Math.ceil((n - 1) / 8));
  const xTickIdx = points.map((_, i) => i).filter((i) => i % xStep === 0 || i === n - 1);

  // jalons visibles sur l'horizon
  const msMarks = milestones
    .map((m) => ({ ...m, idx: m.year - points[0].year }))
    .filter((m) => m.idx >= 0 && m.idx < n);

  // marqueurs d'événements, empilés quand plusieurs tombent la même année
  const marksByYear = new Map<number, ProjectionEvent[]>();
  for (const e of events) {
    const list = marksByYear.get(e.yearIndex) ?? [];
    list.push(e);
    marksByYear.set(e.yearIndex, list);
  }

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotLeft = (rect.width * M.left) / W;
    const plotW = (rect.width * innerW) / W;
    let i = Math.round(((px - plotLeft) / plotW) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        <defs>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brass)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--brass)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTickVals.map((v, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 12} y={y(v) + 4} textAnchor="end" className="chart-axis">{compactEur(v)}</text>
          </g>
        ))}

        {domainMin < 0 && (
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
        )}

        {/* jalons : repères verticaux nommés — le ◇ est CENTRÉ sur la ligne,
            le nom à côté (à gauche si le jalon touche le bord droit) */}
        {msMarks.map((m) => {
          const mx = x(m.idx);
          const flip = mx > W - M.right - 90; // le libellé sortirait du graphe
          return (
            <g key={m.id}>
              <line x1={mx} x2={mx} y1={M.top} y2={M.top + innerH}
                stroke="var(--sage)" strokeWidth="1" strokeDasharray="2 6" strokeOpacity="0.75" />
              <text x={mx} y={M.top + 4} textAnchor="middle" className="chart-axis" style={{ fill: "var(--sage)" }}>◇</text>
              <text x={flip ? mx - 9 : mx + 9} y={M.top + 4} textAnchor={flip ? "end" : "start"}
                className="chart-axis" style={{ fill: "var(--sage)" }}>
                {m.label || "Jalon"}
              </text>
            </g>
          );
        })}

        {events.map((e, i) => (
          <line key={i} x1={x(e.yearIndex)} x2={x(e.yearIndex)} y1={M.top} y2={M.top + innerH}
            stroke={e.kind === "fi" ? "var(--gain)" : "var(--line-brass)"} strokeWidth="1" strokeDasharray="3 5" />
        ))}

        {mode === "composition" ? (
          <>
            <path d={assetsBand} fill="var(--sage)" fillOpacity="0.24" />
            <path d={savingsBand} fill="var(--gain)" fillOpacity="0.3" />
            <path d={debtBand} fill="var(--drain)" fillOpacity="0.24" />
            <path d={line} fill="none" stroke="var(--brass-bright)" strokeWidth="2" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d={area} fill="url(#area-grad)" />
            <path d={line} fill="none" stroke="var(--brass-bright)" strokeWidth="2.5" strokeLinejoin="round" />
          </>
        )}

        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-axis">{points[i].year}</text>
        ))}

        {hp && (
          <>
            <line x1={x(hp.yearIndex)} x2={x(hp.yearIndex)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-mute)" strokeWidth="1" />
            <circle cx={x(hp.yearIndex)} cy={y(hp.netWorth)} r="5" fill="var(--brass-bright)" stroke="var(--bg)" strokeWidth="2" />
          </>
        )}

        {/* marqueurs d'événements — empilés EN HAUT le long de leur ligne d'année
            (jamais sous l'infobulle qui suit la courbe) ; cliquables si planifiés */}
        {[...marksByYear.entries()].map(([yi, list]) =>
          list.map((e, j) => {
            const cx = x(yi);
            const cy = M.top + 14 + j * 22;
            const clickable = e.kind === "planned" && !!e.id && !!onEventClick;
            return (
              <g
                key={`${yi}-${j}`}
                className={"chart-mark" + (clickable ? " clickable" : "")}
                onClick={clickable ? () => onEventClick!(e.id!) : undefined}
              >
                {/* zone de clic élargie, invisible */}
                <circle cx={cx} cy={cy} r="13" fill="transparent" />
                <circle cx={cx} cy={cy} r="9" fill="var(--panel-hi)" stroke={MARK_COLORS[e.kind]} strokeWidth="1.4" />
                <text x={cx} y={cy + 3.6} textAnchor="middle" className="chart-mark-glyph" style={{ fill: MARK_COLORS[e.kind] }}>
                  {MARK_GLYPHS[e.kind]}
                </text>
                <title>{e.label} · {e.year}{clickable ? " — cliquer pour modifier" : ""}</title>
              </g>
            );
          })
        )}
      </svg>

      {hp && (
        <div className="chart-tip" style={{ left: `${(x(hp.yearIndex) / W) * 100}%`, top: `${(y(hp.netWorth) / H) * 100}%` }}>
          <div className="chart-tip-year">{hp.year}{hp.age !== null ? ` · ${hp.age} ans` : ""}</div>
          <div className="chart-tip-val">{money(hp.netWorth)}</div>
          <div className="chart-tip-sub">actifs {compactEur(hp.grossAssets)} · dettes {compactEur(hp.debt)}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------ COMPARE CHART ------------------------ */

const SERIES_COLORS = ["var(--brass-bright)", "var(--gain)", "var(--sage)", "var(--drain)", "#8fa8c8", "#c8a0d0"];

function CompareChart({ series }: { series: { name: string; points: YearPoint[] }[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000, H = 340;
  const M = { top: 24, right: 24, bottom: 40, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const pts0 = series[0].points;
  const n = pts0.length;

  const all = series.flatMap((s) => s.points.map((pt) => pt.netWorth));
  const maxV = Math.max(...all, 0);
  const minV = Math.min(...all, 0);
  const domainMax = (maxV || 1) * 1.08;
  const domainMin = minV < 0 ? minV * 1.08 : 0;

  const x = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;
  const line = (pts: YearPoint[]) =>
    pts.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(pt.netWorth).toFixed(1)}`).join(" ");

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / yTicks);
  const xStep = Math.max(1, Math.ceil((n - 1) / 8));
  const xTickIdx = pts0.map((_, i) => i).filter((i) => i % xStep === 0 || i === n - 1);

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotLeft = (rect.width * M.left) / W;
    const plotW = (rect.width * innerW) / W;
    let i = Math.round(((px - plotLeft) / plotW) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  };

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none">
        {yTickVals.map((v, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 12} y={y(v) + 4} textAnchor="end" className="chart-axis">{compactEur(v)}</text>
          </g>
        ))}
        {domainMin < 0 && (
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
        )}
        {series.map((s, si) => (
          <path key={s.name} d={line(s.points)} fill="none"
            stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth="2" strokeLinejoin="round" />
        ))}
        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-axis">{pts0[i].year}</text>
        ))}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-mute)" strokeWidth="1" />
            {series.map((s, si) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.points[hover].netWorth)} r="4"
                fill={SERIES_COLORS[si % SERIES_COLORS.length]} stroke="var(--bg)" strokeWidth="2" />
            ))}
          </>
        )}
      </svg>

      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(M.top / H) * 100}%` }}>
          <div className="chart-tip-year">{pts0[hover].year}{pts0[hover].age !== null ? ` · ${pts0[hover].age} ans` : ""}</div>
          {series.map((s, si) => (
            <div key={s.name} className="chart-tip-sub" style={{ color: SERIES_COLORS[si % SERIES_COLORS.length] }}>
              {s.name} · {money(s.points[hover].netWorth)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------- VUE CASH-FLOW ------------------------- */

function CashflowView({ points, realTerms }: { points: YearPoint[]; realTerms: boolean }) {
  // par défaut la 1re année PLEINE (l'année 0 est souvent partielle)
  const [rawIdx, setRawIdx] = useState(Math.min(1, points.length - 1));
  const idx = Math.min(rawIdx, points.length - 1);
  const pt = points[idx];

  const evIn = pt.detail.events.filter((e) => e.kind !== "deposit" && e.cash > 0).reduce((t, e) => t + e.cash, 0);
  const evOut = pt.detail.events.filter((e) => e.kind !== "deposit" && e.cash < 0).reduce((t, e) => t - e.cash, 0);
  const inflows = pt.distributed + pt.extra + pt.savingsYield + pt.withdrawn + evIn;
  const outflows = pt.expenses + pt.charges + pt.interest + pt.insurance + pt.principal + pt.deposited + evOut;
  const saved = inflows - outflows;

  return (
    <>
      <motion.div className="card cash-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
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
      </motion.div>
      <p className="help" style={{ marginTop: 16 }}>
        D'où vient l'argent de l'année, et où il va. L'<b>épargne</b> est le poste d'équilibre : le surplus part
        « vers l'épargne », un déficit est « puisé dans l'épargne » (ou couvert par les <b>retraits d'actifs</b> si la
        cascade de retrait est configurée). Le capital remboursé et les versements sont des transferts neutres —
        ils sortent de la trésorerie mais restent dans ton patrimoine.
      </p>
    </>
  );
}

/* ------------------------- VUE PROBABILITÉ ------------------------- */

const DEFAULT_VOL: Record<AssetCategory, number> = {
  placement: 15, immobilier: 8, autre: 5, livret_epargne: 0, compte_courant: 0, vehicule: 0,
};

function MonteCarloView({ projState, params, detPoints, eligibleAssets }: {
  projState: SimState;
  params: ProjectionParams;
  detPoints: YearPoint[];
  eligibleAssets: Asset[];
}) {
  const { update } = useStore();
  const mc = useMemo(() => runMonteCarlo(projState, params, { trials: 400 }), [projState, params]);

  const rate = mc.successRate;
  const color = !mc.hasVolatility
    ? "var(--ink-mute)"
    : rate >= 0.85 ? "var(--gain)" : rate >= 0.6 ? "var(--brass-bright)" : "var(--drain)";
  const verdict = rate >= 0.85 ? "solide" : rate >= 0.6 ? "fragile" : "risqué";
  const end = mc.bands[mc.bands.length - 1];

  const applyDefaultVols = () =>
    update((st) => ({
      ...st,
      assets: st.assets.map((a) =>
        a.volatility == null && DEFAULT_VOL[a.category] > 0 ? { ...a, volatility: DEFAULT_VOL[a.category] } : a
      ),
    }));

  const R = 40;
  const C = 2 * Math.PI * R;

  return (
    <>
      {!mc.hasVolatility && (
        <div className="fi-banner" style={{ borderColor: "var(--line-brass)", background: "rgba(203,169,107,0.06)" }}>
          <span className="fi-dot" style={{ background: "var(--brass)", boxShadow: "0 0 10px var(--brass)" }} />
          <span>
            Aucun actif n'a de <b>volatilité</b> : tous les tirages suivent la même trajectoire.
            Renseigne-la par actif dans <b>Patrimoine</b>, ou
          </span>
          <button className="btn btn-ghost" onClick={applyDefaultVols} style={{ whiteSpace: "nowrap" }}>
            appliquer des valeurs types
          </button>
        </div>
      )}

      <motion.div className="mc-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mc-gauge">
          <svg width="112" height="112" viewBox="0 0 104 104">
            <circle cx="52" cy="52" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="8" />
            <circle cx="52" cy="52" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${C * rate} ${C}`} transform="rotate(-90 52 52)" />
            <text x="52" y="50" textAnchor="middle" className="mc-gauge-pct" style={{ fill: color }}>
              {Math.round(rate * 100)}%
            </text>
            <text x="52" y="66" textAnchor="middle" className="mc-gauge-sub">succès</text>
          </svg>
        </div>
        <div className="mc-facts">
          <div className="mc-title">
            Plan <b style={{ color }}>{verdict}</b> : l'épargne tient jusqu'au bout dans {mc.trials - mc.failures} des {mc.trials} tirages.
          </div>
          <div className="mc-sub">
            Un tirage <b>échoue</b> si l'épargne tombe à sec une année (déficit non couvert, même après la cascade de retrait).
            Rendements mensuels tirés autour du taux de chaque actif, selon sa volatilité.
          </div>
          <div className="mc-percentiles">
            <span className="tag" style={{ color: "var(--drain)" }}>pessimiste (P10) {compactEur(end.p10)}</span>
            <span className="tag" style={{ color: "var(--brass-bright)" }}>médian {compactEur(end.p50)}</span>
            <span className="tag" style={{ color: "var(--gain)" }}>optimiste (P90) {compactEur(end.p90)}</span>
            <span className="tag">en {end.year}</span>
          </div>
        </div>
      </motion.div>

      {(params.withdrawalTargets ?? []).length === 0 && eligibleAssets.length > 0 && (
        <p className="help" style={{ marginBottom: 16 }}>
          Astuce : sans <b>cascade de retrait</b> (onglet Projection), un déficit compte comme un échec même si tes
          placements sont pleins — configure-la pour laisser tes actifs financer les années creuses.
        </p>
      )}

      <motion.div className="card" style={{ padding: "18px 20px 12px" }} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.06 }}>
        <div className="chart-head">
          <div className="chart-legend">
            <span><i style={{ background: "var(--brass)", opacity: 0.25 }} /> P10–P90</span>
            <span><i style={{ background: "var(--brass)", opacity: 0.5 }} /> P25–P75</span>
            <span><i style={{ background: "var(--brass-bright)" }} /> Médiane</span>
            <span><i style={{ background: "var(--ink-mute)" }} /> Déterministe</span>
          </div>
        </div>
        <FanChart bands={mc.bands} det={detPoints} />
      </motion.div>
    </>
  );
}

function FanChart({ bands, det }: { bands: MonteCarloBand[]; det: YearPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000, H = 340;
  const M = { top: 24, right: 24, bottom: 40, left: 76 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const n = bands.length;

  const maxV = Math.max(...bands.map((b) => b.p90), ...det.map((pt) => pt.netWorth), 0);
  const minV = Math.min(...bands.map((b) => b.p10), ...det.map((pt) => pt.netWorth), 0);
  const domainMax = (maxV || 1) * 1.08;
  const domainMin = minV < 0 ? minV * 1.08 : 0;

  const x = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - ((v - domainMin) / (domainMax - domainMin || 1)) * innerH;

  const path = (get: (b: MonteCarloBand) => number) =>
    bands.map((b, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(get(b)).toFixed(1)}`).join(" ");
  const bandArea = (up: (b: MonteCarloBand) => number, low: (b: MonteCarloBand) => number) => {
    const upP = path(up);
    const down = [...bands].reverse().map((b) => `L ${x(b.yearIndex).toFixed(1)} ${y(low(b)).toFixed(1)}`).join(" ");
    return `${upP} ${down} Z`;
  };
  const detLine = det.map((pt, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(pt.netWorth).toFixed(1)}`).join(" ");

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => domainMin + ((domainMax - domainMin) * i) / yTicks);
  const xStep = Math.max(1, Math.ceil((n - 1) / 8));
  const xTickIdx = bands.map((_, i) => i).filter((i) => i % xStep === 0 || i === n - 1);

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const plotLeft = (rect.width * M.left) / W;
    const plotW = (rect.width * innerW) / W;
    let i = Math.round(((px - plotLeft) / plotW) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
  };

  const hb = hover !== null ? bands[hover] : null;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none">
        {yTickVals.map((v, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
            <text x={M.left - 12} y={y(v) + 4} textAnchor="end" className="chart-axis">{compactEur(v)}</text>
          </g>
        ))}
        {domainMin < 0 && (
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 4" />
        )}

        <path d={bandArea((b) => b.p90, (b) => b.p10)} fill="var(--brass)" fillOpacity="0.14" />
        <path d={bandArea((b) => b.p75, (b) => b.p25)} fill="var(--brass)" fillOpacity="0.22" />
        <path d={path((b) => b.p50)} fill="none" stroke="var(--brass-bright)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={detLine} fill="none" stroke="var(--ink-mute)" strokeWidth="1.5" strokeDasharray="5 5" strokeLinejoin="round" />

        {xTickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 14} textAnchor="middle" className="chart-axis">{bands[i].year}</text>
        ))}

        {hb && (
          <>
            <line x1={x(hb.yearIndex)} x2={x(hb.yearIndex)} y1={M.top} y2={M.top + innerH} stroke="var(--ink-mute)" strokeWidth="1" />
            <circle cx={x(hb.yearIndex)} cy={y(hb.p50)} r="5" fill="var(--brass-bright)" stroke="var(--bg)" strokeWidth="2" />
          </>
        )}
      </svg>

      {hb && (
        <div className="chart-tip" style={{ left: `${(x(hb.yearIndex) / W) * 100}%`, top: `${(y(hb.p50) / H) * 100}%` }}>
          <div className="chart-tip-year">{hb.year}{hb.age !== null ? ` · ${hb.age} ans` : ""}</div>
          <div className="chart-tip-val">{money(hb.p50)}</div>
          <div className="chart-tip-sub" style={{ color: "var(--gain)" }}>P90 {compactEur(hb.p90)}</div>
          <div className="chart-tip-sub" style={{ color: "var(--drain)" }}>P10 {compactEur(hb.p10)}</div>
        </div>
      )}
    </div>
  );
}

/* -------------------- YEAR DETAIL MODAL -------------------- */
function YearDetailModal({ point, real, onClose }: { point: YearPoint; real: boolean; onClose: () => void }) {
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
