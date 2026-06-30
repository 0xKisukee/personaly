import type { AppState, Asset } from "./types";
import { toYearly } from "./format";
import { loanYearSplit } from "./finance";

/** Revenu annuel distribué par un actif (flux entrant ; la croissance capitalisée n'en fait pas partie). */
export function assetYearlyIncome(a: Asset): number {
  if (a.incomeMode === "rate") return (a.value * (a.incomeRate ?? 0)) / 100;
  if (a.incomeMode === "amount") return toYearly(a.income);
  return 0;
}

export function grossWealth(s: AppState): number {
  return s.assets.reduce((sum, a) => sum + (a.value || 0), 0);
}

export function totalLiabilities(s: AppState): number {
  return s.liabilities.reduce((sum, l) => sum + (l.outstanding || 0), 0);
}

export function netWealth(s: AppState): number {
  return grossWealth(s) - totalLiabilities(s);
}

/* ------------------------------- FLUX ----------------------------- */

/** Croissance capitalisée annuelle d'un actif (illiquide). + apprécie / − déprécie. */
export function assetYearlyGrowth(a: Asset): number {
  return ((a.value || 0) * (a.growthRate || 0)) / 100;
}

/* ---- ENTRANTS ---- */

/** Revenus distribués par le patrimoine — encaissés, liquides (annuel). */
export function patrimoineIncomeYearly(s: AppState): number {
  return s.assets.reduce((sum, a) => sum + assetYearlyIncome(a), 0);
}

/** Revenus complémentaires saisis — encaissés, liquides (annuel). */
export function extraIncomeYearly(s: AppState): number {
  return s.incomes.reduce((sum, i) => sum + toYearly(i), 0);
}

/** Croissance capitalisée nette du patrimoine (annuel) : appréciations − dépréciations. */
export function capitalizedGrowthYearly(s: AppState): number {
  return s.assets.reduce((sum, a) => sum + assetYearlyGrowth(a), 0);
}

/** Plus-values latentes seulement (actifs qui s'apprécient) — entrant. */
export function latentGainYearly(s: AppState): number {
  return s.assets.reduce((sum, a) => {
    const g = assetYearlyGrowth(a);
    return sum + (g > 0 ? g : 0);
  }, 0);
}

/** Moins-values latentes seulement (actifs qui se déprécient) — sortant. Valeur ≤ 0. */
export function latentLossYearly(s: AppState): number {
  return s.assets.reduce((sum, a) => {
    const g = assetYearlyGrowth(a);
    return sum + (g < 0 ? g : 0);
  }, 0);
}

/** Revenus encaissés (liquides) : patrimoine distribué + revenus complémentaires. */
export function cashInflowsYearly(s: AppState): number {
  return patrimoineIncomeYearly(s) + extraIncomeYearly(s);
}

/* ---- EMPRUNTS : split intérêts / capital sur l'année ---- */

export function loanInterestYearly(s: AppState): number {
  return s.liabilities.reduce(
    (sum, l) => sum + loanYearSplit(l.outstanding, l.rate ?? 0, l.monthlyPayment ?? 0, l.termMonths).interest,
    0
  );
}

/** Capital remboursé sur l'année — neutre pour le patrimoine, mais sort de la trésorerie. */
export function loanPrincipalYearly(s: AppState): number {
  return s.liabilities.reduce(
    (sum, l) => sum + loanYearSplit(l.outstanding, l.rate ?? 0, l.monthlyPayment ?? 0, l.termMonths).principal,
    0
  );
}

/** Total des mensualités effectivement versées sur l'année (intérêts + capital). */
export function loanPaymentsYearly(s: AppState): number {
  return loanInterestYearly(s) + loanPrincipalYearly(s);
}

/* ---- SORTANTS ---- */

/** Dépenses & impôts saisis — liquides (annuel). */
export function expensesYearly(s: AppState): number {
  return s.expenses.reduce((sum, e) => sum + toYearly(e), 0);
}

/* ---- AGRÉGATS ---- */

/** Total des flux entrants comptés dans l'enrichissement : encaissés + plus-values latentes. */
export function inflowsYearly(s: AppState): number {
  return cashInflowsYearly(s) + latentGainYearly(s);
}

/**
 * Total des flux sortants comptés dans l'enrichissement :
 * dépenses + intérêts + moins-values latentes (PAS le capital remboursé).
 */
export function outflowsYearly(s: AppState): number {
  return expensesYearly(s) + loanInterestYearly(s) - latentLossYearly(s);
}

/** Enrichissement du patrimoine net annuel = entrants − sortants. */
export function enrichmentYearly(s: AppState): number {
  return inflowsYearly(s) - outflowsYearly(s);
}

/**
 * Enrichissement RÉALISÉ (en euros réellement encaissés/décaissés) :
 * revenus encaissés − dépenses − intérêts d'emprunt.
 * Le capital remboursé n'y figure pas : il est neutre pour le patrimoine net
 * (sortie de cash compensée par la baisse de la dette).
 */
export function realizedEnrichmentYearly(s: AppState): number {
  return cashInflowsYearly(s) - expensesYearly(s) - loanInterestYearly(s);
}

/** Plus-value latente = croissance capitalisée non encaissée (alias lisible). */
export function latentGrowthYearly(s: AppState): number {
  return capitalizedGrowthYearly(s);
}
