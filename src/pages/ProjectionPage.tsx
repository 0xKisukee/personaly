import { Fragment, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useStore } from "../lib/store";
import type { AssetCategory, PlannedEvent, ProjectionParams } from "../lib/types";
import { canReceiveDeposits } from "../lib/types";
import { project, type ProjectionEvent, type YearDetail, type YearPoint } from "../lib/projection";
import { grossWealth, totalLiabilities } from "../lib/selectors";
import { money, signedMoney, percent, uid } from "../lib/format";
import { formatDuration } from "../lib/finance";
import PageHeader from "../components/PageHeader";
import Modal from "../components/Modal";
import { IconChart, IconChevron, IconEdit, IconPlus, IconTrash } from "../components/icons";

const HORIZONS = [10, 20, 30, 40];

/* ----------------------- ÉVÉNEMENTS : helpers ----------------------- */

const CAT_LABELS: Record<AssetCategory, string> = {
  immobilier: "Immobilier", compte_courant: "Compte courant", livret_epargne: "Livret d'épargne",
  placement: "Placement", vehicule: "Véhicule", autre: "Autre",
};

const emptyEvent = (year: number): PlannedEvent => ({
  id: uid(), kind: "cash", label: "", year: Math.min(new Date().getFullYear() + 1, year), amount: 0,
});

/** Bascule le type d'un brouillon en conservant id / libellé / année. */
function switchKind(ev: PlannedEvent, kind: PlannedEvent["kind"], s: AppStateLike): PlannedEvent {
  const base = { id: ev.id, label: ev.label, year: ev.year };
  switch (kind) {
    case "cash": return { ...base, kind, amount: 0 };
    case "buy": return {
      ...base, kind, price: 0, fees: 0,
      asset: { id: uid(), label: "", category: "immobilier", value: 0, growthRate: 0, incomeMode: "none" },
    };
    case "sell": return { ...base, kind, assetId: sellableAssets(s)[0]?.id ?? "", feesPct: 0 };
    case "loan": return { ...base, kind, amount: 0, rate: 0, termMonths: 240 };
    case "repay": return { ...base, kind, loanId: repayableLoans(s)[0]?.id ?? "" };
  }
}

interface AppStateLike {
  assets: { id: string; label: string }[];
  liabilities: { id: string; label: string }[];
  events: PlannedEvent[];
}

/** Actifs vendables : existants + créés par un événement "buy". */
function sellableAssets(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.assets.map((a) => ({ id: a.id, label: a.label || "Actif" })),
    ...s.events.filter((e) => e.kind === "buy").map((e) => ({ id: e.asset.id, label: `${e.label || "Achat"} (${e.year})` })),
  ];
}

/** Emprunts remboursables : passifs existants + créés par un événement "loan". */
function repayableLoans(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.liabilities.map((l) => ({ id: l.id, label: l.label || "Emprunt" })),
    ...s.events.filter((e) => e.kind === "loan").map((e) => ({ id: e.id, label: `${e.label || "Emprunt"} (${e.year})` })),
  ];
}

function eventSummary(ev: PlannedEvent, s: AppStateLike): string {
  switch (ev.kind) {
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
  }
}

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const compactEur = (n: number) => compact.format(n) + " €";

