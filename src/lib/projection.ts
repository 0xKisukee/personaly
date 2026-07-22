/* ===========================================================================
   Moteur de projection patrimoniale — simulation mois par mois.

   Gère : intérêts composés des actifs (+ plancher de valeur), revenus distribués,
   charges d'actifs, revenus/dépenses manuels (bornés + revalorisés par flux),
   emprunts amortis (+ assurance) qui s'éteignent à terme, réinvestissement de
   l'épargne OU affectation du surplus en CASCADE d'actifs éligibles (chaque actif
   reçoit jusqu'à son plafond de versements, l'excédent passe au suivant, le reste
   retombe dans l'épargne ; les déficits restent portés par l'épargne),
   inflation / euros constants, et ÉVÉNEMENTS datés atomiques (achat/vente d'actif,
   nouvel emprunt, rentrée/sortie, remboursement anticipé — voir types.ts pour
   l'ordre d'application et les règles comptables).

   Chaque point d'année porte le patrimoine au DÉBUT de l'année et les FLUX qui se
   produisent PENDANT cette année-là (composition disponible via `detail`).
   L'année d'indice 0 = aujourd'hui (patrimoine courant) et ses flux = le régime de
   la 1re année ; les intérêts d'emprunt décroissent donc dès l'année suivante.
   =========================================================================== */

import type { Asset, FlowEvent, Milestone, MilestoneRef, Period, PlannedEvent, ProjectionParams, SimState, SurplusFlow } from "./types";
import { canTransfer, EPARGNE_ID, eventYear, flowBounds, refYear } from "./types";
import { toMonthly, isActiveYear } from "./format";
import { monthlyPayment } from "./finance";

/**
 * DÉPLIAGE de la récurrence : transforme chaque événement récurrent en une suite
 * d'instances datées atomiques, AVANT la simulation. Les événements non récurrents
 * (ou d'un type non récurrable) passent tels quels. Les instances portent un id
 * dérivé (`${id}~${k}`) — la source se retrouve en tronquant après le `~` (les ids
 * d'`uid()` n'en contiennent pas), ce qui permet d'éditer le motif depuis un
 * marqueur du graphe.
 *
 *  - CASH / VERSEMENT / EMPRUNT : simple RÉPÉTITION du même `amount` (un emprunt
 *    récurrent + un achat récurrent de même cadence = un achat FINANCÉ répété,
 *    ex. changer de voiture à crédit tous les 10 ans).
 *  - ACHAT : REMPLACEMENT. Chaque nouvelle instance revend d'abord la précédente
 *    (vente à la valeur projetée → neutre), puis achète un actif neuf (nouvel id).
 *    `keepLast` (défaut) garde la dernière ; sinon elle est revendue à l'échéance
 *    suivante (si elle tombe dans l'horizon).
 *
 * Le dépliage n'applique QUE le `scaling` (réévaluation réelle, facteur (1+scaling)^k).
 * L'INFLATION n'est PAS gérée ici : le moteur indexe TOUT montant d'événement (récurrent
 * ou non) sur l'inflation à son année, sauf si `nominal:true` (cf. `evInfl` dans project()).
 * Les instances héritent du flag `nominal` du motif source (spread `...ev`).
 */
const RECURRABLE_KINDS: PlannedEvent["kind"][] = ["buy", "cash", "loan", "transfer"];

