import { useMemo, useState } from "react";
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
  ASSET_CATEGORIES,
  assetType,
  hasField,
  emptyAssetOf,
  normalizeAsset,
  type AssetPreset,
} from "../lib/assets";
import {
  assetPerformance,
  assetYearlyIncome,
  assetYearlyNet,
  grossWealth,
  netWealth,
  totalLiabilities,
} from "../lib/selectors";
import { money, signedMoney, percent, uid, toYearly } from "../lib/format";
import { monthlyPayment, formatDuration, formatEndDate } from "../lib/finance";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import { PerformanceBadge, perfColor, Segment } from "../ui";
import { IconBox, IconDebt, IconEdit, IconPlus, IconTrash } from "../components/icons";

type AssetSort = "ordre" | "perf" | "valeur";
const SORT_OPTIONS: { value: AssetSort; label: string }[] = [
  { value: "ordre", label: "Ordre" },
  { value: "perf", label: "Rendement" },
  { value: "valeur", label: "Valeur" },
];

const LIAB_META: Record<LiabilityCategory, { label: string }> = {
  emprunt_immo: { label: "Emprunt immobilier" },
  credit: { label: "Crédit" },
  autre: { label: "Autre" },
};

const emptyAsset = (): Asset => emptyAssetOf("immobilier", uid());

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

  const [sort, setSort] = useState<AssetSort>("ordre");

  const gross = grossWealth(state);
  const liab = totalLiabilities(state);
  const net = netWealth(state);
  // revenu NET (revenus distribués − charges de détention) : le vrai bénéfice du patrimoine
  const yearlyNet = state.assets.reduce((s, a) => s + assetYearlyNet(a), 0);

  // ordre d'affichage (n'altère pas le store — tri de vue seulement)
  const sortedAssets = useMemo(() => {
    const list = state.assets.map((a, i) => ({ a, i }));
    if (sort === "perf") list.sort((x, y) => assetPerformance(y.a).pct - assetPerformance(x.a).pct);
    else if (sort === "valeur") list.sort((x, y) => (y.a.value || 0) - (x.a.value || 0));
    return list.map((x) => x.a);
  }, [state.assets, sort]);

  const saveAsset = (raw: Asset) => {
    // coupe les champs qu'une catégorie n'expose pas (revenu d'un immo « non loué »…)
    const a = normalizeAsset(raw);
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
          {state.assets.length > 1 && (
            <Segment aria-label="Trier les actifs" value={sort} onChange={setSort} options={SORT_OPTIONS} />
          )}
          {yearlyNet !== 0 && (
            <span className="tag" style={{ borderColor: "var(--line-brass)", color: yearlyNet >= 0 ? "var(--gain)" : "var(--drain)" }}>
              <span className="dot" style={{ background: yearlyNet >= 0 ? "var(--gain)" : "var(--drain)" }} /> {signedMoney(yearlyNet)} / an net
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
            {sortedAssets.map((a, i) => {
              const Meta = assetType(a.category);
              const inc = assetYearlyIncome(a);
              const chg = toYearly(a.charges);
              const net = inc - chg; // bénéfice réel de détention
              const perf = assetPerformance(a);
              const perfCol = perfColor(perf.pct);
              const sp = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${percent(Math.abs(x))}`;
              const perfTitle =
                `Rendement total ${sp(perf.pct)} /an` +
                (perf.cashPct ? ` · valeur ${sp(perf.latentPct)} · distribué net ${sp(perf.cashPct)}` : "");
              return (
                <motion.div
                  key={a.id}
                  className="row"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i, duration: 0.3 }}
                >
                  {/* accent de performance de la ligne (§8) */}
                  <span className="perf-bar" style={{ background: perfCol }} aria-hidden />
                  <div className="row-ic">
                    <Meta.icon size={20} />
                  </div>
                  <div className="row-main">
                    <div className="row-title">{a.label || Meta.label}</div>
                    <div className="row-meta">
                      <span>{Meta.label}</span>
                      {a.incomeMode === "rate" && a.incomeRate ? (
                        <>· <span style={{ color: "var(--gain)" }}>revenu {percent(a.incomeRate)} versé · {money(inc)} /an</span></>
                      ) : a.incomeMode === "amount" && inc > 0 ? (
                        <>· <span style={{ color: "var(--gain)" }}>revenu {money(inc)} /an</span></>
                      ) : null}
                      {chg > 0 && <>· <span style={{ color: "var(--drain)" }}>charges {money(chg)} /an</span></>}
                      {(perf.pct !== 0 || a.growthRate !== 0) && <PerformanceBadge pct={perf.pct} title={perfTitle} />}
                    </div>
                  </div>
                  <div className="row-val">
                    {money(a.value)}
                    {/* bénéfice NET de détention : revenu distribué − charges */}
                    {inc === 0 && chg === 0 ? (
                      <div className="flux zero">pas de revenu</div>
                    ) : (
                      <div className="flux" style={{ color: net >= 0 ? "var(--gain)" : "var(--drain)" }}
                        title={chg > 0 ? `revenu ${money(inc)} − charges ${money(chg)}` : undefined}>
                        {signedMoney(net)} /an net
                      </div>
                    )}
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
  const t = assetType(draft.category);
  const show = (f: Parameters<typeof hasField>[1]) => hasField(draft.category, f);
  const modes: { id: Asset["incomeMode"]; label: string }[] = [
    { id: "none", label: "Aucun" },
    { id: "rate", label: "Taux %" },
    { id: "amount", label: "Montant" },
  ];

  // changer de catégorie normalise les champs comportementaux non exposés
  const setCategory = (category: AssetCategory) =>
    onChange(normalizeAsset({ ...draft, category }));
  const applyPreset = (p: AssetPreset) => onChange({ ...draft, ...p.patch });
  // bascule loué : révèle/masque le revenu (immobilier)
  const setRented = (rented: boolean) =>
    onChange({
      ...draft,
      rented,
      incomeMode: rented ? (draft.incomeMode === "none" ? "amount" : draft.incomeMode) : "none",
    });

  // le revenu s'affiche si la catégorie l'expose (et, pour l'immobilier, si loué)
  const showIncome = show("income") && (!show("rented") || draft.rented === true);

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
            onChange={(e) => setCategory(e.target.value as AssetCategory)}
          >
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{assetType(c).label}</option>
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

        {/* --- Presets (pré-remplissage en un clic) --- */}
        {t.presets.length > 0 && (
          <div className="field span-2">
            <label>Modèles — {t.label}</label>
            <div className="preset-row">
              {t.presets.map((p) => (
                <button key={p.label} type="button" className="preset-chip" title={p.hint} onClick={() => applyPreset(p)}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="help">{t.help}</span>
          </div>
        )}

        {/* --- Immobilier : bascule loué --- */}
        {show("rented") && (
          <div className="field span-2">
            <label>Ce bien est-il loué ?</label>
            <div className="segment">
              <button data-on={draft.rented === true} onClick={() => setRented(true)}>Loué (rapporte un loyer)</button>
              <button data-on={!draft.rented} onClick={() => setRented(false)}>Non loué</button>
            </div>
          </div>
        )}

        {/* --- Bloc 1 : croissance capitalisée --- */}
        {show("growth") && (
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
              Le gain reste dans l'actif et <b>se compose</b> dans la projection. Négatif pour un bien qui se déprécie, positif pour un bien qui s'apprécie.
            </span>
          </div>
          {show("volatility") && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Volatilité (%/an) — optionnel</label>
            <input
              className="input mono"
              type="number"
              step="0.5"
              placeholder="ex. 15 actions · 8 immo · 0 livret"
              value={draft.volatility ?? ""}
              onChange={(e) => set({ volatility: e.target.value ? Number(e.target.value) : undefined })}
            />
            <span className="help">
              Écart-type annuel du rendement, utilisé par la <b>Probabilité de succès</b> (Monte Carlo).
              La projection déterministe n'en tient pas compte. Vide = rendement certain.
            </span>
          </div>
          )}
          {show("floor") && draft.growthRate < 0 && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Valeur plancher (€) — optionnel</label>
              <input
                className="input mono"
                type="number"
                placeholder="ex. valeur résiduelle d'une voiture"
                value={draft.valueFloor ?? ""}
                onChange={(e) => set({ valueFloor: e.target.value ? Number(e.target.value) : undefined })}
              />
              <span className="help">La dépréciation ne descendra pas sous ce plancher dans la projection.</span>
            </div>
          )}
        </div>
        )}

        {/* --- Bloc 2 : revenu distribué --- */}
        {showIncome && (
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
        )}

        {/* --- Bloc 3 : charges récurrentes --- */}
        {show("charges") && (
        <div className="span-2 form-block">
          <div className="block-title">
            <span className="dot drain" /> Charges récurrentes · <span className="block-tag">flux sortant</span>
          </div>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label>Montant des charges (€)</label>
              <input
                className="input mono"
                type="number"
                placeholder="taxe foncière, copro, assurance…"
                value={draft.charges?.amount || ""}
                onChange={(e) => set({ charges: { amount: Number(e.target.value), period: draft.charges?.period ?? "yearly" } })}
              />
            </div>
            <div className="field">
              <label>Périodicité</label>
              <PeriodSegment
                value={draft.charges?.period ?? "yearly"}
                onChange={(period) => set({ charges: { amount: draft.charges?.amount ?? 0, period } })}
              />
            </div>
          </div>
          <span className="help" style={{ marginTop: 10 }}>
            Coûts de détention (taxe foncière, charges de copro, assurance PNO…). Déduits des flux, ils permettent le rendement net.
          </span>
        </div>
        )}

        {/* --- Bloc 4 : versements (surplus de la projection) --- */}
        {show("deposits") && (
          <div className="span-2 form-block">
            <div className="block-title">
              <span className="dot brass" /> Versements · <span className="block-tag">projection</span>
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Plafond de versements (€) — optionnel</label>
                <input
                  className="input mono"
                  type="number"
                  placeholder="ex. 150 000 pour un PEA"
                  value={draft.depositCap ?? ""}
                  onChange={(e) => set({ depositCap: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
              <div className="field">
                <label>Versements déjà effectués (€)</label>
                <input
                  className="input mono"
                  type="number"
                  placeholder="0"
                  value={draft.depositsMade ?? ""}
                  onChange={(e) => set({ depositsMade: e.target.value ? Number(e.target.value) : undefined })}
                />
              </div>
            </div>
            <span className="help" style={{ marginTop: 10 }}>
              Cet actif peut recevoir le <b>surplus d'épargne</b> de la projection. Le plafond porte sur les
              <b> dépôts cumulés</b> (ex. 150 000 € pour un PEA) : une fois atteint, les versements s'arrêtent —
              la valeur, elle, peut le dépasser par la croissance.
            </span>
          </div>
        )}
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
  const isLoan = draft.category === "emprunt_immo" || draft.category === "credit";
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

            <div className="field span-2">
              <label>Assurance emprunteur (€/mois) — optionnel</label>
              <input
                className="input mono"
                type="number"
                placeholder="en plus de la mensualité"
                value={draft.insurance || ""}
                onChange={(e) => set({ insurance: Number(e.target.value) })}
              />
              <span className="help">Coût réel qui s'ajoute à la mensualité (ne rembourse pas de capital).</span>
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
