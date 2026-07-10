import { describe, it, expect } from "vitest";
import { monthlyPayment, loanYearSplit, termEndDate, formatDuration, formatEndDate } from "./finance";

describe("monthlyPayment", () => {
  it("calcule la mensualité d'un emprunt classique (100 000 € à 3 % sur 20 ans)", () => {
    // valeur de référence calculée indépendamment : 250 / (1 − 1.0025^-240)
    expect(monthlyPayment(100_000, 3, 240)).toBeCloseTo(554.6, 1);
  });

  it("à taux zéro : capital / nombre de mois", () => {
    expect(monthlyPayment(120_000, 0, 240)).toBeCloseTo(500, 10);
  });

  it("cas dégénérés : 0", () => {
    expect(monthlyPayment(0, 3, 240)).toBe(0);
    expect(monthlyPayment(100_000, 3, 0)).toBe(0);
    expect(monthlyPayment(100_000, 3, -12)).toBe(0);
  });

  it("la mensualité amortit exactement le capital sur la durée", () => {
    const capital = 200_000, rate = 3.5, months = 300;
    const pmt = monthlyPayment(capital, rate, months);
    let balance = capital;
    const r = rate / 100 / 12;
    for (let m = 0; m < months; m++) balance -= pmt - balance * r;
    expect(balance).toBeCloseTo(0, 4);
  });
});

describe("loanYearSplit", () => {
  it("intérêts + capital = 12 mensualités (emprunt en cours)", () => {
    const pmt = monthlyPayment(100_000, 3, 240);
    const { interest, principal } = loanYearSplit(100_000, 3, pmt, 240);
    expect(interest + principal).toBeCloseTo(pmt * 12, 4);
    expect(interest).toBeGreaterThan(0);
    expect(principal).toBeGreaterThan(0);
  });

  it("à taux zéro : tout est du capital", () => {
    const { interest, principal } = loanYearSplit(12_000, 0, 500, 240);
    expect(interest).toBe(0);
    expect(principal).toBeCloseTo(6_000, 6);
  });

  it("dernière échéance : le capital est clampé au solde", () => {
    const { interest, principal } = loanYearSplit(1_000, 0, 500, 240);
    expect(principal).toBeCloseTo(1_000, 6);
    expect(interest).toBe(0);
  });

  it("durée restante < 12 mois : le split s'arrête au terme", () => {
    const { interest, principal } = loanYearSplit(100_000, 3, 600, 3);
    expect(interest + principal).toBeCloseTo(600 * 3, 4);
  });

  it("paiement insuffisant pour couvrir les intérêts : principal 0, intérêts réellement courus", () => {
    const { interest, principal } = loanYearSplit(100_000, 12, 500, 240);
    // intérêts mensuels (1 000) > mensualité (500) : rien n'amortit, le solde reste
    // à 100 000 et les intérêts COURUS sont bien de 12 × 1 000 (vrai coût, pas la mensualité)
    expect(principal).toBe(0);
    expect(interest).toBeCloseTo(12_000, 4);
  });

  it("sans mensualité : aucun flux", () => {
    const { interest, principal } = loanYearSplit(100_000, 3, 0, 240);
    expect(interest).toBe(0);
    expect(principal).toBe(0);
  });

  it("les intérêts décroissent d'année en année (amortissement réel)", () => {
    const pmt = monthlyPayment(100_000, 3, 240);
    const y1 = loanYearSplit(100_000, 3, pmt, 240);
    const y2 = loanYearSplit(100_000 - y1.principal, 3, pmt, 228);
    expect(y2.interest).toBeLessThan(y1.interest);
    expect(y2.principal).toBeGreaterThan(y1.principal);
  });
});

describe("dates & durées", () => {
  it("termEndDate ajoute la durée en mois", () => {
    const d = termEndDate(18, new Date(2026, 0, 15));
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(6); // juillet
  });

  it("formatDuration", () => {
    expect(formatDuration(280)).toBe("23 ans 4 mois");
    expect(formatDuration(8)).toBe("8 mois");
    expect(formatDuration(24)).toBe("2 ans");
    expect(formatDuration(1)).toBe("1 mois");
    expect(formatDuration(0)).toBe("—");
  });

  it("formatEndDate : — pour les durées vides", () => {
    expect(formatEndDate(0)).toBe("—");
    expect(formatEndDate(12)).toMatch(/\d{4}/);
  });
});
