/**
 * Utilitaires partagés par tous les graphes SVG maison de la projection
 * (NetWorthChart, CompareChart, FanChart) : formatage compact et positionnement
 * horizontal proportionnel au temps réel écoulé.
 */

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
export const compactEur = (n: number) => compact.format(n) + " €";

/** Couleurs de séries (mode Plans) — palette catégorielle validée (§tokens `--cat-*`),
 *  cohérente avec les camemberts de répartition. Toujours accompagnées d'une légende. */
export const SERIES_COLORS = [
  "var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--sage-deep)",
];

// Positions horizontales proportionnelles au TEMPS RÉEL écoulé, pas à l'indice
// d'année : l'année 0 ne couvre que les mois restants de l'année civile, donc son
// intervalle est compressé — sinon la pente du début paraît anormalement faible.
// frac(0) = 0 (aujourd'hui), frac(i≥1) = (part. + i−1) / total, borné à [0,1].
export function timeFractions(n: number): number[] {
  if (n <= 1) return [0];
  const partial = (12 - new Date().getMonth()) / 12; // durée (en années) de l'année 0
  const t = (i: number) => (i === 0 ? 0 : partial + (i - 1));
  const total = t(n - 1) || 1;
  return Array.from({ length: n }, (_, i) => t(i) / total);
}

/** Index du point dont la position horizontale (fraction 0..1) est la plus proche de `f`. */
export function nearestIndex(fracs: number[], f: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < fracs.length; i++) {
    const d = Math.abs(fracs[i] - f);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