export function expandRecurring(
  events: PlannedEvent[], milestones: Milestone[], startYear: number, horizon: number
): PlannedEvent[] {
  const endMax = startYear + horizon;
  const out: PlannedEvent[] = [];
  for (const ev of events) {
    const r = ev.recurrence;
    if (!r || ev.disabled || r.everyYears < 1 || !RECURRABLE_KINDS.includes(ev.kind)) { out.push(ev); continue; }

    const step = Math.max(1, Math.round(r.everyYears));
    const base = eventYear(ev, milestones);
    const stop = Math.min(refYear(r.untilRef, milestones) ?? r.untilYear ?? endMax, endMax);
    // k = 0 est TOUJOURS émis (le motif d'origine s'applique même si `until` est mal réglé),
    // puis les répétitions tant qu'elles tombent avant l'arrêt et dans l'horizon.
    const years = [base];
    for (let y = base + step; y <= stop; y += step) years.push(y);

    // seule la réévaluation RÉELLE (scaling) est appliquée ici ; l'inflation est gérée
    // uniformément par le moteur (evInfl), pour les événements récurrents comme ponctuels.
    const scaleAt = (k: number) => Math.pow(1 + (r.scaling ?? 0) / 100, k);

    if (ev.kind === "cash" || ev.kind === "loan" || ev.kind === "transfer") {
      years.forEach((y, k) => out.push({
        ...ev, id: k === 0 ? ev.id : `${ev.id}~${k}`, year: y, when: k === 0 ? ev.when : undefined,
        amount: ev.amount * scaleAt(k), recurrence: undefined,
      }));
    } else if (ev.kind === "buy") {
      let prevAssetId = "";
      years.forEach((y, k) => {
        const factor = scaleAt(k);
        const assetId = k === 0 ? ev.asset.id : `${ev.asset.id}~${k}`;
        if (k > 0) out.push({ id: `${ev.id}~s${k}`, kind: "sell", label: `Revente ${ev.label}`, year: y, assetId: prevAssetId });
        out.push({
          ...ev, id: k === 0 ? ev.id : `${ev.id}~${k}`, year: y, when: k === 0 ? ev.when : undefined,
          price: ev.price * factor, fees: ev.fees != null ? ev.fees * factor : undefined,
          asset: { ...ev.asset, id: assetId }, recurrence: undefined,
        });
        prevAssetId = assetId;
      });
      // dernière instance revendue à l'échéance suivante si `keepLast` est désactivé
      const endSale = years[years.length - 1] + step;
      if (!r.keepLast && endSale <= endMax) {
        out.push({ id: `${ev.id}~sEnd`, kind: "sell", label: `Revente ${ev.label}`, year: endSale, assetId: prevAssetId });
      }
    }
  }
  return out;
}

/** Forme minimale d'un flux consommée par le moteur (revenu/dépense OU flux d'événement). */
interface FlowLike {
  id: string; label: string; amount: number; period: Period;
  startYear?: number; endYear?: number; startRef?: MilestoneRef; endRef?: MilestoneRef; growth?: number;
  /** Flux d'événement : le montant est nominal l'année de DÉBUT (euros courants à la date),
   *  au lieu d'être en euros d'aujourd'hui. Change l'ANNÉE de référence de la revalorisation :
   *  elle compose depuis le début du flux (et non depuis aujourd'hui). Cf. `nominal` sur EventBase. */
  nominal?: boolean;
}

export interface ProjectOptions {
  /**
   * Tirage gaussien N(0,1) — active le mode STOCHASTIQUE : la croissance
   * mensuelle de chaque actif à `volatility` non nulle devient
   * μ_mensuel + (σ/√12)·z. Absent = projection déterministe (comportement sec).
   */
  gaussian?: () => number;
  /** Saute la construction du détail annuel (Monte Carlo : des centaines de runs). */
  light?: boolean;
}

export interface AssetDetail { id: string; label: string; value: number; growth: number; income: number; charges: number; deposit: number; withdrawal: number; }
export interface LoanDetail { id: string; label: string; balance: number; interest: number; principal: number; insurance: number; }
export interface FlowDetail { id: string; label: string; amount: number; }
/** Un événement appliqué cette année-là : impact cash + termes d'enrichissement (frais, PV réalisée). */
export interface EventDetail { id: string; label: string; kind: PlannedEvent["kind"]; cash: number; fees: number; gain: number; }

export interface YearDetail {
  assets: AssetDetail[];
  loans: LoanDetail[];
  incomes: FlowDetail[];
  expenses: FlowDetail[];
  events: EventDetail[];
}

export interface YearPoint {
  yearIndex: number;
  year: number;
  age: number | null;
  grossAssets: number; // au début de l'année
  debt: number;
  savings: number;
  netWorth: number;
  distributed: number; // flux pendant l'année
  extra: number;
  expenses: number;
  charges: number;
  interest: number;
  principal: number;
  insurance: number;
  growth: number;
  savingsYield: number;
  deposited: number; // surplus versé dans l'actif cible (transfert, neutre pour le patrimoine)
  withdrawn: number; // puisé dans les actifs pour combler un déficit (transfert, neutre aussi)
  eventCash: number; // rentrées/sorties ponctuelles (kind "cash") — compte dans l'enrichissement
  eventFees: number; // frais d'achat/vente — sortie sèche, compte dans l'enrichissement
  eventGain: number; // plus/moins-value réalisée (prix de vente fixé − valeur projetée)
  detail: YearDetail;
}

export interface ProjectionEvent {
  yearIndex: number;
  year: number;
  label: string;
  kind: "loan" | "fi" | "planned";
  id?: string; // id de l'événement planifié source (kind "planned") — pour l'édition depuis le graphe
}

export interface ProjectionWarning { year: number; label: string; }

export interface ProjectionResult {
  points: YearPoint[];
  events: ProjectionEvent[];
  warnings: ProjectionWarning[];
  fiYearIndex: number | null;
}

const EPS = 0.005;
const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

