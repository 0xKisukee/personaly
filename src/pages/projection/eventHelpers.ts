/**
 * Logique métier des ÉVÉNEMENTS de la projection : construction d'un brouillon,
 * bascule de type, listes d'actifs/emprunts référençables et résumé lisible.
 * Partagé par EventsView (liste) et EventModal (édition).
 */
import type { AssetCategory, Milestone, PlannedEvent, Recurrence } from "../../lib/types";
import { canTransfer, EPARGNE_ID, EPARGNE_LABEL, eventYear } from "../../lib/types";
import { assetLabel } from "../../lib/assets";
import { money, signedMoney, percent, uid, whenLabel } from "../../lib/format";
import { formatDuration } from "../../lib/finance";

/** Récurrence par défaut proposée quand on active « Répéter » (achat/cash). */
export const DEFAULT_RECURRENCE: Recurrence = { everyYears: 10, keepLast: true };

/** Types récurrables : achat (remplacement) + flux « neufs » à montant répété
 *  (rentrée/sortie, versement, emprunt). Pas de récurrence pour vente/remboursement
 *  (ils ciblent un actif/emprunt précis) ni pour le flux (déjà récurrent par nature). */
export const RECURRABLE: PlannedEvent["kind"][] = ["buy", "cash", "loan", "transfer"];

/** Résumé lisible d'une récurrence, pour la liste des événements. */
export function recurrenceSummary(r: Recurrence, milestones: Milestone[]): string {
  const until = whenLabel(r.untilYear, r.untilRef, milestones);
  const scale = r.scaling ? `, ${r.scaling > 0 ? "+" : ""}${percent(r.scaling)}/fois` : "";
  return `↻ tous les ${r.everyYears} ans${scale}${until ? ` jusqu'à ${until}` : ""}`;
}

export const EVENT_KINDS: { id: PlannedEvent["kind"]; label: string }[] = [
  { id: "flow", label: "Flux récurrent" },
  { id: "cash", label: "Rentrée / Sortie" },
  { id: "buy", label: "Achat" },
  { id: "sell", label: "Vente" },
  { id: "loan", label: "Emprunt" },
  { id: "repay", label: "Remboursement" },
  { id: "transfer", label: "Transfert" },
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
  // la récurrence ne se conserve qu'entre types récurrables (achat ↔ cash) ; sinon elle tombe.
  // le mode d'indexation (nominal) se conserve pour TOUS les types (flux compris).
  const recurrence = RECURRABLE.includes(kind) ? ev.recurrence : undefined;
  const base = { id: ev.id, label: ev.label, year: ev.year, when: ev.when, recurrence, nominal: ev.nominal };
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
    case "transfer": {
      // par défaut : Épargne → 1er compte liquide (= l'ancien versement, le cas le plus courant)
      const accounts = transferableAccounts(s);
      return { ...base, kind, fromId: EPARGNE_ID, toId: accounts.find((a) => a.id !== EPARGNE_ID)?.id ?? "", amount: 0 };
    }
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

/** Comptes utilisables dans un transfert (source OU destination) : l'Épargne (le pool
 *  de trésorerie, exposé comme un compte) + les actifs LIQUIDES (livret, placement,
 *  compte courant), existants ou créés par un événement "buy". */
export function transferableAccounts(s: AppStateLike): { id: string; label: string }[] {
  return [
    { id: EPARGNE_ID, label: EPARGNE_LABEL },
    ...s.assets.filter((a) => canTransfer(a)).map((a) => ({ id: a.id, label: a.label || "Actif" })),
    ...s.events
      .filter((e) => e.kind === "buy")
      .filter((e) => canTransfer(e.asset))
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
      return `Achat · ${money(ev.price)}${ev.fees ? ` + ${money(ev.fees)} de frais` : ""} · ${assetLabel(ev.asset.category)}${ev.asset.growthRate ? ` ${ev.asset.growthRate > 0 ? "+" : ""}${percent(ev.asset.growthRate)}/an` : ""}`;
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
    case "transfer": {
      const accounts = transferableAccounts(s);
      const from = accounts.find((a) => a.id === ev.fromId)?.label ?? "compte inconnu";
      const to = accounts.find((a) => a.id === ev.toId)?.label ?? "compte inconnu";
      return `Transfert · ${money(ev.amount)} · ${from} → ${to}`;
    }
  }
}
