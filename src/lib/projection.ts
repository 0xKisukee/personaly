/* ===========================================================================
   Moteur de projection patrimoniale — simulation mois par mois.

   Gère : intérêts composés des actifs (+ plancher de valeur), revenus distribués,
   charges d'actifs, revenus/dépenses manuels (bornés + revalorisés par flux),
   emprunts amortis (+ assurance) qui s'éteignent à terme, réinvestissement de
   l'épargne, inflation / euros constants.
   (Les ÉVÉNEMENTS datés — achat/vente, nouvel emprunt — ont été retirés ;
   à re-concevoir, cf. README.)

   Chaque point d'année porte le patrimoine au DÉBUT de l'année et les FLUX qui se
   produisent PENDANT cette année-là (composition disponible via `detail`).
   L'année d'indice 0 = aujourd'hui (patrimoine courant) et ses flux = le régime de
   la 1re année ; les intérêts d'emprunt décroissent donc dès l'année suivante.
   =========================================================================== */

import type { Asset, AppState, ProjectionParams } from "./types";
import { toMonthly, isActiveYear } from "./format";

export interface AssetDetail { id: string; label: string; value: number; growth: number; income: number; charges: number; }
export interface LoanDetail { id: string; label: string; balance: number; interest: number; principal: number; insurance: number; }
export interface FlowDetail { id: string; label: string; amount: number; }

export interface YearDetail {
  assets: AssetDetail[];
  loans: LoanDetail[];
  incomes: FlowDetail[];
  expenses: FlowDetail[];
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
  detail: YearDetail;
}

export interface ProjectionEvent {
  yearIndex: number;
  year: number;
  label: string;
  kind: "loan" | "fi";
}

export interface ProjectionResult {
  points: YearPoint[];
  events: ProjectionEvent[];
  fiYearIndex: number | null;
}

const EPS = 0.005;
const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

interface SimAsset { id: string; label: string; a: Asset; val: number; active: boolean; }
interface SimLoan { id: string; label: string; balance: number; mRate: number; payment: number; term: number; paid: number; insurance: number; ended: boolean; }

