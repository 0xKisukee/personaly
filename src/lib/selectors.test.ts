import { describe, it, expect } from "vitest";
import type { AppState, Asset, Liability } from "./types";
import { DEFAULT_PLAN, DEFAULT_SETTINGS } from "./types";
import {
  assetYearlyIncome, assetYearlyGrowth, grossWealth, totalLiabilities, netWealth,
  patrimoineIncomeYearly, extraIncomeYearly, capitalizedGrowthYearly,
  latentGainYearly, latentLossYearly, cashInflowsYearly,
  loanInterestYearly, loanPrincipalYearly, loanPaymentsYearly,
  expensesYearly, assetChargesYearly, loanInsuranceYearly,
  inflowsYearly, outflowsYearly, enrichmentYearly, realizedEnrichmentYearly,
  assetPerformance,
} from "./selectors";
import { monthlyPayment } from "./finance";

const Y = new Date().getFullYear();

const asset = (over: Partial<Asset>): Asset => ({
  id: "a", label: "A", category: "epargne", value: 0, growthRate: 0, incomeMode: "none", ...over,
});
const state = (over: Partial<AppState>): AppState => ({
  profile: { firstName: "", birthDate: "" },
  settings: DEFAULT_SETTINGS,
  assets: [], liabilities: [], incomes: [], expenses: [],
  plans: [DEFAULT_PLAN], activePlanId: DEFAULT_PLAN.id, ...over,
});

describe("assetPerformance (langage couleur de perf)", () => {
  it("total = croissance capitalisée + rendement distribué net (rapporté à la valeur)", () => {
    // 200 000 €, +2 %/an de valeur, loyer 600/mois (7 200/an) − 1 200/an de charges
    const a = asset({
      value: 200_000, growthRate: 2, incomeMode: "amount",
      income: { amount: 600, period: "monthly" }, charges: { amount: 1_200, period: "yearly" },
    });
    const p = assetPerformance(a);
    expect(p.latentPct).toBe(2);
    expect(p.cashEur).toBe(6_000); // 7 200 − 1 200
    expect(p.cashPct).toBeCloseTo(3, 5); // 6 000 / 200 000
    expect(p.pct).toBeCloseTo(5, 5); // 2 + 3
    expect(p.netEur).toBeCloseTo(10_000, 5); // 4 000 latent + 6 000 cash
  });

  it("actif qui coûte (charges > revenu) → perf négative ; valeur 0 → cashPct 0 (pas de division)", () => {
    expect(assetPerformance(asset({ value: 300_000, growthRate: 0, charges: { amount: 3_000, period: "yearly" } })).pct).toBeCloseTo(-1, 5);
    expect(assetPerformance(asset({ value: 0, growthRate: 5 })).cashPct).toBe(0);
  });
});

describe("patrimoine", () => {
  const s = state({
    assets: [asset({ id: "a1", value: 100_000 }), asset({ id: "a2", value: 50_000 })],
    liabilities: [{ id: "l1", label: "P", category: "emprunt_immo", outstanding: 60_000 } as Liability],
  });
  it("brut / passifs / net", () => {
    expect(grossWealth(s)).toBe(150_000);
    expect(totalLiabilities(s)).toBe(60_000);
    expect(netWealth(s)).toBe(90_000);
  });
});

describe("revenus d'actifs", () => {
  it("mode rate : % de la valeur par an", () => {
    expect(assetYearlyIncome(asset({ value: 100_000, incomeMode: "rate", incomeRate: 4 }))).toBe(4_000);
  });
  it("mode amount : conversion mensuel → annuel", () => {
    expect(assetYearlyIncome(asset({ incomeMode: "amount", income: { amount: 500, period: "monthly" } }))).toBe(6_000);
  });
  it("mode none : 0", () => {
    expect(assetYearlyIncome(asset({ value: 100_000, incomeMode: "none" }))).toBe(0);
  });
});

describe("croissance capitalisée : split latent gain / perte", () => {
  const s = state({
    assets: [
      asset({ id: "up", value: 100_000, growthRate: 6 }),   // +6 000
      asset({ id: "down", value: 20_000, growthRate: -15 }), // −3 000
    ],
  });
  it("croissance nette = gains + pertes", () => {
    expect(capitalizedGrowthYearly(s)).toBeCloseTo(3_000, 6);
  });
  it("gains latents : seulement les positifs", () => {
    expect(latentGainYearly(s)).toBeCloseTo(6_000, 6);
  });
  it("pertes latentes : seulement les négatifs (valeur ≤ 0)", () => {
    expect(latentLossYearly(s)).toBeCloseTo(-3_000, 6);
  });
  it("croissance par actif", () => {
    expect(assetYearlyGrowth(asset({ value: 10_000, growthRate: -50 }))).toBe(-5_000);
  });
});

