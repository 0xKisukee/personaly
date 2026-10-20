import { useMemo } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/useStore";
import { simInput, planMilestones } from "../lib/types";
import { project } from "../lib/projection";
import {
  netWealth, grossWealth, totalLiabilities,
  cashInflowsYearly, expensesYearly, assetChargesYearly,
  loanPaymentsYearly, loanInsuranceYearly, assetPerformance,
} from "../lib/selectors";
import { assetType } from "../lib/assets";
import { money, signedMoney, percent, ageFrom } from "../lib/format";
import PageHeader from "../components/PageHeader";
import NetWorthChart from "./projection/NetWorthChart";
import { perfColor } from "../ui";
import { IconChevron, IconPlus } from "../components/icons";

export default function DashboardPage() {
  const { state, update } = useStore();
  const navigate = useNavigate();

  const birthYear = state.profile.birthDate ? new Date(state.profile.birthDate).getFullYear() : null;

  const gross = grossWealth(state);
  const liab = totalLiabilities(state);
  const net = netWealth(state);

  const hasData =
    gross > 0 || liab > 0 || state.incomes.length > 0 || state.expenses.length > 0;

  // flux courants (annuels → mensuels) + taux d'épargne cash — BASE (sans plan)
  const income = cashInflowsYearly(state);
  const spend =
    expensesYearly(state) + assetChargesYearly(state) + loanPaymentsYearly(state) + loanInsuranceYearly(state);
  const saved = income - spend;
  const savingsRate = income > 0 ? saved / income : 0;

  // répartition : top actifs par valeur, part du brut, teintés par leur perf — BASE
  const alloc = useMemo(
    () => [...state.assets].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 6),
    [state.assets]
  );

  // horizon des aperçus de l'Accueil = jusqu'à une cible d'âge (indépendant de la timeframe
  // de Projection) : 60 ans si < 40, 80 si 40–60, 100 si 60–80, 120 si > 80 (défaut 40 ans sans âge).
  const previewHorizon = useMemo(() => {
    const age = ageFrom(state.profile.birthDate);
    if (age == null) return 40;
    const target = age < 40 ? 60 : age < 60 ? 80 : age < 80 ? 100 : 120;
    return Math.max(1, target - age);
  }, [state.profile.birthDate]);

  // aperçu par PLAN : une projection par plan (jusqu'à la cible d'âge), pour la mini-courbe + jalons
  const planPreviews = useMemo(() => {
    if (!hasData) return [];
    return state.plans.map((pl) => {
      const { points, events } = project(simInput(state, pl), {
        ...pl.projection,
        horizon: previewHorizon,
        indexIncomes: state.settings.indexIncomes,
        indexExpenses: state.settings.indexExpenses,
        realTerms: state.settings.realTerms,
      });
      return { plan: pl, points, events };
    });
  }, [state, hasData, previewHorizon]);

  const openPlan = (id: string) => {
    update({ activePlanId: id });
    navigate("/projection");
  };

  return (
    <>
      <PageHeader
        eyebrow="00 — Accueil"
        title={<>Ton patrimoine, <em>en un coup d'œil</em></>}
        lede="Vue d'ensemble : où en est ton patrimoine aujourd'hui, et où le mènent tes plans."
      />

      {!hasData ? (
        <motion.button
          className="card dash-empty"
          onClick={() => navigate("/patrimoine")}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <span className="dash-empty-ic"><IconPlus size={26} /></span>
          <div>
            <div className="dash-empty-title">Commence par ton patrimoine</div>
            <div className="dash-empty-sub">Ajoute un premier actif (bien, épargne, véhicule…) pour voir ta vue d'ensemble se remplir.</div>
          </div>
          <IconChevron size={20} />
        </motion.button>
      ) : (
        <>
          {/* hero patrimoine */}
          <motion.div
            className="wealth-hero"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="wealth-cell lead">
              <div className="eyebrow">Patrimoine net</div>
              <div className={"v " + (net < 0 ? "neg" : "")}>{money(net)}</div>
              <div className="sub">Brut moins passifs</div>
            </div>
            <div className="wealth-cell">
              <div className="eyebrow">Patrimoine brut</div>
              <div className="v">{money(gross)}</div>
              <div className="sub">{state.assets.length} actif{state.assets.length > 1 ? "s" : ""}</div>
            </div>
            <div className="wealth-cell">
              <div className="eyebrow">Passifs</div>
              <div className={"v " + (liab > 0 ? "neg" : "")}>{liab > 0 ? "−" + money(liab) : money(0)}</div>
              <div className="sub">{state.liabilities.length} passif{state.liabilities.length > 1 ? "s" : ""}</div>
            </div>
          </motion.div>

          <div className="dash-grid">
            {/* répartition */}
            <DashCard title="Répartition" hint="gérer les actifs" onClick={() => navigate("/patrimoine")} delay={0.05}>
              {alloc.length === 0 ? (
                <div className="dash-muted">Aucun actif pour l'instant.</div>
              ) : (
                <div className="dash-alloc">
                  {alloc.map((a) => {
                    const share = gross > 0 ? (a.value || 0) / gross : 0;
                    const col = perfColor(assetPerformance(a).pct);
                    return (
                      <div className="dash-alloc-row" key={a.id}>
                        <div className="dash-alloc-head">
                          <span className="dash-alloc-name">{a.label || assetType(a.category).label}</span>
                          <span className="dash-alloc-val">{money(a.value)} · {percent(Math.round(share * 100))}</span>
                        </div>
                        <div className="dash-alloc-bar">
                          <span style={{ width: `${Math.max(2, share * 100)}%`, background: col }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DashCard>

            {/* flux courants */}
            <DashCard title="Flux mensuels" hint="détailler les flux" onClick={() => navigate("/flux")} delay={0.1}>
              <div className="dash-flux">
                <div><span>Revenus</span><b className="txt-gain">{money(income / 12)}</b></div>
                <div><span>Sorties</span><b className="txt-drain">{money(spend / 12)}</b></div>
                <div className="dash-flux-total">
                  <span>Épargne / mois</span>
                  <b className={saved >= 0 ? "txt-gain" : "txt-drain"}>{signedMoney(saved / 12)}</b>
                </div>
              </div>
              {income > 0 && (
                <div className="dash-rate">
                  <div className="dash-rate-bar">
                    <span style={{ width: `${Math.max(0, Math.min(100, savingsRate * 100))}%` }} />
                  </div>
                  <div className="dash-rate-label">
                    Taux d'épargne <b>{percent(Math.round(savingsRate * 100))}</b>
                  </div>
                </div>
              )}
            </DashCard>
          </div>

          {/* aperçu de chaque plan : mini-courbe + jalons (clique → ouvre la Projection) */}
          {planPreviews.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>Plans</h2>
                <span className="count">{planPreviews.length}</span>
                <span className="spacer" />
                <span className="hint"><span className="dot brass" /> aperçu de chaque scénario · clique pour l'ouvrir</span>
              </div>
              <div className="dash-plans">
                {planPreviews.map(({ plan, points, events }) => {
                  const end = points[points.length - 1];
                  const endAge = birthYear != null ? end.year - birthYear : null;
                  return (
                    <motion.div
                      key={plan.id}
                      className="card dash-plan"
                      role="button"
                      tabIndex={0}
                      onClick={() => openPlan(plan.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlan(plan.id); } }}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.36 }}
                    >
                      <div className="dash-plan-head">
                        <span className="dash-plan-name">{plan.name}</span>
                        {plan.id === state.activePlanId && <span className="tag tag-brass txt-brass">actif</span>}
                        <span className="spacer" />
                        <span className="dash-plan-end">{money(end.netWorth)} <em>{endAge != null ? `à ${endAge} ans` : `en ${end.year}`}</em></span>
                      </div>
                      <NetWorthChart points={points} events={events} milestones={planMilestones(state, plan)} mode="net" />
                    </motion.div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Carte de tableau de bord cliquable → navigue vers la page détaillée. */
function DashCard({
  title, hint, onClick, delay, children,
}: {
  title: string;
  hint: string;
  onClick: () => void;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      className="card dash-card"
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, delay }}
    >
      <div className="dash-card-head">
        <h3>{title}</h3>
        <span className="dash-card-hint">{hint} <IconChevron size={14} /></span>
      </div>
      {children}
    </motion.button>
  );
}
