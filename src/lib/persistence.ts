/**
 * Persistance & migrations de l'état (PURE, sans React — testé dans `store.test.ts`).
 * `migrateState` est la porte d'entrée unique : localStorage ET import JSON y passent
 * (version → migrations → validation `sanitizeState` → estampillage `schemaVersion`),
 * tout se réécrit propre à la prochaine sauvegarde. Le contexte React vit dans
 * `useStore.ts`, le provider (écriture différée) dans `store.tsx`.
 */
import {
  DEFAULT_PLAN,
  DEFAULT_PROJECTION,
  DEFAULT_SETTINGS,
  EMPTY_STATE,
  EPARGNE_ID,
  SCHEMA_VERSION,
  type AppSettings,
  type AppState,
  type Asset,
  type AssetCategory,
  type ExpenseCategory,
  type ExpenseItem,
  type IncomeCategory,
  type IncomeItem,
  type IncomeNature,
  type Liability,
  type LiabilityCategory,
  type Milestone,
  type MilestoneRef,
  type MoneyFlow,
  type Period,
  type Plan,
  type PlannedEvent,
  type Profile,
  type ProjectionParams,
  type Recurrence,
  type SurplusFlow,
} from "./types";
import { uid } from "./format";

export const STORAGE_KEY = "personaly:v1";
/** Copie de SECOURS du blob brut quand le stockage est illisible (JSON corrompu, version
 *  future…) : on repart à vide, mais la prochaine écriture n'écrase pas la seule copie. */
export const RESCUE_KEY = "personaly:v1:rescue";

/* ===========================================================================
   MIGRATIONS (tolérantes, idempotentes) — forme ancienne → forme courante
   =========================================================================== */

/** Complète une projection persistée + purge les clés héritées. */
function loadProjection(raw: object | undefined): ProjectionParams {
  const projection = { ...DEFAULT_PROJECTION, ...(raw ?? {}) };
  // migration À USAGE UNIQUE : surplusTargetId (cible unique) -> surplusTargets
  // (cascade). La clé héritée est PURGÉE de l'état : sans ça, elle restait dans
  // le storage et ressuscitait la cascade à chaque chargement même après que
  // l'utilisateur l'avait vidée (« affectation zombie »).
  const legacyId = (raw as { surplusTargetId?: unknown } | undefined)?.surplusTargetId;
  if (!projection.surplusTargets && typeof legacyId === "string" && legacyId) {
    projection.surplusTargets = [legacyId] as unknown as SurplusFlow[];
  }
  delete (projection as Record<string, unknown>).surplusTargetId;
  // surplusTargets : ancien `string[]` d'ids (mode « max » implicite) → SurplusFlow[].
  // Les entrées déjà au format flow ({assetId,…}) sont conservées telles quelles.
  if (Array.isArray(projection.surplusTargets)) {
    projection.surplusTargets = (projection.surplusTargets as unknown[])
      .map((t) => (typeof t === "string" ? { assetId: t, mode: "max" } : t))
      .filter((t): t is SurplusFlow => !!t && typeof (t as SurplusFlow).assetId === "string") as SurplusFlow[];
  }
  delete (projection as Record<string, unknown>).scenario; // héritée des scénarios (supprimés)
  delete (projection as Record<string, unknown>).goalAmount; // ancêtres de l'ancien seuil de patrimoine
  delete (projection as Record<string, unknown>).goalYear;
  delete (projection as Record<string, unknown>).fiTarget; // ancien seuil de patrimoine → remplacé par l'indépendance calculée (couverture des dépenses)
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
  return (raw.filter(isObj) as unknown as (Asset & { valuationRate?: number })[]).map((a) => {
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
  return (raw.filter(isObj) as unknown as Liability[]).map((l) => {
    const category = LIABILITY_CATEGORY_MIGRATION[l.category as string] ?? l.category;
    return { ...l, category };
  }) as Liability[];
}

/**
 * Migrations d'événements (idempotentes) :
 *  - SCÉNARIOS retirés : un événement tagué devient DÉSACTIVÉ (la clé est purgée ;
 *    la trajectoire de Base est inchangée, ces événements en étaient déjà exclus).
 *  - VERSEMENT (`deposit`) retiré : devient un TRANSFERT depuis l'Épargne
 *    (`fromId = EPARGNE_ID`, `toId` = l'actif destinataire d'origine). Sémantique
 *    identique (Épargne → actif éligible), et `transfer` en est un sur-ensemble.
 */
function normalizeEvents(raw: unknown): PlannedEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObj).map((ev: Record<string, unknown>) => {
    const { scenario, ...rest } = ev;
    const base = scenario ? { ...rest, disabled: true } : rest;
    if (base.kind === "deposit") {
      const { assetId, ...b } = base;
      return { ...b, kind: "transfer", fromId: EPARGNE_ID, toId: assetId };
    }
    return base;
  }) as unknown as PlannedEvent[];
}

