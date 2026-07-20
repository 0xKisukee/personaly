/* Invariants du registre de types d'actifs (taxonomie). */
import { describe, it, expect } from "vitest";
import { DEPOSIT_ELIGIBLE, canReceiveDeposits, type Asset, type AssetCategory } from "./types";
import { ASSET_TYPES, ASSET_CATEGORIES, hasField, normalizeAsset, emptyAssetOf } from "./assets";

const asset = (over: Partial<Asset>): Asset => ({ ...emptyAssetOf("autre", "x"), ...over });

describe("registre de types d'actifs", () => {
  it("chaque catégorie a une entrée et figure dans l'ordre d'affichage", () => {
    const keys = Object.keys(ASSET_TYPES) as AssetCategory[];
    for (const c of keys) {
      expect(ASSET_TYPES[c].id).toBe(c);
      expect(ASSET_CATEGORIES).toContain(c);
    }
    expect(ASSET_CATEGORIES.length).toBe(keys.length);
  });

  it("INVARIANT : le bloc UI « deposits » ⇔ l'éligibilité moteur (DEPOSIT_ELIGIBLE)", () => {
    for (const c of ASSET_CATEGORIES) {
      expect(hasField(c, "deposits")).toBe(DEPOSIT_ELIGIBLE.includes(c));
    }
  });

  it("normalizeAsset coupe le revenu quand la catégorie ne l'expose pas", () => {
    // compte courant : aucun revenu distribué
    expect(normalizeAsset(asset({ category: "compte_courant", incomeMode: "amount" })).incomeMode).toBe("none");
    // immobilier NON loué : revenu coupé
    expect(normalizeAsset(asset({ category: "immobilier", rented: false, incomeMode: "amount" })).incomeMode).toBe("none");
    // immobilier loué : revenu conservé
    expect(normalizeAsset(asset({ category: "immobilier", rented: true, incomeMode: "amount" })).incomeMode).toBe("amount");
    // épargne : dividendes conservés
    expect(normalizeAsset(asset({ category: "epargne", incomeMode: "rate", incomeRate: 2 })).incomeMode).toBe("rate");
  });

  it("normalizeAsset neutralise la croissance des catégories sans bloc growth", () => {
    const cash = normalizeAsset(asset({ category: "liquidites", growthRate: 5, volatility: 3 }));
    expect(cash.growthRate).toBe(0);
    expect(cash.volatility).toBeUndefined();
  });

  it("véhicule autorise une croissance POSITIVE (voiture de collection)", () => {
    const collection = normalizeAsset(asset({ category: "vehicule", growthRate: 4 }));
    expect(collection.growthRate).toBe(4); // pas de restriction de signe
  });

  it("canReceiveDeposits : epargne & compte oui, immobilier/liquidités non", () => {
    expect(canReceiveDeposits({ category: "epargne" })).toBe(true);
    expect(canReceiveDeposits({ category: "compte_courant" })).toBe(true);
    expect(canReceiveDeposits({ category: "immobilier" })).toBe(false);
    expect(canReceiveDeposits({ category: "liquidites" })).toBe(false);
  });
});
