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

import type { Asset, FlowEvent, MilestoneRef, Period, PlannedEvent, ProjectionParams, SimState } from "./types";
import { canReceiveDeposits, eventYear, flowBounds, refYear } from "./types";
import { toMonthly, isActiveYear } from "./format";
import { monthlyPayment } from "./finance";

/** Forme minimale d'un flux consommée par le moteur (revenu/dépense OU flux d'événement). */
interface FlowLike {
  id: string; label: string; amount: number; period: Period;
  startYear?: number; endYear?: number; startRef?: MilestoneRef; endRef?: MilestoneRef; growth?: number;
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
  const flowEvents = (s.events ?? []).filter((e): e is FlowEvent => e.kind === "flow" && !e.disabled);
  const asFlowItem = (e: FlowEvent): FlowLike => ({
    id: e.id, label: `⚑ ${e.label || "Flux"}`, amount: e.amount, period: e.period,
    startYear: e.year, startRef: e.when, endYear: e.endYear, endRef: e.endRef, growth: e.growth,
  });
  const incomes: FlowLike[] = [...s.incomes, ...flowEvents.filter((e) => e.direction === "in").map(asFlowItem)];
  const expenses: FlowLike[] = [...s.expenses, ...flowEvents.filter((e) => e.direction === "out").map(asFlowItem)];

