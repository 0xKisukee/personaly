/* Tests de chargement/migration du store (localStorage stubé). */
import { describe, it, expect, beforeEach, vi } from "vitest";

// stub localStorage AVANT l'import du module (loadState le lit à l'appel)
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { loadState, migrateState, serializeState } from "./store";
import { EMPTY_STATE, canReceiveDeposits } from "./types";

const KEY = "personaly:v1";
const write = (state: object) => mem.set(KEY, JSON.stringify(state));

beforeEach(() => mem.clear());

describe("loadState", () => {
  it("storage vide ou corrompu : état vierge avec un plan par défaut", () => {
    expect(loadState()).toEqual(EMPTY_STATE);
    mem.set(KEY, "{pas du json");
    expect(loadState()).toEqual(EMPTY_STATE);
    expect(loadState().plans[0].projection.surplusTargets).toBeUndefined();
  });

  it("migre un état PLAT (v1 sans plans) : événements/jalons/hypothèses → Plan principal", () => {
    write({
      profile: { firstName: "A", birthDate: "" },
      assets: [{ id: "a" }],
      milestones: [{ id: "m", label: "Retraite", year: 2057 }],
      events: [
        { id: "e", kind: "cash", label: "x", year: 2030, amount: 1 },
        // événement d'un ancien SCÉNARIO : conservé mais désactivé (la Base l'excluait déjà)
        { id: "e2", kind: "cash", label: "y", year: 2031, amount: 2, scenario: "A" },
      ],
      scenarios: ["A"],
      projection: { horizon: 20, scenario: "A" },
    });
    const s = loadState();
    expect(s.assets).toHaveLength(1); // finances courantes à la racine
    expect(s.plans).toHaveLength(1);
    expect(s.activePlanId).toBe(s.plans[0].id);
    expect(s.plans[0].name).toBe("Plan principal");
    expect(s.plans[0].milestones[0].label).toBe("Retraite");
    expect(s.plans[0].events).toHaveLength(2);
    expect(s.plans[0].events[0].disabled).toBeUndefined();
    expect(s.plans[0].events[1].disabled).toBe(true);
    expect("scenario" in s.plans[0].events[1]).toBe(false); // clé purgée
    expect("scenarios" in s.plans[0]).toBe(false);
    expect("scenario" in s.plans[0].projection).toBe(false);
    expect(s.plans[0].projection.horizon).toBe(20);
    expect(s.plans[0].projection.inflation).toBeDefined(); // clés manquantes complétées
  });

  it("migre surplusTargetId (héritée) vers la cascade du plan, la clé est purgée", () => {
    write({ projection: { surplusTargetId: "pea" } });
    const s1 = loadState();
    expect(s1.plans[0].projection.surplusTargets).toEqual(["pea"]);
    expect("surplusTargetId" in s1.plans[0].projection).toBe(false);

    // l'utilisateur vide la cascade puis l'état est re-persisté (comme le fait le provider)
    write({
      ...s1,
      plans: [{ ...s1.plans[0], projection: { ...s1.plans[0].projection, surplusTargets: undefined } }],
    });
    // le zombie ne ressuscite pas
    expect(loadState().plans[0].projection.surplusTargets).toBeUndefined();
  });

  it("état à plans : complète les clés manquantes, purge `scenarios`, corrige un activePlanId invalide", () => {
    write({
      plans: [
        { id: "p1", name: "Un", projection: { horizon: 15 }, scenarios: ["X"] },
        { id: "p2", name: "Deux" },
      ],
      activePlanId: "fantôme",
    });
    const s = loadState();
    expect(s.plans).toHaveLength(2);
    expect(s.plans[0].events).toEqual([]);
    expect(s.plans[0].milestones).toEqual([]);
    expect("scenarios" in s.plans[0]).toBe(false);
    expect(s.plans[0].projection.horizon).toBe(15);
    expect(s.plans[1].projection.horizon).toBeGreaterThan(0);
    expect(s.activePlanId).toBe("p1"); // retombe sur le 1er plan
  });

  it("purge les clés héritées : valuationRate (actifs), goalAmount/goalYear (projection)", () => {
    write({
      assets: [{ id: "a", label: "A5", category: "vehicule", value: 18500, growthRate: -3, valuationRate: -3, incomeMode: "none" }],
      plans: [{ id: "p1", name: "Un", projection: { horizon: 40, goalAmount: 1_200_000, goalYear: 2060, fiTarget: 1_100_000 } }],
      activePlanId: "p1",
    });
    const s = loadState();
    expect("valuationRate" in s.assets[0]).toBe(false);
    expect(s.assets[0].growthRate).toBe(-3);
    expect("goalAmount" in s.plans[0].projection).toBe(false);
    expect("goalYear" in s.plans[0].projection).toBe(false);
    expect(s.plans[0].projection.fiTarget).toBe(1_100_000);
  });

  it("liste de plans vide : recrée le plan par défaut", () => {
    write({ plans: [], activePlanId: "x" });
    const s = loadState();
    expect(s.plans).toHaveLength(1);
    expect(s.activePlanId).toBe(s.plans[0].id);
  });

  it("backfill des réglages : settings absents → inflation par défaut (2 %)", () => {
    write({ assets: [], plans: [{ id: "p1", name: "P", projection: {} }], activePlanId: "p1" });
    expect(loadState().settings.defaultInflation).toBe(2);
  });

  it("réglages partiels préservés à l'import (pas écrasés par le défaut)", () => {
    write({ settings: { defaultInflation: 3.5 }, plans: [{ id: "p1", name: "P", projection: {} }], activePlanId: "p1" });
    expect(loadState().settings.defaultInflation).toBe(3.5);
  });

  it("migre la taxonomie d'actifs : livret_epargne & placement → epargne (versements préservés)", () => {
    write({
      assets: [
        { id: "liv", label: "Livret A", category: "livret_epargne", value: 20000, growthRate: 2.4, depositCap: 22950, incomeMode: "none" },
        { id: "pea", label: "PEA", category: "placement", value: 30000, growthRate: 6, depositCap: 150000, incomeMode: "none" },
        { id: "rp", label: "Maison", category: "immobilier", value: 250000, growthRate: 2, incomeMode: "none" },
      ],
      plans: [{ id: "p1", name: "P", projection: {} }],
      activePlanId: "p1",
    });
    const s = loadState();
    expect(s.assets.map((a) => a.category)).toEqual(["epargne", "epargne", "immobilier"]);
    expect(s.assets[0].depositCap).toBe(22950); // plafond conservé
    expect(canReceiveDeposits(s.assets[0])).toBe(true); // epargne reste éligible
    expect(canReceiveDeposits(s.assets[2])).toBe(false); // immobilier non éligible
  });
});