/**
 * Jalons GLOBAUX : dans le format courant ils vivent à la RACINE. Dans l'ancien
 * format ils vivaient dans chaque plan → on les HISSE en global (fusion dédupée par
 * id) et on vide les jalons propres aux plans (ils redeviennent des suppléments,
 * vides au départ). Idempotent si la racine porte déjà `milestones`.
 */
function hoistMilestones(rootMilestones: unknown, plans: Plan[]): { milestones: Milestone[]; plans: Plan[] } {
  if (Array.isArray(rootMilestones)) return { milestones: rootMilestones as Milestone[], plans };
  const seen = new Set<string>();
  const global: Milestone[] = [];
  for (const pl of plans) for (const m of arr(pl.milestones) as Milestone[]) if (isObj(m) && !seen.has(m.id)) { seen.add(m.id); global.push(m); }
  return { milestones: global, plans: plans.map((pl) => ({ ...pl, milestones: [] })) };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON brut : accès tolérants aux clés */

/** v1 PLAT (sans `plans[]`) : événements/jalons/hypothèses de l'époque → « Plan principal ».
 *  Les finances courantes (profil, actifs, passifs, flux) restent au niveau racine. */
function migrateFlatState(parsed: any): AppState {
  const plan: Plan = {
    ...DEFAULT_PLAN,
    milestones: [], // les jalons de l'ancien état plat deviennent GLOBAUX (racine)
    events: normalizeEvents(parsed.events),
    projection: loadProjection(isObj(parsed.projection) ? parsed.projection : undefined),
  };
  return {
    ...EMPTY_STATE,
    profile: parsed.profile ?? EMPTY_STATE.profile,
    settings: {
      ...DEFAULT_SETTINGS,
      horizon: plan.projection.horizon ?? DEFAULT_SETTINGS.horizon,
      indexIncomes: plan.projection.indexIncomes ?? DEFAULT_SETTINGS.indexIncomes,
      indexExpenses: plan.projection.indexExpenses ?? DEFAULT_SETTINGS.indexExpenses,
      realTerms: plan.projection.realTerms ?? DEFAULT_SETTINGS.realTerms,
    },
    milestones: Array.isArray(parsed.milestones) ? parsed.milestones : [],
    assets: normalizeAssets(parsed.assets),
    liabilities: normalizeLiabilities(parsed.liabilities),
    incomes: parsed.incomes ?? [],
    expenses: parsed.expenses ?? [],
    plans: [plan],
    activePlanId: plan.id,
  };
}

/** État À PLANS : complète les clés manquantes de chaque plan, purge `scenarios`,
 *  hisse réglages globaux et jalons, corrige un `activePlanId` invalide. */
function migratePlansState(parsed: any): AppState {
  const plans: Plan[] = (parsed.plans as unknown[]).filter(isObj).map((pl) => {
    const { scenarios: _legacy, ...plain } = pl as unknown as Plan & { scenarios?: unknown };
    void _legacy;
    return {
      ...DEFAULT_PLAN,
      ...plain,
      events: normalizeEvents(plain.events),
      projection: loadProjection(isObj(plain.projection) ? plain.projection : undefined),
    };
  });
  if (plans.length === 0) plans.push(DEFAULT_PLAN);
  const activePlanId = plans.some((pl) => pl.id === parsed.activePlanId)
    ? parsed.activePlanId
    : plans[0].id;
  // horizon devient GLOBAL : on le hisse depuis le plan actif si l'état d'avant
  // ne le portait pas encore dans settings (continuité pour l'utilisateur).
  const activePlan = plans.find((pl) => pl.id === activePlanId) ?? plans[0];
  const rawSettings = isObj(parsed.settings) ? parsed.settings : {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    horizon: rawSettings.horizon ?? activePlan.projection.horizon ?? DEFAULT_SETTINGS.horizon,
    indexIncomes: rawSettings.indexIncomes ?? activePlan.projection.indexIncomes ?? DEFAULT_SETTINGS.indexIncomes,
    indexExpenses: rawSettings.indexExpenses ?? activePlan.projection.indexExpenses ?? DEFAULT_SETTINGS.indexExpenses,
    realTerms: rawSettings.realTerms ?? activePlan.projection.realTerms ?? DEFAULT_SETTINGS.realTerms,
  } as AppSettings;
  const { milestones, plans: finalPlans } = hoistMilestones(parsed.milestones, plans);
  return {
    ...EMPTY_STATE,
    ...parsed,
    settings,
    milestones,
    assets: normalizeAssets(parsed.assets),
    liabilities: normalizeLiabilities(parsed.liabilities),
    plans: finalPlans,
    activePlanId,
  };
}

/**
 * Migre un objet JSON quelconque (localStorage OU fichier importé) vers la forme
 * courante d'`AppState`, puis le VALIDE (`sanitizeState`) et l'estampille
 * `schemaVersion`. Tolérant sur le CONTENU (clés manquantes, types faux, formes
 * anciennes) ; strict sur le CONTENANT : lève une erreur lisible si l'entrée n'est pas
 * un objet ou vient d'une version plus récente de l'app (sinon on tronquerait en silence).
 * Exporté pour les tests (round-trip export/import) et la validation à l'import (Sidebar).
 */
export function migrateState(input: unknown): AppState {
  if (!isObj(input)) {
    throw new Error("Fichier invalide : le contenu n'est pas un objet JSON personaly.");
  }
  const parsed = input as any;
  const version = parsed.schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    throw new Error(
      `Ce fichier vient d'une version plus récente de personaly (schéma ${version}, ` +
        `cette version lit jusqu'au schéma ${SCHEMA_VERSION}). Mets l'application à jour avant de l'importer.`
    );
  }
  // v1 (sans version) et v2 passent par le MÊME chemin : les migrations sont idempotentes.
  // Une future v3 ajouterait ici `if ((version ?? 1) < 3) migrateV2toV3(...)`.
  const migrated = Array.isArray(parsed.plans) ? migratePlansState(parsed) : migrateFlatState(parsed);
  return sanitizeState(migrated);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/* ===========================================================================
   VALIDATION — force les types champ par champ, sans dépendance.
   Principe : on GARDE les clés inconnues (tolérance, comme les migrations), on
   FORCE les clés connues (nombre fini sinon 0/défaut, tableau sinon [], id string
   non vide sinon régénéré), on PURGE ce qui est inexploitable (entrée non-objet,
   événement sans type connu ou sans cible, jalon sans année).
   =========================================================================== */

type Dict = Record<string, unknown>;

function isObj(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function nonNull<T>(v: T | null): v is T {
  return v !== null;
}
/** Nombre fini (une chaîne numérique « 50000 » est acceptée), sinon `fallback` (undefined = clé retirée). */
function num(v: unknown, fallback: number): number;
function num(v: unknown): number | undefined;
function num(v: unknown, fallback?: number): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
function isId(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}
/** Id : string non vide, sinon régénéré (on préfère garder la donnée que la jeter). */
function id(v: unknown): string {
  return isId(v) ? v : uid();
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;
}
function optOneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(v as string) ? (v as T) : undefined;
}
function optRef(v: unknown): MilestoneRef | undefined {
  if (!isObj(v) || !isId(v.milestoneId)) return undefined;
  const offset = num(v.offset);
  return offset === undefined ? { milestoneId: v.milestoneId } : { milestoneId: v.milestoneId, offset };
}
function optFlow(v: unknown): MoneyFlow | undefined {
  if (!isObj(v)) return undefined;
  return { amount: num(v.amount, 0), period: oneOf(v.period, PERIODS, "monthly") };
}
/** Réécrit `patch` par-dessus `raw` ; une valeur `undefined` RETIRE la clé (optionnel illisible). */
function fix<T>(raw: Dict, patch: Dict): T {
  const out: Dict = { ...raw };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

// Listes EXHAUSTIVES dérivées des unions du modèle : un `Record<Union, true>` casse la
// compilation si une valeur manque ou est en trop → impossible de « sanitizer » une
// catégorie légitime vers `autre` par oubli.
const keysOf = <K extends string>(rec: Record<K, true>): readonly K[] => Object.keys(rec) as K[];
const PERIODS = keysOf<Period>({ monthly: true, yearly: true });
const ASSET_CATEGORIES = keysOf<AssetCategory>({ immobilier: true, liquidites: true, epargne: true, vehicule: true, autre: true });
const INCOME_MODES = keysOf<Asset["incomeMode"]>({ none: true, rate: true, amount: true });
const LIABILITY_CATEGORIES = keysOf<LiabilityCategory>({ emprunt_immo: true, credit: true, autre: true });
const INCOME_CATEGORIES = keysOf<IncomeCategory>({ salaire: true, rente: true, aide: true, autre: true });
const INCOME_NATURES = keysOf<IncomeNature>({ actif: true, passif: true });
const EXPENSE_CATEGORIES = keysOf<ExpenseCategory>({ vie_courante: true, logement: true, impot: true, loisir: true, autre: true });
const EVENT_KINDS = keysOf<PlannedEvent["kind"]>({ flow: true, buy: true, sell: true, loan: true, cash: true, repay: true, transfer: true });
const SURPLUS_MODES = keysOf<SurplusFlow["mode"]>({ max: true, percent: true, amount: true });

function sanitizeProfile(raw: unknown): Profile {
  if (!isObj(raw)) return EMPTY_STATE.profile;
  return fix<Profile>(raw, { firstName: str(raw.firstName), birthDate: str(raw.birthDate) });
}

function sanitizeSettings(raw: unknown): AppSettings {
  const r = isObj(raw) ? raw : {};
  return fix<AppSettings>(r, {
    horizon: num(r.horizon, DEFAULT_SETTINGS.horizon),
    indexIncomes: bool(r.indexIncomes, DEFAULT_SETTINGS.indexIncomes),
    indexExpenses: bool(r.indexExpenses, DEFAULT_SETTINGS.indexExpenses),
    realTerms: bool(r.realTerms, DEFAULT_SETTINGS.realTerms),
  });
}

/** Un jalon sans année n'ancre rien : purgé (les ancrages orphelins retombent sur leur année de secours). */
function sanitizeMilestone(raw: unknown): Milestone | null {
  if (!isObj(raw)) return null;
  const year = num(raw.year);
  if (year === undefined) return null;
  return fix<Milestone>(raw, { id: id(raw.id), label: str(raw.label), year });
}

function sanitizeAsset(raw: unknown): Asset | null {
  if (!isObj(raw)) return null;
  return fix<Asset>(raw, {
    id: id(raw.id),
    label: str(raw.label),
    category: oneOf(raw.category, ASSET_CATEGORIES, "autre"),
    value: num(raw.value, 0),
    growthRate: num(raw.growthRate, 0),
    volatility: num(raw.volatility),
    incomeMode: oneOf(raw.incomeMode, INCOME_MODES, "none"),
    incomeRate: num(raw.incomeRate),
    income: optFlow(raw.income),
    rented: optBool(raw.rented),
    charges: optFlow(raw.charges),
    valueFloor: num(raw.valueFloor),
    depositCap: num(raw.depositCap),
    depositsMade: num(raw.depositsMade),
    incomeLiquid: optBool(raw.incomeLiquid),
    growthLiquid: optBool(raw.growthLiquid),
    liquidYear: num(raw.liquidYear),
    liquidRef: optRef(raw.liquidRef),
    note: optStr(raw.note),
  });
}

function sanitizeLiability(raw: unknown): Liability | null {
  if (!isObj(raw)) return null;
  return fix<Liability>(raw, {
    id: id(raw.id),
    label: str(raw.label),
    category: oneOf(raw.category, LIABILITY_CATEGORIES, "autre"),
    outstanding: num(raw.outstanding, 0),
    rate: num(raw.rate),
    termMonths: num(raw.termMonths),
    monthlyPayment: num(raw.monthlyPayment),
    autoPayment: optBool(raw.autoPayment),
    insurance: num(raw.insurance),
    note: optStr(raw.note),
  });
}

/** Champs communs aux flux de la page Flux (revenus et dépenses). */
function flowFields(raw: Dict): Dict {
  return {
    id: id(raw.id),
    label: str(raw.label),
    amount: num(raw.amount, 0),
    period: oneOf(raw.period, PERIODS, "monthly"),
    startYear: num(raw.startYear),
    endYear: num(raw.endYear),
    startRef: optRef(raw.startRef),
    endRef: optRef(raw.endRef),
    growth: num(raw.growth),
  };
}

function sanitizeIncome(raw: unknown): IncomeItem | null {
  if (!isObj(raw)) return null;
  return fix<IncomeItem>(raw, {
    ...flowFields(raw),
    category: oneOf(raw.category, INCOME_CATEGORIES, "autre"),
    nature: optOneOf(raw.nature, INCOME_NATURES),
    liquid: optBool(raw.liquid),
    liquidYear: num(raw.liquidYear),
    liquidRef: optRef(raw.liquidRef),
  });
}

function sanitizeExpense(raw: unknown): ExpenseItem | null {
  if (!isObj(raw)) return null;
  return fix<ExpenseItem>(raw, {
    ...flowFields(raw),
    category: oneOf(raw.category, EXPENSE_CATEGORIES, "autre"),
  });
}

function sanitizeRecurrence(raw: unknown): Recurrence | undefined {
  if (!isObj(raw)) return undefined;
  const everyYears = num(raw.everyYears);
  if (everyYears === undefined || everyYears < 1) return undefined; // motif inexploitable → ponctuel
  return fix<Recurrence>(raw, {
    everyYears,
    scaling: num(raw.scaling),
    untilYear: num(raw.untilYear),
    untilRef: optRef(raw.untilRef),
    keepLast: optBool(raw.keepLast),
  });
}

/** Un événement sans type connu, ou sans sa cible obligatoire (actif acheté, id vendu…), est purgé. */
function sanitizeEvent(raw: unknown): PlannedEvent | null {
  if (!isObj(raw)) return null;
  const kind = optOneOf(raw.kind, EVENT_KINDS);
  if (!kind) return null;
  const base = {
    id: id(raw.id),
    label: str(raw.label),
    year: num(raw.year, 0),
    when: optRef(raw.when),
    disabled: optBool(raw.disabled),
    nominal: optBool(raw.nominal),
    recurrence: sanitizeRecurrence(raw.recurrence),
    note: optStr(raw.note),
  };
  switch (kind) {
    case "flow":
      return fix<PlannedEvent>(raw, {
        ...base,
        direction: oneOf(raw.direction, ["in", "out"] as const, "out"),
        amount: num(raw.amount, 0),
        period: oneOf(raw.period, PERIODS, "monthly"),
        endYear: num(raw.endYear),
        endRef: optRef(raw.endRef),
        growth: num(raw.growth),
      });
    case "buy": {
      const asset = sanitizeAsset(raw.asset);
      if (!asset) return null;
      return fix<PlannedEvent>(raw, { ...base, asset, price: num(raw.price, 0), fees: num(raw.fees) });
    }
    case "sell":
      if (!isId(raw.assetId)) return null;
      return fix<PlannedEvent>(raw, { ...base, price: num(raw.price), feesPct: num(raw.feesPct) });
    case "loan":
      return fix<PlannedEvent>(raw, {
        ...base,
        amount: num(raw.amount, 0),
        rate: num(raw.rate, 0),
        termMonths: num(raw.termMonths, 0),
        insurance: num(raw.insurance),
      });
    case "cash":
      return fix<PlannedEvent>(raw, { ...base, amount: num(raw.amount, 0) });
    case "repay":
      if (!isId(raw.loanId)) return null;
      return fix<PlannedEvent>(raw, { ...base, amount: num(raw.amount) });
    case "transfer":
      if (!isId(raw.fromId) || !isId(raw.toId)) return null;
      return fix<PlannedEvent>(raw, { ...base, amount: num(raw.amount, 0) });
  }
}

function sanitizeSurplusFlow(raw: unknown): SurplusFlow | null {
  if (!isObj(raw) || !isId(raw.assetId)) return null;
  return fix<SurplusFlow>(raw, {
    assetId: raw.assetId,
    mode: oneOf(raw.mode, SURPLUS_MODES, "max"),
    percent: num(raw.percent),
    amount: num(raw.amount),
    period: optOneOf(raw.period, PERIODS),
    targetBalance: num(raw.targetBalance),
    nominal: optBool(raw.nominal),
  });
}

function sanitizeProjection(raw: unknown): ProjectionParams {
  const r = isObj(raw) ? raw : { ...DEFAULT_PROJECTION };
  return fix<ProjectionParams>(r, {
    horizon: num(r.horizon, DEFAULT_PROJECTION.horizon),
    savingsYield: num(r.savingsYield, DEFAULT_PROJECTION.savingsYield),
    inflation: num(r.inflation, DEFAULT_PROJECTION.inflation),
    indexExpenses: bool(r.indexExpenses, DEFAULT_PROJECTION.indexExpenses),
    indexIncomes: bool(r.indexIncomes, DEFAULT_PROJECTION.indexIncomes),
    realTerms: bool(r.realTerms, DEFAULT_PROJECTION.realTerms),
    surplusTargets: Array.isArray(r.surplusTargets) ? r.surplusTargets.map(sanitizeSurplusFlow).filter(nonNull) : undefined,
    withdrawalTargets: Array.isArray(r.withdrawalTargets) ? r.withdrawalTargets.filter(isId) : undefined,
  });
}

function sanitizePlan(raw: unknown): Plan | null {
  if (!isObj(raw)) return null;
  return fix<Plan>(raw, {
    id: id(raw.id),
    name: str(raw.name, DEFAULT_PLAN.name),
    milestones: arr(raw.milestones).map(sanitizeMilestone).filter(nonNull),
    events: arr(raw.events).map(sanitizeEvent).filter(nonNull),
    projection: sanitizeProjection(raw.projection),
  });
}

/**
 * Force les types de TOUT l'état (voir l'encart VALIDATION) et l'estampille
 * `schemaVersion`. Idempotent ; un état valide ressort IDENTIQUE (round-trip testé).
 * Appliqué par `migrateState` à tout ce qui vient de l'extérieur (localStorage, import).
 */
export function sanitizeState(input: AppState): AppState {
  const raw = input as unknown as Dict;
  const plans = arr(raw.plans).map(sanitizePlan).filter(nonNull);
  if (plans.length === 0) plans.push(DEFAULT_PLAN);
  const activePlanId = plans.some((pl) => pl.id === raw.activePlanId) ? (raw.activePlanId as string) : plans[0].id;
  return fix<AppState>(raw, {
    schemaVersion: SCHEMA_VERSION,
    profile: sanitizeProfile(raw.profile),
    settings: sanitizeSettings(raw.settings),
    milestones: arr(raw.milestones).map(sanitizeMilestone).filter(nonNull),
    assets: arr(raw.assets).map(sanitizeAsset).filter(nonNull),
    liabilities: arr(raw.liabilities).map(sanitizeLiability).filter(nonNull),
    incomes: arr(raw.incomes).map(sanitizeIncome).filter(nonNull),
    expenses: arr(raw.expenses).map(sanitizeExpense).filter(nonNull),
    plans,
    activePlanId,
  });
}

/* ===========================================================================
   PERSISTANCE — lecture, sérialisation, export, écriture différée
   =========================================================================== */

/**
 * Charge l'état depuis le localStorage (via `migrateState`). Un stockage illisible
 * (JSON corrompu, version future…) fait repartir à vide SANS perdre le blob : il est
 * copié sous `RESCUE_KEY` avant que la prochaine écriture n'écrase l'original.
 * Exporté pour les tests.
 */
export function loadState(): AppState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    return migrateState(JSON.parse(raw));
  } catch (e) {
    if (raw) {
      try {
        localStorage.setItem(RESCUE_KEY, raw);
      } catch {
        /* quota / navigation privée */
      }
    }
    console.warn(`personaly : état local illisible, on repart à vide (copie brute sous ${RESCUE_KEY}).`, e);
    return EMPTY_STATE;
  }
}

