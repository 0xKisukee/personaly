import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_PLAN, DEFAULT_PROJECTION, EMPTY_STATE, type AppState, type Asset, type AssetCategory, type Liability, type LiabilityCategory, type Plan, type PlannedEvent, type ProjectionParams } from "./types";

const STORAGE_KEY = "personaly:v1";

/** Complète une projection persistée + purge les clés héritées. */
function loadProjection(raw: object | undefined): ProjectionParams {
  const projection = { ...DEFAULT_PROJECTION, ...(raw ?? {}) };
  // migration À USAGE UNIQUE : surplusTargetId (cible unique) -> surplusTargets
  // (cascade). La clé héritée est PURGÉE de l'état : sans ça, elle restait dans
  // le storage et ressuscitait la cascade à chaque chargement même après que
  // l'utilisateur l'avait vidée (« affectation zombie »).
  const legacyId = (raw as { surplusTargetId?: unknown } | undefined)?.surplusTargetId;
  if (!projection.surplusTargets && typeof legacyId === "string" && legacyId) {
    projection.surplusTargets = [legacyId];
  }
  delete (projection as Record<string, unknown>).surplusTargetId;
  delete (projection as Record<string, unknown>).scenario; // héritée des scénarios (supprimés)
  delete (projection as Record<string, unknown>).goalAmount; // ancêtres de fiTarget
  delete (projection as Record<string, unknown>).goalYear;
  return projection;
}

/**
 * Migration des catégories d'actifs (taxonomie enrichie) : livrets et placements
 * fusionnent dans `epargne` (décision : « c'est la même chose »). Rien n'est perdu —
 * `epargne` reste éligible aux versements, les plafonds/valeurs sont conservés.
 */
const CATEGORY_MIGRATION: Record<string, AssetCategory> = {
  livret_epargne: "epargne",
  placement: "epargne",
  // `compte_courant` fusionne dans `liquidites` (décision : « c'est la même
  // chose »). Perd l'éligibilité aux versements — c'était l'anomalie du compte
  // courant ; les liquidités ne reçoivent pas de surplus.
  compte_courant: "liquidites",
};

/** Purge les clés d'actifs héritées (valuationRate) et migre les catégories. */
function normalizeAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: Asset & { valuationRate?: number }) => {
    const { valuationRate: _legacy, ...rest } = a;
    void _legacy;
    const category = CATEGORY_MIGRATION[rest.category as string] ?? rest.category;
    return { ...rest, category };
  }) as Asset[];
}

/**
 * Migration des catégories de passifs (taxonomie simplifiée) : `credit_conso` et
 * `credit_auto` fusionnent dans `credit` (crédits amortissables) ; `dette` (non
 * amortissable) retombe sur `autre`. Rien n'est perdu (montants/taux conservés).
 */
const LIABILITY_CATEGORY_MIGRATION: Record<string, LiabilityCategory> = {
  credit_conso: "credit",
  credit_auto: "credit",
  dette: "autre",
};

/** Migre les catégories de passifs héritées vers la taxonomie courante. */
function normalizeLiabilities(raw: unknown): Liability[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l: Liability) => {
    const category = LIABILITY_CATEGORY_MIGRATION[l.category as string] ?? l.category;
    return { ...l, category };
  }) as Liability[];
}

/**
 * Migration : les SCÉNARIOS n'existent plus. Un événement tagué devient un
 * événement DÉSACTIVÉ du plan (rien n'est perdu, et la trajectoire de Base est
 * inchangée : ces événements en étaient déjà exclus). La clé est purgée.
 */
function normalizeEvents(raw: unknown): PlannedEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((ev: PlannedEvent & { scenario?: string }) => {
    const { scenario, ...rest } = ev;
    return scenario ? { ...rest, disabled: true } : rest;
  }) as PlannedEvent[];
}

/**
 * Migre un objet JSON quelconque (localStorage OU fichier importé) vers la forme
 * courante d'`AppState`. Tolérant : un objet vide/invalide retombe sur EMPTY_STATE.
 * Exporté pour les tests (round-trip export/import).
 */
