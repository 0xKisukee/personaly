import type { AppState, Asset } from "./types";
import { toYearly } from "./format";

/** Revenu annuel généré par un actif (flux entrant). */
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