describe("flux manuels bornés par années", () => {
  const s = state({
    incomes: [
      { id: "i1", label: "actif", category: "salaire", amount: 1_000, period: "monthly" },
      { id: "i2", label: "futur", category: "rente", amount: 2_000, period: "monthly", startYear: Y + 5 },
      { id: "i3", label: "passé", category: "autre", amount: 3_000, period: "monthly", endYear: Y - 1 },
    ],
    expenses: [
      { id: "e1", label: "vie", category: "vie_courante", amount: 500, period: "monthly" },
      { id: "e2", label: "finie", category: "autre", amount: 900, period: "yearly", endYear: Y - 1 },
    ],
  });
  it("seuls les flux actifs CETTE année comptent", () => {
    expect(extraIncomeYearly(s)).toBe(12_000);
    expect(expensesYearly(s)).toBe(6_000);
  });
});

describe("emprunts", () => {
  const pmt = monthlyPayment(100_000, 3, 240);
  const loan: Liability = {
    id: "l", label: "Prêt", category: "emprunt_immo",
    outstanding: 100_000, rate: 3, termMonths: 240, monthlyPayment: pmt, insurance: 20,
  };
  const s = state({ liabilities: [loan] });

  it("intérêts + capital = mensualités de l'année", () => {
    expect(loanInterestYearly(s) + loanPrincipalYearly(s)).toBeCloseTo(pmt * 12, 4);
    expect(loanPaymentsYearly(s)).toBeCloseTo(pmt * 12, 4);
  });
  it("assurance annuelle comptée seulement si mensualité active", () => {
    expect(loanInsuranceYearly(s)).toBe(240);
    const dormant = state({ liabilities: [{ ...loan, monthlyPayment: 0 }] });
    expect(loanInsuranceYearly(dormant)).toBe(0);
  });
});

describe("comptabilité de l'enrichissement", () => {
  const pmt = monthlyPayment(50_000, 4, 120);
  const s = state({
    assets: [
      asset({ id: "immo", value: 200_000, growthRate: 2, incomeMode: "amount", income: { amount: 800, period: "monthly" }, charges: { amount: 2_400, period: "yearly" } }),
      asset({ id: "car", value: 10_000, growthRate: -10 }),
    ],
    liabilities: [{ id: "l", label: "P", category: "emprunt_immo", outstanding: 50_000, rate: 4, termMonths: 120, monthlyPayment: pmt, insurance: 10 }],
    incomes: [{ id: "i", label: "Salaire", category: "salaire", amount: 3_000, period: "monthly" }],
    expenses: [{ id: "e", label: "Vie", category: "vie_courante", amount: 1_500, period: "monthly" }],
  });

  it("entrants = encaissés + plus-values latentes", () => {
    expect(inflowsYearly(s)).toBeCloseTo(cashInflowsYearly(s) + latentGainYearly(s), 6);
    expect(cashInflowsYearly(s)).toBeCloseTo(patrimoineIncomeYearly(s) + extraIncomeYearly(s), 6);
  });

  it("sortants : dépenses + charges + intérêts + assurance + moins-values, SANS le capital remboursé", () => {
    const expected = expensesYearly(s) + assetChargesYearly(s) + loanInterestYearly(s) + loanInsuranceYearly(s) - latentLossYearly(s);
    expect(outflowsYearly(s)).toBeCloseTo(expected, 6);
    // le capital remboursé n'y figure pas
    expect(outflowsYearly(s)).toBeLessThan(expected + loanPrincipalYearly(s));
  });

  it("enrichissement = entrants − sortants ; réalisé = encaissé − décaissé (sans latent)", () => {
    expect(enrichmentYearly(s)).toBeCloseTo(inflowsYearly(s) - outflowsYearly(s), 6);
    const realized = cashInflowsYearly(s) - expensesYearly(s) - assetChargesYearly(s) - loanInterestYearly(s) - loanInsuranceYearly(s);
    expect(realizedEnrichmentYearly(s)).toBeCloseTo(realized, 6);
    // enrichissement total = réalisé + latent net
    expect(enrichmentYearly(s)).toBeCloseTo(realizedEnrichmentYearly(s) + capitalizedGrowthYearly(s), 6);
  });
});
