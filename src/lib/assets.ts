/* ===========================================================================
   Registre des TYPES D'ACTIFS — source unique de la métadonnée UI par catégorie :
   libellé, icône, couleur d'accent, blocs de formulaire affichés, éligibilité aux
   versements, presets (pré-remplissages en un clic) et volatilité type (Monte Carlo).

   Consommé par : PatrimoinePage (liste + modale), EventModal (achat), eventHelpers,
   MonteCarloView, et plus tard le Dashboard / le langage couleur de perf.

   Principe (cf. REFACTOR §7) : `Asset` reste un SUR-ENSEMBLE unifié ; on ne pilote
   que l'UX par catégorie. La finesse produit (Livret A, PEA, assurance-vie…) vit
   dans les `presets`, jamais dans des catégories séparées.
   =========================================================================== */
import type { FC } from "react";
import type { Asset, AssetCategory } from "./types";
import { canReceiveDeposits } from "./types";
import {
  IconBank,
  IconBox,
  IconCar,
  IconChart,
  IconCoins,
  IconHome,
} from "../components/icons";

/** Blocs de formulaire qu'une catégorie affiche dans la modale d'actif. */
export type AssetFieldKey =
  | "growth" // croissance capitalisée (%/an)
  | "volatility" // écart-type annuel (Monte Carlo)
  | "rented" // bascule « loué » (immobilier) → révèle le revenu
  | "income" // revenu distribué (loyer, dividende)
  | "charges" // charges récurrentes
  | "floor" // valeur plancher (si dépréciation)
  | "deposits"; // versements (surplus de projection)

/** Pré-remplissage d'un actif en un clic (Livret A, PEA, Locatif…). */
export interface AssetPreset {
  label: string;
  patch: Partial<Asset>; // fusionné dans le brouillon (garde id/label/valeur saisis)
  hint?: string;
}

export interface AssetType {
  id: AssetCategory;
  label: string;
  icon: FC<{ size?: number }>;
  /** Couleur d'accent (token CSS) — utilisée par la liste et le langage de perf. */
  accent: string;
  /** Blocs de formulaire à afficher (ordre indicatif). */
  fields: AssetFieldKey[];
  /** Volatilité annuelle type (%/an) pour le bouton « valeurs types » du Monte Carlo. */
  defaultVolatility: number;
  presets: AssetPreset[];
  help: string;
}

/* --------------------------------------------------------------------------
   NB : les TAUX des presets sont des valeurs par défaut INDICATIVES, éditables
   après application. Seuls les PLAFONDS (Livret A, PEA…) sont des faits structurels.

   `accent` = couleur d'IDENTITÉ de la catégorie (neutre) — surtout PAS un signal de
   performance : un véhicule PEUT s'apprécier (voiture de collection), un bien immo PEUT
   se déprécier. La performance réelle (gain/drain) est calculée par actif en phase 3.
   -------------------------------------------------------------------------- */

