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

  // 3. charges récurrentes de l'actif (taxe foncière, copro, assurance PNO…) — flux sortant
  charges?: MoneyFlow;

  // plancher de valeur : la dépréciation ne descend pas en dessous (ex. valeur résiduelle voiture)
  valueFloor?: number;

  // 4. versements — l'actif peut recevoir le SURPLUS d'épargne de la projection
  //    (comptes, livrets, placements uniquement — pas un bien immobilier ni un véhicule).
  //    Le plafond porte sur les DÉPÔTS cumulés (ex. 150 000 € pour un PEA), pas sur la
  //    valeur : la croissance peut faire dépasser le plafond, seuls les versements s'arrêtent.
  depositCap?: number; // plafond de versements cumulés
  depositsMade?: number; // versements déjà effectués avant aujourd'hui (plafond restant = cap − made)

  note?: string;
}

/** Catégories d'actifs pouvant recevoir des versements (surplus d'épargne). */
export const DEPOSIT_ELIGIBLE: AssetCategory[] = ["compte_courant", "livret_epargne", "placement"];

export function canReceiveDeposits(a: Pick<Asset, "category">): boolean {
  return DEPOSIT_ELIGIBLE.includes(a.category);
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
  insurance?: number; // assurance emprunteur mensuelle, EN PLUS de la mensualité (coût réel)
  note?: string;
}

/* ------------------------------- FLUX ----------------------------- */

export type IncomeCategory = "salaire" | "rente" | "aide" | "autre";
export type ExpenseCategory = "vie_courante" | "logement" | "impot" | "loisir" | "autre";

/**
 * Flux saisi manuellement (mensuel ou annuel).
 * Les revenus complémentaires sont saisis NETS AVANT IMPÔT : l'impôt se gère,
 * s'il y a lieu, comme une dépense distincte (catégorie "impot").
 */
/**
 * `startYear` / `endYear` (année calendaire, optionnels) bornent la période
 * d'activité du flux. Vides = actif dès aujourd'hui et sans fin.
 * Ex. salaire qui s'arrête à la retraite (endYear), pension qui démarre (startYear).
 */
export interface IncomeItem {
  id: string;
  label: string;
  category: IncomeCategory;
  amount: number;
  period: Period;
  startYear?: number;
  endYear?: number;
  growth?: number; // revalorisation %/an propre au flux (sinon suit l'inflation globale)
}

export interface ExpenseItem {
  id: string;
  label: string;
  category: ExpenseCategory;
  amount: number;
  period: Period;
  startYear?: number;
  endYear?: number;
  growth?: number; // revalorisation %/an propre au flux (sinon suit l'inflation globale)
}

/* --------------------------- PROJECTION --------------------------- */

/** Hypothèses de la page Projection (persistées). */
export interface ProjectionParams {
  horizon: number; // nombre d'années projetées
  savingsYield: number; // %/an : rendement de l'épargne réinvestie (0 = dort)
  inflation: number; // %/an
  indexExpenses: boolean; // les dépenses suivent l'inflation (défaut si pas de taux propre)
  indexIncomes: boolean; // les revenus complémentaires suivent l'inflation (idem)
  realTerms: boolean; // affichage en euros constants (pouvoir d'achat)
  // Cascade d'affectation du surplus mensuel : le 1er actif reçoit jusqu'à son
  // plafond de versements, l'excédent passe au suivant, et ce qui reste va à
  // l'épargne (taux savingsYield). Vide/absent = tout à l'épargne.
  surplusTargets?: string[];
  fiTarget?: number; // patrimoine net à atteindre pour l'indépendance financière (défini par l'utilisateur, pas déduit par le moteur)
}

export const DEFAULT_PROJECTION: ProjectionParams = {
  horizon: 30,
  savingsYield: 0,
  inflation: 2,
  indexExpenses: true,
  indexIncomes: true,
  realTerms: false,
};

/* ------------------------------ STATE ----------------------------- */

export interface AppState {
  profile: Profile;
  assets: Asset[];
  liabilities: Liability[];
  incomes: IncomeItem[]; // revenus complémentaires (salaire, aide…)
  expenses: ExpenseItem[]; // dépenses & impôts
  projection: ProjectionParams;
}

export const EMPTY_STATE: AppState = {
  profile: { firstName: "", birthDate: "" },
  assets: [],
  liabilities: [],
  incomes: [],
  expenses: [],
  projection: DEFAULT_PROJECTION,
};
