import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EMPTY_STATE, type AppState } from "./types";
import { STORAGE_KEY, activePlanOf, createDebouncedWriter, loadState, migrateState, saveState } from "./persistence";
import { StoreContext, type Store } from "./useStore";

/**
 * Fournit le store à l'app. Persistance + migrations + validation dans `persistence.ts`,
 * contexte + hook dans `useStore.ts` (ce fichier n'exporte qu'un composant).
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  // un seul writer pour toute la vie du provider (init paresseuse, identité stable)
  const [writer] = useState(() => createDebouncedWriter(saveState));

  // sauvegarde DIFFÉRÉE : chaque changement reprogramme l'écriture (~300 ms) — sérialiser
  // tout l'état à chaque frappe était inutile…
  useEffect(() => {
    writer.schedule(state);
  }, [state, writer]);

  // …et l'écriture IMMÉDIATE est garantie quand la page se ferme ou passe en arrière-plan
  // (`pagehide`/`visibilitychange` couvrent le mobile et le bfcache, `beforeunload` le bureau).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") writer.flush();
    };
    window.addEventListener("beforeunload", writer.flush);
    window.addEventListener("pagehide", writer.flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", writer.flush);
      window.removeEventListener("pagehide", writer.flush);
      document.removeEventListener("visibilitychange", onVisibility);
      writer.flush();
    };
  }, [writer]);

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
    // JSON.parse lève sur fichier corrompu ; migrateState absorbe les formes anciennes/partielles
    // et LÈVE sur un contenu inexploitable (pas un objet, version future) : l'appelant affiche
    // le motif et les données courantes restent intactes.
    setState(migrateState(JSON.parse(json)));
  }, []);

  // Réinitialisation : stockage vidé IMMÉDIATEMENT et écriture en attente annulée — sinon
  // l'état abandonné se réécrirait au `pagehide` d'un rechargement (page de secours).
  const reset = useCallback(() => {
    writer.cancel();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setState(EMPTY_STATE);
  }, [writer]);

  const value = useMemo(
    () => ({ state, plan: activePlanOf(state), update, updatePlan, importState, reset }),
    [state, update, updatePlan, importState, reset]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
