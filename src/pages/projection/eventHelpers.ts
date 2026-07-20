/**
 * Logique métier des ÉVÉNEMENTS de la projection : construction d'un brouillon,
 * bascule de type, listes d'actifs/emprunts référençables et résumé lisible.
 * Partagé par EventsView (liste) et EventModal (édition).
 */
import type { AssetCategory, Milestone, PlannedEvent } from "../../lib/types";
import { canReceiveDeposits, eventYear } from "../../lib/types";
import { money, signedMoney, percent, uid, whenLabel } from "../../lib/format";
import { formatDuration } from "../../lib/finance";

export const CAT_LABELS: Record<AssetCategory, string> = {
  immobilier: "Immobilier", compte_courant: "Compte courant", livret_epargne: "Livret d'épargne",
  placement: "Placement", vehicule: "Véhicule", autre: "Autre",
};

export const EVENT_KINDS: { id: PlannedEvent["kind"]; label: string }[] = [
  { id: "flow", label: "Flux récurrent" },
  { id: "cash", label: "Rentrée / Sortie" },
  { id: "buy", label: "Achat" },
  { id: "sell", label: "Vente" },
  { id: "loan", label: "Emprunt" },
  { id: "repay", label: "Remboursement" },
  { id: "deposit", label: "Versement" },
];

/** Vue minimale de l'état dont les helpers d'événements ont besoin. */
export interface AppStateLike {
  assets: { id: string; label: string; category: AssetCategory }[];
  liabilities: { id: string; label: string }[];
  events: PlannedEvent[];
  milestones: Milestone[];
}

export const emptyEvent = (year: number): PlannedEvent => ({
  id: uid(), kind: "cash", label: "", year: Math.min(new Date().getFullYear() + 1, year), amount: 0,
});

/** Bascule le type d'un brouillon en conservant id / libellé / date. */
export function switchKind(ev: PlannedEvent, kind: PlannedEvent["kind"], s: AppStateLike): PlannedEvent {
  const base = { id: ev.id, label: ev.label, year: ev.year, when: ev.when };
  switch (kind) {
    case "flow": return { ...base, kind, direction: "out", amount: 0, period: "monthly" };
    case "cash": return { ...base, kind, amount: 0 };
    case "buy": return {
      ...base, kind, price: 0, fees: 0,
      asset: { id: uid(), label: "", category: "immobilier", value: 0, growthRate: 0, incomeMode: "none" },
    };
    case "sell": return { ...base, kind, assetId: sellableAssets(s)[0]?.id ?? "", feesPct: 0 };
    case "loan": return { ...base, kind, amount: 0, rate: 0, termMonths: 240 };
    case "repay": return { ...base, kind, loanId: repayableLoans(s)[0]?.id ?? "" };
    case "deposit": return { ...base, kind, assetId: depositableAssets(s)[0]?.id ?? "", amount: 0 };
  }
}

/** Actifs vendables : existants + créés par un événement "buy". */
export function sellableAssets(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.assets.map((a) => ({ id: a.id, label: a.label || "Actif" })),
    ...s.events.filter((e) => e.kind === "buy").map((e) => ({ id: e.asset.id, label: `${e.label || "Achat"} (${eventYear(e, s.milestones)})` })),
  ];
}

/** Emprunts remboursables : passifs existants + créés par un événement "loan". */
export function repayableLoans(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.liabilities.map((l) => ({ id: l.id, label: l.label || "Emprunt" })),
    ...s.events.filter((e) => e.kind === "loan").map((e) => ({ id: e.id, label: `${e.label || "Emprunt"} (${eventYear(e, s.milestones)})` })),
  ];
}

/** Actifs pouvant recevoir un versement : éligibles (compte, livret, placement), existants ou achetés par événement. */
export function depositableAssets(s: AppStateLike): { id: string; label: string }[] {
  return [
    ...s.assets.filter((a) => canReceiveDeposits(a)).map((a) => ({ id: a.id, label: a.label || "Actif" })),
    ...s.events
      .filter((e) => e.kind === "buy")
      .filter((e) => canReceiveDeposits(e.asset))
      .map((e) => ({ id: e.asset.id, label: `${e.label || "Achat"} (${eventYear(e, s.milestones)})` })),
  ];
}

export function eventSummary(ev: PlannedEvent, s: AppStateLike): string {
  switch (ev.kind) {
    case "flow": {
      const per = ev.period === "monthly" ? "/mois" : "/an";
      const endTxt = whenLabel(ev.endYear, ev.endRef, s.milestones);
      return `Flux ${ev.direction === "in" ? "entrant" : "sortant"} · ${ev.direction === "in" ? "+" : "−"}${money(ev.amount)}${per}${endTxt ? ` jusqu'à ${endTxt}` : ""}`;
    }
    case "buy":
      return `Achat · ${money(ev.price)}${ev.fees ? ` + ${money(ev.fees)} de frais` : ""} · ${CAT_LABELS[ev.asset.category]}${ev.asset.growthRate ? ` ${ev.asset.growthRate > 0 ? "+" : ""}${percent(ev.asset.growthRate)}/an` : ""}`;
    case "sell": {
      const label = sellableAssets(s).find((a) => a.id === ev.assetId)?.label ?? "actif inconnu";
      return `Vente de ${label} · ${ev.price != null ? money(ev.price) : "à la valeur projetée"}${ev.feesPct ? ` · frais ${percent(ev.feesPct)}` : ""}`;
    }
    case "loan":
      return `Nouvel emprunt · ${money(ev.amount)} à ${percent(ev.rate)} sur ${formatDuration(ev.termMonths)}${ev.insurance ? ` + ${money(ev.insurance)}/mois d'assurance` : ""}`;
    case "cash":
      return `${ev.amount >= 0 ? "Rentrée" : "Sortie"} ponctuelle · ${signedMoney(ev.amount)}`;
    case "repay": {
      const label = repayableLoans(s).find((l) => l.id === ev.loanId)?.label ?? "emprunt inconnu";
      return `Remboursement anticipé de ${label} · ${ev.amount != null ? money(ev.amount) : "totalité"}`;
    }
    case "deposit": {
      const label = depositableAssets(s).find((a) => a.id === ev.assetId)?.label ?? "actif inconnu";
      return `Versement · ${money(ev.amount)} → ${label}`;
    }
  }
}
