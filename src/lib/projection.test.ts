/* ===========================================================================
   Tests du moteur de projection — le cœur de l'app.

   Le temps est figé au 5 JANVIER de l'année courante : la « 1re année
   partielle » couvre alors 12 mois, ce qui rend les maths déterministes.
   Un bloc dédié teste le départ en cours d'année.
   =========================================================================== */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Asset, Liability, PlannedEvent, ProjectionParams, SimState } from "./types";
import { DEFAULT_PROJECTION } from "./types";
import { project, type ProjectionResult, type YearPoint } from "./projection";
import { monthlyPayment } from "./finance";

const Y = new Date().getFullYear();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Y, 0, 5));
});
afterAll(() => vi.useRealTimers());

/* ------------------------------ helpers ------------------------------ */

const asset = (over: Partial<Asset>): Asset => ({
  id: "a", label: "A", category: "placement", value: 0, growthRate: 0, incomeMode: "none", ...over,
});
const loan = (over: Partial<Liability>): Liability => ({
  id: "l", label: "Prêt", category: "emprunt_immo", outstanding: 0, ...over,
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

const last = (r: ProjectionResult) => r.points[r.points.length - 1];

/** Enrichissement d'une année tel que la modale le calcule. */
const enrich = (pt: YearPoint) =>
  pt.distributed + pt.extra + pt.savingsYield + pt.growth + pt.eventCash + pt.eventGain
  - pt.expenses - pt.charges - pt.interest - pt.insurance - pt.eventFees;

/** Vérifie les deux invariants structurels sur TOUTES les années (mode nominal). */
function checkInvariants(r: ProjectionResult) {
  for (let i = 0; i < r.points.length; i++) {
    const pt = r.points[i];
    // 1. colonne patrimoine de la modale = patrimoine net (début d'année)
    const col = pt.detail.assets.reduce((t, a) => t + a.value, 0)
      - pt.detail.loans.reduce((t, l) => t + l.balance, 0)
      + pt.savings;
    expect(col, `colonne an ${pt.year}`).toBeCloseTo(pt.netWorth, 4);
    // 2. pont : début + enrichissement = début suivant
    if (i + 1 < r.points.length) {
      expect(pt.netWorth + enrich(pt), `pont an ${pt.year}`).toBeCloseTo(r.points[i + 1].netWorth, 4);
    }
    // 3. les sous-lignes somment à leurs agrégats
    expect(pt.detail.assets.reduce((t, a) => t + a.growth, 0), `Σ growth ${pt.year}`).toBeCloseTo(pt.growth, 4);
    expect(pt.detail.assets.reduce((t, a) => t + a.income, 0), `Σ income ${pt.year}`).toBeCloseTo(pt.distributed, 4);
    expect(pt.detail.assets.reduce((t, a) => t + a.charges, 0), `Σ charges ${pt.year}`).toBeCloseTo(pt.charges, 4);
    expect(pt.detail.assets.reduce((t, a) => t + a.deposit, 0), `Σ deposit ${pt.year}`).toBeCloseTo(pt.deposited, 4);
    expect(pt.detail.assets.reduce((t, a) => t + a.withdrawal, 0), `Σ withdrawal ${pt.year}`).toBeCloseTo(pt.withdrawn, 4);
    expect(pt.detail.loans.reduce((t, l) => t + l.interest, 0), `Σ interest ${pt.year}`).toBeCloseTo(pt.interest, 4);
    expect(pt.detail.loans.reduce((t, l) => t + l.principal, 0), `Σ principal ${pt.year}`).toBeCloseTo(pt.principal, 4);
    expect(pt.detail.incomes.reduce((t, f) => t + f.amount, 0), `Σ incomes ${pt.year}`).toBeCloseTo(pt.extra, 4);
    expect(pt.detail.expenses.reduce((t, f) => t + f.amount, 0), `Σ expenses ${pt.year}`).toBeCloseTo(pt.expenses, 4);
  }
}

/* ------------------------------ structure ------------------------------ */

describe("structure de base", () => {
  it("état vide : horizon+1 points, tout à zéro, années/âges corrects", () => {
    const r = project(state({}), params({ horizon: 5 }));
    expect(r.points).toHaveLength(6);
    expect(r.points[0].year).toBe(Y);
    expect(r.points[5].year).toBe(Y + 5);
    expect(r.points[0].age).toBe(Y - 1995);
    expect(r.points.every((p) => p.netWorth === 0 && p.grossAssets === 0 && p.debt === 0)).toBe(true);
    expect(r.events).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.fiYearIndex).toBeNull();
  });

  it("sans date de naissance : âge null", () => {
    const s = state({ profile: { firstName: "", birthDate: "" } });
    expect(project(s, params()).points[0].age).toBeNull();
  });
});

/* --------------------------- croissance --------------------------- */

describe("croissance capitalisée", () => {
  it("compose exactement au taux annuel (12 mensualités de (1+g)^(1/12))", () => {
    const s = state({ assets: [asset({ value: 100_000, growthRate: 12 })] });
    const r = project(s, params({ horizon: 3 }));
    expect(r.points[1].grossAssets).toBeCloseTo(112_000, 2);
    expect(r.points[2].grossAssets).toBeCloseTo(125_440, 2);
    expect(r.points[3].grossAssets).toBeCloseTo(140_492.8, 1);
    checkInvariants(r);
  });

  it("croissance négative : déprécie, et le plancher (valueFloor) arrête la chute", () => {
    const s = state({ assets: [asset({ value: 10_000, growthRate: -50, valueFloor: 4_000 })] });
    const r = project(s, params({ horizon: 5 }));
    expect(r.points[1].grossAssets).toBeCloseTo(5_000, 2); // -50 %/an
    expect(r.points[3].grossAssets).toBeCloseTo(4_000, 6); // plancher atteint
    expect(last(r).grossAssets).toBeCloseTo(4_000, 6); // et n'en bouge plus
    expect(r.points.every((p) => p.grossAssets >= 4_000 - 1e-9)).toBe(true);
    checkInvariants(r);
  });
});

/* ------------------------ revenus distribués ------------------------ */

describe("revenus distribués", () => {
  it("mode rate : suit la valeur de l'actif quand elle compose", () => {
    const s = state({ assets: [asset({ value: 100_000, growthRate: 10, incomeMode: "rate", incomeRate: 4 })] });
    const r = project(s, params({ horizon: 3 }));
    expect(r.points[0].distributed).toBeGreaterThan(4_000); // la valeur monte en cours d'année
    expect(r.points[1].distributed).toBeGreaterThan(r.points[0].distributed);
    checkInvariants(r);
  });

  it("mode amount : plat sans indexation, indexé sur l'inflation avec indexIncomes", () => {
    const s = state({ assets: [asset({ value: 100_000, incomeMode: "amount", income: { amount: 500, period: "monthly" } })] });
    const flat = project(s, params({ horizon: 5, inflation: 2 }));
    expect(flat.points[4].distributed).toBeCloseTo(6_000, 4);
    const indexed = project(s, params({ horizon: 5, inflation: 2, indexIncomes: true }));
    expect(indexed.points[4].distributed).toBeCloseTo(6_000 * 1.02 ** 4, 2);
  });
});

/* --------------------------- flux manuels --------------------------- */

describe("flux manuels (revenus complémentaires & dépenses)", () => {
  it("le surplus s'accumule en épargne", () => {
    const s = state({
      incomes: [{ id: "i", label: "S", category: "salaire", amount: 2_000, period: "monthly" }],
      expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_200, period: "yearly" }],
    });
    const r = project(s, params({ horizon: 2 }));
    expect(r.points[1].savings).toBeCloseTo(24_000 - 1_200, 4);
    expect(r.points[2].savings).toBeCloseTo(2 * (24_000 - 1_200), 4);
    checkInvariants(r);
  });

  it("bornes startYear/endYear inclusives", () => {
    const s = state({
      incomes: [{ id: "i", label: "S", category: "salaire", amount: 1_000, period: "monthly", startYear: Y + 1, endYear: Y + 2 }],
    });
    const r = project(s, params({ horizon: 4 }));
    expect(r.points[0].extra).toBe(0);
    expect(r.points[1].extra).toBeCloseTo(12_000, 6);
    expect(r.points[2].extra).toBeCloseTo(12_000, 6);
    expect(r.points[3].extra).toBe(0);
  });

  it("indexation : le taux `growth` propre au flux prime sur l'inflation globale", () => {
    const s = state({
      incomes: [
        { id: "i1", label: "inflation", category: "salaire", amount: 1_000, period: "monthly" },
        { id: "i2", label: "propre", category: "salaire", amount: 1_000, period: "monthly", growth: 5 },
      ],
    });
    const r = project(s, params({ horizon: 3, inflation: 2, indexIncomes: true }));
    const detail = r.points[2].detail.incomes;
    expect(detail.find((f) => f.id === "i1")!.amount).toBeCloseTo(12_000 * 1.02 ** 2, 2);
    expect(detail.find((f) => f.id === "i2")!.amount).toBeCloseTo(12_000 * 1.05 ** 2, 2);
  });

  it("indexIncomes décoché : flux plat (mais le taux propre s'applique quand même)", () => {
    const s = state({
      incomes: [{ id: "i2", label: "propre", category: "salaire", amount: 1_000, period: "monthly", growth: 5 }],
    });
    const r = project(s, params({ horizon: 3, inflation: 2, indexIncomes: false }));
    expect(r.points[2].extra).toBeCloseTo(12_000 * 1.05 ** 2, 2);
  });
});