/** Version EN TÊTE de l'objet (lisible dans le fichier), toujours égale à `SCHEMA_VERSION`. */
function stamp(state: AppState): AppState {
  const { schemaVersion: _v, ...rest } = state;
  void _v;
  return { schemaVersion: SCHEMA_VERSION, ...rest };
}

/** Sérialise l'état courant pour l'export (fichier de sauvegarde JSON, versionné). */
export function serializeState(state: AppState): string {
  return JSON.stringify(stamp(state), null, 2);
}

/** Télécharge l'état en `personaly-AAAA-MM-JJ.json` (export de la sidebar et page de secours). */
export function downloadStateJson(state: AppState): void {
  const today = new Date().toISOString().slice(0, 10);
  // charset explicite : évite le mojibake des accents à la réouverture
  const blob = new Blob([serializeState(state)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `personaly-${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Écrit l'état dans le localStorage (compact, versionné). Quota / mode privé : échec
 *  silencieux, l'état reste en mémoire et la prochaine écriture retentera. */
export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamp(state)));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

export const SAVE_DEBOUNCE_MS = 300;

/**
 * Écriture DIFFÉRÉE : sérialiser tout l'état à chaque frappe est inutile, on regroupe
 * (~300 ms après le dernier changement). `flush()` écrit immédiatement ce qui est en
 * attente (fermeture d'onglet) ; `cancel()` abandonne l'attente (réinitialisation : on
 * ne veut pas qu'un état abandonné se réécrive au `pagehide` d'un rechargement).
 * Pur (pas de React) → testé avec des timers simulés.
 */
export function createDebouncedWriter(write: (s: AppState) => void, delayMs = SAVE_DEBOUNCE_MS) {
  let pending: AppState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    clear();
    if (pending) {
      const s = pending;
      pending = null;
      write(s);
    }
  };
  return {
    schedule(s: AppState) {
      pending = s;
      clear();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      clear();
      pending = null;
    },
  };
}

/** Plan actif (garanti : retombe sur le 1er plan si l'id actif est invalide). */
export function activePlanOf(s: AppState): Plan {
  return s.plans.find((pl) => pl.id === s.activePlanId) ?? s.plans[0] ?? DEFAULT_PLAN;
}
