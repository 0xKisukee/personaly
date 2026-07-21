export interface DonutSegment {
  value: number;
  color: string; // couleur CSS (ex. "var(--sage)")
  label?: string;
}

interface Props {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  /** Ligne principale au centre (ex. total formaté). */
  centerValue?: string;
  /** Petite ligne au centre (ex. « Actifs »). */
  centerLabel?: string;
  /** Part mise en avant (contrôlée par le parent → survol bidirectionnel avec la légende). */
  activeIndex?: number | null;
  /** Notifie le parent de la part survolée dans le donut. */
  onHoverChange?: (index: number | null) => void;
}

/**
 * Donut SVG (répartition). Chaque segment = un arc proportionnel via `stroke-dasharray`.
 * Survoler une part estompe les autres et remonte l'index au parent (`onHoverChange`)
 * pour surligner la légende correspondante. Le centre reste le total (toujours lisible) ;
 * les libellés (souvent longs) vivent dans la légende, pas dans le trou du donut.
 */
const GROW = 4; // élargissement de la part survolée

export default function Donut({ segments, size = 164, thickness = 18, centerValue, centerLabel, activeIndex = null, onHoverChange }: Props) {
  const active = activeIndex; // contrôlé par le parent
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  // rayon réduit de GROW pour que la part grossie au survol ne déborde pas du viewBox
  const r = (size - thickness - GROW) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let offset = 0;

  const set = (i: number | null) => onHoverChange?.(i);

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--line-strong)" strokeWidth={thickness} />
          {total > 0 &&
            segments.map((seg, i) => {
              const frac = Math.max(0, seg.value) / total;
              const dash = frac * c;
              const el = (
                <circle
                  key={i}
                  cx={cx}
                  cy={cx}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={active === i ? thickness + GROW : thickness}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  style={{
                    transition: "stroke-width 0.15s ease, filter 0.15s ease",
                    cursor: "pointer",
                    filter: active === i ? "brightness(1.18)" : undefined,
                  }}
                  onMouseEnter={() => set(i)}
                  onMouseLeave={() => set(null)}
                />
              );
              offset += dash;
              return el;
            })}
        </g>
      </svg>
      <div className="donut-center">
        <div className="donut-center-main">{centerValue}</div>
        <div className="donut-center-sub">{centerLabel}</div>
      </div>
    </div>
  );
}
