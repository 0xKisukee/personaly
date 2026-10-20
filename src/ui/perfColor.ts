/**
 * Couleur de performance pour un rendement `pct` (%/an) : échelle divergente
 * drain → neutre → gain, 3 paliers d'intensité selon l'amplitude (§8.2).
 * Renvoie une variable CSS (tokens `--perf-*`). Partagé par le badge, la barre
 * d'accent de ligne et la Sparkline. Fichier séparé du composant pour que
 * `PerformanceBadge.tsx` n'exporte que des composants (Fast Refresh).
 */
export function perfColor(pct: number): string {
  const a = Math.abs(pct);
  if (a < 0.5) return "var(--perf-neutral)"; // dormant
  const tier = a < 2.5 ? 1 : a < 6 ? 2 : 3;
  return pct > 0 ? `var(--perf-gain-${tier})` : `var(--perf-drain-${tier})`;
}
