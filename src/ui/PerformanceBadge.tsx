import { percent } from "../lib/format";

/**
 * Couleur de performance pour un rendement `pct` (%/an) : échelle divergente
 * drain → neutre → gain, 3 paliers d'intensité selon l'amplitude (§8.2).
 * Renvoie une variable CSS (tokens `--perf-*`). Partagé par le badge, la barre
 * d'accent de ligne et la Sparkline.
 */
export function perfColor(pct: number): string {
  const a = Math.abs(pct);
  if (a < 0.5) return "var(--perf-neutral)"; // dormant
  const tier = a < 2.5 ? 1 : a < 6 ? 2 : 3;
  return pct > 0 ? `var(--perf-gain-${tier})` : `var(--perf-drain-${tier})`;
}

/**
 * Pastille de performance : flèche (↗/↘/→) + valeur signée. La couleur ne porte
 * JAMAIS l'info seule (§8.3) — le signe et le chiffre restent lisibles désaturés.
 */
export default function PerformanceBadge({ pct, title }: { pct: number; title?: string }) {
  const color = perfColor(pct);
  const arrow = pct > 0.05 ? "↗" : pct < -0.05 ? "↘" : "→";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return (
    <span
      className="perf-badge"
      style={{ color, background: `color-mix(in oklab, ${color} 15%, transparent)` }}
      title={title}
    >
      <span aria-hidden>{arrow}</span>
      <span className="mono">{sign}{percent(Math.abs(pct))}</span>
    </span>
  );
}
