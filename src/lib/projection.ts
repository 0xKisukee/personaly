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

import type { Asset, AppState, PlannedEvent, ProjectionParams } from "./types";
import { canReceiveDeposits } from "./types";
import { toMonthly, isActiveYear } from "./format";
import { monthlyPayment } from "./finance";

export interface AssetDetail { id: string; label: string; value: number; growth: number; income: number; charges: number; deposit: number; }
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

interface SimAsset { id: string; label: string; a: Asset; val: number; active: boolean; }
interface SimLoan { id: string; label: string; balance: number; mRate: number; payment: number; term: number; paid: number; insurance: number; ended: boolean; }

export function project(s: AppState, params: ProjectionParams): ProjectionResult {
  const { horizon, savingsYield, inflation, indexExpenses, indexIncomes, realTerms, surplusTargets } = params;

  const now = new Date();
  const startYear = now.getFullYear();
  const startMonth = now.getMonth(); // 0-11 : la 1re année ne couvre que les mois restants
  const birthYear = s.profile.birthDate ? new Date(s.profile.birthDate).getFullYear() : null;
  const ageAt = (y: number) => (birthYear ? y - birthYear : null);

  const assets: SimAsset[] = s.assets.map((a) => ({ id: a.id, label: a.label || "Actif", a, val: a.value || 0, active: true }));
  const loans: SimLoan[] = s.liabilities.map((l) => ({
    id: l.id, label: l.label || "Emprunt", balance: l.outstanding || 0,
    mRate: (l.rate ?? 0) / 100 / 12, payment: l.monthlyPayment || 0,
    term: l.termMonths && l.termMonths > 0 ? l.termMonths : Infinity, paid: 0,
    insurance: l.insurance || 0, ended: (l.outstanding || 0) <= EPS || (l.monthlyPayment || 0) <= 0,
  }));

  // événements datés dans l'horizon, groupés par année d'application ; dans une même
  // année, le cash ENTRE d'abord (ventes, rentrées, emprunts) puis SORT (remboursements, achats)
  const EVENT_ORDER: Record<PlannedEvent["kind"], number> = { sell: 0, cash: 1, loan: 2, repay: 3, buy: 4 };
  const plannedByYear = new Map<number, PlannedEvent[]>();
  for (const ev of s.events ?? []) {
    const idx = ev.year - startYear;
    if (idx < 0 || idx > horizon) continue;
    const list = plannedByYear.get(idx) ?? [];
    list.push(ev);
    plannedByYear.set(idx, list);
  }
  for (const list of plannedByYear.values()) list.sort((a, b) => EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind]);

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

  // cascade du surplus : actifs cibles ordonnés (existants, éligibles, sans doublon),
  // chacun avec sa capacité de versement restante (plafond − versements déjà effectués)
  const targetIdxs: number[] = [];
  const capLefts: number[] = [];
  for (const id of surplusTargets ?? []) {
    const k = assets.findIndex((x) => x.id === id && canReceiveDeposits(x.a));
    if (k < 0 || targetIdxs.includes(k)) continue;
    targetIdxs.push(k);
    const t = assets[k].a;
    capLefts.push(t.depositCap != null ? Math.max(0, t.depositCap - (t.depositsMade || 0)) : Infinity);
  }

  const yieldM = monthlyRate(savingsYield);
  const flowFactor = (growth: number | undefined, indexFlag: boolean, i: number) =>
    Math.pow(1 + (growth ?? (indexFlag ? inflation : 0)) / 100, i);

  const sumAssets = () => assets.reduce((t, x) => t + (x.active ? x.val : 0), 0);
  const sumDebt = () => loans.reduce((t, x) => t + Math.max(0, x.balance), 0);

  let savings = 0;
  const points: YearPoint[] = [];
  const events: ProjectionEvent[] = [];
  const warnings: ProjectionWarning[] = [];
  let fiYearIndex: number | null = null;

  for (let i = 0; i <= horizon; i++) {
    const year = startYear + i;

    // ---- instantané DÉBUT d'année ----
    const startGross = sumAssets();
    const startDebt = sumDebt();
    const startSavings = savings;
    const startVals = assets.map((A) => A.val);
    const startBals = loans.map((L) => Math.max(0, L.balance));
    const startActive = assets.map((A) => A.active);

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
      }
      evDetails.push({ id: ev.id, label: ev.label || ev.kind, kind: ev.kind, cash, fees, gain });
      events.push({ yearIndex: i, year, label: ev.label || ev.kind, kind: "planned" });
      if (cash < 0 && savings < -EPS) {
        warnings.push({ year, label: `Épargne négative après « ${ev.label} » (${year})` });
      }
    }

    // accumulateurs de flux de l'année
    const aInc = new Array(assets.length).fill(0);
    const aChg = new Array(assets.length).fill(0);
    const aGro = new Array(assets.length).fill(0);
    const aDep = new Array(assets.length).fill(0);
    const lInt = new Array(loans.length).fill(0);
    const lPri = new Array(loans.length).fill(0);
    const lIns = new Array(loans.length).fill(0);

    const incFactor = (it: { growth?: number }) => flowFactor(it.growth, indexIncomes, i);
    const expFactor = (it: { growth?: number }) => flowFactor(it.growth, indexExpenses, i);
    const incMonthly = s.incomes.map((it) => (isActiveYear(it.startYear, it.endYear, year) ? toMonthly(it) * incFactor(it) : 0));
    const expMonthly = s.expenses.map((it) => (isActiveYear(it.startYear, it.endYear, year) ? toMonthly(it) * expFactor(it) : 0));
    const amountIncFactor = flowFactor(undefined, indexIncomes, i);
    const chargesFactor = flowFactor(undefined, indexExpenses, i);

    let yD = 0, yEx = 0, yExp = 0, yChg = 0, yI = 0, yP = 0, yIns = 0, yG = 0, yY = 0, yDep = 0;

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
          if (!assets[targetIdxs[t]].active) continue;
          const d = Math.min(rest, capLefts[t]);
          if (d <= 0) continue;
          capLefts[t] -= d; rest -= d;
          monthDeps[t] += d; depTotal += d;
        }
      }
      savings += net - depTotal;

      // croissance capitalisée (avec plancher)
      let g = 0;
      for (let k = 0; k < assets.length; k++) {
        const A = assets[k];
        if (!A.active) continue;
        let delta = A.val * monthlyRate(A.a.growthRate || 0);
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

    const detail: YearDetail = {
      // actifs ACTIFS AU DÉBUT de l'année (un actif acheté cette année apparaît
      // l'année suivante ; un actif vendu cette année figure à sa valeur de début)
      assets: assets.map((A, k) => (startActive[k] ? { id: A.id, label: A.label, value: startVals[k], growth: aGro[k], income: aInc[k], charges: aChg[k], deposit: aDep[k] } : null)).filter(Boolean) as AssetDetail[],
      // balance en DÉBUT d'année, comme les actifs : la colonne patrimoine de la
      // modale doit sommer exactement au patrimoine net (lui aussi début d'année)
      loans: loans.map((L, k) => ({ id: L.id, label: L.label, balance: startBals[k], interest: lInt[k], principal: lPri[k], insurance: lIns[k] })).filter((d) => d.balance > EPS),
      incomes: s.incomes.map((it, k) => ({ id: it.id, label: it.label || "Revenu", amount: incMonthly[k] * 12 })).filter((d) => d.amount > 0),
      expenses: s.expenses.map((it, k) => ({ id: it.id, label: it.label || "Dépense", amount: expMonthly[k] * 12 })).filter((d) => d.amount > 0),
      events: evDetails,
    };

    points.push({
      yearIndex: i, year, age: ageAt(year),
      grossAssets: startGross, debt: startDebt, savings: startSavings, netWorth: startGross - startDebt + startSavings,
      distributed: yD, extra: yEx, expenses: yExp, charges: yChg, interest: yI, principal: yP, insurance: yIns, growth: yG, savingsYield: yY, deposited: yDep,
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
      p.interest = scale(p.interest); p.principal = scale(p.principal); p.insurance = scale(p.insurance); p.growth = scale(p.growth); p.savingsYield = scale(p.savingsYield); p.deposited = scale(p.deposited);
      p.eventCash = scale(p.eventCash); p.eventFees = scale(p.eventFees); p.eventGain = scale(p.eventGain);
      p.detail.assets.forEach((a) => { a.value = scale(a.value); a.growth = scale(a.growth); a.income = scale(a.income); a.charges = scale(a.charges); a.deposit = scale(a.deposit); });
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
