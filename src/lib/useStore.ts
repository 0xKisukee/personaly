/**
 * Contexte du store + hook `useStore`. Séparé de `store.tsx` (qui ne contient que le
 * `StoreProvider`) pour que ce dernier n'exporte qu'un composant (Fast Refresh).
 */
import { createContext, useContext } from "react";
import type { AppState, Plan } from "./types";

export interface Store {
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

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
