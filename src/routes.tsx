/* ===========================================================================
   Table de routes — source unique de la navigation (extraite de Sidebar).
   L'app reste 100 % locale ; le routeur ne fait que porter l'état de navigation
   dans l'URL (deep-link, back/forward, refresh sans perte de vue).
   =========================================================================== */

export type RouteId = "accueil" | "patrimoine" | "flux" | "projection";

export interface RouteDef {
  id: RouteId;
  path: string;
  label: string;
  soon?: boolean;
}

/** Routes de premier niveau affichées dans la nav de la sidebar (index = n° « 00 »…). */
export const ROUTES: RouteDef[] = [
  { id: "accueil", path: "/", label: "Accueil" },
  { id: "patrimoine", path: "/patrimoine", label: "Patrimoine" },
  { id: "flux", path: "/flux", label: "Flux" },
  { id: "projection", path: "/projection", label: "Projection" },
];

/** Route d'atterrissage par défaut : le Dashboard (00 — Accueil). */
export const DEFAULT_PATH = "/";

/* ----------------------- Sous-vues de la page Projection ----------------------
   La page Projection a 4 vues portées par un segment d'URL : `/projection/:vue`.
   `proj` est la vue par défaut → `/projection` (sans segment).                */

export type ProjectionViewId = "proj" | "events" | "cash" | "mc";

/** ViewId → slug d'URL (`proj` = base, donc slug vide). */
export const VIEW_SLUG: Record<ProjectionViewId, string> = {
  proj: "",
  events: "evenements",
  cash: "cash-flow",
  mc: "probabilite",
};

/** slug d'URL → ViewId (tolérant : slug inconnu = vue par défaut `proj`). */
export function viewFromSlug(slug: string | undefined): ProjectionViewId {
  if (!slug) return "proj";
  const found = (Object.keys(VIEW_SLUG) as ProjectionViewId[]).find((id) => VIEW_SLUG[id] === slug);
  return found ?? "proj";
}

/** Chemin complet d'une vue de projection (pour `navigate` / `<Link>`). */
export function projectionPath(view: ProjectionViewId): string {
  const slug = VIEW_SLUG[view];
  return slug ? `/projection/${slug}` : "/projection";
}