// détail partagé du mode light (jamais muté : ses tableaux restent vides)
const EMPTY_DETAIL: YearDetail = { assets: [], loans: [], incomes: [], expenses: [], events: [] };

interface SimAsset { id: string; label: string; a: Asset; val: number; active: boolean; }
interface SimLoan { id: string; label: string; balance: number; mRate: number; payment: number; term: number; paid: number; insurance: number; ended: boolean; }

export function project(s: SimState, params: ProjectionParams, opts: ProjectOptions = {}): ProjectionResult {
  const { horizon, savingsYield, inflation, indexExpenses, indexIncomes, realTerms, surplusTargets, withdrawalTargets } = params;

  const now = new Date();
  const startYear = now.getFullYear();
  const startMonth = now.getMonth(); // 0-11 : la 1re année ne couvre que les mois restants
  const birthYear = s.profile.birthDate ? new Date(s.profile.birthDate).getFullYear() : null;
  const ageAt = (y: number) => (birthYear ? y - birthYear : null);
  const milestones = s.milestones ?? [];

  // récurrence dépliée en instances atomiques datées (achat = remplacement, cash = répétition) ;
  // l'inflation de chaque instance est appliquée en aval par le moteur (evInfl) — cf. expandRecurring
  const allEvents = expandRecurring(s.events ?? [], milestones, startYear, horizon);

  const assets: SimAsset[] = s.assets.map((a) => ({ id: a.id, label: a.label || "Actif", a, val: a.value || 0, active: true }));
  const loans: SimLoan[] = s.liabilities.map((l) => ({
    id: l.id, label: l.label || "Emprunt", balance: l.outstanding || 0,
    mRate: (l.rate ?? 0) / 100 / 12, payment: l.monthlyPayment || 0,
    term: l.termMonths && l.termMonths > 0 ? l.termMonths : Infinity, paid: 0,
    insurance: l.insurance || 0, ended: (l.outstanding || 0) <= EPS || (l.monthlyPayment || 0) <= 0,
  }));

  const points: YearPoint[] = [];
  const events: ProjectionEvent[] = [];
  const warnings: ProjectionWarning[] = [];
  let fiYearIndex: number | null = null;

  // les événements FLUX (récurrents) sont traités comme des revenus/dépenses du
  // plan, pas comme des événements ponctuels : on les replie dans les flux
  // mensuels. `year`/`when` = début, `endYear`/`endRef` = fin. Leur libellé porte
  // un préfixe ⚑ dans le détail pour les distinguer des flux des finances courantes.
  const flowEvents = allEvents.filter((e): e is FlowEvent => e.kind === "flow" && !e.disabled);
  const asFlowItem = (e: FlowEvent): FlowLike => ({
    id: e.id, label: `⚑ ${e.label || "Flux"}`, amount: e.amount, period: e.period,
    startYear: e.year, startRef: e.when, endYear: e.endYear, endRef: e.endRef, growth: e.growth, nominal: e.nominal,
  });
  const incomes: FlowLike[] = [...s.incomes, ...flowEvents.filter((e) => e.direction === "in").map(asFlowItem)];
  const expenses: FlowLike[] = [...s.expenses, ...flowEvents.filter((e) => e.direction === "out").map(asFlowItem)];

  // événements PONCTUELS datés dans l'horizon, groupés par année d'application ;
  // l'année effective résout l'ancrage jalon (l'instantané `year` sert de secours
  // si le jalon a été supprimé — on le signale). Dans une même année, le cash ENTRE
  // d'abord (ventes, rentrées, emprunts) puis SORT (remboursements, achats).
  const EVENT_ORDER: Record<PlannedEvent["kind"], number> = { flow: -1, sell: 0, cash: 1, loan: 2, repay: 3, buy: 4, transfer: 5 };
  const plannedByYear = new Map<number, Exclude<PlannedEvent, FlowEvent>[]>();
  for (const ev of allEvents) {
    if (ev.disabled || ev.kind === "flow") continue;
    const y = eventYear(ev, milestones);
    if (ev.when && refYear(ev.when, milestones) === null) {
      warnings.push({ year: y, label: `« ${ev.label} » : jalon supprimé — l'année ${ev.year} enregistrée est conservée` });
    }
    const idx = y - startYear;
    if (idx < 0 || idx > horizon) continue;
    const list = plannedByYear.get(idx) ?? [];
    list.push(ev);
    plannedByYear.set(idx, list);
  }
  for (const list of plannedByYear.values()) list.sort((a, b) => EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind]);

  // jalon supprimé pour un flux d'événement : même garde-fou (l'année de secours reste)
  for (const e of flowEvents) {
    if (e.when && refYear(e.when, milestones) === null) {
      warnings.push({ year: e.year, label: `« ${e.label} » : jalon supprimé — l'année ${e.year} enregistrée est conservée` });
    }
  }

  // bornes effectives des flux (ancrages jalon résolus UNE fois : ils sont fixes)
  const incomeBounds = incomes.map((it) => flowBounds(it, milestones));
  const expenseBounds = expenses.map((it) => flowBounds(it, milestones));

  // année de référence de la revalorisation, en index depuis startYear :
  //  - défaut (montant en euros d'aujourd'hui) : 0 → la croissance compose depuis aujourd'hui,
  //    donc un flux futur « vaut » le montant saisi en euros CONSTANTS dès son début ;
  //  - `nominal` (montant nominal à la date de début) : l'index du début → la croissance
  //    compose depuis le début, donc le 1er versement = le montant saisi, nominal.
  const refIndex = (it: FlowLike, b: { start?: number }) =>
    it.nominal && b.start != null ? Math.max(0, b.start - startYear) : 0;
  const incomeRef = incomes.map((it, k) => refIndex(it, incomeBounds[k]));
  const expenseRef = expenses.map((it, k) => refIndex(it, expenseBounds[k]));

  // les actifs achetés et emprunts contractés par événement sont pré-créés INACTIFS
  // (tableaux de taille fixe : les accumulateurs annuels restent alignés)
  for (const list of plannedByYear.values()) {
    for (const ev of list) {
      if (ev.kind === "buy") {
        assets.push({ id: ev.asset.id, label: ev.asset.label || ev.label || "Actif", a: ev.asset, val: 0, active: false });
      } else if (ev.kind === "loan") {
        loans.push({
          id: ev.id, label: ev.label || "Emprunt", balance: 0,
          mRate: (ev.rate || 0) / 100 / 12, payment: 0,
          term: ev.termMonths > 0 ? ev.termMonths : Infinity, paid: 0,
          insurance: ev.insurance || 0, ended: true,
        });
      }
    }
  }

  // capacité de versement restante PAR ACTIF (plafond − versements déjà effectués) —
  // partagée entre la cascade du surplus et les transferts (destination-actif)
  const capLeftByAsset = assets.map((A) =>
    A.a.depositCap != null ? Math.max(0, A.a.depositCap - (A.a.depositsMade || 0)) : Infinity
  );

  // affectation du surplus : flows ordonnés, résolus vers l'index d'actif cible
  // (existants, éligibles, sans doublon). Chaque flow garde son mode/cible.
  const flows: { k: number; f: SurplusFlow }[] = [];
  for (const f of surplusTargets ?? []) {
    const k = assets.findIndex((x) => x.id === f.assetId && canTransfer(x.a));
    if (k < 0 || flows.some((g) => g.k === k)) continue;
    flows.push({ k, f });
  }

  // cascade de retrait (miroir) : actifs où puiser, dans l'ordre, pour combler un déficit
  const wTargetIdxs: number[] = [];
  for (const id of withdrawalTargets ?? []) {
    const k = assets.findIndex((x) => x.id === id && canTransfer(x.a));
    if (k < 0 || wTargetIdxs.includes(k)) continue;
    wTargetIdxs.push(k);
  }

  const yieldM = monthlyRate(savingsYield);
  const flowFactor = (growth: number | undefined, indexFlag: boolean, i: number) =>
    Math.pow(1 + (growth ?? (indexFlag ? inflation : 0)) / 100, i);

  const sumAssets = () => assets.reduce((t, x) => t + (x.active ? x.val : 0), 0);
  const sumDebt = () => loans.reduce((t, x) => t + Math.max(0, x.balance), 0);

  let savings = 0;

  for (let i = 0; i <= horizon; i++) {
    const year = startYear + i;

    // ---- instantané DÉBUT d'année ----
    const startGross = sumAssets();
    const startDebt = sumDebt();
    const startSavings = savings;
    const startVals = assets.map((A) => A.val);
    const startBals = loans.map((L) => Math.max(0, L.balance));
    const startActive = assets.map((A) => A.active);

    // accumulateurs de flux de l'année (déclarés avant les événements : un
    // versement ponctuel alimente aDep/yDep comme la cascade)
    const aInc = new Array(assets.length).fill(0);
    const aChg = new Array(assets.length).fill(0);
    const aGro = new Array(assets.length).fill(0);
    const aDep = new Array(assets.length).fill(0);
    const aWdr = new Array(assets.length).fill(0);
    const lInt = new Array(loans.length).fill(0);
    const lPri = new Array(loans.length).fill(0);
    const lIns = new Array(loans.length).fill(0);
    let yD = 0, yEx = 0, yExp = 0, yChg = 0, yI = 0, yP = 0, yIns = 0, yG = 0, yY = 0, yDep = 0, yWdr = 0;

    // comble un déficit d'épargne en puisant dans la cascade de retrait (dans
    // l'ordre, à hauteur de la valeur de chaque actif) — transfert NEUTRE
    // actif → épargne. Sans cascade configurée, ne fait rien : le déficit reste
    // porté par l'épargne (comportement historique).
    const coverDeficit = () => {
      for (const k of wTargetIdxs) {
        if (savings >= -EPS) break;
        const A = assets[k];
        if (!A.active || A.val <= 0) continue;
        const w = Math.min(A.val, -savings);
        A.val -= w;
        savings += w;
        aWdr[k] += w;
        yWdr += w;
      }
    };

    // ---- ÉVÉNEMENTS de l'année : appliqués APRÈS l'instantané (ils font partie
    // des flux de l'année) et AVANT le 1er mois. Transferts neutres pour le
    // patrimoine net, sauf frais (eventFees) et PV réalisée (eventGain).
    let evCash = 0, evFees = 0, evGain = 0;
    const evDetails: EventDetail[] = [];
    // Par défaut les montants d'événements sont en euros D'AUJOURD'HUI : on les projette à
    // leur année par l'inflation (facteur (1+inflation)^i) — en affichage « euros constants »
    // (realTerms) la déflation finale les ramène au montant saisi (un don de 150 k€ en 2050
    // reste 150 k€ réels). Un événement marqué `nominal` prend son montant tel quel (euros
    // courants à la date) → facteur 1. Exceptions inchangées : prix de vente ABSENT = valeur
    // projetée, remboursement TOTAL = solde effectif ; taux/durée d'un emprunt jamais indexés.
    const inflAt = (nominal: boolean | undefined) => (nominal ? 1 : Math.pow(1 + inflation / 100, i));
    for (const ev of plannedByYear.get(i) ?? []) {
      let cash = 0, fees = 0, gain = 0;
      const evInfl = inflAt(ev.nominal);
      if (ev.kind === "cash") {
        cash = (ev.amount || 0) * evInfl;
        savings += cash;
        evCash += cash;
      } else if (ev.kind === "sell") {
        const k = assets.findIndex((x) => x.id === ev.assetId);
        if (k < 0 || !assets[k].active) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : actif introuvable ou déjà vendu` });
          continue;
        }
        const projVal = assets[k].val;
        // prix fixé = euros d'aujourd'hui indexés ; absent = valeur projetée de l'actif
        const priceUsed = ev.price != null ? ev.price * evInfl : projVal;
        fees = priceUsed * ((ev.feesPct ?? 0) / 100);
        gain = priceUsed - projVal;
        assets[k].active = false;
        assets[k].val = 0;
        cash = priceUsed - fees;
        savings += cash;
        evFees += fees; evGain += gain;
      } else if (ev.kind === "loan") {
        const L = loans.find((l) => l.id === ev.id)!;
        L.balance = (ev.amount || 0) * evInfl;
        L.payment = monthlyPayment(L.balance, ev.rate || 0, ev.termMonths);
        L.insurance = (ev.insurance || 0) * evInfl;
        L.paid = 0;
        L.ended = L.balance <= EPS || L.payment <= 0;
        cash = L.balance;
        savings += cash;
      } else if (ev.kind === "repay") {
        const L = loans.find((l) => l.id === ev.loanId);
        if (!L || L.ended || L.balance <= EPS) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : emprunt introuvable ou déjà soldé` });
          continue;
        }
        // montant partiel indexé ; absent = solde total effectif (déjà nominal)
        const req = ev.amount != null ? ev.amount * evInfl : L.balance;
        const amt = Math.min(req, L.balance);
        L.balance -= amt;
        if (L.balance <= EPS) L.ended = true;
        cash = -amt;
        savings += cash;
      } else if (ev.kind === "buy") {
        const k = assets.findIndex((x) => x.id === ev.asset.id);
        if (k < 0 || assets[k].active) continue;
        assets[k].active = true;
        assets[k].val = (ev.price || 0) * evInfl;
        fees = (ev.fees || 0) * evInfl;
        cash = -(assets[k].val + fees);
        savings += cash;
        evFees += fees;
      } else if (ev.kind === "transfer") {
        // TRANSFERT entre comptes liquides. Une extrémité peut être l'ÉPARGNE (le pool
        // `savings`, exposé comme un compte via EPARGNE_ID) ou un actif `canTransfer`.
        // Couvre l'ancien « versement » (Épargne → actif), le retrait partiel (actif →
        // Épargne) et le rééquilibrage (actif → actif). NEUTRE : compté comme un retrait
        // (source) ET un versement (destination) qui s'annulent au net.
        const fromPool = ev.fromId === EPARGNE_ID;
        const toPool = ev.toId === EPARGNE_ID;
        const from = fromPool ? -1 : assets.findIndex((x) => x.id === ev.fromId);
        const to = toPool ? -1 : assets.findIndex((x) => x.id === ev.toId);
        if (!fromPool && (from < 0 || !assets[from].active || !canTransfer(assets[from].a))) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : compte source introuvable, vendu ou non liquide` });
          continue;
        }
        if (!toPool && (to < 0 || !assets[to].active || !canTransfer(assets[to].a))) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : compte destinataire introuvable, vendu ou non liquide` });
          continue;
        }
        if (ev.fromId === ev.toId) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : source et destination identiques` });
          continue;
        }
        // plafonné au min(demandé, solde source, capacité destination). L'Épargne n'a
        // pas de plafond (∞) : depuis l'Épargne, un découvert éventuel est signalé plus bas.
        const req = (ev.amount || 0) * evInfl;
        const srcCap = fromPool ? Infinity : Math.max(0, assets[from].val);
        const dstCap = toPool ? Infinity : capLeftByAsset[to];
        const amt = Math.min(req, srcCap, dstCap);
        if (amt < req - EPS) {
          warnings.push({ year, label: `« ${ev.label} » plafonné : ${Math.round(amt)} € transférés (solde source ou plafond de versements atteint)` });
        }
        // source : depuis l'Épargne → baisse le cash ; depuis un actif → retrait neutre
        if (fromPool) savings -= amt;
        else { assets[from].val -= amt; aWdr[from] += amt; yWdr += amt; }
        // destination : vers l'Épargne → monte le cash ; vers un actif → versement neutre (plafond)
        if (toPool) savings += amt;
        else { capLeftByAsset[to] -= amt; assets[to].val += amt; aDep[to] += amt; yDep += amt; }
        // depuis l'Épargne, un transfert peut la faire passer sous zéro : la cascade de
        // retrait liquide d'abord (si configurée), sinon on alerte (comme l'ancien versement).
        if (fromPool && savings < -EPS) {
          coverDeficit();
          if (savings < -EPS) warnings.push({ year, label: `Épargne négative après « ${ev.label} » (${year})` });
        }
        // cash / fees / gain restent à 0 : le mouvement neutre est porté par deposited/withdrawn.
      }
      evDetails.push({ id: ev.id, label: ev.label || ev.kind, kind: ev.kind, cash, fees, gain });
      events.push({ yearIndex: i, year, label: ev.label || ev.kind, kind: "planned", id: ev.id });
      if (cash < 0 && savings < -EPS) {
        // la cascade de retrait liquide d'abord (si configurée) ; on n'alerte que si ça ne suffit pas
        coverDeficit();
        if (savings < -EPS) warnings.push({ year, label: `Épargne négative après « ${ev.label} » (${year})` });
      }
    }

    // revalorisation composée depuis l'année de référence du flux (aujourd'hui par défaut,
    // ou le début du flux si le montant est saisi en euros courants — cf. incomeRef/expenseRef)
    const incMonthly = incomes.map((it, k) => (isActiveYear(incomeBounds[k].start, incomeBounds[k].end, year) ? toMonthly(it) * flowFactor(it.growth, indexIncomes, i - incomeRef[k]) : 0));
    const expMonthly = expenses.map((it, k) => (isActiveYear(expenseBounds[k].start, expenseBounds[k].end, year) ? toMonthly(it) * flowFactor(it.growth, indexExpenses, i - expenseRef[k]) : 0));
    const amountIncFactor = flowFactor(undefined, indexIncomes, i);
    const chargesFactor = flowFactor(undefined, indexExpenses, i);
    // facteur d'inflation pur (1+infl)^i : indexe les montants/cibles des flows du surplus
    // en euros CONSTANTS (sauf flow `nominal`), quels que soient indexIncomes/indexExpenses
    const inflPow = Math.pow(1 + inflation / 100, i);

    // 1re année : uniquement les mois restants de l'année civile en cours
    const months = i === 0 ? 12 - startMonth : 12;
    for (let m = 0; m < months; m++) {
      // actifs : revenus distribués + charges
      let dist = 0, chg = 0;
      for (let k = 0; k < assets.length; k++) {
        const A = assets[k];
        if (!A.active) continue;
        let di = 0;
        if (A.a.incomeMode === "rate") di = (A.val * ((A.a.incomeRate ?? 0) / 100)) / 12;
        else if (A.a.incomeMode === "amount") di = toMonthly(A.a.income) * amountIncFactor;
        const ci = toMonthly(A.a.charges) * chargesFactor;
        aInc[k] += di; aChg[k] += ci; dist += di; chg += ci;
      }

      // flux manuels
      let extra = 0; for (const v of incMonthly) extra += v;
      let expense = 0; for (const v of expMonthly) expense += v;

      // emprunts
      let mI = 0, mP = 0, mIns = 0;
      for (let k = 0; k < loans.length; k++) {
        const ln = loans[k];
        if (ln.ended) continue;
        if (ln.balance <= EPS || ln.paid >= ln.term) {
          if (ln.balance > EPS) {
            // solde résiduel à l'échéance -> remboursement final (ballon), la dette tombe à 0
            mP += ln.balance; lPri[k] += ln.balance; ln.balance = 0;
          }
          ln.ended = true;
          events.push({ yearIndex: i, year, label: `Fin — ${ln.label}`, kind: "loan" });
          continue;
        }
        const int = ln.balance * ln.mRate;
        let p = ln.payment - int;
        if (p < 0) p = 0;
        if (p > ln.balance) p = ln.balance;
        ln.balance -= p; ln.paid += 1;
        mI += int; mP += p; mIns += ln.insurance;
        lInt[k] += int; lPri[k] += p; lIns[k] += ln.insurance;
        if (ln.balance <= EPS) {
          ln.ended = true;
          events.push({ yearIndex: i, year, label: `Fin — ${ln.label}`, kind: "loan" });
        }
      }

      // épargne : rendement réinvesti puis apport net du mois
      const yieldThisMonth = savings > 0 ? savings * yieldM : 0;
      savings += yieldThisMonth;
      const net = dist + extra - expense - chg - (mI + mP + mIns);

      // surplus affecté aux flows dans l'ordre de priorité : chacun prélève dans le
      // surplus RESTANT selon son mode (max / % du restant / montant fixe), borné par le
      // plafond de versements ET le solde cible ; le reliquat (et les déficits) va à l'épargne
      const monthDeps = flows.map(() => 0);
      let depTotal = 0;
      if (net > 0) {
        let rest = net;
        for (let t = 0; t < flows.length && rest > EPS; t++) {
          const { k, f } = flows[t];
          if (!assets[k].active) continue;
          // plafonds : versements cumulés restants ET « monter jusqu'au solde cible puis
          // maintenir » (cible indexée sur l'inflation sauf si le flow est en euros courants)
          const targetVal = f.targetBalance != null ? f.targetBalance * (f.nominal ? 1 : inflPow) : Infinity;
          const targetRoom = targetVal === Infinity ? Infinity : Math.max(0, targetVal - assets[k].val);
          const room = Math.min(capLeftByAsset[k], targetRoom);
          if (room <= 0) continue;
          // montant désiré selon le mode
          let want: number;
          if (f.mode === "percent") want = rest * ((f.percent ?? 0) / 100);
          else if (f.mode === "amount") want = toMonthly({ amount: f.amount ?? 0, period: f.period ?? "monthly" }) * (f.nominal ? 1 : inflPow);
          else want = room; // "max"
          const d = Math.min(rest, room, want);
          if (d <= 0) continue;
          capLeftByAsset[k] -= d; rest -= d;
          monthDeps[t] += d; depTotal += d;
        }
      }
      savings += net - depTotal;

      // déficit du mois : la cascade de retrait puise dans les actifs (neutre)
      // AVANT la croissance — l'argent retiré ne compose pas ce mois-ci
      if (savings < -EPS) coverDeficit();

      // croissance capitalisée (avec plancher) ; en mode stochastique, le taux
      // mensuel est bruité par la volatilité de l'actif (Monte Carlo)
      let g = 0;
      for (let k = 0; k < assets.length; k++) {
        const A = assets[k];
        if (!A.active) continue;
        let rate = monthlyRate(A.a.growthRate || 0);
        if (opts.gaussian && (A.a.volatility || 0) > 0) {
          rate += ((A.a.volatility! / 100) / Math.sqrt(12)) * opts.gaussian();
        }
        let delta = A.val * rate;
        if (A.a.valueFloor != null && A.val + delta < A.a.valueFloor) delta = A.a.valueFloor - A.val;
        A.val += delta; aGro[k] += delta; g += delta;
      }

      // versements APRÈS la croissance : le dépôt du mois se compose à partir du mois suivant
      for (let t = 0; t < flows.length; t++) {
        if (monthDeps[t] > 0) {
          assets[flows[t].k].val += monthDeps[t];
          aDep[flows[t].k] += monthDeps[t];
        }
      }

      yD += dist; yChg += chg; yEx += extra; yExp += expense;
      yI += mI; yP += mP; yIns += mIns; yG += g; yY += yieldThisMonth; yDep += depTotal;
    }

    const detail: YearDetail = opts.light ? EMPTY_DETAIL : {
      // inclus si présent AU DÉBUT de l'année (colonne patrimoine : value = valeur de
      // début, 0 pour un actif acheté dans l'année) OU s'il a eu une activité dans
      // l'année (ses flux doivent apparaître dans les sous-lignes de la modale)
      assets: assets.map((A, k) => (startActive[k] || aGro[k] !== 0 || aInc[k] !== 0 || aChg[k] !== 0 || aDep[k] !== 0 || aWdr[k] !== 0
        ? { id: A.id, label: A.label, value: startActive[k] ? startVals[k] : 0, growth: aGro[k], income: aInc[k], charges: aChg[k], deposit: aDep[k], withdrawal: aWdr[k] }
        : null)).filter(Boolean) as AssetDetail[],
      // balance en DÉBUT d'année, comme les actifs : la colonne patrimoine de la
      // modale doit sommer exactement au patrimoine net (lui aussi début d'année)
      loans: loans.map((L, k) => ({ id: L.id, label: L.label, balance: startBals[k], interest: lInt[k], principal: lPri[k], insurance: lIns[k] }))
        .filter((d) => d.balance > EPS || d.interest > 0 || d.principal > 0 || d.insurance > 0),
      // × months (pas × 12) : la 1re année partielle ne compte que les mois restants,
      // les sous-lignes doivent sommer au total de l'année
      incomes: incomes.map((it, k) => ({ id: it.id, label: it.label || "Revenu", amount: incMonthly[k] * months })).filter((d) => d.amount > 0),
      expenses: expenses.map((it, k) => ({ id: it.id, label: it.label || "Dépense", amount: expMonthly[k] * months })).filter((d) => d.amount > 0),
      events: evDetails,
    };

    points.push({
      yearIndex: i, year, age: ageAt(year),
      grossAssets: startGross, debt: startDebt, savings: startSavings, netWorth: startGross - startDebt + startSavings,
      distributed: yD, extra: yEx, expenses: yExp, charges: yChg, interest: yI, principal: yP, insurance: yIns, growth: yG, savingsYield: yY, deposited: yDep, withdrawn: yWdr,
      eventCash: evCash, eventFees: evFees, eventGain: evGain,
      detail,
    });

  }

  if (realTerms && inflation !== 0) {
    for (const p of points) {
      const d = Math.pow(1 + inflation / 100, p.yearIndex);
      const scale = (v: number) => v / d;
      p.grossAssets = scale(p.grossAssets); p.debt = scale(p.debt); p.savings = scale(p.savings); p.netWorth = scale(p.netWorth);
      p.distributed = scale(p.distributed); p.extra = scale(p.extra); p.expenses = scale(p.expenses); p.charges = scale(p.charges);
      p.interest = scale(p.interest); p.principal = scale(p.principal); p.insurance = scale(p.insurance); p.growth = scale(p.growth); p.savingsYield = scale(p.savingsYield); p.deposited = scale(p.deposited); p.withdrawn = scale(p.withdrawn);
      p.eventCash = scale(p.eventCash); p.eventFees = scale(p.eventFees); p.eventGain = scale(p.eventGain);
      p.detail.assets.forEach((a) => { a.value = scale(a.value); a.growth = scale(a.growth); a.income = scale(a.income); a.charges = scale(a.charges); a.deposit = scale(a.deposit); a.withdrawal = scale(a.withdrawal); });
      p.detail.loans.forEach((l) => { l.balance = scale(l.balance); l.interest = scale(l.interest); l.principal = scale(l.principal); l.insurance = scale(l.insurance); });
      p.detail.incomes.forEach((f) => (f.amount = scale(f.amount)));
      p.detail.expenses.forEach((f) => (f.amount = scale(f.amount)));
      p.detail.events.forEach((e) => { e.cash = scale(e.cash); e.fees = scale(e.fees); e.gain = scale(e.gain); });
    }
  }

  // Indépendance financière : seuil de patrimoine net FIXÉ PAR L'UTILISATEUR (fiTarget),
  // pas déduit par le moteur. Évaluée APRÈS le passage en euros constants pour coller
  // aux montants affichés (en réel, le seuil s'entend en pouvoir d'achat d'aujourd'hui).
  if (params.fiTarget != null && params.fiTarget > 0) {
    const idx = points.findIndex((pt) => pt.netWorth >= params.fiTarget!);
    if (idx >= 0) {
      fiYearIndex = idx;
      events.push({ yearIndex: idx, year: points[idx].year, label: "Indépendance financière", kind: "fi" });
    }
  }

  return { points, events, warnings, fiYearIndex };
}
