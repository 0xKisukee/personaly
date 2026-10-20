import { describe, it, expect } from "vitest";
import { money, signedMoney, percent, toYearly, toMonthly, ageFrom, isActiveYear, uid } from "./format";

/** Normalise les espaces insécables fr-FR pour des assertions lisibles. */
const n = (s: string) => s.replace(/[\u202F\u00A0]/g, " ");

describe("money / signedMoney / percent", () => {
  it("formate en euros sans décimales", () => {
    expect(n(money(1_234_567))).toBe("1 234 567 €");
    expect(n(money(0))).toBe("0 €");
  });

  it("avec centimes sur demande", () => {
    expect(n(money(1234.5, true))).toBe("1 234,50 €");
  });

  it("valeurs non finies : —", () => {
    expect(money(NaN)).toBe("—");
    expect(money(Infinity)).toBe("—");
    expect(signedMoney(NaN)).toBe("—");
    expect(percent(NaN)).toBe("—");
  });

  it("signedMoney : signe explicite, zéro sans signe", () => {
    expect(n(signedMoney(50))).toBe("+50 €");
    expect(n(signedMoney(-50))).toBe("−50 €");
    expect(n(signedMoney(0))).toBe("0 €");
  });

  it("percent", () => {
    expect(n(percent(3.5))).toBe("3,5 %");
    expect(n(percent(0))).toBe("0 %");
    expect(n(percent(2.125))).toBe("2,13 %"); // 2 décimales max
  });
});

describe("périodes", () => {
  it("toYearly / toMonthly convertissent, et sont neutres sur la bonne période", () => {
    expect(toYearly({ amount: 100, period: "monthly" })).toBe(1200);
    expect(toYearly({ amount: 1200, period: "yearly" })).toBe(1200);
    expect(toMonthly({ amount: 1200, period: "yearly" })).toBe(100);
    expect(toMonthly({ amount: 100, period: "monthly" })).toBe(100);
  });

  it("flux absent : 0", () => {
    expect(toYearly(undefined)).toBe(0);
    expect(toMonthly(undefined)).toBe(0);
  });
});

describe("ageFrom", () => {
  it("âge exact selon que l'anniversaire est passé ou non", () => {
    const now = new Date();
    const y = now.getFullYear();
    // né il y a 30 ans, anniversaire déjà passé (1er janvier)
    expect(ageFrom(`${y - 30}-01-01`)).toBe(30);
    // né il y a 30 ans, anniversaire pas encore passé (31 décembre)
    expect(ageFrom(`${y - 30}-12-31`)).toBe(29);
  });

  it("entrée invalide ou vide : null", () => {
    expect(ageFrom("")).toBeNull();
    expect(ageFrom("pas-une-date")).toBeNull();
  });
});

describe("isActiveYear", () => {
  it("sans bornes : toujours actif", () => {
    expect(isActiveYear(undefined, undefined, 2030)).toBe(true);
  });
  it("bornes inclusives", () => {
    expect(isActiveYear(2030, 2032, 2029)).toBe(false);
    expect(isActiveYear(2030, 2032, 2030)).toBe(true);
    expect(isActiveYear(2030, 2032, 2032)).toBe(true);
    expect(isActiveYear(2030, 2032, 2033)).toBe(false);
  });
  it("borne unique", () => {
    expect(isActiveYear(2030, undefined, 2050)).toBe(true);
    expect(isActiveYear(undefined, 2030, 2031)).toBe(false);
  });
});

describe("uid", () => {
  it("génère des identifiants uniques et non vides", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id.length).toBeGreaterThan(8);
  });
});