export const ASSET_TYPES: Record<AssetCategory, AssetType> = {
  immobilier: {
    id: "immobilier",
    label: "Immobilier",
    icon: IconHome,
    accent: "var(--sage)",
    fields: ["growth", "volatility", "rented", "income", "charges", "floor"],
    defaultVolatility: 8,
    presets: [
      {
        label: "Résidence principale",
        patch: { rented: false, growthRate: 2, incomeMode: "none" },
        hint: "s'apprécie, ne distribue pas de revenu",
      },
      {
        label: "Immobilier locatif",
        patch: {
          rented: true,
          growthRate: 1.5,
          incomeMode: "amount",
          income: { amount: 600, period: "monthly" },
          charges: { amount: 1200, period: "yearly" },
        },
        hint: "loyer perçu + charges de détention",
      },
    ],
    help: "Un bien peut s'apprécier (croissance capitalisée) ET rapporter un loyer (revenu distribué) s'il est loué.",
  },

  compte_courant: {
    id: "compte_courant",
    label: "Compte courant",
    icon: IconBank,
    accent: "var(--sage-deep)",
    fields: ["deposits"],
    defaultVolatility: 0,
    presets: [{ label: "Compte chèque", patch: { growthRate: 0, incomeMode: "none" } }],
    help: "Liquidités disponibles. Peut recevoir le surplus d'épargne de la projection.",
  },

  liquidites: {
    id: "liquidites",
    label: "Liquidités",
    icon: IconCoins,
    accent: "var(--brass-bright)",
    fields: [],
    defaultVolatility: 0,
    presets: [{ label: "Espèces", patch: { growthRate: 0, incomeMode: "none" } }],
    help: "Argent liquide (espèces). Ne croît pas et ne reçoit pas de versements.",
  },

  epargne: {
    id: "epargne",
    label: "Épargne & placements",
    icon: IconChart,
    accent: "var(--brass)",
    fields: ["growth", "volatility", "income", "charges", "deposits"],
    defaultVolatility: 15,
    presets: [
      { label: "Livret A", patch: { growthRate: 2.4, volatility: 0, depositCap: 22950, incomeMode: "none" }, hint: "plafond 22 950 €" },
      { label: "LDDS", patch: { growthRate: 2.4, volatility: 0, depositCap: 12000, incomeMode: "none" }, hint: "plafond 12 000 €" },
      { label: "PEL", patch: { growthRate: 1.75, volatility: 0, incomeMode: "none" } },
      { label: "PEA", patch: { growthRate: 6, volatility: 15, depositCap: 150000, incomeMode: "none" }, hint: "plafond de versements 150 000 €" },
      { label: "CTO", patch: { growthRate: 6, volatility: 15, incomeMode: "none" }, hint: "compte-titres, sans plafond" },
      { label: "Assurance-vie", patch: { growthRate: 3, volatility: 6, incomeMode: "none" }, hint: "fonds € / unités de compte" },
      { label: "PER", patch: { growthRate: 5, volatility: 10, incomeMode: "none" } },
      { label: "ETF / Actions", patch: { growthRate: 7, volatility: 18, incomeMode: "none" }, hint: "rendement + volatilité élevés" },
    ],
    help: "Enveloppes d'épargne et de placement : la valeur se compose. Les plafonds portent sur les versements cumulés.",
  },

  vehicule: {
    id: "vehicule",
    label: "Véhicule",
    icon: IconCar,
    accent: "var(--ink-mute)",
    fields: ["growth", "volatility", "floor"],
    defaultVolatility: 0,
    presets: [
      { label: "Voiture", patch: { growthRate: -15, valueFloor: 2000, incomeMode: "none" }, hint: "se déprécie, plancher de valeur résiduelle" },
      { label: "Voiture de collection", patch: { growthRate: 3, incomeMode: "none" }, hint: "peut s'apprécier" },
    ],
    help: "La valeur évolue selon `croissance` : négative pour un véhicule courant (jusqu'à un plancher), positive pour un véhicule de collection.",
  },

  autre: {
    id: "autre",
    label: "Autre",
    icon: IconBox,
    accent: "var(--ink-soft)",
    fields: ["growth", "volatility", "income", "charges"],
    defaultVolatility: 5,
    presets: [],
    help: "Tout autre actif (objet de valeur, cryptomonnaie, part de société…).",
  },
};

/** Ordre d'affichage des catégories (select, liste). */
export const ASSET_CATEGORIES: AssetCategory[] = [
  "immobilier",
  "epargne",
  "compte_courant",
  "liquidites",
  "vehicule",
  "autre",
];

export function assetType(category: AssetCategory): AssetType {
  return ASSET_TYPES[category] ?? ASSET_TYPES.autre;
}

export function assetLabel(category: AssetCategory): string {
  return assetType(category).label;
}

/** La catégorie affiche-t-elle ce bloc de formulaire ? */
export function hasField(category: AssetCategory, field: AssetFieldKey): boolean {
  return assetType(category).fields.includes(field);
}

/** Volatilités types par catégorie (bouton « valeurs types » du Monte Carlo). */
export const DEFAULT_VOLATILITY: Record<AssetCategory, number> = Object.fromEntries(
  ASSET_CATEGORIES.map((c) => [c, ASSET_TYPES[c].defaultVolatility])
) as Record<AssetCategory, number>;

/**
 * Nettoie les champs COMPORTEMENTAUX qu'une catégorie n'expose pas, pour qu'un
 * réglage caché (ex. un loyer resté sur un bien passé « non loué ») n'alimente
 * pas le moteur en douce. À appliquer à l'enregistrement.
 */
export function normalizeAsset(a: Asset): Asset {
  const has = (f: AssetFieldKey) => hasField(a.category, f);
  const out: Asset = { ...a };
  if (!has("growth")) {
    out.growthRate = 0;
    out.volatility = undefined;
  }
  if (!has("volatility")) out.volatility = undefined;
  if (!has("floor")) out.valueFloor = undefined;
  if (!has("rented")) out.rented = undefined;
  // Revenu : autorisé si la catégorie a le bloc `income` ET (pas d'exigence `rented`
  // ou bien `rented` actif). Sinon on coupe la distribution.
  const incomeAllowed = has("income") && (!has("rented") || out.rented === true);
  if (!incomeAllowed) out.incomeMode = "none";
  if (!has("charges")) out.charges = undefined;
  return out;
}

/** Actif vierge d'une catégorie (valeurs par défaut neutres). */
export function emptyAssetOf(category: AssetCategory, id: string): Asset {
  return {
    id,
    label: "",
    category,
    value: 0,
    growthRate: 0,
    incomeMode: "none",
    incomeRate: 0,
    income: { amount: 0, period: "monthly" },
  };
}

// ré-export pratique
export { canReceiveDeposits };
