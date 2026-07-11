/* ===========================================================================
   Monte Carlo — incertitude des rendements.

   Rejoue le moteur de projection N fois en bruitant la croissance mensuelle de
   chaque actif selon sa `volatility` (écart-type annuel) : rendement mensuel
   ~ N(μ_mensuel, σ/√12). Le reste du plan (flux, emprunts, événements,
   cascades) est identique au mode déterministe.

   Sorties :
   - bandes de percentiles (P10/P25/P50/P75/P90) du patrimoine net par année ;
   - taux de succès = part des tirages où l'épargne ne tombe JAMAIS à sec
     (épargne négative en début d'année = on a manqué de liquide, même après la
     cascade de retrait) ;
   - reproductible : générateur seedé (pas de re-tirage à chaque re-render).
   =========================================================================== */

import type { ProjectionParams, SimState } from "./types";
import { project } from "./projection";

export interface MonteCarloBand {
  yearIndex: number;
  year: number;
  age: number | null;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  trials: number;
  bands: MonteCarloBand[];
  successRate: number; // 0..1
  failures: number; // tirages où l'épargne est tombée à sec
  hasVolatility: boolean; // au moins un actif porte une volatilité > 0
}

/** PRNG déterministe (mulberry32) — suffisant pour de la simulation financière. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tirage gaussien N(0,1) par Box-Muller, alimenté par un uniforme seedé. */
export function gaussianOf(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = rng(); // évite log(0)
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

const SAVINGS_RUIN = -1; // tolérance : sous −1 €, on considère l'épargne à sec

export function runMonteCarlo(
  s: SimState,
  params: ProjectionParams,
  { trials = 400, seed = 12_041 }: { trials?: number; seed?: number } = {}
): MonteCarloResult {
  const hasVolatility = s.assets.some((a) => (a.volatility || 0) > 0)
    || s.events.some((e) => e.kind === "buy" && (e.asset.volatility || 0) > 0);

  const netWorths: number[][] = []; // [trial][yearIndex]
  let failures = 0;

  for (let t = 0; t < trials; t++) {
    const gaussian = gaussianOf(seededRng(seed + t * 7919));
    const r = project(s, params, { gaussian, light: true });
    netWorths.push(r.points.map((pt) => pt.netWorth));
    if (r.points.some((pt) => pt.savings < SAVINGS_RUIN)) failures++;
  }

  // percentile par interpolation linéaire sur la série TRIÉE d'une année
  const pct = (sorted: number[], p: number) => {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  // les années/âges sont identiques d'un tirage à l'autre : un run léger les fournit
  const ref = project(s, params, { light: true }).points;
  const bands: MonteCarloBand[] = ref.map((pt, i) => {
    const ys = netWorths.map((tr) => tr[i]).sort((a, b) => a - b);
    return {
      yearIndex: pt.yearIndex, year: pt.year, age: pt.age,
      p10: pct(ys, 0.1), p25: pct(ys, 0.25), p50: pct(ys, 0.5), p75: pct(ys, 0.75), p90: pct(ys, 0.9),
    };
  });

  return { trials, bands, successRate: trials > 0 ? (trials - failures) / trials : 0, failures, hasVolatility };
}