/* ----------------------------- emprunts ----------------------------- */

describe("emprunts", () => {
  it("s'amortit et s'éteint à son terme, la dette totale remboursée = capital initial", () => {
    const pmt = monthlyPayment(50_000, 4, 60); // 5 ans
    const s = state({ liabilities: [loan({ outstanding: 50_000, rate: 4, termMonths: 60, monthlyPayment: pmt })] });
    const r = project(s, params({ horizon: 8 }));
    expect(r.points[0].debt).toBe(50_000);
    expect(r.points[5].debt).toBeCloseTo(0, 2); // fini après 60 mois
    expect(r.points.reduce((t, p) => t + p.principal, 0)).toBeCloseTo(50_000, 2);
    expect(r.events.some((e) => e.kind === "loan" && e.label.includes("Fin"))).toBe(true);
    // plus aucun flux après extinction
    expect(r.points[6].interest).toBe(0);
    expect(r.points[6].principal).toBe(0);
    checkInvariants(r);
  });

  it("les intérêts décroissent d'année en année", () => {
    const pmt = monthlyPayment(100_000, 3, 240);
    const s = state({ liabilities: [loan({ outstanding: 100_000, rate: 3, termMonths: 240, monthlyPayment: pmt })] });
    const r = project(s, params({ horizon: 10 }));
    for (let i = 1; i < 10; i++) expect(r.points[i].interest).toBeLessThan(r.points[i - 1].interest);
  });

  it("solde résiduel au terme : remboursement ballon, la dette tombe à 0", () => {
    // mensualité volontairement trop faible pour amortir en 12 mois
    const s = state({ liabilities: [loan({ outstanding: 100_000, rate: 0, termMonths: 12, monthlyPayment: 100 })] });
    const r = project(s, params({ horizon: 3 }));
    expect(r.points[1].debt).toBeCloseTo(98_800, 4); // 12 × 100 remboursés
    expect(r.points[2].debt).toBe(0); // ballon au 13e mois
    expect(r.points[1].principal).toBeCloseTo(98_800, 4);
    checkInvariants(r);
  });

  it("assurance comptée chaque mois actif, plus après extinction", () => {
    const pmt = monthlyPayment(12_000, 0, 12);
    const s = state({ liabilities: [loan({ outstanding: 12_000, termMonths: 12, monthlyPayment: pmt, insurance: 25 })] });
    const r = project(s, params({ horizon: 3 }));
    expect(r.points[0].insurance).toBeCloseTo(300, 4);
    expect(r.points[1].insurance).toBe(0);
  });

  it("dette simple sans mensualité : pèse sur le net, aucun flux, ne s'éteint jamais", () => {
    const s = state({ liabilities: [loan({ outstanding: 10_000, category: "dette" })] });
    const r = project(s, params({ horizon: 5 }));
    expect(last(r).debt).toBe(10_000);
    expect(last(r).netWorth).toBe(-10_000);
    expect(r.points.every((p) => p.interest === 0 && p.principal === 0)).toBe(true);
  });
});

