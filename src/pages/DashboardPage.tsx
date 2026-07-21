import { useMemo } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../lib/store";
import { simInput, DEFAULT_PLAN, DEFAULT_PROJECTION } from "../lib/types";
import { project } from "../lib/projection";
import {
  netWealth, grossWealth, totalLiabilities,
  cashInflowsYearly, expensesYearly, assetChargesYearly,
  loanPaymentsYearly, loanInsuranceYearly, assetPerformance,
} from "../lib/selectors";
import { assetType } from "../lib/assets";
import { money, signedMoney, percent } from "../lib/format";
import PageHeader from "../components/PageHeader";
import { perfColor } from "../ui";
import { IconChevron, IconPlus } from "../components/icons";

const HORIZON = 10;

export default function DashboardPage() {
  // L'Accueil ignore VOLONTAIREMENT les plans (hypothétiques → page Projection) : il
  // montre la trajectoire de BASE, tes finances actuelles évoluant au fil des flux.
  const { state } = useStore();
  const navigate = useNavigate();
  const nowYear = new Date().getFullYear();

  const gross = grossWealth(state);
  const liab = totalLiabilities(state);
  const net = netWealth(state);

  const hasData =
    gross > 0 || liab > 0 || state.incomes.length > 0 || state.expenses.length > 0;

  // projection de BASE (sans plan : aucun événement/jalon, hypothèses par défaut),
  // une seule passe du moteur mémoïsée → net à +1/+5/+10 ans.
  const horizons = useMemo(() => {
    if (!hasData) return null;
    const base = { ...DEFAULT_PLAN, milestones: [], events: [] };
    const { points } = project(simInput(state, base), { ...DEFAULT_PROJECTION, horizon: HORIZON });
    const at = (i: number) => points.find((p) => p.yearIndex === i)?.netWorth ?? null;
    return [1, 5, 10].map((y) => ({ y, net: at(y) }));
  }, [state, hasData]);

  // flux courants (annuels → mensuels) + taux d'épargne cash
  const income = cashInflowsYearly(state);
  const spend =
    expensesYearly(state) + assetChargesYearly(state) + loanPaymentsYearly(state) + loanInsuranceYearly(state);
  const saved = income - spend;
  const savingsRate = income > 0 ? saved / income : 0;

  // répartition : top actifs par valeur, part du brut, teintés par leur perf
  const alloc = useMemo(
    () => [...state.assets].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 6),
    [state.assets]
  );

  // « À venir » de la trajectoire de BASE (indépendant des plans) : flux datés qui
  // démarrent/s'arrêtent (bornes en dur uniquement, pas d'ancrage jalon) + emprunts soldés.
  const upcoming = useMemo(() => {
    const out: { year: number; label: string }[] = [];
    for (const i of state.incomes) {
      if (i.startYear && i.startYear > nowYear) out.push({ year: i.startYear, label: `${i.label || "Revenu"} démarre` });
      if (i.endYear && i.endYear >= nowYear) out.push({ year: i.endYear, label: `${i.label || "Revenu"} se termine` });
    }
    for (const e of state.expenses) {
      if (e.startYear && e.startYear > nowYear) out.push({ year: e.startYear, label: `${e.label || "Dépense"} démarre` });
      if (e.endYear && e.endYear >= nowYear) out.push({ year: e.endYear, label: `${e.label || "Dépense"} se termine` });
    }
    for (const l of state.liabilities) {
      if (l.termMonths && l.termMonths > 0) {
        out.push({ year: nowYear + Math.round(l.termMonths / 12), label: `${l.label || "Emprunt"} soldé` });
      }
    }
    return out.sort((a, b) => a.year - b.year).slice(0, 3);
  }, [state.incomes, state.expenses, state.liabilities, nowYear]);

  return (
    <>
      <PageHeader
        eyebrow="00 — Accueil"
        title={<>Ton patrimoine, <em>en un coup d'œil</em></>}
        lede="Vue d'ensemble : où en est ton patrimoine aujourd'hui, sa trajectoire, et ce qui arrive ensuite."
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
            {/* trajectoire projetée */}
            <DashCard title="Trajectoire" hint="voir la projection" onClick={() => navigate("/projection")} delay={0.05}>
              <div className="dash-horizons">
                {horizons?.map(({ y, net: n }) => {
                  const d = n != null ? n - net : 0;
                  return (
                    <div className="dash-horizon" key={y}>
                      <div className="dash-horizon-y">+{y} an{y > 1 ? "s" : ""}</div>
                      <div className="dash-horizon-v">{n != null ? money(n) : "—"}</div>
                      <div className="dash-horizon-d" style={{ color: d >= 0 ? "var(--gain)" : "var(--drain)" }}>
                        {signedMoney(d)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hint" style={{ marginTop: 14 }}>
                <span className="dot brass" /> Au fil de tes flux actuels · valeur composée, emprunts amortis. Les plans se simulent dans Projection.
              </div>
            </DashCard>

            {/* flux courants */}
            <DashCard title="Flux mensuels" hint="détailler les flux" onClick={() => navigate("/flux")} delay={0.1}>
              <div className="dash-flux">
                <div><span>Revenus</span><b style={{ color: "var(--gain)" }}>{money(income / 12)}</b></div>
                <div><span>Sorties</span><b style={{ color: "var(--drain)" }}>{money(spend / 12)}</b></div>
                <div className="dash-flux-total">
                  <span>Épargne / mois</span>
                  <b style={{ color: saved >= 0 ? "var(--gain)" : "var(--drain)" }}>{signedMoney(saved / 12)}</b>
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

            {/* répartition */}
            <DashCard title="Répartition" hint="gérer les actifs" onClick={() => navigate("/patrimoine")} delay={0.15}>
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

            {/* à venir : changements de la trajectoire de base (flux datés, emprunts soldés) */}
            <DashCard title="À venir" hint="gérer les flux" onClick={() => navigate("/flux")} delay={0.2}>
              {upcoming.length === 0 ? (
                <div className="dash-muted">
                  Rien de daté au fil de tes flux actuels. Ajoute une date de début/fin à un revenu ou une dépense pour l'anticiper ici.
                </div>
              ) : (
                <div className="dash-next">
                  {upcoming.map((u, k) => {
                    const away = u.year - nowYear;
                    return (
                      <div className="dash-next-item" key={k}>
                        <div className="dash-next-v">
                          {u.label} <span>· {u.year} {away === 0 ? "(cette année)" : `(${away} an${away > 1 ? "s" : ""})`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </DashCard>
          </div>
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
