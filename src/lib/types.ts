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

/* ----------------------------- JALONS ----------------------------- */

/**
 * Jalon de vie (Retraite, Départ des enfants…) : une année NOMMÉE.
 * Les flux et événements peuvent s'ANCRER dessus (MilestoneRef) au lieu d'une
 * année en dur : déplacer le jalon recale toute la projection d'un coup.
 */
export interface Milestone {
  id: string;
  label: string;
  year: number;
}

/** Ancrage relatif : « au jalon X », éventuellement décalé de ± n années. */
export interface MilestoneRef {
  milestoneId: string;
  offset?: number; // années après (+) / avant (−) le jalon
}

/** Année d'un ancrage, ou null si le jalon a été supprimé (référence orpheline). */
export function refYear(ref: MilestoneRef | undefined, milestones: Milestone[]): number | null {
  if (!ref) return null;
  const m = milestones.find((x) => x.id === ref.milestoneId);
  return m ? m.year + (ref.offset ?? 0) : null;
}

/**
 * Année effective d'un événement : l'ancrage jalon PRIME s'il se résout ;
 * sinon on retombe sur `year`, instantané pris au dernier enregistrement
 * (rien ne casse : on retombe sur l'instantané et on signale).
 */
export function eventYear(
  ev: { year: number; when?: MilestoneRef },
  milestones: Milestone[]
): number {
  return refYear(ev.when, milestones) ?? ev.year;
}

/** Bornes effectives d'un flux : ancrages jalon prioritaires, sinon années en dur. */
export function flowBounds(
  f: { startYear?: number; endYear?: number; startRef?: MilestoneRef; endRef?: MilestoneRef },
  milestones: Milestone[]
): { start?: number; end?: number } {
  return {
    start: refYear(f.startRef, milestones) ?? f.startYear,
    end: refYear(f.endRef, milestones) ?? f.endYear,
  };
}

/* --------------------------- PATRIMOINE --------------------------- */

/**
 * Catégories d'actifs. La FINESSE produit (Livret A vs PEA vs assurance-vie…) est
 * portée par les PRESETS du registre `lib/assets.ts`, pas par des catégories dédiées :
 *  - `epargne` fusionne livrets ET placements (décision : « c'est la même chose »).
 *  - l'immobilier est un seul type ; le flag `rented` distingue loué / non loué.
 */
export type AssetCategory =
  | "immobilier"
  | "compte_courant"
  | "liquidites"
  | "epargne"
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
  // volatilité annuelle (écart-type, %/an) — utilisée UNIQUEMENT par le Monte
  // Carlo : la projection déterministe garde growthRate sec. 0/absent = certain.
  volatility?: number;

  // 2. revenu distribué (flux entrant, ne se compose pas)
  incomeMode: "none" | "rate" | "amount";
  incomeRate?: number; // % de la valeur versé/an, si incomeMode === "rate"
  income?: MoneyFlow; // montant fixe distribué, si incomeMode === "amount"

  // bien immobilier LOUÉ : révèle le revenu distribué (loyer) sans changer de catégorie.
  // Bascule loué/non loué instantanée. Ignoré hors `immobilier`.
  rented?: boolean;

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
export const DEPOSIT_ELIGIBLE: AssetCategory[] = ["compte_courant", "epargne"];

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
/**
 * `startRef` / `endRef` : ancrage sur un JALON (prioritaire). `startYear` /
 * `endYear` restent l'instantané de secours si le jalon est supprimé.
 */
export interface IncomeItem {
  id: string;
  label: string;
  category: IncomeCategory;
  amount: number;
  period: Period;
  startYear?: number;
  endYear?: number;
  startRef?: MilestoneRef;
  endRef?: MilestoneRef;
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
  startRef?: MilestoneRef;
  endRef?: MilestoneRef;
  growth?: number; // revalorisation %/an propre au flux (sinon suit l'inflation globale)
}

/* --------------------------- ÉVÉNEMENTS --------------------------- */

/**
 * Événements datés de la projection — ATOMIQUES et COMPOSABLES : comme sur la
 * page Patrimoine, les crédits sont indépendants des biens. Un achat financé =
 * deux événements la même année (« Nouvel emprunt » + « Achat »).
 *
 * Datés à l'ANNÉE (appliqués au 1er mois de l'année cible, avant les flux).
 * Ordre d'application dans une même année : le cash ENTRE d'abord
 * (ventes → rentrées/sorties → nouveaux emprunts), puis SORT
 * (remboursements → achats).
 *
 * Comptabilité : achat/vente/emprunt/remboursement sont des TRANSFERTS neutres
 * pour le patrimoine net, SAUF les frais (sortie sèche) et l'écart entre prix
 * de vente fixé et valeur projetée (plus/moins-value réalisée). Ces termes sont
 * exposés dans YearPoint (eventCash / eventFees / eventGain) pour préserver
 * l'identité « patrimoine début + enrichissement = début suivant ».
 */
interface EventBase {
  id: string;
  label: string;
  year: number; // instantané de secours si `when` est orphelin (jalon supprimé)
  when?: MilestoneRef; // ancrage jalon — PRIME sur `year` quand il se résout
  disabled?: boolean; // décoché = ignoré par la projection (l'événement reste saisi)
  note?: string;
}

/**
 * Flux RÉCURRENT (revenu ou dépense) propre au plan, borné dans le temps — comme
 * un flux de la page Flux, mais rattaché à une simulation. `year`/`when` (hérités
 * d'EventBase) = DÉBUT du flux ; `endYear`/`endRef` = fin optionnelle (sinon court
 * jusqu'à la fin de l'horizon). Ex. « conjoint à charge : −800 €/mois à partir du
 * Mariage (2037) ». `growth` = revalorisation propre (sinon suit l'inflation selon
 * indexIncomes/indexExpenses). Contrairement aux autres événements (ponctuels,
 * appliqués une année), celui-ci alimente le flux mensuel comme un revenu/dépense.
 */