/* --------------------------- épargne & rendement --------------------------- */

describe("épargne", () => {
  it("le rendement compose mensuellement au taux annuel exact", () => {
    const s = state({ events: [{ id: "e", kind: "cash", label: "Apport", year: Y, amount: 12_000 }] });
    const r = project(s, params({ horizon: 2, savingsYield: 12 }));
    expect(r.points[1].savings).toBeCloseTo(12_000 * 1.12, 2);
    expect(r.points[2].savings).toBeCloseTo(12_000 * 1.12 ** 2, 2);
    expect(r.points[0].savingsYield).toBeCloseTo(1_440, 2);
    checkInvariants(r);
  });

  it("pas de rendement sur une épargne négative", () => {
    const s = state({ expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_000, period: "monthly" }] });
    const r = project(s, params({ horizon: 3, savingsYield: 10 }));
    expect(last(r).savings).toBeCloseTo(-36_000, 4);
    expect(r.points.every((p) => p.savingsYield === 0)).toBe(true);
  });
});

/* ----------------------------- cascade ----------------------------- */

describe("cascade d'affectation du surplus", () => {
  const twoTargets = state({
    assets: [
      asset({ id: "liv", label: "Livret", category: "livret_epargne", value: 20_000, depositCap: 25_000, depositsMade: 20_000 }),
      asset({ id: "pea", label: "PEA", category: "placement", value: 10_000, depositCap: 18_000, depositsMade: 10_000 }),
    ],
    incomes: [{ id: "i", label: "S", category: "salaire", amount: 2_000, period: "monthly" }],
    expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_000, period: "monthly" }],
  });

  it("remplit dans l'ordre, respecte les plafonds, l'excédent va à l'épargne", () => {
    const r = project(twoTargets, params({ horizon: 3, surplusTargets: ["liv", "pea"] }));
    const end = last(r);
    expect(end.detail.assets.find((a) => a.id === "liv")!.value).toBeCloseTo(25_000, 2);
    expect(end.detail.assets.find((a) => a.id === "pea")!.value).toBeCloseTo(18_000, 2);
    expect(r.points.reduce((t, p) => t + p.deposited, 0)).toBeCloseTo(13_000, 2);
    expect(end.savings).toBeGreaterThan(0);
    checkInvariants(r);
  });

  it("le routage est NEUTRE pour le patrimoine net (growth 0, yield 0)", () => {
    const a = project(twoTargets, params({ horizon: 3, surplusTargets: ["liv", "pea"] }));
    const b = project(twoTargets, params({ horizon: 3 }));
    a.points.forEach((pt, i) => expect(pt.netWorth).toBeCloseTo(b.points[i].netWorth, 4));
  });

  it("composer le surplus à 6 % bat l'épargne à 0 %", () => {
    const s = state({
      assets: [asset({ id: "pea", value: 0, growthRate: 6 })],
      incomes: [{ id: "i", label: "S", category: "salaire", amount: 1_000, period: "monthly" }],
    });
    const withPea = project(s, params({ horizon: 20, surplusTargets: ["pea"] }));
    const without = project(s, params({ horizon: 20 }));
    expect(last(withPea).netWorth).toBeGreaterThan(last(without).netWorth);
  });

  it("ids inconnus, inéligibles (immobilier) ou en doublon : ignorés sans erreur", () => {
    const s = state({
      assets: [asset({ id: "h", category: "immobilier", value: 100_000 })],
      incomes: [{ id: "i", label: "S", category: "salaire", amount: 1_000, period: "monthly" }],
    });
    const r = project(s, params({ horizon: 2, surplusTargets: ["fantôme", "h", "h"] }));
    expect(r.points.every((p) => p.deposited === 0)).toBe(true);
    expect(last(r).savings).toBeCloseTo(24_000, 4);
  });

  it("les déficits ne puisent PAS dans les actifs cibles : ils restent en épargne", () => {
    const s = state({
      assets: [asset({ id: "pea", value: 10_000 })],
      expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 500, period: "monthly" }],
    });
    const r = project(s, params({ horizon: 2, surplusTargets: ["pea"] }));
    expect(last(r).savings).toBeCloseTo(-12_000, 4);
    expect(last(r).grossAssets).toBe(10_000);
  });
});

