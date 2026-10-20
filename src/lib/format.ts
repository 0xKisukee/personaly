import type { Milestone, MilestoneRef, MoneyFlow } from "./types";

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const eurCents = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format euros, sans décimales pour les gros montants. */
export function money(n: number, cents = false): string {
  if (!Number.isFinite(n)) return "—";
  return (cents ? eurCents : eur).format(n);
}

/** Format euros signé (+/−) pour les flux. */
export function signedMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return sign + money(Math.abs(n));
}

export function percent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(n) + " %";
}

/** Ramène un MoneyFlow en montant annuel. */
export function toYearly(flow?: MoneyFlow): number {
  if (!flow) return 0;
  return flow.period === "monthly" ? flow.amount * 12 : flow.amount;
}

export function toMonthly(flow?: MoneyFlow): number {
  if (!flow) return 0;
  return flow.period === "yearly" ? flow.amount / 12 : flow.amount;
}

/** Âge en années à partir d'une date ISO. */
export function ageFrom(birthIso: string): number | null {
  if (!birthIso) return null;
  const b = new Date(birthIso);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/** Un flux borné par startYear/endYear est-il actif l'année `year` ? */
export function isActiveYear(
  startYear: number | undefined,
  endYear: number | undefined,
  year: number
): boolean {
  if (startYear && year < startYear) return false;
  if (endYear && year > endYear) return false;
  return true;
}

/**
 * Libellé humain d'une date ancrée : « Retraite (2057) », « Retraite +2 (2059) »,
 * « 2032 » si année en dur, « 2032 (jalon supprimé) » si l'ancrage est orphelin.
 * null si rien n'est défini (flux sans borne).
 */
export function whenLabel(
  year: number | undefined,
  ref: MilestoneRef | undefined,
  milestones: Milestone[]
): string | null {
  if (ref) {
    const m = milestones.find((x) => x.id === ref.milestoneId);
    if (m) {
      const off = ref.offset ?? 0;
      const suffix = off ? ` ${off > 0 ? "+" : "−"}${Math.abs(off)}` : "";
      return `${m.label}${suffix} (${m.year + off})`;
    }
    return year != null ? `${year} (jalon supprimé)` : "jalon supprimé";
  }
  return year != null ? String(year) : null;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
