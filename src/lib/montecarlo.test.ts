/* Tests du Monte Carlo — reproductibilité, cohérence avec le déterministe. */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Asset, ProjectionParams, SimState } from "./types";
import { DEFAULT_PROJECTION } from "./types";
import { project } from "./projection";
import { gaussianOf, runMonteCarlo, seededRng } from "./montecarlo";

const Y = new Date().getFullYear();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Y, 0, 5));
});
afterAll(() => vi.useRealTimers());

const asset = (over: Partial<Asset>): Asset => ({
  id: "a", label: "A", category: "epargne", value: 0, growthRate: 0, incomeMode: "none", ...over,
});
const state = (over: Partial<SimState>): SimState => ({
  profile: { firstName: "T", birthDate: "1995-05-01" },
  milestones: [], assets: [], liabilities: [], incomes: [], expenses: [], events: [],
  ...over,
});
const params = (over: Partial<ProjectionParams> = {}): ProjectionParams => ({
  ...DEFAULT_PROJECTION, horizon: 10, inflation: 0, savingsYield: 0,
  indexIncomes: false, indexExpenses: false, realTerms: false, ...over,
});

describe("générateurs", () => {
  it("seededRng : reproductible, uniforme dans [0,1)", () => {
    const a = seededRng(42), b = seededRng(42);
    const va = Array.from({ length: 5 }, a);
    const vb = Array.from({ length: 5 }, b);
    expect(va).toEqual(vb);
    expect(va.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("gaussianOf : moyenne ≈ 0, écart-type ≈ 1", () => {
    const g = gaussianOf(seededRng(7));
    const n = 20_000;
    let sum = 0, sq = 0;
    for (let i = 0; i < n; i++) { const z = g(); sum += z; sq += z * z; }
    expect(sum / n).toBeCloseTo(0, 1);
    expect(Math.sqrt(sq / n)).toBeCloseTo(1, 1);
  });
});

describe("runMonteCarlo", () => {
  it("volatilité nulle : toutes les bandes = trajectoire déterministe", () => {
    const s = state({ assets: [asset({ value: 100_000, growthRate: 5 })] });
    const det = project(s, params());
    const mc = runMonteCarlo(s, params(), { trials: 20 });
    expect(mc.hasVolatility).toBe(false);
    mc.bands.forEach((b, i) => {
      expect(b.p10).toBeCloseTo(det.points[i].netWorth, 4);
      expect(b.p90).toBeCloseTo(det.points[i].netWorth, 4);
    });
  });

  it("volatilité > 0 : les bandes s'écartent (p90 > p50 > p10) et grandissent avec le temps", () => {
    const s = state({ assets: [asset({ value: 100_000, growthRate: 5, volatility: 15 })] });
    const mc = runMonteCarlo(s, params({ horizon: 20 }), { trials: 200 });
    expect(mc.hasVolatility).toBe(true);
    const end = mc.bands[20];
    expect(end.p90).toBeGreaterThan(end.p50);
    expect(end.p50).toBeGreaterThan(end.p10);
    expect(end.p90 - end.p10).toBeGreaterThan(mc.bands[5].p90 - mc.bands[5].p10);
    // la médiane reste dans un ordre de grandeur cohérent avec le déterministe
    const det = project(s, params({ horizon: 20 })).points[20].netWorth;
    expect(end.p50).toBeGreaterThan(det * 0.6);
    expect(end.p50).toBeLessThan(det * 1.4);
  });

  it("reproductible : même seed → mêmes bandes ; seed différente → tirages différents", () => {
    const s = state({ assets: [asset({ value: 50_000, growthRate: 6, volatility: 18 })] });
    const a = runMonteCarlo(s, params(), { trials: 50, seed: 1 });
    const b = runMonteCarlo(s, params(), { trials: 50, seed: 1 });
    const c = runMonteCarlo(s, params(), { trials: 50, seed: 2 });
    expect(a.bands).toEqual(b.bands);
    expect(a.bands[10].p50).not.toBe(c.bands[10].p50);
  });

  it("taux de succès : 1 quand le plan est excédentaire, 0 quand l'épargne part à sec", () => {
    const riche = state({
      incomes: [{ id: "i", label: "S", category: "salaire", amount: 3_000, period: "monthly" }],
      expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_000, period: "monthly" }],
    });
    expect(runMonteCarlo(riche, params(), { trials: 30 }).successRate).toBe(1);

    const ruine = state({
      expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_000, period: "monthly" }],
    });
    expect(runMonteCarlo(ruine, params(), { trials: 30 }).successRate).toBe(0);
  });

  it("avec cascade de retrait : le succès dépend des actifs liquidables", () => {
    const s = state({
      assets: [asset({ id: "pea", value: 200_000 })],
      expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_000, period: "monthly" }],
    });
    // sans cascade : l'épargne plonge dès la 1re année → échec
    expect(runMonteCarlo(s, params(), { trials: 10 }).successRate).toBe(0);
    // avec cascade : 200 k€ couvrent 12 k€/an sur 10 ans → succès
    expect(runMonteCarlo(s, params({ withdrawalTargets: ["pea"] }), { trials: 10 }).successRate).toBe(1);
  });
});