/* ---------------------------- événements ---------------------------- */

describe("événements datés", () => {
  it("cash : saut exact du patrimoine, compté dans l'enrichissement", () => {
    const s = state({ events: [{ id: "e", kind: "cash", label: "Héritage", year: Y + 2, amount: 50_000 }] });
    const r = project(s, params({ horizon: 4 }));
    expect(r.points[2].eventCash).toBe(50_000);
    expect(r.points[3].netWorth - r.points[2].netWorth).toBeCloseTo(50_000, 6);
    expect(r.events.some((e) => e.kind === "planned" && e.year === Y + 2)).toBe(true);
    checkInvariants(r);
  });

  const buy: PlannedEvent = {
    id: "buy", kind: "buy", label: "Achat studio", year: Y + 2, price: 100_000, fees: 8_000,
    asset: asset({ id: "studio", label: "Studio", category: "immobilier", growthRate: 2, incomeMode: "amount", income: { amount: 500, period: "monthly" } }),
  };
  const salaire = { id: "i", label: "S", category: "salaire" as const, amount: 3_000, period: "monthly" as const };

  it("achat cash : le patrimoine ne perd QUE les frais ; l'actif distribue et compose dès l'année d'achat", () => {
    const s = state({ events: [buy], incomes: [salaire] });
    const r = project(s, params({ horizon: 5 }));
    const yr = r.points[2];
    expect(yr.eventFees).toBe(8_000);
    expect(yr.distributed).toBeCloseTo(6_000, 4); // loyer dès l'année d'achat
    expect(yr.growth).toBeGreaterThan(0);
    // absent de la colonne l'année d'achat (début d'année), présent ensuite
    expect(yr.detail.assets.find((a) => a.id === "studio")!.value).toBe(0);
    expect(r.points[3].detail.assets.find((a) => a.id === "studio")!.value).toBeCloseTo(102_000, 2);
    checkInvariants(r);
  });

  it("achat financé : emprunt + achat la même année (le cash entre avant de sortir)", () => {
    const events: PlannedEvent[] = [
      { id: "ln", kind: "loan", label: "Prêt studio", year: Y + 2, amount: 80_000, rate: 3, termMonths: 240, insurance: 10 },
      buy,
    ];
    const s = state({ events, incomes: [salaire] });
    const r = project(s, params({ horizon: 5 }));
    expect(r.points[2].interest).toBeGreaterThan(0);
    expect(r.points[3].debt).toBeGreaterThan(75_000); // le prêt est en place
    expect(r.points[3].detail.loans.some((l) => l.id === "ln")).toBe(true);
    checkInvariants(r);
  });

  it("vente à la valeur projetée : ne coûte que les frais, produit net en épargne", () => {
    const s = state({
      assets: [asset({ id: "house", category: "immobilier", value: 200_000 })],
      events: [{ id: "sell", kind: "sell", label: "Vente", year: Y + 3, assetId: "house", feesPct: 5 }],
    });
    const r = project(s, params({ horizon: 5 }));
    expect(r.points[3].eventFees).toBeCloseTo(10_000, 6);
    expect(r.points[3].eventGain).toBe(0);
    expect(r.points[4].savings).toBeCloseTo(190_000, 4);
    expect(r.points[4].grossAssets).toBe(0);
    checkInvariants(r);
  });

  it("vente à prix fixé : l'écart avec la valeur projetée = plus/moins-value réalisée", () => {
    const s = state({
      assets: [asset({ id: "house", category: "immobilier", value: 200_000, growthRate: 2 })],
      events: [{ id: "sell", kind: "sell", label: "Vente", year: Y + 3, assetId: "house", price: 250_000 }],
    });
    const r = project(s, params({ horizon: 4 }));
    const projVal = 200_000 * 1.02 ** 3;
    expect(r.points[3].eventGain).toBeCloseTo(250_000 - projVal, 2);
    checkInvariants(r);
  });

  it("vendre un actif acheté par événement (cycle complet, gain total cohérent)", () => {
    const s = state({
      events: [
        { ...buy, fees: 0 },
        { id: "sell", kind: "sell", label: "Revente", year: Y + 4, assetId: "studio", price: 150_000 },
      ],
      incomes: [salaire],
    });
    const r = project(s, params({ horizon: 6 }));
    // gain total = latent (2 ans à 2 %) + réalisé (150k − valeur projetée) = 50k
    const latent = r.points[2].growth + r.points[3].growth;
    expect(latent + r.points[4].eventGain).toBeCloseTo(50_000, 2);
    expect(r.points[5].grossAssets).toBe(0);
    checkInvariants(r);
  });

  it("remboursement anticipé total : neutre, intérêts éteints", () => {
    const pmt = monthlyPayment(50_000, 4, 120);
    const s = state({
      liabilities: [loan({ id: "l1", outstanding: 50_000, rate: 4, termMonths: 120, monthlyPayment: pmt })],
      events: [
        { id: "c", kind: "cash", label: "Prime", year: Y, amount: 60_000 },
        { id: "rp", kind: "repay", label: "Solde", year: Y + 2, loanId: "l1" },
      ],
    });
    const r = project(s, params({ horizon: 4 }));
    expect(r.points[1].interest).toBeGreaterThan(0);
    expect(r.points[2].interest).toBe(0);
    expect(r.points[2].debt).toBeGreaterThan(0); // début d'année, avant l'événement
    expect(r.points[3].debt).toBe(0);
    checkInvariants(r);
  });

  it("remboursement partiel : la dette baisse du montant, le prêt continue et finit plus tôt", () => {
    const pmt = monthlyPayment(50_000, 4, 120);
    const s = state({
      liabilities: [loan({ id: "l1", outstanding: 50_000, rate: 4, termMonths: 120, monthlyPayment: pmt })],
      events: [
        { id: "c", kind: "cash", label: "Prime", year: Y, amount: 30_000 },
        { id: "rp", kind: "repay", label: "Partiel", year: Y + 1, loanId: "l1", amount: 20_000 },
      ],
    });
    const full = project(state({ liabilities: s.liabilities }), params({ horizon: 10 }));
    const r = project(s, params({ horizon: 10 }));
    const endYearWith = r.events.find((e) => e.kind === "loan")!.year;
    const endYearWithout = full.events.find((e) => e.kind === "loan")!.year;
    expect(endYearWith).toBeLessThan(endYearWithout);
    checkInvariants(r);
  });

  it("versement : transfert neutre épargne → actif, plafond partagé avec la cascade", () => {
    const s = state({
      assets: [asset({ id: "pea", value: 10_000, depositCap: 16_000, depositsMade: 10_000 })],
      events: [
        { id: "c", kind: "cash", label: "Prime", year: Y, amount: 20_000 },
        { id: "d", kind: "deposit", label: "Versement PEA", year: Y + 2, assetId: "pea", amount: 10_000 },
      ],
    });
    const r = project(s, params({ horizon: 4 }));
    // tronqué à la capacité restante (6 000)
    expect(r.points[2].deposited).toBeCloseTo(6_000, 6);
    expect(r.points[3].detail.assets[0].value).toBeCloseTo(16_000, 4);
    expect(r.points[3].savings).toBeCloseTo(14_000, 4);
    expect(r.warnings.some((w) => w.label.includes("plafonné"))).toBe(true);
    checkInvariants(r);
  });

  it("versement vers un actif inéligible : ignoré + warning", () => {
    const s = state({
      assets: [asset({ id: "h", category: "immobilier", value: 100_000 })],
      events: [{ id: "d", kind: "deposit", label: "Vers. maison", year: Y + 1, assetId: "h", amount: 5_000 }],
    });
    const r = project(s, params({ horizon: 2 }));
    expect(r.points.every((p) => p.deposited === 0)).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("alerte quand un achat rend l'épargne négative", () => {
    const r = project(state({ events: [buy] }), params({ horizon: 4 }));
    expect(r.warnings.some((w) => w.label.includes("Épargne négative"))).toBe(true);
  });

  it("vente d'un actif inexistant ou déjà vendu : warning, pas de crash", () => {
    const s = state({
      assets: [asset({ id: "house", category: "immobilier", value: 100_000 })],
      events: [
        { id: "s1", kind: "sell", label: "Vente 1", year: Y + 1, assetId: "house" },
        { id: "s2", kind: "sell", label: "Vente 2", year: Y + 2, assetId: "house" },
        { id: "s3", kind: "sell", label: "Fantôme", year: Y + 1, assetId: "nope" },
      ],
    });
    const r = project(s, params({ horizon: 3 }));
    expect(r.warnings.filter((w) => w.label.includes("ignoré"))).toHaveLength(2);
    expect(last(r).savings).toBeCloseTo(100_000, 4); // une seule vente effective
  });

  it("désactivé (disabled) : ignoré, y compris ses actifs/emprunts pré-créés", () => {
    const s = state({ events: [{ ...buy, disabled: true }] });
    const r = project(s, params({ horizon: 4 }));
    expect(r.points.every((p) => p.eventFees === 0 && p.grossAssets === 0)).toBe(true);
    expect(r.events).toHaveLength(0);
  });

  it("hors horizon (passé ou futur) : ignoré", () => {
    const s = state({
      events: [
        { id: "p", kind: "cash", label: "Passé", year: Y - 1, amount: 999 },
        { id: "f", kind: "cash", label: "Futur", year: Y + 50, amount: 999 },
      ],
    });
    const r = project(s, params({ horizon: 10 }));
    expect(r.points.every((p) => p.eventCash === 0)).toBe(true);
  });

  it("ordre dans une même année : sell → cash → loan → repay → buy → deposit", () => {
    // tout-en-un : vendre la maison, hériter, emprunter, solder l'ancien prêt,
    // acheter le nouveau bien, verser au PEA — le cash entre avant de sortir
    const pmt = monthlyPayment(40_000, 3, 120);
    const s = state({
      assets: [
        asset({ id: "old", category: "immobilier", value: 150_000 }),
        asset({ id: "pea", value: 0 }),
      ],
      liabilities: [loan({ id: "l1", outstanding: 40_000, rate: 3, termMonths: 120, monthlyPayment: pmt })],
      events: [
        { id: "dep", kind: "deposit", label: "PEA", year: Y + 1, assetId: "pea", amount: 30_000 },
        { id: "b", kind: "buy", label: "Nouveau", year: Y + 1, price: 250_000, asset: asset({ id: "new", category: "immobilier" }) },
        { id: "rp", kind: "repay", label: "Solde", year: Y + 1, loanId: "l1" },
        { id: "ln", kind: "loan", label: "Prêt", year: Y + 1, amount: 150_000, rate: 3, termMonths: 240 },
        { id: "c", kind: "cash", label: "Héritage", year: Y + 1, amount: 30_000 },
        { id: "s", kind: "sell", label: "Vente", year: Y + 1, assetId: "old" },
      ],
    });
    const r = project(s, params({ horizon: 3 }));
    // épargne après tout : 150k (vente) + 30k (héritage) + 150k (prêt) − ~40k (solde)
    // − 250k (achat) − 30k (PEA) ≈ 10k et quelques (le prêt initial s'était un peu amorti… non : année 0 il s'amortit)
    expect(r.warnings.filter((w) => w.label.includes("Épargne négative"))).toHaveLength(0);
    expect(r.points[2].grossAssets).toBeGreaterThan(250_000); // nouveau bien + PEA
    checkInvariants(r);
  });
});

/* ------------------------- inflation & euros constants ------------------------- */

describe("inflation & euros constants", () => {
  const s = state({
    assets: [asset({ value: 100_000, growthRate: 5 })],
    incomes: [{ id: "i", label: "S", category: "salaire", amount: 2_000, period: "monthly" }],
    expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_000, period: "monthly" }],
  });

  it("realTerms déflate tout par (1+inflation)^i", () => {
    const nominal = project(s, params({ horizon: 5, inflation: 2, indexIncomes: true, indexExpenses: true }));
    const real = project(s, params({ horizon: 5, inflation: 2, indexIncomes: true, indexExpenses: true, realTerms: true }));
    nominal.points.forEach((pt, i) => {
      const d = 1.02 ** i;
      expect(real.points[i].netWorth).toBeCloseTo(pt.netWorth / d, 4);
      expect(real.points[i].expenses).toBeCloseTo(pt.expenses / d, 4);
      expect(real.points[i].growth).toBeCloseTo(pt.growth / d, 4);
    });
  });

  it("dépenses indexées + euros constants = dépenses réelles PLATES", () => {
    const real = project(s, params({ horizon: 5, inflation: 2, indexExpenses: true, realTerms: true }));
    for (let i = 1; i < 5; i++) expect(real.points[i].expenses).toBeCloseTo(real.points[1].expenses, 4);
  });

  it("les invariants de colonne tiennent aussi en euros constants", () => {
    const real = project(s, params({ horizon: 5, inflation: 2, realTerms: true }));
    for (const pt of real.points) {
      const col = pt.detail.assets.reduce((t, a) => t + a.value, 0)
        - pt.detail.loans.reduce((t, l) => t + l.balance, 0) + pt.savings;
      expect(col).toBeCloseTo(pt.netWorth, 4);
    }
  });
});