export interface FlowEvent extends EventBase {
  kind: "flow";
  direction: "in" | "out";
  amount: number;
  period: Period;
  endYear?: number;
  endRef?: MilestoneRef;
  growth?: number;
}

/** Achat d'actif, payé cash (price + fees sortent de l'épargne — un emprunt de la même année peut la re-remplir). */
export interface BuyAssetEvent extends EventBase {
  kind: "buy";
  asset: Asset; // l'actif COMPLET (croissance, revenu distribué, charges…), créé à la date
  price: number; // valeur d'entrée de l'actif
  fees?: number; // frais (notaire, dossier) — sortie sèche, ne crée pas de valeur
}

/** Vente d'un actif (existant ou acheté par un événement "buy") : produit → épargne. */
export interface SellAssetEvent extends EventBase {
  kind: "sell";
  assetId: string;
  price?: number; // prix fixé ; absent = valeur PROJETÉE de l'actif à cette date
  feesPct?: number; // frais de vente (agence…) en % du prix
}

/** Nouvel emprunt amortissable : le capital arrive en épargne, le passif s'amortit dès le mois suivant. */
export interface NewLoanEvent extends EventBase {
  kind: "loan";
  amount: number; // capital emprunté
  rate: number; // taux annuel (%)
  termMonths: number; // durée
  insurance?: number; // assurance mensuelle, en plus de la mensualité
}

/** Rentrée (+) ou sortie (−) ponctuelle : héritage, prime, travaux, mariage… */
export interface CashEvent extends EventBase {
  kind: "cash";
  amount: number;
}

/** Remboursement anticipé d'un emprunt (partiel ou total), prélevé sur l'épargne. */
export interface RepayLoanEvent extends EventBase {
  kind: "repay";
  loanId: string; // id de passif existant ou d'événement "loan"
  amount?: number; // partiel ; absent = solde total à la date
}

/**
 * Versement ponctuel : de l'épargne vers un actif ÉLIGIBLE (canReceiveDeposits).
 * Transfert neutre. Respecte le plafond de versements de l'actif — la capacité
 * est PARTAGÉE avec la cascade du surplus (un versement la consomme d'autant).
 */
export interface DepositEvent extends EventBase {
  kind: "deposit";
  assetId: string; // actif existant ou créé par un événement "buy"
  amount: number;
}

export type PlannedEvent = FlowEvent | BuyAssetEvent | SellAssetEvent | NewLoanEvent | CashEvent | RepayLoanEvent | DepositEvent;

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
  // Cascade de RETRAIT (miroir du surplus) : quand l'épargne devient négative,
  // on puise dans ces actifs dans l'ordre (transfert neutre actif → épargne)
  // avant de laisser le déficit en épargne. Vide/absent = comportement actuel
  // (les déficits restent portés par l'épargne, qui peut passer en négatif).
  withdrawalTargets?: string[];
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

/* ------------------------------- PLANS ----------------------------- */

/**
 * Un PLAN est une simulation virtuelle posée SUR les finances courantes
 * (jamais modifiées par lui) : ses jalons, ses événements et ses hypothèses.
 * Créer un plan = dupliquer le plan actif (jalons copiés avec les MÊMES ids :
 * les ancrages des flux se résolvent dans chaque plan). Pour un « et si »
 * ponctuel, désactive un événement ou duplique le plan.
 */
export interface Plan {
  id: string;
  name: string;
  milestones: Milestone[];
  events: PlannedEvent[];
  projection: ProjectionParams;
}

export const DEFAULT_PLAN: Plan = {
  id: "plan-1",
  name: "Plan principal",
  milestones: [],
  events: [],
  projection: DEFAULT_PROJECTION,
};

/* ------------------------------ STATE ----------------------------- */

/**
 * État de l'app : les FINANCES COURANTES (profil, actifs, passifs, flux — la
 * réalité d'aujourd'hui, source de vérité unique) + des PLANS de simulation.
 */
export interface AppState {
  profile: Profile;
  assets: Asset[];
  liabilities: Liability[];
  incomes: IncomeItem[]; // revenus complémentaires (salaire, aide…)
  expenses: ExpenseItem[]; // dépenses & impôts
  plans: Plan[];
  activePlanId: string;
}

export const EMPTY_STATE: AppState = {
  profile: { firstName: "", birthDate: "" },
  assets: [],
  liabilities: [],
  incomes: [],
  expenses: [],
  plans: [DEFAULT_PLAN],
  activePlanId: DEFAULT_PLAN.id,
};

/* --------------------------- SIMULATION --------------------------- */

/**
 * Entrée du moteur de projection : finances courantes + couche du plan
 * (jalons, événements). Le moteur ne connaît pas les plans — il reçoit un
 * instantané composé.
 */
export interface SimState {
  profile: Profile;
  milestones: Milestone[];
  assets: Asset[];
  liabilities: Liability[];
  incomes: IncomeItem[];
  expenses: ExpenseItem[];
  events: PlannedEvent[];
}

/** Compose l'entrée du moteur pour un plan. */
export function simInput(s: AppState, plan: Plan): SimState {
  return {
    profile: s.profile,
    assets: s.assets,
    liabilities: s.liabilities,
    incomes: s.incomes,
    expenses: s.expenses,
    milestones: plan.milestones,
    events: plan.events,
  };
}
