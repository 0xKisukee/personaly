import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_PLAN, DEFAULT_PROJECTION, EMPTY_STATE, type AppState, type Asset, type Plan, type PlannedEvent, type ProjectionParams } from "./types";

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

/** Purge les clés d'actifs héritées (valuationRate, renommée growthRate). */
function normalizeAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: Asset & { valuationRate?: number }) => {
    const { valuationRate: _legacy, ...rest } = a;
    void _legacy;
    return rest;
  }) as Asset[];
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

/** Exporté pour les tests. */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);

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
        liabilities: parsed.liabilities ?? [],
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
    return { ...EMPTY_STATE, ...parsed, assets: normalizeAssets(parsed.assets), plans, activePlanId };
  } catch {
    return EMPTY_STATE;
  }
}

interface Store {
  state: AppState;
  /** Plan actif (garanti : retombe sur le 1er plan si l'id actif est invalide). */
  plan: Plan;
  update: (patch: Partial<AppState> | ((s: AppState) => AppState)) => void;
  /** Modifie le PLAN ACTIF uniquement (les finances courantes ne bougent pas). */
  updatePlan: (patch: Partial<Plan> | ((p: Plan) => Plan)) => void;
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

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  const value = useMemo(
    () => ({ state, plan: activePlanOf(state), update, updatePlan, reset }),
    [state, update, updatePlan, reset]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