/* --------------------- indépendance financière --------------------- */

describe("indépendance financière (seuil utilisateur)", () => {
  const s = state({
    assets: [asset({ id: "pea", value: 50_000, growthRate: 7 })],
    incomes: [{ id: "i", label: "S", category: "salaire", amount: 3_000, period: "monthly" }],
    expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 1_800, period: "monthly" }],
  });

  it("marque la PREMIÈRE année où le patrimoine net atteint le seuil", () => {
    const r = project(s, params({ horizon: 40, savingsYield: 4, fiTarget: 500_000 }));
    expect(r.fiYearIndex).not.toBeNull();
    const idx = r.fiYearIndex!;
    expect(r.points[idx].netWorth).toBeGreaterThanOrEqual(500_000);
    expect(r.points[idx - 1].netWorth).toBeLessThan(500_000);
    expect(r.events.some((e) => e.kind === "fi")).toBe(true);
  });

  it("sans seuil : pas de FI déduite ; seuil inatteignable : null", () => {
    expect(project(s, params({ horizon: 40 })).fiYearIndex).toBeNull();
    expect(project(s, params({ horizon: 40, fiTarget: 1e9 })).fiYearIndex).toBeNull();
  });

  it("en euros constants, le seuil se compare aux montants déflatés (FI plus tardive)", () => {
    const nom = project(s, params({ horizon: 40, savingsYield: 4, inflation: 2, fiTarget: 500_000 }));
    const real = project(s, params({ horizon: 40, savingsYield: 4, inflation: 2, fiTarget: 500_000, realTerms: true }));
    expect(real.fiYearIndex!).toBeGreaterThan(nom.fiYearIndex!);
  });

  it("seuil déjà atteint aujourd'hui : FI en année 0", () => {
    const rich = state({ assets: [asset({ value: 600_000 })] });
    expect(project(rich, params({ fiTarget: 500_000 })).fiYearIndex).toBe(0);
  });
});

