import type { Milestone, MilestoneRef } from "../lib/types";
import { refYear } from "../lib/types";

/**
 * Valeur d'une date de projection : une année en dur, OU un ancrage jalon
 * (prioritaire) accompagné de son instantané `year` (secours si le jalon est
 * supprimé — même logique que le moteur).
 */
export interface WhenValue {
  year?: number;
  ref?: MilestoneRef;
}

const ANCHOR_YEAR = "__year__";
const ANCHOR_NONE = "__none__";

/**
 * Sélecteur de date « à la ProjectionLab » : année précise ou jalon ± n années.
 * Ancrer sur un jalon garde tout recalé quand le jalon bouge.
 */
export default function WhenPicker({
  milestones,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "—",
  minYear,
}: {
  milestones: Milestone[];
  value: WhenValue;
  onChange: (v: WhenValue) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  minYear?: number;
}) {
  const currentYear = new Date().getFullYear();
  const orphan = !!value.ref && refYear(value.ref, milestones) === null;
  const anchor = value.ref
    ? (orphan ? ANCHOR_YEAR : value.ref.milestoneId)
    : value.year != null
      ? ANCHOR_YEAR
      : ANCHOR_NONE;

  const resolve = (ref: MilestoneRef) => refYear(ref, milestones);

  const setAnchor = (a: string) => {
    if (a === ANCHOR_NONE) return onChange({});
    if (a === ANCHOR_YEAR) {
      // repart de l'année résolue si on quitte un jalon (continuité visuelle)
      return onChange({ year: value.ref ? (resolve(value.ref) ?? value.year) : value.year ?? currentYear + 1 });
    }
    const ref: MilestoneRef = { milestoneId: a };
    onChange({ ref, year: resolve(ref) ?? undefined });
  };

  const setOffset = (offset: number) => {
    if (!value.ref) return;
    const ref: MilestoneRef = { ...value.ref, offset: offset || undefined };
    onChange({ ref, year: resolve(ref) ?? value.year });
  };

  const resolved = value.ref ? resolve(value.ref) : null;

  return (
    <div className="when-picker">
      <select className="select" value={anchor} onChange={(e) => setAnchor(e.target.value)}>
        {allowEmpty && <option value={ANCHOR_NONE}>{emptyLabel}</option>}
        <option value={ANCHOR_YEAR}>Année précise</option>
        {milestones.map((m) => (
          <option key={m.id} value={m.id}>◇ {m.label || "Jalon"} ({m.year})</option>
        ))}
      </select>

      {anchor === ANCHOR_YEAR && (
        <input
          className="input mono when-year"
          type="number"
          min={minYear}
          placeholder="ex. 2032"
          value={value.year ?? ""}
          onChange={(e) => onChange({ year: e.target.value ? Number(e.target.value) : undefined })}
        />
      )}

      {anchor !== ANCHOR_YEAR && anchor !== ANCHOR_NONE && (
        <>
          <input
            className="input mono when-offset"
            type="number"
            step="1"
            title="Décalage en années par rapport au jalon"
            value={value.ref?.offset ?? ""}
            placeholder="±0"
            onChange={(e) => setOffset(Number(e.target.value))}
          />
          <span className="when-resolved mono">
            {resolved !== null ? `= ${resolved}` : "?"}
          </span>
        </>
      )}
    </div>
  );
}
