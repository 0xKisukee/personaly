import type { YearPoint } from "../lib/projection";
import { money } from "../lib/format";

/* ===========================================================================
   Sankey du cash-flow d'une année projetée — SVG maison.

   Trois colonnes : sources → trésorerie de l'année → affectations.
   L'épargne est le POSTE D'ÉQUILIBRE : ce qui reste part « vers l'épargne »,
   un déficit apparaît côté sources en « puisé dans l'épargne » — les deux
   colonnes somment donc toujours au même total (aucun flux n'est perdu).
   Les transferts (kind "transfer") sont NEUTRES (cash 0) et déjà portés par
   `deposited` / `withdrawn` : leur cash nul les exclut naturellement des barres
   Événements, sans double compte.
   =========================================================================== */

interface Node {
  id: string;
  label: string;
  v: number;
  color: string;
}

const W = 1000;
const RECT_W = 12;
const GAP = 12;
const INNER_H = 330;
const TOP = 30;

export default function SankeyChart({ point }: { point: YearPoint }) {
  const evIn = point.detail.events
    .filter((e) => e.cash > 0)
    .reduce((t, e) => t + e.cash, 0);
  const evOut = point.detail.events
    .filter((e) => e.cash < 0)
    .reduce((t, e) => t - e.cash, 0);

  const inflows = point.distributed + point.extra + point.savingsYield + point.withdrawn + evIn;
  const outflows = point.expenses + point.charges + point.interest + point.insurance + point.principal + point.deposited + evOut;
  const residual = inflows - outflows; // = variation d'épargne de l'année

  const sources: Node[] = [
    { id: "extra", label: "Revenus complémentaires", v: point.extra, color: "var(--gain)" },
    { id: "dist", label: "Revenus du patrimoine", v: point.distributed, color: "var(--gain)" },
    { id: "yield", label: "Rendement épargne", v: point.savingsYield, color: "var(--gain)" },
    { id: "wdr", label: "Retraits d'actifs", v: point.withdrawn, color: "var(--brass)" },
    { id: "evin", label: "Événements — entrées", v: evIn, color: "var(--brass)" },
    { id: "fromsav", label: "Puisé dans l'épargne", v: Math.max(0, -residual), color: "var(--drain)" },
  ].filter((n) => n.v > 0.5);

  const uses: Node[] = [
    { id: "exp", label: "Dépenses & impôts", v: point.expenses, color: "var(--drain)" },
    { id: "chg", label: "Charges d'actifs", v: point.charges, color: "var(--drain)" },
    { id: "int", label: "Intérêts d'emprunt", v: point.interest, color: "var(--drain)" },
    { id: "ins", label: "Assurance emprunt", v: point.insurance, color: "var(--drain)" },
    { id: "pri", label: "Capital remboursé", v: point.principal, color: "var(--sage)" },
    { id: "dep", label: "Versements aux actifs", v: point.deposited, color: "var(--sage)" },
    { id: "evout", label: "Événements — sorties", v: evOut, color: "var(--drain)" },
    { id: "tosav", label: "Vers l'épargne", v: Math.max(0, residual), color: "var(--gain)" },
  ].filter((n) => n.v > 0.5);

  const total = sources.reduce((t, n) => t + n.v, 0); // = Σ uses par construction

  if (total < 1) {
    return (
      <div className="empty" style={{ padding: "44px 24px" }}>
        <div>Aucun flux de trésorerie cette année-là.</div>
      </div>
    );
  }

  const maxCount = Math.max(sources.length, uses.length);
  const scale = (INNER_H - GAP * Math.max(0, maxCount - 1)) / total;
  const H = TOP + INNER_H + 24;

  // positions empilées d'une colonne (rects espacés de GAP) + stubs pleins au centre
  const layout = (nodes: Node[]) => {
    const colH = nodes.reduce((t, n) => t + n.v * scale, 0) + GAP * Math.max(0, nodes.length - 1);
    let y = TOP + (INNER_H - colH) / 2;
    let stub = TOP + (INNER_H - total * scale) / 2;
    return nodes.map((n) => {
      const h = n.v * scale;
      const r = { ...n, y, h, stubY: stub };
      y += h + GAP;
      stub += h;
      return r;
    });
  };

  // anti-collision des libellés : un label = 2 lignes (~30px). Les petits nœuds
  // consécutifs (216 €…) auraient des labels superposés — on les pousse vers le
  // bas au fil de l'eau, le rect reste à sa place exacte.
  const LABEL_H = 30;
  const labelYs = (nodes: { y: number; h: number }[]) => {
    let prev = -Infinity;
    return nodes.map((n) => {
      const c = Math.max(n.y + n.h / 2, prev + LABEL_H);
      prev = c;
      return c;
    });
  };

  const left = layout(sources);
  const right = layout(uses);
  const leftLabelY = labelYs(left);
  const rightLabelY = labelYs(right);
  const midY = TOP + (INNER_H - total * scale) / 2;
  const midH = total * scale;

  const LX = 208; // rect gauche
  const MX = W / 2 - RECT_W / 2; // barre centrale
  const RX = 780; // rect droit

  const ribbon = (x1: number, y1: number, h1: number, x2: number, y2: number, h2: number) => {
    const c = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${c} ${y1}, ${c} ${y2}, ${x2} ${y2}`
      + ` L ${x2} ${y2 + h2} C ${c} ${y2 + h2}, ${c} ${y1 + h1}, ${x1} ${y1 + h1} Z`;
  };

  return (
    <div className="sankey-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {/* rubans gauche → centre */}
        {left.map((n) => (
          <path key={n.id} className="sankey-ribbon" d={ribbon(LX + RECT_W, n.y, n.h, MX, n.stubY, n.h)} fill={n.color}>
            <title>{n.label} · {money(n.v)}</title>
          </path>
        ))}
        {/* rubans centre → droite */}
        {right.map((n) => (
          <path key={n.id} className="sankey-ribbon" d={ribbon(MX + RECT_W, n.stubY, n.h, RX, n.y, n.h)} fill={n.color}>
            <title>{n.label} · {money(n.v)}</title>
          </path>
        ))}

        {/* nœuds gauche */}
        {left.map((n, i) => (
          <g key={n.id}>
            <rect x={LX} y={n.y} width={RECT_W} height={Math.max(n.h, 2)} rx="3" fill={n.color} />
            <text x={LX - 10} y={leftLabelY[i] - 2} textAnchor="end" className="sankey-label">{n.label}</text>
            <text x={LX - 10} y={leftLabelY[i] + 13} textAnchor="end" className="sankey-amount">{money(n.v)}</text>
          </g>
        ))}

        {/* barre centrale */}
        <rect x={MX} y={midY} width={RECT_W} height={midH} rx="3" fill="var(--brass)" fillOpacity="0.85" />
        <text x={MX + RECT_W / 2} y={midY - 12} textAnchor="middle" className="sankey-label" style={{ fill: "var(--brass-bright)" }}>
          Trésorerie {point.year} · {money(total)}
        </text>

        {/* nœuds droite */}
        {right.map((n, i) => (
          <g key={n.id}>
            <rect x={RX} y={n.y} width={RECT_W} height={Math.max(n.h, 2)} rx="3" fill={n.color} />
            <text x={RX + RECT_W + 10} y={rightLabelY[i] - 2} textAnchor="start" className="sankey-label">{n.label}</text>
            <text x={RX + RECT_W + 10} y={rightLabelY[i] + 13} textAnchor="start" className="sankey-amount">{money(n.v)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
