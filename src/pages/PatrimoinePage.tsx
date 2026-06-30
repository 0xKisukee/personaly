import { useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import type {
  Asset,
  AssetCategory,
  Liability,
  LiabilityCategory,
  Period,
} from "../lib/types";
import {
  assetYearlyIncome,
  grossWealth,
  netWealth,
  totalLiabilities,
} from "../lib/selectors";
import { money, signedMoney, percent, uid, periodLabel } from "../lib/format";
import { monthlyPayment, formatDuration, formatEndDate } from "../lib/finance";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import {
  IconBank,
  IconBox,
  IconCar,
  IconChart,
  IconDebt,
  IconEdit,
  IconHome,
  IconPlus,
  IconSavings,
  IconTrash,
} from "../components/icons";

const ASSET_META: Record<AssetCategory, { label: string; icon: React.FC<{ size?: number }> }> = {
  immobilier: { label: "Immobilier", icon: IconHome },
  compte_courant: { label: "Compte courant", icon: IconBank },
  livret_epargne: { label: "Livret d'épargne", icon: IconSavings },
  placement: { label: "Placement", icon: IconChart },
  vehicule: { label: "Véhicule", icon: IconCar },
  autre: { label: "Autre", icon: IconBox },
};

const LIAB_META: Record<LiabilityCategory, { label: string }> = {
  emprunt_immo: { label: "Emprunt immobilier" },
  credit_conso: { label: "Crédit conso" },
  credit_auto: { label: "Crédit auto" },
  dette: { label: "Dette" },
  autre: { label: "Autre" },
};

const emptyAsset = (): Asset => ({
  id: uid(),
  label: "",
  category: "immobilier",
  value: 0,
  growthRate: 0,
  incomeMode: "none",
  incomeRate: 0,
  income: { amount: 0, period: "monthly" },
});

const emptyLiab = (): Liability => ({
  id: uid(),
  label: "",
  category: "emprunt_immo",
  outstanding: 0,
  rate: 0,
  termMonths: 0,
  monthlyPayment: 0,
  autoPayment: true,
});

export default function PatrimoinePage() {
  const { state, update } = useStore();
  const [assetDraft, setAssetDraft] = useState<Asset | null>(null);
  const [liabDraft, setLiabDraft] = useState<Liability | null>(null);

  const gross = grossWealth(state);
  const liab = totalLiabilities(state);
  const net = netWealth(state);
  const yearlyIncome = state.assets.reduce((s, a) => s + assetYearlyIncome(a), 0);

  const saveAsset = (a: Asset) => {
    update((s) => {
      const exists = s.assets.some((x) => x.id === a.id);
      return {
        ...s,
        assets: exists ? s.assets.map((x) => (x.id === a.id ? a : x)) : [...s.assets, a],
      };
    });
    setAssetDraft(null);
  };
  const delAsset = (id: string) =>
    update((s) => ({ ...s, assets: s.assets.filter((x) => x.id !== id) }));

  const saveLiab = (l: Liability) => {
    update((s) => {
      const exists = s.liabilities.some((x) => x.id === l.id);
      return {
        ...s,
        liabilities: exists
          ? s.liabilities.map((x) => (x.id === l.id ? l : x))
          : [...s.liabilities, l],
      };
    });
    setLiabDraft(null);
  };
  const delLiab = (id: string) =>
    update((s) => ({ ...s, liabilities: s.liabilities.filter((x) => x.id !== id) }));

  return (
    <>
      <PageHeader
        eyebrow="02 — Patrimoine"
        title={
          <>
            Actifs & <em>passifs</em>
          </>
        }
        lede="Tes actifs forment le patrimoine brut ; tes passifs s'en déduisent pour donner le patrimoine net."
      />

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

      {/* ---------------- ACTIFS ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2>Actifs</h2>
          <span className="count">{state.assets.length}</span>
          <span className="spacer" />
          {yearlyIncome > 0 && (
            <span className="tag" style={{ borderColor: "var(--line-brass)", color: "var(--gain)" }}>
              <span className="dot gain" /> {signedMoney(yearlyIncome)} / an de revenus
            </span>
          )}
          <button className="btn btn-brass" onClick={() => setAssetDraft(emptyAsset())}>
            <IconPlus size={16} /> Ajouter
          </button>
        </div>

        {state.assets.length === 0 ? (
          <div className="empty">
            <IconBox size={26} />
            <div>Aucun actif pour l'instant.<br />Ajoute un bien immobilier, un livret, un placement…</div>
          </div>
        ) : (
          <div className="rows">
            {state.assets.map((a, i) => {
              const Meta = ASSET_META[a.category];
              const inc = assetYearlyIncome(a);
              return (
                <motion.div
                  key={a.id}
                  className="row"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i, duration: 0.3 }}
                >
                  <div className="row-ic">
                    <Meta.icon size={20} />
                  </div>
                  <div className="row-main">
                    <div className="row-title">{a.label || Meta.label}</div>
                    <div className="row-meta">
                      <span>{Meta.label}</span>
                      {a.incomeMode === "rate" && a.incomeRate ? (
                        <>· <span>revenu {percent(a.incomeRate)} versé</span></>
                      ) : a.incomeMode === "amount" ? (
                        <>· <span>revenu {money(a.income?.amount ?? 0)} {periodLabel(a.income?.period ?? "monthly")}</span></>
                      ) : null}
                      {a.growthRate !== 0 && (
                        <span className="tag" style={{ color: a.growthRate < 0 ? "var(--drain)" : "var(--sage)" }}>
                          {a.growthRate > 0 ? "↗" : "↘"} valeur {a.growthRate > 0 ? "+" : ""}{percent(a.growthRate)}/an
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="row-val">
                    {money(a.value)}
                    <div className={"flux " + (inc <= 0 ? "zero" : "")}>
                      {inc > 0 ? signedMoney(inc) + " /an" : "pas de revenu"}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button className="icon-btn" onClick={() => setAssetDraft({ ...a })} aria-label="Modifier">
                      <IconEdit size={16} />
                    </button>
                    <button className="icon-btn danger" onClick={() => delAsset(a.id)} aria-label="Supprimer">
                      <IconTrash size={16} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------- PASSIFS ---------------- */}
      <section className="section">
        <div className="section-head">
          <h2>Passifs</h2>
          <span className="count">{state.liabilities.length}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => setLiabDraft(emptyLiab())}>
            <IconPlus size={16} /> Ajouter
          </button>
        </div>

        {state.liabilities.length === 0 ? (
          <div className="empty">
            <IconDebt size={26} />
            <div>Aucun passif.<br />Ajoute un emprunt, un crédit ou une dette.</div>
          </div>
        ) : (
          <div className="rows">
            {state.liabilities.map((l, i) => (
              <motion.div
                key={l.id}
                className="row"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.3 }}
              >
                <div className="row-ic" style={{ color: "var(--drain)" }}>
                  <IconDebt size={20} />
                </div>
                <div className="row-main">
                  <div className="row-title">{l.label || LIAB_META[l.category].label}</div>
                  <div className="row-meta">
                    <span>{LIAB_META[l.category].label}</span>
                    {!!l.monthlyPayment && <>· <span>mensualité {money(l.monthlyPayment)}/mois</span></>}
                    {!!l.rate && <>· <span>taux {percent(l.rate)}</span></>}
                    {!!l.termMonths && (
                      <span className="tag">
                        reste {formatDuration(l.termMonths)} · fin {formatEndDate(l.termMonths)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="row-val" style={{ color: "var(--drain)" }}>
                  −{money(l.outstanding)}
                  <div className="flux zero">capital restant dû</div>
                </div>
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => setLiabDraft({ ...l })} aria-label="Modifier">
                    <IconEdit size={16} />
                  </button>
                  <button className="icon-btn danger" onClick={() => delLiab(l.id)} aria-label="Supprimer">
                    <IconTrash size={16} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {assetDraft && (
        <AssetModal
          draft={assetDraft}
          onChange={setAssetDraft}
          onSave={saveAsset}
          onClose={() => setAssetDraft(null)}
        />
      )}
      {liabDraft && (
        <LiabilityModal
          draft={liabDraft}
          onChange={setLiabDraft}
          onSave={saveLiab}
          onClose={() => setLiabDraft(null)}
        />
      )}
    </>
  );
}

/* ----------------------- ASSET MODAL ----------------------- */
function AssetModal({
  draft,
  onChange,
  onSave,
  onClose,
}: {
  draft: Asset;
  onChange: (a: Asset) => void;
  onSave: (a: Asset) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Asset>) => onChange({ ...draft, ...patch });
  const modes: { id: Asset["incomeMode"]; label: string }[] = [
    { id: "none", label: "Aucun" },
    { id: "rate", label: "Taux %" },
    { id: "amount", label: "Montant" },
  ];

  return (
    <Modal
      open
      title={draft.label ? "Modifier l'actif" : "Nouvel actif"}
      subtitle="La valeur alimente le patrimoine brut. Le revenu (optionnel) alimentera les flux entrants."
      onClose={onClose}
    >
      <div className="form-grid">
        <div className="field span-2">
          <label>Libellé</label>
          <input
            className="input"
            autoFocus
            placeholder="ex. Appartement Lyon, Livret A…"
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Catégorie</label>
          <select
            className="select"
            value={draft.category}
            onChange={(e) => set({ category: e.target.value as AssetCategory })}
          >
            {Object.entries(ASSET_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Valeur (€)</label>
          <input
            className="input mono"
            type="number"
            inputMode="decimal"
            value={draft.value || ""}
            onChange={(e) => set({ value: Number(e.target.value) })}
          />
        </div>

        {/* --- Bloc 1 : croissance capitalisée --- */}
        <div className="span-2 form-block">
          <div className="block-title">
            <span className="dot sage" /> Croissance de la valeur · <span className="block-tag">capitalisée</span>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Évolution de la valeur (%/an)</label>
            <input
              className="input mono"
              type="number"
              step="0.01"
              placeholder="ex. +6 PEA · +2 immo · −15 voiture · 0 stable"
              value={draft.growthRate || ""}
              onChange={(e) => set({ growthRate: Number(e.target.value) })}
            />
            <span className="help">
              Le gain reste dans l'actif et <b>se compose</b> dans la projection. Négatif pour un bien qui se déprécie.
            </span>
          </div>
        </div>

        {/* --- Bloc 2 : revenu distribué --- */}
        <div className="span-2 form-block">
          <div className="block-title">
            <span className="dot gain" /> Revenu distribué · <span className="block-tag">flux entrant</span>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Type de revenu perçu</label>
            <div className="segment">
              {modes.map((m) => (
                <button key={m.id} data-on={draft.incomeMode === m.id} onClick={() => set({ incomeMode: m.id })}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {draft.incomeMode === "rate" && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Revenu versé, en % de la valeur (par an)</label>
              <input
                className="input mono"
                type="number"
                step="0.01"
                placeholder="ex. 4 pour un rendement locatif"
                value={draft.incomeRate || ""}
                onChange={(e) => set({ incomeRate: Number(e.target.value) })}
              />
            </div>
          )}

          {draft.incomeMode === "amount" && (
            <div className="form-grid" style={{ marginTop: 14 }}>
              <div className="field">
                <label>Montant perçu (€)</label>
                <input
                  className="input mono"
                  type="number"
                  value={draft.income?.amount || ""}
                  onChange={(e) =>
                    set({ income: { amount: Number(e.target.value), period: draft.income?.period ?? "monthly" } })
                  }
                />
              </div>
              <div className="field">
                <label>Périodicité</label>
                <PeriodSegment
                  value={draft.income?.period ?? "monthly"}
                  onChange={(period) => set({ income: { amount: draft.income?.amount ?? 0, period } })}
                />
              </div>
            </div>
          )}
          <span className="help" style={{ marginTop: 10 }}>
            Le gain est <b>perçu en cash</b> (loyer, dividende) : il alimente les flux et reste <b>à plat</b>, sans se composer.
          </span>
        </div>
      </div>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-brass" onClick={() => onSave(draft)} disabled={!draft.label.trim()}>
          Enregistrer
        </button>
      </div>
    </Modal>
  );
}

/* --------------------- LIABILITY MODAL --------------------- */
function LiabilityModal({
  draft,
  onChange,
  onSave,
  onClose,
}: {
  draft: Liability;
  onChange: (l: Liability) => void;
  onSave: (l: Liability) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<Liability>) => onChange({ ...draft, ...patch });
  const [unit, setUnit] = useState<"years" | "months">(
    draft.termMonths && draft.termMonths % 12 !== 0 ? "months" : "years"
  );

  const auto = draft.autoPayment ?? true;
  const isLoan = draft.category === "emprunt_immo" || draft.category === "credit_conso" || draft.category === "credit_auto";
  const computed = monthlyPayment(draft.outstanding, draft.rate ?? 0, draft.termMonths ?? 0);

  const termInput = unit === "years" ? (draft.termMonths ?? 0) / 12 : draft.termMonths ?? 0;
  const setTerm = (v: number) => set({ termMonths: Math.round(unit === "years" ? v * 12 : v) });

  const handleSave = () =>
    onSave({ ...draft, monthlyPayment: auto ? computed : draft.monthlyPayment ?? 0 });

  return (
    <Modal
      open
      title={draft.label ? "Modifier le passif" : "Nouveau passif"}
      subtitle="Le capital restant dû réduit le patrimoine net. Pour un emprunt, la durée fixe la date de fin et la mensualité se calcule seule."
      onClose={onClose}
    >
      <div className="form-grid">
        <div className="field span-2">
          <label>Libellé</label>
          <input
            className="input"
            autoFocus
            placeholder="ex. Prêt résidence principale"
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Catégorie</label>
          <select
            className="select"
            value={draft.category}
            onChange={(e) => set({ category: e.target.value as LiabilityCategory })}
          >
            {Object.entries(LIAB_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Capital restant dû (€)</label>
          <input
            className="input mono"
            type="number"
            value={draft.outstanding || ""}
            onChange={(e) => set({ outstanding: Number(e.target.value) })}
          />
        </div>

        {isLoan && (
          <>
            <div className="field">
              <label>Taux d'intérêt annuel (%)</label>
              <input
                className="input mono"
                type="number"
                step="0.01"
                placeholder="ex. 3.4"
                value={draft.rate || ""}
                onChange={(e) => set({ rate: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Durée restante</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input mono"
                  type="number"
                  step={unit === "years" ? "0.5" : "1"}
                  style={{ flex: 1 }}
                  placeholder={unit === "years" ? "ex. 18" : "ex. 216"}
                  value={termInput || ""}
                  onChange={(e) => setTerm(Number(e.target.value))}
                />
                <div className="segment">
                  <button data-on={unit === "years"} onClick={() => setUnit("years")}>ans</button>
                  <button data-on={unit === "months"} onClick={() => setUnit("months")}>mois</button>
                </div>
              </div>
            </div>

            <div className="field span-2">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ margin: 0 }}>Mensualité (€/mois)</label>
                <label className="auto-toggle">
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={(e) => set({ autoPayment: e.target.checked })}
                  />
                  Calcul automatique
                </label>
              </div>
              <input
                className="input mono"
                type="number"
                readOnly={auto}
                style={auto ? { color: "var(--brass-bright)", opacity: 0.95 } : undefined}
                value={auto ? (computed ? computed.toFixed(2) : "") : draft.monthlyPayment || ""}
                onChange={(e) => set({ monthlyPayment: Number(e.target.value) })}
              />
              <span className="help">
                {auto ? (
                  <>Calculée à partir du capital, du taux et de la durée restante.</>
                ) : (
                  <>Saisie manuelle (utile si la mensualité inclut l'assurance, par ex.).</>
                )}
                {draft.termMonths ? <> Fin estimée du prêt : <b>{formatEndDate(draft.termMonths)}</b> ({formatDuration(draft.termMonths)}).</> : null}
              </span>
            </div>
          </>
        )}

        {!isLoan && (
          <div className="field">
            <label>Mensualité (€/mois)</label>
            <input
              className="input mono"
              type="number"
              value={draft.monthlyPayment || ""}
              onChange={(e) => set({ monthlyPayment: Number(e.target.value), autoPayment: false })}
            />
          </div>
        )}
      </div>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-brass" onClick={handleSave} disabled={!draft.label.trim()}>
          Enregistrer
        </button>
      </div>
    </Modal>
  );
}

function PeriodSegment({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="segment">
      <button data-on={value === "monthly"} onClick={() => onChange("monthly")}>Mensuel</button>
      <button data-on={value === "yearly"} onClick={() => onChange("yearly")}>Annuel</button>
    </div>
  );
}
