import type { AppState, Asset } from "./types";
import { flowBounds } from "./types";
import { toYearly, isActiveYear } from "./format";
import { loanYearSplit } from "./finance";

const CURRENT_YEAR = new Date().getFullYear();

/** Revenu annuel distribué par un actif (flux entrant ; la croissance capitalisée n'en fait pas partie). */
export function assetYearlyIncome(a: Asset): number {
  if (a.incomeMode === "rate") return (a.value * (a.incomeRate ?? 0)) / 100;
  if (a.incomeMode === "amount") return toYearly(a.income);
  return 0;
}

/**
 * Revenu NET d'un actif (annuel) : revenu distribué − charges de détention.
 * C'est le vrai « bénéfice » de possession : un bien loué 900 €/mois avec 100 €/mois
 * de charges rapporte 9 600 €/an, pas 10 800 €. Peut être négatif (résidence sans
 * revenu mais avec taxe foncière/copro : elle coûte de l'argent à détenir).
 */
export function assetYearlyNet(a: Asset): number {
  return assetYearlyIncome(a) - toYearly(a.charges);
}

/**
 * Rendement TOTAL annuel d'un actif = part capitalisée (croissance) + part distribuée
 * nette (revenu − charges, rapportée à la valeur). C'est la métrique du langage couleur
 * de performance (§8) : positif = productif/s'apprécie, négatif = coûte/se déprécie,
 * ≈0 = dormant. Toutes les parts sont exposées pour l'info-bulle et le tri.
 */
export interface AssetPerformance {
  pct: number; // rendement total annuel (%)
  latentPct: number; // part capitalisée (%) = growthRate
  cashPct: number; // part distribuée nette (%) rapportée à la valeur
  latentEur: number; // €/an capitalisés (plus/moins-value latente)
  cashEur: number; // €/an distribués nets (revenu − charges)
  netEur: number; // €/an total (latent + cash)
}

export function assetPerformance(a: Asset): AssetPerformance {
  const v = a.value || 0;
  const latentEur = assetYearlyGrowth(a);
  const cashEur = assetYearlyNet(a);
  const latentPct = a.growthRate || 0;
  const cashPct = v > 0 ? (cashEur / v) * 100 : 0;
  return { pct: latentPct + cashPct, latentPct, cashPct, latentEur, cashEur, netEur: latentEur + cashEur };
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

/** Un flux est-il actif cette année ? Bornes résolues comme le moteur : ancrage jalon prioritaire, sinon années en dur. */
function isActiveNow(
  f: Parameters<typeof flowBounds>[0],
  s: Pick<AppState, "milestones">
): boolean {
  const { start, end } = flowBounds(f, s.milestones);
  return isActiveYear(start, end, CURRENT_YEAR);
}

/** Revenus complémentaires ACTIFS cette année — encaissés, liquides (annuel). */
export function extraIncomeYearly(s: AppState): number {
  return s.incomes.reduce((sum, i) => sum + (isActiveNow(i, s) ? toYearly(i) : 0), 0);
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

/** Dépenses & impôts ACTIFS cette année — liquides (annuel). */
export function expensesYearly(s: AppState): number {
  return s.expenses.reduce((sum, e) => sum + (isActiveNow(e, s) ? toYearly(e) : 0), 0);
}

/** Charges récurrentes des actifs (taxe foncière, copro…) — sortant réel (annuel). */
export function assetChargesYearly(s: AppState): number {
  return s.assets.reduce((sum, a) => sum + toYearly(a.charges), 0);
}

/** Assurance emprunteur (annuel) — coût réel en plus des mensualités. */
export function loanInsuranceYearly(s: AppState): number {
  return s.liabilities.reduce((sum, l) => sum + ((l.monthlyPayment || 0) > 0 ? (l.insurance || 0) * 12 : 0), 0);
}

/* ---- AGRÉGATS ---- */

/** Total des flux entrants comptés dans l'enrichissement : encaissés + plus-values latentes. */
export function inflowsYearly(s: AppState): number {
  return cashInflowsYearly(s) + latentGainYearly(s);
}

/**
 * Total des flux sortants comptés dans l'enrichissement :
 * dépenses + charges + intérêts + assurance + moins-values latentes
 * (PAS le capital remboursé).
 */
export function outflowsYearly(s: AppState): number {
  return (
    expensesYearly(s) + assetChargesYearly(s) + loanInterestYearly(s) + loanInsuranceYearly(s) - latentLossYearly(s)
  );
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
  return cashInflowsYearly(s) - expensesYearly(s) - assetChargesYearly(s) - loanInterestYearly(s) - loanInsuranceYearly(s);
}

/** Plus-value latente = croissance capitalisée non encaissée (alias lisible). */
export function latentGrowthYearly(s: AppState): number {
  return capitalizedGrowthYearly(s);
}
