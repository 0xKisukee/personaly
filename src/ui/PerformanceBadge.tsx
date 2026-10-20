import { percent } from "../lib/format";
import { perfColor } from "./perfColor";

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
