/* ===========================================================================
   Modèle de données — persisté tel quel en localStorage.
   =========================================================================== */

export type Period = "monthly" | "yearly";

/** Une valeur monétaire saisie soit en mensuel soit en annuel. */
export interface MoneyFlow {
  amount: number;
  period: Period;
}

/* ----------------------------- PROFIL ----------------------------- */

export interface Profile {
  firstName: string;
  birthDate: string; // ISO "YYYY-MM-DD"
}

/* --------------------------- PATRIMOINE --------------------------- */

export type AssetCategory =
  | "immobilier"
  | "compte_courant"
  | "livret_epargne"
  | "placement"
  | "vehicule"
  | "autre";

/**
 * Le gain d'un actif se décompose en DEUX mécanismes distincts et indépendants.
 * Cette distinction est cruciale pour la projection (intérêts composés) :
 *
 *  1. CROISSANCE DE LA VALEUR — `growthRate` (%/an), CAPITALISÉE.
 *     Le gain reste DANS l'actif : sa valeur augmente, donc il SE COMPOSE
 *     année après année (la croissance N+1 s'applique sur la valeur déjà grossie).
 *       • PEA / placement / assurance-vie : +X%   (plus-values réinvesties)
 *       • livret dont les intérêts restent : +X%
 *       • immobilier qui s'apprécie        : +2%
 *       • véhicule qui se déprécie          : -15%  (négatif)
 *       • compte courant stable             :  0
 *     N'alimente PAS les flux entrants — le gain n'est pas perçu, il s'accumule.
 *
 *  2. REVENU DISTRIBUÉ — versé en FLUX entrant, NE se compose PAS.
 *     Le gain SORT de l'actif (perçu en cash), la valeur ne bouge pas de ce fait.
 *     C'est un flux à plat (constant), pas un capital qui grossit.
 *       incomeMode "rate"   : % de la valeur versé chaque année (rendement locatif, dividende)
 *       incomeMode "amount" : montant fixe distribué (un loyer saisi à la main)
 *       incomeMode "none"   : rien n'est distribué (PEA, voiture, résidence principale)
 *
 *  Un même actif peut cumuler les deux : un appartement loué = growthRate +2%
 *  (la pierre s'apprécie et se compose) ET un loyer distribué (flux entrant à plat).
 */
export interface Asset {
  id: string;
  label: string;
  category: AssetCategory;
  value: number; // valeur actuelle -> patrimoine brut

  // 1. croissance capitalisée (se compose) — + apprécie / - déprécie / 0 stable
  growthRate: number; // %/an

  // 2. revenu distribué (flux entrant, ne se compose pas)
  incomeMode: "none" | "rate" | "amount";
  incomeRate?: number; // % de la valeur versé/an, si incomeMode === "rate"
  income?: MoneyFlow; // montant fixe distribué, si incomeMode === "amount"

  note?: string;
}

export type LiabilityCategory =
  | "emprunt_immo"
  | "credit_conso"
  | "credit_auto"
  | "dette"
  | "autre";

/**
 * Un passif réduit le patrimoine net (capital restant dû).
 * Pour un emprunt amortissable, la mensualité se calcule à partir du capital
 * restant dû, du taux et de la durée restante — et la durée indique quand le
 * prêt s'éteint (essentiel pour la PROJECTION).
 * `monthlyPayment` (la mensualité) alimentera les FLUX sortants.
 */
export interface Liability {
  id: string;
  label: string;
  category: LiabilityCategory;
  outstanding: number; // capital restant dû -> baisse le patrimoine net
  rate?: number; // taux d'intérêt annuel (%)
  termMonths?: number; // durée restante en mois -> date de fin du prêt
  monthlyPayment?: number; // mensualité (calculée auto, ou saisie si autoPayment=false)
  autoPayment?: boolean; // true = mensualité calculée depuis outstanding + rate + termMonths
  note?: string;
}

/* ------------------------------ STATE ----------------------------- */

export interface AppState {
  profile: Profile;
  assets: Asset[];
  liabilities: Liability[];
}

export const EMPTY_STATE: AppState = {
  profile: { firstName: "", birthDate: "" },
  assets: [],
  liabilities: [],
};
