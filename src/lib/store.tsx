import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EMPTY_STATE, type AppState } from "./types";
import { activePlanOf, loadState, migrateState, saveState } from "./persistence";
import { StoreContext, type Store } from "./useStore";

/**
 * Fournit le store à l'app. Persistance + migrations dans `persistence.ts`,
 * contexte + hook dans `useStore.ts` (ce fichier n'exporte qu'un composant).
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);

  useEffect(() => saveState(state), [state]);

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