  // événements PONCTUELS datés dans l'horizon, groupés par année d'application ;
  // l'année effective résout l'ancrage jalon (l'instantané `year` sert de secours
  // si le jalon a été supprimé — on le signale). Dans une même année, le cash ENTRE
  // d'abord (ventes, rentrées, emprunts) puis SORT (remboursements, achats).
  const EVENT_ORDER: Record<PlannedEvent["kind"], number> = { flow: -1, sell: 0, cash: 1, loan: 2, repay: 3, buy: 4, deposit: 5 };
  const plannedByYear = new Map<number, Exclude<PlannedEvent, FlowEvent>[]>();
  for (const ev of s.events ?? []) {
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
  // partagée entre la cascade du surplus et les événements "deposit"
  const capLeftByAsset = assets.map((A) =>
    A.a.depositCap != null ? Math.max(0, A.a.depositCap - (A.a.depositsMade || 0)) : Infinity
  );

  // cascade du surplus : actifs cibles ordonnés (existants, éligibles, sans doublon)
  const targetIdxs: number[] = [];
  for (const id of surplusTargets ?? []) {
    const k = assets.findIndex((x) => x.id === id && canReceiveDeposits(x.a));
    if (k < 0 || targetIdxs.includes(k)) continue;
    targetIdxs.push(k);
  }

  // cascade de retrait (miroir) : actifs où puiser, dans l'ordre, pour combler un déficit
  const wTargetIdxs: number[] = [];
  for (const id of withdrawalTargets ?? []) {
    const k = assets.findIndex((x) => x.id === id && canReceiveDeposits(x.a));
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
    for (const ev of plannedByYear.get(i) ?? []) {
      let cash = 0, fees = 0, gain = 0;
      if (ev.kind === "cash") {
        cash = ev.amount || 0;
        savings += cash;
        evCash += cash;
      } else if (ev.kind === "sell") {
        const k = assets.findIndex((x) => x.id === ev.assetId);
        if (k < 0 || !assets[k].active) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : actif introuvable ou déjà vendu` });
          continue;
        }
        const projVal = assets[k].val;
        const priceUsed = ev.price ?? projVal;
        fees = priceUsed * ((ev.feesPct ?? 0) / 100);
        gain = priceUsed - projVal;
        assets[k].active = false;
        assets[k].val = 0;
        cash = priceUsed - fees;
        savings += cash;
        evFees += fees; evGain += gain;
      } else if (ev.kind === "loan") {
        const L = loans.find((l) => l.id === ev.id)!;
        L.balance = ev.amount || 0;
        L.payment = monthlyPayment(ev.amount || 0, ev.rate || 0, ev.termMonths);
        L.paid = 0;
        L.ended = L.balance <= EPS || L.payment <= 0;
        cash = ev.amount || 0;
        savings += cash;
      } else if (ev.kind === "repay") {
        const L = loans.find((l) => l.id === ev.loanId);
        if (!L || L.ended || L.balance <= EPS) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : emprunt introuvable ou déjà soldé` });
          continue;
        }
        const amt = Math.min(ev.amount ?? L.balance, L.balance);
        L.balance -= amt;
        if (L.balance <= EPS) L.ended = true;
        cash = -amt;
        savings += cash;
      } else if (ev.kind === "buy") {
        const k = assets.findIndex((x) => x.id === ev.asset.id);
        if (k < 0 || assets[k].active) continue;
        assets[k].active = true;
        assets[k].val = ev.price || 0;
        fees = ev.fees || 0;
        cash = -((ev.price || 0) + fees);
        savings += cash;
        evFees += fees;
      } else if (ev.kind === "deposit") {
        const k = assets.findIndex((x) => x.id === ev.assetId);
        if (k < 0 || !assets[k].active || !canReceiveDeposits(assets[k].a)) {
          warnings.push({ year, label: `« ${ev.label} » ignoré : actif introuvable, vendu ou inéligible aux versements` });
          continue;
        }
        // transfert neutre épargne → actif, dans la limite du plafond de versements
        const amt = Math.min(ev.amount || 0, capLeftByAsset[k]);
        if (amt < (ev.amount || 0) - EPS) {
          warnings.push({ year, label: `« ${ev.label} » plafonné : ${Math.round(amt)} € versés (plafond de versements atteint)` });
        }
        capLeftByAsset[k] -= amt;
        assets[k].val += amt;
        aDep[k] += amt;
        yDep += amt;
        cash = -amt;
        savings += cash;
      }
      evDetails.push({ id: ev.id, label: ev.label || ev.kind, kind: ev.kind, cash, fees, gain });
      events.push({ yearIndex: i, year, label: ev.label || ev.kind, kind: "planned", id: ev.id });
      if (cash < 0 && savings < -EPS) {
        // la cascade de retrait liquide d'abord (si configurée) ; on n'alerte que si ça ne suffit pas
        coverDeficit();
        if (savings < -EPS) warnings.push({ year, label: `Épargne négative après « ${ev.label} » (${year})` });
      }
    }

    const incFactor = (it: { growth?: number }) => flowFactor(it.growth, indexIncomes, i);
    const expFactor = (it: { growth?: number }) => flowFactor(it.growth, indexExpenses, i);
    const incMonthly = incomes.map((it, k) => (isActiveYear(incomeBounds[k].start, incomeBounds[k].end, year) ? toMonthly(it) * incFactor(it) : 0));
    const expMonthly = expenses.map((it, k) => (isActiveYear(expenseBounds[k].start, expenseBounds[k].end, year) ? toMonthly(it) * expFactor(it) : 0));
    const amountIncFactor = flowFactor(undefined, indexIncomes, i);
    const chargesFactor = flowFactor(undefined, indexExpenses, i);

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

      // surplus routé en cascade : chaque cible reçoit jusqu'à son plafond, l'excédent
      // passe à la suivante ; ce qui reste (et les déficits) est porté par l'épargne
      const monthDeps = targetIdxs.map(() => 0);
      let depTotal = 0;
      if (net > 0) {
        let rest = net;
        for (let t = 0; t < targetIdxs.length && rest > 0; t++) {
          const k = targetIdxs[t];
          if (!assets[k].active) continue;
          const d = Math.min(rest, capLeftByAsset[k]);
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
      for (let t = 0; t < targetIdxs.length; t++) {
        if (monthDeps[t] > 0) {
          assets[targetIdxs[t]].val += monthDeps[t];
          aDep[targetIdxs[t]] += monthDeps[t];
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