/* ------------------------- 1re année partielle ------------------------- */

describe("départ en cours d'année", () => {
  it("la 1re année ne compte que les mois restants, et les sous-lignes somment juste", () => {
    vi.setSystemTime(new Date(Y, 6, 15)); // 15 juillet → 6 mois restants
    try {
      const s = state({
        incomes: [{ id: "i", label: "S", category: "salaire", amount: 1_000, period: "monthly" }],
        expenses: [{ id: "e", label: "V", category: "vie_courante", amount: 400, period: "monthly" }],
      });
      const r = project(s, params({ horizon: 2 }));
      expect(r.points[0].extra).toBeCloseTo(6_000, 6);
      expect(r.points[0].expenses).toBeCloseTo(2_400, 6);
      expect(r.points[1].savings).toBeCloseTo(6 * 600, 6);
      expect(r.points[1].extra).toBeCloseTo(12_000, 6); // années suivantes complètes
      checkInvariants(r);
    } finally {
      vi.setSystemTime(new Date(Y, 0, 5));
    }
  });
});

/* ------------------------------- jalons ------------------------------- */

describe("jalons (dates relatives)", () => {
  const retraite = { id: "ret", label: "Retraite", year: Y + 5 };

  it("un événement ancré suit le jalon quand il bouge (l'instantané year est ignoré)", () => {
    const mk = (msYear: number) =>
      project(state({
        milestones: [{ ...retraite, year: msYear }],
        events: [{ id: "e", kind: "cash", label: "Prime départ", year: Y + 1, amount: 10_000, when: { milestoneId: "ret" } }],
      }), params({ horizon: 10 }));
    expect(mk(Y + 5).points[5].eventCash).toBe(10_000);
    expect(mk(Y + 8).points[8].eventCash).toBe(10_000);
    expect(mk(Y + 8).points[1].eventCash).toBe(0); // l'instantané Y+1 n'est PAS utilisé
  });

  it("offset : « 2 ans après la retraite »", () => {
    const s = state({
      milestones: [retraite],
      events: [{ id: "e", kind: "cash", label: "Voyage", year: Y, amount: -5_000, when: { milestoneId: "ret", offset: 2 } }],
    });
    const r = project(s, params({ horizon: 10 }));
    expect(r.points[7].eventCash).toBe(-5_000);
  });

  it("flux borné par jalons : salaire jusqu'à la retraite, pension ensuite", () => {
    const s = state({
      milestones: [retraite],
      incomes: [
        { id: "sal", label: "Salaire", category: "salaire", amount: 1_000, period: "monthly", endRef: { milestoneId: "ret" } },
        { id: "pen", label: "Pension", category: "rente", amount: 600, period: "monthly", startRef: { milestoneId: "ret", offset: 1 } },
      ],
    });
    const r = project(s, params({ horizon: 8 }));
    expect(r.points[5].extra).toBeCloseTo(12_000, 6); // dernière année de salaire (borne inclusive)
    expect(r.points[6].extra).toBeCloseTo(7_200, 6); // pension seule
    checkInvariants(r);
  });

  it("jalon supprimé : retombe sur l'année instantané + warning (rien ne casse)", () => {
    const s = state({
      events: [{ id: "e", kind: "cash", label: "Prime", year: Y + 2, amount: 10_000, when: { milestoneId: "fantôme" } }],
    });
    const r = project(s, params({ horizon: 5 }));
    expect(r.points[2].eventCash).toBe(10_000);
    expect(r.warnings.some((w) => w.label.includes("jalon supprimé"))).toBe(true);
  });
});