export default function ProjectionPage() {
  const { state, update } = useStore();
  const p = state.projection;
  const [chartMode, setChartMode] = useState<"net" | "composition">("net");
  const [selYear, setSelYear] = useState<number | null>(null);
  const setP = (patch: Partial<ProjectionParams>) =>
    update((s) => ({ ...s, projection: { ...s.projection, ...patch } }));

  const { points, events, warnings, fiYearIndex } = useMemo(() => project(state, p), [state, p]);
  const [evDraft, setEvDraft] = useState<PlannedEvent | null>(null);

  const hasData =
    grossWealth(state) > 0 || totalLiabilities(state) > 0 || state.incomes.length > 0 ||
    state.expenses.length > 0 || state.events.length > 0;

  const saveEvent = (ev: PlannedEvent) => {
    update((s) => {
      const exists = s.events.some((x) => x.id === ev.id);
      return { ...s, events: exists ? s.events.map((x) => (x.id === ev.id ? ev : x)) : [...s.events, ev] };
    });
    setEvDraft(null);
  };
  const delEvent = (id: string) => update((s) => ({ ...s, events: s.events.filter((x) => x.id !== id) }));
  const sortedEvents = [...state.events].sort((a, b) => a.year - b.year);

  const now = points[0];
  const end = points[points.length - 1];
  const delta = end.netWorth - now.netWorth;
  const mult = now.netWorth > 0 ? end.netWorth / now.netWorth : null;
  const cagr = now.netWorth > 0 && end.netWorth > 0 ? (Math.pow(end.netWorth / now.netWorth, 1 / p.horizon) - 1) * 100 : null;
  const fiPoint = fiYearIndex !== null ? points[fiYearIndex] : null;

  // cascade d'affectation du surplus : cibles valides, dans l'ordre, sans doublon
  const eligibleAssets = state.assets.filter(canReceiveDeposits);
  const targets = (p.surplusTargets ?? [])
    .map((id) => eligibleAssets.find((a) => a.id === id))
    .filter((a, i, arr) => a && arr.indexOf(a) === i) as typeof eligibleAssets;
  const targetIds = targets.map((a) => a.id);
  const availableTargets = eligibleAssets.filter((a) => !targetIds.includes(a.id));
  const setTargets = (ids: string[]) => setP({ surplusTargets: ids.length ? ids : undefined });

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
          {/* --------- hypothèses --------- */}
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
            <div className="field assum-surplus">
              <label>Affectation du surplus</label>
              <div className="assum-cascade">
                {targets.map((a, i) => {
                  const capLeft = a.depositCap != null ? Math.max(0, a.depositCap - (a.depositsMade || 0)) : null;
                  const options = eligibleAssets.filter((x) => x.id === a.id || !targetIds.includes(x.id));
                  return (
                    <Fragment key={a.id}>
                      {i > 0 && <span className="assum-unit">→</span>}
                      <span className="cascade-item">
                        <select
                          className="select"
                          value={a.id}
                          onChange={(e) => setTargets(targetIds.map((id, k) => (k === i ? e.target.value : id)))}
                        >
                          {options.map((x) => (
                            <option key={x.id} value={x.id}>{x.label || "Actif"} · {percent(x.growthRate)}/an</option>
                          ))}
                        </select>
                        <button
                          className="icon-btn"
                          onClick={() => setTargets(targetIds.filter((_, k) => k !== i))}
                          aria-label="Retirer de la cascade"
                        >×</button>
                        {capLeft != null && <span className="help">reste {money(capLeft)} à verser</span>}
                      </span>
                    </Fragment>
                  );
                })}
                {availableTargets.length > 0 && (
                  <>
                    {targets.length > 0 && <span className="assum-unit">→</span>}
                    <select
                      className="select cascade-add"
                      value=""
                      onChange={(e) => e.target.value && setTargets([...targetIds, e.target.value])}
                    >
                      <option value="">{targets.length ? "+ Ajouter…" : "Épargne (défaut)"}</option>
                      {availableTargets.map((x) => (
                        <option key={x.id} value={x.id}>{x.label || "Actif"} · {percent(x.growthRate)}/an</option>
                      ))}
                    </select>
                  </>
                )}
                {targets.length > 0 && <span className="assum-unit">→ Épargne</span>}
              </div>
            </div>
          </motion.div>

          {/* --------- événements datés --------- */}
          <section className="section" style={{ marginTop: 0, marginBottom: 24 }}>
            <div className="section-head">
              <h2>Événements</h2>
              <span className="count">{state.events.length}</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setEvDraft(emptyEvent(points[points.length - 1].year))}>
                <IconPlus size={16} /> Ajouter
              </button>
            </div>
            {sortedEvents.length > 0 && (
              <div className="rows">
                {sortedEvents.map((ev) => (
                  <div className="row" key={ev.id}>
                    <div className="row-ic" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{"⚑"}</div>
                    <div className="row-main">
                      <div className="row-title">{ev.label || "Événement"}</div>
                      <div className="row-meta">
                        <span className="tag">{ev.year}</span> · <span>{eventSummary(ev, state)}</span>
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
          </section>

          {/* --------- alertes moteur (épargne négative, événement ignoré…) --------- */}
          {warnings.slice(0, 3).map((w, i) => (
            <div key={i} className="fi-banner" style={{ borderColor: "rgba(213,152,115,0.4)", background: "rgba(213,152,115,0.07)" }}>
              <span className="fi-dot" style={{ background: "var(--drain)", boxShadow: "0 0 10px var(--drain)" }} />
              {w.label}
            </div>
          ))}

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
              </div>
              {chartMode === "composition" && (
                <div className="chart-legend">
                  <span><i style={{ background: "var(--sage)" }} /> Actifs</span>
                  <span><i style={{ background: "var(--gain)" }} /> Épargne</span>
                  <span><i style={{ background: "var(--drain)" }} /> Dettes</span>
                </div>
              )}
            </div>
            <NetWorthChart points={points} events={events} mode={chartMode} />
          </motion.div>

          {events.length > 0 && (
            <div className="proj-events">
              {events.map((e, i) => (
                <span className="tag" key={i}
                  style={e.kind === "fi"
                    ? { borderColor: "rgba(147,195,156,0.4)", color: "var(--gain)" }
                    : { borderColor: "var(--line-brass)", color: "var(--brass-bright)" }}>
                  {e.kind === "fi" ? "◆" : "⚑"} {e.label} · {e.year}
                </span>
              ))}
            </div>
          )}

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
            {targets.length > 0
              ? <> Le surplus mensuel est versé en cascade dans <b>{targets.map((t) => t.label || "actif").join(" → ")}</b> (plafonds de versements respectés), le reste en épargne ; les déficits restent portés par l'épargne.</>
              : <> L'épargne réalisée est réinvestie à {percent(p.savingsYield)}/an.</>}
            {" "}Estimation, hors fiscalité.
          </p>
        </>
      )}

      {selPoint && (
        <YearDetailModal point={selPoint} real={p.realTerms} onClose={() => setSelYear(null)} />
      )}
      {evDraft && (
        <EventModal draft={evDraft} s={state} onChange={setEvDraft} onSave={saveEvent} onClose={() => setEvDraft(null)} />
      )}
    </>
  );
}

/* ----------------------- EVENT MODAL ----------------------- */

const EVENT_KINDS: { id: PlannedEvent["kind"]; label: string }[] = [
  { id: "cash", label: "Rentrée / Sortie" },
  { id: "buy", label: "Achat" },
  { id: "sell", label: "Vente" },
  { id: "loan", label: "Emprunt" },
  { id: "repay", label: "Remboursement" },
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

  const valid =
    draft.label.trim().length > 0 &&
    draft.year >= currentYear &&
    (draft.kind === "cash" ? draft.amount !== 0
      : draft.kind === "buy" ? draft.price > 0
      : draft.kind === "sell" ? !!draft.assetId
      : draft.kind === "loan" ? draft.amount > 0 && draft.termMonths > 0
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
          <div className="segment">
            {EVENT_KINDS.map((k) => (
              <button key={k.id} data-on={draft.kind === k.id} onClick={() => onChange(switchKind(draft, k.id, s))}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Libellé</label>
          <input className="input" autoFocus placeholder="ex. Achat apt Lyon, Héritage…"
            value={draft.label} onChange={(e) => set({ label: e.target.value })} />
        </div>
        <div className="field">
          <label>Année</label>
          <input className="input mono" type="number" min={currentYear}
            value={draft.year || ""} onChange={(e) => set({ year: Number(e.target.value) })} />
        </div>

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
              s'amortit jusqu'à son terme{draft.termMonths ? ` (fin ${draft.year + Math.round(draft.termMonths / 12)})` : ""}.
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
function NetWorthChart({ points, events, mode }: { points: YearPoint[]; events: ProjectionEvent[]; mode: "net" | "composition" }) {
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
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none">
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
            <YdGroup label="Surplus investi (transfert neutre)" v={point.deposited} neutral
              subs={d.assets.filter((a) => a.deposit > 0).map((a) => ({ id: a.id, label: a.label, v: a.deposit }))} />
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
      <span className="yd-label">{label}</span>
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