export function migrateState(input: unknown): AppState {
  if (!input || typeof input !== "object") return EMPTY_STATE;
  // JSON brut : accès tolérants aux clés (comme l'ancien JSON.parse en `any`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = input as any;

  // migration : état PLAT (v1 sans plans) -> les événements/jalons/hypothèses
  // de l'époque deviennent le « Plan principal ». Les finances courantes
  // (profil, actifs, passifs, flux) restent au niveau racine.
  if (!Array.isArray(parsed.plans)) {
    const plan: Plan = {
      ...DEFAULT_PLAN,
      milestones: parsed.milestones ?? [],
      events: normalizeEvents(parsed.events),
      projection: loadProjection(parsed.projection),
    };
    return {
      ...EMPTY_STATE,
      profile: parsed.profile ?? EMPTY_STATE.profile,
      assets: normalizeAssets(parsed.assets),
      liabilities: normalizeLiabilities(parsed.liabilities),
      incomes: parsed.incomes ?? [],
      expenses: parsed.expenses ?? [],
      plans: [plan],
      activePlanId: plan.id,
    };
  }

  // état à plans : compléter les clés manquantes de chaque plan et purger
  // la clé héritée `scenarios`
  const plans: Plan[] = (parsed.plans as (Plan & { scenarios?: unknown })[]).map((pl) => {
    const { scenarios: _legacy, ...plain } = pl;
    void _legacy;
    return {
      ...DEFAULT_PLAN,
      ...plain,
      events: normalizeEvents(plain.events),
      projection: loadProjection(plain.projection),
    };
  });
  if (plans.length === 0) plans.push(DEFAULT_PLAN);
  const activePlanId = plans.some((pl) => pl.id === parsed.activePlanId)
    ? parsed.activePlanId
    : plans[0].id;
  return { ...EMPTY_STATE, ...parsed, assets: normalizeAssets(parsed.assets), liabilities: normalizeLiabilities(parsed.liabilities), plans, activePlanId };
}

/** Charge l'état depuis le localStorage (via `migrateState`). Exporté pour les tests. */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    return migrateState(JSON.parse(raw));
  } catch {
    return EMPTY_STATE;
  }
}

/** Sérialise l'état courant pour l'export (fichier de sauvegarde JSON). */
export function serializeState(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

interface Store {
  state: AppState;
  /** Plan actif (garanti : retombe sur le 1er plan si l'id actif est invalide). */
  plan: Plan;
  update: (patch: Partial<AppState> | ((s: AppState) => AppState)) => void;
  /** Modifie le PLAN ACTIF uniquement (les finances courantes ne bougent pas). */
  updatePlan: (patch: Partial<Plan> | ((p: Plan) => Plan)) => void;
  /** Remplace tout l'état par un JSON importé (migré via `migrateState`). Lève si invalide. */
  importState: (json: string) => void;
  reset: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function activePlanOf(s: AppState): Plan {
  return s.plans.find((pl) => pl.id === s.activePlanId) ?? s.plans[0] ?? DEFAULT_PLAN;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / privacy mode — ignore */
    }
  }, [state]);

  const update = useCallback<Store["update"]>((patch) => {
    setState((prev) =>
      typeof patch === "function" ? patch(prev) : { ...prev, ...patch }
    );
  }, []);

  const updatePlan = useCallback<Store["updatePlan"]>((patch) => {
    setState((prev) => {
      const active = activePlanOf(prev);
      return {
        ...prev,
        plans: prev.plans.map((pl) =>
          pl.id === active.id ? (typeof patch === "function" ? patch(pl) : { ...pl, ...patch }) : pl
        ),
      };
    });
  }, []);

  const importState = useCallback<Store["importState"]>((json) => {
    // JSON.parse lève sur fichier corrompu ; migrateState absorbe les formes anciennes/partielles.
    setState(migrateState(JSON.parse(json)));
  }, []);

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  const value = useMemo(
    () => ({ state, plan: activePlanOf(state), update, updatePlan, importState, reset }),
    [state, update, updatePlan, importState, reset]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