/* ------------------------- cascade de retrait ------------------------- */

describe("cascade de retrait (décumulation)", () => {
  const base = state({
    assets: [
      asset({ id: "liv", label: "Livret", category: "livret_epargne", value: 5_000 }),
      asset({ id: "pea", label: "PEA", category: "placement", value: 50_000 }),
    ],
    expenses: [{ id: "e", label: "Vie", category: "vie_courante", amount: 1_000, period: "monthly" }],
  });

  it("puise dans l'ordre : le livret d'abord, puis le PEA ; l'épargne ne devient pas négative", () => {
    const r = project(base, params({ horizon: 3, withdrawalTargets: ["liv", "pea"] }));
    // an 1 : 12 000 de déficit → 5 000 du livret + 7 000 du PEA
    expect(r.points[0].withdrawn).toBeCloseTo(12_000, 4);
    expect(r.points[1].detail.assets.find((a) => a.id === "liv")!.value).toBeCloseTo(0, 4);
    expect(r.points[1].detail.assets.find((a) => a.id === "pea")!.value).toBeCloseTo(43_000, 4);
    expect(r.points.every((pt) => pt.savings >= -0.01)).toBe(true);
    checkInvariants(r);
  });

  it("le retrait est NEUTRE pour le patrimoine net (mêmes trajectoires qu'en déficit porté)", () => {
    const avec = project(base, params({ horizon: 3, withdrawalTargets: ["liv", "pea"] }));
    const sans = project(base, params({ horizon: 3 }));
    avec.points.forEach((pt, i) => expect(pt.netWorth).toBeCloseTo(sans.points[i].netWorth, 4));
  });

  it("actifs épuisés : le déficit restant retombe en épargne négative", () => {
    const r = project(base, params({ horizon: 6, withdrawalTargets: ["liv", "pea"] }));
    // 55 000 de liquide pour 12 000/an : à sec pendant la 5e année
    expect(last(r).savings).toBeLessThan(0);
    expect(r.points.reduce((t, pt) => t + pt.withdrawn, 0)).toBeCloseTo(55_000, 2);
    checkInvariants(r);
  });

  it("un événement à sortie de cash est couvert par la cascade (pas d'alerte si ça suffit)", () => {
    const s = state({
      assets: [asset({ id: "pea", value: 100_000 })],
      events: [{ id: "b", kind: "cash", label: "Travaux", year: Y + 1, amount: -30_000 }],
    });
    const r = project(s, params({ horizon: 3, withdrawalTargets: ["pea"] }));
    expect(r.warnings).toHaveLength(0);
    expect(r.points[1].withdrawn).toBeCloseTo(30_000, 4);
    expect(r.points[2].detail.assets[0].value).toBeCloseTo(70_000, 4);
    checkInvariants(r);
  });

  it("ids inconnus ou inéligibles (immobilier) : ignorés sans erreur", () => {
    const s = state({
      assets: [asset({ id: "h", category: "immobilier", value: 100_000 })],
      expenses: [{ id: "e", label: "Vie", category: "vie_courante", amount: 500, period: "monthly" }],
    });
    const r = project(s, params({ horizon: 2, withdrawalTargets: ["fantôme", "h"] }));
    expect(r.points.every((pt) => pt.withdrawn === 0)).toBe(true);
    expect(last(r).savings).toBeCloseTo(-12_000, 4);
  });

  it("sans cascade configurée : comportement historique inchangé (déficit en épargne)", () => {
    const r = project(base, params({ horizon: 2 }));
    expect(r.points.every((pt) => pt.withdrawn === 0)).toBe(true);
    expect(last(r).savings).toBeCloseTo(-24_000, 4);
  });
});

