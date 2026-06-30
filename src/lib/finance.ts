/* ===========================================================================
   Calculs financiers — amortissement d'emprunt.
   =========================================================================== */

/**
 * Mensualité d'un emprunt amortissable (échéances constantes).
 * Amortir `capital` sur `months` mensualités au taux annuel `annualRatePct`.
 * Vaut aussi bien pour le capital initial sur la durée totale que pour le
 * capital RESTANT DÛ sur la durée RESTANTE (même mensualité).
 */
export function monthlyPayment(
  capital: number,
  annualRatePct: number,
  months: number
): number {
  if (!capital || !months || months <= 0) return 0;
  const r = (annualRatePct || 0) / 100 / 12;
  if (r === 0) return capital / months;
  return (capital * r) / (1 - Math.pow(1 + r, -months));
}

/** Date de fin estimée d'un prêt : aujourd'hui + `months`. */
export function termEndDate(months: number, from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + Math.round(months));
  return d;
}

const monthYear = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
});

export function formatEndDate(months: number): string {
  if (!months || months <= 0) return "—";
  return monthYear.format(termEndDate(months));
}

/** "23 ans 4 mois", "8 mois", "2 ans". */
export function formatDuration(months: number): string {
  if (!months || months <= 0) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} an${y > 1 ? "s" : ""}`);
  if (m > 0) parts.push(`${m} mois`);
  return parts.join(" ") || "—";
}
