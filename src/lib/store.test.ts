/* Tests de chargement/migration du store (localStorage stubé). */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// stub localStorage AVANT l'import du module (loadState le lit à l'appel)
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

import { RESCUE_KEY, createDebouncedWriter, loadState, migrateState, sanitizeState, serializeState } from "./persistence";
import { DEFAULT_SETTINGS, EMPTY_STATE, EPARGNE_ID, SCHEMA_VERSION, canReceiveDeposits, type AppState } from "./types";

const KEY = "personaly:v1";
const write = (state: object) => mem.set(KEY, JSON.stringify(state));

beforeEach(() => mem.clear());

describe("loadState", () => {
  it("storage vide ou corrompu : état vierge avec un plan par défaut ; le blob corrompu est mis de côté", () => {
    expect(loadState()).toEqual(EMPTY_STATE);
    expect(mem.has(RESCUE_KEY)).toBe(false); // rien à sauver quand il n'y avait rien
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mem.set(KEY, "{pas du json");
    expect(loadState()).toEqual(EMPTY_STATE);
    expect(loadState().plans[0].projection.surplusTargets).toBeUndefined();
    expect(mem.get(RESCUE_KEY)).toBe("{pas du json"); // copie brute : la prochaine écriture n'écrase pas la seule copie
    warn.mockRestore();
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
    expect(s.milestones[0].label).toBe("Retraite"); // jalons désormais GLOBAUX (racine)
    expect(s.plans[0].milestones).toHaveLength(0); // plan-spécifiques vides
    expect(s.plans[0].events).toHaveLength(2);
    expect(s.plans[0].events[0].disabled).toBeUndefined();
    expect(s.plans[0].events[1].disabled).toBe(true);
    expect("scenario" in s.plans[0].events[1]).toBe(false); // clé purgée
    expect("scenarios" in s.plans[0]).toBe(false);
    expect("scenario" in s.plans[0].projection).toBe(false);
    expect(s.plans[0].projection.horizon).toBe(20);
    expect(s.plans[0].projection.inflation).toBeDefined(); // clés manquantes complétées
    expect(s.schemaVersion).toBe(SCHEMA_VERSION); // v1 (sans version) → estampillé au format courant
  });

  it("migre surplusTargetId (héritée) vers la cascade du plan, la clé est purgée", () => {
    write({ projection: { surplusTargetId: "pea" } });
    const s1 = loadState();
    expect(s1.plans[0].projection.surplusTargets).toEqual([{ assetId: "pea", mode: "max" }]);
    expect("surplusTargetId" in s1.plans[0].projection).toBe(false);

    // l'utilisateur vide la cascade puis l'état est re-persisté (comme le fait le provider)
    write({
      ...s1,
      plans: [{ ...s1.plans[0], projection: { ...s1.plans[0].projection, surplusTargets: undefined } }],
    });
    // le zombie ne ressuscite pas
    expect(loadState().plans[0].projection.surplusTargets).toBeUndefined();
  });

  it("migre surplusTargets ancien `string[]` → SurplusFlow[] (mode max) ; les flows déjà au format sont conservés", () => {
    write({
      plans: [{ id: "p1", name: "P", projection: { surplusTargets: ["liv", { assetId: "pea", mode: "percent", percent: 50 }] } }],
      activePlanId: "p1",
    });
    expect(loadState().plans[0].projection.surplusTargets).toEqual([
      { assetId: "liv", mode: "max" },
      { assetId: "pea", mode: "percent", percent: 50 },
    ]);
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

  it("purge les clés héritées : valuationRate (actifs), goalAmount/goalYear/fiTarget (projection)", () => {
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
    expect("fiTarget" in s.plans[0].projection).toBe(false);
  });

  it("liste de plans vide : recrée le plan par défaut", () => {
    write({ plans: [], activePlanId: "x" });
    const s = loadState();
    expect(s.plans).toHaveLength(1);
    expect(s.activePlanId).toBe(s.plans[0].id);
  });

  it("settings.horizon explicite honoré (prioritaire sur le plan)", () => {
    write({ settings: { horizon: 25 }, plans: [{ id: "p1", name: "P", projection: { horizon: 40 } }], activePlanId: "p1" });
    expect(loadState().settings.horizon).toBe(25);
  });

  it("horizon devient global : hissé depuis le plan actif si absent de settings", () => {
    write({ plans: [{ id: "p1", name: "P", projection: { horizon: 40 } }], activePlanId: "p1" });
    expect(loadState().settings.horizon).toBe(40);
  });

  it("indexation & euros constants deviennent globaux : hissés depuis le plan actif", () => {
    write({
      plans: [{ id: "p1", name: "P", projection: { indexIncomes: false, indexExpenses: false, realTerms: true } }],
      activePlanId: "p1",
    });
    const s = loadState();
    expect(s.settings.indexIncomes).toBe(false);
    expect(s.settings.indexExpenses).toBe(false);
    expect(s.settings.realTerms).toBe(true);
  });

  it("jalons GLOBAUX : les jalons des plans sont hissés à la racine (fusion + dédup par id)", () => {
    write({
      plans: [
        { id: "p1", name: "A", milestones: [{ id: "m1", label: "Retraite", year: 2060 }, { id: "m2", label: "Achat", year: 2030 }], projection: {} },
        { id: "p2", name: "B", milestones: [{ id: "m1", label: "Retraite", year: 2060 }, { id: "m3", label: "Enfants", year: 2028 }], projection: {} },
      ],
      activePlanId: "p1",
    });
    const s = loadState();
    expect(s.milestones.map((m) => m.id).sort()).toEqual(["m1", "m2", "m3"]); // fusionnés, dédupés
    expect(s.plans.every((p) => p.milestones.length === 0)).toBe(true); // vidés (deviennent globaux)
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

  it("migre un « versement » (deposit) retiré en transfert depuis l'Épargne (récurrence/flags conservés)", () => {
    write({
      plans: [{
        id: "p1", name: "P", projection: {},
        events: [
          { id: "d", kind: "deposit", label: "PEA", year: 2030, assetId: "pea", amount: 5_000, disabled: true, recurrence: { everyYears: 2 } },
          { id: "c", kind: "cash", label: "Prime", year: 2031, amount: 1_000 },
        ],
      }],
      activePlanId: "p1",
    });
    const ev = loadState().plans[0].events;
    const t = ev.find((e) => e.id === "d")!;
    expect(t.kind).toBe("transfer");
    expect("assetId" in t).toBe(false); // ancienne clé retirée
    if (t.kind === "transfer") {
      expect(t.fromId).toBe(EPARGNE_ID);
      expect(t.toId).toBe("pea");
      expect(t.amount).toBe(5_000);
    }
    expect(t.disabled).toBe(true); // flags conservés
    expect(t.recurrence).toEqual({ everyYears: 2 });
    expect(ev.find((e) => e.id === "c")!.kind).toBe("cash"); // les autres intacts
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

  it("migrateState refuse un contenu qui n'est pas un objet (erreur lisible, pas d'état vierge silencieux)", () => {
    for (const bad of [null, "nope", 42, [1, 2]]) {
      expect(() => migrateState(bad)).toThrow(/pas un objet/);
    }
  });

  it("export : la version est écrite EN TÊTE du fichier, toujours égale à SCHEMA_VERSION", () => {
    const stale = { ...EMPTY_STATE, schemaVersion: 1 } as AppState; // un état mal estampillé en mémoire
    const json = serializeState(stale);
    expect(json.startsWith(`{\n  "schemaVersion": ${SCHEMA_VERSION},`)).toBe(true);
    expect(JSON.parse(json).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("import d'un fichier ancien (état plat) : migré comme au chargement", () => {
    const legacy = { profile: { firstName: "Léo", birthDate: "" }, events: [{ id: "e", kind: "cash", label: "x", year: 2030, amount: 1 }] };
    const s = migrateState(legacy);
    expect(s.plans).toHaveLength(1);
    expect(s.plans[0].events).toHaveLength(1);
    expect(s.profile.firstName).toBe("Léo");
  });
});

describe("version de schéma", () => {
  it("un état sans version (v1) est migré par le chemin historique puis estampillé", () => {
    const s = migrateState({ plans: [{ id: "p1", name: "P", projection: {} }], activePlanId: "p1" });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("un état à la version courante repasse à l'identique (migrations idempotentes)", () => {
    const state = { ...EMPTY_STATE, profile: { firstName: "Noa", birthDate: "1988-02-03" } };
    expect(migrateState(JSON.parse(serializeState(state)))).toEqual(state);
  });

  it("un fichier d'une version PLUS RÉCENTE est refusé à l'import avec un message explicite", () => {
    const future = { ...EMPTY_STATE, schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => migrateState(future)).toThrow(/plus récente/);
    expect(() => migrateState(future)).toThrow(new RegExp(`schéma ${SCHEMA_VERSION + 1}`));
  });

  it("au chargement, une version future fait repartir à vide SANS perdre le blob (clé de secours)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blob = JSON.stringify({ ...EMPTY_STATE, schemaVersion: 99, profile: { firstName: "Futur", birthDate: "" } });
    mem.set(KEY, blob);
    expect(loadState()).toEqual(EMPTY_STATE);
    expect(mem.get(RESCUE_KEY)).toBe(blob);
    warn.mockRestore();
  });

  it("une version illisible (chaîne, NaN) est traitée comme absente : tolérance, puis ré-estampillage", () => {
    expect(migrateState({ ...EMPTY_STATE, schemaVersion: "2" }).schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrateState({ ...EMPTY_STATE, schemaVersion: null }).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("sanitizeState (validation à l'import, sans dépendance)", () => {
  const plan = (over: object = {}) => ({ id: "p1", name: "P", milestones: [], events: [], projection: {}, ...over });

  it("champs numériques : non-nombre → 0 (obligatoire) ou clé retirée (optionnel) ; chaîne numérique acceptée", () => {
    const s = migrateState({
      assets: [{ id: "a", label: "PEA", category: "epargne", value: "abc", growthRate: null, incomeMode: "none", valueFloor: "abc", depositCap: "150000" }],
      liabilities: [{ id: "l", label: "Prêt", category: "credit", outstanding: Infinity, rate: {} }],
      incomes: [{ id: "i", label: "Salaire", category: "salaire", amount: "3000", period: "monthly", growth: "x" }],
      plans: [plan()],
      activePlanId: "p1",
    });
    expect(s.assets[0].value).toBe(0);
    expect(s.assets[0].growthRate).toBe(0);
    expect("valueFloor" in s.assets[0]).toBe(false);
    expect(s.assets[0].depositCap).toBe(150000);
    expect(s.liabilities[0].outstanding).toBe(0);
    expect("rate" in s.liabilities[0]).toBe(false);
    expect(s.incomes[0].amount).toBe(3000);
    expect("growth" in s.incomes[0]).toBe(false);
  });

  it("collections : non-tableau → [] ; entrées non-objet purgées", () => {
    const s = migrateState({ assets: null, liabilities: "x", incomes: 3, expenses: [null, 7, "y"], milestones: {}, plans: [plan()], activePlanId: "p1" });
    expect(s.assets).toEqual([]);
    expect(s.liabilities).toEqual([]);
    expect(s.incomes).toEqual([]);
    expect(s.expenses).toEqual([]);
    expect(s.milestones).toEqual([]);
  });

  it("ids : string non vide sinon régénéré (la donnée est gardée, pas jetée)", () => {
    const s = migrateState({
      assets: [{ label: "Sans id", category: "epargne", value: 10, growthRate: 0, incomeMode: "none" }, { id: "", label: "Vide", category: "autre", value: 1, growthRate: 0, incomeMode: "none" }],
      plans: [plan({ id: 42 })],
      activePlanId: "p1",
    });
    expect(s.assets).toHaveLength(2);
    for (const a of s.assets) expect(typeof a.id === "string" && a.id.length > 0).toBe(true);
    expect(s.assets[0].label).toBe("Sans id");
    expect(typeof s.plans[0].id).toBe("string");
    expect(s.activePlanId).toBe(s.plans[0].id); // l'id actif suit le plan régénéré
  });

  it("événements : sans `kind` connu ou sans cible obligatoire → purgés ; les autres sont forcés", () => {
    const s = migrateState({
      plans: [plan({
        events: [
          { id: "nokind", label: "?", year: 2030, amount: 5 },
          { id: "badkind", kind: "teleport", label: "?", year: 2030 },
          null,
          { id: "buy-noasset", kind: "buy", label: "Achat", year: 2030, price: 1 },
          { id: "sell-noid", kind: "sell", label: "Vente", year: 2030 },
          { id: "tr-noto", kind: "transfer", label: "T", year: 2030, fromId: "a", amount: 1 },
          { kind: "cash", label: "Prime", year: "2031", amount: "1500", recurrence: { everyYears: "x" } },
          { id: "ok-buy", kind: "buy", label: "Voiture", year: 2032, price: 20000, asset: { label: "Auto", category: "vehicule", value: "20000", growthRate: -15 } },
        ],
      })],
      activePlanId: "p1",
    });
    const ev = s.plans[0].events;
    expect(ev.map((e) => e.kind)).toEqual(["cash", "buy"]);
    const cash = ev[0];
    expect(typeof cash.id === "string" && cash.id.length > 0).toBe(true);
    expect(cash.year).toBe(2031);
    expect(cash.kind === "cash" && cash.amount).toBe(1500);
    expect("recurrence" in cash).toBe(false); // motif inexploitable → ponctuel
    const buy = ev[1];
    if (buy.kind === "buy") {
      expect(buy.asset.value).toBe(20000);
      expect(buy.asset.incomeMode).toBe("none");
      expect(typeof buy.asset.id).toBe("string");
    }
  });

  it("énumérations : catégorie/mode inconnus retombent sur une valeur sûre (pas de crash d'affichage)", () => {
    const s = migrateState({
      assets: [{ id: "a", label: "X", category: "crypto", value: 1, growthRate: 0, incomeMode: "yolo", income: { amount: 10, period: "weekly" } }],
      liabilities: [{ id: "l", label: "L", category: "dette_mafia", outstanding: 1 }],
      incomes: [{ id: "i", label: "I", category: "loto", amount: 1, period: "daily", nature: "mixte" }],
      expenses: [{ id: "e", label: "E", category: "???", amount: 1, period: "yearly" }],
      plans: [plan({ projection: { surplusTargets: [{ assetId: "a", mode: "all" }, { mode: "max" }, "liv"], withdrawalTargets: ["a", 3, null] } })],
      activePlanId: "p1",
    });
    expect(s.assets[0].category).toBe("autre");
    expect(s.assets[0].incomeMode).toBe("none");
    expect(s.assets[0].income).toEqual({ amount: 10, period: "monthly" });
    expect(s.liabilities[0].category).toBe("autre");
    expect(s.incomes[0].category).toBe("autre");
    expect(s.incomes[0].period).toBe("monthly");
    expect("nature" in s.incomes[0]).toBe(false);
    expect(s.expenses[0].category).toBe("autre");
    expect(s.plans[0].projection.surplusTargets).toEqual([{ assetId: "a", mode: "max" }, { assetId: "liv", mode: "max" }]);
    expect(s.plans[0].projection.withdrawalTargets).toEqual(["a"]);
  });

  it("profil, réglages, jalons : types forcés ; un jalon sans année est purgé", () => {
    const s = migrateState({
      profile: "Camille",
      settings: { horizon: "abc", realTerms: "oui" },
      milestones: [{ id: "m", label: "Retraite", year: "2057" }, { id: "m2", label: "Sans année" }],
      plans: [plan({ projection: { horizon: 25, inflation: "2.5", indexIncomes: 1 } })],
      activePlanId: "p1",
    });
    expect(s.profile).toEqual({ firstName: "", birthDate: "" });
    expect(s.settings.horizon).toBe(DEFAULT_SETTINGS.horizon); // présent mais illisible → défaut (le hissage depuis le plan ne joue que si la clé est ABSENTE)
    expect(s.settings.realTerms).toBe(false);
    expect(s.milestones).toEqual([{ id: "m", label: "Retraite", year: 2057 }]);
    expect(s.plans[0].projection.inflation).toBe(2.5);
    expect(s.plans[0].projection.indexIncomes).toBe(true); // défaut
  });

  it("est idempotent et conserve les clés inconnues (tolérance)", () => {
    const once = migrateState({ assets: [{ id: "a", label: "A", category: "epargne", value: 1, growthRate: 0, incomeMode: "none", futur: "x" }], plans: [plan()], activePlanId: "p1" });
    expect((once.assets[0] as unknown as { futur: string }).futur).toBe("x");
    expect(sanitizeState(once)).toEqual(once);
  });
});

describe("createDebouncedWriter (sauvegarde différée)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("regroupe les changements rapprochés en UNE écriture du dernier état", () => {
    const write = vi.fn();
    const w = createDebouncedWriter(write, 300);
    const s1 = { ...EMPTY_STATE, activePlanId: "1" };
    const s2 = { ...EMPTY_STATE, activePlanId: "2" };
    w.schedule(s1);
    vi.advanceTimersByTime(200);
    w.schedule(s2);
    vi.advanceTimersByTime(200);
    expect(write).not.toHaveBeenCalled(); // 200 ms après le DERNIER changement seulement
    vi.advanceTimersByTime(100);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(s2);
  });

  it("flush() écrit immédiatement ce qui est en attente (fermeture d'onglet), une seule fois", () => {
    const write = vi.fn();
    const w = createDebouncedWriter(write, 300);
    w.flush(); // rien en attente : no-op
    expect(write).not.toHaveBeenCalled();
    w.schedule(EMPTY_STATE);
    w.flush();
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1); // le timer a bien été annulé
  });

  it("cancel() abandonne l'écriture en attente (réinitialisation)", () => {
    const write = vi.fn();
    const w = createDebouncedWriter(write, 300);
    w.schedule(EMPTY_STATE);
    w.cancel();
    vi.advanceTimersByTime(1000);
    w.flush();
    expect(write).not.toHaveBeenCalled();
  });
});