/* --------------------------- scénario complet --------------------------- */

describe("scénario complet (kitchen sink) : les invariants tiennent partout", () => {
  it("actifs+emprunts+flux+cascade+événements+inflation, sur 25 ans", () => {
    const pmt = monthlyPayment(120_000, 3.2, 240);
    const s = state({
      assets: [
        asset({ id: "rp", label: "RP", category: "immobilier", value: 250_000, growthRate: 2, charges: { amount: 2_800, period: "yearly" } }),
        asset({ id: "locatif", label: "Locatif", category: "immobilier", value: 150_000, growthRate: 1.5, incomeMode: "amount", income: { amount: 650, period: "monthly" }, charges: { amount: 1_900, period: "yearly" } }),
        asset({ id: "pea", label: "PEA", category: "placement", value: 30_000, growthRate: 6, depositCap: 150_000, depositsMade: 40_000 }),
        asset({ id: "livret", label: "Livret", category: "livret_epargne", value: 22_000, growthRate: 2.4, depositCap: 22_950, depositsMade: 22_000 }),
        asset({ id: "car", label: "Voiture", category: "vehicule", value: 18_000, growthRate: -12, valueFloor: 3_000 }),
        asset({ id: "cto", label: "CTO", category: "placement", value: 5_000, growthRate: 5, incomeMode: "rate", incomeRate: 2 }),
      ],
      liabilities: [
        loan({ id: "l-rp", label: "Prêt RP", outstanding: 120_000, rate: 3.2, termMonths: 240, monthlyPayment: pmt, insurance: 28 }),
        loan({ id: "l-conso", label: "Conso", category: "credit_conso", outstanding: 8_000, rate: 5, termMonths: 36, monthlyPayment: monthlyPayment(8_000, 5, 36) }),
      ],
      incomes: [
        { id: "sal", label: "Salaire", category: "salaire", amount: 3_400, period: "monthly", endYear: Y + 20, growth: 2.5 },
        { id: "pension", label: "Pension", category: "rente", amount: 2_100, period: "monthly", startYear: Y + 21 },
      ],
      expenses: [
        { id: "vie", label: "Vie", category: "vie_courante", amount: 1_900, period: "monthly" },
        { id: "impots", label: "Impôts", category: "impot", amount: 7_200, period: "yearly", growth: 1 },
      ],
      events: [
        { id: "her", kind: "cash", label: "Héritage", year: Y + 6, amount: 90_000 },
        { id: "dep", kind: "deposit", label: "Gros versement PEA", year: Y + 6, assetId: "pea", amount: 60_000 },
        { id: "ln2", kind: "loan", label: "Prêt travaux", year: Y + 8, amount: 30_000, rate: 4, termMonths: 84, insurance: 8 },
        { id: "trav", kind: "cash", label: "Travaux", year: Y + 8, amount: -35_000 },
        { id: "sellcar", kind: "sell", label: "Vente voiture", year: Y + 9, assetId: "car", price: 5_000 },
        { id: "buy2", kind: "buy", label: "Studio locatif", year: Y + 12, price: 110_000, fees: 9_000, asset: asset({ id: "studio2", label: "Studio", category: "immobilier", growthRate: 1.8, incomeMode: "amount", income: { amount: 520, period: "monthly" }, charges: { amount: 1_100, period: "yearly" } }) },
        { id: "ln3", kind: "loan", label: "Prêt studio", year: Y + 12, amount: 90_000, rate: 3.4, termMonths: 180, insurance: 12 },
        { id: "rpay", kind: "repay", label: "Solde conso", year: Y + 2, loanId: "l-conso" },
        { id: "off", kind: "cash", label: "Désactivé", year: Y + 3, amount: 999_999, disabled: true },
      ],
    });
    const p = params({
      horizon: 25, inflation: 2, indexIncomes: true, indexExpenses: true,
      savingsYield: 3, surplusTargets: ["livret", "pea"], fiTarget: 1_500_000,
    });

    const r = project(s, p);
    checkInvariants(r);

    // cohérences globales
    expect(r.points.every((pt) => pt.debt >= 0)).toBe(true);
    expect(r.points.every((pt) => pt.deposited >= 0)).toBe(true);
    // l'événement désactivé n'a rien injecté
    expect(r.points[3].eventCash).toBe(0);
    // le plafond du livret porte sur les VERSEMENTS (950 € de capacité restante),
    // pas sur la valeur — la croissance peut la dépasser
    const totalLivretDeposits = r.points.reduce(
      (t, pt) => t + (pt.detail.assets.find((a) => a.id === "livret")?.deposit ?? 0), 0);
    expect(totalLivretDeposits).toBeLessThanOrEqual(950 + 0.01);
    expect(totalLivretDeposits).toBeGreaterThan(0);
    // en euros constants : mêmes invariants de colonne, patrimoine déflaté cohérent
    const real = project(s, { ...p, realTerms: true });
    r.points.forEach((pt, i) =>
      expect(real.points[i].netWorth).toBeCloseTo(pt.netWorth / 1.02 ** i, 2));
  });
});