describe("export / import (round-trip)", () => {
  it("serializeState → migrateState restitue un état à l'identique", () => {
    const state = {
      ...EMPTY_STATE,
      profile: { firstName: "Camille", birthDate: "1990-05-01" },
      assets: [{ id: "a", label: "PEA", category: "epargne" as const, value: 50000, growthRate: 6, incomeMode: "none" as const }],
      liabilities: [{ id: "l", label: "Prêt", category: "emprunt_immo" as const, outstanding: 120000 }],
      plans: [{ ...EMPTY_STATE.plans[0], projection: { ...EMPTY_STATE.plans[0].projection, horizon: 25 } }],
    };
    const restored = migrateState(JSON.parse(serializeState(state)));
    expect(restored).toEqual(state);
  });

  it("migrateState est tolérant : entrée non-objet → état vierge", () => {
    expect(migrateState(null)).toEqual(EMPTY_STATE);
    expect(migrateState("nope")).toEqual(EMPTY_STATE);
    expect(migrateState(42)).toEqual(EMPTY_STATE);
  });

  it("import d'un fichier ancien (état plat) : migré comme au chargement", () => {
    const legacy = { profile: { firstName: "Léo", birthDate: "" }, events: [{ id: "e", kind: "cash", label: "x", year: 2030, amount: 1 }] };
    const s = migrateState(legacy);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0].events).toHaveLength(1);
    expect(s.profile.firstName).toBe("Léo");
  });
});
