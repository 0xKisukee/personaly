import { useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import type {
  ExpenseCategory,
  ExpenseItem,
  IncomeCategory,
  IncomeItem,
  Milestone,
  MilestoneRef,
  Period,
} from "../lib/types";
import { flowBounds } from "../lib/types";
import {
  assetChargesYearly,
  assetYearlyGrowth,
  assetYearlyIncome,
  enrichmentYearly,
  expensesYearly,
  extraIncomeYearly,
  loanInsuranceYearly,
  inflowsYearly,
  latentGainYearly,
  latentGrowthYearly,
  latentLossYearly,
  loanInterestYearly,
  loanPrincipalYearly,
  outflowsYearly,
  patrimoineIncomeYearly,
  realizedEnrichmentYearly,
} from "../lib/selectors";
import { loanYearSplit } from "../lib/finance";
import { money, signedMoney, toYearly, uid, isActiveYear, whenLabel } from "../lib/format";

const CURRENT_YEAR = new Date().getFullYear();
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import WhenPicker from "../components/WhenPicker";
import {
  IconArrowUp,
  IconBox,
  IconBriefcase,
  IconCart,
  IconChart,
  IconCoins,
  IconDebt,
  IconEdit,
  IconGift,
  IconHome,
  IconPlus,
  IconReceipt,
  IconSparkle,
  IconTrash,
} from "../components/icons";

type IconC = React.FC<{ size?: number }>;

const INCOME_META: Record<IncomeCategory, { label: string; icon: IconC }> = {
  salaire: { label: "Salaire", icon: IconBriefcase },
  rente: { label: "Rente / revenu", icon: IconCoins },
  aide: { label: "Aide / allocation", icon: IconGift },
  autre: { label: "Autre", icon: IconBox },
};

const EXPENSE_META: Record<ExpenseCategory, { label: string; icon: IconC }> = {
  vie_courante: { label: "Vie courante", icon: IconCart },
  logement: { label: "Logement", icon: IconHome },
  impot: { label: "Impôts", icon: IconReceipt },
  loisir: { label: "Loisirs", icon: IconSparkle },
  autre: { label: "Autre", icon: IconBox },
};

const emptyIncome = (): IncomeItem => ({
  id: uid(),
  label: "",
  category: "salaire",
  amount: 0,
  period: "monthly",
});
const emptyExpense = (): ExpenseItem => ({
  id: uid(),
  label: "",
  category: "vie_courante",
  amount: 0,
  period: "monthly",
});

const Liq = ({ kind }: { kind: "encaisse" | "latent" }) => (
  <span className={"liq liq-" + kind}>{kind === "encaisse" ? "encaissé" : "latent"}</span>
);

/** Bornes d'un flux : ancrages jalon résolus, libellés « dès Retraite (2057) ». */
function Bounds({ item, milestones }: {
  item: { startYear?: number; endYear?: number; startRef?: MilestoneRef; endRef?: MilestoneRef };
  milestones: Milestone[];
}) {
  const sTxt = whenLabel(item.startYear, item.startRef, milestones);
  const eTxt = whenLabel(item.endYear, item.endRef, milestones);
  if (!sTxt && !eTxt) return null;
  const { start, end } = flowBounds(item, milestones);
  const active = isActiveYear(start, end, CURRENT_YEAR);
  const txt = [sTxt ? `dès ${sTxt}` : "", eTxt ? `→ ${eTxt}` : ""].filter(Boolean).join(" ");
  return <span className="tag" style={{ color: active ? "var(--ink-mute)" : "var(--drain)" }}>{active ? txt : `${txt} · inactif`}</span>;
}

export default function FluxPage() {
  // `plan` : uniquement pour résoudre les ancrages jalon des flux (jalons du plan actif)
  const { state, plan, update } = useStore();
  const [view, setView] = useState<Period>("yearly");
  const [incomeDraft, setIncomeDraft] = useState<IncomeItem | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseItem | null>(null);

  const per = view === "monthly" ? "/ mois" : "/ an";
  const disp = (yearly: number) => (view === "monthly" ? yearly / 12 : yearly);

  const inflow = inflowsYearly(state);
  const outflow = outflowsYearly(state);
  const net = enrichmentYearly(state);
  const realized = realizedEnrichmentYearly(state);
  const latent = latentGrowthYearly(state);

  const patrimoineIncomes = state.assets
    .map((a) => ({ asset: a, yearly: assetYearlyIncome(a) }))
    .filter((x) => x.yearly > 0);
  const appreciationRows = state.assets
    .map((a) => ({ asset: a, yearly: assetYearlyGrowth(a) }))
    .filter((x) => x.yearly > 0);
  const depreciationRows = state.assets
    .map((a) => ({ asset: a, yearly: assetYearlyGrowth(a) }))
    .filter((x) => x.yearly < 0);
  const loanRows = state.liabilities
    .filter((l) => (l.monthlyPayment || 0) > 0)
    .map((l) => ({ l, split: loanYearSplit(l.outstanding, l.rate ?? 0, l.monthlyPayment ?? 0, l.termMonths) }));
  const chargeRows = state.assets
    .map((a) => ({ asset: a, yearly: toYearly(a.charges) }))
    .filter((x) => x.yearly > 0);

  /* CRUD */
  const saveIncome = (it: IncomeItem) => {
    update((s) => ({
      ...s,
      incomes: s.incomes.some((x) => x.id === it.id)
        ? s.incomes.map((x) => (x.id === it.id ? it : x))
        : [...s.incomes, it],
    }));
    setIncomeDraft(null);
  };
  const saveExpense = (it: ExpenseItem) => {
    update((s) => ({
      ...s,
      expenses: s.expenses.some((x) => x.id === it.id)
        ? s.expenses.map((x) => (x.id === it.id ? it : x))
        : [...s.expenses, it],
    }));
    setExpenseDraft(null);
  };
  const delIncome = (id: string) =>
    update((s) => ({ ...s, incomes: s.incomes.filter((x) => x.id !== id) }));
  const delExpense = (id: string) =>
    update((s) => ({ ...s, expenses: s.expenses.filter((x) => x.id !== id) }));

  return (
    <>
      <PageHeader
        eyebrow="03 — Flux"
        title={
          <>
            Entrants & <em>sortants</em>
          </>
        }
        lede="Tout ce qui fait varier ton patrimoine net. On distingue ce qui est réellement encaissé ou décaissé de la plus-value latente (la valeur monte sans rien te verser)."
        actions={
          <div className="segment">
            <button data-on={view === "yearly"} onClick={() => setView("yearly")}>Annuel</button>
            <button data-on={view === "monthly"} onClick={() => setView("monthly")}>Mensuel</button>
          </div>
        }
      />

      <motion.div
        className="wealth-hero"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="wealth-cell lead">
          <div className="eyebrow">Enrichissement {per}</div>
          <div className={"v " + (net >= 0 ? "pos" : "neg")}>{signedMoney(disp(net))}</div>
          <div className="sub">Variation du patrimoine net</div>
        </div>
        <div className="wealth-cell">
          <div className="eyebrow">Flux entrants {per}</div>
          <div className="v pos">{money(disp(inflow))}</div>
          <div className="sub">Encaissés + croissance capitalisée</div>
        </div>
        <div className="wealth-cell">
          <div className="eyebrow">Flux sortants {per}</div>
          <div className="v neg">{outflow > 0 ? "−" + money(disp(outflow)) : money(0)}</div>
          <div className="sub">Dépenses, impôts + intérêts d'emprunt</div>
        </div>
      </motion.div>

      {/* décomposition de l'enrichissement : réalisé + latent (sans répéter le total) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
      >
        <div className="eyebrow" style={{ marginBottom: 10 }}>Dont, dans l'enrichissement</div>
        <div className="liq-strip">
          <div className="liq-cell">
            <div>
              <span className="liq liq-encaisse">encaissé</span>
              <span className="liq-name">Réalisé · revenus − dépenses − intérêts</span>
            </div>
            <span className={"mono liq-v " + (realized >= 0 ? "pos" : "neg")}>{signedMoney(disp(realized))} {per}</span>
          </div>
          <div className="liq-plus">+</div>
          <div className="liq-cell">
            <div>
              <span className="liq liq-latent">latent</span>
              <span className="liq-name">Valorisation latente · variation de valeur non encaissée</span>
            </div>
            <span className={"mono liq-v " + (latent >= 0 ? "pos" : "neg")}>{signedMoney(disp(latent))} {per}</span>
          </div>
        </div>
      </motion.div>

      {/* ===================== ENTRANTS ===================== */}
      <section className="section">
        <div className="section-head">
          <span className="dot gain" />
          <h2>Flux entrants</h2>
          <span className="spacer" />
          <span className="tag" style={{ color: "var(--gain)", borderColor: "var(--line-brass)" }}>
            {money(disp(inflow))} {per}
          </span>
        </div>

        {/* revenus du patrimoine (auto, liquide) */}
        <div className="flux-sub">
          <span className="flux-sub-label">Revenus du patrimoine</span>
          <Liq kind="encaisse" />
          <span className="flux-sub-total mono">{money(disp(patrimoineIncomeYearly(state)))} {per}</span>
        </div>
        {patrimoineIncomes.length === 0 ? (
          <p className="help" style={{ marginBottom: 16 }}>
            Aucun actif ne distribue de revenu. Ajoute un loyer ou un dividende dans <b>Patrimoine</b>.
          </p>
        ) : (
          <div className="rows" style={{ marginBottom: 18 }}>
            {patrimoineIncomes.map(({ asset, yearly }) => (
              <div className="row" key={asset.id}>
                <div className="row-ic" style={{ color: "var(--gain)" }}><IconArrowUp size={20} /></div>
                <div className="row-main">
                  <div className="row-title">{asset.label}</div>
                  <div className="row-meta">
                    <span className="tag">depuis Patrimoine</span>
                    {asset.incomeMode === "rate" && <span>rendement distribué</span>}
                  </div>
                </div>
                <div className="row-val" style={{ color: "var(--gain)" }}>{signedMoney(disp(yearly))}<div className="flux zero">{per}</div></div>
                <div />
              </div>
            ))}
          </div>
        )}

        {/* revenus complémentaires (manuels, liquide) */}
        <div className="flux-sub">
          <span className="flux-sub-label">Revenus complémentaires</span>
          <Liq kind="encaisse" />
          <span className="flux-sub-total mono">{money(disp(extraIncomeYearly(state)))} {per}</span>
          <button className="btn btn-ghost" onClick={() => setIncomeDraft(emptyIncome())}>
            <IconPlus size={15} /> Ajouter
          </button>
        </div>
        {state.incomes.length === 0 ? (
          <p className="help" style={{ marginBottom: 18 }}>Salaire, aide, pension… <b>nets avant impôt</b> (l'impôt se met en dépense).</p>
        ) : (
          <div className="rows" style={{ marginBottom: 18 }}>
            {state.incomes.map((it, i) => {
              const Meta = INCOME_META[it.category];
              const b = flowBounds(it, plan.milestones);
              const active = isActiveYear(b.start, b.end, CURRENT_YEAR);
              return (
                <motion.div className="row" key={it.id} style={{ opacity: active ? 1 : 0.5 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: active ? 1 : 0.5, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <div className="row-ic" style={{ color: "var(--gain)" }}><Meta.icon size={20} /></div>
                  <div className="row-main">
                    <div className="row-title">{it.label || Meta.label}</div>
                    <div className="row-meta"><span>{Meta.label}</span>· <span>{money(it.amount)} {it.period === "monthly" ? "/ mois" : "/ an"}</span><Bounds item={it} milestones={plan.milestones} /></div>
                  </div>
                  <div className="row-val" style={{ color: "var(--gain)" }}>{signedMoney(disp(toYearly(it)))}<div className="flux zero">{per}</div></div>
                  <div className="row-actions">
                    <button className="icon-btn" onClick={() => setIncomeDraft({ ...it })} aria-label="Modifier"><IconEdit size={16} /></button>
                    <button className="icon-btn danger" onClick={() => delIncome(it.id)} aria-label="Supprimer"><IconTrash size={16} /></button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* plus-value latente (auto, appréciations) */}
        <div className="flux-sub">
          <span className="flux-sub-label">Plus-value latente</span>
          <Liq kind="latent" />
          <span className="flux-sub-total mono">{signedMoney(disp(latentGainYearly(state)))} {per}</span>
        </div>
        {appreciationRows.length === 0 ? (
          <p className="help">
            Aucun actif ne s'apprécie. Définis un taux d'évolution positif (PEA, immo…) dans <b>Patrimoine</b>.
          </p>
        ) : (
          <div className="rows">
            {appreciationRows.map(({ asset, yearly }) => (
              <div className="row" key={asset.id}>
                <div className="row-ic" style={{ color: "var(--sage)" }}><IconChart size={20} /></div>
                <div className="row-main">
                  <div className="row-title">{asset.label}</div>
                  <div className="row-meta">
                    <span className="tag">depuis Patrimoine</span>
                    <span>valeur +{asset.growthRate} %/an · plus-value non encaissée</span>
                  </div>
                </div>
                <div className="row-val" style={{ color: "var(--sage)" }}>{signedMoney(disp(yearly))}<div className="flux zero">{per}</div></div>
                <div />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===================== SORTANTS ===================== */}
      <section className="section">
        <div className="section-head">
          <span className="dot drain" />
          <h2>Flux sortants</h2>
          <span className="spacer" />
          <span className="tag" style={{ color: "var(--drain)" }}>−{money(disp(outflow))} {per}</span>
        </div>

        {/* dépenses & impôts (manuels, liquide) */}
        <div className="flux-sub">
          <span className="flux-sub-label">Dépenses & impôts</span>
          <Liq kind="encaisse" />
          <span className="flux-sub-total mono">−{money(disp(expensesYearly(state)))} {per}</span>
          <button className="btn btn-ghost" onClick={() => setExpenseDraft(emptyExpense())}>
            <IconPlus size={15} /> Ajouter
          </button>
        </div>
        {state.expenses.length === 0 ? (
          <p className="help" style={{ marginBottom: 18 }}>Vie courante, logement, loisirs, et <b>impôts</b> si tu veux les modéliser à part.</p>
        ) : (
          <div className="rows" style={{ marginBottom: 18 }}>
            {state.expenses.map((it, i) => {
              const Meta = EXPENSE_META[it.category];
              const b = flowBounds(it, plan.milestones);
              const active = isActiveYear(b.start, b.end, CURRENT_YEAR);
              return (
                <motion.div className="row" key={it.id} style={{ opacity: active ? 1 : 0.5 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: active ? 1 : 0.5, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <div className="row-ic" style={{ color: it.category === "impot" ? "var(--brass)" : "var(--drain)" }}><Meta.icon size={20} /></div>
                  <div className="row-main">
                    <div className="row-title">{it.label || Meta.label}</div>
                    <div className="row-meta"><span>{Meta.label}</span>· <span>{money(it.amount)} {it.period === "monthly" ? "/ mois" : "/ an"}</span><Bounds item={it} milestones={plan.milestones} /></div>
                  </div>
                  <div className="row-val" style={{ color: "var(--drain)" }}>−{money(disp(toYearly(it)))}<div className="flux zero">{per}</div></div>
                  <div className="row-actions">
                    <button className="icon-btn" onClick={() => setExpenseDraft({ ...it })} aria-label="Modifier"><IconEdit size={16} /></button>
                    <button className="icon-btn danger" onClick={() => delExpense(it.id)} aria-label="Supprimer"><IconTrash size={16} /></button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* charges d'actifs (auto, liquide) */}
        <div className="flux-sub" style={{ marginTop: 18 }}>
          <span className="flux-sub-label">Charges d'actifs</span>
          <Liq kind="encaisse" />
          <span className="flux-sub-total mono">−{money(disp(assetChargesYearly(state)))} {per}</span>
        </div>
        {chargeRows.length === 0 ? (
          <p className="help" style={{ marginBottom: 18 }}>Taxe foncière, charges de copropriété… Renseigne-les sur un actif dans <b>Patrimoine</b>.</p>
        ) : (
          <div className="rows" style={{ marginBottom: 18 }}>
            {chargeRows.map(({ asset, yearly }) => (
              <div className="row" key={asset.id}>
                <div className="row-ic" style={{ color: "var(--drain)" }}><IconHome size={20} /></div>
                <div className="row-main">
                  <div className="row-title">{asset.label}</div>
                  <div className="row-meta"><span className="tag">depuis Patrimoine</span><span>charges de détention</span></div>
                </div>
                <div className="row-val" style={{ color: "var(--drain)" }}>−{money(disp(yearly))}<div className="flux zero">{per}</div></div>
                <div />
              </div>
            ))}
          </div>
        )}

        {/* intérêts & assurance d'emprunt (auto, liquide ; capital = neutre) */}
        <div className="flux-sub">
          <span className="flux-sub-label">Intérêts & assurance d'emprunt</span>
          <Liq kind="encaisse" />
          <span className="flux-sub-total mono">−{money(disp(loanInterestYearly(state) + loanInsuranceYearly(state)))} {per}</span>
        </div>
        {loanRows.length === 0 ? (
          <p className="help">Aucun emprunt. Les intérêts des prêts saisis dans <b>Patrimoine</b> apparaîtront ici.</p>
        ) : (
          <>
            <div className="rows">
              {loanRows.map(({ l, split }) => {
                const insY = (l.insurance || 0) * 12;
                return (
                  <div className="row" key={l.id}>
                    <div className="row-ic" style={{ color: "var(--drain)" }}><IconDebt size={20} /></div>
                    <div className="row-main">
                      <div className="row-title">{l.label}</div>
                      <div className="row-meta">
                        <span className="tag">depuis Patrimoine</span>
                        <span>mensualité {money(l.monthlyPayment || 0)}/mois</span>
                        · <span style={{ color: "var(--sage)" }}>dont capital {money(disp(split.principal))} {per} reconstitué</span>
                        {insY > 0 && <>· <span>assurance {money(disp(insY))} {per}</span></>}
                      </div>
                    </div>
                    <div className="row-val" style={{ color: "var(--drain)" }}>−{money(disp(split.interest + insY))}<div className="flux zero">intérêts{insY > 0 ? " + assur." : ""} {per}</div></div>
                    <div />
                  </div>
                );
              })}
            </div>
            <p className="help" style={{ marginTop: 12 }}>
              Le <b>capital remboursé</b> ({money(disp(loanPrincipalYearly(state)))} {per}) sort de ta trésorerie mais revient dans ton
              patrimoine net (la dette baisse d'autant) : il n'est <b>pas</b> compté comme une dépense ici.
            </p>
          </>
        )}

        {/* moins-value latente (auto, dépréciations) */}
        <div className="flux-sub" style={{ marginTop: 18 }}>
          <span className="flux-sub-label">Moins-value latente</span>
          <Liq kind="latent" />
          <span className="flux-sub-total mono">{money(disp(latentLossYearly(state)))} {per}</span>
        </div>
        {depreciationRows.length === 0 ? (
          <p className="help">Aucun actif ne se déprécie. Un taux d'évolution négatif (véhicule…) apparaîtrait ici comme une perte de valeur.</p>
        ) : (
          <div className="rows">
            {depreciationRows.map(({ asset, yearly }) => (
              <div className="row" key={asset.id}>
                <div className="row-ic" style={{ color: "var(--drain)" }}><IconChart size={20} /></div>
                <div className="row-main">
                  <div className="row-title">{asset.label}</div>
                  <div className="row-meta">
                    <span className="tag">depuis Patrimoine</span>
                    <span>valeur {asset.growthRate} %/an · perte de valeur non décaissée</span>
                  </div>
                </div>
                <div className="row-val" style={{ color: "var(--drain)" }}>{signedMoney(disp(yearly))}<div className="flux zero">{per}</div></div>
                <div />
              </div>
            ))}
          </div>
        )}
      </section>

      {incomeDraft && (
        <FlowModal
          kind="income"
          draft={incomeDraft}
          categories={INCOME_META}
          milestones={plan.milestones}
          onChange={(d) => setIncomeDraft(d as IncomeItem)}
          onSave={() => saveIncome(incomeDraft)}
          onClose={() => setIncomeDraft(null)}
        />
      )}
      {expenseDraft && (
        <FlowModal
          kind="expense"
          draft={expenseDraft}
          categories={EXPENSE_META}
          milestones={plan.milestones}
          onChange={(d) => setExpenseDraft(d as ExpenseItem)}
          onSave={() => saveExpense(expenseDraft)}
          onClose={() => setExpenseDraft(null)}
        />
      )}
    </>
  );
}

/* ----------------------- FLOW MODAL (income/expense) ----------------------- */
interface FlowDraft {
  id: string;
  label: string;
  category: string;
  amount: number;
  period: Period;
  startYear?: number;
  endYear?: number;
  startRef?: MilestoneRef;
  endRef?: MilestoneRef;
  growth?: number;
}

function FlowModal({
  kind,
  draft,
  categories,
  milestones,
  onChange,
  onSave,
  onClose,
}: {
  kind: "income" | "expense";
  draft: FlowDraft;
  categories: Record<string, { label: string; icon: IconC }>;
  milestones: Milestone[];
  onChange: (d: FlowDraft) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<FlowDraft>) => onChange({ ...draft, ...patch });
  const isIncome = kind === "income";

  return (
    <Modal
      open
      title={
        draft.label
          ? isIncome ? "Modifier le revenu" : "Modifier la dépense"
          : isIncome ? "Nouveau revenu complémentaire" : "Nouvelle dépense"
      }
      subtitle={
        isIncome
          ? "Montant net avant impôt, ajouté aux flux entrants."
          : "Dépense ou impôt, déduit des flux entrants."
      }
      onClose={onClose}
    >
      <div className="form-grid">
        <div className="field span-2">
          <label>Libellé</label>
          <input
            className="input"
            autoFocus
            placeholder={isIncome ? "ex. Salaire net, Allocation…" : "ex. Loyer, Impôt sur le revenu…"}
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Catégorie</label>
          <select className="select" value={draft.category} onChange={(e) => set({ category: e.target.value })}>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Montant (€)</label>
          <input
            className="input mono"
            type="number"
            value={draft.amount || ""}
            onChange={(e) => set({ amount: Number(e.target.value) })}
          />
        </div>
        <div className="field span-2">
          <label>Périodicité</label>
          <div className="segment">
            <button data-on={draft.period === "monthly"} onClick={() => set({ period: "monthly" })}>Mensuel</button>
            <button data-on={draft.period === "yearly"} onClick={() => set({ period: "yearly" })}>Annuel</button>
          </div>
        </div>
        <div className="field span-2">
          <label>À partir de</label>
          <WhenPicker
            milestones={milestones}
            allowEmpty
            emptyLabel="Dès maintenant"
            value={{ year: draft.startYear, ref: draft.startRef }}
            onChange={(v) => set({ startYear: v.year, startRef: v.ref })}
          />
        </div>
        <div className="field span-2">
          <label>Jusqu'à</label>
          <WhenPicker
            milestones={milestones}
            allowEmpty
            emptyLabel="Sans fin"
            value={{ year: draft.endYear, ref: draft.endRef }}
            onChange={(v) => set({ endYear: v.year, endRef: v.ref })}
          />
        </div>
        <div className="field span-2">
          <label>Revalorisation (%/an) — optionnel</label>
          <input
            className="input mono"
            type="number"
            step="0.1"
            placeholder="vide = suit l'inflation de la projection"
            value={draft.growth ?? ""}
            onChange={(e) => set({ growth: e.target.value !== "" ? Number(e.target.value) : undefined })}
          />
        </div>
      </div>
      <p className="help" style={{ marginTop: 14 }}>
        Dates : « Dès maintenant » / « Sans fin » pour un flux permanent. Ancre une borne sur un <b>jalon</b>
        (ex. salaire jusqu'à <b>Retraite</b>) : déplacer le jalon dans <b>Profil</b> recale le flux automatiquement.
        Revalorisation : taux propre au flux dans la projection ; vide = suit l'inflation globale.
      </p>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-brass" onClick={onSave} disabled={!draft.label.trim()}>Enregistrer</button>
      </div>
    </Modal>
  );
}