export function project(s: AppState, params: ProjectionParams): ProjectionResult {
  const { horizon, savingsYield, inflation, indexExpenses, indexIncomes, realTerms } = params;

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

  const yieldM = monthlyRate(savingsYield);
  const flowFactor = (growth: number | undefined, indexFlag: boolean, i: number) =>
    Math.pow(1 + (growth ?? (indexFlag ? inflation : 0)) / 100, i);

  const sumAssets = () => assets.reduce((t, x) => t + (x.active ? x.val : 0), 0);
  const sumDebt = () => loans.reduce((t, x) => t + Math.max(0, x.balance), 0);

  let savings = 0;
  const points: YearPoint[] = [];
  const events: ProjectionEvent[] = [];
  let fiYearIndex: number | null = null;

  for (let i = 0; i <= horizon; i++) {
    const year = startYear + i;

    // ---- instantané DÉBUT d'année ----
    const startGross = sumAssets();
    const startDebt = sumDebt();
    const startSavings = savings;
    const startVals = assets.map((A) => A.val);

    // accumulateurs de flux de l'année
    const aInc = new Array(assets.length).fill(0);
    const aChg = new Array(assets.length).fill(0);
    const aGro = new Array(assets.length).fill(0);
    const lInt = new Array(loans.length).fill(0);
    const lPri = new Array(loans.length).fill(0);
    const lIns = new Array(loans.length).fill(0);

    const incFactor = (it: { growth?: number }) => flowFactor(it.growth, indexIncomes, i);
    const expFactor = (it: { growth?: number }) => flowFactor(it.growth, indexExpenses, i);
    const incMonthly = s.incomes.map((it) => (isActiveYear(it.startYear, it.endYear, year) ? toMonthly(it) * incFactor(it) : 0));
    const expMonthly = s.expenses.map((it) => (isActiveYear(it.startYear, it.endYear, year) ? toMonthly(it) * expFactor(it) : 0));
    const amountIncFactor = flowFactor(undefined, indexIncomes, i);
    const chargesFactor = flowFactor(undefined, indexExpenses, i);

    let yD = 0, yEx = 0, yExp = 0, yChg = 0, yI = 0, yP = 0, yIns = 0, yG = 0, yY = 0;

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
      savings += dist + extra - expense - chg - (mI + mP + mIns);

      // croissance capitalisée (avec plancher)
      let g = 0;
      for (let k = 0; k < assets.length; k++) {
        const A = assets[k];
        if (!A.active) continue;
        let delta = A.val * monthlyRate(A.a.growthRate || 0);
        if (A.a.valueFloor != null && A.val + delta < A.a.valueFloor) delta = A.a.valueFloor - A.val;
        A.val += delta; aGro[k] += delta; g += delta;
      }

      yD += dist; yChg += chg; yEx += extra; yExp += expense;
      yI += mI; yP += mP; yIns += mIns; yG += g; yY += yieldThisMonth;
    }

    const detail: YearDetail = {
      assets: assets.map((A, k) => (A.active ? { id: A.id, label: A.label, value: startVals[k], growth: aGro[k], income: aInc[k], charges: aChg[k] } : null)).filter(Boolean) as AssetDetail[],
      loans: loans.map((L, k) => ({ id: L.id, label: L.label, balance: Math.max(0, L.balance), interest: lInt[k], principal: lPri[k], insurance: lIns[k] })).filter((d) => d.balance > EPS || d.interest > 0 || d.principal > 0),
      incomes: s.incomes.map((it, k) => ({ id: it.id, label: it.label || "Revenu", amount: incMonthly[k] * 12 })).filter((d) => d.amount > 0),
      expenses: s.expenses.map((it, k) => ({ id: it.id, label: it.label || "Dépense", amount: expMonthly[k] * 12 })).filter((d) => d.amount > 0),
    };

    points.push({
      yearIndex: i, year, age: ageAt(year),
      grossAssets: startGross, debt: startDebt, savings: startSavings, netWorth: startGross - startDebt + startSavings,
      distributed: yD, extra: yEx, expenses: yExp, charges: yChg, interest: yI, principal: yP, insurance: yIns, growth: yG, savingsYield: yY,
      detail,
    });

    if (fiYearIndex === null) {
      const passive = yD + yY;
      const outflow = yExp + yChg + yI + yP + yIns;
      if (passive >= outflow && outflow > 0) {
        fiYearIndex = i;
        events.push({ yearIndex: i, year, label: "Indépendance financière", kind: "fi" });
      }
    }
  }

  if (realTerms && inflation !== 0) {
    for (const p of points) {
      const d = Math.pow(1 + inflation / 100, p.yearIndex);
      const scale = (v: number) => v / d;
      p.grossAssets = scale(p.grossAssets); p.debt = scale(p.debt); p.savings = scale(p.savings); p.netWorth = scale(p.netWorth);
      p.distributed = scale(p.distributed); p.extra = scale(p.extra); p.expenses = scale(p.expenses); p.charges = scale(p.charges);
      p.interest = scale(p.interest); p.principal = scale(p.principal); p.insurance = scale(p.insurance); p.growth = scale(p.growth); p.savingsYield = scale(p.savingsYield);
      p.detail.assets.forEach((a) => { a.value = scale(a.value); a.growth = scale(a.growth); a.income = scale(a.income); a.charges = scale(a.charges); });
      p.detail.loans.forEach((l) => { l.balance = scale(l.balance); l.interest = scale(l.interest); l.principal = scale(l.principal); l.insurance = scale(l.insurance); });
      p.detail.incomes.forEach((f) => (f.amount = scale(f.amount)));
      p.detail.expenses.forEach((f) => (f.amount = scale(f.amount)));
    }
  }

  return { points, events, fiYearIndex };
}
